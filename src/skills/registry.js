'use strict';
/** 元能力层 · Skill 注册表 + Skill 生成元 Skill（能力自主扩展） */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');

const GEN = path.join(__dirname, 'generated');
U.ensureDir(GEN);

const META = [
  { id: 'task-scheduler', layer: 'meta', title: '任务调度Skill', file: 'src/pipeline/orchestrator.js', desc: '接收输入文件，按章节串行调度「拆解→匹配→迭代→组织→校验」，传递数据、控制全流程与版本产出。' },
  { id: 'skill-forge', layer: 'meta', title: 'Skill生成元Skill', file: 'src/skills/forge.js', desc: '当缺失对应业务 Skill 时，按统一规范生成新的 SKILL.md + 实现骨架并入库注册，支持能力自主扩展。' },
  { id: 'seed-import', layer: 'business', title: '种子模板导入Skill', file: 'src/skills/seedImport.js', desc: '输入 已有通法.md + 考点.md，输出标准化后的初始模板库：按标准结构重构、标注对应考点、按章节分类入库，完成冷启动初始化。' },
  { id: 'problem-decompose', layer: 'business', title: '单题标准化拆解Skill', file: 'src/skills/problemDecompose.js', desc: '输入 单道题目+解析 + 考点/公式/教材，输出固定 5 字段（表面题型/核心本质/标准解题步骤/边界条件/对应考点）。以解析为参考引导，不照搬具体答案。' },
  { id: 'essence-match', layer: 'business', title: '本质匹配与模板迭代Skill', file: 'src/skills/essenceMatch.js', desc: '输入 单题拆解结果 + 当前模板库，按核心本质语义重合度三档处理：≥90% 优化模板并小版本升级；60~90% 新增二级分支；<60% 新建模板。' },
  { id: 'chapter-organize', layer: 'business', title: '章节分类与组织Skill', file: 'src/skills/chapterOrganize.js', desc: '严格按教材章节目录分类归档模板；每章结束后做章内合并去重，每 5 章做跨章共性合并，控制一级通法总量。' },
  { id: 'math-equivalence', layer: 'qa', title: '数学等价校验Skill', file: 'src/skills/qa.js', desc: '按代数等价 / 数值等价 / 恒等变形三标准校验解题步骤与结果的正确性，不纠结字面差异，发现错误给出完整替换步骤。' },
  { id: 'syllabus-coverage', layer: 'qa', title: '考点覆盖校验Skill', file: 'src/skills/qa.js', desc: '对照考点清单校验覆盖率：先做确定性语义匹配，残留考点交大模型判定；未覆盖则给出应补的题型特征与方法骨架。' },
  { id: 'boundary-consistency', layer: 'qa', title: '边界一致性校验Skill', file: 'src/skills/qa.js', desc: '校验同一模板的适用前提与失效场景无矛盾、二级分支触发特征不重叠、跨模板归属确定。' },
];

function listGenerated() {
  try {
    return fs
      .readdirSync(GEN)
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.basename(f, '.js'));
  } catch (e) {
    return [];
  }
}

function all() {
  const g = listGenerated().map((id) => {
    try {
      const m = require(path.join(GEN, id + '.js'));
      return { id: m.id || id, layer: m.layer || 'business', title: m.title || id, file: `src/skills/generated/${id}.js`, desc: m.desc || '', generated: true, hook: m.hook || 'post-chapter' };
    } catch (e) {
      return { id, layer: 'business', title: id, file: `src/skills/generated/${id}.js`, desc: '加载失败：' + e.message, generated: true, error: e.message };
    }
  });
  return META.concat(g);
}

function loadGenerated(id) {
  const f = path.join(GEN, id + '.js');
  if (!fs.existsSync(f)) throw new Error('生成型 Skill 不存在：' + id);
  return require(f);
}

const TPL_JS = (o) => `'use strict';
/** 由「Skill生成元Skill」自动生成于 ${o.at} — ${o.title} */
const { ROLE, knowledgeContext } = require('../context');

const id = '${o.id}';
const layer = '${o.layer}';
const hook = '${o.hook}';

/** @returns {Array} messages 供大模型/智能体推理 */
function buildMessages(input) {
  const sys = ROLE + '\\n【本次任务】${o.purpose}';
  const user = [
    '【上下文】' + JSON.stringify({ chapter: input.chapter && input.chapter.title, templates: (input.templates || []).map((t) => ({ id: t.id, name: t.name, essence: t.essence })) }).slice(0, 6000),
    '【数据】' + JSON.stringify(input.payload).slice(0, 9000),
    '',
    '【输出 JSON schema】${o.schema}',
  ].join('\\n');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/** 把模型输出落库（默认只回传结构化结果，由流水线决定如何应用） */
function apply(input, data) {
  return { skill: id, accepted: true, result: data };
}

module.exports = { id, layer, title: '${o.title}', desc: '${o.purpose}', hook, buildMessages, apply };
`;

const TPL_MD = (o) => `---
id: ${o.id}
title: ${o.title}
layer: ${o.layer}
hook: ${o.hook}
generated_by: skill-forge
generated_at: ${o.at}
---

# ${o.title}

## 用途
${o.purpose}

## 输入
${o.input}

## 输出
\`\`\`json
${o.schema}
\`\`\`

## 校验标准
${o.check}

## 实现
- 代码：\`src/skills/generated/${o.id}.js\`
- 提示词：见代码内 buildMessages，遵循统一 5 段式规范（目标 / 参考引导 / 知识支撑 / 数据 / schema）
`;

/** 元 Skill：生成缺失的业务 Skill 并入库 */
function forge(spec) {
  const id = U.slug(spec.id || spec.title).toLowerCase().replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9\-_]{3,40}$/.test(id)) throw new Error('Skill id 只允许小写字母/数字/中划线：' + id);
  const o = {
    id,
    title: spec.title || id,
    layer: ['meta', 'business', 'qa'].includes(spec.layer) ? spec.layer : 'business',
    hook: spec.hook || 'post-chapter',
    purpose: spec.purpose || '对章节模板库做专项优化',
    input: spec.input || '当前章节模板库 + 章节信息',
    schema: spec.schema || '{"items":[]}',
    check: spec.check || '输出必须为合法 JSON，且不引入未在输入中出现的新结论',
    at: U.nowStamp(),
  };
  const dir = path.join(cfg.P.skills, o.layer, o.id);
  const jsFile = path.join(GEN, o.id + '.js');
  if (fs.existsSync(jsFile) && !spec.overwrite) throw new Error('Skill 已存在：' + o.id + '（如需覆盖请传 overwrite）');
  U.writeFileAtomic(path.join(dir, 'SKILL.md'), TPL_MD(o));
  U.writeFileAtomic(jsFile, TPL_JS(o));
  delete require.cache[jsFile];
  return { id: o.id, layer: o.layer, title: o.title, files: [path.join(dir, 'SKILL.md'), jsFile] };
}

module.exports = { all, forge, META, listGenerated, loadGenerated, GEN };
