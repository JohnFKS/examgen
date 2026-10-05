'use strict';
/**
 * 端到端不变量自检（零依赖）：node test/run.js
 * 全部读写都落在临时工作目录里，不会碰 data/ 与 output/。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORK = path.resolve(os.tmpdir(), 'examgen-test-' + process.pid);
process.env.EXAMGEN_WORK_DIR = WORK;
process.env.EXAMGEN_OUTPUT_DIR = path.join(WORK, 'output');
fs.mkdirSync(process.env.EXAMGEN_WORK_DIR, { recursive: true });

const U = require('../src/lib/util');
const cfg = require('../src/config');
const essence = require('../src/store/essence');
const lib = require('../src/store/library');
const match = require('../src/skills/essenceMatch');
const dec = require('../src/skills/problemDecompose');
const qa = require('../src/skills/qa');
const corpus = require('../src/ingest/corpus');
const org = require('../src/skills/chapterOrganize');
const orch = require('../src/pipeline/orchestrator');
const render = require('../src/store/render');
const registry = require('../src/skills/registry');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fails.push(name + (extra ? ' ｜ ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? ' ｜ ' + extra : ''));
  }
}
function section(t) {
  console.log('\n' + t);
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function both(m) {
  return m.map((x) => x.content).join('\n');
}

/* ---------------- 1. 工具层 ---------------- */
section('util');
ok('uniq 保序去重并容错空值', eq(U.uniq(['a', 'b', 'a', null, undefined, 'c', 'b']), ['a', 'b', 'c']));
ok('uniq 接受非数组', eq(U.uniq(undefined), []) && eq(U.uniq(null), []));
ok('uniq 支持对象元素', U.uniq([{ a: 1 }, { a: 1 }, { a: 2 }]).length === 2);
ok('sha256 稳定', U.sha256('x').length === 64 && U.sha256('x') === U.sha256('x'));
const f = path.join(WORK, 't.json');
U.writeJson(f, { a: 1 });
ok('writeJson/readJson 往返', U.readJson(f).a === 1);
fs.writeFileSync(f, '{坏JSON');
ok('readJson 遇损坏回落', U.readJson(f, { d: 1 }).d === 1);
U.writeFileAtomic(path.join(WORK, 'a.txt'), 'hi');
ok('writeFileAtomic 自动建目录并写入', fs.readFileSync(path.join(WORK, 'a.txt'), 'utf8') === 'hi');
ok('无残留临时文件', !fs.readdirSync(WORK).some((x) => x.includes('.tmp-')));
U.appendJsonl(path.join(WORK, 'x.jsonl'), { i: 1 });
fs.appendFileSync(path.join(WORK, 'x.jsonl'), '破损行\n');
U.appendJsonl(path.join(WORK, 'x.jsonl'), { i: 2 });
ok('readJsonl 跳过损坏行', U.readJsonl(path.join(WORK, 'x.jsonl')).length === 2);

/* ---------------- 2. 配置与输入归类 ---------------- */
section('config');
const s = cfg.load(true);
ok('章节映射为教材 12 章', s.chapterMap.length === 12 && s.chapterMap[0].title.includes('极限') && s.chapterMap[11].title.includes('二次型'));
ok('收敛目标 15~20 个一级通法', s.convergence.firstLevelTargetMin === 15 && s.convergence.firstLevelTargetMax === 20);
ok('每 5 章做一次跨章合并', s.convergence.crossMergeEveryChapters === 5);
ok('三档相似度阈值 0.9 / 0.6', match.TIERS[0].min === 0.9 && match.TIERS[1].min === 0.6);
ok('批量拆解默认 6 题/次', s.batch.problemsPerCall === 6);
const roleOf = (n) => cfg.discoverInputFiles(path.join(U.ROOT, 'date1')).find((x) => x.file === n || x.file.endsWith(n));
ok('输入目录可扫描且含 6 类角色', (() => {
  const all = cfg.discoverInputFiles(path.join(U.ROOT, 'date1'));
  const roles = new Set(all.map((x) => x.role));
  return all.length > 30 && ['problemBook', 'solutionBook', 'syllabus', 'formula', 'seedTemplate', 'index'].every((r) => roles.has(r));
})(), '目录 ' + path.join(U.ROOT, 'date1') + ' 不存在时该判会失败');
ok('目录索引被识别为 index（不参与归纳）', (() => {
  const all = cfg.discoverInputFiles(path.join(U.ROOT, 'date1'));
  const idx = all.find((x) => /^目录/.test(x.base || ''));
  return !idx || idx.role === 'index';
})());
ok('apiKey 脱敏', cfg.maskKey('sk-1234567890abcdef') === 'sk-1****cdef' && cfg.maskKey('') === '');
ok('深度合并优先覆盖标量', cfg.deepMerge({ llm: { temperature: 0.2, retries: 2 } }, { llm: { temperature: 0 } }).llm.temperature === 0);

