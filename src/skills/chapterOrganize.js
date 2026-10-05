'use strict';
/** 业务执行层 · 章节分类与组织Skill（章内/跨章合并去重，一级通法与二级分支梳理） */
const { ROLE } = require('./context');
const cfg = require('../config');

const id = 'chapter-organize';

function compact(t) {
  return [
    `#${t.id} ｜ ${t.name} ｜ ${t.version} ｜ 章节：${(t.chapters || []).join(',')}`,
    `本质：${t.essence}`,
    `适用：${t.scope}`,
    `步骤：${(t.steps || []).join(' → ')}`,
    `分支：${(t.branches || []).map((b) => `${b.name}[${b.trigger}]`).join('；') || '无'}`,
    `边界：可用[${(t.boundaries.applicable || []).join('；')}] 失效[${(t.boundaries.invalid || []).join('；')}]`,
    `考点：${(t.exam_points || []).join('、')}`,
    `覆盖题数：${(t.covered_problem_ids || []).length}`,
  ].join('\n');
}

function buildMessages(templates, scopeNote) {
  const c = cfg.load().convergence;
  const sys =
    ROLE +
    `\n【本次任务】${scopeNote}。对给定模板集合做合并去重与层级梳理，贯彻「通法数量最少、覆盖范围最全」。` +
    '\n规则：核心本质一致（代数等价/恒等变形等价/逻辑等价）的模板必须合并为一个一级通法，表面差异降级为二级分支；' +
    `一级通法总量控制在 ${c.firstLevelTargetMin}~${c.firstLevelTargetMax} 个区间内（本批次只处理给定集合，但要以全局目标为约束）。` +
    '\n禁止发明新内容：合并后的 final_essence / final_steps 必须来自被合并模板的表述整合，不得引入未出现过的数学结论。';

  const user = [
    '【候选模板】',
    templates.map(compact).join('\n\n'),
    '',
    '【输出 JSON schema】',
    '{"merges":[{"keep_id":"保留的模板编号","absorb_ids":["被合并掉的模板编号"],"reason":"一句话合并依据（指出本质如何等价）","final_essence":"合并后的核心本质","final_steps":["合并后的通用步骤"],"final_branches":[{"name":"","trigger":"","steps":[],"surface_types":[],"boundary":""}],"final_boundaries":{"applicable":[],"invalid":[]},"final_name":"合并后的通法名称"}],' +
    '"renames":[{"id":"...","name":"更贴切的通法名称"}],"hierarchy":[{"id":"...","level":1,"note":"该一级通法在全局体系中的定位"}],' +
    '"unmerged_reason":"未合并的模板各自本质差异说明","chapter_summary":"本批次组织结论（3 句以内）"}',
    '没有需要合并的模板时 merges 返回空数组。absorb_ids 不得包含 keep_id。',
  ].join('\n');

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

module.exports = { id, layer: 'business', title: '章节分类与组织Skill', buildMessages, compact };
