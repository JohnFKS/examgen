'use strict';
/**
 * 零依赖真实浏览器验证（本机无浏览器控制技能、无 npm/puppeteer，但有 chromium）：
 * 直接实现 CDP（WebSocket over net）驱动 headless Chromium。
 *
 *   node tools/browserCheck.js                    全部 10 视图深链渲染 + 断言 + 截图
 *   node tools/browserCheck.js overview library   只跑指定视图
 *   node tools/browserCheck.js --shots=0          不截图
 *   node tools/browserCheck.js --clicks=0         不做点击交互验证
 *
 * 断言口径（不写死业务数字，全部现取现比）：
 *  A 静态渲染：视图标题 + 该视图必须显示的某条**后端真实数据**（模板名/文件名/run id/产物名…）出现在 innerText 里
 *  B 交互：点导航项要真的换视图（location.hash 与标题都变）；点模板卡要真的进详情
 *  C 健康：整个过程不得有 JS 异常、console error、请求失败
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = '/workspace/examgen';
const PORT = Number(process.env.BC_PORT || 9341);
const APP = process.env.BC_APP || 'http://127.0.0.1:8787';
const OUT = path.join(ROOT, 'output', 'browser');
// Chrome 的 user-data-dir 有 80MB+ 且每次运行都改写，落在工程根目录就是垃圾，一律放系统临时目录
const PROFILE = process.env.BC_PROFILE || path.join(require('os').tmpdir(), 'examgen-browser-profile');
const BIN = process.env.BC_CHROME || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : 'google-chrome');

const argv = process.argv.slice(2);
const NO_SHOTS = argv.includes('--shots=0');
const NO_CLICKS = argv.includes('--clicks=0');
const DUMP = argv.includes('--dump');
const ONLY = argv.filter((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { http.get(url, (r) => { let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => res(s)); }).on('error', rej); });
const jget = async (url) => JSON.parse(await get(url));

/* ---------- 极简 WebSocket 客户端（够 CDP 用） ---------- */
class Ws {
  constructor(url) { const u = new URL(url); this.host = u.hostname; this.port = Number(u.port || 80); this.pathName = u.pathname + (u.search || ''); this.buf = Buffer.alloc(0); this.ls = []; }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const s = net.connect(this.port, this.host, () => s.write('GET ' + this.pathName + ' HTTP/1.1\r\nHost: ' + this.host + ':' + this.port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'));
      this.sock = s; s.on('error', reject);
      s.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!this.up) { const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return; const h = this.buf.slice(0, i).toString(); if (!/ 101 /.test(h.split('\r\n')[0])) return reject(new Error('握手失败')); this.up = 1; this.buf = this.buf.slice(i + 4); resolve(); }
        this.drain();
      });
    });
  }
  drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const op = this.buf[0] & 0x0f, l0 = this.buf[1] & 0x7f;
      let off = 2, len;
      if (l0 < 126) len = l0; else if (l0 === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; } else { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const pl = this.buf.slice(off, off + len); this.buf = this.buf.slice(off + len);
      if (op === 8) continue;
      if (op === 9) { this.frame(10, pl); continue; }
      if (op === 1) this.ls.forEach((f) => f(pl.toString()));
    }
  }
  frame(op, str) {
    const p = Buffer.from(str), n = p.length, h = Buffer.alloc(n < 126 ? 2 : n < 65536 ? 4 : 10);
    h[0] = 0x80 | op;
    if (n < 126) h[1] = 0x80 | n; else if (n < 65536) { h[1] = 0x80 | 126; h.writeUInt16BE(n, 2); } else { h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(n), 2); }
    const m = crypto.randomBytes(4), x = Buffer.alloc(n);
    for (let i = 0; i < n; i++) x[i] = p[i] ^ m[i % 4];
    this.sock.write(Buffer.concat([h, m, x]));
  }
  send(t) { this.frame(1, t); } onMessage(f) { this.ls.push(f); } close() { try { this.frame(8, ''); } catch (e) {} if (this.sock) this.sock.destroy(); }
}