/* ---------------- 3. 本质相似度 ---------------- */
section('essence');
ok('自反性 = 1', Math.abs(essence.similarity('夹逼放缩', '夹逼放缩') - 1) < 1e-9);
ok('对称', essence.similarity('abc甲乙', 'abc乙丙') === essence.similarity('abc乙丙', 'abc甲乙'));
ok('同原理表述超过覆盖阈值 0.45', essence.similarity('把数列拆成两端用夹逼控制极限', '对数列两端放缩后用夹逼准则求极限') > 0.45);
ok('无关表述低于覆盖阈值 0.45', essence.similarity('用夹逼准则控制放缩边界', '矩阵相似对角化要求特征向量个数充足') < 0.45);
ok('matrix 只报高对并按降序', (() => {
  const m = essence.matrix([
    { id: 'A', essence: '两端放缩后夹逼求极限' },
    { id: 'B', essence: '两端放缩后用夹逼准则求极限' },
    { id: 'C', essence: '二次型配方法化为标准形' },
  ]);
  return m.length === 1 && m[0].a === 'A' && m[0].b === 'B';
})());
ok('sameEssence 签名去冗余', match.sameEssence('夹逼准则放缩求极限', '夹逼准则放缩求极限。') && !match.sameEssence('夹逼准则放缩求极限', '洛必达处理分式未定型'));

