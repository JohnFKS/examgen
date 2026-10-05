'use strict';
/** HTTP 服务：静态网页 + REST API + SSE 事件流（零依赖） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const U = require('./lib/util');
const cfg = require('./config');
const llm = require('./llm');
const corpusMod = require('./ingest/corpus');
const lib = require('./store/library');
const render = require('./store/render');
const orch = require('./pipeline/orchestrator');
const wb = require('./pipeline/agentWorkbench');
const registry = require('./skills/registry');
const essence = require('./store/essence');
const matchSkill = require('./skills/essenceMatch');

const PUB = {
  'web': { root: cfg.P.web, guards: [cfg.P.web] },
  'output': { root: render.OUT, guards: [render.OUT] },
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}
function json(res, code, obj) {
  send(res, code, JSON.stringify(obj, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 8e6) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function safeJoin(root, rel) {
  const target = path.resolve(root, rel || '.');
  const guard = path.resolve(root);
  if (target !== guard && !target.startsWith(guard + path.sep)) throw new Error('非法路径');
  return target;
}

/* ---------------- SSE 广播 ---------------- */
const sseClients = new Set();
orch.bus.on('event', (e) => broadcast('event', e));
orch.bus.on('run-end', (r) => broadcast('run-end', r));
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {}
  });
}

/* ---------------- 概览数据 ---------------- */
function overview() {
  const s = cfg.load();
  const corpus = corpusMod.loadCached();
  const st = orch.readState();
  const stats = lib.stats();
  // 「本章已完成」以库态的 chaptersDone 为准（lib.markChapterDone 是唯一全程写入的一处；state.json 只有本轮修复后跑的章节才会补记）
  const doneChapters = lib.read().chaptersDone || [];
  const prov = llm.getProvider(s);
  const coverageAll = s.chapterMap.map((c) => orch.coverageOf(c.no, lib.active().filter((t) => (t.chapters || []).includes(c.no))));
  const pointTotal = coverageAll.reduce((a, x) => a + x.total, 0);
  const pointCovered = coverageAll.reduce((a, x) => a + x.covered, 0);
  const decs = orch.loadDecomps();
  const mats = orch.loadMatches();
  const byRole = corpus.files.reduce((a, f) => ((a[f.role] = (a[f.role] || 0) + 1), a), {});
  const agentStats = prov.stats ? prov.stats() : null;
  const cur = orch.getCurrent();
  return {
    mode: s.mode,
    model: s.llm.model || (s.mode === 'agent' ? 'qoder-agent（智能体扮演大模型）' : '（未配置）'),
    baseUrl: s.llm.baseUrl,
    corpus: {
      inputDir: cfg.P.input,
      files: corpus.files.length,
      byRole,
      problems: corpus.stats.total,
      solutions: corpus.stats.solutionTotal,
      aligned: corpus.stats.matched,
      alignRate: corpus.stats.coverage,
      lectures: Object.keys(corpus.lectures).length,
      formulaEntries: corpus.formulaEntries.length,
      seeds: corpus.seeds.length,
      warnings: corpus.warnings.length,
    },
    library: stats,
    iteration: { decomposed: decs.length, matched: mats.length, actions: mats.reduce((a, m) => ((a[m.action] = (a[m.action] || 0) + 1), a), {}), byAction: null },
    coverage: { total: pointTotal, covered: pointCovered, rate: pointTotal ? pointCovered / pointTotal : 0, problemRate: corpus.stats.total ? mats.length / corpus.stats.total : 0 },
    chapters: s.chapterMap.map((c, i) => ({
      no: c.no,
      title: c.title,
      discipline: c.discipline,
      lectures: c.lectures,
      problemCount: corpus.chapters[i] ? corpus.chapters[i].problemCount : 0,
      matchedCount: corpus.chapters[i] ? corpus.chapters[i].matchedCount : 0,
      examPointCount: coverageAll[i].total,
      templates: stats.byChapter[c.no] || 0,
      done: doneChapters.includes(c.no),
      version: st.versions['ch' + c.no] || '-',
      coverage: coverageAll[i].rate,
      stats: (st.chapterStats || {})[c.no] || null,
    })),
    agent: s.mode === 'agent' ? agentStats : null,
    running: !!cur,
    currentRun: cur ? { id: cur.id, events: cur.events.length } : null,
    runs: (st.runs || []).slice(-10).reverse(),
    outputs: listOutputFiles(),
    convergence: s.convergence,
    convergenceTarget: s.convergence,
    state: { seedsImported: (st.seedsImported || []).length, runs: (st.runs || []).length, lastRun: (st.runs || []).slice(-1)[0] || null },
  };
}

