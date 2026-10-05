'use strict';
/** 各 Skill 共用的提示词构件 */
const cfg = require('../config');
const lib = require('../store/library');
const { retrieve, headingsToEntries } = require('../ingest/markdown');
const U = require('../lib/util');

const ROLE =
  '你是考研数学命题研究与方法论专家，同时是一套「考研数学万能通法自动归纳系统」的推理内核。' +
  '你的任务不是解题，而是从题目与已有解析中提炼可复用、可迁移、最少数量的通用解题框架（通法）。' +
  '严格遵守：1) 只输出合法 JSON，不输出任何解释性文字或 Markdown 代码块标记；2) 禁止照搬具体数值与单题过程，只保留通用方法；' +
  '3) 以「数学本质」而非「字面形式」判断异同（代数等价、数值等价、逻辑等价）；4) 中文表述，术语与考纲一致。';

function knowledgeContext(corpus, chapter, query) {
  const keys = chapter.lectureKeys || chapter.lectures || [];
  const lect = keys.map((k) => corpus.lectures[k]).filter(Boolean);
  const examPoints = lect.reduce((a, l) => a.concat(l.examPoints.map((p) => p.point)), []);
  const formulaHits = retrieve(query || '', corpus.formulaEntries, 4);
  const textHits = lect
    .map((l) => l.outline.filter((o) => o.level <= 4))
    .flat();
  const textPick = retrieve(query || '', textHits, 5);
  return {
    examPoints,
    lecture: textPick.map((e) => ({ 标题: e.title, 摘要: String(e.excerpt || '').replace(/\s+/g, ' ').slice(0, 300) })),
    formulas: formulaPick(formulaHits),
  };
}

function formulaPick(entries) {
  const s = cfg.load();
  return entries.map((e) => ({ 公式条目: e.title, 内容: String(e.body || '').replace(/\s+/g, ' ').slice(0, s.batch.maxFormulaChars || 600) }));
}

function libraryDigest() {
  const d = lib.digest();
  return d ? d : '（当前模板库为空：所有题目均按「新建模板」处理）';
}

module.exports = { ROLE, knowledgeContext, libraryDigest, U };
