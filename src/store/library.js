'use strict';
/** 模板库：通法对象的持久化、版本迭代、Markdown 渲染（学科→章节→通法三级） */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');

const DIR = cfg.P.library;
const FILE = path.join(DIR, 'library.json');

function blank() {
  return { updatedAt: null, templates: [], chaptersDone: [], history: [] };
}

function read() {
  return U.readJson(FILE) || blank();
}
function write(state) {
  state.updatedAt = U.nowStamp();
  U.writeJson(FILE, state);
  mirrorJsonl(state);
  return state;
}

/** 同步一份 JSONL 便于人工 diff / 追加审阅 */
function mirrorJsonl(state) {
  const lines = state.templates.map((t) => JSON.stringify(t));
  U.writeFileAtomic(path.join(DIR, 'templates.jsonl'), lines.join('\n') + '\n');
}

function nextId(discipline, kind) {
  const prefix = discipline === '线性代数' ? 'T-LA' : discipline === '概率论' ? 'T-PR' : 'T-HS';
  const n = state_seq(prefix);
  return `${prefix}-${String(n).padStart(2, '0')}-${kind === 'seed' ? 'S' : 'I'}`;
}
function state_seq(prefix) {
  const st = U.readJson(path.join(DIR, 'seq.json')) || {};
  st[prefix] = (st[prefix] || 0) + 1;
  U.writeJson(path.join(DIR, 'seq.json'), st);
  return st[prefix];
}

function bump(version, kind) {
  const m = /^v(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version || 'v0.1');
  if (!m) return 'v0.1';
  const [, a, b, c] = m;
  if (kind === 'major') return `v${+a}.${+b + 1}`;
  if (kind === 'minor') return `v${+a}.${+b}.${+(c || 0) + 1}`;
  return version || 'v0.1';
}

function normalize(t) {
  t.essence = (t.essence || '').trim();
  t.steps = Array.isArray(t.steps) ? t.steps.filter(Boolean) : [];
  t.branches = Array.isArray(t.branches) ? t.branches : [];
  t.boundaries = t.boundaries && typeof t.boundaries === 'object' ? t.boundaries : { applicable: [], invalid: [] };
  t.boundaries.applicable = t.boundaries.applicable || [];
  t.boundaries.invalid = t.boundaries.invalid || [];
  t.exam_points = Array.isArray(t.exam_points) ? t.exam_points : [];
  t.surface_types = Array.isArray(t.surface_types) ? t.surface_types : [];
  t.examples = Array.isArray(t.examples) ? t.examples : [];
  t.covered_problem_ids = Array.isArray(t.covered_problem_ids) ? t.covered_problem_ids : [];
  t.level = t.level || 1;
  t.status = t.status || 'active';
  return t;
}

function create(partial) {
  const t = normalize(
    Object.assign(
      {
        id: nextId(partial.discipline || '高等数学', partial.kind || 'induced'),
        name: '未命名通法',
        version: 'v0.1',
        kind: 'induced',
        discipline: '高等数学',
        chapters: [],
        chapterTitles: [],
        essence: '',
        scope: '',
        steps: [],
        branches: [],
        boundaries: { applicable: [], invalid: [] },
        exam_points: [],
        surface_types: [],
        examples: [],
        covered_problem_ids: [],
        history: [],
      },
      partial
    )
  );
  t.created_at = U.nowStamp();
  t.updated_at = U.nowStamp();
  t.history = [{ version: t.version, at: t.created_at, action: 'create', reason: partial._reason || '新建', skill: partial._skill || 'system' }];
  return t;
}

const uniq = (a) => Array.from(new Set((a || []).filter(Boolean).map((x) => String(x).trim())));