function listOutputFiles() {
  const files = [];
  (function walk(dir, rel) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const r = rel ? rel + '/' + name : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else files.push({ path: r, name, bytes: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs });
    }
  })(render.OUT, '');
  return files.sort((a, b) => b.mtime - a.mtime);
}

/* ---------------- 路由表 ---------------- */
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => (keys.push(m.slice(1)), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/overview', async (req, res) => json(res, 200, overview()));

/* 事件流：SSE（长连接，注册为路由以保持路由表是接口契约的唯一来源） */
route('GET', '/api/events', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

route('GET', '/api/settings', async (req, res) => {
  const s = cfg.load();
  json(res, 200, {
    mode: s.mode,
    llm: {
      baseUrl: s.llm.baseUrl,
      apiKeyMasked: cfg.maskKey(s.llm.apiKey),
      hasKey: !!s.llm.apiKey,
      model: s.llm.model,
      routing: s.llm.routing,
      routingHints: s.llm.routingHints,
      temperature: s.llm.temperature,
      maxTokens: s.llm.maxTokens,
      timeoutMs: s.llm.timeoutMs,
      retries: s.llm.retries,
      concurrency: s.llm.concurrency,
    },
    batch: s.batch,
    convergence: s.convergence,
    chapterMap: s.chapterMap,
    inputFiles: s.input.files,
    inputDir: cfg.P.input,
  });
});

route('PUT', '/api/settings', async (req, res) => {
  const body = await readBody(req);
  const patch = JSON.parse(body || '{}');
  if (patch.llm) {
    if (patch.llm.apiKey === '' || patch.llm.apiKey === cfg.maskKey(cfg.load().llm.apiKey)) delete patch.llm.apiKey;
  }
  const next = cfg.save(patch);
  llm.resetProvider();
  json(res, 200, { ok: true, mode: next.mode, llm: { baseUrl: next.llm.baseUrl, model: next.llm.model, apiKeyMasked: cfg.maskKey(next.llm.apiKey) } });
});

route('POST', '/api/index/rebuild', async (req, res) => {
  const c = corpusMod.loadCached(true);
  json(res, 200, { ok: true, problems: c.stats.total, matched: c.stats.matched, coverage: c.stats.coverage, warnings: c.warnings.length });
});

route('GET', '/api/models', async (req, res) => {
  const s = cfg.load();
  const prov = llm.getProvider(s);
  try {
    const models = await prov.listModels();
    json(res, 200, { ok: true, mode: s.mode, source: s.mode === 'agent' ? 'offline-catalog' : 'live', models });
  } catch (e) {
    json(res, 200, { ok: false, error: e.message, hint: hint(e, s) });
  }
});

route('GET', '/api/route/:skill', async (req, res, q, p) => {
  const s = cfg.load();
  const models = await llm.getProvider(s).listModels().catch(() => []);
  json(res, 200, { skill: p.skill, ...llm.routeModel(models, p.skill, s) });
});

route('POST', '/api/route/auto', async (req, res) => {
  const s = cfg.load();
  const models = await llm.getProvider(s).listModels().catch(() => []);
  const routing = {};
  const detail = {};
  for (const sk of Object.keys(s.llm.routingHints)) {
    const r = llm.routeModel(models, sk, s);
    routing[sk] = r.model;
    detail[sk] = r;
  }
  cfg.save({ llm: { routing } });
  json(res, 200, { ok: true, routing, detail });
});

route('POST', '/api/models/probe', async (req, res, q, p, body) => {
  const s = cfg.load();
  const { model, prompt } = JSON.parse(body || '{}');
  const prov = llm.getProvider(s);
  const t0 = Date.now();
  try {
    const r = await prov.chat({ model, messages: [{ role: 'user', content: prompt || '回复：OK' }], skill: 'probe', jsonMode: false });
    json(res, 200, { ok: true, model: r.model, echo: String(r.text).slice(0, 200), ms: Date.now() - t0 });
  } catch (e) {
    json(res, 200, { ok: false, error: e.message, hint: hint(e, s) });
  }
});

route('GET', '/api/files', async (req, res) => json(res, 200, { dir: cfg.P.input, files: cfg.load().input.files }));
route('GET', '/api/files/content', async (req, res, q) => {
  if (!q.file) return json(res, 400, { error: '缺少 file 参数' });
  const f = safeJoin(cfg.P.input, q.file);
  if (!fs.existsSync(f)) return json(res, 404, { error: '文件不存在' });
  if (fs.statSync(f).isDirectory()) return json(res, 400, { error: 'file 参数指向目录' });
  const raw = fs.readFileSync(f, 'utf8');
  const { cleanMd } = require('./ingest/markdown');
  const limit = Math.min(Number(q.limit) || 20000, raw.length);
  json(res, 200, { file: q.file, bytes: raw.length, truncated: raw.length > limit, raw: raw.slice(0, limit), clean: cleanMd(raw).slice(0, limit) });
});

route('GET', '/api/problems', async (req, res, q) => {
  const c = corpusMod.loadCached();
  const decs = new Map(orch.loadDecomps().map((d) => [d.problem_id, d]));
  const mats = new Map(orch.loadMatches().map((d) => [d.problem_id, d]));
  let list = c.problems;
  if (q.chapter) list = list.filter((p) => String(p.chapterNo) === q.chapter);
  if (q.tier) list = list.filter((p) => p.tier === q.tier);
  if (q.section) list = list.filter((p) => p.section === q.section);
  if (q.dec === 'yes') list = list.filter((p) => decs.has(p.id));
  if (q.dec === 'no') list = list.filter((p) => !decs.has(p.id));
  if (q.q) {
    const k = q.q.toLowerCase();
    list = list.filter((p) => (p.stem + ' ' + (p.solution || '')).toLowerCase().includes(k));
  }
  const from = Number(q.from) || 0;
  const size = Math.min(Number(q.size) || 50, 300);
  json(res, 200, {
    total: list.length,
    from,
    size,
    items: list.slice(from, from + size).map((p) => ({
      id: p.id,
      chapterNo: p.chapterNo,
      tier: p.tier,
      section: p.section,
      no: p.no,
      stem: p.stem.slice(0, 400),
      options: (p.options || '').slice(0, 260),
      answerLabel: p.answerLabel,
      hasSolution: !!p.solution,
      decomposition: decs.get(p.id) || null,
      match: mats.get(p.id) || null,
    })),
  });
});
route('GET', '/api/problems/detail', async (req, res, q) => {
  const c = corpusMod.loadCached();
  const p = c.problems.find((x) => x.id === q.id);
  if (!p) return json(res, 404, { error: '题目不存在' });
  json(res, 200, {
    problem: p,
    decomposition: orch.loadDecomps().find((d) => d.problem_id === p.id) || null,
    match: orch.loadMatches().find((m) => m.problem_id === p.id) || null,
  });
});

route('GET', '/api/library', async (req, res) => {
  const s = cfg.load();
  const ts = lib.active();
  const tree = [];
  for (const d of ['高等数学', '线性代数', '概率论与数理统计']) {
    const inD = ts.filter((t) => t.discipline === d);
    if (!inD.length) continue;
    const chapters = s.chapterMap
      .filter((c) => c.discipline === d)
      .map((c) => ({ no: c.no, title: c.title, templates: inD.filter((t) => (t.chapters || []).includes(c.no)) }))
      .filter((c) => c.templates.length);
    const rest = inD.filter((t) => !chapters.some((c) => c.templates.includes(t)));
    tree.push({ discipline: d, count: inD.length, chapters, ungrouped: rest.length ? [{ no: 0, title: '跨章节通用', templates: rest }] : [] });
  }
  json(res, 200, { stats: lib.stats(), tree, merged: lib.all().filter((t) => t.status === 'merged').length });
});
route('GET', '/api/library/template', async (req, res, q) => {
  const t = lib.byId(q.id);
  if (!t) return json(res, 404, { error: '模板不存在' });
  json(res, 200, { template: t, markdown: lib.templateMd(t) });
});
route('PUT', '/api/library/template', async (req, res, q, p, body) => {
  const patch = JSON.parse(body || '{}');
  const t = lib.byId(patch.id);
  if (!t) return json(res, 404, { error: '模板不存在' });
  const next = lib.normalize(Object.assign({}, t, patch, { updated_at: U.nowStamp() }));
  next.version = lib.bump(t.version, patch._bump || 'minor');
  next.history = (t.history || []).concat([{ version: next.version, at: next.updated_at, action: 'manual-edit', reason: patch._reason || '人工修订', skill: 'web' }]);
  lib.upsert(next);
  json(res, 200, { ok: true, template: next });
});
route('GET', '/api/decompositions', async (req, res, q) => {
  let list = orch.loadDecomps();
  if (q.chapter) list = list.filter((d) => String(d.chapterNo) === q.chapter);
  json(res, 200, { total: list.length, items: list });
});
route('GET', '/api/matches', async (req, res, q) => {
  let list = orch.loadMatches();
  if (q.chapter) list = list.filter((d) => String(d.chapterNo).replace('ch', '') === String(q.chapter).replace('ch', ''));
  json(res, 200, { total: list.length, tiers: matchSkill.TIERS, items: list });
});
route('GET', '/api/essence/matrix', async (req, res) => json(res, 200, { pairs: essence.matrix(lib.active()), count: lib.active().length }));

route('GET', '/api/qa', async (req, res, q) => {
  if (!q.chapter) {
    const files = fs.existsSync(orch.D.qa) ? fs.readdirSync(orch.D.qa).filter((f) => f.endsWith('.json')) : [];
    return json(
      res,
      200,
      files.map((f) => U.readJson(path.join(orch.D.qa, f))).filter(Boolean)
    );
  }
  const file = path.join(orch.D.qa, 'ch' + String(q.chapter).padStart(2, '0') + '.json');
  if (!fs.existsSync(file)) return json(res, 404, { error: '该章节尚无质检报告' });
  json(res, 200, U.readJson(file));
});
route('GET', '/api/qa/list', async (req, res) => {
  const files = fs.existsSync(orch.D.qa) ? fs.readdirSync(orch.D.qa).filter((f) => f.endsWith('.json')) : [];
  json(res, 200, files.map((f) => {
    const r = U.readJson(path.join(orch.D.qa, f)) || {};
    return { chapterNo: r.chapterNo, at: r.at, coverage: r.report && r.report.coverage ? { rate: r.report.coverage.rate, total: r.report.coverage.total, covered: r.report.coverage.covered.length } : null, equivalence: r.report && r.report.equivalence ? (r.report.equivalence.pending ? 'pending' : (r.report.equivalence.results || []).length + ' 项') : '-', boundary: r.report && r.report.boundary ? (r.report.boundary.pending ? 'pending' : (r.report.boundary.results || []).length + ' 项') : '-' };
  }));
});

route('GET', '/api/skills', async (req, res) => {
  const skills = registry.all().map((s) => Object.assign({}, s, { doc: fs.existsSync(path.join(cfg.P.skills, s.layer, s.id, 'SKILL.md')) }));
  json(res, 200, {
    skills,
    pending: registry.GEN,
    tiers: matchSkill.TIERS,
    layers: ['meta', 'business', 'qa'].map((k) => ({
      key: k,
      title: k === 'meta' ? '元能力层' : k === 'business' ? '业务执行层' : '质量校验层',
      items: skills.filter((s) => s.layer === k).map((s) => s.id),
    })),
  });
});
route('POST', '/api/skills/forge', async (req, res, q, p, body) => {
  try {
    const spec = JSON.parse(body || '{}');
    json(res, 200, { ok: true, skill: registry.forge(spec) });
  } catch (e) {
    json(res, 400, { ok: false, error: e.message });
  }
});

route('POST', '/api/run', async (req, res, q, p, body) => {
  const opt = JSON.parse(body || '{}');
  if (orch.getCurrent()) return json(res, 409, { error: '已有运行中的任务', id: orch.getCurrent().id });
  const chapters = opt.chapters && opt.chapters.length ? opt.chapters : cfg.load().chapterMap.map((c) => c.no);
  const stages = opt.stages && opt.stages.length ? opt.stages : ['seed', 'chapter', 'converge'];
  if (opt.reset) resetRuntime();
  const started = { at: U.nowStamp(), chapters, stages, mode: cfg.load().mode };
  orch.start({ chapters, stages, source: 'web', forceSeed: !!opt.forceSeed }).then(
    (r) => broadcast('run-done', { id: r.id, summary: r.summary, usage: r.usage }),
    (e) => broadcast('run-fail', { error: e.message })
  );
  json(res, 202, { ok: true, started });
});
route('POST', '/api/run/stop', async (req, res) => {
  const c = orch.getCurrent();
  if (!c) return json(res, 404, { error: '没有正在运行的任务' });
  c.cancel();
  json(res, 200, { ok: true, id: c.id });
});
route('GET', '/api/run/current', async (req, res) => {
  const c = orch.getCurrent();
  if (!c) return json(res, 200, { running: false });
  json(res, 200, {
    running: true,
    id: c.id,
    startedAt: c.startedAt || null,
    events: c.events.slice(-200),
    pending: c.pending,
    pendingCount: c.pending.length,
    usage: c.usage,
    cancelled: c.cancelled,
  });
});
route('GET', '/api/runs', async (req, res) => json(res, 200, { items: (orch.readState().runs || []).slice().reverse() }));

route('GET', '/api/agent/tasks', async (req, res) => {
  const prov = llm.getProvider(cfg.load());
  if (!prov.listPending) return json(res, 200, { supported: false, items: [], stats: null });
  json(res, 200, { supported: true, items: prov.listPending(), stats: prov.stats() });
});
route('GET', '/api/agent/task', async (req, res, q) => {
  const f = path.join(cfg.P.pending, q.key + '.json');
  if (!/^[a-f0-9]{64}$/.test(q.key || '') || !fs.existsSync(f)) return json(res, 404, { error: '任务不存在' });
  json(res, 200, U.readJson(f));
});
route('POST', '/api/agent/answer', async (req, res, q, p, body) => {
  const o = JSON.parse(body || '{}');
  const prov = llm.getProvider(cfg.load());
  if (!prov.answer) return json(res, 400, { error: '当前为生产模式，无需回填' });
  const out = typeof o.output === 'string' ? o.output : JSON.stringify(o.output, null, 2);
  json(res, 200, { ok: true, record: prov.answer(o.key, out, { author: o.author || 'web-manual', note: o.note || '' }) });
});
route('POST', '/api/agent/workbench', async (req, res) => {
  try {
    json(res, 200, { ok: true, ...wb.dump() });
  } catch (e) {
    json(res, 400, { ok: false, error: e.message });
  }
});
route('POST', '/api/agent/submit-all', async (req, res) => {
  try {
    json(res, 200, { ok: true, ...wb.submitAll() });
  } catch (e) {
    json(res, 400, { ok: false, error: e.message });
  }
});
route('GET', '/api/agent/cache', async (req, res) => {
  const prov = llm.getProvider(cfg.load());
  json(res, 200, { items: prov.listAnswers ? prov.listAnswers() : [], stats: prov.stats ? prov.stats() : null });
});
route('GET', '/api/agent/cache/entry', async (req, res, q) => {
  const f = path.join(cfg.P.cache, q.key + '.json');
  if (!/^[a-f0-9]{64}$/.test(q.key || '') || !fs.existsSync(f)) return json(res, 404, { error: '不存在' });
  json(res, 200, U.readJson(f));
});

route('GET', '/api/outputs', async (req, res) => {
  const found = [];
  (function walk(dir, rel) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const r = rel ? rel + '/' + name : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else found.push({ path: r, name, bytes: st.size, mtime: st.mtimeMs });
    }
  })(render.OUT, '');
  const files = found.sort((a, b) => b.mtime - a.mtime);
  json(res, 200, { dir: render.OUT, items: files, files });
});
route('GET', '/api/output/content', async (req, res, q) => {
  const f = safeJoin(render.OUT, q.path || '');
  if (!fs.existsSync(f)) return json(res, 404, { error: '文件不存在' });
  json(res, 200, { path: q.path, content: fs.readFileSync(f, 'utf8') });
});
route('POST', '/api/render/handbook', async (req, res) => {
  const r = orch.buildHandbook();
  json(res, 200, { ok: true, file: r.file, coverage: r.coverage });
});

