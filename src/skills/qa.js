'use strict';
/** 质量校验层：数学等价校验 / 考点覆盖校验 / 边界一致性校验 */
const { ROLE, knowledgeContext } = require('./context');
const essence = require('../store/essence');

const ids = {
  eq: 'math-equivalence',
  cov: 'syllabus-coverage',
  bdy: 'boundary-consistency',
};

/* ---------- 1. 数学等价校验 ---------- */
function eqMessages(templates, corpus, chapter, problemsById) {
  const sys =
    ROLE +
    '\n【本次任务】数学等价校验。只验证核心逻辑正确性，不纠结字面差异。三维度：' +
    '\n- 代数等价：表达式变形、恒等变换、公式使用是否符合数学规则；' +
    '\n- 数值等价：把通法步骤代入典型数值，结果是否与标准解析一致；' +
    '\n- 逻辑等价：步骤的因果链是否成立，充分必要方向是否搞反，边界条件是否漏项。' +
    '\n发现错误必须给出 corrected_steps（完整替换用），不得含糊其辞。';
  const blocks = templates.map((t) => {
    const ex = (t.examples || []).slice(-3).map((e) => {
      const p = (problemsById instanceof Map ? problemsById.get(e.problem_id) : problemsById[e.problem_id]) || {};
      return `题 ${e.problem_id}：${String(p.stem || e.excerpt || '').slice(0, 220)}\n  标答：${p.answerLabel || ''} ${p.solution ? String(p.solution).replace(/\s+/g, ' ').slice(0, 320) : '（无解析）'}`;
    });
    return [`#${t.id} ${t.name}｜${t.version}`, `本质：${t.essence}`, `步骤：${(t.steps || []).map((s, i) => i + 1 + '.' + s).join(' ')}`, `边界：${(t.boundaries.applicable || []).join('；')}｜失效 ${(t.boundaries.invalid || []).join('；')}`, ex.length ? `例题实证：\n${ex.join('\n')}` : '例题实证：无'].join('\n');
  });
  const kn = knowledgeContext(corpus, chapter, templates.map((t) => t.name + t.essence).join(' '));
  const user = [
    `【公式依据（节选）】${JSON.stringify(kn.formulas).slice(0, 2200)}`,
    `【教材依据（节选）】${JSON.stringify(kn.lecture).slice(0, 1800)}`,
    '',
    '【待校验模板】',
    blocks.join('\n\n———\n\n'),
    '',
    '【输出 JSON schema】',
    '{"results":[{"template_id":"...","verdict":"pass|warn|fail","algebraic":"pass|warn|fail","numeric":"pass|warn|fail","logical":"pass|warn|fail","issues":[{"type":"algebraic|numeric|logical","severity":"high|medium|low","detail":"问题描述","fix":"修改建议"}],"corrected_steps":["仅当步骤确有错误时给出完整替换步骤，否则空数组"],"evidence":"用一句话说明你代入检验的数值或等价变形"}]}',
    '必须逐个模板输出。',
  ].join('\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/* ---------- 2. 考点覆盖校验 ---------- */
function covPreMatch(examPoints, templates) {
  const pointText = templates.map((t) => [t.name, t.essence, (t.exam_points || []).join(' '), (t.surface_types || []).join(' ')].join(' '));
  const covered = [];
  const residual = [];
  for (const pt of examPoints) {
    let best = -1,
      bs = 0;
    pointText.forEach((txt, i) => {
      let s = essence.similarity(pt.point, txt);
      if (txt.includes(pt.point)) s = Math.max(s, 0.99);
      if (s > bs) {
        bs = s;
        best = i;
      }
    });
    if (bs >= 0.45 && best >= 0) covered.push({ point: pt.point, template_id: templates[best].id, sim: +bs.toFixed(3), by: 'deterministic' });
    else residual.push(pt);
  }
  return { covered, residual };
}

function covMessages(chapter, residual, templates) {
  const sys = ROLE + '\n【本次任务】考点覆盖校验。给定「尚未被确定性匹配命中的考点」与现有模板，逐个判断该考点是否已被某个模板的解法体系实际覆盖（语义等价即可，不要求字面一致）；未覆盖的，给出该补的题目特征与应有的通法骨架。';
  const user = [
    `【章节】第${chapter.no}章 ${chapter.title}`,
    '【现有模板】',
    templates.map((t) => `#${t.id} ${t.name}｜本质：${t.essence}｜考点：${(t.exam_points || []).join('、')}`).join('\n'),
    '',
    '【待判定考点】',
    residual.map((p, i) => `${i + 1}. ${p.point}`).join('\n'),
    '',
    '【输出 JSON schema】',
    '{"items":[{"point":"...","covered":true,"template_id":"...","exam_point_add":"建议写入该模板的规范考点名(≤15字)","reason":"一句话"}]} 或 {"point":"...","covered":false,"template_id":null,"missing_note":"该考点需要什么方法","suggest_problem_feature":"建议补充的题型特征"}',
  ].join('\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/* ---------- 3. 边界一致性校验 ---------- */
function bdyMessages(templates) {
  const sys =
    ROLE +
    '\n【本次任务】边界一致性校验。检查：①同一模板内「适用前提」与「失效场景」是否互相矛盾；②同模板不同二级分支的触发特征是否重叠（一题同时落两支）；③不同模板之间边界是否冲突导致归属不确定。' +
    '\n给出可直接执行的消歧方案（细化触发特征、补充互斥条件、或建议合并）。';
  const blocks = templates.map((t) =>
    [
      `#${t.id} ${t.name}`,
      `本质：${t.essence}`,
      `适用前提：${(t.boundaries.applicable || []).join('；') || '（缺）'}`,
      `失效场景：${(t.boundaries.invalid || []).join('；') || '（缺）'}`,
      `分支：${(t.branches || []).map((b) => `${b.name}⟨${b.trigger}⟩`).join('；') || '无'}`,
      `表面题型：${(t.surface_types || []).join('；')}`,
    ].join('\n')
  );
  const user = [
    '【待校验模板】',
    blocks.join('\n\n'),
    '',
    '【输出 JSON schema】',
    '{"results":[{"template_id":"...","conflicts":[{"kind":"contradiction|branch-overlap|cross-template","targets":["T-..","T-.."],"detail":"冲突描述","resolution":"可执行的消歧修改","patched_applicable":[],"patched_invalid":[],"patched_branch_triggers":[{"name":"","trigger":""}]}],"verdict":"pass|warn|fail"}]}',
    '无冲突的模板也要输出 verdict=pass 的空 conflicts。',
  ].join('\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

module.exports = {
  ids,
  eqMessages,
  covPreMatch,
  covMessages,
  bdyMessages,
  layer: 'qa',
  titles: { [ids.eq]: '数学等价校验Skill', [ids.cov]: '考点覆盖校验Skill', [ids.bdy]: '边界一致性校验Skill' },
};
