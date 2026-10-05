'use strict';
/** 题库（做题本）与答案（解析册）解析，按「章 /  tier / 节 / 题号」四级对齐 */
const U = require('../lib/util');
const { cleanMd } = require('./markdown');

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cn2num(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(s)) return 10 + CN[s[1]];
  if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(s)) return CN[s[0]] * 10 + (s[1] ? CN[s[1]] : 0);
  return CN[s] || null;
}

const RE_CHAPTER = /^#{1,3}\s*第([一二三四五六七八九十]+|\d+)章\s*[、,，.]?\s*(.*)$/;
const RE_TIER = /^#{3,5}\s*(基础题|综合题|拓展题)\s*$/;
const RE_SECTION = /^#{2,5}\s*(?:[一二三四五六]\s*、\s*)?(选择题|填空题|解答题|计算题|证明题)\s*$/;
const RE_ITEM = /^[（(](\d{1,3})[)）]\s*(.*)$/; // OCR 括号全/半角混用，两者都接受

/**
 * @param {string} raw  markdown 原文
 * @param {object} opts { kind: 'problem'|'solution', book }
 */
function parseBook(raw, opts) {
  const kind = opts.kind;
  const text = cleanMd(raw);
  const lines = text.split('\n');
  const items = [];
  const warnings = [];

  let chapterNo = null,
    chapterTitle = '',
    tier = '基础题',
    section = '选择题';
  let cur = null,
    expected = 1;

  const push = () => {
    if (!cur) return;
    cur.body = cur.bodyLines.join('\n').trim();
    delete cur.bodyLines;
    items.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ch = RE_CHAPTER.exec(line);
    if (ch) {
      push();
      chapterNo = cn2num(ch[1]);
      chapterTitle = (ch[2] || '').replace(/#\s*$/, '').trim();
      tier = '基础题';
      section = '未分类';
      expected = 1;
      continue;
    }
    const ti = RE_TIER.exec(line);
    if (ti) {
      push();
      tier = ti[1];
      expected = 1;
      continue;
    }
    const se = RE_SECTION.exec(line);
    if (se) {
      push();
      section = se[1];
      expected = 1;
      continue;
    }
    // 目录页/页码行：形如 "基础题 ..... 1"
    if (/\.{4,}\s*\d+/.test(line)) continue;

    const it = RE_ITEM.exec(line);
    if (it && chapterNo != null) {
      const num = parseInt(it[1], 10);
      const looksStem = it[2].length > 0 || kind === 'solution';
      if (num >= expected && num <= expected + 3 && looksStem) {
        const dupId = `ch${chapterNo}-${tierCode(tier)}-${secCode(section)}-${String(num).padStart(2, '0')}`;
        if (items.some((x) => x.id === dupId)) {
          // OCR 把同一题号拆成两段：并入已有题，不另建
          if (cur) cur.bodyLines.push(line);
          continue;
        }
        if (num > expected) warnings.push(`第${chapterNo}章 ${tier}/${section} 题号跳跃 ${expected}->${num}`);
        push();
        expected = num + 1;
        cur = {
          chapterNo,
          chapterTitle,
          tier,
          section,
          no: num,
          id: dupId,
          bodyLines: [it[2]],
          line: i + 1,
          book: opts.book,
        };
        continue;
      }
    }
    if (cur) cur.bodyLines.push(line);
  }
  push();

  // 拆分选项 / 答案
  for (const it of items) {
    if (kind === 'problem') {
      // 选项起点：行首的「A．/A./A、」，且其后确实存在 B、C、D 三项标记。
      // 早先按「A + 空白」切分会把题干里的矩阵名（"设 $ A $ 是 3 阶方阵"）当成 A 选项，题干被截成「设  $」。
      const m = /(?:^|\n)[ \t]*A[ \t]*[．.、]/.exec(it.body);
      const at = m ? m.index + m[0].lastIndexOf('A') : -1;
      const tail = at >= 0 ? it.body.slice(at) : '';
      if (at > 0 && /B[ \t]*[．.、]/.test(tail) && /C[ \t]*[．.、]/.test(tail) && /D[ \t]*[．.、]/.test(tail) && /[\u4e00-\u9fa5\\$]/.test(it.body.slice(0, at))) {
        it.stem = it.body.slice(0, at).trim();
        it.options = tail.trim().replace(/\n+/g, ' ');
      } else {
        it.stem = it.body;
        it.options = '';
      }
    } else {
      const m = /^\s*([A-D])\s*[．.、]?\s*(?:选项\s*[A-D]\s*正确)?\s*[\n。.]?/s.exec(it.body);
      it.answerLabel = it.section === '选择题' && m ? m[1] : '';
      it.solution = (m && it.section === '选择题' ? it.body.slice(m[0].length) : it.body).trim();
    }
    delete it.body;
  }
  return { items, warnings: Array.from(new Set(warnings)) };
}

function tierCode(t) {
  return t === '基础题' ? 'B' : t === '综合题' ? 'C' : 'E';
}
function secCode(s) {
  return s === '选择题' ? 'mc' : s === '填空题' ? 'fp' : s === '解答题' ? 'fr' : 'na';
}

/** 以题号 key 对齐题库与答案 */
function align(problems, solutions) {
  const idx = new Map();
  for (const s of solutions) idx.set(`${s.chapterNo}|${s.tier}|${s.section}|${s.no}`, s);
  const usedSolutions = new Set();
  let matched = 0;
  const orphanSolutions = [];
  for (const p of problems) {
    const s = idx.get(`${p.chapterNo}|${p.tier}|${p.section}|${p.no}`);
    if (s) {
      p.answerLabel = s.answerLabel || '';
      p.solution = s.solution || '';
      p.solutionLine = s.line;
      p.solutionBook = s.book;
      matched++;
      usedSolutions.add(s);
      idx.delete(`${p.chapterNo}|${p.tier}|${p.section}|${p.no}`);
    } else {
      p.answerLabel = '';
      p.solution = '';
    }
  }
  // 顺序兜底：剩余题目与剩余解析在章内按 (序号) 从前到后配对，优先同题型
  let seqMatched = 0;
  const restProblems = problems.filter((p) => !p.solution);
  const restSolutions = solutions.filter((s) => !usedSolutions.has(s));
  const queues = new Map(); // chapterNo -> Map(no -> [solution,...])
  for (const s of restSolutions) {
    if (!queues.has(s.chapterNo)) queues.set(s.chapterNo, new Map());
    const m = queues.get(s.chapterNo);
    if (!m.has(s.no)) m.set(s.no, []);
    m.get(s.no).push(s);
  }
  for (const p of restProblems) {
    const m = queues.get(p.chapterNo);
    const arr = m && m.get(p.no);
    if (arr && arr.length) {
      let i = arr.findIndex((s) => s.section === p.section);
      if (i < 0) i = 0;
      const s = arr.splice(i, 1)[0];
      p.answerLabel = s.answerLabel || '';
      p.solution = s.solution || '';
      p.solutionLine = s.line;
      p.solutionBook = s.book;
      p.alignVia = 'sequential';
      matched++;
      seqMatched++;
      usedSolutions.add(s);
    }
  }
  for (const s of solutions) if (!usedSolutions.has(s)) orphanSolutions.push(s.id);
  return { matched, seqMatched, orphanSolutions, coverage: problems.length ? matched / problems.length : 0 };
}

function summarize(items) {
  const by = {};
  for (const it of items) {
    const k = it.chapterNo;
    by[k] = by[k] || { chapterNo: k, chapterTitle: it.chapterTitle, total: 0, byTier: {}, bySection: {} };
    by[k].total++;
    by[k].byTier[it.tier] = (by[k].byTier[it.tier] || 0) + 1;
    by[k].bySection[it.section] = (by[k].bySection[it.section] || 0) + 1;
  }
  return Object.values(by).sort((a, b) => a.chapterNo - b.chapterNo);
}

module.exports = { parseBook, align, summarize, cn2num, cleanMd };
