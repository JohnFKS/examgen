'use strict';
/** 输出层：全部产物均为 Markdown 文件，可直接下载 / 打印 */
const path = require('path');
const U = require('../lib/util');
const cfg = require('../config');
const lib = require('./library');

const OUT = cfg.P.output;

function p(...s) {
  return path.join(OUT, ...s);
}

function header(title, sub) {
  return [`# ${title}`, '', `> ${sub || '考研数学万能通法自动归纳系统产出'} ｜ 生成时间：${U.nowStamp()}`, '', '---', ''].join('\n');
}

/* ---------- 单题拆解 ---------- */
function decompositionMd(chapter, items) {
  const L = [header(`第${chapter.no}章 ${chapter.title} · 单题标准化拆解记录`, '固定 5 字段：表面题型 / 核心本质 / 标准解题步骤 / 边界条件 / 对应考点（无易错点）')];
  L.push(`本题集共 **${items.length}** 题，拆解成功 **${items.filter((i) => i.essence).length}** 题。`, '');
  for (const it of items) {
    L.push(`## ${it.problem_id} ｜ ${it.tier || ''}·${it.section || ''}`, '');
    L.push(`**题干摘要**：${(it.stem_excerpt || '').slice(0, 160)}`, '');
    L.push('| 字段 | 内容 |');
    L.push('| --- | --- |');
    L.push(`| 表面题型 | ${one(it.surface_type)} |`);
    L.push(`| 核心本质 | ${one(it.essence)} |`);
    L.push(`| 标准解题步骤 | ${one((it.steps || []).join('；'))} |`);
    L.push(`| 边界条件 | 可用：${one((it.boundaries && it.boundaries.applicable || []).join('；'))} ／ 失效：${one((it.boundaries && it.boundaries.invalid || []).join('；'))} |`);
    L.push(`| 对应考点 | ${one((it.exam_points || []).join('；'))} |`);
    L.push('');
    L.push(`> 归属：${it.matched_template_id || '（新建候选）'} ｜ 相似度：${it.similarity != null ? Math.round(it.similarity * 100) + '%' : '-'} ｜ 动作：${it.action || '-'}`, '');
    L.push('---', '');
  }
  return U.writeFileAtomic(p('拆解记录', `第${pad(chapter.no)}章-${chapter.title}-单题拆解.md`), L.join('\n'));
}