/** 合并一道题的拆解结果到已有模板（小版本/中版本升级） */
function applyDecomposition(existing, dec, opts) {
  const o = opts || {};
  const t = JSON.parse(JSON.stringify(existing));
  const before = JSON.stringify(t);
  const kind = o.kind || 'minor';

  t.surface_types = uniq(t.surface_types.concat([dec.surface_type]));
  t.exam_points = uniq(t.exam_points.concat(dec.exam_points || []));
  // 模板吸收了某章的题目，就必须登记该章：否则章节视角（覆盖校验、章内组织包、手册分章卡片）看不到这些题与考点
  // 注意 chapters 是数字数组，不能过 uniq（它会 stringify），否则 (t.chapters||[]).includes(chapterNo) 全部失配
  if (dec.chapterNo && !(t.chapters || []).includes(dec.chapterNo)) {
    t.chapters = (t.chapters || []).concat([dec.chapterNo]);
    if (dec.chapterTitle && !(t.chapterTitles || []).includes(dec.chapterTitle)) {
      t.chapterTitles = (t.chapterTitles || []).concat([dec.chapterTitle]);
    }
  }
  t.boundaries.applicable = uniq(t.boundaries.applicable.concat(dec.boundaries ? dec.boundaries.applicable || [] : []));
  t.boundaries.invalid = uniq(t.boundaries.invalid.concat(dec.boundaries ? dec.boundaries.invalid || [] : []));
  if (o.refineSteps && Array.isArray(o.refineSteps) && o.refineSteps.length) t.steps = o.refineSteps;
  if (o.essencePolish && String(o.essencePolish).length > String(t.essence).length) t.essence = o.essencePolish;
  if (o.branch) {
    const idx = t.branches.findIndex((b) => b.name === o.branch.name);
    if (idx >= 0) {
      t.branches[idx] = Object.assign({}, t.branches[idx], o.branch, {
        surface_types: uniq((t.branches[idx].surface_types || []).concat(o.branch.surface_types || [])),
        steps: o.branch.steps && o.branch.steps.length ? o.branch.steps : t.branches[idx].steps,
      });
    } else t.branches.push(normalizeBranch(o.branch));
  }
  if (dec.problem_id && !t.covered_problem_ids.includes(dec.problem_id)) {
    t.covered_problem_ids.push(dec.problem_id);
    t.examples = t.examples.filter((e) => e.problem_id !== dec.problem_id);
    t.examples.push({
      problem_id: dec.problem_id,
      surface_type: dec.surface_type,
      essence: dec.essence,
      note: o.example_note || '',
      excerpt: (dec.stem_excerpt || '').slice(0, 160),
    });
    if (t.examples.length > 12) t.examples = t.examples.slice(-12);
  }
  const changed = before !== JSON.stringify(t);
  if (changed && o.bump !== false) {
    t.version = bump(t.version, kind);
    t.history.push({ version: t.version, at: U.nowStamp(), action: o.action || 'refine', reason: o.reason || '增量迭代：新题并入', skill: o.skill || 'essence-match' });
  }
  t.updated_at = U.nowStamp();
  return normalize(t);
}

function normalizeBranch(b) {
  return {
    id: b.id || 'B-' + U.shortId(b.name || Math.random(), 6),
    name: b.name || '',
    trigger: b.trigger || '',
    steps: b.steps || [],
    surface_types: b.surface_types || [],
    boundary: b.boundary || '',
  };
}

function upsert(t) {
  const st = read();
  const i = st.templates.findIndex((x) => x.id === t.id);
  if (i >= 0) st.templates[i] = normalize(t);
  else st.templates.push(normalize(t));
  return write(st);
}

function replaceMany(list) {
  const st = read();
  const map = new Map(st.templates.map((t) => [t.id, t]));
  for (const t of list) map.set(t.id, normalize(t));
  st.templates = Array.from(map.values());
  return write(st);
}

function remove(id) {
  const st = read();
  st.templates = st.templates.filter((t) => t.id !== id);
  return write(st);
}

function all() {
  return read().templates;
}
function active() {
  return all().filter((t) => t.status === 'active');
}
function byId(id) {
  return all().find((t) => t.id === id) || null;
}
function markChapterDone(no) {
  const st = read();
  // 章节号必须保持数字：server.js 用 (st.chaptersDone||[]).includes(c.no)（数字）判「本章已完成」，
  // 过 uniq 会被 stringify 成 ["1","2"] 而永不命中
  const list = (st.chaptersDone || []).map(Number).concat([Number(no)]);
  st.chaptersDone = Array.from(new Set(list)).sort((a, b) => a - b);
  return write(st);
}

