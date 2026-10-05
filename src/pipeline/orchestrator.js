'use strict';
/** 元能力层 · 任务调度Skill：章节串行、逐题迭代的全流程编排 */
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');
const llm = require('../llm');
const corpusMod = require('../ingest/corpus');
const lib = require('../store/library');
const render = require('../store/render');
const essenceSim = require('../store/essence');
const seedSkill = require('../skills/seedImport');
const decSkill = require('../skills/problemDecompose');
const matchSkill = require('../skills/essenceMatch');
const orgSkill = require('../skills/chapterOrganize');
const qa = require('../skills/qa');
const registry = require('../skills/registry');

const D = {
  dec: path.join(cfg.P.data, 'decompositions.jsonl'),
  match: path.join(cfg.P.data, 'matches.jsonl'),
  qa: path.join(cfg.P.data, 'qa'),
  runs: cfg.P.runs,
  state: cfg.P.state,
};

function readState() {
  return U.readJson(D.state) || { chaptersDone: [], seedsImported: [], versions: {}, runs: [] };
}
function writeState(s) {
  U.writeJson(D.state, s);
}

class Ctx {
  constructor(meta) {
    this.id = meta.id || 'run-' + U.shortId(Date.now() + Math.random(), 8);
    this.startedAt = U.nowStamp();
    this.events = [];
    this.pending = [];
    this.usage = { calls: 0, tokensIn: 0, tokensOut: 0, ms: 0 };
    this.meta = meta;
    this.file = path.join(D.runs, this.id + '.jsonl');
    this.cancelled = false;
  }
  emit(type, msg, extra) {
    const e = { ts: U.nowStamp(), type, msg, extra: extra || null };
    this.events.push(e);
    U.appendJsonl(this.file, e);
    bus.emit('event', { run: this.id, ...e });
    U.logger.info('run', `[${this.id}] ${type}: ${msg}`);
    return e;
  }
  cancel() {
    this.cancelled = true;
  }
  finish(summary) {
    const rec = { id: this.id, mode: cfg.load().mode, startedAt: this.startedAt, endedAt: U.nowStamp(), usage: this.usage, summary, meta: this.meta };
    U.writeJson(path.join(D.runs, this.id + '.json'), rec);
    const st = readState();
    st.runs = (st.runs || []).filter((r) => r.id !== this.id).concat([rec]).slice(-40);
    writeState(st);
    bus.emit('run-end', rec);
    return rec;
  }
}

const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(200);

