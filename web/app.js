/* ==========================================================================
 * 考研数学万能通法自动归纳系统 — Web 控制台
 * 纯前端 vanilla JS（普通脚本，无构建、无依赖、无外链）
 * 全部数据来自本机后端 REST/SSE 接口
 * ========================================================================== */
(function (global) {
  'use strict';

  var App = {};

  /* ====================== 0. 常量与中文映射 ====================== */

  var MODE_CN = { agent: '测试模式', live: '生产模式' };
  var LAYER_CN = { meta: '元能力层', business: '业务执行层', qa: '质量校验层' };
  var ROLE_CN = {
    problemBook: '题库',
    solutionBook: '答案',
    syllabus: '考点教材',
    formula: '公式',
    seedTemplate: '已有通法',
    index: '目录',
    unknown: '未识别',
  };
  var ACTION_CN = {
    refine: '完全匹配 · 优化模板',
    branch: '部分匹配 · 新增分支',
    new: '不匹配 · 新建模板',
    'auto-merge': '本质相同 · 自动并入',
  };
  var SKILL_CN = {
    'task-scheduler': '任务调度Skill',
    'skill-forge': 'Skill生成元Skill',
    'seed-import': '种子模板导入Skill',
    'problem-decompose': '单题标准化拆解Skill',
    'essence-match': '本质匹配与模板迭代Skill',
    'chapter-organize': '章节分类与组织Skill',
    'math-equivalence': '数学等价校验Skill',
    'syllabus-coverage': '考点覆盖校验Skill',
    'boundary-consistency': '边界一致性校验Skill',
    probe: '连通性探测',
  };
  var STAGES = [
    { id: 'seed', name: '种子模板导入' },
    { id: 'chapter', name: '章节归纳（拆解→匹配→迭代）' },
    { id: 'converge', name: '全局收敛（跨章合并）' },
  ];
  var EV_GREEN = { merge: 1, qa: 1, 'qa-fix': 1, 'chapter-end': 1, converge: 1, seed: 1 };
  var EV_ORANGE = { pending: 1, 'chapter-hold': 1 };
  var EV_RED = { error: 1, fatal: 1, 'ext-skill-error': 1 };

  /* ====================== 1. 基础工具 ====================== */

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtBytes(n) {
    var v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1024 / 1024).toFixed(2) + ' MB';
  }

  function pct(v, digits) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return (n * 100).toFixed(digits == null ? 1 : digits) + '%';
  }

  function numOr(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }

  function dash(v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    return v;
  }

  function trunc(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function fmtTime(v) {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') {
      var d = new Date(v);
      if (isNaN(d.getTime())) return '—';
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }
    return String(v);
  }

  function fmtMs(v) {
    var n = Number(v) || 0;
    if (n < 1000) return n + ' ms';
    if (n < 60000) return (n / 1000).toFixed(1) + ' s';
    return (n / 60000).toFixed(1) + ' min';
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(self, args);
      }, ms || 350);
    };
  }

  function lsGet(k, dflt) {
    try {
      var raw = global.localStorage.getItem('examgen.' + k);
      if (raw == null) return dflt;
      var v = JSON.parse(raw);
      return v == null ? dflt : v;
    } catch (e) {
      return dflt;
    }
  }

  function lsSet(k, v) {
    try {
      global.localStorage.setItem('examgen.' + k, JSON.stringify(v));
    } catch (e) {}
  }

  function uniq(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (x) {
      if (x == null || x === '') return;
      var k = String(x);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(x);
    });
    return out;
  }

  function skillName(id) {
    var list = state.skills && state.skills.skills;
    if (list) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title || id;
    }
    return SKILL_CN[id] || id;
  }

  function actionTag(action) {
    var a = String(action || 'unknown');
    var cls = /^(refine|branch|new|auto-merge)$/.test(a) ? a : 'unknown';
    return '<span class="tag tag-' + cls + '">' + esc(ACTION_CN[a] || a) + '</span>';
  }

  function lines(text) {
    return String(text == null ? '' : text)
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function jsonPretty(v) {
    try {
      return JSON.stringify(v, null, 2);
    } catch (e) {
      return String(v);
    }
  }

  function encodePath(p) {
    return String(p)
      .split('/')
      .map(function (s) {
        return encodeURIComponent(s);
      })
      .join('/');
  }

  function copyText(text) {
    var done = function () {
      toast('已复制到剪贴板', 'ok');
    };
    var fail = function () {
      toast('剪贴板不可用，已选中文本，请按 Ctrl+C', 'warn');
    };
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(String(text)).then(done, function () {
          legacyCopy(text, done, fail);
        });
        return;
      }
    } catch (e) {}
    legacyCopy(text, done, fail);
  }

  function legacyCopy(text, done, fail) {
    try {
      var ta = document.createElement('textarea');
      ta.value = String(text);
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? done() : fail();
    } catch (e) {
      fail();
    }
  }

  /* ====================== 2. 轻量 Markdown 渲染器 ====================== */
  /* 先整体 HTML 实体转义，再分块拼装；公式与代码按原文显示，杜绝 XSS */

  var md = (function () {
    var SENT = '\u0001';
    var PIPE = '\u0002';

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function keep(store, html) {
      store.push(html);
      return SENT + (store.length - 1) + SENT;
    }

    function safeUrl(u) {
      var t = String(u || '').trim();
      return /^(https?:|mailto:|#|\/)/i.test(t) ? t : null;
    }

    function inline(text, store) {
      var s = String(text == null ? '' : text);
      s = s.replace(/!\[([^\]]*)\]\([^)\s]*\)/g, function (m, alt) {
        return '<span class="md-img">［图片 ' + (alt || '') + '］</span>';
      });
      s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, label, url) {
        var href = safeUrl(url);
        var lb = label || url;
        if (!href) return lb;
        return '<a class="md-a" href="' + href.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + lb + '</a>';
      });
      s = s.replace(/(^|[\s(（【])(https?:\/\/[^\s<>"'）)，。；：、]+)/g, function (m, pre, url) {
        return pre + '<a class="md-a" href="' + url.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
      });
      s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
      s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^\w\\])_(?=\S)([^_\n]+?)_(?![\w])/g, '$1<em>$2</em>');
      s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
      return s;
    }

    function splitRow(line) {
      var t = String(line).trim();
      if (t.charAt(0) === '|') t = t.slice(1);
      if (t.charAt(t.length - 1) === '|') t = t.slice(0, t.length - 1);
      return t.split('|').map(function (c) {
        return c.trim().split(PIPE).join('|');
      });
    }

    function isDivider(l) {
      return !!l && /\|/.test(l) && /-/.test(l) && /^\s*[:|\-\s]+$/.test(l);
    }

    function alignAttr(a) {
      return a ? ' style="text-align:' + a + '"' : '';
    }

    function renderItems(items, idx, indent, store) {
      var ordered = items[idx].ordered;
      var buf = [];
      while (idx < items.length && items[idx].indent >= indent) {
        if (items[idx].indent > indent) {
          var deep = renderItems(items, idx, items[idx].indent, store);
          buf.push(deep[0]);
          idx = deep[1];
          continue;
        }
        var content = inline(items[idx].text, store).replace(/\n/g, '<br>');
        idx++;
        if (idx < items.length && items[idx].indent > indent) {
          var sub = renderItems(items, idx, items[idx].indent, store);
          buf.push('<li>' + content + sub[0] + '</li>');
          idx = sub[1];
        } else {
          buf.push('<li>' + content + '</li>');
        }
      }
      var tag = ordered ? 'ol' : 'ul';
      return ['<' + tag + '>' + buf.join('') + '</' + tag + '>', idx];
    }

    function renderBlocks(text, store) {
      var arr = String(text).split('\n');
      var out = [];
      var i = 0;
      var RE_HEAD = /^(#{1,6})\s+(.*)$/;
      var RE_HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
      var RE_LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
      var RE_LI_ANY = /^(\s*)([-*+]|\d+[.)])\s+/;
      var RE_Q = /^[ \t]*&gt; ?/;

      while (i < arr.length) {
        var line = arr[i];
        if (!line.trim()) {
          i++;
          continue;
        }
        var m;
        if ((m = RE_HEAD.exec(line))) {
          var lv = m[1].length;
          out.push('<h' + lv + '>' + inline(m[2], store) + '</h' + lv + '>');
          i++;
          continue;
        }
        if (RE_HR.test(line)) {
          out.push('<hr>');
          i++;
          continue;
        }
        if (RE_Q.test(line)) {
          var qbuf = [];
          while (i < arr.length && RE_Q.test(arr[i])) {
            qbuf.push(arr[i].replace(RE_Q, ''));
            i++;
          }
          while (i < arr.length && arr[i].trim() && !RE_HEAD.test(arr[i]) && !RE_LI_ANY.test(arr[i]) && !RE_Q.test(arr[i]) && !(arr[i].indexOf('|') >= 0 && isDivider(arr[i + 1]))) {
            qbuf.push(arr[i].trim());
            i++;
          }
          out.push('<blockquote>' + renderBlocks(qbuf.join('\n'), store) + '</blockquote>');
          continue;
        }
        if (line.indexOf('|') >= 0 && isDivider(arr[i + 1])) {
          var heads = splitRow(line.replace(/\\\|/g, PIPE));
          var divs = splitRow(arr[i + 1].replace(/\\\|/g, PIPE));
          var aligns = divs.map(function (c) {
            var l = /^:/.test(c);
            var r = /:$/.test(c);
            return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
          });
          i += 2;
          var rows = [];
          while (i < arr.length && arr[i].trim() && arr[i].indexOf('|') >= 0) {
            rows.push(splitRow(arr[i].replace(/\\\|/g, PIPE)));
            i++;
          }
          var t = ['<table><thead><tr>'];
          heads.forEach(function (h, k) {
            t.push('<th' + alignAttr(aligns[k]) + '>' + inline(h, store) + '</th>');
          });
          t.push('</tr></thead><tbody>');
          rows.forEach(function (r) {
            t.push('<tr>');
            for (var c = 0; c < heads.length; c++) t.push('<td' + alignAttr(aligns[c]) + '>' + inline(r[c] == null ? '' : r[c], store) + '</td>');
            t.push('</tr>');
          });
          t.push('</tbody></table>');
          out.push(t.join(''));
          continue;
        }
        if ((m = RE_LI.exec(line))) {
          var items = [];
          while (i < arr.length) {
            var lm = RE_LI.exec(arr[i]);
            if (lm) {
              items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] });
              i++;
              continue;
            }
            if (items.length && arr[i].trim() && !RE_HEAD.test(arr[i]) && !RE_Q.test(arr[i]) && !RE_LI_ANY.test(arr[i]) && !(arr[i].indexOf('|') >= 0 && isDivider(arr[i + 1]))) {
              items[items.length - 1].text += '\n' + arr[i].trim();
              i++;
              continue;
            }
            break;
          }
          if (items.length) out.push(renderItems(items, 0, items[0].indent, store)[0]);
          continue;
        }
        var para = [];
        while (
          i < arr.length &&
          arr[i].trim() &&
          !RE_HEAD.test(arr[i]) &&
          !RE_HR.test(arr[i]) &&
          !RE_LI_ANY.test(arr[i]) &&
          !RE_Q.test(arr[i]) &&
          !(arr[i].indexOf('|') >= 0 && isDivider(arr[i + 1]))
        ) {
          para.push(arr[i]);
          i++;
        }
        out.push('<p>' + inline(para.join('\n'), store).replace(/\n/g, '<br>') + '</p>');
      }
      return out.join('\n');
    }

    function restore(text, store) {
      var guard = 0;
      var re = new RegExp(SENT + '(\\d+)' + SENT, 'g');
      while (text.indexOf(SENT) >= 0 && guard++ < 40) {
        var next = text.replace(re, function (m, idx) {
          return store[+idx] == null ? '' : store[+idx];
        });
        if (next === text) break;
        text = next;
      }
      return text;
    }

    function render(src) {
      if (src == null) return '';
      var store = [];
      var text = escapeHtml(String(src).replace(/\r\n?/g, '\n'));
      text = text.replace(/^[ \t]*```[ \t]*([^\n]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, function (m, lang, body) {
        var lg = String(lang || '').replace(/[^\w\-+.]/g, '').slice(0, 30);
        return '\n' + keep(store, '<pre class="md-code"' + (lg ? ' data-lang="' + lg + '"' : '') + '><code>' + body.replace(/\n$/, '') + '</code></pre>') + '\n';
      });
      text = text.replace(/`([^`\n]+)`/g, function (m, body) {
        return keep(store, '<code class="md-icode">' + body + '</code>');
      });
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (m, body) {
        return '\n' + keep(store, '<div class="md-math md-math-block">$$' + body + '$$</div>') + '\n';
      });
      text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (m, body) {
        return '\n' + keep(store, '<div class="md-math md-math-block">\\[' + body + '\\]</div>') + '\n';
      });
      text = text.replace(/\\\(([^()\n]*?)\\\)/g, function (m, body) {
        return keep(store, '<span class="md-math">\\(' + body + '\\)</span>');
      });
      text = text.replace(/\$([^$\n]+?)\$/g, function (m, body) {
        return keep(store, '<span class="md-math">$' + body + '$</span>');
      });
      return restore(renderBlocks(text, store), store);
    }

    render.render = render;
    render.escapeHtml = escapeHtml;
    return render;
  })();

  /* ====================== 3. 统一 fetch 封装 ====================== */

  function qs(obj) {
    var parts = [];
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (v == null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* 题库查询：兼容两种分页 / 拆解状态参数写法（limit|size、offset|from、status|dec） */
  function probQuery(f) {
    var o = { chapter: f.chapter, tier: f.tier, section: f.section, q: f.q, status: f.status };
    o.limit = f.limit;
    o.size = f.limit;
    o.offset = f.offset;
    o.from = f.offset;
    if (f.status === 'decomposed') o.dec = 'yes';
    else if (f.status === 'undecomposed') o.dec = 'no';
    return o;
  }

  async function api(path, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 20000;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) {
        try {
          ctrl.abort();
        } catch (e) {}
      }
    }, timeout);
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(opts.body);
    }

    function fail(msg, hint, extra) {
      if (!opts.silent) toast(msg, 'err', hint);
      var e = new Error(msg);
      e.hint = hint;
      e.extra = extra;
      throw e;
    }

    var res, data;
    try {
      res = await fetch(path, init);
      var ct = (res.headers && res.headers.get('content-type')) || '';
      if (ct.indexOf('application/json') >= 0) data = await res.json();
      else if (ct.indexOf('text/') === 0) data = { __text: await res.text(), __raw: true };
      else data = { __empty: true };
    } catch (e) {
      clearTimeout(timer);
      var aborted = e && (e.name === 'AbortError' || e.code === 20);
      return fail(
        aborted ? '请求超时（' + timeout / 1000 + 's）：' + path : '无法连接后端：请确认后端已启动：node src/server.js',
        aborted ? '可在设置中调大 timeoutMs 或减小每批题量' : '后端默认端口 8787，本地执行 node src/server.js 后重试'
      );
    }
    clearTimeout(timer);

    if (!res.ok) return fail((data && data.error) || 'HTTP ' + res.status + '：' + path, data && data.hint, { status: res.status, data: data });
    if (data && data.ok === false) return fail(data.error || '接口返回失败：' + path, data.hint, { data: data });
    if (opts.raw && data && data.__raw) return data.__text;
    return data;
  }

  /* ====================== 4. Toast / Modal / Drawer ====================== */

  function toast(msg, type, hint) {
    var box = byId('toasts');
    if (!box) return;
    var d = document.createElement('div');
    d.className = 'toast toast-' + (type || 'info');
    d.innerHTML = '<span class="toast-title">' + esc(msg) + '</span>' + (hint ? '<span class="toast-hint">' + esc(hint) + '</span>' : '');
    box.appendChild(d);
    setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, type === 'err' ? 8000 : 3800);
    while (box.children.length > 5) box.removeChild(box.firstChild);
  }

  function closeModal() {
    var root = byId('modalRoot');
    if (!root) return;
    root.hidden = true;
    root.className = 'modal-root';
    root.innerHTML = '';
  }

  function confirmModal(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var root = byId('modalRoot');
      root.className = 'modal-root open';
      root.hidden = false;
      root.innerHTML =
        '<div class="modal-mask" data-act="modal-no"></div>' +
        '<div class="modal"><div class="modal-head">' + esc(o.title || '确认操作') + '</div>' +
        '<div class="modal-body md">' + (o.bodyHtml || '<p>' + esc(o.text || '') + '</p>') + '</div>' +
        '<div class="modal-foot"><button class="btn" data-act="modal-no">' + esc(o.cancelText || '取消') + '</button>' +
        '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="modal-yes">' + esc(o.okText || '确认') + '</button></div></div>';
      root.addEventListener('click', function h(ev) {
        var t = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!t) return;
        var act = t.getAttribute('data-act');
        if (act !== 'modal-yes' && act !== 'modal-no') return;
        root.removeEventListener('click', h);
        root.innerHTML = '';
        root.className = 'modal-root';
        root.hidden = true;
        resolve(act === 'modal-yes');
      });
    });
  }

  function openDrawer(title, bodyHtml, footHtml) {
    var root = byId('drawerRoot');
    root.className = 'drawer-root open';
    root.hidden = false;
    root.innerHTML =
      '<div class="drawer-mask" data-act="drawer-close"></div>' +
      '<section class="drawer"><div class="drawer-head"><span>' + esc(title) + '</span>' +
      '<button class="x-btn" type="button" data-act="drawer-close" title="关闭">&times;</button></div>' +
      '<div class="drawer-body" id="drawerBody">' + bodyHtml + '</div>' +
      '<div class="drawer-foot">' + (footHtml || '') + '</div></section>';
    root.onclick = function (e) {
      if (e.target.closest('[data-act="drawer-close"]')) closeDrawer();
    };
  }

  function closeDrawer() {
    var root = byId('drawerRoot');
    root.className = 'drawer-root';
    root.hidden = true;
    root.innerHTML = '';
  }

  /* ====================== 5. 全局状态 ====================== */

  var state = {
    route: 'overview',
    overview: null,
    settings: null,
    chapters: null,
    models: [],
    modelsSource: '',
    routeResults: {},
    skills: null,
    library: null,
    matrix: null,
    qaReports: null,
    outputs: null,
    indexResult: null,
    probCache: {},
    libCache: {},
    openProb: null,
    probTotal: 0,
    selTemplate: null,
    selQa: null,
    agentTasks: null,
    agentTask: null,
    agentStats: null,
    runEvents: [],
    runEventSeen: {},
    runSubs: [],
    runUsage: null,
    runPending: [],
    running: false,
    es: null,
  };

  /* ====================== 6. 顶部状态条 ====================== */

  function renderStatus() {
    var o = state.overview;
    var st = byId('stMode');
    if (!st) return;
    var sm = byId('stModel');
    var sp = byId('stPending');
    var sr = byId('stRunning');
    var badge = byId('navAgentBadge');
    var mode = (o && o.mode) || (state.settings && state.settings.mode) || 'agent';
    var baseUrl = (o && o.baseUrl) || (state.settings && state.settings.llm && state.settings.llm.baseUrl) || '';

    st.className = 'chip chip-mode ' + mode;
    st.textContent = (MODE_CN[mode] || mode) + (mode === 'agent' ? '（智能体扮演大模型）' : '（真实模型）');
    st.title = mode === 'live' ? 'baseUrl：' + (baseUrl || '未配置') : '测试模式下由智能体作答，走同一套流水线代码';

    var modelTxt = o ? o.model : state.settings && state.settings.llm ? state.settings.llm.model : '';
    sm.textContent = '模型 ' + (modelTxt || '未配置');
    sm.title = 'baseUrl：' + (baseUrl || '未配置');

    var pending = o && o.agent ? Number(o.agent.pending) : state.agentStats ? Number(state.agentStats.pending) : null;
    sp.textContent = pending == null ? '待作答 不适用' : '待作答 ' + pending;
    sp.className = 'chip' + (pending > 0 ? ' chip-alert' : '');

    var running = !!(o && o.running) || !!state.running;
    sr.className = 'chip ' + (running ? 'chip-running' : 'chip-idle');
    sr.innerHTML = running ? '<span class="dot breath"></span><span>运行中</span>' : '<span>空闲</span>';

    if (badge) {
      if (pending > 0) {
        badge.hidden = false;
        badge.textContent = String(pending);
      } else badge.hidden = true;
    }
    var foot = byId('footTime');
    if (foot) foot.textContent = '状态刷新 ' + fmtTime(Date.now());
  }

  async function refreshOverview(silent) {
    try {
      state.overview = await api('/api/overview', { silent: silent !== false, timeout: 30000 });
      state.running = !!state.overview.running;
      renderStatus();
    } catch (e) {}
  }

  async function refreshRunning() {
    try {
      var r = await api('/api/run/current', { silent: true });
      var was = state.running;
      state.running = !!(r && r.running);
      if (r && r.running) {
        (r.events || []).forEach(pushRunEvent);
        state.runUsage = r.usage || state.runUsage;
        state.runPending = r.pending || [];
      }
      renderStatus();
      if (was && !state.running) refreshOverview(true);
    } catch (e) {}
  }

  /* ====================== 7. SSE 事件流（全局单连接） ====================== */

  function pushRunEvent(ev) {
    if (!ev) return;
    var k = [ev.ts, ev.type, ev.msg].join('|');
    if (state.runEventSeen[k]) return;
    state.runEventSeen[k] = 1;
    state.runEvents.push(ev);
    if (state.runEvents.length > 500) state.runEvents.splice(0, state.runEvents.length - 500);
    state.runSubs.forEach(function (fn) {
      try {
        fn(ev);
      } catch (e) {}
    });
  }

  function parseSse(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { type: 'message', msg: String(raw) };
    }
  }

  function connectEvents() {
    if (state.es || typeof global.EventSource === 'undefined') return;
    var es;
    try {
      es = new global.EventSource('/api/events');
    } catch (e) {
      return;
    }
    state.es = es;
    es.addEventListener('event', function (m) {
      pushRunEvent(parseSse(m.data));
    });
    es.addEventListener('run-end', function (m) {
      var d = parseSse(m.data);
      state.running = false;
      renderStatus();
      toast('运行结束 ' + (d && d.id ? d.id : ''), 'ok');
      refreshOverview(true);
    });
    es.addEventListener('run-done', function (m) {
      var d = parseSse(m.data);
      state.running = false;
      renderStatus();
      toast('归纳运行完成' + (d && d.id ? '：' + d.id : ''), 'ok');
      refreshOverview(true);
    });
    es.addEventListener('run-fail', function (m) {
      var d = parseSse(m.data);
      state.running = false;
      renderStatus();
      toast('运行失败：' + ((d && d.error) || '未知错误'), 'err');
      refreshOverview(true);
    });
    es.addEventListener('agent-answered', function (m) {
      var d = parseSse(m.data);
      toast('任务已作答：' + skillName(d && d.skill), 'ok');
      refreshOverview(true);
    });
    es.onerror = function () {
      if (es.readyState === 2) {
        state.es = null;
        setTimeout(connectEvents, 5000);
      }
    };
  }

  /* ====================== 8. 通用 HTML 片段 ====================== */

  function card(title, body, opts) {
    opts = opts || {};
    return (
      '<section class="card' + (opts.cls ? ' ' + opts.cls : '') + '">' +
      (title ? '<h2 class="card-title">' + title + '</h2>' : '') +
      (opts.flush ? body : '<div class="card-body">' + body + '</div>') +
      '</section>'
    );
  }

  function loadingBox(text) {
    return '<div class="loading">' + esc(text || '加载中…') + '</div>';
  }

  function emptyBox(text, sub) {
    return '<div class="empty">' + esc(text || '暂无数据') + (sub ? '<div class="small muted" style="margin-top:8px">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function bar(ratio, opts) {
    opts = opts || {};
    var v = numOr(ratio, 0);
    var w = Math.max(0, Math.min(100, v * 100));
    var cls = opts.cls || (v >= 0.95 ? 'ok' : v >= 0.7 ? '' : v >= 0.4 ? 'warn' : 'err');
    return '<div class="bar-row"><div class="bar"><div class="bar-fill ' + cls + '" style="width:' + w.toFixed(1) + '%"></div></div><span class="bar-val">' + esc(opts.text || pct(v, 0)) + '</span></div>';
  }

  function fold(title, bodyHtml, open, note) {
    return (
      '<div class="fold"><div class="fold-head"><span>' + esc(title) + '</span>' +
      '<span style="flex:1"></span>' + (note ? '<span class="fold-mark">' + esc(note) + '</span>' : '<span class="fold-mark">' + (open ? '收起' : '展开') + '</span>') +
      '</div><div class="fold-body"' + (open ? '' : ' hidden') + '>' + bodyHtml + '</div></div>'
    );
  }

  function kpi(label, value, hint, cls) {
    return (
      '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div>' + (hint ? '<div class="kpi-hint">' + esc(hint) + '</div>' : '') + '</div>'
    );
  }

  function pager(total, offset, limit) {
    total = Number(total) || 0;
    limit = Number(limit) || 30;
    offset = Number(offset) || 0;
    var page = Math.floor(offset / limit) + 1;
    var pages = Math.max(1, Math.ceil(total / limit));
    return (
      '<div class="pager">' +
      '<button class="btn btn-sm" data-act="pg-prev"' + (offset <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<button class="btn btn-sm" data-act="pg-next"' + (offset + limit >= total ? ' disabled' : '') + '>下一页</button>' +
      '<span class="pager-info">第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 条（当前 ' + (total ? offset + 1 : 0) + '-' + Math.min(offset + limit, total) + '）</span>' +
      '<select data-act="pg-size" class="pg-size" style="width:auto">' +
      [20, 30, 50, 100]
        .map(function (n) {
          return '<option value="' + n + '"' + (n === limit ? ' selected' : '') + '>' + n + ' 条/页</option>';
        })
        .join('') +
      '</select></div>'
    );
  }

  function summaryBrief(s) {
    if (!s) return '无摘要';
    var parts = [];
    Object.keys(s).forEach(function (k) {
      var v = s[k];
      if (typeof v === 'number') parts.push(k + '=' + v);
      else if (v && typeof v === 'object') {
        if (v.coverage != null) parts.push('第' + (v.chapterNo || k) + '章 覆盖 ' + pct(v.coverage, 0));
        else if (v.pending != null) parts.push('第' + (v.chapterNo || k) + '章 待作答 ' + v.pending);
        else parts.push(k + ' ' + Object.keys(v).length + ' 项');
      } else parts.push(k + '=' + String(v).slice(0, 20));
    });
    return parts.join(' ｜ ') || '无摘要';
  }

  /* ====================== 9. 页面：总览 ====================== */

  async function pageOverview(view) {
    view.innerHTML = loadingBox('正在读取总览数据…');
    var o = await api('/api/overview', { timeout: 30000 });
    state.overview = o;
    renderStatus();

    var c = o.corpus || {};
    var lib = o.library || {};
    var it = o.iteration || {};
    var agent = o.agent;
    var target = o.convergenceTarget || {};
    var mode = o.mode || 'agent';
    var covs = (o.chapters || [])
      .map(function (x) {
        return x.coverage;
      })
      .filter(function (v) {
        return typeof v === 'number' && isFinite(v);
      });
    var avgCov = covs.length ? covs.reduce(function (a, b) {
      return a + b;
    }, 0) / covs.length : null;

    var html = '';
    if (mode === 'agent' && agent && Number(agent.pending) > 0) {
      html +=
        '<div class="banner banner-warn"><span>有 ' + esc(agent.pending) + ' 个待智能体作答任务，测试模式下流水线会挂起等待回填。</span>' +
        '<span class="spacer"></span><a class="btn btn-sm btn-warn" href="#/agent">前往测试模式作答</a></div>';
    }

    html +=
      '<div class="banner ' + (mode === 'live' ? 'banner-info' : 'banner-warn') + '"><span class="badge ' + (mode === 'live' ? 'badge-primary' : 'badge-warn') + '">' + esc(MODE_CN[mode] || mode) + '</span>' +
      '<span>' +
        (mode === 'live'
          ? '生产模式：调用真实模型 ｜ baseUrl <span class="mono">' + esc(dash(o.baseUrl)) + '</span> ｜ model <span class="mono">' + esc(dash(o.model)) + '</span>'
          : '测试模式：由智能体扮演大模型（内容寻址回放，已作答 ' + esc(agent ? agent.answered : 0) + ' 项）') +
      '</span><span class="spacer"></span><a class="btn btn-sm" href="#/settings">前往设置</a></div>';

    html += '<div class="kpi-grid">';
    html += kpi('题目总数', esc(numOr(c.problems, 0)), '对齐解析 ' + numOr(c.aligned, 0) + ' 题');
    html += kpi('解析对齐率', esc(pct(c.alignRate, 1)), '解析条目 ' + numOr(c.solutions, 0) + ' 条', numOr(c.alignRate, 0) >= 0.8 ? 'is-ok' : 'is-warn');
    html += kpi('已拆解', esc(numOr(it.decomposed, 0)), '已归属通法 ' + numOr(it.matched, 0) + ' 题');
    html += kpi(
      '一级通法数',
      esc(numOr(lib.level1, 0)),
      '模板总数 ' + numOr(lib.templates, 0) + '（目标 ' + numOr(target.firstLevelTargetMin, '?') + '~' + numOr(target.firstLevelTargetMax, '?') + '）',
      target.firstLevelTargetMax && numOr(lib.level1, 0) > Number(target.firstLevelTargetMax) ? 'is-err' : ''
    );
    html += kpi('二级分支数', esc(numOr(lib.branches, 0)), '非一级模板 ' + numOr(lib.level2, 0) + ' 个');
    html += kpi('考点覆盖', avgCov == null ? '—' : esc(pct(avgCov, 1)), avgCov == null ? '尚未产生章节覆盖率' : '已覆盖题目 ' + numOr(lib.coveredProblems, 0) + ' 题', avgCov != null && avgCov < 0.7 ? 'is-warn' : 'is-ok');
    html += kpi(
      '待作答数',
      agent ? esc(numOr(agent.pending, 0)) : '<span class="muted">不适用</span>',
      agent ? '已作答 ' + numOr(agent.answered, 0) + ' 项' : '生产模式无需智能体作答',
      agent && Number(agent.pending) > 0 ? 'is-warn' : ''
    );
    html += '</div>';

    var chips = '';
    Object.keys(c.byRole || {}).forEach(function (r) {
      chips += '<span class="pill">' + esc(ROLE_CN[r] || r) + ' ' + c.byRole[r] + '</span>';
    });
    var acts = '';
    Object.keys(it.actions || {}).forEach(function (a) {
      acts += actionTag(a) + ' <span class="muted small">' + it.actions[a] + ' 题</span>&nbsp;&nbsp;';
    });

    html +=
      card(
        '语料与归纳进度',
        '<div class="kv">' +
          '<div class="kv-item"><div class="kv-k">输入文件</div><div class="kv-v">' + esc(numOr(c.files, 0)) + ' 个</div></div>' +
          '<div class="kv-item"><div class="kv-k">教材 / 公式条目</div><div class="kv-v">' + esc(numOr(c.lectures, 0)) + ' / ' + esc(numOr(c.formulaEntries, 0)) + '</div></div>' +
          '<div class="kv-item"><div class="kv-k">种子通法</div><div class="kv-v">' + esc(numOr(c.seeds, 0)) + ' 篇</div></div>' +
          '<div class="kv-item"><div class="kv-k">装配警告</div><div class="kv-v">' + esc(numOr(c.warnings, 0)) + ' 条</div></div>' +
          '<div class="kv-item"><div class="kv-k">模板产物</div><div class="kv-v">' + esc(numOr(lib.templates, 0)) + ' 个</div></div>' +
          '<div class="kv-item"><div class="kv-k">输出文件</div><div class="kv-v">' + esc((o.outputs || []).length) + ' 个</div></div>' +
        '</div>' +
          (chips ? '<div style="margin-top:12px">' + chips + '</div>' : '') +
          (acts ? '<div style="margin-top:12px">三档动作分布：' + acts + '</div>' : '') +
          '<div class="btn-bar" style="margin-top:14px"><a class="btn btn-sm" href="#/sources">数据源</a>' +
          '<a class="btn btn-sm" href="#/library">模板库</a><a class="btn btn-sm" href="#/output">输出产物</a>' +
          '<a class="btn btn-sm btn-primary" href="#/runs">启动归纳</a></div>'
      );

    var chs = o.chapters || [];
    var rows = chs
      .map(function (x) {
        var cov = typeof x.coverage === 'number' ? bar(x.coverage) : '<span class="muted small">未产生</span>';
        var status = x.done
          ? '<span class="badge badge-ok">已完成</span>'
          : numOr(x.templates, 0) > 0
          ? '<span class="badge badge-warn">进行中</span>'
          : '<span class="badge badge-mute">未开始</span>';
        return (
          '<tr><td class="nowrap"><b>第' + esc(x.no) + '章</b><div class="sub">' + esc(x.title) + '</div></td>' +
          '<td>' + esc(x.discipline) + '</td>' +
          '<td class="num">' + esc(numOr(x.problemCount, 0)) + '</td>' +
          '<td class="num">' + esc(numOr(x.matchedCount, 0)) + '</td>' +
          '<td class="num">' + esc(numOr(x.examPointCount, 0)) + '</td>' +
          '<td class="num">' + esc(numOr(x.templates, 0)) + '</td>' +
          '<td class="mono small">' + esc(dash(x.version)) + '</td>' +
          '<td style="min-width:150px">' + cov + '</td>' +
          '<td>' + status + '</td></tr>'
        );
      })
      .join('');
    html +=
      card(
        '章节进度<span class="spacer"></span><span class="card-note">共 ' + chs.length + ' 章</span>',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>章节</th><th>学科</th><th class="num">题目数</th><th class="num">有解析</th><th class="num">考点数</th><th class="num">模板数</th><th>版本</th><th>考点覆盖率</th><th>状态</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="9" class="muted">暂无章节数据</td></tr>') + '</tbody></table></div>'
      );

    var runs = o.runs || [];
    var runRows = runs
      .map(function (r) {
        var u = r.usage || {};
        return (
          '<tr><td class="mono small">' + esc(r.id) + '</td>' +
          '<td><span class="badge ' + (r.mode === 'live' ? 'badge-primary' : 'badge-warn') + '">' + esc(MODE_CN[r.mode] || r.mode || '—') + '</span></td>' +
          '<td class="small nowrap">' + esc(fmtTime(r.startedAt)) + '<div class="sub">' + esc(fmtTime(r.endedAt)) + '</div></td>' +
          '<td class="num">' + esc(numOr(u.calls, 0)) + '</td>' +
          '<td class="num">' + esc(numOr(u.tokensIn, 0) + numOr(u.tokensOut, 0)) + '</td>' +
          '<td class="num nowrap">' + esc(fmtMs(u.ms)) + '</td>' +
          '<td class="small">' + esc(summaryBrief(r.summary)) + '</td></tr>'
        );
      })
      .join('');
    html +=
      card(
        '最近运行<span class="spacer"></span><a class="btn btn-sm" href="#/runs">运行控制台</a>',
        runs.length
          ? '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>运行编号</th><th>模式</th><th>起止</th><th class="num">调用</th><th class="num">Token</th><th class="num">耗时</th><th>摘要</th></tr></thead><tbody>' + runRows + '</tbody></table></div>'
          : emptyBox('还没有运行记录', '到「运行」页启动一次归纳')
      );

    view.innerHTML = html;
  }

  /* ====================== 10. 页面：数据源 ====================== */

  async function pageSources(view) {
    view.innerHTML = loadingBox('正在读取输入目录…');
    var s = await api('/api/settings');
    state.settings = s;
    if (!state.overview) await refreshOverview(true);
    var o = state.overview || {};
    var c = o.corpus || {};

    var chips = '';
    Object.keys(c.byRole || {}).forEach(function (r) {
      chips += '<span class="pill">' + esc(ROLE_CN[r] || r) + ' ' + c.byRole[r] + '</span>';
    });

    var files = s.files || s.inputFiles || [];
    var rows = files
      .map(function (f) {
        return (
          '<tr><td class="small mono">' + esc(f.file) + '</td>' +
          '<td><span class="badge ' + (f.role === 'unknown' ? 'badge-err' : 'badge-primary') + '">' + esc(ROLE_CN[f.role] || f.role || '未识别') + '</span></td>' +
          '<td>' + esc(f.discipline || '通用') + '</td>' +
          '<td class="num nowrap">' + esc(fmtBytes(f.bytes)) + '</td>' +
          '<td class="small muted">' + esc(f.lectureKey || '') + '</td></tr>'
        );
      })
      .join('');

    var warnHtml;
    var ir = state.indexResult;
    if (ir && (ir.warnings || []).length) {
      warnHtml =
        '<ol class="small">' +
        ir.warnings
          .map(function (w) {
            return '<li>' + esc(w) + '</li>';
          })
          .join('') +
        '</ol>';
    } else {
      warnHtml = '<div class="muted small">当前统计到 <b>' + esc(numOr(c.warnings, 0)) + '</b> 条装配警告。点击「重新装配索引」可查看具体明细（接口返回前 20 条）。</div>';
    }

    view.innerHTML =
      '<div class="banner banner-info"><span>输入目录</span><span class="mono">' + esc(s.inputDir || c.inputDir || '—') + '</span>' +
        '<span class="spacer"></span><button class="btn btn-sm btn-primary" data-act="reindex">重新装配索引</button>' +
        '<button class="btn btn-sm" data-act="reload">刷新统计</button></div>' +
      '<div class="kpi-grid">' +
        kpi('文件数', esc(numOr(c.files, files.length)), '按文件名自动归类角色') +
        kpi('题目条目', esc(numOr(c.problems, 0)), '题库解析结果') +
        kpi('解析条目', esc(numOr(c.solutions, 0)), '答案册解析结果') +
        kpi('对齐成功', esc(numOr(c.aligned, 0)), '对齐率 ' + pct(c.alignRate, 1), numOr(c.alignRate, 0) >= 0.8 ? 'is-ok' : 'is-warn') +
        kpi('教材讲义', esc(numOr(c.lectures, 0)), '章节目录与考点来源') +
        kpi('公式条目', esc(numOr(c.formulaEntries, 0)), '校验环节引用') +
        kpi('种子通法', esc(numOr(c.seeds, 0)), '冷启动模板来源') +
        kpi('装配警告', esc(numOr(c.warnings, 0)), '题号跳跃 / 对齐失败等', numOr(c.warnings, 0) > 0 ? 'is-warn' : 'is-ok') +
      '</div>' +
      (chips ? card('角色分布', '<div>' + chips + '</div>') : '') +
      card(
        '输入文件清单<span class="spacer"></span><span class="card-note">共 ' + files.length + ' 个可解析 Markdown 文件</span>',
        files.length
          ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>文件名</th><th>角色</th><th>学科</th><th class="num">大小</th><th>教材键</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : emptyBox('未发现输入文件', '请确认输入目录下存在 OCR 生成的 Markdown')
      ) +
      card('装配警告', fold('警告明细', warnHtml, false, '共 ' + numOr(c.warnings, 0) + ' 条')) +
      '<div id="indexResult"></div>';

    view.onclick = async function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'reindex') {
        t.disabled = true;
        try {
          var r = await api('/api/index', { method: 'POST', body: {}, timeout: 60000 });
          state.indexResult = r;
          toast('索引装配完成：' + numOr(r.problems, 0) + ' 题', 'ok');
          await refreshOverview(true);
        } catch (err) {}
        t.disabled = false;
        pageSources(view);
      } else if (act === 'reload') {
        await refreshOverview(true);
        pageSources(view);
      }
    };
  }

  /* ====================== 11. 页面：题库 ====================== */

  var PROB_DEFAULT = { chapter: '', tier: '', section: '', q: '', status: '', limit: 30, offset: 0 };

  function probDetailHtml(full, p) {
    var prob = (full && full.problem) || p || {};
    var dec = (full && full.decomposition) || (p && p.decomposition);
    var mat = (full && full.match) || (p && p.match);
    var tpl = full && full.template;
    var out = '<div style="display:grid;gap:14px">';
    out += '<div><div class="field-label">题干</div><div class="md scroll-box">' + md(prob.stem) + '</div></div>';
    if (prob.options) out += '<div><div class="field-label">选项</div><div class="md scroll-box">' + md(prob.options) + '</div></div>';
    out +=
      '<div class="kv">' +
      '<div class="kv-item"><div class="kv-k">标答</div><div class="kv-v mono">' + esc(dash(prob.answerLabel)) + '</div></div>' +
      '<div class="kv-item"><div class="kv-k">定位</div><div class="kv-v small">第' + esc(prob.chapterNo) + '章 ' + esc(prob.tier || '—') + ' · ' + esc(prob.section || '—') + ' · 第' + esc(prob.no) + '题</div></div>' +
      '<div class="kv-item"><div class="kv-k">来源文件</div><div class="kv-v small mono">' + esc(trunc(prob.book || '—', 44)) + '</div></div>' +
      '</div>';
    out += '<div><div class="field-label">参考解析</div>' + (prob.solution ? '<div class="md scroll-box">' + md(prob.solution) + '</div>' : '<div class="empty">本题暂无对齐解析</div>') + '</div>';

    if (dec) {
      out += '<div class="field-label">5 字段标准拆解</div><div class="dec-list">';
      out += '<div class="dec-field"><h4>表面题型</h4><div class="txt">' + esc(dash(dec.surface_type)) + '</div></div>';
      out += '<div class="dec-field"><h4>核心本质</h4><div class="txt">' + esc(dash(dec.essence)) + '</div></div>';
      out +=
        '<div class="dec-field"><h4>标准解题步骤</h4>' +
        ((dec.steps || []).length ? '<ol>' + dec.steps.map(function (s) {
          return '<li>' + esc(s) + '</li>';
        }).join('') + '</ol>' : '<span class="muted">无</span>') +
        '</div>';
      var b = dec.boundaries || {};
      out +=
        '<div class="dec-field"><h4>边界条件</h4><div class="txt">' +
        '<div><b>适用前提：</b>' + ((b.applicable || []).length ? esc(b.applicable.join('；')) : '<span class="muted">未给出</span>') + '</div>' +
        '<div><b>失效场景：</b>' + ((b.invalid || []).length ? esc(b.invalid.join('；')) : '<span class="muted">未给出</span>') + '</div></div></div>';
      out +=
        '<div class="dec-field"><h4>对应考点</h4><div class="txt">' +
        ((dec.exam_points || []).length ? (dec.exam_points || []).map(function (x) {
          return '<span class="pill">' + esc(x) + '</span>';
        }).join('') : '<span class="muted">未匹配到考点</span>') +
        '</div></div></div>';
    } else out += '<div class="banner banner-info">该题尚未拆解：可在「运行」页对所属章节启动归纳。</div>';

    if (mat) {
      out +=
        '<div class="field-label">通法归属</div><div class="dec-field"><div class="txt">' +
        '<div><b>命中模板：</b>' + (mat.template_id ? '<a class="mono" href="#/library/' + esc(encodeURIComponent(mat.template_id)) + '">' + esc(mat.template_id) + '</a>' : '<span class="muted">无</span>') +
        (tpl ? ' <span class="badge badge-primary">' + esc(tpl.name || '') + '</span> <span class="muted small">' + esc(tpl.version || '') + '</span>' : '') + '</div>' +
        '<div><b>本质相似度：</b>' + (mat.similarity == null ? '—' : esc(mat.similarity)) + '　' + actionTag(mat.action) + '</div>' +
        (mat.tier ? '<div class="small muted">档位判定：' + esc(mat.tier) + '</div>' : '') +
        (mat.rationale ? '<div class="small">依据：' + esc(mat.rationale) + '</div>' : '') +
        (mat.conflict ? '<div class="small err-text">模型建议动作与系统强制档位不一致，已按相似度执行。</div>' : '') +
        '</div></div>';
    }
    out += '</div>';
    return out;
  }

  async function pageProblems(view, param) {
    var f = Object.assign({}, PROB_DEFAULT, lsGet('problems.filter', {}));
    if (param && /^ch?\d+$/.test(String(param))) f.chapter = String(param).replace(/^ch/, '');
    lsSet('problems.filter', f);

    view.innerHTML = card('筛选条件', '<div id="probFilters">' + loadingBox('加载筛选项…') + '</div>') + '<div id="probList">' + loadingBox('正在加载题目…') + '</div>';

    if (!state.chapters) {
      try {
        state.chapters = await api('/api/chapters');
      } catch (e) {
        state.chapters = [];
      }
    }
    var chapters = state.chapters || [];
    var box = byId('probFilters');

    function selOptions(name, values, cur, allLabel) {
      var html = '<select data-f="' + name + '"><option value="">' + esc(allLabel) + '</option>';
      values.forEach(function (v) {
        html += '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(v) + '</option>';
      });
      return html + '</select>';
    }

    box.innerHTML =
      '<div class="toolbar">' +
      '<div class="field" style="margin:0"><label>章节</label><select data-f="chapter"><option value="">全部章节</option>' +
      chapters
        .map(function (c) {
          return '<option value="' + esc(c.no) + '"' + (String(f.chapter) === String(c.no) ? ' selected' : '') + '>第' + esc(c.no) + '章 ' + esc(c.title) + '（' + numOr(c.problemCount, 0) + ' 题）</option>';
        })
        .join('') +
      '</select></div>' +
      '<div class="field" style="margin:0"><label>题型 tier</label>' + selOptions('tier', ['基础题', '综合题', '拓展题'], f.tier, '全部题型') + '</div>' +
      '<div class="field" style="margin:0"><label>Section</label>' + selOptions('section', ['选择题', '填空题', '解答题', '计算题', '证明题'], f.section, '全部节') + '</div>' +
      '<div class="field" style="margin:0"><label>拆解状态</label><select data-f="status">' +
      [['', '全部状态'], ['decomposed', '已拆解'], ['undecomposed', '未拆解'], ['nosolution', '缺解析']]
        .map(function (x) {
          return '<option value="' + x[0] + '"' + (f.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        })
        .join('') +
      '</select></div>' +
      '<div class="field search grow" style="margin:0"><label>关键词</label><input type="search" data-f="q" value="' + esc(f.q) + '" placeholder="题干 / 选项 / 解析全文检索"></div>' +
      '<div class="field" style="margin:0;flex:0 0 auto"><label>&nbsp;</label><div class="btn-bar">' +
      '<button class="btn btn-primary" data-act="prob-go">查询</button><button class="btn" data-act="prob-reset">重置</button></div></div>' +
      '</div>';

    async function loadList() {
      var holder = byId('probList');
      if (!holder) return;
      holder.innerHTML = loadingBox('正在加载题目…');
      var data;
      try {
        data = await api(
          '/api/problems' +
            qs(probQuery(f)),
          { timeout: 30000 }
        );
      } catch (e) {
        holder.innerHTML = emptyBox('题目加载失败');
        return;
      }
      state.probTotal = data.total;
      var items = data.items || [];
      var rows = items
        .map(function (p) {
          var open = state.openProb === p.id;
          return (
            '<tr class="clickable' + (open ? ' open' : '') + '" data-prob="' + esc(p.id) + '">' +
            '<td class="nowrap mono small">' + esc(p.id) + '</td>' +
            '<td class="nowrap">第' + esc(p.chapterNo) + '章</td>' +
            '<td class="nowrap">' + esc(p.tier || '—') + '</td>' +
            '<td class="nowrap">' + esc(p.section || '—') + '</td>' +
            '<td class="num">' + esc(p.no == null ? '—' : p.no) + '</td>' +
            '<td>' + esc(trunc(p.stem, 100)) + '</td>' +
            '<td class="nowrap">' + (p.hasSolution ? '<span class="badge badge-ok">有解析</span>' : '<span class="badge badge-err">缺解析</span>') + '</td>' +
            '<td class="nowrap">' + (p.decomposition ? '<span class="badge badge-primary">已拆解</span>' : '<span class="badge badge-mute">未拆解</span>') + '</td>' +
            '<td class="nowrap">' + (p.match ? esc(p.match.template_id || '—') + ' ' + actionTag(p.match.action) : '<span class="muted small">未归属</span>') + '</td>' +
            '</tr>' +
            (open ? '<tr class="tbl-detail"><td colspan="9">' + probDetailHtml(state.probCache[p.id] || null, p) + '</td></tr>' : '')
          );
        })
        .join('');
      holder.innerHTML =
        card(
          '题目列表<span class="spacer"></span><span class="card-note">点击任意行展开题干、解析与拆解结果</span>',
          (items.length
            ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>章</th><th>题型</th><th>节</th><th class="num">题号</th><th>题干</th><th>解析</th><th>拆解</th><th>归属通法</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : emptyBox('没有符合条件的题目', '放宽筛选条件，或先运行归纳')) + pager(data.total, f.offset, f.limit)
        );
    }

    function apply(patch, resetOffset) {
      Object.assign(f, patch);
      if (resetOffset) f.offset = 0;
      lsSet('problems.filter', f);
      loadList();
    }

    var debouncedSearch = debounce(function (v) {
      apply({ q: v }, true);
    }, 500);

    box.addEventListener('change', function (e) {
      var t = e.target.closest('[data-f]');
      if (!t) return;
      var patch = {};
      patch[t.getAttribute('data-f')] = t.value;
      apply(patch, true);
    });
    box.addEventListener('input', function (e) {
      var t = e.target.closest('[data-f="q"]');
      if (t) debouncedSearch(t.value);
    });
    box.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.getAttribute('data-act') === 'prob-reset') {
        state.openProb = null;
        lsSet('problems.filter', PROB_DEFAULT);
        f = Object.assign({}, PROB_DEFAULT);
        pageProblems(view);
      } else if (t.getAttribute('data-act') === 'prob-go') {
        state.openProb = null;
        apply({}, true);
      }
    });

    view.onclick = async function (e) {
      var pg = e.target.closest('[data-act]');
      if (pg) {
        var a = pg.getAttribute('data-act');
        if (a === 'pg-prev' && f.offset >= f.limit) {
          f.offset -= f.limit;
          lsSet('problems.filter', f);
          loadList();
          return;
        }
        if (a === 'pg-next' && f.offset + f.limit < state.probTotal) {
          f.offset += f.limit;
          lsSet('problems.filter', f);
          loadList();
          return;
        }
      }
      var tr = e.target.closest('tr[data-prob]');
      if (!tr) return;
      var id = tr.getAttribute('data-prob');
      if (state.openProb === id) {
        state.openProb = null;
        loadList();
        return;
      }
      state.openProb = id;
      if (!state.probCache[id]) {
        try {
          state.probCache[id] = await api('/api/problems/' + encodeURIComponent(id), { timeout: 30000 });
        } catch (err) {
          state.probCache[id] = null;
        }
      }
      loadList();
    };
    view.onchange = function (e) {
      if (e.target.closest('.pg-size')) {
        f.limit = numOr(e.target.value, 30);
        f.offset = 0;
        lsSet('problems.filter', f);
        loadList();
      }
    };

    await loadList();
  }

  /* ====================== 12. 页面：模板库 ====================== */

  function tplNode(t, active) {
    return (
      '<button class="tree-node' + (t.id === active ? ' active' : '') + '" data-tpl="' + esc(t.id) + '" type="button">' +
      '<span class="cnt">' + esc((t.branches || []).length) + '支 / ' + esc((t.covered_problem_ids || []).length) + '题</span>' +
      '<span class="mono small">' + esc(t.id) + '</span> ' + esc(trunc(t.name, 22)) + ' <span class="muted small">' + esc(t.version || '') + '</span>' +
      '</button>'
    );
  }

  async function pageLibrary(view, param) {
    view.innerHTML = loadingBox('正在加载模板库…');
    var lib;
    try {
      lib = await api('/api/library', { timeout: 30000 });
    } catch (e) {
      view.innerHTML = emptyBox('模板库加载失败');
      return;
    }
    state.library = lib;
    if (!state.matrix) {
      try {
        state.matrix = await api('/api/essence/matrix');
      } catch (e) {
        state.matrix = { pairs: [], count: 0 };
      }
    }
    if (!state.overview) await refreshOverview(true);
    var target = (state.overview && state.overview.convergenceTarget) || (state.settings && state.settings.convergence) || {};
    var stats = lib.stats || {};
    var l1 = numOr(stats.level1, 0);
    var min = numOr(target.firstLevelTargetMin, 0);
    var max = numOr(target.firstLevelTargetMax, 0);
    var convCls = max && l1 > max ? 'banner-err' : min && l1 < min ? 'banner-warn' : 'banner-ok';
    var convText =
      max && l1 > max
        ? '一级通法 ' + l1 + ' 个，超出目标上限 ' + max + ' 个：需要继续跨章合并去冗余。'
        : min && l1 < min
        ? '一级通法 ' + l1 + ' 个，尚未达到目标下限 ' + min + ' 个：需补充题目继续增量归纳。'
        : '一级通法 ' + l1 + ' 个，落在目标区间 ' + min + '~' + max + '，收敛良好。';

    var selId = param ? decodeURIComponent(String(param)) : state.selTemplate;
    if (!selId) {
      var first = null;
      (lib.tree || []).forEach(function (d) {
        (d.chapters || []).forEach(function (c) {
          if (!first && (c.templates || []).length) first = c.templates[0];
        });
        if (!first && (d.ungrouped || []).length) first = d.ungrouped[0];
      });
      selId = first ? first.id : null;
    }

    var treeData = lib.tree || [];
    var tree = '';
    var hasAny = treeData.some(function (d) {
      return d.count;
    });
    if (!hasAny) tree = '<div class="tree-empty">模板库为空：先在「运行」页执行种子导入与章节归纳。</div>';
    treeData.forEach(function (d) {
      if (!d.count) return;
      tree += '<div class="tree-disc">' + esc(d.discipline) + ' <span class="muted small">(' + d.count + ')</span></div>';
      (d.chapters || []).forEach(function (c) {
        tree += '<div class="tree-ch">第' + esc(c.no) + '章 ' + esc(c.title) + '</div>';
        (c.templates || []).forEach(function (t) {
          tree += tplNode(t, selId);
        });
      });
      if ((d.ungrouped || []).length) {
        tree += '<div class="tree-ch">未挂章模板</div>';
        d.ungrouped.forEach(function (t) {
          tree += tplNode(t, selId);
        });
      }
    });

    var pairs = state.matrix.pairs || [];
    var matrixHtml = pairs.length
      ? '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>模板 A</th><th>模板 B</th><th class="num">本质重合度</th><th>判定</th></tr></thead><tbody>' +
        pairs
          .slice(0, 100)
          .map(function (p) {
            var sa = Number(p.sa);
            var hi = sa >= 0.6;
            return (
              '<tr' + (hi ? ' class="open"' : '') + '>' +
              '<td><button class="btn btn-ghost btn-sm mono" data-tpl="' + esc(p.a) + '">' + esc(p.a) + '</button></td>' +
              '<td><button class="btn btn-ghost btn-sm mono" data-tpl="' + esc(p.b) + '">' + esc(p.b) + '</button></td>' +
              '<td class="num mono">' + esc(p.sa) + '</td>' +
              '<td>' + (hi ? '<span class="badge badge-err">高度重合，建议合并</span>' : '<span class="badge badge-mute">可继续观察</span>') + '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      : '<div class="muted small">暂无本质重合度候选对（重合度阈值 0.5），或模板数不足。</div>';

    view.innerHTML =
      '<div class="banner ' + convCls + '"><span class="bold">收敛状态</span><span>' + esc(convText) + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="badge">一级 ' + l1 + '</span><span class="badge">分支 ' + esc(numOr(stats.branches, 0)) + '</span>' +
      '<span class="badge">模板 ' + esc(numOr(stats.templates, 0)) + '</span><span class="badge">已合并 ' + esc(numOr(lib.merged, 0)) + '</span>' +
      '<a class="btn btn-sm" href="#/runs">继续归纳</a></div>' +
      '<div class="split">' +
      '<aside class="card side-pane"><h2 class="card-title" style="font-size:17px">模板树<span class="spacer"></span><span class="card-note">学科→章节→通法</span></h2>' +
      '<div class="tree">' + tree + '</div></aside>' +
      '<div><section id="tplDetail">' + loadingBox('加载模板详情…') + '</section>' +
      card('本质重合度候选对<span class="spacer"></span><span class="card-note">≥0.6 高亮，人工确认后在「运行」页带 reset 或编辑合并</span>', matrixHtml) +
      '</div></div>';

    view.onclick = function (e) {
      var t = e.target.closest('[data-tpl]');
      if (!t) return;
      var id = t.getAttribute('data-tpl');
      state.selTemplate = id;
      global.location.hash = '#/library/' + encodeURIComponent(id);
    };

    if (selId) await loadTemplate(selId);
    else byId('tplDetail').innerHTML = emptyBox('还没有模板', '运行归纳后自动生成');
  }

  async function loadTemplate(id) {
    var holder = byId('tplDetail');
    if (!holder) return;
    holder.innerHTML = loadingBox('正在加载模板 ' + id + ' …');
    var d;
    try {
      d = await api('/api/library/' + encodeURIComponent(id), { timeout: 30000 });
    } catch (e) {
      holder.innerHTML = emptyBox('模板加载失败：' + id);
      return;
    }
    var t = d.template || {};
    // 全局收敛后，题库/校验页里的「归属通法」可能指向已被吸收的历史模板：
    // 不点亮合并链，读者会以为它还在 18 条一级通法之列
    var mergedHtml = '';
    if (t.status === 'merged' && t.merged_into) {
      var chain = [{ id: t.id, name: t.name || t.id }];
      var cur = t, hops = 0;
      while (cur.status === 'merged' && cur.merged_into && hops++ < 12) {
        var nxt;
        try {
          var nd = await api('/api/library/' + encodeURIComponent(cur.merged_into), { timeout: 15000 });
          nxt = nd && nd.template;
        } catch (e) { nxt = null; }
        if (!nxt || !nxt.id) break;
        chain.push({ id: nxt.id, name: nxt.name || nxt.id, merged: nxt.status === 'merged' });
        cur = nxt;
      }
      var final = chain[chain.length - 1];
      var isLive = final.merged !== true && final.id !== t.id;
      mergedHtml =
        '<div class="banner banner-warn">' +
        '<span>本模板已被合并吸收，不再是一级通法；它的步骤与边界已作为二级分支并入' +
        (isLive
          ? ' <a class="mono" href="#/library/' + esc(encodeURIComponent(final.id)) + '">' + esc(final.name) + '（' + esc(final.id) + '）</a>'
          : ' <span class="mono">' + esc(final.id) + '</span>') +
        '</span><span class="spacer"></span>' +
        (isLive ? '<a class="btn btn-sm btn-warn" href="#/library/' + esc(encodeURIComponent(final.id)) + '">前往该通法</a>' : '') +
        '<span class="small muted" style="flex-basis:100%">合并链：' +
        chain.map(function (c) { return '<span class="mono">' + esc(c.id) + '</span>'; }).join(' → ') +
        '</span></div>';
    }
    var hist = (t.history || []).slice().reverse();
    var historyHtml = hist.length
      ? '<div class="timeline">' +
        hist
          .map(function (h) {
            return (
              '<div class="tl-item"><div><span class="tl-v">' + esc(h.version) + '</span> <span class="badge badge-mute">' + esc(h.action || '—') + '</span> ' +
              '<span class="muted small">' + esc(h.skill || '') + '</span></div>' +
              '<div class="tl-meta">' + esc(fmtTime(h.at)) + '</div>' +
              '<div class="tl-reason">' + esc(h.reason || '') + '</div></div>'
            );
          })
          .join('') +
        '</div>'
      : '<span class="muted small">暂无版本演进记录</span>';

    var examples = (d.examples || []).length
      ? '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>题号</th><th>题型 / 节</th><th>题干</th></tr></thead><tbody>' +
        d.examples
          .map(function (x) {
            var m = /^ch(\d+)/.exec(String(x.id || ''));
            return (
              '<tr><td class="mono small">' + esc(x.id) + '</td>' +
              '<td class="nowrap small">' + esc(x.tier || '—') + ' · ' + esc(x.section || '—') + '</td>' +
              '<td><a href="#/problems' + (m ? '/' + m[1] : '') + '">' + esc(trunc(x.stem || '（题干缺失）', 90)) + '</a></td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      : '<span class="muted small">尚未覆盖具体题目</span>';

    holder.innerHTML = card(
      '<span>' + esc(t.name || id) + '</span>' +
        '<span class="badge badge-primary mono">' + esc(id) + '</span><span class="badge">' + esc(t.version || '') + '</span>' +
        '<span class="badge ' + (t.kind === 'seed' ? 'badge-warn' : 'badge-mute') + '">' + (t.kind === 'seed' ? '种子通法' : '增量归纳') + '</span>' +
        (t.status === 'merged' ? '<span class="badge badge-err">已并入他法</span>' : '') +
        '<span class="spacer"></span><button class="btn btn-sm btn-primary" data-act="edit-tpl">编辑</button>',
      mergedHtml +
      '<div class="md">' + md(d.markdown || '') + '</div>' +
        '<div class="hr-soft"></div><h3 class="card-title" style="font-size:17px">典型例题</h3>' + examples +
        '<div class="hr-soft"></div><h3 class="card-title" style="font-size:17px">版本演进</h3>' + historyHtml
    );

    holder.onclick = function (e) {
      if (e.target.closest('[data-act="edit-tpl"]')) openEditor(t);
    };
  }

  function openEditor(t) {
    openDrawer(
      '编辑通法模板 ' + (t.id || ''),
      '<div class="field"><label>通法名称</label><input type="text" id="ed_name" value="' + esc(t.name || '') + '"></div>' +
        '<div class="field"><label>核心本质（原理层一句话）</label><textarea id="ed_essence" rows="3">' + esc(t.essence || '') + '</textarea></div>' +
        '<div class="field"><label>适用范围</label><textarea id="ed_scope" rows="2">' + esc(t.scope || '') + '</textarea></div>' +
        '<div class="field"><label>标准解题步骤（每行一条）</label><textarea id="ed_steps" rows="7">' + esc((t.steps || []).join('\n')) + '</textarea></div>' +
        '<div class="field"><label>二级分支（JSON 数组）</label><textarea id="ed_branches" rows="9" spellcheck="false">' + esc(JSON.stringify(t.branches || [], null, 2)) + '</textarea>' +
        '<div class="field-hint">字段：name / trigger / steps[] / surface_types[] / boundary</div></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>适用前提（每行一条）</label><textarea id="ed_app" rows="4">' + esc(((t.boundaries || {}).applicable || []).join('\n')) + '</textarea></div>' +
        '<div class="field"><label>失效场景（每行一条）</label><textarea id="ed_inv" rows="4">' + esc(((t.boundaries || {}).invalid || []).join('\n')) + '</textarea></div>' +
        '</div>' +
        '<div class="field"><label>对应考点（每行一条）</label><textarea id="ed_points" rows="3">' + esc((t.exam_points || []).join('\n')) + '</textarea></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>版本升级幅度</label><select id="ed_bump"><option value="minor">小版本 v1.2.3</option><option value="major">中版本 v1.3</option></select></div>' +
        '<div class="field"><label>修订理由</label><input type="text" id="ed_reason" value="网页端人工修订"></div>' +
        '</div>',
      '<span class="muted small">保存会写入模板库并追加一条 history</span>' +
        '<button class="btn" data-act="drawer-close">取消</button><button class="btn btn-primary" id="ed_save">保存修改</button>'
    );

    byId('ed_save').addEventListener('click', async function () {
      var btn = this;
      var br;
      try {
        br = JSON.parse(byId('ed_branches').value || '[]');
        if (!Array.isArray(br)) throw new Error('branches 必须是数组');
      } catch (err) {
        toast('二级分支 JSON 不合法：' + err.message, 'err', '检查逗号 / 引号 / 括号');
        return;
      }
      var body = {
        name: byId('ed_name').value.trim(),
        essence: byId('ed_essence').value.trim(),
        scope: byId('ed_scope').value.trim(),
        steps: lines(byId('ed_steps').value),
        branches: br,
        boundaries: { applicable: lines(byId('ed_app').value), invalid: lines(byId('ed_inv').value) },
        exam_points: lines(byId('ed_points').value),
        _bump: byId('ed_bump').value,
        _reason: byId('ed_reason').value.trim() || '网页端人工修订',
      };
      btn.disabled = true;
      try {
        await api('/api/library/' + encodeURIComponent(t.id), { method: 'PUT', body: body, timeout: 30000 });
        toast('模板已保存：' + t.id, 'ok');
        closeDrawer();
        await pageLibrary(byId('view'), encodeURIComponent(t.id));
      } catch (e) {}
      btn.disabled = false;
    });
  }

  /* ====================== 13. 页面：运行 ====================== */

  var RUN_DEFAULT = { chapters: [1], stages: ['seed', 'chapter', 'converge'], reset: false, autoScroll: true };

  async function pageRuns(view) {
    if (!state.overview) await refreshOverview(true);
    var saved = lsGet('runs.cfg', {});
    var run = Object.assign({}, RUN_DEFAULT, saved);
    if (!Array.isArray(run.chapters) || !run.chapters.length) run.chapters = RUN_DEFAULT.chapters;
    if (!Array.isArray(run.stages)) run.stages = RUN_DEFAULT.stages;
    lsSet('runs.cfg', run);

    var chapters = (state.overview && state.overview.chapters) || state.chapters || [];

    function evClass(type) {
      if (EV_RED[type]) return 'ev ev-error';
      if (EV_ORANGE[type]) return 'ev ev-pending';
      if (EV_GREEN[type]) return 'ev ev-merge';
      return 'ev';
    }

    function renderEvents() {
      var evBox = byId('evBox');
      if (!evBox) return;
      var list = state.runEvents;
      if (!list.length) {
        evBox.innerHTML = '<div class="ev"><span class="ev-msg muted">暂无事件：SSE 已连接，启动运行后此处实时输出。</span></div>';
        return;
      }
      evBox.innerHTML = list
        .slice(-300)
        .map(function (e) {
          return (
            '<div class="' + evClass(e.type) + '">' +
            '<span class="ev-time">' + esc(String(fmtTime(e.ts)).slice(11)) + '</span>' +
            '<span class="ev-type">' + esc(e.type || 'info') + '</span>' +
            '<span class="ev-msg">' + esc(e.msg || '') + (e.extra ? ' <span class="ev-extra">' + esc(trunc(jsonPretty(e.extra), 100)) + '</span>' : '') + '</span>' +
            '</div>'
          );
        })
        .join('');
      if (byId('autoScroll') && byId('autoScroll').checked) evBox.scrollTop = evBox.scrollHeight;
    }

    function renderUsage() {
      var box = byId('usageRow');
      if (!box) return;
      var u = state.runUsage || {};
      var pend = state.runPending || [];
      box.innerHTML =
        '<div class="usage-item">调用 <b>' + esc(numOr(u.calls, 0)) + '</b></div>' +
        '<div class="usage-item">Token 入 <b>' + esc(numOr(u.tokensIn, 0)) + '</b></div>' +
        '<div class="usage-item">Token 出 <b>' + esc(numOr(u.tokensOut, 0)) + '</b></div>' +
        '<div class="usage-item">耗时 <b>' + esc(fmtMs(u.ms)) + '</b></div>' +
        '<div class="usage-item">待作答批次 <b>' + esc(pend.length) + '</b></div>' +
        '<div class="usage-item">' + (state.running ? '<span class="dot breath"></span> 运行中' : '空闲') + '</div>';
    }

    state.runSubs = [renderEvents];

    view.innerHTML =
      '<div class="grid grid-2">' +
      card(
        '归纳配置',
        '<div class="field"><label>章节</label>' +
          '<div class="btn-bar" style="margin-bottom:8px">' +
          '<button class="btn btn-sm" data-act="pick-hs">全选高数 1-6</button>' +
          '<button class="btn btn-sm" data-act="pick-la">全选线代 7-12</button>' +
          '<button class="btn btn-sm" data-act="pick-all">全部章节</button>' +
          '<button class="btn btn-sm" data-act="pick-none">清空</button></div>' +
          '<div class="check-list">' +
          chapters
            .map(function (c) {
              var on = run.chapters.indexOf(Number(c.no)) >= 0;
              return (
                '<label class="check"><input type="checkbox" data-ch="' + esc(c.no) + '"' + (on ? ' checked' : '') + '>' +
                '第' + esc(c.no) + '章 ' + esc(c.title) + ' <span class="muted small">' + numOr(c.problemCount, 0) + ' 题</span></label>'
              );
            })
            .join('') +
          '</div></div>' +
          '<div class="field"><label>执行阶段</label><div class="check-list">' +
          STAGES.map(function (s) {
            var on = run.stages.indexOf(s.id) >= 0;
            return '<label class="check"><input type="checkbox" data-stage="' + s.id + '"' + (on ? ' checked' : '') + '>' + esc(s.name) + ' <span class="mono muted small">' + s.id + '</span></label>';
          }).join('') +
          '</div></div>' +
          '<div class="field"><label>危险操作</label>' +
          '<label class="check"><input type="checkbox" id="runReset"' + (run.reset ? ' checked' : '') + '>重置（清空模板库 / 拆解记录 / 产物 / 运行状态）</label>' +
          '<div class="field-hint err-text">重置会删除既有归纳结果，不可恢复，提交前需二次确认。</div></div>' +
          '<div class="btn-bar"><button class="btn btn-primary" id="btnStart">启动归纳</button>' +
          '<button class="btn btn-danger" id="btnStop">停止运行</button>' +
          '<button class="btn" data-act="reload-cur">同步当前状态</button></div>'
      ) +
      card(
        '实时事件流<span class="spacer"></span><label class="check small"><input type="checkbox" id="autoScroll"' + (run.autoScroll ? ' checked' : '') + '>自动滚动</label>',
        '<div class="usage-row" id="usageRow"></div>' +
          '<div class="events" id="evBox"></div>' +
          '<div class="field-hint">配色：橙=待作答挂起 ｜ 红=错误 / 致命 ｜ 绿=合并 / 质检 / 章节完成</div>'
      ) +
      '</div>' +
      card(
        '历史运行<span class="spacer"></span><button class="btn btn-sm" data-act="reload-runs">刷新</button>',
        '<div id="runsHist">' + loadingBox('加载历史记录…') + '</div>'
      );

    async function syncCurrent() {
      try {
        var r = await api('/api/run/current', { silent: true });
        var was = state.running;
        state.running = !!(r && r.running);
        if (r && r.running) {
          state.runUsage = r.usage || null;
          state.runPending = r.pending || [];
          if (was !== state.running || state.runEvents.length === 0) {
            state.runEvents = [];
            state.runEventSeen = {};
          }
          (r.events || []).forEach(pushRunEvent);
        } else if (was) {
          state.runUsage = null;
          state.runPending = [];
        }
        renderEvents();
        renderUsage();
        renderStatus();
      } catch (e) {}
    }

    async function loadRuns() {
      var holder = byId('runsHist');
      if (!holder) return;
      var runs;
      try {
        runs = await api('/api/runs');
        if (runs && !Array.isArray(runs)) runs = runs.items || [];
      } catch (e) {
        holder.innerHTML = emptyBox('历史记录加载失败');
        return;
      }
      if (!runs || !runs.length) {
        holder.innerHTML = emptyBox('还没有运行记录');
        return;
      }
      holder.innerHTML =
        '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>编号</th><th>模式</th><th>开始</th><th>结束</th><th class="num">调用</th><th class="num">Token</th><th class="num">耗时</th><th>章节 / 阶段</th></tr></thead><tbody>' +
        runs
          .map(function (r, i) {
            var u = r.usage || {};
            var meta = r.meta || {};
            return (
              '<tr class="clickable" data-run="' + i + '"><td class="mono small">' + esc(r.id) + '</td>' +
              '<td><span class="badge ' + (r.mode === 'live' ? 'badge-primary' : 'badge-warn') + '">' + esc(MODE_CN[r.mode] || r.mode || '—') + '</span></td>' +
              '<td class="small nowrap">' + esc(fmtTime(r.startedAt)) + '</td><td class="small nowrap">' + esc(fmtTime(r.endedAt)) + '</td>' +
              '<td class="num">' + esc(numOr(u.calls, 0)) + '</td><td class="num">' + esc(numOr(u.tokensIn, 0) + numOr(u.tokensOut, 0)) + '</td>' +
              '<td class="num nowrap">' + esc(fmtMs(u.ms)) + '</td>' +
              '<td class="small muted">章 ' + esc((meta.chapters || []).join(',')) + ' · ' + esc((meta.stages || []).join('+')) + '</td></tr>' +
              '<tr class="tbl-detail" hidden data-run-detail="' + i + '"><td colspan="8"><div class="md">' +
              md('#### 摘要\n\n```json\n' + jsonPretty(r.summary || {}) + '\n```\n\n#### 元信息\n\n```json\n' + jsonPretty(meta) + '\n```') +
              '</div></td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    }

    function collect() {
      var chs = Array.prototype.slice.call(view.querySelectorAll('[data-ch]:checked')).map(function (x) {
        return Number(x.getAttribute('data-ch'));
      });
      var stg = Array.prototype.slice.call(view.querySelectorAll('[data-stage]:checked')).map(function (x) {
        return x.getAttribute('data-stage');
      });
      var resetEl = byId('runReset');
      var scrollEl = byId('autoScroll');
      run = { chapters: chs, stages: stg, reset: !!(resetEl && resetEl.checked), autoScroll: !!(scrollEl && scrollEl.checked) };
      lsSet('runs.cfg', run);
      return run;
    }

    function quickPick(nos) {
      view.querySelectorAll('[data-ch]').forEach(function (x) {
        x.checked = nos.indexOf(Number(x.getAttribute('data-ch'))) >= 0;
      });
      collect();
    }

    view.onclick = async function (e) {
      var t = e.target.closest('[data-act]');
      if (t) {
        var act = t.getAttribute('data-act');
        if (act === 'pick-hs') return quickPick([1, 2, 3, 4, 5, 6]);
        if (act === 'pick-la') return quickPick([7, 8, 9, 10, 11, 12]);
        if (act === 'pick-all') return quickPick(chapters.map(function (c) {
          return Number(c.no);
        }));
        if (act === 'pick-none') return quickPick([]);
        if (act === 'reload-runs') return loadRuns();
        if (act === 'reload-cur') return syncCurrent();
      }
      var tr = e.target.closest('tr[data-run]');
      if (tr) {
        var i = tr.getAttribute('data-run');
        var d = view.querySelector('tr[data-run-detail="' + i + '"]');
        if (d) d.hidden = !d.hidden;
        return;
      }
      if (e.target.closest('#btnStart')) {
        var cfg = collect();
        if (!cfg.chapters.length) return toast('请至少选择一个章节', 'warn');
        if (!cfg.stages.length) return toast('请至少选择一个阶段', 'warn');
        if (cfg.reset) {
          var ok = await confirmModal({
            title: '危险操作确认：重置',
            danger: true,
            okText: '确认重置并启动',
            bodyHtml:
              '<div class="banner banner-err">重置会删除：模板库、拆解记录、匹配记录、校验报告、输出产物、运行状态。</div>' +
              '<p>本次将运行章节：<b>' + esc(cfg.chapters.join('、')) + '</b>；阶段：<b>' + esc(cfg.stages.join('、')) + '</b>。</p>' +
              '<p>此操作不可恢复，确定继续？</p>',
          });
          if (!ok) {
            byId('runReset').checked = false;
            collect();
            return;
          }
        }
        try {
          var r = await api('/api/run', { method: 'POST', body: { chapters: cfg.chapters, stages: cfg.stages, reset: cfg.reset }, timeout: 30000 });
          state.running = true;
          state.runEvents = [];
          state.runEventSeen = {};
          renderStatus();
          toast('已启动归纳运行' + (r && r.started ? '：章节 ' + (r.started.chapters || []).join('、') : ''), 'ok');
          setTimeout(syncCurrent, 600);
        } catch (err) {
          if (err.extra && err.extra.status === 409) {
            state.running = true;
            renderStatus();
            syncCurrent();
          }
        }
        return;
      }
      if (e.target.closest('#btnStop')) {
        var ok2 = await confirmModal({ title: '停止运行', text: '确定停止当前归纳运行？已完成批次的结果会保留。', okText: '停止运行', danger: true });
        if (!ok2) return;
        try {
          await api('/api/run/stop', { method: 'POST', body: {} });
          toast('已发送停止指令', 'ok');
        } catch (err) {}
      }
    };

    view.onchange = function (e) {
      if (e.target.closest('[data-ch],[data-stage],#runReset,#autoScroll')) collect();
    };

    renderEvents();
    renderUsage();
    await syncCurrent();
    loadRuns();

    state.teardown = function () {
      state.runSubs = [];
      state.teardown = null;
    };
    if (!state.runPoll) {
      state.runPoll = setInterval(function () {
        if (state.route === 'runs' && document.visibilityState === 'visible') {
          syncCurrent();
          if (!state.running) renderStatus();
        }
      }, 4000);
    }
  }

  /* ====================== 14. 页面：校验 ====================== */

  function verdictBadge(v) {
    var s = String(v || '').toLowerCase();
    if (s === 'pass') return '<span class="badge badge-ok">通过</span>';
    if (s === 'warn') return '<span class="badge badge-warn">警告</span>';
    if (s === 'fail') return '<span class="badge badge-err">不通过</span>';
    return '<span class="badge badge-mute">' + esc(v || '未判定') + '</span>';
  }

  function dimBadge(v) {
    var s = String(v || '').toLowerCase();
    var cn = { pass: '等价', warn: '存疑', fail: '错误' }[s] || '未判定';
    var cls = s === 'pass' ? 'badge-ok' : s === 'warn' ? 'badge-warn' : s === 'fail' ? 'badge-err' : 'badge-mute';
    return '<span class="badge ' + cls + '">' + esc(cn) + '</span>';
  }

  function qaIssueCount(r) {
    var n = 0;
    ((r.equivalence || {}).results || []).forEach(function (x) {
      if (x.verdict === 'fail') n += 2;
      else if (x.verdict === 'warn') n += 1;
    });
    ((r.boundary || {}).results || []).forEach(function (x) {
      if (x.verdict === 'fail') n += 2;
      else if (x.verdict === 'warn') n += 1;
    });
    var cov = r.coverage || {};
    if (cov.rate != null && Number(cov.rate) < 1) n += 1;
    return n;
  }

  function renderQaReport(item) {
    var r = item.report || {};
    var sm = item.summary || {};
    var eq = r.equivalence || {};
    var cov = r.coverage || (sm.coverage && item.report == null ? sm.coverage : {}) || {};
    var bdy = r.boundary || {};
    var out =
      '<div class="banner banner-info"><span class="bold">第 ' + esc(item.chapterNo) + ' 章质检报告</span>' +
      '<span class="mono small">生成时间 ' + esc(fmtTime(item.at)) + '</span><span class="spacer"></span>' +
      (eq.pending ? '<span class="badge badge-warn">等价校验待作答</span>' : typeof sm.equivalence === 'string' && !(eq.results || []).length ? '<span class="badge">等价 ' + esc(sm.equivalence) + '</span>' : '<span class="badge">等价结果 ' + (eq.results || []).length + ' 项</span>') +
      (cov.pending ? '<span class="badge badge-warn">覆盖校验待作答</span>' : '<span class="badge">覆盖率 ' + pct(cov.rate, 1) + '</span>') +
      (bdy.pending ? '<span class="badge badge-warn">边界校验待作答</span>' : typeof sm.boundary === 'string' && !(bdy.results || []).length ? '<span class="badge">边界 ' + esc(sm.boundary) + '</span>' : '<span class="badge">边界结果 ' + (bdy.results || []).length + ' 项</span>') +
      '</div>';

    /* 数学等价 */
    var eqHtml = '';
    if (eq.pending && !(eq.results || []).length) eqHtml = '<div class="banner banner-warn">等价校验存在待智能体作答任务：回填后重跑本章节即可生成完整报告。</div>';
    (eq.results || []).forEach(function (x) {
      var issues = x.issues || [];
      eqHtml +=
        '<div class="dec-field"><h4 class="mono">' + esc(x.template_id || '未知模板') + ' ' + verdictBadge(x.verdict) + '</h4>' +
        '<div class="btn-bar" style="margin:6px 0">' +
        '<span class="small">代数等价</span> ' + dimBadge(x.algebraic) +
        '<span class="small">数值等价</span> ' + dimBadge(x.numeric) +
        '<span class="small">逻辑等价</span> ' + dimBadge(x.logical) + '</div>' +
        (x.evidence ? '<div class="small muted">实证：' + esc(x.evidence) + '</div>' : '') +
        (issues.length
          ? '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl compact"><thead><tr><th>维度</th><th>严重度</th><th>问题描述</th><th>修改建议</th></tr></thead><tbody>' +
            issues
              .map(function (i) {
                var sev = String(i.severity || '').toLowerCase();
                return (
                  '<tr><td class="nowrap">' + esc({ algebraic: '代数等价', numeric: '数值等价', logical: '逻辑等价' }[i.type] || i.type || '—') + '</td>' +
                  '<td><span class="badge ' + (sev === 'high' ? 'badge-err' : sev === 'medium' ? 'badge-warn' : 'badge-mute') + '">' + esc(sev || '—') + '</span></td>' +
                  '<td>' + esc(i.detail || '') + '</td><td class="small">' + esc(i.fix || '—') + '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table></div>'
          : '<div class="small muted">未发现问题</div>') +
        ((x.corrected_steps || []).length ? '<div class="small"><b>纠正后的完整步骤：</b><ol>' + x.corrected_steps.map(function (s) {
          return '<li>' + esc(s) + '</li>';
        }).join('') + '</ol></div>' : '') +
        '</div>';
    });
    if (!eqHtml) eqHtml = emptyBox('该章节尚未生成数学等价结果');
    out += card('数学等价校验<span class="spacer"></span><span class="card-note">代数等价 / 数值等价 / 恒等变形三维度</span>', eqHtml);

    /* 考点覆盖 */
    var covered = cov.covered || [];
    var uncovered = cov.uncovered || [];
    var covHtml = '<div style="margin-bottom:14px">' + bar(numOr(cov.rate, 0), { text: pct(cov.rate, 1) + '（已覆盖 ' + covered.length + ' / ' + numOr(cov.total, 0) + '）' }) + '</div>';
    covHtml +=
      '<div class="grid grid-2">' +
      '<div><div class="field-label">已覆盖考点（' + covered.length + '）</div><div class="scroll-box">' +
      (covered.length
        ? '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>考点</th><th>归属模板</th><th class="num">相似度</th><th>判定方式</th></tr></thead><tbody>' +
          covered
            .map(function (x) {
              var sim = x.sim != null ? x.sim : x.similarity;
              return (
                '<tr><td>' + esc(x.point) + '</td>' +
                '<td class="mono small"><a href="#/library/' + esc(encodeURIComponent(x.template_id || '')) + '">' + esc(x.template_id || '—') + '</a></td>' +
                '<td class="num">' + esc(sim == null ? '—' : sim) + '</td>' +
                '<td>' + (x.by === 'llm' ? '<span class="badge badge-primary">大模型判定</span>' : '<span class="badge badge-mute">确定性匹配</span>') + '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<span class="muted">无</span>') +
      '</div></div>' +
      '<div><div class="field-label">未覆盖考点（' + uncovered.length + '）</div><div class="scroll-box">' +
      (uncovered.length ? '<ul>' + uncovered.map(function (p) {
        return '<li>' + esc(p) + '</li>';
      }).join('') + '</ul>' : '<span class="ok-text">本章考点已全部覆盖</span>') +
      '</div></div></div>';
    if (cov.pending) covHtml += '<div class="banner banner-warn" style="margin-top:12px">残留考点的模型判定尚未完成（待作答），实际覆盖率可能更高。</div>';
    if ((cov.llm || []).length) covHtml += '<div style="margin-top:12px">' + fold('大模型判定明细（' + cov.llm.length + ' 项）', '<div class="mono small pre-wrap">' + esc(jsonPretty(cov.llm).slice(0, 6000)) + '</div>', false) + '</div>';
    if ((cov.residual || []).length && Array.isArray(cov.residual))
      covHtml += '<div style="margin-top:12px">' + fold('确定性匹配残留考点（' + cov.residual.length + '）', '<ul class="small">' + cov.residual.map(function (p) {
        return '<li>' + esc(typeof p === 'string' ? p : p.point || jsonPretty(p)) + '</li>';
      }).join('') + '</ul>', false) + '</div>';
    out += card('考点覆盖校验<span class="spacer"></span><span class="card-note">先确定性语义匹配，残留交模型判定</span>', covHtml);

    /* 边界一致性 */
    var bdyHtml = '';
    if (bdy.pending && !(bdy.results || []).length) bdyHtml = '<div class="banner banner-warn">边界一致性校验存在待作答任务。</div>';
    (bdy.results || []).forEach(function (x) {
      var cs = x.conflicts || [];
      bdyHtml +=
        '<div class="dec-field"><h4 class="mono">' + esc(x.template_id || '未知模板') + ' ' + verdictBadge(x.verdict) + '</h4>' +
        (cs.length
          ? '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>冲突类型</th><th>涉及模板</th><th>冲突描述</th><th>消歧方案</th></tr></thead><tbody>' +
            cs
              .map(function (c) {
                return (
                  '<tr><td class="nowrap">' + esc({ contradiction: '前提与失效矛盾', 'branch-overlap': '分支触发重叠', 'cross-template': '跨模板归属冲突' }[c.kind] || c.kind || '—') + '</td>' +
                  '<td class="mono small">' + esc((c.targets || []).join(' , ') || '—') + '</td>' +
                  '<td>' + esc(c.detail || '') + '</td><td class="small">' + esc(c.resolution || '—') + '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table></div>'
          : '<div class="small ok-text">适用前提与失效场景不矛盾，分支触发特征互斥，归属确定</div>') +
        '</div>';
    });
    if (!bdyHtml) bdyHtml = emptyBox('该章节尚未生成边界一致性结果');
    out += card('边界一致性校验<span class="spacer"></span><span class="card-note">前提矛盾 / 分支重叠 / 归属不确定</span>', bdyHtml);

    return out;
  }

  /* 质检报告列表：优先契约形态 GET /api/qa → 数组；
     若后端改为「列表摘要 + 单章详情」，则回落 /api/qa/list + /api/qa?chapter=N */
  async function loadQaList() {
    var direct = null;
    try {
      direct = await api('/api/qa', { silent: true, timeout: 30000 });
    } catch (e) {
      direct = null;
    }
    if (Array.isArray(direct)) return direct;
    if (direct && direct.chapterNo != null && direct.report) return [direct];
    var sum;
    try {
      sum = await api('/api/qa/list', { timeout: 30000 });
    } catch (e2) {
      return null;
    }
    sum = Array.isArray(sum) ? sum : (sum && sum.items) || [];
    var out = [];
    for (var i = 0; i < sum.length; i++) {
      var ch = sum[i].chapterNo;
      var rep = sum[i].report || null;
      if (!rep) {
        var one = null;
        try {
          one = await api('/api/qa' + qs({ chapter: ch }), { silent: true, timeout: 30000 });
        } catch (e3) {
          one = null;
        }
        rep = (one && one.report) || (one && one.equivalence ? one : null);
      }
      out.push({ chapterNo: ch, at: sum[i].at, report: rep || null, summary: sum[i] });
    }
    return out;
  }

  async function pageQa(view, param) {
    view.innerHTML = loadingBox('正在加载质检报告…');
    var list = await loadQaList();
    if (list === null) {
      view.innerHTML = emptyBox('质检报告加载失败');
      return;
    }
    state.qaReports = list || [];
    if (!state.qaReports.length) {
      view.innerHTML =
        '<div class="banner banner-info">还没有任何质检报告。三份报告（数学等价 / 考点覆盖 / 边界一致性）在该章节匹配阶段全部命中缓存后自动执行并落盘。</div>' +
        card('下一步', '<a class="btn btn-primary" href="#/runs">启动归纳</a>');
      return;
    }
    var sel = param != null && param !== '' ? String(param) : String(state.selQa != null ? state.selQa : state.qaReports[0].chapterNo);
    state.selQa = sel;
    var rep = state.qaReports.filter(function (x) {
      return String(x.chapterNo) === sel;
    })[0];

    var tabs = state.qaReports
      .map(function (x) {
        var bad = qaIssueCount(x.report || {});
        var on = String(x.chapterNo) === sel;
        return (
          '<button class="btn btn-sm ' + (on ? 'btn-primary' : '') + '" data-qa="' + esc(x.chapterNo) + '">第' + esc(x.chapterNo) + '章' +
          (bad ? ' <span class="tag tag-' + (bad >= 3 ? 'new' : 'branch') + '">' + bad + '</span>' : ' <span class="tag tag-refine">OK</span>') + '</button>'
        );
      })
      .join('');

    view.innerHTML = card('章节选择<span class="spacer"></span><span class="card-note">徽标为该章节问题权重</span>', '<div class="btn-bar">' + tabs + '</div>') + (rep ? renderQaReport(rep) : emptyBox('该章节尚未质检', '选择左侧其他已生成报告的章节'));

    view.onclick = function (e) {
      var t = e.target.closest('[data-qa]');
      if (!t) return;
      global.location.hash = '#/qa/' + t.getAttribute('data-qa');
    };
  }

  /* ====================== 15. 页面：输出 ====================== */

  function outDownloadHref(p) {
    return String(p).indexOf('/') < 0 ? '/api/outputs/' + encodeURIComponent(p) + '?download=1' : '/output/' + encodePath(p);
  }

  async function fetchOutputText(p) {
    if (String(p).indexOf('/') < 0) {
      var d = await api('/api/outputs/' + encodeURIComponent(p), { timeout: 30000 });
      return (d && (d.content || d.__text)) || '';
    }
    var res = await fetch('/output/' + encodePath(p), { credentials: 'same-origin' });
    var ct = (res.headers && res.headers.get('content-type')) || '';
    var text = await res.text();
    if (!res.ok || ct.indexOf('text/html') >= 0) throw new Error('文件不存在或不可预览');
    return text;
  }

  async function pageOutput(view) {
    view.innerHTML = loadingBox('正在列出产物文件…');
    var d;
    try {
      d = await api('/api/outputs');
    } catch (e) {
      view.innerHTML = emptyBox('输出目录读取失败');
      return;
    }
    var items = d.items || [];
    state.outputs = items;

    var groups = {};
    items.forEach(function (f) {
      var i = String(f.path).indexOf('/');
      var g = i < 0 ? '' : String(f.path).slice(0, i);
      (groups[g] = groups[g] || []).push(f);
    });
    var order = uniq(['', '模板库', '拆解记录', '校验报告', '运行日志'].concat(Object.keys(groups)));
    var labels = { '': '考研数学万能通法手册（根目录）', 模板库: '模板库', 拆解记录: '拆解记录', 校验报告: '校验报告', 运行日志: '运行日志' };

    var html =
      '<div class="banner banner-info"><span>输出目录</span><span class="mono">' + esc(d.dir || 'output') + '</span>' +
      '<span class="spacer"></span><span class="badge">共 ' + items.length + ' 个文件</span>' +
      '<button class="btn btn-sm" data-act="reload-out">刷新</button></div>';
    if (!items.length) html += emptyBox('还没有产物文件', '运行归纳后自动生成：手册 / 章节模板库 / 单题拆解 / 校验报告 / 运行日志');

    order.forEach(function (g) {
      var list = groups[g];
      if (!list || !list.length) return;
      var rows = list
        .map(function (f) {
          return (
            '<tr><td class="small mono">' + esc(f.name) + '</td>' +
            '<td class="num nowrap">' + esc(fmtBytes(f.bytes)) + '</td>' +
            '<td class="small nowrap">' + esc(fmtTime(f.mtime)) + '</td>' +
            '<td class="btn-bar nowrap" style="justify-content:flex-end">' +
            '<button class="btn btn-sm" data-preview="' + esc(f.path) + '">预览</button>' +
            '<a class="btn btn-sm" href="' + esc(outDownloadHref(f.path)) + '" download target="_blank" rel="noopener">下载</a></td></tr>'
          );
        })
        .join('');
      html +=
        card('『' + esc(labels[g] || g) + '』<span class="spacer"></span><span class="card-note">' + list.length + ' 个文件</span>',
          '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>文件</th><th class="num">大小</th><th>修改时间</th><th style="text-align:right">操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>');
    });
    html += '<div id="outPreview"></div>';
    view.innerHTML = html;

    view.onclick = async function (e) {
      var t = e.target.closest('[data-act],[data-preview]');
      if (!t) return;
      if (t.getAttribute('data-act') === 'reload-out') return pageOutput(view);
      if (t.getAttribute('data-act') === 'hide-prev') {
        byId('outPreview').innerHTML = '';
        return;
      }
      var p = t.getAttribute('data-preview');
      if (!p) return;
      var box = byId('outPreview');
      box.innerHTML = loadingBox('正在读取 ' + p + ' …');
      try {
        var text = await fetchOutputText(p);
        box.innerHTML =
          card(
            '<span class="mono">' + esc(p) + '</span><span class="spacer"></span>' +
              '<a class="btn btn-sm" href="' + esc(outDownloadHref(p)) + '" download target="_blank" rel="noopener">下载</a>' +
              '<a class="btn btn-sm" href="/output/' + esc(encodePath(p)) + '" target="_blank" rel="noopener">原文</a>' +
              '<button class="btn btn-sm" data-act="hide-prev">收起预览</button>',
            '<div class="md scroll-box tall">' + md(text) + '</div>'
          );
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        box.innerHTML = emptyBox('预览失败：' + p, (err && err.message) || '');
      }
    };
  }

  /* ====================== 16. 页面：设置 ====================== */

  function modelOptions(cur) {
    var list = state.models || [];
    var html = '<option value="">（自动 / 回落全局 model）</option>';
    if (cur && list.map(function (m) {
      return m.id || m;
    }).indexOf(cur) < 0) html += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '（当前）</option>';
    list.forEach(function (m) {
      var id = m.id || m;
      html +=
        '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' +
        esc(id + (m.provider ? ' ｜ ' + m.provider : '') + (m.context ? ' ｜ ctx ' + m.context : '') + (m.reasoning ? ' ｜ 推理' : '')) +
        '</option>';
    });
    return html;
  }

  function modelRows(list) {
    if (!list.length) return '<tr><td colspan="6" class="muted">无匹配模型</td></tr>';
    return list
      .map(function (m) {
        return (
          '<tr><td class="mono">' + esc(m.id) + ' <button class="btn btn-sm btn-ghost" data-pick-model="' + esc(m.id) + '">设为全局模型</button></td>' +
          '<td>' + esc(m.provider || '—') + '</td>' +
          '<td class="num">' + esc(m.context || '—') + '</td>' +
          '<td>' + (m.reasoning ? '<span class="badge badge-primary">支持推理</span>' : '<span class="badge badge-mute">常规</span>') + '</td>' +
          '<td class="small">' + ((m.tags || []).length ? m.tags.map(function (t) {
            return '<span class="pill mute">' + esc(t) + '</span>';
          }).join('') : '—') + '</td>' +
          '<td class="small muted">' + esc(m.note || '') + '</td></tr>'
        );
      })
      .join('');
  }

  async function pageSettings(view) {
    view.innerHTML = loadingBox('正在读取设置…');
    var s;
    try {
      s = await api('/api/settings');
    } catch (e) {
      view.innerHTML = emptyBox('设置读取失败');
      return;
    }
    state.settings = s;
    if (!state.skills) {
      try {
        state.skills = await api('/api/skills');
      } catch (e) {}
    }
    var llm = s.llm || {};
    var batch = s.batch || {};
    var conv = s.convergence || {};
    var routing = llm.routing || {};
    var hints = llm.routingHints || {};
    var skillIds = uniq(Object.keys(hints).concat(Object.keys(routing)));
    var titles = {};
    ((state.skills && state.skills.skills) || []).forEach(function (k) {
      titles[k.id] = k.title;
    });

    function numField(id, label, val, step, hint) {
      return (
        '<div class="field"><label>' + esc(label) + '</label>' +
        '<input type="number" id="' + id + '" step="' + step + '" value="' + esc(val == null ? '' : val) + '">' +
        (hint ? '<div class="field-hint">' + esc(hint) + '</div>' : '') + '</div>'
      );
    }

    view.innerHTML =
      card(
        '运行模式',
        '<label class="check"><input type="radio" name="st_mode" value="agent"' + (s.mode === 'agent' ? ' checked' : '') + '>测试模式（由智能体扮演大模型，内容寻址回放）</label>　' +
          '<label class="check"><input type="radio" name="st_mode" value="live"' + (s.mode === 'live' ? ' checked' : '') + '>生产模式（调用真实大模型）</label>' +
          '<div class="field-hint">测试模式与生产模式走完全相同的流水线代码，仅把「模型推理」替换为「智能体推理」。</div>'
      ) +
      card(
        '生产模式接入<span class="spacer"></span><span class="card-note">baseUrl 通常以 /v1 结尾</span>',
        '<div class="field-row">' +
          '<div class="field"><label>baseUrl</label><input type="text" id="st_baseUrl" value="' + esc(llm.baseUrl || '') + '" placeholder="兼容网关地址，通常以 /v1 结尾"></div>' +
          '<div class="field"><label>apiKey</label><input type="password" id="st_apiKey" autocomplete="new-password" placeholder="' +
          esc((llm.apiKeySet || llm.hasKey) ? '已配置 ' + (llm.apiKeyMasked || '****') + '（留空表示不修改）' : '尚未配置') + '"></div>' +
          '<div class="field"><label>model（全局默认）</label><input type="text" id="st_model" value="' + esc(llm.model || '') + '" placeholder="deepseek-chat"></div>' +
        '</div>' +
        '<div class="btn-bar"><button class="btn" id="btnModels">一键获取模型列表</button>' +
        '<button class="btn" id="btnProbe">逐个试跑</button><span class="muted small" id="modelsSrc"></span></div>' +
        '<div id="modelBox"></div><div id="probeBox"></div>'
      ) +
      card(
        '模型自主路由表<span class="spacer"></span><span class="card-note">按 Skill 能力偏好指定模型，留空回落全局 model</span>',
        '<div class="btn-bar" style="margin-bottom:12px"><button class="btn" id="btnRouteAll">全部自动选择</button>' +
        '<button class="btn" data-act="reload-settings">重新加载设置</button></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Skill</th><th>能力需求</th><th style="min-width:230px">指定模型</th><th>自动选择</th><th style="min-width:260px">打分依据</th></tr></thead><tbody>' +
        skillIds
          .map(function (id) {
            var h = hints[id] || {};
            return (
              '<tr data-skill="' + esc(id) + '">' +
              '<td><b>' + esc(titles[id] || SKILL_CN[id] || id) + '</b><div class="sub mono small">' + esc(id) + '</div></td>' +
              '<td class="small">' + esc(h.need === 'long-context' ? '长上下文' : h.need === 'reasoning' ? '推理能力' : h.need || '通用') +
              '<div class="sub">需要 ' + esc(numOr(h.maxContext, 8000)) + ' tokens ｜ T=' + esc(h.temperature == null ? '默认' : h.temperature) + '</div></td>' +
              '<td><select data-route="' + esc(id) + '">' + modelOptions(routing[id] || '') + '</select></td>' +
              '<td><button class="btn btn-sm" data-autoroute="' + esc(id) + '">自动选择</button></td>' +
              '<td class="small" data-reason="' + esc(id) + '"><span class="muted">未自动选择</span></td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      ) +
      card(
        '推理参数<span class="spacer"></span><span class="card-note">数值直接写入 config/settings.json</span>',
        '<div class="field-row">' +
          numField('st_temperature', 'temperature', llm.temperature, 0.05, '采样温度：归纳/校验建议 0~0.3') +
          numField('st_maxTokens', 'maxTokens', llm.maxTokens, 1, '单次响应最大 token') +
          numField('st_timeoutMs', 'timeoutMs', llm.timeoutMs, 1000, '单次调用超时（毫秒）') +
          numField('st_retries', 'retries', llm.retries, 1, '失败重试次数') +
          numField('st_concurrency', 'concurrency', llm.concurrency, 1, '并发调用上限') +
          numField('st_ppc', 'batch.problemsPerCall', batch.problemsPerCall, 1, '每批题目数') +
        '</div>' +
        '<div class="field-row">' +
          numField('st_maxStem', 'batch.maxStemChars', batch.maxStemChars, 50, '题干截断长度') +
          numField('st_maxSol', 'batch.maxSolutionChars', batch.maxSolutionChars, 50, '解析截断长度') +
        '</div>'
      ) +
      card(
        '收敛目标<span class="spacer"></span><span class="card-note">控制一级通法总量，防止方法爆炸</span>',
        '<div class="field-row">' +
          numField('st_min', 'firstLevelTargetMin', conv.firstLevelTargetMin, 1, '一级通法下限') +
          numField('st_max', 'firstLevelTargetMax', conv.firstLevelTargetMax, 1, '一级通法上限（超标红色提示）') +
          numField('st_cross', 'crossMergeEveryChapters', conv.crossMergeEveryChapters, 1, '每 N 章做一次跨章共性合并') +
        '</div>'
      ) +
      card(
        '保存',
        '<div class="btn-bar"><button class="btn btn-primary" id="btnSave">保存设置</button>' +
        '<button class="btn" id="btnResetForm">放弃修改并重载</button>' +
        '<span class="muted small">apiKey 留空表示保持原值；模式切换后顶部状态条立即同步</span></div>'
      );

    function renderModelBox() {
      var box = byId('modelBox');
      var src = byId('modelsSrc');
      if (!box) return;
      if (!state.models.length) {
        box.innerHTML = '<div class="muted small" style="margin-top:10px">尚未获取模型列表：生产模式读取远端 /models；测试模式返回内置离线目录。</div>';
        if (src) src.textContent = '';
        return;
      }
      if (src) src.textContent = '来源：' + (state.modelsSource === 'remote' ? '远端接口' : '离线目录') + ' ｜ ' + state.models.length + ' 个模型';
      box.innerHTML =
        '<div class="field" style="margin-top:14px"><label>筛选模型</label>' +
        '<input type="search" id="mSearch" placeholder="按 id / provider / 标签关键字过滤"></div>' +
        '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>模型 id</th><th>provider</th><th class="num">上下文</th><th>推理</th><th>标签</th><th>备注</th></tr></thead><tbody id="mBody">' +
        modelRows(state.models) + '</tbody></table></div>';
      var search = byId('mSearch');
      if (search)
        search.oninput = function () {
          var k = this.value.toLowerCase();
          var body = byId('mBody');
          if (!body) return;
          body.innerHTML = modelRows(
            state.models.filter(function (m) {
              if (!k) return true;
              return [m.id, m.provider, (m.tags || []).join(' '), m.note].join(' ').toLowerCase().indexOf(k) >= 0;
            })
          );
        };
    }
    renderModelBox();

    function refreshRouteSelects() {
      view.querySelectorAll('[data-route]').forEach(function (sel) {
        sel.innerHTML = modelOptions(sel.value);
      });
    }

    function showRouteReason(sid, info) {
      var cell = view.querySelector('[data-reason="' + sid + '"]');
      if (!cell || !info) return;
      var cand = (info.candidates || [])
        .map(function (c) {
          return '<span class="pill mute">' + esc(c.id) + ' · ' + esc(c.score) + '</span>';
        })
        .join('');
      cell.innerHTML =
        '<div><b class="mono">' + esc(info.model) + '</b>' + (info.temperature != null ? ' <span class="muted small">T=' + esc(info.temperature) + '</span>' : '') + '</div>' +
        '<div class="muted small">' + esc((info.reason || []).join('；')) + '</div>' + '<div style="margin-top:4px">' + cand + '</div>';
      state.routeResults[sid] = info;
    }

    view.onclick = async function (e) {
      var pick = e.target.closest('[data-pick-model]');
      if (pick) {
        byId('st_model').value = pick.getAttribute('data-pick-model');
        toast('已填入全局模型：' + pick.getAttribute('data-pick-model'), 'ok');
        return;
      }
      var t = e.target.closest('[data-act]');
      if (t && t.getAttribute('data-act') === 'reload-settings') return pageSettings(view);

      var auto = e.target.closest('[data-autoroute]');
      if (auto) {
        var sid = auto.getAttribute('data-autoroute');
        auto.disabled = true;
        try {
          var r = await api('/api/route', { method: 'POST', body: { skills: [sid] } });
          var info = (r.routing || {})[sid];
          var sel = view.querySelector('[data-route="' + sid + '"]');
          if (info && sel) {
            if (!state.models.length && (r.available || []).length) {
              state.models = r.available.map(function (id) {
                return { id: id };
              });
              state.modelsSource = 'route';
              renderModelBox();
            }
            if (state.models.length) sel.value = info.model;
            else if (sel.options.length) {
              sel.insertAdjacentHTML('afterbegin', '<option value="' + esc(info.model) + '" selected>' + esc(info.model) + '（自动推荐）</option>');
            }
            showRouteReason(sid, info);
          }
          toast('已为「' + skillName(sid) + '」自动选择模型：' + (info ? info.model : '—'), 'ok');
        } catch (err) {}
        auto.disabled = false;
        return;
      }

      if (e.target.closest('#btnModels')) {
        var b1 = byId('btnModels');
        b1.disabled = true;
        try {
          var rm = await api('/api/models', { timeout: 40000 });
          state.models = (rm && rm.models) || [];
          state.modelsSource = (rm && rm.source) || '';
          refreshRouteSelects();
          renderModelBox();
          toast('获取到 ' + state.models.length + ' 个模型（' + (state.modelsSource === 'remote' ? '远端接口' : '离线目录') + '）', 'ok');
        } catch (err) {}
        b1.disabled = false;
        return;
      }

      if (e.target.closest('#btnProbe')) {
        if (!state.models.length) return toast('请先获取模型列表', 'warn');
        byId('probeBox').innerHTML = card('模型试跑', '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>模型</th><th>结果</th><th>echo</th><th class="num">延迟</th><th class="num">Token</th></tr></thead><tbody id="probeBody"><tr><td colspan="5" class="muted">逐个探测中…</td></tr></tbody></table></div>');
        var body = byId('probeBody');
        body.innerHTML = '';
        for (var i = 0; i < state.models.length; i++) {
          var mid = state.models[i].id || state.models[i];
          var pr;
          try {
            pr = await api('/api/models/probe', { method: 'POST', body: { model: mid }, silent: true, timeout: 45000 });
          } catch (err) {
            pr = { ok: false, error: err.message, hint: err.hint };
          }
          var use = pr.usage || {};
          body.insertAdjacentHTML(
            'beforeend',
            '<tr><td class="mono">' + esc(mid) + '</td>' +
              '<td>' + (pr.ok ? '<span class="badge badge-ok">可用</span>' : '<span class="badge badge-err">失败</span>') + '</td>' +
              '<td class="small">' + esc(pr.ok ? trunc(pr.echo, 60) : pr.error || '—') + '<div class="sub">' + esc(pr.hint || '') + '</div></td>' +
              '<td class="num nowrap">' + esc(fmtMs(pr.ms)) + '</td>' +
              '<td class="num">' + esc(pr.ok ? numOr(use.total_tokens, numOr(use.completion_tokens, 0)) : '—') + '</td></tr>'
          );
        }
        toast('模型试跑完成', 'ok');
        return;
      }

      if (e.target.closest('#btnRouteAll')) {
        try {
          var ra = await api('/api/route', { method: 'POST', body: { skills: skillIds }, timeout: 40000 });
          Object.keys(ra.routing || {}).forEach(function (sid) {
            var info = ra.routing[sid];
            var sel = view.querySelector('[data-route="' + sid + '"]');
            if (sel && info) sel.value = info.model;
            showRouteReason(sid, info);
          });
          toast('已按能力偏好为 ' + Object.keys(ra.routing || {}).length + ' 个 Skill 自动选择模型', 'ok');
        } catch (err) {}
        return;
      }

      if (e.target.closest('#btnResetForm')) return pageSettings(view);

      if (e.target.closest('#btnSave')) {
        var modeEl = view.querySelector('input[name="st_mode"]:checked');
        var patch = {
          mode: modeEl ? modeEl.value : s.mode,
          llm: {
            baseUrl: byId('st_baseUrl').value.trim(),
            model: byId('st_model').value.trim(),
            temperature: numOr(byId('st_temperature').value, s.llm.temperature),
            maxTokens: numOr(byId('st_maxTokens').value, s.llm.maxTokens),
            timeoutMs: numOr(byId('st_timeoutMs').value, s.llm.timeoutMs),
            retries: numOr(byId('st_retries').value, s.llm.retries),
            concurrency: numOr(byId('st_concurrency').value, s.llm.concurrency),
            routing: {},
          },
          batch: {
            problemsPerCall: numOr(byId('st_ppc').value, s.batch.problemsPerCall),
            maxStemChars: numOr(byId('st_maxStem').value, s.batch.maxStemChars),
            maxSolutionChars: numOr(byId('st_maxSol').value, s.batch.maxSolutionChars),
          },
          convergence: {
            firstLevelTargetMin: numOr(byId('st_min').value, (s.convergence || {}).firstLevelTargetMin),
            firstLevelTargetMax: numOr(byId('st_max').value, (s.convergence || {}).firstLevelTargetMax),
            crossMergeEveryChapters: numOr(byId('st_cross').value, (s.convergence || {}).crossMergeEveryChapters),
          },
        };
        var key = byId('st_apiKey').value.trim();
        if (key) patch.llm.apiKey = key;
        view.querySelectorAll('[data-route]').forEach(function (sel) {
          patch.llm.routing[sel.getAttribute('data-route')] = sel.value;
        });
        var sb = byId('btnSave');
        sb.disabled = true;
        try {
          var r2 = await api('/api/settings', { method: 'PUT', body: patch, timeout: 30000 });
          state.settings = r2.settings || state.settings;
          state.overview = state.overview ? Object.assign({}, state.overview, { mode: r2.mode || state.settings.mode }) : state.overview;
          renderStatus();
          toast('设置已保存（当前模式：' + (MODE_CN[r2.mode] || r2.mode) + '）', 'ok');
          navigate();
        } catch (err) {}
        sb.disabled = false;
      }
    };
  }

  /* ====================== 17. 页面：测试模式（智能体作答） ====================== */

  function firstJsonSeg(seg) {
    var i = String(seg).indexOf('{');
    if (i < 0) return null;
    var depth = 0;
    var inStr = false;
    var back = false;
    for (var j = i; j < seg.length; j++) {
      var ch = seg.charAt(j);
      if (back) {
        back = false;
        continue;
      }
      if (ch === '\\') {
        back = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return seg.slice(i, j + 1);
      }
    }
    return null;
  }

  function skeletonOf(v, depth) {
    depth = depth || 0;
    if (depth > 6) return null;
    if (Array.isArray(v)) return v.length ? [skeletonOf(v[0], depth + 1)] : [];
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) {
        o[k] = skeletonOf(v[k], depth + 1);
      });
      return o;
    }
    if (typeof v === 'string') return /^\.{2,}$/.test(v.trim()) ? '' : v;
    if (typeof v === 'number') return 0;
    if (typeof v === 'boolean') return false;
    return null;
  }

  function taskPromptText(task) {
    return (task && task.messages ? task.messages : [])
      .map(function (m) {
        return '===== ' + (m.role || 'user') + ' =====\n' + (m.content || '');
      })
      .join('\n\n');
  }

  function taskSchemaText(task) {
    var all = (task && task.messages ? task.messages : []).map(function (m) {
      return String(m.content || '');
    });
    for (var i = 0; i < all.length; i++) {
      var m = /【输出 JSON schema】([\s\S]*)/.exec(all[i]);
      var seg = m ? m[1] : all[i];
      var json = firstJsonSeg(seg);
      if (json) return json;
    }
    return null;
  }

  function renderAgentTask(task) {
    if (!task) return emptyBox('未选择任务');
    var msgs = task.messages || [];
    var sys = msgs.filter(function (m) {
      return m.role === 'system';
    });
    var rest = msgs.filter(function (m) {
      return m.role !== 'system';
    });
    var html =
      '<div class="kv">' +
      '<div class="kv-item"><div class="kv-k">Skill</div><div class="kv-v">' + esc(skillName(task.skill)) + '<div class="small mono muted">' + esc(task.skill || '') + '</div></div></div>' +
      '<div class="kv-item"><div class="kv-k">章节</div><div class="kv-v">' + esc(task.chapter == null ? '全局 / 未挂章' : '第' + task.chapter + '章') + '</div></div>' +
      '<div class="kv-item"><div class="kv-k">请求时间</div><div class="kv-v small">' + esc(fmtTime(task.requestedAt)) + '</div></div>' +
      '<div class="kv-item"><div class="kv-k">状态</div><div class="kv-v"><span class="badge badge-warn">' + esc(task.status || 'pending') + '</span></div></div>' +
      '<div class="kv-item" style="grid-column:1/-1"><div class="kv-k">缓存 key（内容寻址）</div><div class="kv-v small mono">' + esc(task.key || '') + '</div></div>' +
      '</div>';
    if (task.instructions) html += '<div class="banner banner-info" style="margin-top:14px">' + esc(task.instructions) + '</div>';

    html +=
      '<div class="btn-bar" style="margin:16px 0 8px">' +
      '<button class="btn btn-sm btn-primary" data-act="copy-all">复制完整 prompt</button>' +
      '<span class="muted small">system 段为角色与任务约定，user 段为数据与 schema</span></div>';

    sys.forEach(function (m, i) {
      html += fold('system 提示词（' + String(m.content || '').length + ' 字）', '<div class="pre-wrap small mono">' + esc(m.content) + '</div>', false) + '';
    });
    rest.forEach(function (m, i) {
      html +=
        '<div class="field-label" style="margin-top:14px">' + esc(m.role || 'user') + ' 全文' +
        '<button class="btn btn-sm btn-ghost" data-copy-idx="' + i + '">复制本段</button></div>' +
        '<div class="scroll-box tall pre-wrap mono small">' + esc(m.content) + '</div>';
    });

    var schema = taskSchemaText(task);
    html +=
      '<div class="field-label" style="margin-top:18px">智能体作答（JSON 或纯文本）</div>' +
      (schema ? '<div class="field-hint mono" style="margin-bottom:6px">schema：' + esc(trunc(schema, 400)) + '</div>' : '') +
      '<textarea id="ansText" rows="14" spellcheck="false" placeholder="按 schema 输出 JSON；也可以直接写纯文本结论"></textarea>' +
      '<div class="btn-bar" style="margin-top:10px">' +
      '<button class="btn" data-act="fill-schema">按 schema 填充模板</button>' +
      '<button class="btn" data-act="beautify">格式化 JSON</button>' +
      '<input type="text" id="ansAuthor" placeholder="author（默认 qoder-agent）" style="width:200px">' +
      '<input type="text" id="ansNote" placeholder="备注（可空）" style="width:240px">' +
      '<button class="btn btn-primary" data-act="submit-answer">提交作答</button></div>';
    return html;
  }

  /* 缓存条目详情：契约是路径参数 /api/agent/cache/:key，部分后端改为 /api/agent/cache/entry?key= */
  async function agentCacheDetail(key) {
    try {
      return await api('/api/agent/cache/' + encodeURIComponent(key), { silent: true, timeout: 30000 });
    } catch (e) {
      return await api('/api/agent/cache/entry' + qs({ key: key }), { timeout: 30000 });
    }
  }

  async function pageAgent(view) {
    if (!state.overview) await refreshOverview(true);
    var mode = (state.overview && state.overview.mode) || (state.settings && state.settings.mode) || 'agent';

    view.innerHTML =
      (mode !== 'agent'
        ? '<div class="banner banner-warn">当前为<b>生产模式</b>：由真实大模型直接推理，不需要智能体作答。如需切回测试模式，请到「设置 → 运行模式」选择测试模式并保存。</div>'
        : '<div class="banner banner-info">测试模式：流水线把每次模型调用落成待作答任务（内容寻址 key），由智能体按 schema 作答后回填缓存，再次运行即命中回放。</div>') +
      '<div class="grid grid-2">' +
      card(
        '待作答任务<span class="spacer"></span><button class="btn btn-sm" data-act="reload-tasks">刷新</button>',
        '<div id="agentTasks">' + loadingBox('加载待作答任务…') + '</div>'
      ) +
      card(
        '已作答缓存<span class="spacer"></span><button class="btn btn-sm" data-act="reload-cache">刷新</button>',
        '<div id="agentCache">' + loadingBox('加载缓存…') + '</div>'
      ) +
      '</div>' +
      card('任务详情与作答', '<div id="agentDetail">' + emptyBox('点击左侧任务行加载详情') + '</div>');

    view.onclick = function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var a = t.getAttribute('data-act');
      if (a === 'reload-tasks') loadTasks();
      if (a === 'reload-cache') loadCache();
    };

    async function loadTasks() {
      var box = byId('agentTasks');
      if (!box) return;
      var d;
      try {
        d = await api('/api/agent/tasks');
      } catch (e) {
        box.innerHTML = emptyBox('任务列表加载失败');
        return;
      }
      state.agentStats = d.stats || state.agentStats;
      renderStatus();
      if (!d.supported) {
        box.innerHTML = emptyBox('当前模式不支持智能体作答', '生产模式下由真实模型直接返回结果');
        return;
      }
      var items = d.items || [];
      if (!items.length) {
        box.innerHTML = emptyBox('没有待作答任务', '运行归纳时若命中未缓存的推理，任务会自动出现在这里');
        return;
      }
      box.innerHTML =
        '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Skill</th><th>章节</th><th class="num">大小</th><th>请求时间</th><th>任务摘要</th></tr></thead><tbody>' +
        items
          .map(function (x) {
            return (
              '<tr class="clickable" data-task="' + esc(x.key) + '">' +
              '<td class="nowrap"><b>' + esc(skillName(x.skill)) + '</b><div class="sub mono small">' + esc(x.skill || '') + '</div></td>' +
              '<td class="nowrap">' + esc(x.chapter == null ? '—' : '第' + x.chapter + '章') + '</td>' +
              '<td class="num nowrap">' + esc(fmtBytes(x.bytes)) + '</td>' +
              '<td class="small nowrap">' + esc(fmtTime(x.requestedAt)) + '</td>' +
              '<td class="small muted">' + esc(trunc(x.brief, 120)) + '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div><div class="field-hint">共 ' + items.length + ' 项待作答；已作答 ' + numOr((d.stats || {}).answered, 0) + ' 项。</div>';

      box.onclick = async function (e) {
        var tr = e.target.closest('[data-task]');
        if (!tr) return;
        var key = tr.getAttribute('data-task');
        var det = byId('agentDetail');
        det.innerHTML = loadingBox('加载任务详情…');
        try {
          state.agentTask = await api('/api/agent/tasks/' + encodeURIComponent(key), { timeout: 30000 });
        } catch (err) {
          state.agentTask = null;
          det.innerHTML = emptyBox('任务加载失败或已被作答');
          return;
        }
        det.innerHTML = renderAgentTask(state.agentTask);
        det.scrollIntoView({ behavior: 'smooth', block: 'start' });

        det.onclick = async function (ev) {
          var cp = ev.target.closest('[data-copy-idx]');
          if (cp) {
            var idx = Number(cp.getAttribute('data-copy-idx'));
            var msg = (state.agentTask.messages || []).filter(function (m) {
              return m.role !== 'system';
            })[idx];
            copyText(msg ? msg.content : '');
            return;
          }
          var act = ev.target.closest('[data-act]');
          if (!act) return;
          var a = act.getAttribute('data-act');
          if (a === 'copy-all') return copyText(taskPromptText(state.agentTask));
          if (a === 'fill-schema') {
            var seg = taskSchemaText(state.agentTask);
            var obj = null;
            if (seg) {
              try {
                obj = JSON.parse(seg);
              } catch (err) {
                obj = null;
              }
            }
            if (!obj) {
              obj = { items: [{ note: '按 schema 手工补全' }] };
              toast('未能自动解析 schema，已给出通用骨架', 'warn');
            }
            byId('ansText').value = JSON.stringify(skeletonOf(obj), null, 2);
            return;
          }
          if (a === 'beautify') {
            try {
              byId('ansText').value = JSON.stringify(JSON.parse(byId('ansText').value || 'null'), null, 2);
              toast('已格式化为 JSON', 'ok');
            } catch (err) {
              toast('当前内容不是合法 JSON，提交时将按纯文本处理', 'warn');
            }
            return;
          }
          if (a === 'submit-answer') {
            var raw = byId('ansText').value;
            if (!raw.trim()) return toast('请先填写作答内容', 'warn');
            var out;
            try {
              out = JSON.parse(raw);
            } catch (err) {
              out = raw;
            }
            act.disabled = true;
            try {
              await api('/api/agent/tasks/' + encodeURIComponent(state.agentTask.key), {
                method: 'POST',
                body: { output: out, author: byId('ansAuthor').value.trim() || 'qoder-agent', note: byId('ansNote').value.trim() },
                timeout: 30000,
              });
              toast('作答已回填缓存：' + skillName(state.agentTask.skill), 'ok');
              state.agentTask = null;
              byId('agentDetail').innerHTML = emptyBox('已提交，可继续处理下一个任务');
              await Promise.all([loadTasks(), loadCache()]);
              await refreshOverview(true);
            } catch (err) {}
            act.disabled = false;
          }
        };
      };
    }

    async function loadCache() {
      var box = byId('agentCache');
      if (!box) return;
      var d;
      try {
        d = await api('/api/agent/cache');
      } catch (e) {
        box.innerHTML = emptyBox('缓存加载失败');
        return;
      }
      state.agentStats = d.stats || state.agentStats;
      if (d.supported === false) {
        box.innerHTML = emptyBox('当前模式无缓存作答记录');
        return;
      }
      var items = (d.items || []).slice().reverse();
      if (!items.length) {
        box.innerHTML = emptyBox('还没有已作答缓存');
        return;
      }
      box.innerHTML =
        '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Skill</th><th>章节</th><th>作者</th><th class="num">大小</th><th>作答时间</th><th style="text-align:right">操作</th></tr></thead><tbody>' +
        items
          .map(function (x) {
            return (
              '<tr><td class="nowrap">' + esc(skillName(x.skill)) + '<div class="sub mono small">' + esc(x.skill || '') + '</div></td>' +
              '<td class="nowrap">' + esc(x.chapter == null ? '—' : '第' + x.chapter + '章') + '</td>' +
              '<td class="small">' + esc(x.author || '—') + '</td>' +
              '<td class="num nowrap">' + esc(fmtBytes(x.bytes)) + '</td>' +
              '<td class="small nowrap">' + esc(fmtTime(x.answeredAt)) + '</td>' +
              '<td class="btn-bar nowrap" style="justify-content:flex-end">' +
              '<button class="btn btn-sm" data-view="' + esc(x.key) + '">查看</button>' +
              '<button class="btn btn-sm btn-danger" data-del="' + esc(x.key) + '">删除</button></td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';

      box.onclick = async function (e) {
        var v = e.target.closest('[data-view]');
        if (v) {
          var key = v.getAttribute('data-view');
          try {
            var full = await agentCacheDetail(key);
            openDrawer(
              '作答内容 · ' + skillName(full.skill),
              '<div class="kv"><div class="kv-item"><div class="kv-k">key</div><div class="kv-v small mono">' + esc(full.key) + '</div></div>' +
                '<div class="kv-item"><div class="kv-k">作者</div><div class="kv-v">' + esc(full.author || '—') + '</div></div>' +
                '<div class="kv-item"><div class="kv-k">作答时间</div><div class="kv-v small">' + esc(fmtTime(full.answeredAt)) + '</div></div>' +
                '<div class="kv-item"><div class="kv-k">章节</div><div class="kv-v">' + esc(full.chapter == null ? '—' : '第' + full.chapter + '章') + '</div></div></div>' +
                '<div class="field-label" style="margin-top:14px">output（回放给流水线的内容）</div>' +
                '<div class="scroll-box tall pre-wrap mono small">' + esc(full.output) + '</div>' +
                ((full.messages || []).length
                  ? '<div style="margin-top:14px">' + fold('原始 messages（' + full.messages.length + ' 段）', '<div class="mono small pre-wrap">' + esc(taskPromptText(full)).slice(0, 20000) + '</div>', false) + '</div>'
                  : ''),
              '<button class="btn" data-act="drawer-close">关闭</button>'
            );
          } catch (err) {}
          return;
        }
        var del = e.target.closest('[data-del]');
        if (del) {
          var dk = del.getAttribute('data-del');
          var ok = await confirmModal({ title: '删除作答缓存', text: '删除后该推理会重新变为待作答任务，确定删除？', danger: true, okText: '删除' });
          if (!ok) return;
          try {
            await api('/api/agent/cache/' + encodeURIComponent(dk), { method: 'DELETE' });
            toast('已删除缓存', 'ok');
            await Promise.all([loadCache(), loadTasks(), refreshOverview(true)]);
          } catch (err) {}
        }
      };
    }

    await loadTasks();
    await loadCache();
  }

  /* ====================== 18. 页面：Skill ====================== */

  async function pageSkills(view) {
    view.innerHTML = loadingBox('正在加载 Skill 清单…');
    var d;
    try {
      d = await api('/api/skills');
    } catch (e) {
      view.innerHTML = emptyBox('Skill 清单加载失败');
      return;
    }
    state.skills = d;
    var skills = d.skills || [];
    var tiers = d.tiers || [];

    function groupCards(layer) {
      return skills
        .filter(function (s) {
          return s.layer === layer;
        })
        .map(function (s) {
          return (
            '<div class="card">' +
            '<div class="card-title"><span>' + esc(s.title || s.id) + '</span>' +
            (s.generated ? '<span class="badge badge-primary">生成型</span>' : '') +
            (s.error ? '<span class="badge badge-err">加载失败</span>' : '') +
            '<span class="spacer"></span><span class="badge badge-mute mono">' + esc(s.id) + '</span></div>' +
            '<div class="small muted" style="margin-bottom:8px">' + esc(s.desc || '（无职责描述）') + '</div>' +
            '<div class="kv">' +
            '<div class="kv-item"><div class="kv-k">代码路径</div><div class="kv-v small mono">' + esc(s.file || '—') + '</div></div>' +
            '<div class="kv-item"><div class="kv-k">挂载点</div><div class="kv-v small">' + esc(s.hook || '—') + '</div></div>' +
            '<div class="kv-item"><div class="kv-k">层级</div><div class="kv-v small">' + esc(LAYER_CN[s.layer] || s.layer) + '</div></div>' +
            '</div>' +
            (s.error ? '<div class="banner banner-err small" style="margin-top:10px">' + esc(s.error) + '</div>' : '') +
            '</div>'
          );
        })
        .join('');
    }

    var tierHtml = tiers.length
      ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>重合度阈值</th><th>动作</th><th>系统行为</th></tr></thead><tbody>' +
        tiers
          .map(function (t) {
            var cls = t.action === 'refine' ? 'tag-refine' : t.action === 'branch' ? 'tag-branch' : 'tag-new';
            return (
              '<tr><td class="mono nowrap">≥ ' + esc((Number(t.min) * 100).toFixed(0)) + '%</td>' +
              '<td><span class="tag ' + cls + '">' + esc(t.action) + '</span></td>' +
              '<td>' + esc(t.label) + '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      : '<div class="muted small">未返回三档阈值</div>';

    view.innerHTML =
      card('三层 Skill 架构<span class="spacer"></span><span class="card-note">元能力层驱动能力扩展，业务执行层完成归纳，质量校验层兜底</span>',
        '<div class="btn-bar"><button class="btn btn-sm" data-act="reload-skills">刷新</button><a class="btn btn-sm" href="#/agent">测试模式作答</a></div>') +
      '<h2 class="card-title" style="margin:22px 0 12px">元能力层</h2>' +
      '<div class="grid grid-auto">' + (groupCards('meta') || emptyBox('无')) + '</div>' +
      '<h2 class="card-title" style="margin:22px 0 12px">业务执行层</h2>' +
      '<div class="grid grid-auto">' + (groupCards('business') || emptyBox('无')) + '</div>' +
      '<h2 class="card-title" style="margin:22px 0 12px">质量校验层</h2>' +
      '<div class="grid grid-auto">' + (groupCards('qa') || emptyBox('无')) + '</div>' +
      '<div class="grid grid-2">' +
      card('三档判定阈值<span class="spacer"></span><span class="card-note">本质语义重合度 → 强制动作</span>', tierHtml) +
      card(
        '生成新 Skill<span class="spacer"></span><span class="card-note">由「Skill生成元Skill」落盘 SKILL.md + 实现骨架</span>',
        '<div class="field-row">' +
          '<div class="field"><label>Skill id</label><input type="text" id="fg_id" placeholder="essence-polish"></div>' +
          '<div class="field"><label>中文标题</label><input type="text" id="fg_title" placeholder="本质润色Skill"></div>' +
          '<div class="field"><label>层级</label><select id="fg_layer"><option value="business">业务执行层</option><option value="qa">质量校验层</option><option value="meta">元能力层</option></select></div>' +
        '</div>' +
        '<div class="field"><label>用途 purpose</label><textarea id="fg_purpose" rows="2" placeholder="对章节模板库做专项优化：……"></textarea></div>' +
        '<div class="field"><label>输入 input</label><input type="text" id="fg_input" placeholder="当前章节模板库 + 章节信息"></div>' +
        '<div class="field"><label>输出 schema（JSON）</label><textarea id="fg_schema" rows="3" spellcheck="false">{"items":[]}</textarea></div>' +
        '<div class="field"><label>校验标准 check</label><textarea id="fg_check" rows="2">输出必须为合法 JSON，且不引入未在输入中出现的新结论</textarea></div>' +
        '<div class="btn-bar"><button class="btn btn-primary" id="btnForge">生成 Skill</button><span class="muted small">id 只允许小写字母 / 数字 / 中划线</span></div>' +
        '<div class="hr-soft"></div><div class="muted small">生成后会自动注册进流水线，在章节结束后按 hook 执行；可在「运行」页事件流中看到 ext-skill 事件。</div>'
      ) +
      '</div>';

    view.onclick = async function (e) {
      var t = e.target.closest('[data-act]');
      if (t && t.getAttribute('data-act') === 'reload-skills') return pageSkills(view);
      if (!e.target.closest('#btnForge')) return;
      var body = {
        id: byId('fg_id').value.trim(),
        title: byId('fg_title').value.trim(),
        layer: byId('fg_layer').value,
        purpose: byId('fg_purpose').value.trim(),
        input: byId('fg_input').value.trim(),
        schema: byId('fg_schema').value.trim(),
        check: byId('fg_check').value.trim(),
      };
      if (!body.id && !body.title) return toast('至少填写 Skill id 或中文标题', 'warn');
      var b = e.target.closest('#btnForge');
      b.disabled = true;
      try {
        var r = await api('/api/skills/forge', { method: 'POST', body: body, timeout: 30000 });
        toast('Skill 已生成：' + (r.skill && r.skill.title ? r.skill.title : body.id), 'ok');
        await pageSkills(view);
      } catch (err) {}
      b.disabled = false;
    };
  }

  /* ====================== 19. 路由 ====================== */

  var PAGES = {
    overview: { title: '总览', sub: '全局指标 · 章节进度 · 最近运行', fn: pageOverview },
    sources: { title: '数据源', sub: 'OCR 输入文件与角色归类', fn: pageSources },
    problems: { title: '题库', sub: '筛选 · 拆解结果 · 通法归属', fn: pageProblems },
    library: { title: '模板库', sub: '学科 → 章节 → 一级通法 → 二级分支', fn: pageLibrary },
    runs: { title: '运行', sub: '启动归纳 · 实时事件流 · 历史运行', fn: pageRuns },
    qa: { title: '校验', sub: '数学等价 · 考点覆盖 · 边界一致性', fn: pageQa },
    output: { title: '输出', sub: '手册 · 模板库 · 拆解记录 · 校验报告 · 运行日志', fn: pageOutput },
    settings: { title: '设置', sub: '模式 · 模型接入 · 自主路由 · 收敛目标', fn: pageSettings },
    agent: { title: '测试模式', sub: '智能体扮演大模型：待作答与回填', fn: pageAgent },
    skills: { title: 'Skill', sub: '三层能力清单与能力自主扩展', fn: pageSkills },
  };

  function parseHash() {
    var h = String(global.location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/');
    var name = parts[0] || 'overview';
    if (!PAGES[name]) name = 'overview';
    return { name: name, param: parts.slice(1).join('/') };
  }

  function setNav(name) {
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getAttribute('data-route');
      items[i].className = 'nav-item' + (r === name ? ' active' : '');
    }
    document.body.classList.remove('nav-open');
    var mask = byId('navMask');
    if (mask) mask.hidden = true;
  }

  async function navigate() {
    var r = parseHash();
    if (state.teardown) {
      try {
        state.teardown();
      } catch (e) {}
      state.teardown = null;
    }
    state.route = r.name;
    var p = PAGES[r.name];
    setNav(r.name);
    byId('pageTitle').textContent = p.title;
    byId('pageSub').textContent = p.sub;
    var view = byId('view');
    view.innerHTML = loadingBox('正在加载「' + p.title + '」…');
    view.onclick = null;
    view.onchange = null;
    try {
      await p.fn(view, r.param);
    } catch (e) {
      view.innerHTML = emptyBox('页面加载失败：' + (e && e.message ? e.message : String(e)), (e && e.hint) || '');
    }
  }

  /* ====================== 20. 启动 ====================== */

  function boot() {
    var toggle = byId('navToggle');
    if (toggle)
      toggle.onclick = function () {
        var open = document.body.classList.toggle('nav-open');
        byId('navMask').hidden = !open;
      };
    var mask = byId('navMask');
    if (mask)
      mask.onclick = function () {
        document.body.classList.remove('nav-open');
        mask.hidden = true;
      };
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        if (mask) mask.hidden = true;
      });
    });

    document.addEventListener('click', function (e) {
      var head = e.target.closest ? e.target.closest('.fold-head') : null;
      if (!head) return;
      var body = head.parentNode.querySelector('.fold-body');
      if (!body) return;
      body.hidden = !body.hidden;
      var mark = head.querySelector('.fold-mark');
      if (mark && !mark.getAttribute('data-static')) mark.textContent = body.hidden ? '展开' : '收起';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeModal();
      closeDrawer();
    });

    global.addEventListener('hashchange', navigate);
    if (!global.location.hash) global.location.hash = '#/overview';
    connectEvents();
    navigate();
    refreshOverview(true);
    setInterval(function () {
      if (document.visibilityState === 'visible') refreshRunning();
    }, 15000);
  }

  /* ====================== 21. 导出 ====================== */

  App.md = md;
  App.api = api;
  App.esc = esc;
  App.toast = toast;
  App.state = state;
  App.pages = PAGES;
  App.navigate = navigate;
  App.boot = boot;
  App.fmtBytes = fmtBytes;
  App.pct = pct;
  App.qs = qs;
  global.App = App;

  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('view')) boot();
})(typeof window !== 'undefined' ? window : globalThis);
