'use strict';
/** 对比选项切分修复前后的做题本解析：题数、题面变化数、被拆解层跳过的短题面数 */
const fs = require('fs');
const oldC = JSON.parse(fs.readFileSync('/workspace/examgen/.trash/pre-option-fix/corpus.json', 'utf8'));
const corpus = require('/workspace/examgen/src/ingest/corpus');
const newC = corpus.load(true);
const oldById = new Map(oldC.problems.map((p) => [p.id, p]));
const stat = {};
let added = 0, removed = 0, changedStem = 0, changedOpt = 0;
for (const p of newC.problems) {
  const o = oldById.get(p.id);
  const ch = p.chapterNo;
  stat[ch] = stat[ch] || { n: 0, short: 0, shortOld: 0 };
  stat[ch].n++;
  if (!o) { added++; continue; }
  if (String(p.stem).length <= 6) stat[ch].short++;
  if (String(o.stem).length <= 6) stat[ch].shortOld++;
  if (String(p.stem) !== String(o.stem)) changedStem++;
  if (String(p.options) !== String(o.options)) changedOpt++;
}
for (const [id, o] of oldById) if (!newC.problems.some((p) => p.id === id)) { removed++; console.log('新解析缺题', id); }
console.log('题数 旧', oldById.size, '新', newC.problems.length, '增', added, '删', removed, '题面变化', changedStem, '选项变化', changedOpt);
for (const ch of Object.keys(stat).sort((a, b) => a - b)) console.log(' ch' + ch, JSON.stringify(stat[ch]));
console.log('解析册对齐：旧', oldC.problems.filter((p) => p.solution).length, '新', newC.problems.filter((p) => p.solution).length);
console.log('考点清单 ch7：', (newC.chapters.find((c) => c.no === 7) || {}).lectures ? JSON.stringify(newC.chapters.filter((c) => c.no === 7).map((c) => c.lectures)) : '?');
