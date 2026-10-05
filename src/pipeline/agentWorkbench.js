'use strict';
/**
 * 测试模式工作台：把「待智能体作答任务」压缩成可读工作包。
 * 生产模式无需使用；测试模式下由智能体（大模型角色）按工作包产出答案 JSON。
 */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');
const llm = require('../llm');

const WORK = path.join(cfg.P.root, 'agent-work');

function sliceBetween(text, startMark, endMark) {
  const i = text.indexOf(startMark);
  if (i < 0) return '';
  const j = endMark ? text.indexOf(endMark, i) : -1;
  return text.slice(i, j > 0 ? j : text.length);
}

function makeView(skill, user) {
  const examPoints = sliceBetween(user, '【本章考点清单】', '\n').trim();
  const schema = sliceBetween(user, '【输出 JSON schema】', null).trim();
  if (skill === 'problem-decompose') {
    const problems = sliceBetween(user, '【待拆解题目', '【输出 JSON schema】').replace(/^（共[\s\S]*?）】\n/, '').trim();
    return [
      '## 本章考点清单（exam_points 必须从中选取）',
      examPoints,
      '',
      '## 待拆解题目',
      problems,
      '',
      '## 输出 schema',
      schema,
    ].join('\n');
  }
  if (skill === 'seed-import') {
    const title = sliceBetween(user, '【种子文章标题】', '\n').trim();
    const body = sliceBetween(user, '【种子文章正文】', '【输出 JSON schema】').replace(/^】\n/, '').trim();
    return ['## 种子文章', title, '', '## 正文', body, '', '## 输出 schema', schema].join('\n');
  }
  if (skill === 'essence-match') {
    const digest = sliceBetween(user, '【当前模板库摘要', '【待归并').replace(/^（[^）]*）】\n/, '').trim();
    const items = sliceBetween(user, '【待归并的单题拆解结果', '【输出 JSON schema】').replace(/^（共[\s\S]*?）】\n/, '').trim();
    return ['## 现有模板库（快照）', digest || '（空库）', '', '## 待归并拆解结果', items, '', '## 输出 schema', schema].join('\n');
  }
  const t = sliceBetween(user, '【待校验模板】', '【输出 JSON schema】').trim();
  return ['## 输入', t || user.slice(12000), '', '## 输出 schema', schema].join('\n');
}

function idsOf(text) {
  return (text.match(/(?:题|拆解) \d+｜(ch\d+-[BCE]-(?:mc|fp|fr|na)-\d+)/g) || []).map((s) => s.split('｜')[1]);
}

function dump() {
  const s = cfg.load();
  if (s.mode !== 'agent') throw new Error('工作台仅用于测试（agent）模式');
  const provider = llm.getProvider(s);
  const pending = provider.listPending();
  U.ensureDir(WORK);
  const out = [];
  for (const t of pending) {
    const full = U.readJson(path.join(cfg.P.pending, t.key + '.json')) || {};
    const user = (full.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const sys = (full.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const view = makeView(t.skill, user);
    const rec = {
      key: t.key,
      skill: t.skill,
      chapter: t.chapter,
      problem_ids: idsOf(user),
      bytes_full: user.length,
      bytes_view: view.length,
      answerFile: path.join('agent-work', t.key + '.answer.json'),
      inputRule: sys.slice(0, 600),
    };
    fs.writeFileSync(path.join(WORK, t.key + '.input.md'), view, 'utf8');
    U.writeJson(path.join(WORK, t.key + '.task.json'), rec);
    out.push(rec);
  }
  const index = out.map((r) => `- ${r.skill} | 第${r.chapter || '-'}章 | ${r.problem_ids.length ? r.problem_ids.join(',') : ''} | 输入 ${r.bytes_view}B\n  key: ${r.key}\n  答案写入: ${r.answerFile}\n  输入工作包: agent-work/${r.key}.input.md`).join('\n');
  U.writeFileAtomic(path.join(WORK, 'INDEX.md'), `# 待作答工作包（${out.length} 个）\n\n生成时间：${U.nowStamp()}\n\n${index}\n`);
  return { count: out.length, work: WORK, items: out };
}

function submit(key, answerPath) {
  const provider = llm.getProvider(cfg.load());
  const data = U.readJson(path.resolve(answerPath));
  if (data === null) throw new Error('答案文件不存在或非法 JSON：' + answerPath);
  const rec = provider.answer(key, JSON.stringify(data, null, 2), { author: 'qoder-agent', note: '由测试工作台提交' });
  return { key, skill: rec.skill, bytes: String(rec.output).length };
}

function submitAll() {
  const res = [];
  const errs = [];
  for (const f of fs.readdirSync(WORK).filter((x) => x.endsWith('.answer.json'))) {
    const key = f.replace('.answer.json', '');
    try {
      res.push(submit(key, path.join(WORK, f)));
    } catch (e) {
      errs.push({ key, error: e.message });
    }
  }
  return { submitted: res.length, errors: errs, items: res };
}

module.exports = { dump, submit, submitAll, WORK };
