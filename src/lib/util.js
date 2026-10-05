'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}
function shortId(text, n) {
  return sha256(text).slice(0, n || 12);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFileAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function readFileSafe(file, fallback) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return fallback === undefined ? null : fallback;
  }
}

function readJson(file, fallback) {
  const raw = readFileSafe(file);
  if (raw === null) return fallback === undefined ? null : fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback === undefined ? null : fallback;
  }
}

function writeJson(file, obj) {
  return writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
  return file;
}

function readJsonl(file) {
  const raw = readFileSafe(file, '');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      /* 跳过损坏行 */
    }
  }
  return out;
}

function uniq(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (x === null || x === undefined) continue;
    const k = typeof x === 'object' ? JSON.stringify(x) : String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function slug(text) {
  return String(text)
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9\-_.]/g, '')
    .slice(0, 60);
}

function nowStamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS[process.env.EXAMGEN_LOG || 'info'];
const listeners = new Set();

function log(level, scope, msg, extra) {
  if (LEVELS[level] < minLevel) return;
  const rec = { ts: nowStamp(), level, scope, msg, extra };
  listeners.forEach((fn) => {
    try {
      fn(rec);
    } catch (e) {
      /* ignore */
    }
  });
  const tail = extra ? ' ' + JSON.stringify(extra) : '';
  process.stdout.write(`[${rec.ts}] ${level.toUpperCase().padEnd(5)} ${scope}: ${msg}${tail}\n`);
}

const logger = {
  debug: (s, m, e) => log('debug', s, m, e),
  info: (s, m, e) => log('info', s, m, e),
  warn: (s, m, e) => log('warn', s, m, e),
  error: (s, m, e) => log('error', s, m, e),
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setLevel(l) {
    minLevel = LEVELS[l] || 20;
  },
};

function stripEnv(file) {
  const out = {};
  const raw = readFileSafe(file);
  if (!raw) return out;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

module.exports = {
  ROOT,
  sha256,
  shortId,
  ensureDir,
  writeFileAtomic,
  readFileSafe,
  readJson,
  writeJson,
  appendJsonl,
  readJsonl,
  uniq,
  slug,
  nowStamp,
  logger,
  stripEnv,
  path,
};