function pad(n) {
  return String(n).padStart(2, '0');
}
function one(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

/* ---------- 章节模板库 ---------- */
function chapterLibraryMd(chapter, templates, version, meta) {
  const L = [header(`第${chapter.no}章 ${chapter.title} · 通法模板库 ${version}`, '增量迭代产物：按「学科→章节→通法」三级分类组织')];
  L.push('## 本章概览', '');
  L.push('| 指标 | 数值 |');
  L.push('| --- | --- |');
  L.push(`| 本章题目数 | ${meta.problemTotal} |`);
  L.push(`| 已拆解 | ${meta.decomposed} |`);
  L.push(`| 因缺少解析跳过 | ${meta.skippedNoSolution} |`);
  L.push(`| 一级通法 | ${templates.length} |`);
  L.push(`| 二级分支合计 | ${templates.reduce((a, t) => a + (t.branches || []).length, 0)} |`);
  L.push(`| 考点覆盖 | ${(meta.coverageRate * 100).toFixed(0)}%（${meta.covered}/${meta.total}） |`);
  const ac = meta.actions || {};
  L.push(`| 迭代动作 | 匹配优化 ${ac.merge || 0} ／ 新增分支 ${ac.branch || 0} ／ 新建模板 ${ac.new || 0} |`);
  L.push('');
  L.push('## 本章通法清单', '');
  L.push('| 编号 | 通法名称 | 版本 | 来源 | 覆盖题数 | 核心本质 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const t of templates) L.push(`| ${t.id} | ${one(t.name)} | ${t.version} | ${t.kind === 'seed' ? '种子' : '归纳'} | ${(t.covered_problem_ids || []).length} | ${one(t.essence).slice(0, 60)} |`);
  L.push('');
  L.push('---', '');
  for (const t of templates) {
    L.push(lib.templateMd(t));
    L.push('---', '');
  }
  return U.writeFileAtomic(p('模板库', `第${pad(chapter.no)}章-${chapter.title}-模板库-${version}.md`), L.join('\n'));
}

/* ---------- 手册终稿 ---------- */
function handbookMd(opts) {
  const o = opts || {};
  const ts = lib.active().filter((t) => o.includeAll || t.status === 'active');
  const byId = {};
  ts.forEach((t) => (byId[t.id] = t));
  const disciplines = ['高等数学', '线性代数', '概率论与数理统计'];
  const L = [
    header('考研数学万能通法手册', '增量式本质归纳 · 通法数量最少、覆盖范围最全'),
    '## 使用说明',
    '',
    '1. 本手册按「学科 → 章节 → 通法」三级组织；**一级通法**为核心本质（尽量少），**二级分支**适配不同表面题型。',
    '2. 应试路径：先按题干识别**表面题型**，再落到对应一级通法，按**标准解题步骤**执行，遇特殊形态走**二级分支**；动笔前用**失效边界**自检。',
    '3. 所有通法均由「逐题拆解 → 本质匹配 → 增量迭代」自动积累，并经过数学等价校验、考点覆盖校验、边界一致性校验三道质检。',
    '',
    '---',
    '',
    '## 第一部分 一级核心通法总览',
    '',
    `> 一级通法共 **${ts.length}** 个，目标区间 ${cfg.load().convergence.firstLevelTargetMin}-${cfg.load().convergence.firstLevelTargetMax} 个。`,
    '',
    '| # | 编号 | 一级核心通法 | 核心本质（一句话） | 覆盖章节 | 覆盖题数 | 分支数 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  ts
    .slice()
    .sort((a, b) => a.discipline.localeCompare(b.discipline) || (a.chapters[0] || 0) - (b.chapters[0] || 0))
    .forEach((t, i) => {
      L.push(`| ${i + 1} | ${t.id} | ${one(t.name)} | ${one(t.essence)} | ${(t.chapterTitles || []).join('、') || '-'} | ${(t.covered_problem_ids || []).length} | ${(t.branches || []).length} |`);
    });
  L.push('', '---', '', '## 第二部分 分学科分章节通法详解', '');
  const allChapters = cfg.load().chapterMap;
  const titleOf = (n) => (allChapters.find((c) => c.no === n) || {}).title || '';
  for (const d of disciplines) {
    const inD = ts.filter((t) => t.discipline === d);
    if (!inD.length) continue;
    L.push(`### ${d}`, '');
    const chapters = allChapters.filter((c) => c.discipline === d);
    for (const c of chapters) {
      const inC = inD.filter((t) => (t.chapters || []).includes(c.no));
      if (!inC.length) continue;
      L.push(`#### 第${c.no}章 ${c.title}`, '');
      // 跨章合并后一条一级通法可同时服务多章：详解只在归属章（chapters 首项）出现一次，其余章给出索引避免重复
      const reused = inC.filter((t) => (t.chapters || [])[0] !== c.no);
      if (reused.length) {
        L.push('**本章复用的跨章一级通法**（完整详解见其归属章）', '');
        L.push('| 编号 | 一级通法 | 详解归属 | 核心本质 |');
        L.push('| --- | --- | --- | --- |');
        for (const t of reused) L.push(`| ${t.id} | ${one(t.name)} | 第${(t.chapters || [])[0]}章 ${titleOf((t.chapters || [])[0])} | ${one(t.essence).slice(0, 60)} |`);
        L.push('');
      }
      for (const t of inC.filter((x) => (x.chapters || [])[0] === c.no)) {
        L.push(lib.templateMd(t).replace(/^## /m, '##### '));
        L.push('');
      }
    }
    const unclassified = inD.filter((t) => !(t.chapters || []).some((n) => chapters.some((c) => c.no === n)));
    if (unclassified.length) {
      L.push(`#### 跨章节通用`, '');
      for (const t of unclassified) L.push(lib.templateMd(t).replace(/^## /m, '##### '), '');
    }
  }
  L.push('---', '', '## 附录 A 考点-通法对应表', '');
  L.push(appendixTable(ts));
  L.push('');
  if (o.coverage) {
    L.push('---', '', '## 附录 B 覆盖率报告', '');
    L.push(coverageMd(o.coverage));
  }
  L.push('---', '', '## 附录 C 收敛与版本记录', '');
  L.push('');
  L.push(`- 生成时间：${U.nowStamp()}`);
  L.push(`- 一级通法数量：**${ts.length}**`);
  L.push(`- 二级分支总数：**${ts.reduce((a, t) => a + (t.branches || []).length, 0)}**`);
  L.push(`- 覆盖题目总数：**${new Set(ts.flatMap((t) => t.covered_problem_ids || [])).size}**`);
  L.push(`- 运行模式：${cfg.load().mode === 'live' ? '生产（真实大模型 ' + cfg.load().llm.model + '）' : '测试（智能体扮演大模型，内容寻址回放）'}`);
  const file = U.writeFileAtomic(p('考研数学万能通法手册.md'), L.join('\n'));
  return file;
}

function appendixTable(ts) {
  const rows = [];
  for (const t of ts) {
    for (const pt of t.exam_points || []) rows.push({ point: pt, template: t.id, name: t.name, essence: t.essence });
  }
  rows.sort((a, b) => a.point.localeCompare(b.point));
  const out = ['| 考点 | 通法编号 | 通法名称 | 核心本质 |', '| --- | --- | --- | --- |'];
  for (const r of rows) out.push(`| ${one(r.point)} | ${r.template} | ${one(r.name)} | ${one(r.essence).slice(0, 70)} |`);
  if (!rows.length) out.push('| — | — | — | — |');
  return out.join('\n');
}

function coverageMd(cov) {
  const L = ['| 章节 | 考点总数 | 已覆盖 | 覆盖率 | 未覆盖考点 |', '| --- | --- | --- | --- | --- |'];
  for (const c of cov.chapters || []) {
    L.push(`| 第${c.no}章 ${one(c.title)} | ${c.total} | ${c.covered} | ${(c.rate * 100).toFixed(0)}% | ${(c.uncovered || []).slice(0, 6).map(one).join('；') || '—'} |`);
  }
  L.push('', `**全局考点覆盖率：${(cov.rate * 100).toFixed(1)}%（${cov.covered}/${cov.total}）；题型覆盖率：${(cov.typeRate * 100).toFixed(1)}%**`);
  return L.join('\n');
}

/* ---------- 校验报告 ---------- */
function qaMd(name, report) {
  const L = [header(`${name} 校验报告`, '质量保障层产出：数学等价 / 考点覆盖 / 边界一致性')];
  if (report.summary) {
    L.push('## 结论', '', report.summary, '');
  }
  if (report.tables) {
    for (const t of report.tables) {
      L.push(`## ${t.title}`, '');
      L.push(t.headerLine);
      L.push(t.divider);
      t.rows.forEach((r) => L.push(r));
      L.push('');
    }
  }
  if (report.issues && report.issues.length) {
    L.push('## 问题清单', '');
    L.push('| 级别 | 对象 | 类型 | 说明 | 处置 |', '| --- | --- | --- | --- | --- |');
    report.issues.forEach((i) => L.push(`| ${i.severity} | ${i.target} | ${i.type} | ${one(i.detail)} | ${one(i.fix || '待人工确认')} |`));
    L.push('');
  }
  return U.writeFileAtomic(p('校验报告', `${name}.md`), L.join('\n'));
}

function runLogMd(run) {
  const L = [header(`运行日志 ${run.id}`, `${run.mode} ｜ ${run.skill || '全流程'}`)];
  L.push('| 时间 | 事件 | 详情 |', '| --- | --- | --- |');
  for (const e of run.events.slice(-400)) L.push(`| ${e.ts} | ${e.type} | ${one(e.detail)} |`);
  return U.writeFileAtomic(p('运行日志', `${run.id}.md`), L.join('\n'));
}

module.exports = { decompositionMd, chapterLibraryMd, handbookMd, qaMd, runLogMd, appendixTable, coverageMd, OUT, p };
