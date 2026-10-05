'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./lib/util');

const abs = (v, def) => (v ? path.resolve(U.ROOT, v) : path.join(U.ROOT, def));
const WORK = abs(process.env.EXAMGEN_WORK_DIR, 'data');
const OUT = abs(process.env.EXAMGEN_OUTPUT_DIR, 'output');

const P = {
  root: U.ROOT,
  input: abs(process.env.EXAMGEN_DATA_DIR, 'date1'),
  settings: path.join(U.ROOT, 'config/settings.json'),
  envFile: path.join(U.ROOT, '.env'),
  data: WORK,
  library: path.join(WORK, 'library'),
  problems: path.join(WORK, 'problems'),
  runs: path.join(WORK, 'runs'),
  cache: path.join(WORK, 'agent-cache'),
  pending: path.join(WORK, 'agent-pending'),
  skills: path.join(U.ROOT, 'skills'),
  output: OUT,
  web: path.join(U.ROOT, 'web'),
  state: path.join(WORK, 'state.json'),
};

const DEFAULTS = {
  mode: 'agent', // agent = 测试环境（智能体扮演大模型，内容寻址回放）; live = 生产环境
  llm: {
    baseUrl: '',
    apiKey: '',
    model: '',
    // 按 Skill 自主路由：留空则回落到 model
    routing: {
      'problem-decompose': '',
      'essence-match': '',
      'seed-import': '',
      'chapter-organize': '',
      'math-equivalence': '',
      'syllabus-coverage': '',
      'boundary-consistency': '',
    },
    // 各 skill 的能力偏好，供「一键获取模型 → 自主选择」时使用
    routingHints: {
      'problem-decompose': { need: 'long-context', maxContext: 16000, temperature: 0.2 },
      'essence-match': { need: 'reasoning', maxContext: 12000, temperature: 0.1 },
      'seed-import': { need: 'long-context', maxContext: 12000, temperature: 0.2 },
      'chapter-organize': { need: 'reasoning', maxContext: 24000, temperature: 0.2 },
      'math-equivalence': { need: 'reasoning', maxContext: 12000, temperature: 0 },
      'syllabus-coverage': { need: 'long-context', maxContext: 16000, temperature: 0 },
      'boundary-consistency': { need: 'reasoning', maxContext: 12000, temperature: 0 },
    },
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 180000,
    retries: 2,
    concurrency: 2,
  },
  batch: { problemsPerCall: 6, maxStemChars: 900, maxSolutionChars: 1600 },
  convergence: { firstLevelTargetMin: 15, firstLevelTargetMax: 20, crossMergeEveryChapters: 5 },
  input: { files: [] }, // 自动发现
  chapterMap: [
    { no: 1, title: '函数、极限、连续', discipline: '高等数学', lectures: ['章节一极限', 'Summary 1极限与连续'] },
    { no: 2, title: '一元函数微分学及其应用', discipline: '高等数学', lectures: ['章节二导数与微分', '章节三中值定理'] },
    { no: 3, title: '一元函数积分学及其应用', discipline: '高等数学', lectures: ['章节四积分', '章节八积分应用专题'] },
    { no: 4, title: '多元函数微分学及其应用', discipline: '高等数学', lectures: ['章节六多元微分'] },
    { no: 5, title: '二重积分', discipline: '高等数学', lectures: ['章节七二重积分'] },
    { no: 6, title: '微分方程及其应用', discipline: '高等数学', lectures: ['章节五常微分方程'] },
    { no: 7, title: '行列式', discipline: '线性代数', lectures: ['章节一行列式'] },
    { no: 8, title: '矩阵', discipline: '线性代数', lectures: ['章节二矩阵'] },
    { no: 9, title: '向量', discipline: '线性代数', lectures: ['章节三向量'] },
    { no: 10, title: '线性方程组', discipline: '线性代数', lectures: ['章节四线性方程组'] },
    { no: 11, title: '相似矩阵（特征值与特征向量）', discipline: '线性代数', lectures: ['章节五特征值与特征向量'] },
    { no: 12, title: '二次型', discipline: '线性代数', lectures: ['章节六二次型'] },
  ],
};

function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** 递归扫描输入目录（≤3 层，跳过图片目录）并按文件名归类 */
function discoverInputFiles(dir) {
  const found = [];
  (function walk(rel, depth) {
    if (depth > 2) return;
    let es = [];
    try {
      es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of es) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (/^images$/i.test(e.name)) continue;
        walk(r, depth + 1);
      } else if (/\.md$/i.test(e.name)) {
        try {
          found.push({ rel: r, base: e.name, bytes: fs.statSync(path.join(dir, r)).size });
        } catch (err) {}
      }
    }
  })('', 0);

  return found
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(({ rel, base, bytes }) => {
      let role = 'unknown';
      let discipline = '通用';
      if (/^目录/.test(base)) role = 'index';
      else if (/做题本/.test(base)) {
        role = 'problemBook';
        discipline = /线代/.test(base) ? '线性代数' : /高数/.test(base) ? '高等数学' : '通用';
      } else if (/解析册/.test(base)) role = 'solutionBook';
      else if (/^章节[一二三四五六七八九十]/.test(base)) role = 'syllabus';
      else if (/公式答案版|公式汇总/.test(base)) role = 'formula';
      else if (/破天学长|Summary|归纳|大全/.test(base)) role = 'seedTemplate';
      else if (/公式/.test(base) && !/\.pdf_by_/.test(base)) role = 'seedTemplate';
      return {
        file: rel,
        role,
        discipline,
        bytes,
        lectureKey: role === 'syllabus' ? base.replace('.pdf_by_PaddleOCR-VL-1.6.md', '').replace(/\.md$/, '') : null,
      };
    });
}

let current = null;

function load(force) {
  if (current && !force) return current;
  const env = U.stripEnv(P.envFile);
  let saved = U.readJson(P.settings) || {};
  let s = deepMerge(DEFAULTS, saved);
  // 环境变量优先级最高（部署时可用 docker -e 覆盖）
  s.mode = process.env.EXAMGEN_MODE || env.EXAMGEN_MODE || s.mode || 'agent';
  s.llm.baseUrl = process.env.LLM_BASE_URL || env.LLM_BASE_URL || s.llm.baseUrl || '';
  s.llm.apiKey = process.env.LLM_API_KEY || env.LLM_API_KEY || s.llm.apiKey || '';
  s.llm.model = process.env.LLM_MODEL || env.LLM_MODEL || s.llm.model || '';
  if (!s.input.files.length) s.input.files = discoverInputFiles(P.input);
  current = s;
  return current;
}

function save(patch) {
  const merged = deepMerge(load(), patch || {});
  // 不落盘 apiKey 明文以外的敏感项？—— apiKey 属于本地部署配置，落盘但打点脱敏展示
  U.writeJson(P.settings, merged);
  current = merged;
  return merged;
}

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}

module.exports = { P, load, save, discoverInputFiles, maskKey, DEFAULTS, deepMerge };