/* ---------- CDP ---------- */
let mid = 0;
class Cdp {
  constructor(ws) { this.ws = ws; this.p = new Map(); this.ev = null; ws.onMessage((t) => { let m; try { m = JSON.parse(t); } catch (e) { return; } if (m.id && this.p.has(m.id)) { const q = this.p.get(m.id); this.p.delete(m.id); m.error ? q.rj(new Error(m.error.message)) : q.rs(m.result); } else if (m.method && this.ev) this.ev(m); }); }
  cmd(method, params, sessionId) { const id = ++mid; const b = { id, method }; if (params) b.params = params; if (sessionId) b.sessionId = sessionId; this.ws.send(JSON.stringify(b)); return new Promise((rs, rj) => this.p.set(id, { rs, rj })); }
}
async function tab(cdp, url) {
  const t = await cdp.cmd('Target.createTarget', { url: 'about:blank' });
  const a = await cdp.cmd('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId, call = (m, p) => cdp.cmd(m, p, sid);
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable'); await call('Log.enable');
  if (url) await call('Page.navigate', { url });
  return { targetId: t.targetId, call };
}
const ev = (call, expr) => call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then((r) => (r.result && r.result.value !== undefined ? r.result.value : null), () => null);

async function waitFor(call, need, ms) {
  const t0 = Date.now(); let txt = '';
  while (Date.now() - t0 < ms) {
    txt = String(await ev(call, 'document.body.innerText') || '');
    const busy = /加载中|正在加载|请稍候|加载历史|加载记录|加载待作答|加载缓存|加载模板详情/.test(txt.replace(/模式加载中/g, ''));
    if (!busy && need.every((s) => txt.includes(s))) return { ok: true, txt, ms: Date.now() - t0 };
    await sleep(350);
  }
  return { ok: false, txt, ms: Date.now() - t0 };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(BIN, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1680,1150', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80 && !ver; i++) { try { ver = await jget('http://127.0.0.1:' + PORT + '/json/version'); } catch (e) { await sleep(400); } }
  if (!ver) { chrome.kill('SIGKILL'); throw new Error('chromium 调试端口未就绪：' + BIN); }

  const ov = await jget(APP + '/api/overview');
  const lib = await jget(APP + '/api/library');
  const files = await jget(APP + '/api/files');
  const runs = await jget(APP + '/api/runs');
  const outs = await jget(APP + '/api/outputs');
  const qal = await jget(APP + '/api/qa/list');
  const sks = await jget(APP + '/api/skills');
  const flat = [];
  (lib.tree || []).forEach((d) => (d.chapters || []).forEach((c) => (c.templates || []).forEach((t) => flat.push(t))));
  const tpl = flat[0] || {};
  const oneFile = ((files.files || [])[0] || {}).file || '';
  const oneOut = ((outs.items || [])[0] || {}).name || '';
  const oneRun = ((runs.items || [])[0] || {}).id || '';
  const oneSkill = ((sks.skills || [])[0] || {}).id || '';
  const oneQa = '第' + String((qal[0] || {}).chapterNo || 1).padStart(2, '0') + '章';

  /* 已并入的历史模板：题库页与校验页的「归属通法」链接会指向它们（全局收敛后 356/374 条都是这种），
     详情页必须点亮「已并入哪条主干 + 合并链」，否则读者会把它当成 18 条之外的活模板 */
  const mergedProbe = (() => {
    let recs;
    try { recs = fs.readFileSync(path.join(ROOT, 'data/library/templates.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch (e) { return null; }
    const byId = {}; recs.forEach((r) => (byId[r.id] = r));
    for (const r of recs) {
      if (r.status !== 'merged' || !r.merged_into) continue;
      let cur = r, hops = 0; const chain = [r.id];
      while (cur && cur.status === 'merged' && cur.merged_into && hops++ < 12) { chain.push(cur.merged_into); cur = byId[cur.merged_into]; }
      if (cur && cur.status !== 'merged') return { id: r.id, final: cur.id, name: cur.name, hops: chain.length };
    }
    return null;
  })();

  const VIEWS = [
    { n: 'overview', t: '总览', need: ['一级通法', String(ov.library.level1), String(ov.library.coveredProblems)], mustNot: ['还没有运行记录', '模板库加载失败'] },
    { n: 'sources', t: '数据源', need: ['date1', String(oneFile).slice(0, 14)], mustNot: ['未发现输入文件'] },
    { n: 'problems', t: '题库', need: ['第1章 函数、极限、连续', 'ch1-B-fp-01'], mustNot: ['没有符合条件的题目'] },
    { n: 'library', t: '模板库', need: [String(tpl.name || '').slice(0, 8), tpl.id || 'T-'], mustNot: ['模板库加载失败'] },
    { n: 'runs', t: '运行', need: ['历史运行', String(oneRun)], mustNot: ['还没有运行记录', '历史记录加载失败'] },
    { n: 'qa', t: '校验', need: ['第1章', '覆盖率'], mustNot: ['该章节尚未质检'] },
    { n: 'output', t: '输出', need: [String(oneOut).slice(0, 12)], mustNot: ['输出目录读取失败'] },
    { n: 'settings', t: '设置', need: ['agent'], mustNot: ['设置读取失败'] },
    { n: 'agent', t: '测试模式', need: ['待作答任务', '已作答缓存', '作答时间', (ov.agent && ov.agent.pending) ? null : '没有待作答任务'].filter(Boolean), mustNot: ['当前模式不支持智能体作答', '任务列表加载失败', '缓存加载失败'] },
    { n: 'skills', t: 'Skill', need: [String(oneSkill).slice(0, 8)], mustNot: ['Skill 清单加载失败'] },
  ].filter((v) => !ONLY.length || ONLY.includes(v.n));

  const ws = new Ws(ver.webSocketDebuggerUrl); await ws.connect();
  const cdp = new Cdp(ws);
  const problems = [];
  cdp.ev = (m) => {
    if (m.method === 'Runtime.exceptionThrown') problems.push('JS异常：' + String(((m.params.exceptionDetails || {}).exception || {}).description || '').split('\n')[0].slice(0, 140));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('控制台错误：' + String(m.params.entry.text).slice(0, 140));
    if (m.method === 'Network.loadingFailed') problems.push('请求失败：' + String(m.params.errorText || '') + ' ' + String(m.params.type || ''));
  };
  const rows = [];
  console.log('浏览器：' + ver.Browser + ' ｜ 目标：' + APP + ' ｜ 在库一级通法 ' + ov.library.level1 + ' 条\n');

  /* A. 逐视图深链渲染 */
  for (const v of VIEWS) {
    problems.length = 0;
    const T = await tab(cdp, APP + '/#/' + v.n);
    const r = await waitFor(T.call, DUMP ? [v.t] : [v.t].concat(v.need.filter(Boolean)), 24000);
    if (DUMP) {
      console.log('\n===== #/' + v.n + ' （' + r.ms + 'ms，DOM ' + r.txt.length + ' 字）=====\n' + r.txt.slice(0, 1500).replace(/\n{2,}/g, '\n'));
      const html = String(await ev(T.call, "(document.querySelector('#view')||document.body).innerHTML") || '');
      console.log('----- innerHTML ' + html.length + 'B -----\n' + html.slice(0, 700));
      const hist = await ev(T.call, "(function(){var e=document.getElementById('runsHist');return e?e.innerText.slice(0,400):'(无 #runsHist)';})()");
      if (hist !== null) console.log('----- #runsHist -----\n' + hist);
      if (problems.length) console.log('----- 本轮错误 -----\n' + problems.slice(0, 6).join('\n'));
      await cdp.cmd('Target.closeTarget', { targetId: T.targetId });
      continue;
    }
    const hash = await ev(T.call, 'location.hash');
    const domLen = Number(await ev(T.call, 'document.documentElement.outerHTML.length')) || 0;
    const nodes = Number(await ev(T.call, 'document.querySelectorAll("*").length')) || 0;
    let shot = '';
    if (!NO_SHOTS) { const s = await T.call('Page.captureScreenshot', { format: 'png' }); shot = path.join(OUT, v.n + '.png'); fs.writeFileSync(shot, Buffer.from(s.data, 'base64')); }
    const miss = [v.t].concat(v.need.filter(Boolean)).filter((x) => !r.txt.includes(x));
    const ghost = (v.mustNot || []).filter((x) => r.txt.includes(x));
    const bad = problems.slice();
    const ok = r.ok && !bad.length && !miss.length && !ghost.length;
    rows.push({ view: v.n, ok, hash, domLen, nodes, waited: r.ms, miss, ghost, bad, shot, textHead: r.txt.slice(0, 90).replace(/\n/g, ' ⏎ ') }) ;
    console.log((ok ? '  ✓ ' : '  ✗ ') + v.n.padEnd(9) + ' DOM ' + String(domLen).padStart(7) + 'B / ' + String(nodes).padStart(5) + ' 节点，' + String(r.ms).padStart(6) + 'ms' + (miss.length ? ' 缺[' + miss.join(',') + ']' : '') + (ghost.length ? ' 空态[' + ghost.join(',') + ']' : '') + (bad.length ? ' 错[' + bad[0] + ']' : ''));
    await cdp.cmd('Target.closeTarget', { targetId: T.targetId });
  }

  /* B. 点击交互：导航换视图 + 模板卡进详情 */
  if (DUMP) { ws.close(); chrome.kill('SIGKILL'); return; }
  if (!NO_CLICKS) {
    problems.length = 0;
    const T = await tab(cdp, APP + '/#/overview');
    await waitFor(T.call, ['总览'], 20000);
    const navs = await ev(T.call, "Array.from(document.querySelectorAll('.nav-item')).map(a=>a.getAttribute('data-route'))");
    console.log('\n  导航项 ' + (navs || []).length + ' 个：' + (navs || []).join(','));
    for (const n of navs || []) {
      const before = await ev(T.call, 'location.hash');
      await ev(T.call, "(function(){var a=document.querySelector('.nav-item[data-route=\"" + n + "\"]');if(!a)return 'no-link';a.click();return 'clicked';})()");
      const r = await waitFor(T.call, [], 12000);
      const hash = await ev(T.call, 'location.hash');
      const title = await ev(T.call, "(document.querySelector('.view-title,h1,h2')||{}).innerText||''");
      const want = (VIEWS.find((x) => x.n === n) || {}).t || n;
      const ok = String(hash) === '#/' + n && String(title).indexOf(want) >= 0;
      rows.push({ view: 'click:' + n, ok, hash, textHead: String(title).slice(0, 40) + (ok ? '' : '（期望标题 ' + want + '）') });
      console.log((ok ? '  ✓ ' : '  ✗ ') + ('click ' + n).padEnd(16) + hash + ' ｜ ' + String(title).slice(0, 26));
    }
    // 模板卡详情
    await T.call('Page.navigate', { url: APP + '/#/library' });
    await waitFor(T.call, ['模板库'], 20000);
    const clicked = await ev(T.call, "(function(){var el=document.querySelector('[data-template],.tpl-card,.card');if(!el)return 'none';el.click();return (el.getAttribute('data-template')||el.dataset.id||'ok');})()");
    await sleep(1500);
    const dh = await ev(T.call, 'location.hash');
    const dTxt = String(await ev(T.call, 'document.body.innerText') || '');
    const okDetail = /^#\/library\//.test(String(dh)) || /本质|步骤|适用前提|失效/.test(dTxt);
    rows.push({ view: 'click:模板卡', ok: okDetail, hash: dh, textHead: clicked + ' → ' + dh });
    console.log((okDetail ? '  ✓ ' : '  ✗ ') + ('click 模板卡').padEnd(16) + clicked + ' → ' + dh);
    // 已并入模板的详情：合并链横幅
    if (mergedProbe) {
      await T.call('Page.navigate', { url: APP + '/#/library/' + encodeURIComponent(mergedProbe.id) });
      const w = await waitFor(T.call, ['本模板已被合并吸收'], 15000);
      const txt = String(w.txt || '');
      const okM = txt.includes('本模板已被合并吸收') && txt.includes(mergedProbe.final) && txt.includes('合并链');
      rows.push({ view: 'detail:已并入模板', ok: okM, hash: '#/library/' + mergedProbe.id, textHead: mergedProbe.id + ' → ' + mergedProbe.final + '（' + mergedProbe.hops + ' 跳）' + (okM ? '' : ' 横幅缺失') });
      console.log((okM ? '  ✓ ' : '  ✗ ') + ('detail 已并入模板').padEnd(16) + mergedProbe.id + ' → ' + mergedProbe.final + '（' + mergedProbe.hops + ' 跳，' + w.ms + 'ms）');
      if (!NO_SHOTS && okM) {
        const s = await T.call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, 'library-merged.png'), Buffer.from(s.data, 'base64'));
      }
    }
    if (problems.length) rows.push({ view: 'click:健康', ok: false, bad: problems.slice() });
    await cdp.cmd('Target.closeTarget', { targetId: T.targetId });
  }

  const fails = rows.filter((r) => r.ok === false);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), browser: ver.Browser, app: APP, level1: ov.library.level1, views: VIEWS.length, rows, fails: fails.length }, null, 2) + '\n');
  console.log('\n检查 ' + rows.length + ' 项：通过 ' + (rows.length - fails.length) + '，失败 ' + fails.length + '；截图 ' + (NO_SHOTS ? 0 : VIEWS.length + (mergedProbe ? 1 : 0)) + ' 张 → output/browser/');
  fails.forEach((f) => console.log('  ✗ ' + f.view + (f.miss && f.miss.length ? ' 缺渲染：' + f.miss.join(',') : '') + (f.ghost && f.ghost.length ? ' 数据在库却显示空态：' + f.ghost.join(',') : '') + (f.bad && f.bad.length ? ' 错误：' + f.bad.join(' / ') : '') + ' ' + (f.textHead || '')));
  ws.close(); chrome.kill('SIGKILL');
  process.exitCode = fails.length ? 1 : 0;
}
main().catch((e) => { console.error('浏览器验证失败：' + e.message); process.exitCode = 2; });
