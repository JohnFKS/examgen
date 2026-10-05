'use strict';
/** 业务执行层 · 单题标准化拆解Skill（LIMO 5 段式 + ReGFT 参考引导） */
const cfg = require('../config');
const { ROLE, knowledgeContext } = require('./context');

const id = 'problem-decompose';

function buildMessages(batch, chapter, corpus) {
  const s = cfg.load();
  const q = batch.map((p) => p.stem).join(' ');
  const kn = knowledgeContext(corpus, chapter, q);
  const lines = batch.map((p, i) => {
    const stem = String(p.stem || '').slice(0, s.batch.maxStemChars);
    const sol = String(p.solution || '（无解析：仅依据题干与标答判断）').slice(0, s.batch.maxSolutionChars);
    return [
      `【题 ${i + 1}｜${p.id}｜${chapter.no}章 ${p.tier}·${p.section}】`,
      `题干：${stem}`,
      p.options ? `选项：${String(p.options).slice(0, 400)}` : '',
      p.answerLabel ? `标答：${p.answerLabel}` : '',
      `参考解析（脚手架，禁止照搬）：${sol}`,
    ]
      .filter(Boolean)
      .join('\n');
  });

  const sys =
    ROLE +
    '\n【本次任务】单题标准化拆解。对每道题输出固定 5 字段：表面题型、核心本质、标准解题步骤、边界条件、对应考点（不设易错点）。' +
    '\n字段规范：' +
    '\n- surface_type：题目外观形式分类，4~12 字短语，如「递推数列极限」「矩阵相似判定」；同批中外观同类应使用完全相同的短语。' +
    '\n- essence：一句话底层数学原理，穿透表面形式，回答「为什么这样做一定有效」，不得写成步骤，不得含具体数值。' +
    '\n- steps：通用可复用的解题步骤数组，每步为动词开头的操作指令（含判别式/检验点），4~7 步，禁止出现本题的数值与函数表达式。' +
    '\n- boundaries：{applicable:[适用前提], invalid:[失效场景]}，写「什么条件下此法不可用/会出错」。' +
    '\n- exam_points：从给定的本章考点清单中选取（尽量复用清单原文，1~3 个）。';

  const user = [
    `【本章】第${chapter.no}章 ${chapter.title}（${chapter.discipline}）`,
    `【本章考点清单】${kn.examPoints.slice(0, 40).join('、') || '（空）'}`,
    `【相关教材/讲义片段】${JSON.stringify(kn.lecture).slice(0, 2600)}`,
    `【相关公式（本质判断依据）】${JSON.stringify(kn.formulas).slice(0, 1800)}`,
    '',
    `【待拆解题目（共 ${batch.length} 道）】`,
    lines.join('\n\n———\n\n'),
    '',
    '【输出 JSON schema】',
    '{"items":[{"problem_id":"...","surface_type":"...","essence":"...","steps":["...","..."],"boundaries":{"applicable":["..."],"invalid":["..."]},"exam_points":["..."],"stem_excerpt":"题干前60字"}]}',
    `必须为每一道题输出一项，problem_id 原样回填，共 ${batch.length} 项。`,
  ].join('\n');

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

function apply(batch, data) {
  const map = new Map((data.items || []).map((x) => [String(x.problem_id), x]));
  const out = [];
  for (const p of batch) {
    const d = map.get(p.id);
    if (!d) continue;
    out.push({
      problem_id: p.id,
      chapterNo: p.chapterNo,
      tier: p.tier,
      section: p.section,
      no: p.no,
      surface_type: String(d.surface_type || '').trim(),
      essence: String(d.essence || '').trim(),
      steps: Array.isArray(d.steps) ? d.steps.filter(Boolean) : [],
      boundaries: {
        applicable: (d.boundaries && d.boundaries.applicable) || [],
        invalid: (d.boundaries && d.boundaries.invalid) || [],
      },
      exam_points: Array.isArray(d.exam_points) ? d.exam_points : [],
      stem_excerpt: d.stem_excerpt || String(p.stem || '').slice(0, 60),
      hasSolution: !!p.solution,
    });
  }
  return out;
}

module.exports = { id, layer: 'business', title: '单题标准化拆解Skill', buildMessages, apply };
