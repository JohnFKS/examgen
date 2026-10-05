'use strict';
const U = require('../lib/util');
const cfg = require('../config');
const { OpenAICompatProvider } = require('./openai');
const { AgentProvider, AgentTaskPending, OFFLINE_CATALOG, estTokens } = require('./agentProvider');

let cached = { mode: null, provider: null };

function getProvider(settings) {
  const s = settings || cfg.load();
  if (cached.provider && cached.mode === s.mode) return cached.provider;
  cached = { mode: s.mode, provider: s.mode === 'live' ? new OpenAICompatProvider(s) : new AgentProvider(s) };
  return cached.provider;
}

function resetProvider() {
  cached = { mode: null, provider: null };
}

/** 模型自主路由：按 Skill 的能力偏好从可用模型中打分选择 */
function routeModel(models, skill, settings) {
  const s = settings || cfg.load();
  const hint = (s.llm.routingHints || {})[skill] || { need: 'general', maxContext: 8000 };
  const assigned = (s.llm.routing || {})[skill] || s.llm.model;
  const list = models && models.length ? models : OFFLINE_CATALOG;
  const scored = list.map((m) => {
    const id = m.id || m;
    const meta = m.id ? m : OFFLINE_CATALOG.find((x) => x.id === id) || { id, context: 8000, reasoning: /r1|qwq|o[1-4]|thinking|reason/i.test(id) };
    let score = 0;
    const why = [];
    const ctx = meta.context || 8000;
    if (hint.need === 'long-context') {
      const head = ctx / hint.maxContext;
      score += head >= 8 ? 60 : head >= 4 ? 50 : head >= 2 ? 38 : head >= 1 ? 24 : head >= 0.5 ? 10 : -20;
      why.push(`上下文 ${ctx} / 需要 ${hint.maxContext}`);
    } else {
      score += ctx >= hint.maxContext ? 18 : 4;
    }
    const isReason = !!meta.reasoning || /r1|qwq|o[1-4]-|think|reason|math/i.test(id);
    if (hint.need === 'reasoning') {
      score += isReason ? 35 : 2;
      why.push(isReason ? '带推理能力，适合本质匹配' : '非推理模型');
    } else if (isReason && hint.need !== 'long-context') score += 8;
    if (/数学|math/i.test((meta.tags || []).join('')) && hint.need !== 'long-context') score += 10;
    if (id === s.llm.model) score += 25;
    if (id === assigned) score += 40;
    return { id, score, model: meta, why };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = assigned && list.some((m) => (m.id || m) === assigned) ? { id: assigned, score: 999, why: ['设置中已为该 Skill 指定'] } : scored[0];
  return {
    model: (best && best.id) || s.llm.model || 'qoder-agent',
    reason: (best && best.why) || ['默认模型'],
    candidates: scored.slice(0, 5).map((x) => ({ id: x.id, score: x.score })),
    temperature: hint.temperature !== undefined ? hint.temperature : s.llm.temperature,
  };
}

/** 稳健 JSON 解析：容错 ```json 包裹、前后说明文字 */
function parseJsonLoose(text) {
  if (text == null) throw new Error('空响应');
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const starts = ['{', '['].map((c) => t.indexOf(c));
  const i = starts.filter((x) => x >= 0).sort((a, b) => a - b)[0];
  if (i === undefined || i < 0) throw new Error('响应中未找到 JSON：' + t.slice(0, 200));
  const open = t[i];
  const close = open === '{' ? '}' : ']';
  let depth = 0,
    inStr = false,
    esc = false;
  for (let j = i; j < t.length; j++) {
    const c = t[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(i, j + 1));
    }
  }
  // 截断的 JSON：尝试补齐
  const trimmed = t.slice(i);
  const guess = close === '}' ? '}]' : ']}';
  try {
    return JSON.parse(trimmed + guess);
  } catch (e) {
    throw new Error('JSON 解析失败：' + trimmed.slice(0, 200));
  }
}

/**
 * 调用一个 Skill 的推理，返回结构化 JSON
 * @returns {Promise<{data:any, meta:object}>}
 */
async function invoke({ skill, messages, model, temperature, jsonMode = true, chapter, onEvent, repair }) {
  const s = cfg.load();
  const provider = getProvider(s);
  const picked = model ? { model, temperature: temperature === undefined ? s.llm.temperature : temperature } : routeModel(await provider.listModels().catch(() => []), skill, s);
  // 测试模式下答案由智能体撰写，与具体模型名无关，统一归一化以保证缓存可重放
  if (s.mode === 'agent') picked.model = 'qoder-agent';
  const req = { skill, messages, model: picked.model, temperature: picked.temperature, maxTokens: s.llm.maxTokens, jsonMode, chapter };
  const t0 = Date.now();
  let res;
  try {
    res = await provider.chat(req);
  } finally {
    if (onEvent) onEvent({ type: 'llm', skill, model: picked.model, routeReason: picked.reason, ms: Date.now() - t0, chapter });
  }
  if (!jsonMode) return { data: res.text, meta: res };
  let data;
  try {
    data = parseJsonLoose(res.text);
  } catch (e) {
    if (!repair) throw e;
    U.logger.warn('llm', `${skill} JSON 破损，发起修复重试`);
    const retry = await provider.chat({
      ...req,
      messages: [
        { role: 'system', content: '你是一个只输出合法 JSON 的修正器。把输入修正为符合原意的合法 JSON，只输出 JSON，不要解释。' },
        { role: 'user', content: String(res.text).slice(0, 12000) },
      ],
    });
    data = parseJsonLoose(retry.text);
  }
  return {
    data,
    meta: { ...res, skill, routeReason: picked.reason, tokensIn: res.usage && res.usage.prompt_tokens, tokensOut: res.usage && res.usage.completion_tokens, provider: provider.name },
  };
}

/** 简单并发闸 */
function gate(limit) {
  let active = 0;
  const q = [];
  const next = () => {
    if (active >= limit || !q.length) return;
    active++;
    const job = q.shift();
    job(() => {
      active--;
      next();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      q.push((release) => {
        fn().then(resolve, reject).finally(release);
      });
      next();
    });
}

module.exports = { getProvider, resetProvider, routeModel, parseJsonLoose, invoke, gate, AgentTaskPending, OFFLINE_CATALOG, estTokens, OpenAICompatProvider, AgentProvider };
