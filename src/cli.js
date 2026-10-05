#!/usr/bin/env node
'use strict';
const path = require('path');
const U = require('./lib/util');
const cfg = require('./config');
const llm = require('./llm');
const corpus = require('./ingest/corpus');
const lib = require('./store/library');
const render = require('./store/render');
const orch = require('./pipeline/orchestrator');
const wb = require('./pipeline/agentWorkbench');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function parseChapters(spec) {
  if (!spec) return [];
  const out = new Set();
  String(spec)
    .split(',')
    .forEach((part) => {
      const m = /^(\d+)-(\d+)$/.exec(part.trim());
      if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
      else if (/^\d+$/.test(part.trim())) out.add(+part.trim());
    });
  return Array.from(out).sort((a, b) => a - b);
}

async function main() {
  const cmd = process.argv[2] || 'help';
  const s = cfg.load();

  if (cmd === 'index') {
    const c = orch && corpus.loadCached(true);
    console.log(`输入目录：${cfg.P.input}`);
    console.log(`文件分类：`);
    c.files.forEach((f) => console.log(`  - [${f.role}] ${f.file}`));
    console.log(`\n题目 ${c.stats.total} ｜ 解析 ${c.stats.solutionTotal} ｜ 对齐 ${c.stats.matched}（${(c.stats.coverage * 100).toFixed(1)}%）`);
    console.log(`讲义 ${Object.keys(c.lectures).length} 份 ｜ 公式条目 ${c.formulaEntries.length} ｜ 种子通法 ${c.seeds.length} 篇\n`);
    console.log('章节 | 题目 | 有解析 | 考点数 | 讲义');
    c.chapters.forEach((ch) => console.log(`  ${ch.no}  | ${ch.problemCount} | ${ch.matchedCount} | ${ch.examPointCount} | ${(ch.lectureKeys || []).join(' + ')}`));
    return;
  }

  if (cmd === 'run') {
    const chapters = parseChapters(arg('chapters', '1'));
    const stages = String(arg('stages', 'seed,chapter,converge')).split(',');
    if (arg('reset')) {
      resetAll();
      console.log('已清空模板库 / 拆解记录 / 运行状态（agent-cache 保留）');
    }
    console.log(`启动流水线：模式=${s.mode} 章节=${chapters.join(',')} 阶段=${stages.join(',')}`);
    const unsubs = [U.logger.on(() => {})];
    const res = await orch.start({ chapters, stages, source: 'cli' });
    console.log('\n==== 运行完成 ====');
    console.log(JSON.stringify(res.summary, null, 2).slice(0, 4000));
    console.log(`调用次数 ${res.usage.calls} ｜ token(in/out) ${res.usage.tokensIn}/${res.usage.tokensOut} ｜ 待作答 ${res.summary.pendingCount}`);
    unsubs.forEach((f) => f());
    if (res.summary.pendingCount) console.log(`\n下一步：查看待作答任务 \`node src/cli.js tasks\`，回填后重跑本命令。`);
    return;
  }

  if (cmd === 'tasks') {
    const prov = llm.getProvider(s);
    if (!prov.listPending) {
      console.log('生产模式无待作答任务（当前 mode=' + s.mode + '）');
      return;
    }
    const p = prov.listPending();
    console.log(`待智能体作答任务：${p.length}\n`);
    for (const t of p) console.log(`- ${t.key}  [${t.skill}] 第${t.chapter || '-'}章  输入 ${t.bytes}B\n    ${t.brief.slice(0, 140)}…`);
    if (arg('dump')) {
      const r = wb.dump();
      console.log(`\n已生成智能体工作包 ${r.count} 份：${r.work}`);
      console.log('  INDEX.md 为总清单；<key>.input.md 为压缩后的输入，<key>.answer.json 为答案落点。');
      console.log('  全部写完后执行：node src/cli.js tasks --submit-all');
    }
    if (arg('submit-all')) {
      const r = wb.submitAll();
      console.log(`已提交 ${r.submitted} 份答案${r.errors.length ? '，失败 ' + r.errors.length + '：' + JSON.stringify(r.errors) : ''}`);
      console.log(`剩余待作答：${prov.stats().pending}`);
    }
    return;
  }

  if (cmd === 'workbench') {
    const r = wb.dump();
    console.log(JSON.stringify({ count: r.count, work: r.work }, null, 2));
    return;
  }

  if (cmd === 'answer') {
    const key = arg('key');
    const file = arg('file');
    if (!key || !file) throw new Error('用法：node src/cli.js answer --key <key> --file <答案.json>');
    const out = U.readJson(path.resolve(file));
    const r = llm.getProvider(s).answer(key, out, { author: 'qoder-agent' });
    console.log(`已回填 ${r.key}（skill=${r.skill}）`);
    return;
  }

  if (cmd === 'status') {
    const st = orch.readState();
    console.log(JSON.stringify({ mode: s.mode, library: lib.stats(), state: st, agent: s.mode === 'agent' ? llm.getProvider(s).stats() : null }, null, 2));
    return;
  }

  if (cmd === 'export') {
    const res = orch.buildHandbook();
    console.log('已输出：' + res.file);
    console.log(`考点覆盖率 ${(res.coverage.rate * 100).toFixed(1)}%，一级通法 ${lib.active().length} 个`);
    return;
  }

  if (cmd === 'route') {
    const models = await llm.getProvider(s).listModels().catch(() => []);
    const skill = arg('skill', 'problem-decompose');
    console.log(JSON.stringify(llm.routeModel(models, skill, s), null, 2));
    return;
  }

  if (cmd === 'reset-cache') {
    resetAll(!!arg('cache'));
    console.log('已重置运行态' + (arg('cache') ? '（含智能体答案缓存）' : ''));
    return;
  }

  help();
}

function resetAll(cacheToo) {
  const dirs = [cfg.P.library, cfg.P.runs, cfg.P.output, path.join(cfg.P.data, 'qa')];
  for (const d of dirs) try { fs_rm(d); } catch (e) {}
  for (const f of [orch.D.dec, orch.D.match, cfg.P.state]) try { fs_rm(f); } catch (e) {}
  if (cacheToo) try { fs_rm(cfg.P.pending); fs_rm(cfg.P.cache); } catch (e) {}
}
function fs_rm(p) {
  const fs = require('fs');
  fs.rmSync(p, { recursive: true, force: true });
}

function help() {
  console.log(`考研数学万能通法自动归纳系统

  node src/cli.js index                     语料装配与结构统计
  node src/cli.js run --chapters 1 [--reset] 运行流水线（seed,chapter,converge）
  node src/cli.js tasks                     列出测试模式待智能体作答的任务
  node src/cli.js answer --key K --file a.json 回填智能体答案
  node src/cli.js status                    模板库/运行状态
  node src/cli.js export                    渲染通法手册与附录
  node src/cli.js route --skill essence-match 查看模型自主路由结果
  node src/cli.js reset-cache [--cache]     重置运行态
  `);
}

main().catch((e) => {
  console.error('失败：' + e.message);
  if (process.env.EXAMGEN_DEBUG) console.error(e.stack);
  process.exit(1);
});
