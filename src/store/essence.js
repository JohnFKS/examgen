'use strict';
/** 本质相似度（字符 bigram + 关键术语）——用于确定性去冗余与校验兜底 */
const STOP = new Set('的了与和及或用对为在有中将则其此等该进行通过可以利用不再的方'.split(''));

function grams(s) {
  const t = String(s || '').replace(/[^一-龥A-Za-z]/g, '');
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  for (const c of t) if (!STOP.has(c)) g.add('§' + c);
  return g;
}

function similarity(a, b) {
  const A = grams(a),
    B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  return inter / Math.sqrt(A.size * B.size);
}

function matrix(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const s = similarity(items[i].essence, items[j].essence);
      if (s >= 0.5) out.push({ a: items[i].id, b: items[j].id, sa: s.toFixed(3) });
    }
  }
  return out.sort((x, y) => y.sa - x.sa);
}

module.exports = { similarity, matrix };