/** 给提示词用的紧凑摘要：控制 token */
function digest(scope) {
  const list = active().filter((t) => {
    if (!scope) return true;
    if (scope.chapter != null && !(t.chapters || []).includes(scope.chapter)) return false;
    return true;
  });
  return list
    .map((t) => {
      const br = (t.branches || []).map((b) => `${b.name}（触发：${b.trigger || '-'}）`).join('；');
      return [
        `#${t.id} | ${t.name} | ${t.version} | 本质：${t.essence}`,
        `  适用：${t.scope || '-'}`,
        `  边界：可用[${(t.boundaries.applicable || []).join('/') || '-'}] 失效[${(t.boundaries.invalid || []).join('/') || '-'}]`,
        br ? `  分支：${br}` : null,
        `  已覆盖题数：${(t.covered_problem_ids || []).length}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function stats() {
  const ts = active();
  const level1 = ts.filter((t) => t.level === 1);
  const covered = new Set();
  ts.forEach((t) => (t.covered_problem_ids || []).forEach((p) => covered.add(p)));
  const branches = ts.reduce((a, t) => a + (t.branches || []).length, 0);
  return {
    templates: ts.length,
    level1: level1.length,
    level2: ts.filter((t) => t.level !== 1).length,
    branches,
    coveredProblems: covered.size,
    byDiscipline: ts.reduce((a, t) => {
      a[t.discipline] = (a[t.discipline] || 0) + 1;
      return a;
    }, {}),
    byChapter: ts.reduce((a, t) => {
      for (const c of t.chapters || []) a[c] = (a[c] || 0) + 1;
      return a;
    }, {}),
    kinds: ts.reduce((a, t) => {
      a[t.kind] = (a[t.kind] || 0) + 1;
      return a;
    }, {}),
  };
}

/* ============================ Markdown 渲染 ============================ */

function templateMd(t) {
  const L = [];
  L.push(`## ${t.name}`);
  L.push('');
  L.push(`> 编号 **${t.id}** ｜ 版本 **${t.version}** ｜ 来源 **${t.kind === 'seed' ? '种子通法（已有优质归纳）' : '增量归纳'}** ｜ 层级 **一级核心通法**`);
  L.push('');
  L.push(`| 项目 | 内容 |`);
  L.push(`| --- | --- |`);
  L.push(`| 核心本质 | ${esc(t.essence)} |`);
  L.push(`| 适用范围 | ${esc(t.scope)} |`);
  L.push(`| 学科 / 章节 | ${esc(t.discipline)} · ${(t.chapterTitles || []).join('、') || '-'} |`);
  L.push(`| 表面题型 | ${(t.surface_types || []).map(esc).join('；') || '-'} |`);
  L.push(`| 对应考点 | ${(t.exam_points || []).map(esc).join('；') || '-'} |`);
  L.push(`| 覆盖题量 | ${(t.covered_problem_ids || []).length} 题（分支 ${(t.branches || []).length} 个） |`);
  L.push('');
  L.push('### 标准解题步骤');
  L.push('');
  (t.steps || []).forEach((s, i) => L.push(`${i + 1}. ${esc(s)}`));
  L.push('');
  if ((t.branches || []).length) {
    L.push('### 二级分支（按表面题型适配）');
    L.push('');
    L.push('| 分支 | 触发特征 | 追加操作 | 适用前提 |');
    L.push('| --- | --- | --- | --- |');
    for (const b of t.branches) {
      L.push(`| ${esc(b.name)} | ${esc(b.trigger)} | ${esc((b.steps || []).join(' → '))} | ${esc(b.boundary)} |`);
    }
    L.push('');
  }
  L.push('### 失效边界');
  L.push('');
  // 跨章合并后边界条目会累积到上百条，逐条成行才读得完，压成一整段等于不可用
  const bullet = (label, arr) => {
    L.push(`**${label}**（${arr.length} 条）`, '');
    if (!arr.length) L.push('- —', '');
    else for (const x of arr) L.push(`- ${esc(x)}`);
    L.push('');
  };
  bullet('适用前提', t.boundaries.applicable || []);
  bullet('失效场景', t.boundaries.invalid || []);
  if ((t.examples || []).length) {
    L.push('### 典型例题');
    L.push('');
    L.push('| 题号 | 表面题型 | 本质要点 |');
    L.push('| --- | --- | --- |');
    for (const e of t.examples.slice(-8)) L.push(`| ${e.problem_id} | ${esc(e.surface_type)} | ${esc(e.essence || e.note)} |`);
    L.push('');
  }
  if ((t.history || []).length > 1) {
    L.push('### 版本演进');
    L.push('');
    for (const h of t.history.slice(-6)) L.push(`- **${h.version}** ｜ ${h.at} ｜ ${h.action} ｜ ${h.skill} ｜ ${esc(h.reason)}`);
    L.push('');
  }
  return L.join('\n');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

module.exports = { read, write, create, upsert, replaceMany, remove, all, active, byId, applyDecomposition, digest, stats, templateMd, bump, normalize, normalizeBranch, markChapterDone, uniq, DIR, FILE };
