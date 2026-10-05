'use strict';
/**
 * 生产 Provider：OpenAI 兼容协议（/v1/chat/completions）
 * 适配：DeepSeek / 通义千问 DashScope / Moonshot / 智谱 / OpenAI / 自建 vLLM·Ollama·Xinference
 */
const U = require('../lib/util');

function normalizeBase(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('LLM_BASE_URL 未配置');
  if (!/^https?:\/\//.test(b)) b = 'http://' + b;
  return b;
}
function chatUrl(baseUrl) {
  const b = normalizeBase(baseUrl);
  if (/\/chat\/completions$/.test(b)) return b;
  return b + '/chat/completions';
}
function modelsUrl(baseUrl) {
  const b = normalizeBase(baseUrl);
  if (/\/models$/.test(b)) return b;
  return b + '/models';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class OpenAICompatProvider {
  constructor(settings) {
    this.s = settings;
    this.name = 'openai-compatible';
  }

  get headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.s.llm.apiKey) h.Authorization = 'Bearer ' + this.s.llm.apiKey;
    return h;
  }

  async listModels() {
    const res = await fetchWithTimeout(modelsUrl(this.s.llm.baseUrl), { headers: this.headers }, 30000);
    if (!res.ok) throw new Error(`拉取模型列表失败 HTTP ${res.status}: ${(await safeText(res)).slice(0, 300)}`);
    const j = await res.json().catch(() => ({}));
    const arr = Array.isArray(j) ? j : j.data || j.models || [];
    return arr.map((m) => (typeof m === 'string' ? { id: m } : { id: m.id || m.model || m.name, created: m.created, ...m }));
  }

  /**
   * @param {object} req {model, messages, temperature, maxTokens, jsonMode, skill}
   * @returns {Promise<{text:string, usage:object, model:string, latencyMs:number, raw:object}>}
   */
  async chat(req) {
    const body = {
      model: req.model || this.s.llm.model,
      messages: req.messages,
      temperature: req.temperature === undefined ? this.s.llm.temperature : req.temperature,
      max_tokens: req.maxTokens || this.s.llm.maxTokens,
    };
    if (req.jsonMode) body.response_format = { type: 'json_object' };
    const t0 = Date.now();
    let lastErr;
    for (let attempt = 0; attempt <= (this.s.llm.retries || 0); attempt++) {
      try {
        const res = await fetchWithTimeout(chatUrl(this.s.llm.baseUrl), {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
        }, this.s.llm.timeoutMs || 180000);
        if (res.ok) {
          const j = await res.json().catch(() => ({}));
          const text =
            (j.choices && j.choices[0] && ((j.choices[0].message && j.choices[0].message.content) || j.choices[0].text)) || '';
          if (!String(text).trim()) throw new Error('空响应：模型未返回内容');
          return { text, usage: j.usage || {}, model: j.model || body.model, latencyMs: Date.now() - t0, raw: j };
        }
        const txt = await safeText(res);
        lastErr = new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
        // 部分服务不支持 response_format，降级重试
        if (res.status === 400 && req.jsonMode && /response_format|json/i.test(txt)) {
          delete body.response_format;
          continue;
        }
        if (![408, 409, 429, 500, 502, 503, 504].includes(res.status)) break;
      } catch (e) {
        lastErr = e;
      }
      if (attempt < (this.s.llm.retries || 0)) {
        const back = 1200 * Math.pow(2, attempt);
        U.logger.warn('llm', `第 ${attempt + 1} 次调用失败，${back}ms 后重试：${lastErr.message.slice(0, 160)}`);
        await sleep(back);
      }
    }
    throw lastErr || new Error('LLM 调用失败');
  }
}

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms || 120000);
  try {
    return await fetch(url, Object.assign({ signal: ac.signal }, init));
  } finally {
    clearTimeout(to);
  }
}
async function safeText(res) {
  try {
    return await res.text();
  } catch (e) {
    return '';
  }
}

module.exports = { OpenAICompatProvider, normalizeBase, chatUrl, modelsUrl, fetchWithTimeout };
