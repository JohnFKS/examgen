'use strict';
/** 导出结构化题库 JSON：node tools/exportProblemBank.js（读缓存 corpus，加 --force 重解析） */
const fs = require('fs');
const path = require('path');
const U = require('../src/lib/util');
const cfg = require('../src/config');
const corpusMod = require('../src/ingest/corpus');

const c = corpusMod.loadCached(process.argv.includes('--force'));

const problems = c.problems.map((p) => ({
  id: p.id,
  chapter_no: p.chapterNo,
  chapter_title: p.chapterTitle,
  tier: p.tier,
  section: p.section,
  no: p.no,
  type: /选择题/.test(p.section) ? 'mc' : /填空题/.test(p.section) ? 'fp' : /解答题|计算题|证明题/.test(p.section) ? 'fr' : 'na',
  stem: (p.stem || '').trim(),
  options: (p.options || '').trim(),
  answer_label: p.answerLabel || '',
  has_solution: !!p.solution,
  solution: (p.solution || '').trim(),
  align_via: p.solutionLine ? (p.alignVia || 'four-level') : null,
  source: { book: p.book, line: p.line },
  solution_source: p.solutionLine ? { book: p.solutionBook || null, line: p.solutionLine } : null,
}));

const byTier = {}, bySection = {}, byType = {};
for (const p of problems) {
  byTier[p.tier] = (byTier[p.tier] || 0) + 1;
  bySection[p.section] = (bySection[p.section] || 0) + 1;
  byType[p.type] = (byType[p.type] || 0) + 1;
}

const out = {
  meta: {
    generated_at: c.generatedAt,
    format: 'examgen-problem-bank/1.1',
    description: '考研数学题库 JSON：按「章/难度层/题型/题号」四级结构从 date1 的 md 源文件解析；对齐=四级 key 精确匹配 + 章内(序号)顺序兜底',
    parse_rules: {
      chapter: '标题行 第N章',
      tier: '基础题|综合题|拓展题',
      section: '选择题|填空题|解答题|计算题|证明题',
      item: '(N) 或 （N） 开头行（OCR 全/半角括号都接受），题号允许 1~3 跳跃，重复题号并入已有题',
      align: '章+难度层+题型+题号 四级 key 对齐；剩余题在章内按 (序号) 顺序兜底配对（优先同题型）',
    },
    sources: c.files.map((f) => ({ file: f.file, role: f.role, bytes: f.bytes })),
    parse_warnings: c.warnings.length,
    warnings_sample: c.warnings.slice(0, 10),
  },
  stats: {
    total: problems.length,
    solution_total: c.solutions.length,
    aligned: problems.filter((p) => p.has_solution).length,
    unaligned: problems.filter((p) => !p.has_solution).length,
    sequential_matched: c.stats.seqMatched || 0,
    orphan_solutions: c.stats.orphanSolutions.length,
    by_tier: byTier,
    by_section: bySection,
    by_type: byType,
  },
  chapters: c.chapters.map((ch) => ({
    no: ch.no, title: ch.title, discipline: ch.discipline,
    problems: ch.problemCount, with_solution: ch.matchedCount,
    exam_points: ch.examPointCount, lectures: ch.lectureKeys,
  })),
  unaligned: {
    problems_missing_solution: c.problems.filter((p) => !p.solution).map((p) => p.id),
    orphan_solutions: c.stats.orphanSolutions,
  },
  problems,
};

const file = path.join(cfg.P.output, '题库.json');
U.writeFileAtomic(file, JSON.stringify(out, null, 1));
const back = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('题库.json 已导出:', back.stats.total, '题 | 对齐', back.stats.aligned, '(' + ((back.stats.aligned / back.stats.total) * 100).toFixed(1) + '%) | 顺序兜底', back.stats.sequential_matched, '| 孤儿解析', back.stats.orphan_solutions, '|', (fs.statSync(file).size / 1024 / 1024).toFixed(2) + 'MB');