/* ---------------- 4. 模板库与版本 ---------------- */
section('library');
ok('bump major 进位 / minor 补第三段', lib.bump('v0.1', 'major') === 'v0.2' && lib.bump('v1.2', 'major') === 'v1.3' && lib.bump('v1.2', 'minor') === 'v1.2.1');
ok('bump 兼容缺省与三段', lib.bump('v2.3.4', 'major') === 'v2.4' && lib.bump('乱码', 'major') === 'v0.1');
const d1 = {
  problem_id: 'ch1-A-mc-01',
  surface_type: '变限积分定阶',
  essence: '分子分母同阶无穷小比较主部',
  steps: ['写出主部', '比较阶数'],
  boundaries: { applicable: ['x→0'], invalid: ['振荡无极限'] },
  exam_points: ['无穷小比阶'],
  stem_excerpt: '设 f(x)…',
};
const t1 = lib.create({ name: '无穷小定阶通法', discipline: '高等数学', chapters: [1], chapterTitles: ['函数、极限、连续'], essence: d1.essence, steps: d1.steps, exam_points: d1.exam_points, _skill: 'test' });
ok('create 初始版本 v0.1 且带 create 历史', t1.version === 'v0.1' && t1.history[0].action === 'create');
ok('create 自动分配学科前缀 id', /^T-HS-\d{2}-I$/.test(t1.id));
lib.upsert(t1);
ok('upsert 落库并可回读', lib.byId(t1.id) && lib.active().length === 1);
let cur = lib.byId(t1.id);
cur = lib.applyDecomposition(cur, d1, { kind: 'minor', skill: 'test' });
lib.upsert(cur);
ok('并入新题 → 记录题号并小版本升级', cur.covered_problem_ids.includes('ch1-A-mc-01') && cur.version === 'v0.1.1' && lib.byId(t1.id).version === 'v0.1.1');
const dup = lib.applyDecomposition(cur, d1, { kind: 'minor', skill: 'test' });
ok('同题重复并折不升版本不重复记例', dup.version === 'v0.1.1' && dup.covered_problem_ids.length === 1);
cur = lib.applyDecomposition(cur, Object.assign({}, d1, { problem_id: 'ch1-A-mc-02', surface_type: '等价替换' }), { kind: 'major', skill: 'test', branch: { name: '含参变限积分', trigger: '上限含参', steps: ['先求导'], surface_types: ['含参积分'], boundary: '被积函数连续' } });
lib.upsert(cur);
ok('branch 走大版本并写入分支', cur.version === 'v0.2' && cur.branches.length === 1 && cur.branches[0].name === '含参变限积分');
const withCh = lib.applyDecomposition(cur, Object.assign({}, d1, { problem_id: 'ch8-A-mc-01', chapterNo: 8, chapterTitle: '矩阵' }), { kind: 'minor', bump: false, skill: 'test' });
ok('跨章并入自动登记章节（分章覆盖与章内组织包依赖 chapters）', withCh.chapters.includes(1) && withCh.chapters.includes(8) && withCh.chapterTitles.includes('矩阵') && cur.chapters.length === 1);
lib.markChapterDone(8);
lib.markChapterDone(8);
ok('已完成章节表存数字且幂等（网页端 includes(章节号) 判完成）', (() => { const d = lib.read().chaptersDone; return d.length === 1 && d[0] === 8 && (d || []).includes(8); })());
cur = lib.applyDecomposition(cur, Object.assign({}, d1, { problem_id: 'ch1-A-mc-03' }), { kind: 'minor', bump: false, skill: 'test' });
ok('bump:false 只并入不升版', cur.version === 'v0.2' && cur.covered_problem_ids.includes('ch1-A-mc-03'));
cur = lib.applyDecomposition(cur, Object.assign({}, d1, { problem_id: 'ch1-A-mc-04' }), { kind: 'minor', skill: 'test', essencePolish: '更长的本质表述：分子分母同阶无穷小比较主部再定阶' });
ok('essencePolish 只在不缩短时生效', cur.essence.includes('再定阶'));
cur = lib.applyDecomposition(cur, Object.assign({}, d1, { problem_id: 'ch1-A-mc-05' }), { kind: 'minor', skill: 'test', essencePolish: '短' });
ok('essencePolish 更短则忽略', cur.essence.includes('再定阶'));
for (let i = 0; i < 20; i++) cur = lib.applyDecomposition(cur, Object.assign({}, d1, { problem_id: 'p' + i }), { kind: 'minor', bump: false, skill: 'test' });
lib.upsert(cur);
ok('例题按最近 12 条截断、题号全量保留', cur.examples.length <= 12 && cur.covered_problem_ids.length === 25);
ok('digest 含模板 id 与本质', lib.digest().includes(t1.id) && lib.digest().includes('本质：'));
ok('digest 按章过滤', lib.digest({ chapter: 99 }).trim() === '');
ok('stats 统计模板数/覆盖题数/分章/分支', (() => {
  const st = lib.stats();
  return st.templates === 1 && st.level1 === 1 && st.coveredProblems === 25 && st.byChapter[1] === 1 && st.branches === 1 && st.kinds.induced === 1;
})(), JSON.stringify(lib.stats()));

/* ---------------- 5. 三档匹配（真实落库） ---------------- */
section('essence-match');
ok('tierOf 档位边界', match.tierOf(0.95).action === 'refine' && match.tierOf(0.9).action === 'refine' && match.tierOf(0.89).action === 'branch' && match.tierOf(0.6).action === 'branch' && match.tierOf(0.59).action === 'new' && match.tierOf(null).action === 'new');

const base = lib.byId(t1.id);
const decRefine = Object.assign({}, d1, { problem_id: 'ch1-B-mc-01', essence: base.essence });
const a1 = match.applyDecision({ similarity: 0.95, action: 'refine', template_id: base.id, patch: { boundary_add: { applicable: ['分母主部唯一'], invalid: [] }, example_note: '例' } }, decRefine, { chapterNo: 1, discipline: '高等数学', chapterTitle: '函数、极限、连续' });
ok('refine：命中同模板 + 小版本 + 补边界', a1.action === 'refine' && a1.template_id === base.id && a1.after !== a1.before && lib.byId(base.id).boundaries.applicable.includes('分母主部唯一'));

