'use strict';
/** 业务执行层 · 种子模板导入Skill（冷启动加速：已有优质通法标准化入库） */
const { ROLE } = require('./context');

const id = 'seed-import';

function buildMessages(seed, chapterMap) {
  const sys =
    ROLE +
    '\n【本次任务】种子模板导入。把一篇已有的优质通法文章（如「破天学长」系列）重构为标准模板结构，作为初始种子入库。' +
    '\n要求：1) 剥离口语、广告、图片、例题的具体数值，只保留通用方法骨架；2) 例题仅保留「典型例题」摘要（题干要点 + 用到的分支）；' +
    '3) 若一篇文章含多个可独立复用的本质，则拆成多个模板；若只是同一本质的不同表面形式，则归为二级分支；' +
    '4) chapter_no 必须从给定章节目录中选择（依据文章涉及的考点归属），无法归属填 null。';

  const user = [
    `【章节目录（chapter_no 取值范围）】`,
    chapterMap.map((c) => `第${c.no}章 ${c.title}（${c.discipline}）`).join('\n'),
    '',
    `【种子文章标题】${seed.title}`,
    `【种子文章正文】`,
    String(seed.md).slice(0, 12000),
    '',
    '【输出 JSON schema】',
    '{"templates":[{"name":"通法名称(≤20字，含方法关键词，如「递推数列极限的单调有界通法」)","essence":"一句话核心本质","scope":"适用范围","steps":["4~7 步通用步骤"],"branches":[{"name":"分支名","trigger":"触发特征","steps":["追加操作"],"surface_types":["..."],"boundary":"适用前提"}],"boundaries":{"applicable":["适用前提"],"invalid":["失效场景"]},"exam_points":["考纲知识点"],"surface_types":["可处理的外观题型"],"chapter_no":1,"examples":[{"title":"例题要点","note":"对应分支/关键点"}],"version_note":"种子版本说明"}]}',
    '通用步骤里禁止出现该文章例题的具体数值。',
  ].join('\n');

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

module.exports = { id, layer: 'business', title: '种子模板导入Skill', buildMessages };
