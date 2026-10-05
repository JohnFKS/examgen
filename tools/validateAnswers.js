'use strict';
/** 答案校验：结构与 problem_id 必须与任务包一致 */
const fs = require('fs');
const path = require('path');
const U = require('../src/lib/util');

const dir = process.argv[2] || path.join(U.ROOT, 'agent-work');
const only = process.argv[3] || '';
const problems = new Map();
let total = 0;
const errs = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.task.json')) continue;
  const t = U.readJson(path.join(dir, f));
  if (only && t.skill !== only) continue;
  total++;
  const ans = path.join(dir, t.key + '.answer.json');
  if (!fs.existsSync(ans)) {
    errs.push({ key: t.key, skill: t.skill, problem: '缺少答案文件' });
    continue;
  }
  let a;
  try {
    a = U.readJson(ans);
    if (a === null) throw new Error('空');
  } catch (e) {
    errs.push({ key: t.key, skill: t.skill, problem: '答案不是合法 JSON：' + e.message });
    continue;
  }
  if (t.skill === 'problem-decompose') {
    const items = a.items || [];
    const ids = items.map((i) => i.problem_id);
    const missing = t.problem_ids.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !t.problem_ids.includes(id));
    if (missing.length) errs.push({ key: t.key, skill: t.skill, problem: '缺少题目 ' + missing.join(',') });
    if (extra.length) errs.push({ key: t.key, skill: t.skill, problem: '多余题目 ' + extra.join(',') });
    items.forEach((i) => {
      const bad = [];
      if (!i.surface_type) bad.push('surface_type 空');
      if (!i.essence || i.essence.length < 8) bad.push('essence 过短');
      if (!Array.isArray(i.steps) || i.steps.length < 3) bad.push('steps 少于3步');
      if (!i.boundaries || !(i.boundaries.applicable || []).length || !(i.boundaries.invalid || []).length) bad.push('boundaries 不完整');
      if (!Array.isArray(i.exam_points) || !i.exam_points.length) bad.push('exam_points 空');
      if (bad.length) errs.push({ key: t.key, skill: t.skill, problem: i.problem_id + ': ' + bad.join('；') });
      (i.steps || []).forEach((s) => {
        if (/[\d]{2,}|\\frac\{\d+\}/.test(s)) problems.set(i.problem_id + ' 步骤含具体数值: ' + s.slice(0, 40), 1);
      });
    });
  } else if (t.skill === 'seed-import') {
    const list = a.templates || [];
    if (!list.length) errs.push({ key: t.key, skill: t.skill, problem: 'templates 为空' });
    list.forEach((x, i) => {
      const bad = [];
      if (!x.name) bad.push('name 空');
      if (!x.essence || x.essence.length < 8) bad.push('essence 过短');
      if (!Array.isArray(x.steps) || x.steps.length < 3) bad.push('steps 少于3步');
      if (!x.boundaries || !(x.boundaries.invalid || []).length) bad.push('boundaries 不完整');
      if (!Array.isArray(x.exam_points) || !x.exam_points.length) bad.push('exam_points 空');
      if (x.chapter_no != null && !(x.chapter_no >= 1 && x.chapter_no <= 12)) bad.push('chapter_no 越界');
      if (bad.length) errs.push({ key: t.key, skill: t.skill, problem: '#' + (i + 1) + ' ' + (x.name || '') + ': ' + bad.join('；') });
    });
  }
}
console.log(`校验 ${total} 个任务包：错误 ${errs.length}，告警 ${problems.size}`);
errs.forEach((e) => console.log(`  ✗ [${e.skill}] ${e.key.slice(0, 8)} ${e.problem}`));
Array.from(problems.keys()).forEach((w) => console.log(`  ! ${w}`));
process.exitCode = errs.length ? 1 : 0;