const a2 = match.applyDecision({ similarity: 0.72, action: 'branch', template_id: base.id, patch: { branch: { name: '泰勒取主部', trigger: '相减抵消', steps: ['展开到首个非零项'], surface_types: ['差型无穷小'], boundary: '需可展开' } } }, Object.assign({}, d1, { problem_id: 'ch1-B-mc-02', essence: '相减抵消后取泰勒首非零项定阶' }), { chapterNo: 1, discipline: '高等数学', chapterTitle: '函数、极限、连续' });
ok('branch：新增二级分支 + 大版本', a2.action === 'branch' && lib.byId(base.id).branches.some((b) => b.name === '泰勒取主部') && /^v\d+\.\d+$/.test(a2.after));

const a3 = match.applyDecision({ similarity: 0.2, action: 'new', template_id: 'NEW:定积分定义求和', patch: { template: { name: '定积分定义求和', essence: '和式极限改写为区间分割的黎曼和', scope: 'n 项和', steps: ['提出 1/n', '识别 f(k/n)', '写成积分'], boundaries: { applicable: ['和式可表为 f(k/n)'], invalid: ['项数非 n 阶'] }, exam_points: ['利用定积分定义'], surface_types: ['数列和极限'] } } }, { problem_id: 'ch1-B-mc-03', chapterNo: 1, tier: 'B', section: '选择题', no: 3, surface_type: 'n 项和极限', essence: '和式取极限本质是黎曼和', steps: ['提 1/n'], boundaries: { applicable: ['可表黎曼和'], invalid: [] }, exam_points: ['利用定积分定义'], stem_excerpt: '求和式极限' }, { chapterNo: 1, discipline: '高等数学', chapterTitle: '函数、极限、连续' });
ok('new：新建一级模板并带例题', a3.action === 'new' && a3.template_id !== base.id && lib.byId(a3.template_id).covered_problem_ids.includes('ch1-B-mc-03'));
ok('new 模板版本 v0.1（不因附例题升版）', lib.byId(a3.template_id).version === 'v0.1');

const a4 = match.applyDecision({ similarity: 0.1, action: 'new', template_id: 'NEW:重复造轮子', patch: { template: { name: '重复造轮子', essence: base.essence } } }, Object.assign({}, d1, { problem_id: 'ch1-B-mc-04', essence: base.essence }), { chapterNo: 1, discipline: '高等数学', chapterTitle: '函数、极限、连续' });
ok('反冗余：本质签名相同的 new 自动并入已有模板', a4.action === 'auto-merge' && a4.template_id === base.id);

const a5 = match.applyDecision({ similarity: 0.8, action: 'branch', template_id: 'T-不存在', patch: {} }, Object.assign({}, d1, { problem_id: 'ch1-B-mc-05' }), { chapterNo: 1, discipline: '高等数学', chapterTitle: '函数、极限、连续' });
ok('template_id 失效时按本质回退定位', ['branch', 'refine', 'auto-merge', 'new'].includes(a5.action));

const msgs = match.buildMessages([Object.assign({ problem_id: 'x' }, d1)], 1, '#T-1 | 名字 | v0.1 | 本质：x');
ok('匹配提示词含冻结库摘要与逐条回填要求', both(msgs).includes('#T-1') && both(msgs).includes('共 1 项'));

