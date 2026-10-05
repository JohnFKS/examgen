'use strict';
/**
 * 匹配环节 · AI 校验修复模块
 * 作用：OCR 会整行丢失 (序号) 标记，导致题目/解析被吞并进前一条的尾部，四级 key 与顺序兜底都无从对齐。
 * 流程：
 *   1) detect()      —— 确定性扫描：按「章/层/型」组找断号，定位每个断号的容器（书序中前一条 item）与参照物；
 *   2) buildMessages() —— 为每个容器组构建 AI 分离提示词（测试模式由智能体作答，live 模式可直接调 LLM 层）；
 *   3) applyDecisions() —— 按 AI 给出的文本锚点把新题/新解析从容器尾部切出，补上正确序号。
 * AI 决策落盘于 data/repairs.json（测试模式=智能体作答；live 模式=LLM 返回），corpus.load() 在 parseBook 之后、
 * align 之前自动应用（无决策文件时跳过并提示）。锚点找不到时跳过并告警，保证幂等安全。
 */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');

const RE_ANY_ITEM = /^\s*[（(](\d{1,3})[)）]\s*/;

function decisionsFile() {
  return path.join(cfg.P.root || process.cwd(), 'data', 'repairs.json');
}

/** 断号检测：返回按容器分组的候选 */
function detect(problems, solutions) {
  const pMap = new Map(problems.map((p) => [p.chapterNo + '|' + p.tier + '|' + p.section + '|' + p.no, p]));
  const bookOrder = solutions.slice(); // parseBook 保持书序
  const groups = new Map();
  bookOrder.forEach((s, i) => {
    const k = s.chapterNo + '|' + s.tier + '|' + s.section;
    if (!groups.has(k)) groups.set(k, { idxs: [], order: [] });
    groups.get(k).idxs.push(i);
  });
  const candidates = [];
  for (const [key, g] of groups) {
    const nos = g.idxs.map((i) => bookOrder[i].no);
    const max = Math.max(...nos);
    for (let no = 1; no <= max; no++) {
      if (nos.includes(no)) continue;
      const prob = pMap.get(key + '|' + no);
      if (!prob) continue; // 题库也没有该题号，无需修复
      // 容器 = 书序中紧跟在该缺失位置之前的解析条
      const beforeIdx = g.idxs.filter((i) => bookOrder[i].no < no);
      const container = beforeIdx.length ? bookOrder[beforeIdx[beforeIdx.length - 1]] : bookOrder[Math.max(0, g.idxs[0] - 1)];
      candidates.push({
        kind: 'solution',
        chapterNo: bookOrder[g.idxs[0]].chapterNo,
        tier: bookOrder[g.idxs[0]].tier,
        section: bookOrder[g.idxs[0]].section,
        missingNum: no,
        containerId: container.id,
        containerRef: container.book + '#L' + container.line,
        refStem: (prob.stem || '').slice(0, 260),
        problemId: prob.id,
      });
    }
  }
  // 题库断号（参照物=孤儿解析）
  const solMap = new Map(solutions.map((s) => [s.chapterNo + '|' + s.tier + '|' + s.section + '|' + s.no, s]));
  const pgroups = new Map();
  problems.forEach((p, i) => {
    const k = p.chapterNo + '|' + p.tier + '|' + p.section;
    if (!pgroups.has(k)) pgroups.set(k, { idxs: [] });
    pgroups.get(k).idxs.push(i);
  });
  for (const [key, g] of pgroups) {
    const nos = g.idxs.map((i) => problems[i].no);
    const max = Math.max(...nos);
    for (let no = 1; no <= max; no++) {
      if (nos.includes(no)) continue;
      const sol = solMap.get(key + '|' + no);
      if (!sol) continue; // 解析也没有，无从参照
      const beforeIdx = g.idxs.filter((i) => problems[i].no < no);
      const container = beforeIdx.length ? problems[beforeIdx[beforeIdx.length - 1]] : problems[Math.max(0, g.idxs[0] - 1)];
      candidates.push({
        kind: 'problem',
        chapterNo: problems[g.idxs[0]].chapterNo,
        tier: problems[g.idxs[0]].tier,
        section: problems[g.idxs[0]].section,
        missingNum: no,
        containerId: container.id,
        containerRef: container.book + '#L' + container.line,
        refStem: (sol.solution || '').slice(0, 260),
        problemId: key + '-' + String(no).padStart(2, '0'),
      });
    }
  }
  // 按容器分组（同一容器可能连吞多题）
  const byContainer = new Map();
  for (const c of candidates) {
    if (!byContainer.has(c.containerId)) byContainer.set(c.containerId, []);
    byContainer.get(c.containerId).push(c);
  }
  return { candidates, byContainer };
}

