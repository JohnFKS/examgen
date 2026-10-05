'use strict';
/** 业务执行层 · 本质匹配与模板迭代Skill（按核心本质语义重合度三档处理） */
const { ROLE, libraryDigest } = require('./context');
const lib = require('../store/library');

const id = 'essence-match';
const TIERS = [
  { min: 0.9, action: 'refine', label: '完全匹配：优化已有模板（补充分支/边界/例题），小版本升级' },
  { min: 0.6, action: 'branch', label: '部分匹配：归入对应大模板，新增二级分支' },
  { min: 0, action: 'new', label: '不匹配：按标准结构新建模板' },
];

function tierOf(sim) {
  const v = typeof sim === 'number' ? sim : parseFloat(sim) || 0;
  return TIERS.find((t) => v >= t.min) || TIERS[TIERS.length - 1];
}

function buildMessages(decomps, chapterNo, digestSnapshot) {
  const digest = digestSnapshot || libraryDigest();
  const items = decomps.map((d, i) =>
    [
      `【拆解 ${i + 1}｜${d.problem_id}】`,
      `表面题型：${d.surface_type}`,
      `核心本质：${d.essence}`,
      `通用步骤：${(d.steps || []).join(' → ')}`,
      `边界条件：可用[${(d.boundaries.applicable || []).join('；') || '-'}] 失效[${(d.boundaries.invalid || []).join('；') || '-'}]`,
      `对应考点：${(d.exam_points || []).join('、')}`,
    ].join('\n')
  );

  const sys =
    ROLE +
    '\n【本次任务】本质匹配与模板迭代。把每条「单题拆解」与现有模板库按**核心本质的语义重合度**比对，给出 0~1 的相似度与归属，并给出对模板的最小补丁。' +
    '\n判定档位（系统会按相似度强制执行，你的 action 仅作参考，请务必给出真实相似度）：' +
    '\n- ≥0.90 完全匹配 → 命中该模板，输出优化补丁（补边界/补分支/补例题，必要时润色本质与步骤）；' +
    '\n- 0.60~0.90 部分匹配 → 归入该模板，新增一个二级分支（写明触发特征与追加操作）；' +
    '\n- <0.60 不匹配 → 新建一级通法模板（给出完整标准结构）。' +
    '\n判断依据是「为什么这样做一定有效」这一层原理是否相同，而不是题型措辞、函数形式是否相同。' +
    '\n特别要求：同一批次内本质相同的题目，template_id 必须写成完全相同的值（新建时用相同的 NEW:名称）。\n' +
    '【反冗余】宁可复用，不可新造；新建模板前必须逐条比对现有模板的本质，并说明为何无一可比。';

  const user = [
    `【当前模板库摘要（第${chapterNo}章可见范围含全部已入库模板）】`,
    digest,
    '',
    `【待归并的单题拆解结果（共 ${decomps.length} 条）】`,
    items.join('\n\n'),
    '',
    '【输出 JSON schema】',
    '{"items":[{"problem_id":"...","similarity":0.0,"template_id":"T-HS-01-S 或 NEW:通法名 或 null","matched_essence":"命中模板的本质原文（新建时填 null）","rationale":"一句话依据","action":"refine|branch|new","patch":{}}]}',
    'patch 规范：',
    '- refine: {"essence_polish":"更精准的本质表述(可空)","steps_refine":["完整替换用的步骤数组(可空)"],"boundary_add":{"applicable":[],"invalid":[]},"example_note":"本题作为例题的一句话说明"}',
    '- branch: {"branch":{"name":"分支名","trigger":"触发特征(看到什么形式走这支)","steps":["追加操作"],"surface_types":["..."],"boundary":"适用前提/坑点"}}',
    '- new: {"template":{"name":"通法名称(≤20字)","essence":"一句话本质","scope":"适用范围","steps":["4~7 步通用步骤"],"boundaries":{"applicable":[],"invalid":[]},"exam_points":["..."],"surface_types":["..."]}}',
    `必须为每一条输出对应项，共 ${decomps.length} 项，problem_id 原样回填。`,
  ].join('\n');

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 应用一条决策到模板库（三档强制） */
function applyDecision(dec, d, ctx) {
  const tier = tierOf(dec.similarity);
  const action = tier.action;
  const patch = dec.patch || {};
  const st = lib.read();
  const conflict = dec.action && dec.action !== action;
  d = Object.assign({}, d, { chapterNo: d.chapterNo || ctx.chapterNo, chapterTitle: ctx.chapterTitle });

  if (action === 'new') {
    const t = patch.template || {};
    const dup = st.templates.find((x) => x.status === 'active' && sameEssence(x.essence, d.essence));
    if (dup) {
      const updated = lib.applyDecomposition(dup, d, { kind: 'minor', skill: id, action: 'refine', reason: '本质签名相同，自动并入已有模板', example_note: (patch.example_note || '').slice(0, 80) });
      // 自动并入必须落盘，否则同本质题目的例题与覆盖关系会被静默丢弃（覆盖率虚低、手册每法只剩一道例题）
      lib.upsert(updated);
      return { action: 'auto-merge', template_id: dup.id, before: dup.version, after: updated.version, tier: tier.label, conflict, similarity: dec.similarity };
    }
    const created = lib.create({
      name: t.name || d.surface_type || '未命名通法',
      discipline: ctx.discipline,
      chapters: [ctx.chapterNo],
      chapterTitles: [ctx.chapterTitle],
      kind: 'induced',
      essence: t.essence || d.essence,
      scope: t.scope || '',
      steps: (t.steps && t.steps.length ? t.steps : d.steps) || [],
      branches: [],
      boundaries: t.boundaries || d.boundaries,
      exam_points: t.exam_points || d.exam_points,
      surface_types: [d.surface_type],
      _reason: '本质不匹配，新建模板',
      _skill: id,
    });
    const withEx = lib.applyDecomposition(created, d, { kind: 'minor', skill: id, bump: false, action: 'create-with-example' });
    lib.upsert(withEx);
    return { action: 'new', template_id: created.id, before: '-', after: withEx.version, tier: tier.label, conflict, similarity: dec.similarity };
  }

  let target = st.templates.find((x) => x.id === dec.template_id && x.status === 'active');
  if (!target) {
    target = st.templates.find((x) => x.status === 'active' && sameEssence(x.essence, d.essence));
  }
  if (!target) {
    return applyDecision({ similarity: 0.2, action: 'new', patch: { template: {} } }, d, ctx);
  }

  if (action === 'branch') {
    const br = patch.branch || {};
    const updated = lib.applyDecomposition(target, d, {
      kind: 'major',
      skill: id,
      action: 'add-branch',
      reason: `部分匹配（${pct(dec.similarity)}）：新增二级分支「${br.name || d.surface_type}」`,
      branch: Object.assign({ name: d.surface_type || '新分支', trigger: '', steps: [], surface_types: [d.surface_type], boundary: '' }, br),
      example_note: (patch.example_note || '').slice(0, 80),
    });
    lib.upsert(updated);
    return { action: 'branch', template_id: target.id, before: target.version, after: updated.version, tier: tier.label, conflict, similarity: dec.similarity };
  }

  const updated = lib.applyDecomposition(target, d, {
    kind: 'minor',
    skill: id,
    action: 'refine',
    reason: `完全匹配（${pct(dec.similarity)}）：补充分支/边界/例题，小版本升级`,
    refineSteps: patch.steps_refine,
    essencePolish: patch.essence_polish,
    example_note: (patch.example_note || '').slice(0, 80),
  });
  if (patch.boundary_add) {
    updated.boundaries.applicable = lib.uniq(updated.boundaries.applicable.concat(patch.boundary_add.applicable || []));
    updated.boundaries.invalid = lib.uniq(updated.boundaries.invalid.concat(patch.boundary_add.invalid || []));
  }
  lib.upsert(updated);
  return { action: 'refine', template_id: target.id, before: target.version, after: updated.version, tier: tier.label, conflict, similarity: dec.similarity };
}

function pct(s) {
  return s == null ? '-' : Math.round((+s) * 100) + '%';
}

/** 本质签名：去标点后取字符集合，用于确定性去冗余 */
function sameEssence(a, b) {
  const sig = (x) =>
    String(x || '')
      .replace(/[^一-龥A-Za-z0-9]/g, '')
      .slice(0, 40);
  const x = sig(a),
    y = sig(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const s1 = new Set(x),
    s2 = new Set(y);
  let inter = 0;
  s1.forEach((c) => {
    if (s2.has(c)) inter++;
  });
  return inter / Math.min(s1.size, s2.size) > 0.92;
}

module.exports = { id, buildMessages, applyDecision, tierOf, TIERS, sameEssence };