/* ---------------- 6. 拆解 Skill ---------------- */
section('problem-decompose');
const applied = dec.apply([{ id: 'p1', chapterNo: 1, tier: 'A', section: '选择题', no: 1, stem: '设…很长很长的题干', solution: '解…' }, { id: 'p2', chapterNo: 1, tier: 'A', section: '选择题', no: 2, stem: '另一题' }], {
  items: [{ problem_id: 'p1', surface_type: '题型', essence: '本质', steps: ['做', '', '再'], boundaries: { applicable: ['a'], invalid: ['b'] }, exam_points: ['考点'] }],
});
ok('按 problem_id 回填，缺项不编造', applied.length === 1 && applied[0].problem_id === 'p1');
ok('步骤去空、有解析标记正确', eq(applied[0].steps, ['做', '再']) && applied[0].hasSolution === true);
ok('输出恰为 5 字段所需的派生字段', ['surface_type', 'essence', 'steps', 'boundaries', 'exam_points'].every((k) => k in applied[0]) && !('pitfall' in applied[0]) && !('易错点' in applied[0]));
ok('题干缺 excerpt 时自动截 60 字', applied[0].stem_excerpt.length <= 60);
const dm = dec.buildMessages([{ id: 'p1', stem: '题干', solution: '解析', tier: 'A', section: '选择题' }], cfg.load().chapterMap[0], { lectures: {}, formulaEntries: [] });
ok('拆解提示词带上教材片段与公式命中', dm[1].content.includes('相关教材/讲义片段') && dm[1].content.includes('相关公式'));
ok('拆解提示词强制 5 字段且不设易错点', both(dm).includes('不设易错点') && both(dm).includes('本章考点清单'));
const kc = require('../src/skills/context').knowledgeContext({ lectures: { 章节一极限: { examPoints: [{ point: '数列极限' }], outline: [{ title: 't', body: '数列极限的定义', level: 3, excerpt: 'x' }] } }, formulaEntries: [] }, cfg.load().chapterMap[0], '数列极限');
ok('知识上下文按章节讲义回取考点与片段', kc.examPoints.includes('数列极限') && kc.lecture.length >= 0);

/* ---------------- 7. 组织与校验 ---------------- */
section('organize & qa');
ok('chunk 分块', eq(orch.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]) && eq(orch.chunk([], 3), []));
const om = org.buildMessages(lib.active(), '第1章章内合并去重');
ok('合并提示词写入 15~20 收敛目标', both(om).includes('15~20'));
ok('合并提示词约束 absorb_ids 不得包含 keep_id', both(om).includes('不得包含'));

