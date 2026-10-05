'use strict';
/**
 * 测试环境 Provider：由智能体（Qoder agent）扮演大模型。
 * 机制 = 内容寻址回放（record & replay）：
 *   key = sha256(skill + model + messages)
 *   命中 data/agent-cache/<key>.json  -> 直接返回智能体事先撰写的推理结果
 *   未命中 -> 在 data/agent-pending/ 落一个待作答任务，抛 AgentTaskPending
 * 这样流水线在测试环境走的是与生产完全相同的代码路径，只是把「模型推理」换成「智能体推理」。
 */
const fs = require('fs');
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');

class AgentTaskPending extends Error {
  constructor(task) {
    super(`待智能体作答: ${task.key}`);
    this.name = 'AgentTaskPending';
    this.task = task;
  }
}

const OFFLINE_CATALOG = [
  { id: 'deepseek-r1', provider: 'DeepSeek', context: 64000, reasoning: true, tags: ['推理强', '长上下文', '数学'], note: '测试环境离线目录' },
  { id: 'deepseek-chat', provider: 'DeepSeek', context: 64000, reasoning: false, tags: ['性价比高', '长上下文'], note: '测试环境离线目录' },
  { id: 'qwen-max', provider: 'DashScope', context: 32000, reasoning: true, tags: ['数学', '中文强'], note: '测试环境离线目录' },
  { id: 'qwq-32b', provider: 'DashScope', context: 32000, reasoning: true, tags: ['推理强'], note: '测试环境离线目录' },
  { id: 'moonshot-v1-128k', provider: 'Moonshot', context: 128000, reasoning: false, tags: ['超长上下文', '整册归纳'], note: '测试环境离线目录' },
  { id: 'glm-4-plus', provider: '智谱', context: 128000, reasoning: false, tags: ['中文强'], note: '测试环境离线目录' },
  { id: 'gpt-4o', provider: 'OpenAI', context: 128000, reasoning: true, tags: ['通用', '视觉'], note: '测试环境离线目录' },
  { id: 'o4-mini', provider: 'OpenAI', context: 200000, reasoning: true, tags: ['推理最强', '数学'], note: '测试环境离线目录' },
];

function keyOf(req) {
  return U.sha256(JSON.stringify({ skill: req.skill, model: req.model || '-', messages: req.messages }));
}

class AgentProvider {
  constructor(settings) {
    this.s = settings;
    this.name = 'agent-replay';
    U.ensureDir(cfg.P.cache);
    U.ensureDir(cfg.P.pending);
  }

  async listModels() {
    return OFFLINE_CATALOG.map((m) => ({ ...m, offline: true }));
  }

  cacheFile(key) {
    return path.join(cfg.P.cache, key + '.json');
  }
  pendingFile(key) {
    return path.join(cfg.P.pending, key + '.json');
  }

  async chat(req) {
    const key = keyOf(req);
    const hit = U.readJson(this.cacheFile(key));
    if (hit) {
      return { text: hit.output, usage: { prompt_tokens: estTokens(req.messages), completion_tokens: estTokens(hit.output) }, model: req.model || 'qoder-agent', latencyMs: 0, replayed: true, key };
    }
    const task = {
      key,
      skill: req.skill,
      chapter: req.chapter || null,
      model: req.model || 'qoder-agent',
      requestedAt: U.nowStamp(),
      status: 'pending',
      messages: req.messages,
      instructions:
        '测试模式：请把本任务当作大模型推理任务，阅读 messages 中的 user 内容，按 system 约定的 JSON schema 产出结果，写入 data/agent-cache/' +
        key +
        '.json 的 output 字段（或调用 POST /api/agent/answer）。',
    };
    U.writeJson(this.pendingFile(key), task);
    throw new AgentTaskPending(task);
  }

  /** 智能体作答回填 */
  answer(key, output, meta) {
    const pending = U.readJson(this.pendingFile(key));
    const rec = {
      key,
      skill: (pending && pending.skill) || (meta && meta.skill) || 'unknown',
      chapter: (pending && pending.chapter) || (meta && meta.chapter) || null,
      messages: pending ? pending.messages : null,
      output: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      author: (meta && meta.author) || 'qoder-agent',
      answeredAt: U.nowStamp(),
      note: (meta && meta.note) || '',
    };
    U.writeJson(this.cacheFile(key), rec);
    try {
      fs.unlinkSync(this.pendingFile(key));
    } catch (e) {}
    return rec;
  }

  listPending() {
    return fs
      .readdirSync(cfg.P.pending)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const t = U.readJson(path.join(cfg.P.pending, f)) || {};
        return {
          key: t.key || f.replace('.json', ''),
          skill: t.skill,
          chapter: t.chapter,
          requestedAt: t.requestedAt,
          bytes: fs.statSync(path.join(cfg.P.pending, f)).size,
          brief: briefOf(t),
        };
      })
      .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1));
  }

  listAnswers() {
    return fs
      .readdirSync(cfg.P.cache)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const t = U.readJson(path.join(cfg.P.cache, f)) || {};
        return { key: t.key || f.replace('.json', ''), skill: t.skill, chapter: t.chapter, answeredAt: t.answeredAt, author: t.author, bytes: fs.statSync(path.join(cfg.P.cache, f)).size };
      })
      .sort((a, b) => (a.answeredAt < b.answeredAt ? -1 : 1));
  }

  stats() {
    return { pending: this.listPending().length, answered: fs.readdirSync(cfg.P.cache).filter((f) => f.endsWith('.json')).length };
  }
}

function briefOf(task) {
  const last = (task.messages || []).filter((m) => m.role === 'user').pop();
  const t = last ? String(last.content).replace(/\s+/g, ' ') : '';
  return t.slice(0, 220);
}

function estTokens(text) {
  const s = Array.isArray(text) ? text.map((m) => m.content).join('\n') : String(text || '');
  // 中文约 1 字 ≈ 0.7 token，拉丁/数字约 4 字符 ≈ 1 token
  const cn = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
  const rest = s.length - cn;
  return Math.round(cn * 0.9 + rest / 3.4);
}

module.exports = { AgentProvider, AgentTaskPending, OFFLINE_CATALOG, keyOf, estTokens };