let current = null;
function getCurrent() {
  return current;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function loadDecomps() {
  return U.readJsonl(D.dec);
}
function saveDecomps(list) {
  const byId = new Map(list.map((d) => [d.problem_id, d]));
  U.writeFileAtomic(D.dec, Array.from(byId.values()).map((x) => JSON.stringify(x)).join('\n') + '\n');
}
function loadMatches() {
  return U.readJsonl(D.match);
}
function saveMatches(list) {
  const byId = new Map(list.map((d) => [d.problem_id, d]));
  U.writeFileAtomic(D.match, Array.from(byId.values()).map((x) => JSON.stringify(x)).join('\n') + '\n');
}

/** 统一处理 pending：返回 {data, pending:true} */
async function call(ctx, skill, messages, chapter, repair) {
  try {
    const r = await llm.invoke({ skill, messages, chapter, repair: repair !== false, onEvent: (ev) => {
      ctx.usage.calls++;
      ctx.usage.ms += ev.ms || 0;
      bus.emit('event', { run: ctx.id, ts: U.nowStamp(), type: 'llm-call', msg: `${skill} → ${ev.model}`, extra: ev });
    } });
    ctx.usage.tokensIn += (r.meta.tokensIn || 0);
    ctx.usage.tokensOut += (r.meta.tokensOut || 0);
    return { data: r.data };
  } catch (e) {
    if (e instanceof llm.AgentTaskPending) {
      ctx.pending.push({ key: e.task.key, skill: e.task.skill, chapter: e.task.chapter || chapter });
      ctx.emit('pending', `待智能体作答：${skill}（第${chapter || '-'}章）`, { key: e.task.key });
      return { pending: true };
    }
    ctx.emit('error', `${skill} 调用失败：${e.message.slice(0, 200)}`);
    return { error: e.message };
  }
}

/* =============== 1. 种子导入 =============== */
async function importSeeds(ctx, opts) {
  const corpus = corpusMod.loadCached();
  const st = readState();
  const force = opts && opts.force;
  const done = force ? [] : st.seedsImported || [];
  const todo = corpus.seeds.filter((s) => !done.includes(s.file));
  ctx.emit('stage', `种子模板导入：待处理 ${todo.length} / 共 ${corpus.seeds.length} 篇已有通法`);
  let created = 0;
  for (const seed of todo) {
    if (ctx.cancelled) break;
    const r = await call(ctx, 'seed-import', seedSkill.buildMessages(seed, cfg.load().chapterMap), null);
    if (r.pending || r.error) continue;
    const list = (r.data && r.data.templates) || [];
    for (const t of list) {
      const ch = cfg.load().chapterMap.find((c) => c.no === t.chapter_no) || null;
      const tpl = lib.create({
        name: t.name,
        kind: 'seed',
        discipline: ch ? ch.discipline : '高等数学',
        chapters: ch ? [ch.no] : [],
        chapterTitles: ch ? [ch.title] : [],
        essence: t.essence,
        scope: t.scope,
        steps: t.steps,
        branches: (t.branches || []).map((b) => lib.normalizeBranch(b)),
        boundaries: t.boundaries,
        exam_points: t.exam_points,
        surface_types: t.surface_types,
        examples: (t.examples || []).map((e) => ({ problem_id: 'seed', surface_type: e.title, essence: e.note, note: '种子例题' })),
        _reason: '种子模板导入（冷启动）',
        _skill: 'seed-import',
      });
      lib.upsert(tpl);
      created++;
    }
    st.seedsImported = U.uniq((st.seedsImported || []).concat([seed.file]));
    writeState(st);
    ctx.emit('seed', `《${seed.title}》→ ${list.length} 个种子模板`);
  }
  ctx.emit('stage', `种子导入完成：新增 ${created} 个模板，待作答 ${ctx.pending.length}`);
  return { created, pending: ctx.pending.length };
}

/* =============== 2. 章节流水线 =============== */
async function runChapter(ctx, chapterNo, opts) {
  const s = cfg.load();
  const corpus = corpusMod.loadCached();
  const chapter = s.chapterMap.find((c) => c.no === chapterNo);
  if (!chapter) throw new Error('未知章节：' + chapterNo);
  const problems = corpus.problems.filter((p) => p.chapterNo === chapterNo);
  ctx.emit('chapter-start', `第${chapterNo}章 ${chapter.title}：${problems.length} 题（有解析 ${problems.filter((p) => p.solution).length}）`);

  // ---- 2.1 拆解（批量推理，逐题记录）----
  const decAll = loadDecomps();
  const have = new Set(decAll.map((d) => d.problem_id));
  const todo = problems.filter((p) => !have.has(p.id) && p.stem && String(p.stem).length > 6);
  const batches = chunk(todo, s.batch.problemsPerCall);
  ctx.emit('stage', `单题拆解：${todo.length} 题 / ${batches.length} 批（每批 ${s.batch.problemsPerCall} 题）`);
  const gate = llm.gate(s.llm.concurrency || 1);
  const newDec = [];
  const p0 = ctx.pending.length;
  for (const b of batches) {
    if (ctx.cancelled) break;
    const r = await gate(() => call(ctx, 'problem-decompose', decSkill.buildMessages(b, chapter, corpus), chapterNo));
    if (r.pending || r.error) continue;
    newDec.push(...decSkill.apply(b, r.data));
  }
  if (newDec.length) {
    saveDecomps(decAll.concat(newDec));
    ctx.emit('stage', `本批新增拆解 ${newDec.length} 题（累计 ${loadDecomps().length}）`);
  }
  if (ctx.pending.length > p0) {
    ctx.emit('chapter-hold', `第${chapterNo}章拆解阶段存在 ${ctx.pending.length - p0} 项待作答，迭代阶段暂缓（避免模板库状态漂移）`);
    return { chapterNo, phase: 'decompose', pending: ctx.pending.length - p0, decomposed: newDec.length };
  }

  // ---- 2.2 本质匹配与迭代（章内按冻结快照，逐题串行应用）----
  const matchRows = loadMatches();
  const allDec = loadDecomps().filter((d) => d.chapterNo === chapterNo).sort((a, b) => String(a.tier || '').localeCompare(String(b.tier || '')) || (a.no || 0) - (b.no || 0));
  const matched = new Set(matchRows.map((m) => m.problem_id));
  const todoMatch = allDec.filter((d) => !matched.has(d.problem_id));
  const snapshot = lib.digest(); // 章内冻结，保证可重放
  const mbatches = chunk(todoMatch, s.batch.problemsPerCall);
  ctx.emit('stage', `本质匹配与模板迭代：${todoMatch.length} 题 / ${mbatches.length} 批`);
  const decMap = new Map(allDec.map((d) => [d.problem_id, d]));
  const results = [];
  const p1 = ctx.pending.length;
  for (const b of mbatches) {
    if (ctx.cancelled) break;
    const r = await gate(() => call(ctx, 'essence-match', matchSkill.buildMessages(b, chapterNo, snapshot), chapterNo));
    if (r.pending || r.error) continue;
    const items = r.data.items || [];
    for (const item of items) {
      const d = decMap.get(item.problem_id);
      if (!d) continue;
      const ap = matchSkill.applyDecision(
        { similarity: item.similarity, action: item.action, template_id: item.template_id, patch: item.patch },
        d,
        { chapterNo, discipline: chapter.discipline, chapterTitle: chapter.title }
      );
      results.push({ problem_id: d.problem_id, chapterNo, ...ap, rationale: item.rationale, surface_type: d.surface_type });
    }
  }
  const matchPending = ctx.pending.length - p1;
  if (matchPending) {
    ctx.emit('chapter-hold', `第${chapterNo}章匹配阶段待作答 ${matchPending} 项；本轮不进入合并与质检，回填后自动续跑`);
  }
  saveMatches(matchRows.concat(results));
  const decIndex = new Map(loadDecomps().map((d) => [d.problem_id, d]));
  const matchIndex = new Map(matchRows.concat(results).map((m) => [m.problem_id, m]));
  const tally = results.reduce((a, x) => {
    a[x.action] = (a[x.action] || 0) + 1;
    return a;
  }, {});
  ctx.emit('stage', `迭代动作统计：${JSON.stringify(tally)}`);

  // ---- 2.3 章内合并去重 / 2.4 扩展 Skill / 2.5 质量校验（仅在匹配阶段全部命中缓存时执行，保证可重放）----
  let qaReports = null;
  if (!matchPending) {
    await organizeChapter(ctx, chapterNo);
    await runGeneratedHooks(ctx, chapterNo);
    qaReports = await runQA(ctx, chapterNo);
  }

  // ---- 2.6 章节产物 ----
  const ts = lib.active().filter((t) => (t.chapters || []).includes(chapterNo));
  const version = bumpChapterVersion(chapterNo);
  const cov = coverageOf(chapterNo, ts);
  const chProblems = problems;
  render.chapterLibraryMd(
    chapter,
    ts,
    version,
    {
      problemTotal: chProblems.length,
      decomposed: allDec.length,
      skippedNoSolution: chProblems.filter((p) => !p.solution).length,
      coverageRate: cov.rate,
      covered: cov.covered,
      total: cov.total,
      actions: tally,
    }
  );
  render.decompositionMd(chapter, allDec.map((d) => Object.assign({}, d, decFromMatch(d.problem_id, matchIndex))));
  lib.markChapterDone(chapterNo);
  const st = readState();
  st.versions['ch' + chapterNo] = version;
  // 章节完成标记要同时落运行态：server.js 的 /api/overview 用 state.chaptersDone 判网页端「本章已完成」
  // （lib.markChapterDone 落的是库态，两处都得有；数字数组不能过 uniq，见 HANDOFF 坑 30）
  st.chaptersDone = Array.from(new Set((st.chaptersDone || []).map(Number).concat([Number(chapterNo)]))).sort((a, b) => a - b);
  st.chapterStats = st.chapterStats || {};
  st.chapterStats[chapterNo] = { problems: chProblems.length, decomposed: allDec.length, templates: ts.length, coverage: cov.rate, pending: ctx.pending.length };
  writeState(st);
  ctx.emit('chapter-end', `第${chapterNo}章完成：一级通法 ${ts.length} 个，考点覆盖 ${(cov.rate * 100).toFixed(0)}%（确定性 ${cov.deterministic} + 语义判定 ${cov.semantic}）/ 共 ${cov.total}，版本 ${version}`);
  return { chapterNo, templates: ts.length, actions: tally, coverage: cov.rate, version, pending: ctx.pending.length, qa: qaReports };
}

function decFromMatch(pid, idx) {
  const m = (idx && idx.get(pid)) || loadMatches().find((x) => x.problem_id === pid) || {};
  return { matched_template_id: m.template_id, similarity: m.similarity, action: m.action };
}

function bumpChapterVersion(chapterNo) {
  const st = readState();
  const cur = st.versions['ch' + chapterNo] || 'v0.0';
  const next = lib.bump(cur, 'major');
  st.versions['ch' + chapterNo] = next;
  writeState(st);
  return next === 'v0.0' ? 'v0.1' : next;
}

async function organizeChapter(ctx, chapterNo) {
  const ts = lib.active().filter((t) => (t.chapters || []).includes(chapterNo));
  if (ts.length < 2) return false;
  if (isOrganized('ch' + chapterNo)) return false;
  const r = await call(ctx, 'chapter-organize', orgSkill.buildMessages(ts, `第${chapterNo}章章内合并去重`), chapterNo);
  if (r.pending || r.error) return true;
  applyOrganize(ctx, r.data, `第${chapterNo}章`);
  markOrganized('ch' + chapterNo);
  return false;
}

/** 需求口径：章内合并每章一次、跨章合并每 5 章一次，重跑同一章不得再次触发 */
function markOrganized(key) {
  const st = readState();
  st.organized = st.organized || {};
  st.organized[key] = U.nowStamp();
  writeState(st);
}
function isOrganized(key) {
  const st = readState();
  return !!(st.organized && st.organized[key]);
}

function applyOrganize(ctx, data, label) {
  const merges = (data && data.merges) || [];
  for (const m of merges) {
    const st = lib.read();
    const keep = st.templates.find((t) => t.id === m.keep_id && t.status === 'active');
    if (!keep) continue;
    const absorbed = (m.absorb_ids || []).map((id) => st.templates.find((t) => t.id === id)).filter(Boolean);
    // 同一合并重复回放时跳过：否则每次重跑都重新 bump 版本，QA 工作包 key 永不稳定，pending 无法收敛
    if (absorbed.length && absorbed.every((a) => a.status === 'merged' && a.merged_into === keep.id)) continue;
    const t = JSON.parse(JSON.stringify(keep));
    for (const a of absorbed) {
      t.branches = t.branches.concat(a.branches || []);
      if (a.branches && a.branches.length === 0) {
        t.branches.push(lib.normalizeBranch({ name: a.name, trigger: (a.surface_types || []).join('；'), steps: a.steps || [], surface_types: a.surface_types || [], boundary: (a.boundaries.invalid || []).join('；') }));
      }
      t.covered_problem_ids = U.uniq(t.covered_problem_ids.concat(a.covered_problem_ids || []));
      t.examples = t.examples.concat(a.examples || []);
      t.exam_points = U.uniq(t.exam_points.concat(a.exam_points || []));
      t.surface_types = U.uniq(t.surface_types.concat(a.surface_types || []));
      t.boundaries.applicable = U.uniq(t.boundaries.applicable.concat(a.boundaries.applicable || []));
      t.boundaries.invalid = U.uniq(t.boundaries.invalid.concat(a.boundaries.invalid || []));
      a.status = 'merged';
      a.merged_into = t.id;
      a.history.push({ version: t.version, at: U.nowStamp(), action: 'merged-into', reason: `被 ${t.id} 吸收：${m.reason || ''}`, skill: 'chapter-organize' });
    }
    if (m.final_essence) t.essence = m.final_essence;
    if (m.final_name) t.name = m.final_name;
    if (m.final_steps && m.final_steps.length) t.steps = m.final_steps;
    if (m.final_branches && m.final_branches.length) t.branches = m.final_branches.map((b) => lib.normalizeBranch(b));
    if (m.final_boundaries) t.boundaries = { applicable: m.final_boundaries.applicable || t.boundaries.applicable, invalid: m.final_boundaries.invalid || t.boundaries.invalid };
    t.chapters = U.uniq(t.chapters.concat(absorbed.flatMap((a) => a.chapters || [])));
    const titles = t.chapters.map((n) => (cfg.load().chapterMap.find((c) => c.no === n) || {}).title).filter(Boolean);
    t.chapterTitles = titles;
    t.version = lib.bump(t.version, 'major');
    t.updated_at = U.nowStamp();
    t.history.push({ version: t.version, at: U.nowStamp(), action: 'merge', reason: `${label}合并：吸收 ${absorbed.map((a) => a.id).join('、')}｜${m.reason || ''}`, skill: 'chapter-organize' });
    lib.upsert(t);
    lib.replaceMany(st.templates.map((x) => (x.id === t.id ? t : x)));
    ctx.emit('merge', `${label}：${absorbed.map((a) => a.name).join(' + ')} → ${t.name}`, { keep: t.id, absorbed: absorbed.map((a) => a.id) });
  }
  for (const rn of (data && data.renames) || []) {
    const t = lib.byId(rn.id);
    if (t && rn.name && t.name !== rn.name) {
      const nt = Object.assign({}, t, { name: rn.name, version: lib.bump(t.version, 'minor'), updated_at: U.nowStamp() });
      nt.history = (t.history || []).concat([{ version: nt.version, at: nt.updated_at, action: 'rename', reason: rn.reason || '层级梳理更名', skill: 'chapter-organize' }]);
      lib.upsert(nt);
    }
  }
  for (const h of (data && data.hierarchy) || []) {
    const t = lib.byId(h.id);
    if (t) lib.upsert(Object.assign({}, t, { level: h.level || 1, position_note: h.note || '' }));
  }
  if (data && data.chapter_summary) ctx.emit('organize', `${label}组织结论：${data.chapter_summary}`);
  return merges.length;
}

async function runGeneratedHooks(ctx, chapterNo) {
  for (const m of registry.listGenerated()) {
    try {
      const mod = registry.loadGenerated(m);
      if (mod.hook !== 'post-chapter' || typeof mod.buildMessages !== 'function') continue;
      const ts = lib.active().filter((t) => (t.chapters || []).includes(chapterNo));
      const r = await call(ctx, m, mod.buildMessages({ chapter: cfg.load().chapterMap.find((c) => c.no === chapterNo), templates: ts, payload: ts.map((t) => ({ id: t.id, name: t.name, branches: t.branches })) }), chapterNo, false);
      if (r.pending || r.error) continue;
      ctx.emit('ext-skill', `扩展 Skill「${m}」执行完成`, r.data);
    } catch (e) {
      ctx.emit('ext-skill-error', `${m} 失败：${e.message.slice(0, 160)}`);
    }
  }
}

/* =============== 3. 质量校验 =============== */
async function runQA(ctx, chapterNo, skipIfPending) {
  const corpus = corpusMod.loadCached();
  const problemsById = new Map(corpus.problems.map((p) => [p.id, p]));
  const chapter = cfg.load().chapterMap.find((c) => c.no === chapterNo);
  const ts = lib.active().filter((t) => (t.chapters || []).includes(chapterNo));
  const out = {};

  // 三道校验都按同一快照分批：某批待作答只置 pending 并继续排空后续批次（未命中的批次不写库，快照不漂移，重放时各批 key 恒定）
  // 3.1 数学等价校验（代数/数值/恒等变形）
  const eqResults = [];
  let eqPending = false;
  for (const b of chunk(ts, 4)) {
    const r = await call(ctx, 'math-equivalence', qa.eqMessages(b, corpus, chapter, problemsById), chapterNo);
    if (r.pending || r.error) {
      eqPending = true;
      continue;
    }
    eqResults.push(...((r.data && r.data.results) || []));
  }
  out.equivalence = { results: eqResults };
  if (eqPending) out.equivalence.pending = true;
  if (eqResults.length) {
    for (const res of eqResults) {
      if (res.verdict === 'fail' && Array.isArray(res.corrected_steps) && res.corrected_steps.length) {
        const t = lib.byId(res.template_id);
        if (t && JSON.stringify(t.steps) !== JSON.stringify(res.corrected_steps)) {
          const nt = Object.assign({}, t, { steps: res.corrected_steps, version: lib.bump(t.version, 'major'), updated_at: U.nowStamp() });
          nt.history = (t.history || []).concat([{ version: nt.version, at: nt.updated_at, action: 'equivalence-fix', reason: `数学等价校验纠错：${(res.issues || []).map((i) => i.detail).join('；').slice(0, 120)}`, skill: 'math-equivalence' }]);
          lib.upsert(nt);
          ctx.emit('qa-fix', `${res.template_id} 步骤被等价校验纠正`);
        }
      }
    }
    render.qaMd(`第${pad(chapterNo)}章-数学等价校验`, qaReportMd('数学等价', chapter, out.equivalence, ts));
  }

  // 3.2 考点覆盖校验（确定性匹配 + 语义兜底）
  const lects = (chapter.lectures || []).map((k) => corpus.lectures[k]).filter(Boolean);
  const points = lects.reduce((a, l) => a.concat(l.examPoints.map((p) => ({ point: p.point, lecture: l.key }))), []);
  const pre = qa.covPreMatch(points, ts);
  out.coverage = { covered: pre.covered.slice(), residual: pre.residual.map((p) => p.point), llm: [] };
  if (pre.residual.length) {
    for (const b of chunk(pre.residual, 12)) {
      const r = await call(ctx, 'syllabus-coverage', qa.covMessages(chapter, b, ts), chapterNo);
      if (r.pending || r.error) {
        out.coverage.pending = true;
        continue;
      }
      const items = (r.data && r.data.items) || [];
      out.coverage.llm.push(...items);
      for (const it of items) {
        if (it.covered && it.template_id) {
          const t = lib.byId(it.template_id);
          if (t) {
            t.exam_points = U.uniq(t.exam_points.concat([it.exam_point_add || it.point]));
            lib.upsert(t);
            out.coverage.covered.push({ point: it.point, template_id: it.template_id, sim: null, by: 'llm' });
          }
        }
      }
    }
  }
  out.coverage.total = points.length;
  out.coverage.rate = points.length ? out.coverage.covered.length / points.length : 0;
  out.coverage.uncovered = points.map((p) => p.point).filter((pt) => !out.coverage.covered.some((c) => c.point === pt));
  render.qaMd(`第${pad(chapterNo)}章-考点覆盖校验`, coverageReportMd(chapter, out.coverage));

  // 3.3 边界一致性校验
  const bdyResults = [];
  let bdyPending = false;
  for (const b of chunk(ts, 6)) {
    const r = await call(ctx, 'boundary-consistency', qa.bdyMessages(b), chapterNo);
    if (r.pending || r.error) {
      bdyPending = true;
      continue;
    }
    bdyResults.push(...((r.data && r.data.results) || []));
  }
  out.boundary = { results: bdyResults };
  if (bdyPending) out.boundary.pending = true;
  if (bdyResults.length) {
    for (const res of bdyResults) {
      const t = lib.byId(res.template_id);
      if (!t || !(res.conflicts || []).length) continue;
      const nt = JSON.parse(JSON.stringify(t));
      for (const c of res.conflicts) {
        if (c.patched_applicable && c.patched_applicable.length) nt.boundaries.applicable = c.patched_applicable;
        if (c.patched_invalid && c.patched_invalid.length) nt.boundaries.invalid = c.patched_invalid;
        for (const pt of c.patched_branch_triggers || []) {
          const br = nt.branches.find((x) => x.name === pt.name);
          if (br) br.trigger = pt.trigger;
        }
      }
      // 补丁与当前内容一致时不再写库：否则每次回放都重新 bump 版本，等价校验的 key 永不稳定，pending 无法收敛
      if (boundaryUnchanged(t, nt)) {
        ctx.emit('qa-skip', `${res.template_id} 边界补丁与现有内容一致，跳过（避免版本空转）`);
        continue;
      }
      nt.version = lib.bump(t.version, 'minor');
      nt.updated_at = U.nowStamp();
      nt.history = t.history.concat([{ version: nt.version, at: nt.updated_at, action: 'boundary-fix', reason: `边界一致性消歧：${res.conflicts.map((c) => c.detail).join('；').slice(0, 120)}`, skill: 'boundary-consistency' }]);
      lib.upsert(nt);
    }
    render.qaMd(`第${pad(chapterNo)}章-边界一致性校验`, boundaryReportMd(chapter, out.boundary, ts));
  }

  U.ensureDir(D.qa);
  U.writeJson(path.join(D.qa, `ch${pad(chapterNo)}.json`), { chapterNo, at: U.nowStamp(), report: out });
  ctx.emit('qa', `第${chapterNo}章质检完成：等价 ${verdictOf(out.equivalence)} / 覆盖 ${(out.coverage.rate * 100).toFixed(0)}% / 边界 ${verdictOf(out.boundary)}`);
  return out;
}

function boundaryUnchanged(t, nt) {
  const key = (x) => JSON.stringify([x.boundaries.applicable, x.boundaries.invalid, (x.branches || []).map((b) => [b.name, b.trigger])]);
  return key(t) === key(nt);
}

function verdictOf(r) {
  if (!r || r.pending) return '待作答';
  const res = r.results || [];
  if (!res.length) return '无对象';
  const f = res.filter((x) => x.verdict === 'fail').length;
  const w = res.filter((x) => x.verdict === 'warn').length;
  return f ? `${f} fail` : w ? `${w} warn` : 'pass';
}

function qaReportMd(kind, chapter, rep, ts) {
  const tables = [
    {
      title: '逐模板结论',
      headerLine: '| 模板 | 结论 | 代数等价 | 数值等价 | 逻辑等价 | 证据 |',
      divider: '| --- | --- | --- | --- | --- | --- |',
      rows: (rep.results || []).map((r) => `| ${r.template_id} ${(byName(ts, r.template_id) || '').slice(0, 16)} | ${r.verdict} | ${r.algebraic || '-'} | ${r.numeric || '-'} | ${r.logical || '-'} | ${String(r.evidence || '').replace(/\|/g, '/').slice(0, 90)} |`),
    },
  ];
  const issues = [];
  for (const r of rep.results || []) for (const i of r.issues || []) issues.push({ severity: i.severity, target: r.template_id, type: i.type, detail: i.detail, fix: i.fix });
  return { summary: `第${chapter.no}章 ${chapter.title} · ${kind}：共校验 ${(rep.results || []).length} 个模板，问题 ${issues.length} 项。`, tables, issues };
}

function coverageReportMd(chapter, cov) {
  return {
    summary: `第${chapter.no}章 ${chapter.title} 考点覆盖率 ${(cov.rate * 100).toFixed(1)}%（${cov.covered.length}/${cov.total}）。其中确定性语义匹配 ${cov.covered.filter((c) => c.by === 'deterministic').length} 项，大模型语义判定 ${cov.covered.filter((c) => c.by === 'llm').length} 项。`,
    tables: [
      { title: '已覆盖考点', headerLine: '| 考点 | 命中通法 | 相似度 | 方式 |', divider: '| --- | --- | --- | --- |', rows: cov.covered.map((c) => `| ${c.point} | ${c.template_id} | ${c.sim == null ? '语义' : c.sim} | ${c.by} |`) },
      { title: '未覆盖考点（需继续补题迭代）', headerLine: '| 考点 | 建议 |', divider: '| --- | --- |', rows: cov.uncovered.map((p) => `| ${p} | ${(cov.llm.find((x) => x.point === p) || {}).missing_note || '需补充该考点相关题目后迭代'} |`) },
    ],
    issues: cov.uncovered.map((p) => ({ severity: 'medium', target: `第${chapter.no}章`, type: 'coverage-gap', detail: p, fix: '补充题目并增量迭代' })),
  };
}

function boundaryReportMd(chapter, rep, ts) {
  const issues = [];
  for (const r of rep.results || []) for (const c of r.conflicts || []) issues.push({ severity: c.kind === 'contradiction' ? 'high' : 'medium', target: `${r.template_id}${(c.targets || []).length ? '/' + c.targets.join(',') : ''}`, type: c.kind, detail: c.detail, fix: c.resolution });
  return {
    summary: `第${chapter.no}章 ${chapter.title} 边界一致性：校验 ${(rep.results || []).length} 个模板，发现冲突 ${issues.length} 项（已按消歧方案自动修补边界）。`,
    tables: [
      { title: '模板边界概览', headerLine: '| 模板 | 适用前提 | 失效场景 | 分支 |', divider: '| --- | --- | --- | --- |', rows: ts.map((t) => `| ${t.id} | ${(t.boundaries.applicable || []).join('；').slice(0, 60)} | ${(t.boundaries.invalid || []).join('；').slice(0, 60)} | ${(t.branches || []).length} |`) },
    ],
    issues,
  };
}

function byName(ts, id) {
  const t = ts.find((x) => x.id === id);
  return t ? t.name : '';
}
function pad(n) {
  return String(n).padStart(2, '0');
}

/** 覆盖口径 = 确定性预匹配 ∪ 质检已判覆盖：章节产物与手册若只算字面命中，会把大模型判过并写回考点的条目漏报成未覆盖 */
function coverageOf(chapterNo, ts) {
  const corpus = corpusMod.loadCached();
  const chapter = cfg.load().chapterMap.find((c) => c.no === chapterNo);
  const points = (chapter.lectures || []).map((k) => corpus.lectures[k]).filter(Boolean).reduce((a, l) => a.concat(l.examPoints), []);
  const det = qa.covPreMatch(points, ts).covered;
  const judged = qaJudgedPoints(chapterNo).filter((p) => !det.some((d) => d.point === p));
  const covered = det.concat(judged.map((p) => ({ point: p, by: 'llm' })));
  const uncovered = points.map((p) => p.point).filter((pt) => !covered.some((c) => c.point === pt));
  return { total: points.length, covered: covered.length, deterministic: det.length, semantic: judged.length, rate: points.length ? covered.length / points.length : 0, uncovered };
}

/** 考点覆盖校验落盘的判定结果（未跑质检时返回空，口径退回纯确定性匹配） */
function qaJudgedPoints(chapterNo) {
  const rep = U.readJson(path.join(D.qa, `ch${pad(chapterNo)}.json`));
  const cov = rep && rep.report && rep.report.coverage;
  return ((cov && cov.covered) || []).map((c) => c.point);
}

/* =============== 4. 跨章共性合并 =============== */
async function crossMerge(ctx, chapterNos) {
  const key = 'cross-' + chapterNos[0] + '-' + chapterNos[chapterNos.length - 1];
  if (isOrganized(key)) return;
  const ts = lib.active().filter((t) => (t.chapters || []).some((c) => chapterNos.includes(c)));
  if (ts.length < 3) return;
  ctx.emit('stage', `跨章节共性合并：涉及第 ${chapterNos.join('、')} 章的 ${ts.length} 个模板`);
  const r = await call(ctx, 'chapter-organize', orgSkill.buildMessages(ts, '跨 5 章共性合并（本质相同的跨章节模板合并，不同场景作为分支）'), null);
  if (r.pending || r.error) return;
  applyOrganize(ctx, r.data, '跨章');
  markOrganized(key);
}

/* =============== 5. 全局收敛 =============== */
async function converge(ctx) {
  const c = cfg.load().convergence;
  let ts = lib.active();
  ctx.emit('stage', `全局收敛：当前一级通法 ${ts.length} 个，目标 ${c.firstLevelTargetMin}~${c.firstLevelTargetMax} 个`);
  let rounds = 0;
  while (ts.length > c.firstLevelTargetMax && rounds < 6) {
    rounds++;
    const r = await call(ctx, 'chapter-organize', orgSkill.buildMessages(ts, `全局本质合并（第 ${rounds} 轮，目标压到 ${c.firstLevelTargetMax} 个以内）`), null);
    if (r.pending || r.error) break;
    const n = applyOrganize(ctx, r.data, `全局第${rounds}轮`);
    if (!n) break;
    ts = lib.active();
  }
  // 兜底：本质重合度 ≥0.75 的模板强制降级为分支（保证收敛可控）
  const forced = forceMerge(ctx, ts, c.firstLevelTargetMax);
  ctx.emit('converge', `收敛结束：一级通法 ${lib.active().length} 个（自动强制合并 ${forced} 组）`);
  return lib.active().length;
}

function forceMerge(ctx, ts, target) {
  let merged = 0;
  let list = ts.slice();
  while (list.length > target) {
    const pairs = essenceSim.matrix(list).filter((p) => p.sa >= 0.7);
    if (!pairs.length) break;
    const p = pairs[0];
    const keep = list.find((t) => t.id === p.a);
    const absorb = list.find((t) => t.id === p.b);
    if (!keep || !absorb) break;
    applyOrganize(ctx, { merges: [{ keep_id: keep.id, absorb_ids: [absorb.id], reason: `本质重合度 ${p.sa}，强制降级为二级分支`, final_essence: keep.essence }] }, '全局收敛');
    list = lib.active();
    merged++;
  }
  return merged;
}

/* =============== 6. 终稿输出 =============== */
function buildHandbook() {
  const corpus = corpusMod.loadCached();
  const s = cfg.load();
  const chapters = [];
  let tot = 0,
    cov = 0;
  for (const c of s.chapterMap) {
    const o = coverageOf(c.no, lib.active().filter((t) => (t.chapters || []).includes(c.no)));
    chapters.push({ no: c.no, title: c.title, ...o });
    tot += o.total;
    cov += o.covered;
  }
  const ts = lib.active();
  const matchedProblems = loadMatches().filter((m) => m.template_id || m.action);
  const problemTotal = corpus.problems.length;
  const typeRate = problemTotal ? matchedProblems.length / problemTotal : 0;
  const coverage = { chapters, total: tot, covered: cov, rate: tot ? cov / tot : 0, typeRate };
  const file = render.handbookMd({ coverage });
  render.qaMd('全局收敛报告', convergeReport(coverage, ts));
  return { file, coverage };
}

function convergeReport(coverage, ts) {
  const c = cfg.load().convergence;
  return {
    summary: `一级通法 ${ts.length} 个（目标 ${c.firstLevelTargetMin}~${c.firstLevelTargetMax}）；考点覆盖率 ${(coverage.rate * 100).toFixed(1)}%；题目归属率（题型覆盖率）${(coverage.typeRate * 100).toFixed(1)}%；二级分支合计 ${ts.reduce((a, t) => a + (t.branches || []).length, 0)} 个。`,
    tables: [
      { title: '一级通法一览', headerLine: '| 编号 | 名称 | 版本 | 学科 | 本质 | 覆盖题数 | 分支 |', divider: '| --- | --- | --- | --- | --- | --- | --- |', rows: ts.map((t) => `| ${t.id} | ${t.name} | ${t.version} | ${t.discipline} | ${String(t.essence).replace(/\|/g, '/').slice(0, 60)} | ${(t.covered_problem_ids || []).length} | ${(t.branches || []).length} |`) },
      { title: '章节覆盖', headerLine: '| 章节 | 考点数 | 已覆盖 | 覆盖率 |', divider: '| --- | --- | --- | --- |', rows: coverage.chapters.map((x) => `| 第${x.no}章 ${x.title} | ${x.total} | ${x.covered} | ${(x.rate * 100).toFixed(0)}% |`) },
    ],
    issues: coverage.chapters.filter((x) => x.rate < 1).map((x) => ({ severity: 'medium', target: `第${x.no}章`, type: 'coverage-gap', detail: `未覆盖考点 ${x.uncovered.length} 个：${x.uncovered.slice(0, 5).join('、')}`, fix: '继续按章节增量补题迭代' })),
  };
}

/* =============== 7. 顶层调度 =============== */
async function start(opts) {
  if (current && !current.cancelled && !current.finished) throw new Error('已有运行中的任务：' + current.id);
  const ctx = new Ctx(opts);
  current = ctx;
  try {
    const stages = opts.stages || ['seed', 'chapter', 'converge'];
    let summary = {};
    if (stages.includes('seed')) summary.seed = await importSeeds(ctx, opts);
    for (const no of opts.chapters || []) {
      if (ctx.cancelled) break;
      const r = await runChapter(ctx, no, opts);
      summary['ch' + no] = r;
      const c = cfg.load().convergence;
      if (no % c.crossMergeEveryChapters === 0) {
        const from = Math.max(1, no - c.crossMergeEveryChapters + 1);
        await crossMerge(ctx, range(from, no));
      }
    }
    if (stages.includes('converge') && (opts.chapters || []).length) {
      summary.firstLevelCount = await converge(ctx);
      summary.handbook = buildHandbook();
    }
    summary.pendingCount = ctx.pending.length;
    ctx.finished = true;
    const rec = ctx.finish(summary);
    return { ...rec, summary };
  } catch (e) {
    ctx.finished = true;
    ctx.emit('fatal', e.message);
    throw e;
  } finally {
    current = null;
  }
}

function range(a, b) {
  const o = [];
  for (let i = a; i <= b; i++) o.push(i);
  return o;
}

module.exports = { start, Ctx, bus, getCurrent, readState, writeState, loadDecomps, loadMatches, coverageOf, buildHandbook, importSeeds, runChapter, converge, chunk, applyOrganize, markOrganized, isOrganized, boundaryUnchanged, D };
