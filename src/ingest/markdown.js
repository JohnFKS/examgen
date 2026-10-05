'use strict';
/** OCR markdown 清洗与轻量检索（零依赖） */

const NOISE = [
  /最新考研资料关注微信公众号【大鱼考研】免费分享/g,
  /开课第一句话：本课程是专业帮助考研拿分的，不适合培养数学家！/g,
];

/** 去掉 OCR 产生的图片占位、外链追踪、水印噪声 */
function cleanMd(text) {
  let t = String(text);
  t = t.replace(/<div[^>]*>\s*<img[^>]*\/?>\s*<\/div>/gi, '\n');
  t = t.replace(/<img[^>]*\/?>/gi, '');
  t = t.replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // [文字](https://zhida.zhihu.com/... 或 zhuanlan 追踪链接) -> 文字
  t = t.replace(/\[([^\]]+)\]\((?:https?:\/\/[^\s)]*zhida\.zhihu[^\s)]*|about:blank)\)/g, '$1');
  for (const re of NOISE) t = t.replace(re, '');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** 提取 $...$ / $$...$$ 之外的纯中文文字，用于检索打分 */
function plainText(md) {
  return String(md)
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[#*>`|_-]/g, ' ');
}

function bigrams(str) {
  const s = str.replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 词 + bigram 混合打分，返回带分数的片段 */
function retrieve(query, entries, k) {
  const qTerms = new Set(
    String(query)
      .replace(/\s+/g, '')
      .match(/[\u4e00-\u9fa5]{2,6}/g) || []
  );
  const qb = bigrams(query);
  const scored = entries.map((e) => {
    const body = e.body || e.text || '';
    const p = plainText(body);
    const bb = bigrams(p);
    let inter = 0;
    qb.forEach((g) => {
      if (bb.has(g)) inter++;
    });
    const jacc = qb.size + bb.size ? inter / Math.max(4, Math.min(qb.size, bb.size)) : 0;
    let hit = 0;
    qTerms.forEach((t) => {
      if (t.length >= 2 && p.includes(t)) hit += t.length;
    });
    return { entry: e, score: jacc * 1.6 + hit * 0.35 };
  });
  return scored
    .filter((x) => x.score > 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, k || 3)
    .map((x) => x.entry);
}

function headingsToEntries(md) {
  const lines = cleanMd(md).split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { title: m[2].trim().replace(/\s*\.{2,}\s*\d*\s*$/, ''), level: m[1].length, body: '' };
    } else if (cur) {
      cur.body += line + '\n';
    }
  }
  if (cur) out.push(cur);
  return out.filter((e) => e.body.trim().length > 0);
}

module.exports = { cleanMd, plainText, bigrams, retrieve, headingsToEntries };