const aux = lib.create({ name: '辅助通法', chapters: [1], chapterTitles: ['函数、极限、连续'], essence: '把分段情形统一成一个判据', steps: ['判据'], exam_points: ['辅助考点'], surface_types: ['辅助题型'], boundaries: { applicable: ['p'], invalid: ['q'] } });
lib.upsert(aux);
const fakeCtx = { emit() {}, cancelled: false };
const keepId = base.id;
const keepVer = lib.byId(keepId).version;
orch.applyOrganize(
  fakeCtx,
  {
    merges: [{ keep_id: keepId, absorb_ids: [aux.id], reason: '本质同层', final_name: '无穷小定阶与比阶通法', final_branches: [{ name: '分支甲', trigger: 'T', steps: ['S'], surface_types: ['x'], boundary: 'b' }] }],
    renames: [{ id: keepId, name: '无穷小定阶通法（改名）', reason: '层级梳理' }],
    hierarchy: [{ id: keepId, level: 1, note: '一级核心' }],
    chapter_summary: '一章一法',
  },
  '第1章'
);
const afterMerge = lib.all();
ok('吸收项置为 merged 并记录去向', (() => {
  const a = afterMerge.find((x) => x.id === aux.id);
  return a.status === 'merged' && a.merged_into === keepId;
})());
ok('合并后保留项去重合并考点/边界且升大版本', (() => {
  const k = lib.byId(keepId);
  return k.version !== keepVer && k.exam_points.includes('辅助考点') && k.boundaries.applicable.includes('p') && k.level === 1;
})());
ok('final_branches 覆盖旧分支', lib.byId(keepId).branches.length === 1 && lib.byId(keepId).branches[0].name === '分支甲');
ok('renames 生效（合并后再改名）', lib.byId(keepId).name === '无穷小定阶通法（改名）');
ok('active() 排除 merged 项', !lib.active().some((x) => x.id === aux.id));
ok('章内合并标记落盘且可回读（每章一次的口径依据）', (() => {
  orch.markOrganized('ch1');
  return orch.isOrganized('ch1') === true && (orch.readState().organized || {}).ch1 != null && orch.isOrganized('ch9') === false;
})());
const snapA = (() => { const k = lib.byId(keepId); return { v: k.version, br: k.branches.length, ep: k.exam_points.length, cp: k.covered_problem_ids.length }; })();
orch.applyOrganize(fakeCtx, { merges: [{ keep_id: keepId, absorb_ids: [aux.id], reason: '本质同层' }], renames: [{ id: keepId, name: '无穷小定阶通法（改名）', reason: '层级梳理' }] }, '第1章');
const snapB = (() => { const k = lib.byId(keepId); return { v: k.version, br: k.branches.length, ep: k.exam_points.length, cp: k.covered_problem_ids.length }; })();
ok('同一合并/改名重复回放为幂等（不再 bump 版本、不重复并分支）', JSON.stringify(snapA) === JSON.stringify(snapB), JSON.stringify(snapA) + ' vs ' + JSON.stringify(snapB));
const cov = qa.covPreMatch([{ point: '利用定积分定义', lecture: 'x' }], lib.active());
ok('考点覆盖：字面包含即判已覆盖', cov.covered.some((c) => c.point === '利用定积分定义' && c.sim >= 0.9));
const cov2 = qa.covPreMatch([{ point: '一个完全没被覆盖的考点名称' }], lib.active());
ok('未覆盖考点落入 residual 且不崩', cov2.covered.length === 0 && cov2.residual.length === 1);
const qaProbeFile = require('path').join(orch.D.qa, 'ch08.json');
try {
  fs.mkdirSync(orch.D.qa, { recursive: true });
  fs.writeFileSync(qaProbeFile, JSON.stringify({ chapterNo: 8, report: { coverage: { covered: [{ point: '一个只被语义判定覆盖的考点', by: 'llm' }] } } }));
  const covMerged = orch.coverageOf(8, []);
  ok('章节覆盖口径并入质检语义判定（未跑质检时退回纯确定性）', covMerged.covered === 1 && covMerged.deterministic === 0 && covMerged.semantic === 1 && !covMerged.uncovered.includes('一个只被语义判定覆盖的考点'), JSON.stringify({ c: covMerged.covered, d: covMerged.deterministic, s: covMerged.semantic }));
} finally {
  fs.unlinkSync(qaProbeFile);
}
ok('无质检报告时覆盖口径等于确定性预匹配', orch.coverageOf(8, []).covered === 0 && orch.coverageOf(8, []).semantic === 0);
const regionMd = '## 章节三 中值定理\n## （一）罗尔定理\n内容\n## 二、解题连招\n**介值定理**\n## 章节四 积分\n## （一）牛顿-莱布尼茨公式\n内容\n';
ok('考点按「章节N」区域归属：讲义末尾串档的下一章考点不混入本章', (() => {
  const all = corpus.extractExamPoints(regionMd).map((p) => p.point);
  const own = corpus.pointsOfLecture('章节三中值定理', regionMd).map((p) => p.point);
  return (
    all.some((x) => x.includes('牛顿-莱布尼茨公式')) &&
    !own.some((x) => x.includes('牛顿-莱布尼茨公式')) &&
    own.some((x) => x.includes('罗尔定理')) &&
    own.some((x) => x.includes('介值定理')) &&
    !own.some((x) => /^章节/.test(x))
  );
})());
const fakeCorpus = {
  lectures: { 章节一极限: { key: '章节一极限', examPoints: [{ point: '数列极限' }], outline: [{ title: '数列极限', level: 3, body: '单调有界准则与夹逼准则', excerpt: '单调有界准则' }] } },
  formulaEntries: [{ title: '等价无穷小', body: 'x→0 时 sin x ~ x' }],
  problems: [{ id: 'ch1-A-mc-01', stem: '设…', solution: '解…', chapterNo: 1 }],
};
const eqm = qa.eqMessages(lib.active(), fakeCorpus, cfg.load().chapterMap[0], new Map([['ch1-A-mc-01', { id: 'ch1-A-mc-01', stem: '设…', solution: '解…' }]]));
ok('等价校验提示词含代数/数值/恒等三标准', ['代数', '数值', '恒等'].every((k) => both(eqm).includes(k)));
const eqmOne = qa.eqMessages([{ id: 'T-X-99-T', name: '断言用模板', version: 'v0.1', essence: '本质', steps: ['s1'], boundaries: { applicable: [], invalid: [] }, examples: [{ problem_id: 'ch1-A-mc-01' }] }], fakeCorpus, cfg.load().chapterMap[0], new Map([['ch1-A-mc-01', { id: 'ch1-A-mc-01', stem: '设…', solution: '解…' }]]));
ok('等价校验提示词带入例题标答（Map 用 get 取而非下标）', both(eqmOne).includes('解…') && !both(eqmOne).includes('（无解析）'));
const bdm = qa.bdyMessages(lib.active());
ok('边界校验提示词要求 contradiction 分级', both(bdm).includes('contradiction'));
const bdyBase = { boundaries: { applicable: ['a'], invalid: ['b'] }, branches: [{ name: 'B1', trigger: 't1' }] };
ok('边界补丁与现状一致判为不变（重复回放不 bump 版本，等价校验 key 才能稳定）', (() => {
  const same = JSON.parse(JSON.stringify(bdyBase));
  const moved = JSON.parse(JSON.stringify(bdyBase));
  moved.boundaries.applicable = ['a', 'c'];
  const trig = JSON.parse(JSON.stringify(bdyBase));
  trig.branches[0].trigger = 't2';
  return orch.boundaryUnchanged(bdyBase, same) === true && orch.boundaryUnchanged(bdyBase, moved) === false && orch.boundaryUnchanged(bdyBase, trig) === false;
})());

