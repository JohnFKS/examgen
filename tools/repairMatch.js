'use strict';
/**
 * AI 校验修复工具（匹配环节）
 *   node tools/repairMatch.js --detect   # 第一遍：扫描断号/错乱，导出候选与 AI 提示词
 *   node tools/repairMatch.js --apply    # 应用 data/repairs.json（AI 决策）并报告对齐效果
 * 测试模式：AI 决策由智能体阅读 data/repair-candidates.json 后写入 data/repairs.json；
 * live 模式：可用 src/ingest/repair.js 的 buildMessages 直接调用 LLM 层获得同样的决策 JSON。
 */
const fs = require('fs');
const path = require('path');
const U = require('../src/lib/util');
const cfg = require('../src/config');
const { parseBook, align } = require('../src/ingest/books');
const repair = require('../src/ingest/repair');

const files = cfg.load().input.files;
const read = (f) => fs.readFileSync(path.join(cfg.P.input, f), 'utf8');

function parseAll() {
  const problems = [];
  for (const f of files.filter((x) => x.role === 'problemBook')) problems.push(...parseBook(read(f.file), { kind: 'problem', book: f.file }).items);
  const solutions = [];
  for (const f of files.filter((x) => x.role === 'solutionBook')) solutions.push(...parseBook(read(f.file), { kind: 'solution', book: f.file }).items);
  return { problems, solutions };
}

function containerText(items, id, bodyKey) {
  const it = items.find((x) => x.id === id);
  return it ? it[bodyKey] || '' : '';
}

if (process.argv.includes('--detect')) {
  const { problems, solutions } = parseAll();
  const { candidates, byContainer } = repair.detect(problems, solutions);
  console.log('==== 第一遍扫描：断号 / 错乱标注 ====');
  console.log('候选', candidates.length, '处（涉及容器', byContainer.size, '个）');
  const out = { generatedAt: U.nowStamp(), groups: [] };
  for (const [cid, list] of byContainer) {
    const isProblem = list[0].kind === 'problem';
    const items = isProblem ? problems : solutions;
    const text = containerText(items, cid, isProblem ? 'stem' : 'solution');
    // 展示容器全文（AI 需要完整文本来定位切分点）
    out.groups.push({ containerId: cid, kind: list[0].kind, candidates: list, containerText: text.slice(-4000) });
    console.log('-', cid, '→ 缺号', list.map((c) => '(' + c.missingNum + ')').join(''), isProblem ? '【题目粘连】' : '');
  }
  U.writeFileAtomic(path.join('data', 'repair-candidates.json'), JSON.stringify(out, null, 1));
  console.log('候选与提示词已导出：data/repair-candidates.json');
  console.log('下一步：AI（测试模式=智能体）阅读后把决策写入 data/repairs.json：');
  console.log('  {"decisions":[{"kind":"solution","containerId":"...","splits":[{"missing_num":17,"anchor":"逐字锚点"}]}]}');
} else if (process.argv.includes('--apply')) {
  const { problems, solutions } = parseAll();
  const before = align(JSON.parse(JSON.stringify(problems)), JSON.parse(JSON.stringify(solutions)));
  const df = repair.decisionsFile();
  let data = { decisions: [] };
  try { data = JSON.parse(fs.readFileSync(df, 'utf8')); } catch (e) { console.log('未找到', df, '，先跑 --detect 并让 AI 生成决策'); }
  const stats = repair.applyDecisions(problems, solutions, data.decisions || []);
  const after = align(problems, solutions);
  console.log('==== AI 校验修复效果 ====');
  console.log('决策:', (data.decisions || []).length, '组 | 应用切分:', stats.applied, '| 锚点未命中:', stats.notFound, '| 跳过:', stats.skipped);
  console.log('对齐率: 修复前', before.matched, '(' + (before.coverage * 100).toFixed(1) + '%) → 修复后', after.matched, '(' + (after.coverage * 100).toFixed(1) + '%)');
  const miss = problems.filter((p) => !p.solution);
  const missBy = {};
  for (const p of miss) missBy[p.chapterNo] = (missBy[p.chapterNo] || 0) + 1;
  console.log('未对齐题:', before.matched && miss.length, '道 → 剩', miss.length, '道, 按章:', JSON.stringify(missBy));
  console.log('孤儿解析:', after.orphanSolutions.length, JSON.stringify(after.orphanSolutions));
} else {
  console.log('用法: node tools/repairMatch.js --detect | --apply');
}
