'use strict';
/** 扫描做题本解析里「选项误切」：把题干里的矩阵名 A 当作 A 选项起点 */
const corpus = require('/workspace/examgen/src/ingest/corpus');
const c = corpus.loadCached();
const byCh = {};
const rows = [];
for (const p of c.problems) {
  const opt = String(p.options || '');
  if (!opt) continue;
  const ok = /B\s*[．.、]/.test(opt) && /C\s*[．.、]/.test(opt) && /D\s*[．.、]/.test(opt);
  if (ok) continue;
  byCh[p.chapterNo] = (byCh[p.chapterNo] || 0) + 1;
  rows.push(`${p.id} | stem尾「${String(p.stem).slice(-26)}」 | opt首「${opt.slice(0, 34)}」`);
}
console.log('疑似误切条数', rows.length, JSON.stringify(byCh));
console.log(rows.join('\n'));
