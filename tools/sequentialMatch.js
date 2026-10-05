'use strict';
/**
 * 顺序匹配程序：题库与解析册都按 (序号) 编号。
 * 从前到后逐题对照：每章内维护「序号 -> 解析队列」，题目按出现顺序消费同序号的第一条未用解析。
 * 产出：
 *   1. 匹配效果报告（与现有四级 key 对齐对比）
 *   2. output/题库对照解析.md（题目 + 答案 + 解析 拼接）
 * 用法：node tools/sequentialMatch.js [--md]
 */
const fs = require('fs');
const path = require('path');
const U = require('../src/lib/util');
const cfg = require('../src/config');
const { parseBook, align } = require('../src/ingest/books');

function readInput(file) {
  return fs.readFileSync(path.join(cfg.P.input, file), 'utf8');
}

const s = cfg.load();
const files = s.input.files.length ? s.input.files : cfg.discoverInputFiles(cfg.P.input);
const problemBooks = files.filter((f) => f.role === 'problemBook');
const solutionBooks = files.filter((f) => f.role === 'solutionBook');

const problems = [];
for (const f of problemBooks) problems.push(...parseBook(readInput(f.file), { kind: 'problem', book: f.file }).items);
const solutions = [];
for (const f of solutionBooks) solutions.push(...parseBook(readInput(f.file), { kind: 'solution', book: f.file }).items);

/* ---------- 顺序匹配（每章内，序号队列，从前到后） ---------- */
function alignSequential(problems, solutions) {
  // 每章按文件出现顺序建「序号 -> 队列」
  const queues = new Map(); // chapterNo -> Map(no -> [solution,...])
  for (const sol of solutions) {
    if (!queues.has(sol.chapterNo)) queues.set(sol.chapterNo, new Map());
    const m = queues.get(sol.chapterNo);
    if (!m.has(sol.no)) m.set(sol.no, []);
    m.get(sol.no).push(sol);
  }
  let matched = 0;
  const orphanSolutions = [];
  const detail = [];
  for (const p of problems) {
    const q = queues.get(p.chapterNo);
    const arr = q && q.get(p.no);
    if (arr && arr.length) {
      const sol = arr.shift();
      p.answerLabel = sol.answerLabel || '';
      p.solution = sol.solution || '';
      p.solutionLine = sol.line;
      p.solutionBook = sol.book;
      p.solutionTier = sol.tier;
      p.solutionSection = sol.section;
      matched++;
      detail.push({ problem: p, solution: sol });
    } else {
      p.answerLabel = '';
      p.solution = '';
      detail.push({ problem: p, solution: null });
    }
  }
  for (const [, m] of queues) for (const [, arr] of m) orphanSolutions.push(...arr.map((x) => x.id));
  return { matched, orphanSolutions, detail };
}

/* ---------- 现有四级 key 对齐（对照组） ---------- */
function alignFourLevel(problems, solutions) {
  const r = align(problems, solutions); // 就地修改副本
  const pair = new Map();
  for (const p of problems) if (p.solutionLine) pair.set(p.id, p.chapterNo + '|' + p.tier + '|' + p.section + '|' + p.no + '#' + p.solutionLine);
  return { matched: r.matched, orphanSolutions: r.orphanSolutions, pair };
}

const problemsA = JSON.parse(JSON.stringify(problems));
const problemsB = JSON.parse(JSON.stringify(problems));
const seq = alignSequential(problemsA, solutions.map((x) => JSON.parse(JSON.stringify(x))));
const four = alignFourLevel(problemsB, solutions);

/* ---------- 对比报告 ---------- */
const seqPair = new Map();
for (const d of seq.detail) if (d.solution) seqPair.set(d.problem.id, d.solution.chapterNo + '|' + d.solution.tier + '|' + d.solution.section + '|' + d.solution.no + '#' + d.solution.line);