/* ---------------- 路径参数别名（与前端契约对齐） ---------------- */
route('POST', '/api/index', async (req, res) => {
  const c = corpusMod.loadCached(true);
  json(res, 200, { ok: true, problems: c.stats.total, matched: c.stats.matched, coverage: c.stats.coverage, warnings: c.warnings.slice(0, 20), warningCount: c.warnings.length });
});

route('GET', '/api/chapters', async (req, res) => json(res, 200, overview().chapters));

route('GET', '/api/problems/:id', async (req, res, q, p) => {
  const c = corpusMod.loadCached();
  const prob = c.problems.find((x) => x.id === p.id);
  if (!prob) return json(res, 404, { error: '题目不存在：' + p.id });
  const match = orch.loadMatches().find((m) => m.problem_id === prob.id) || null;
  json(res, 200, {
    problem: prob,
    decomposition: orch.loadDecomps().find((d) => d.problem_id === prob.id) || null,
    match,
    template: match ? lib.byId(match.template_id) || null : null,
  });
});

route('GET', '/api/library/:id', async (req, res, q, p) => {
  const t = lib.byId(p.id);
  if (!t) return json(res, 404, { error: '模板不存在：' + p.id });
  json(res, 200, { template: t, markdown: lib.templateMd(t) });
});
route('PUT', '/api/library/:id', async (req, res, q, p, body) => {
  const patch = JSON.parse(body || '{}');
  const t = lib.byId(p.id);
  if (!t) return json(res, 404, { error: '模板不存在：' + p.id });
  const next = lib.normalize(Object.assign({}, t, patch, { id: t.id, updated_at: U.nowStamp() }));
  next.version = lib.bump(t.version, patch._bump || 'minor');
  next.history = (t.history || []).concat([{ version: next.version, at: next.updated_at, action: 'manual-edit', reason: patch._reason || '人工修订', skill: 'web' }]);
  lib.upsert(next);
  json(res, 200, { ok: true, template: next });
});