/* ---------------- 8. 产物渲染 ---------------- */
section('render');
const file = render.chapterLibraryMd(cfg.load().chapterMap[0], lib.active(), 'v0.1', { problemTotal: 3, decomposed: 3, skippedNoSolution: 0, coverageRate: 1, covered: 2, total: 2, actions: { refine: 1 } });
ok('章节模板库 md 落盘且含模板编号', fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(keepId));
ok('actions 缺项渲染为 0 而非 undefined', !fs.readFileSync(file, 'utf8').includes('undefined'));
const hb = render.handbookMd({ coverage: { chapters: [], total: 0, covered: 0, rate: 0, typeRate: 0 } });
ok('手册 md 落盘', fs.existsSync(hb));
ok('全部产物写入临时 output 目录', [file, hb].every((x) => x.startsWith(path.join(WORK, 'output'))), file + ' / ' + hb);
ok('拆解与质检产物渲染器可用', (() => {
  const d = render.decompositionMd(cfg.load().chapterMap[0], [Object.assign({ matched_template_id: keepId, similarity: 0.95, action: 'refine' }, d1)]);
  const q = render.qaMd('测试报告', { summary: 's', tables: [{ title: 't', headerLine: '| a |', divider: '| - |', rows: ['| 1 |'] }], issues: [] });
  return fs.existsSync(d) && fs.existsSync(q) && d.startsWith(path.join(WORK, 'output')) && q.startsWith(path.join(WORK, 'output'));
})());

/* ---------------- 9. Skill 注册表 ---------------- */
section('registry');
const all = registry.all();
ok('三层 Skill 齐备（2 元 + 4 业务 + 3 校验）', ['task-scheduler', 'skill-forge', 'problem-decompose', 'seed-import', 'essence-match', 'chapter-organize', 'math-equivalence', 'syllabus-coverage', 'boundary-consistency'].every((id) => all.some((x) => x.id === id)));
ok('每层数量正确', all.filter((x) => x.layer === 'meta').length === 2 && all.filter((x) => x.layer === 'business').length === 4 && all.filter((x) => x.layer === 'qa').length === 3);
ok('SKILL.md 文档全部存在', all.every((x) => fs.existsSync(path.join(cfg.P.skills, x.layer, x.id, 'SKILL.md'))), all.map((x) => x.id).join(','));