/** 为一个容器组构建 AI 分离提示词 */
function buildMessages(groupCandidates, containerText) {
  const lines = groupCandidates.map((c, i) =>
    `${i + 1}. 断号 (${c.missingNum})｜参照${c.kind === 'solution' ? '题干' : '已存在的解析'}：${c.refStem.replace(/\s+/g, ' ')}`
  );
  return [
    { role: 'system', content: '你是 OCR 数学语料修复专家。给定的文本是某一道题的解析（或题干），但其后粘连了后续题目的内容（OCR 丢失了后续题目的 (序号) 行）。你的任务：判断粘连内容是否存在，若存在，给出每段新内容的起始锚点文本（从原文逐字复制、8~30 字、不得改写），以及它对应的断号。只输出合法 JSON。' },
    { role: 'user', content: [
      '【容器】' + groupCandidates[0].containerId + '（' + groupCandidates[0].tier + '/' + groupCandidates[0].section + '）',
      '【断号清单】',
      lines.join('\n'),
      '',
      '【容器全文】',
      containerText,
      '',
      '【输出 JSON schema】',
      '{"decisions":[{"missing_num":0,"anchor":"容器全文中逐字存在的文本片段(新内容起始处,8~30字)","reason":"为何此处切分"}]} 或 {"decisions":[]}（容器内不含被吞内容时返回空）',
      '注意：锚点必须是容器全文中逐字存在且唯一的片段；多段粘连时按出现顺序给出；正文中的小题 (1)(2) 编号不是断号，勿误判。',
    ].join('\n') },
  ];
}

/** 应用 AI 决策：从容器尾部切出新 item（就地修改 items 数组，返回修复统计） */
function applyDecisions(problems, solutions, decisions) {
  const stats = { applied: 0, skipped: 0, notFound: 0 };
  for (const d of decisions) {
    const isProblem = d.kind === 'problem';
    const items = isProblem ? problems : solutions;
    const container = items.find((x) => x.id === d.containerId);
    if (!container) { stats.skipped++; continue; }
    const bodyKey = isProblem ? 'stem' : 'solution';
    const body = container[bodyKey] || '';
    // 定位锚点并按出现顺序排列
    const marks = [];
    for (const sp of d.splits || []) {
      const pos = body.indexOf(sp.anchor);
      if (pos < 0) { stats.notFound++; continue; }
      marks.push({ num: sp.missing_num != null ? sp.missing_num : sp.missingNum, pos });
    }
    if (!marks.length) continue;
    marks.sort((a, b) => a.pos - b.pos);
    // 容器只保留第一锚点之前的内容
    container[bodyKey] = body.slice(0, marks[0].pos).trim();
    const tierCode = container.tier === '基础题' ? 'B' : container.tier === '综合题' ? 'C' : 'E';
    const secCode = container.section === '选择题' ? 'mc' : container.section === '填空题' ? 'fp' : 'fr';
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].pos;
      const end = i + 1 < marks.length ? marks[i + 1].pos : body.length;
      const text = body.slice(start, end).trim();
      if (!text) continue;
      const id = 'ch' + container.chapterNo + '-' + tierCode + '-' + secCode + '-' + String(marks[i].num).padStart(2, '0');
      let item;
      if (isProblem) {
        const stem = text.replace(/^\s*[(（]?\d{1,3}[)）]?\s*/, '').trim();
        item = {
          chapterNo: container.chapterNo, chapterTitle: container.chapterTitle, tier: container.tier,
          section: container.section, no: marks[i].num, id, stem, options: '',
          line: container.line, book: container.book, repaired: true,
        };
        const om = /^(.*?)(A[．.、\s].*)$/s.exec(item.stem);
        if (om && /[\u4e00-\u9fa5\\$]/.test(om[1])) { item.stem = om[1].trim(); item.options = om[2].trim().replace(/\n+/g, ' '); }
      } else {
        let label = '';
        let sol = text;
        if (container.section === '选择题') {
          const lm = /^\s*\$\$\s*[(（]\d{1,3}[)）]\s*([A-D])[.．、]?\s*\$\$\s*/
            .exec(text) || /^\s*[(（]\d{1,3}[)）]\s*([A-D])[.．、]?\s*/
            .exec(text) || /^\s*([A-D])[.．、]\s*/.exec(text);
          if (lm) { label = lm[1]; sol = text.slice(lm[0].length).trim(); }
        }
        item = {
          chapterNo: container.chapterNo, chapterTitle: container.chapterTitle, tier: container.tier,
          section: container.section, no: marks[i].num, id,
          answerLabel: label,
          solution: sol,
          line: container.line, book: container.book, repaired: true,
        };
      }
      if (items.some((x) => x.id === item.id)) { stats.skipped++; continue; }
      items.push(item);
      stats.applied++;
    }
  }
  return stats;
}

/** corpus.load() 的挂载点：存在 AI 决策文件则应用 */
function applyFromFiles(problems, solutions) {
  const f = decisionsFile();
  let data;
  try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
  const stats = applyDecisions(problems, solutions, data.decisions || []);
  U.logger.info('repair', `AI 校验修复：应用 ${stats.applied} 段（跳过 ${stats.skipped}，锚点未命中 ${stats.notFound}）`);
  return stats;
}

module.exports = { detect, buildMessages, applyDecisions, applyFromFiles, decisionsFile };