route('GET', '/api/outputs/:file', async (req, res, q, p) => {
  const f = safeJoin(render.OUT, p.file);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return json(res, 404, { error: '产物不存在：' + p.file });
  if (q.download) {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(f)}"` });
    return fs.createReadStream(f).pipe(res);
  }
  json(res, 200, { path: p.file, content: fs.readFileSync(f, 'utf8') });
});

/* 产物原文：支持嵌套目录（output/章节模板库/ch01-x.md） */
routes.push({
  method: 'GET',
  re: /^\/output\/(.+)$/,
  keys: ['rel'],
  handler: async (req, res, q, p) => {
    const f = safeJoin(render.OUT, p.rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, '产物不存在：' + p.rel);
    const ext = path.extname(f).toLowerCase();
    const type = ext === '.md' ? 'text/plain; charset=utf-8' : MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (q.download) headers['Content-Disposition'] = `attachment; filename="${path.basename(f)}"`;
    res.writeHead(200, headers);
    fs.createReadStream(f).pipe(res);
  },
});

route('POST', '/api/models', async (req, res, q, p, body) => {
  const base = cfg.load();
  let o = {};
  try {
    o = JSON.parse(body || '{}');
  } catch (e) {}
  const probe = { ...base, llm: { ...base.llm, baseUrl: o.baseUrl || base.llm.baseUrl, apiKey: o.apiKey || base.llm.apiKey } };
  if (o.save) cfg.save({ llm: { baseUrl: probe.llm.baseUrl, apiKey: probe.llm.apiKey } });
  const prov = probe.mode === 'live' ? new llm.OpenAICompatProvider(probe) : llm.getProvider(probe);
  try {
    const models = await prov.listModels();
    json(res, 200, { ok: true, mode: base.mode, source: base.mode === 'live' ? 'live' : 'offline-catalog', count: models.length, models });
  } catch (e) {
    json(res, 200, { ok: false, error: e.message, hint: hint(e, probe), models: [] });
  }
});