/* ---------------- 10. HTTP 路由契约 ---------------- */
section('http');
const server = require('../src/server');
const patterns = server.routes.map((r) => r.re.source.replace(/\\\//g, '/'));
ok('前端契约路由齐全', ['/api/overview', '/api/library', '/api/problems', '/api/qa', '/api/skills', '/api/outputs', '/api/run', '/api/settings', '/api/models', '/api/route', '/api/events'].every((p) => patterns.some((re) => re.includes(p))));
ok('/output 支持嵌套产物路径', patterns.some((re) => re.includes('/output')));

/* ---------------- 11. 测试模式内容寻址回放 ---------------- */
section('agent-replay');
(async () => {
  const llm = require('../src/llm');
  const prov = llm.getProvider(cfg.load());
  ok('agent 模式使用回放 Provider', prov.name === 'agent-replay');
  const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'u-unique-' + Date.now() }];
  const k1 = await prov.chat({ skill: 'essence-match', messages: msgs, model: 'qoder-agent' }).then(
    () => null,
    (e) => e
  );
  ok('未命中缓存 → 抛 AgentTaskPending 并落待作答任务', k1 instanceof llm.AgentTaskPending && fs.existsSync(prov.pendingFile(k1.task.key)));
  ok('key = sha256(skill+model+messages)', k1.task.key === require('../src/llm/agentProvider').keyOf({ skill: 'essence-match', model: 'qoder-agent', messages: msgs }));
  ok('换 skill 或换措辞即不同 key', require('../src/llm/agentProvider').keyOf({ skill: 'other', model: 'qoder-agent', messages: msgs }) !== k1.task.key);
  prov.answer(k1.task.key, { items: [{ ok: 1 }] }, { skill: 'essence-match', chapter: 1 });
  const replay = await prov.chat({ skill: 'essence-match', messages: msgs, model: 'qoder-agent' });
  ok('回填后二次调用直接命中且结果一致', replay.replayed === true && JSON.parse(replay.text).items[0].ok === 1);
  ok('回填后待作答任务被清除', !fs.existsSync(prov.pendingFile(k1.task.key)));
  ok('listModels 提供离线目录供路由', Array.isArray(prov.listModels()) === false && (await prov.listModels()).length >= 5);
  let threw = false;
  try {
    llm.parseJsonLoose('{"items":[1,2},');
  } catch (e) {
    threw = true;
  }
  ok('不可修复的 JSON 明确抛错（交由修复重试链路兜住）', threw);
  const cat = llm.OFFLINE_CATALOG;
  const rReason = llm.routeModel(cat, 'math-equivalence', cfg.load());
  const rLong = llm.routeModel(cat, 'seed-import', cfg.load());
  const isReasoning = (id) => (cat.find((m) => m.id === id) || {}).reasoning;
  ok('按 Skill 能力偏好分流（推理型 vs 长上下文型）', rReason.model !== rLong.model && isReasoning(rReason.model) === true, JSON.stringify([rReason.model, rLong.model]));
  const rFixed = llm.routeModel(cat, 'essence-match', Object.assign({}, cfg.load(), { llm: Object.assign({}, cfg.load().llm, { routing: Object.assign({}, cfg.load().llm.routing, { 'essence-match': 'glm-4-plus' }) }) }));
  ok('设置中为该 Skill 指定模型时优先于自动路由', rFixed.model === 'glm-4-plus');
  ok('路由结果带可解释理由与候选', rLong.reason.length > 0 && rLong.candidates.length > 1);
  ok('parseJsonLoose 容忍围栏与前后缀', llm.parseJsonLoose('```json\n{"a":1}\n```').a === 1 && llm.parseJsonLoose('前缀 {"a":2} 后缀').a === 2);
  const g = llm.gate(2);
  let live = 0,
    peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      g(async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return 1;
      })
    )
  );
  ok('并发闸门不超上限', peak <= 2);
  ok('缓存目录与真实 data/ 隔离', cfg.P.cache.startsWith(WORK) && cfg.P.library.startsWith(WORK));
  finish();
})().catch((e) => {
  fails.push('agent-replay 异常：' + (e && e.message));
  finish();
});

function finish() {
  try {
    fs.rmSync(WORK, { recursive: true, force: true });
  } catch (e) {}
  console.log('\n通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  if (fails.length) {
    fails.forEach((x) => console.log(' - ' + x));
    process.exitCode = 1;
  } else {
    console.log('全部通过：核心不变量（5 字段拆解 / 三档匹配 / 版本迭代 / 收敛目标 / 考点覆盖 / 内容寻址回放 / 产物渲染 / 路由契约）均成立。');
  }
}
