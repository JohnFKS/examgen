'use strict';
/** 语料装配：把 date1 下的 6 类输入解析成结构化对象，并缓存 */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');
const { parseBook, align, summarize } = require('./books');
const { cleanMd, headingsToEntries } = require('./markdown');
const repair = require('./repair');

function readInput(file) {
  return fs.readFileSync(path.join(cfg.P.input, file), 'utf8');
}

function load(opts) {
  const s = cfg.load();
  const files = s.input.files.length ? s.input.files : cfg.discoverInputFiles(cfg.P.input);
  const buckets = {};
  for (const f of files) (buckets[f.role] = buckets[f.role] || []).push(f);

  const problems = [];
  const warnings = [];
  for (const f of buckets.problemBook || []) {
    const r = parseBook(readInput(f.file), { kind: 'problem', book: f.file });
    problems.push(...r.items);
    warnings.push(...r.warnings.map((w) => `[${f.file}] ${w}`));
  }
  const solutions = [];
  for (const f of buckets.solutionBook || []) {
    const r = parseBook(readInput(f.file), { kind: 'solution', book: f.file });
    solutions.push(...r.items);
    warnings.push(...r.warnings.map((w) => `[${f.file}] ${w}`));
  }
  // AI 校验修复（匹配环节）：存在 data/repairs.json 时，把被吞并的题目/解析按 AI 锚点切出并补上序号
  repair.applyFromFiles(problems, solutions);
  const stat = align(problems, solutions);
  problems.sort((a, b) => a.chapterNo - b.chapterNo || a.tier.localeCompare(b.tier) || a.section.localeCompare(b.section) || a.no - b.no);

  const lectures = {};
  for (const f of buckets.syllabus || []) {
    const key = f.lectureKey || f.file.replace(/\.md$/, '');
    const md = cleanMd(readInput(f.file));
    lectures[key] = {
      key,
      file: f.file,
      md,
      outline: headingsToEntries(md).map((e) => ({ level: e.level, title: e.title, excerpt: e.body.trim().slice(0, 400) })),
      examPoints: pointsOfLecture(key, md),
    };
  }

  const formulaEntries = [];
  for (const f of buckets.formula || []) formulaEntries.push(...headingsToEntries(readInput(f.file)));

  const seeds = (buckets.seedTemplate || []).map((f) => {
    const raw = readInput(f.file);
    const front = /^---\n([\s\S]*?)\n---/.exec(raw);
    const base = path.basename(f.file);
    const title = base.replace(/-破天学长的文章\.md$/, '').replace(/\.md$/, '');
    return { file: f.file, title, front: front ? front[1] : '', md: cleanMd(front ? raw.slice(front[0].length) : raw) };
  });

  const chapterMeta = s.chapterMap.map((c) => {
    const list = problems.filter((p) => p.chapterNo === c.no);
    const lect = (c.lectures || []).map((k) => lectures[k]).filter(Boolean);
    const points = lect.reduce((a, l) => a.concat(l.examPoints), []);
    return {
      ...c,
      problemCount: list.length,
      solutionCount: solutions.filter((x) => x.chapterNo === c.no).length,
      matchedCount: list.filter((p) => p.solution).length,
      examPointCount: points.length,
      lectureKeys: lect.map((l) => l.key),
    };
  });

  return {
    generatedAt: U.nowStamp(),
    problems,
    solutions,
    stats: { ...stat, byChapter: summarize(problems), total: problems.length, solutionTotal: solutions.length },
    warnings,
    lectures,
    formulaEntries,
    seeds,
    chapters: chapterMeta,
    files: files,
    loadOpts: opts || {},
  };
}

/** 讲义 -> 考点条目：取 2~4 级标题 + 「注/定理/性质」等加粗术语 */
function extractExamPoints(md) {
  const out = [];
  const seen = new Set();
  let owner = null;
  for (const line of md.split('\n')) {
    const h = /^(#{2,5})\s+(.+)$/.exec(line);
    if (h) {
      const t = h[2].replace(/\*\*/g, '').trim();
      if (!t || t.length > 40 || /第.+部分|^\s*$/.test(t)) continue;
      const reg = regionOfTitle(t);
      if (reg) {
        owner = reg;
        continue;
      }
      const clean = t.replace(/^[一二三四五六七八九十]+[、.]\s*/, '').replace(/^[A-Z][.、]\s*/, '').replace(/^[（(]\d+[)）]\s*/, '').replace(/^\d+[.、]\s*/, '');
      if (clean.length < 2) continue;
      const key = clean;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ point: clean, level: h[1].length, from: 'outline', owner });
      }
      continue;
    }
    const b = /^\*\*([^*]{2,30})\*\*/.exec(line.trim());
    if (b && /定理|性质|公式|准则|定义|判别|条件|法/.test(b[1])) {
      if (!seen.has(b[1])) {
        seen.add(b[1]);
        out.push({ point: b[1], level: 6, from: 'bold', owner });
      }
    }
  }
  return out;
}

/** 讲义自身的章节归属（形如「章节三」）；用于剔除跨章串档内容 */
function ownRegion(key) {
  return regionOfTitle(String(key || '').trim());
}

/** 序号只取一个汉字数词或一串数字：否则「章节七二重积分」会把标题里的「二」吞进序号 */
function regionOfTitle(title) {
  const m = /^章节\s*([一二三四五六七八九十]|\d+)/.exec(String(title || '').trim());
  return m ? '章节' + m[1] : null;
}

/** 只保留归属本讲义章节的考点（部分 PDF 讲义末尾附带下一章内容，串档会污染覆盖口径） */
function pointsOfLecture(key, md) {
  const own = ownRegion(key);
  const pts = extractExamPoints(md);
  // 无主考点只在整篇都没有本章章节标记时才可信；否则视为上一章首页串档（如「章节七」首页顶着的「（八）……」）
  const anchored = own && pts.some((p) => p.owner === own);
  return pts.filter((p) => p.owner === own || (!anchored && !p.owner));
}

/** 缓存装配结果（大文件，避免重复 OCR 清洗） */
function loadCached(force) {
  const file = path.join(cfg.P.problems, 'corpus.json');
  const stamp = file + '.stamp';
  const key = U.sha256(
    cfg
      .load()
      .input.files.map((f) => f.file + ':' + f.bytes)
      .join('|')
  );
  if (!force && U.readJson(stamp) === key) {
    const c = U.readJson(file);
    if (c) return c;
  }
  const corpus = load();
  U.writeJson(file, corpus);
  U.writeFileAtomic(stamp, JSON.stringify(key));
  U.logger.info('ingest', `语料装配完成：题目 ${corpus.problems.length} 道，解析 ${corpus.solutions.length} 条，匹配率 ${(corpus.stats.coverage * 100).toFixed(1)}%`);
  return corpus;
}

module.exports = { load, loadCached, extractExamPoints, pointsOfLecture, ownRegion, regionOfTitle };