route('POST', '/api/route', async (req, res, q, p, body) => {
  const s = cfg.load();
  const o = JSON.parse(body || '{}');
  const sk = o.skill || 'problem-decompose';
  const models = o.models || (await llm.getProvider(s).listModels().catch(() => []));
  const r = llm.routeModel(models, sk, s);
  if (o.apply && r.model) cfg.save({ llm: { routing: { ...(s.llm.routing || {}), [sk]: r.model } } });
  json(res, 200, { ok: true, skill: sk, ...r, models: models.slice(0, 40) });
});

route('GET', '/api/agent/tasks/:key', async (req, res, q, p) => {
  const f = path.join(cfg.P.pending, p.key + '.json');
  if (!/^[a-f0-9]{64}$/.test(p.key) || !fs.existsSync(f)) return json(res, 404, { error: '任务不存在' });
  const t = U.readJson(f);
  const wp = path.join(wb.WORK, p.key + '.task.json');
  json(res, 200, { ...t, workbench: fs.existsSync(wp) ? U.readJson(wp) : null });
});
route('POST', '/api/agent/tasks/:key', async (req, res, q, p, body) => {
  const prov = llm.getProvider(cfg.load());
  if (!prov.answer) return json(res, 400, { error: '当前为生产模式，无需回填' });
  const o = JSON.parse(body || '{}');
  const out = typeof o.output === 'string' ? o.output : JSON.stringify(o.output, null, 2);
  json(res, 200, { ok: true, key: p.key, record: prov.answer(p.key, out, { author: o.author || 'web-manual', note: o.note || '' }) });
});
route('DELETE', '/api/agent/cache/:key', async (req, res, q, p) => {
  if (!/^[a-f0-9]{64}$/.test(p.key)) return json(res, 400, { error: 'key 非法' });
  const f = path.join(cfg.P.cache, p.key + '.json');
  if (!fs.existsSync(f)) return json(res, 404, { error: '缓存条目不存在' });
  fs.rmSync(f, { force: true });
  json(res, 200, { ok: true, removed: p.key });
});