let identical = 0, newOnly = 0, fourOnly = 0;
const newPairs = [], lostPairs = [];
for (const [id, k] of seqPair) {
  if (four.pair.has(id)) { if (four.pair.get(id) === k) identical++; else { newPairs.push(id + ' (配对不同)'); } }
  else { newOnly++; newPairs.push(id + ' (新增)'); }
}
for (const [id] of four.pair) if (!seqPair.has(id)) { fourOnly++; lostPairs.push(id); }

// 顺序配对的层级一致性（题目层头 vs 解析册层头）：验证顺序可信度
let tierAgree = 0, secAgree = 0, pairedN = 0;
for (const d of seq.detail) {
  if (!d.solution) continue;
  pairedN++;
  if (d.problem.tier === d.solution.tier) tierAgree++;
  if (d.problem.section === d.solution.section) secAgree++;
}

console.log('==== 匹配效果报告 ====');
console.log('题目', problems.length, '道 | 解析', solutions.length, '条');
console.log('四级 key 对齐（现状）:', four.matched, '(' + (four.matched / problems.length * 100).toFixed(1) + '%)  孤儿解析', four.orphanSolutions.length);
console.log('顺序匹配（本法）  :', seq.matched, '(' + (seq.matched / problems.length * 100).toFixed(1) + '%)  孤儿解析', seq.orphanSolutions.length);
console.log('两法配对完全一致:', identical, '| 顺序法新增:', newOnly, '| 仅四级法有:', fourOnly);
if (newPairs.length) console.log('新增/不同配对样例:', newPairs.slice(0, 12).join('；'));
if (lostPairs.length) console.log('四级法独有配对样例:', lostPairs.slice(0, 12).join('；'));
console.log('配对层级一致性: 难度层', tierAgree + '/' + pairedN, '题型', secAgree + '/' + pairedN, '（解析册缺头会拉低此值，不影响顺序匹配本身）');

/* ---------- 生成 题目+解析 合并 md ---------- */
if (process.argv.includes('--md')) {
  const out = ['# 李林880题库·题目解析对照版', '', '> 顺序匹配生成：题目在前，解析紧随其后；每题一行题号锚点，便于人工核对。', ''];
  let lastChapter = null, lastTier = null, lastSection = null;
  for (const d of seq.detail) {
    const p = d.problem;
    if (p.chapterNo !== lastChapter) {
      lastChapter = p.chapterNo; lastTier = null; lastSection = null;
      out.push('', '---', '', '# 第' + p.chapterNo + '章 ' + (p.chapterTitle || ''), '');
    }
    if (p.tier !== lastTier) { lastTier = p.tier; lastSection = null; out.push('', '## ' + p.tier, ''); }
    if (p.section !== lastSection) { lastSection = p.section; out.push('', '### ' + p.section, ''); }
    out.push('**(' + p.no + ') ' + p.id + '** ' + (p.stem || '').replace(/\n+/g, ' '));
    if (p.options) out.push('', p.options.replace(/\n+/g, ' '));
    if (p.answerLabel) out.push('', '**【答案】** ' + p.answerLabel);
    out.push('', p.solution ? '**【解析】**\n\n' + p.solution : '*【解析】（解析册未匹配到本题）*', '');
  }
  // 未匹配解析附录
  const orphans = seq.orphanSolutions;
  if (orphans.length) {
    out.push('', '---', '', '# 附录：未匹配到的解析（' + orphans.length + ' 条）', '');
    const solById = new Map(solutions.map((x) => [x.id, x]));
    for (const oid of orphans) {
      const sol = solById.get(oid);
      out.push('', '**' + oid + '**', '', sol ? sol.solution.slice(0, 600) : '', '');
    }
  }
  const file = path.join(cfg.P.output, '题库对照解析.md');
  U.writeFileAtomic(file, out.join('\n'));
  console.log('已生成', file, (fs.statSync(file).size / 1024 / 1024).toFixed(2) + 'MB');
}