function resetRuntime(opts) {
  const o = opts || {};
  const targets = [cfg.P.library, cfg.P.runs, render.OUT, orch.D.qa];
  if (o.cache) targets.push(cfg.P.cache, cfg.P.pending);
  for (const t of targets) {
    try {
      fs.rmSync(t, { recursive: true, force: true });
    } catch (e) {}
  }
  for (const f of [orch.D.dec, orch.D.match, cfg.P.state]) {
    try {
      fs.rmSync(f, { force: true });
    } catch (e) {}
  }
  U.ensureDir(cfg.P.cache);
  U.ensureDir(cfg.P.pending);
  U.ensureDir(render.OUT);
  corpusMod.loadCached(true);
}

function hint(e, s) {
  const m = String(e.message || '');
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return '域名无法解析：检查 baseUrl 拼写与网络/DNS';
  if (/ECONNREFUSED/.test(m)) return '连接被拒绝：确认服务已启动、端口正确';
  if (/ETIMEDOUT|abort/.test(m)) return '超时：调大 timeoutMs 或减小批量/换更快模型';
  if (/401|invalid api key|Unauthorized/i.test(m)) return '鉴权失败：检查 apiKey';
  if (/404/.test(m)) return '路径 404：baseUrl 通常需要带 /v1 后缀';
  if (/429/.test(m)) return '限流：降低并发或稍后重试';
  return m.slice(0, 160);
}

/* ---------------- 静态 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serveStatic(res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = safeJoin(cfg.P.web, file.replace(/^\//, ''));
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    const idx = path.join(cfg.P.web, 'index.html');
    if (!fs.existsSync(idx)) return send(res, 404, '前端未找到：web/index.html');
    return send(res, 200, fs.readFileSync(idx, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8' });
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;
  const body = req.method === 'GET' || req.method === 'DELETE' ? '' : await readBody(req);
  const q = Object.fromEntries(u.searchParams.entries());
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(p);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      await r.handler(req, res, q, params, body);
    } catch (e) {
      U.logger.error('http', `${req.method} ${p} → ${e.message}`);
      if (!res.headersSent) json(res, 500, { error: e.message });
    }
    return;
  }
  if (p.startsWith('/api/')) return json(res, 404, { error: '接口不存在：' + p });
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  serveStatic(res, p);
}

function start(port, host) {
  const s = cfg.load();
  const server = http.createServer((req, res) => handle(req, res));
  const P = port || Number(process.env.EXAMGEN_PORT || 8787);
  const H = host || process.env.EXAMGEN_HOST || '127.0.0.1';
  U.ensureDir(render.OUT);
  U.ensureDir(cfg.P.cache);
  U.ensureDir(cfg.P.pending);
  server.listen(P, H, () => {
    U.logger.info('http', `考研数学万能通法归纳系统已启动：http://${H}:${P} （模式=${s.mode}，输入=${cfg.P.input}）`);
    try {
      const c = corpusMod.loadCached();
      U.logger.info('http', `语料就绪：${c.stats.total} 题 / ${c.chapters.length} 章 / 种子通法 ${c.seeds.length} 篇`);
    } catch (e) {
      U.logger.warn('http', '语料装配失败：' + e.message);
    }
  });
  return server;
}

if (require.main === module) start();
module.exports = { start, handle, overview, routes };
