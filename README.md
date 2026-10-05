# 考研数学万能通法自动归纳系统

输入 md 语料（题库 / 答案解析 / 考点 / 公式 / 教材 / 已有通法）→ 逐题标准化拆解（5 字段）→ 按「核心本质」增量归并迭代模板库 → 章内/跨章合并收敛 → 输出《考研数学万能通法手册.md》，配零依赖网页端。

设计原则：只归纳不生成题；严格按教材章节增量迭代；本质优先（代数等价 / 数值等价 / 恒等·逻辑等价）；每个模板「烧开」（多题回测 + 三道质检）再推进。

---

## 快速开始

```bash
node src/cli.js index            # 语料装配 + 结构统计
node test/run.js                 # 99 项核心不变量自检（应全部通过）
node src/server.js               # 网页端，默认 http://127.0.0.1:8787
```

### 克隆后首次运行（必读）

本仓库**只含代码与归纳产物**，以下目录/文件被 `.gitignore` 排除，需要自备：

| 项 | 为什么不在仓库里 | 怎么补 |
| --- | --- | --- |
| `date1/` | 第三方教辅的 OCR 文本（做题本 / 解析册 / 讲义 / 公式），版权内容不发布 | 把自己的 md 语料放进 `date1/`，再 `node src/cli.js index` 装配 |
| `config/settings.json` | 生产模式会在此落 `llm.apiKey`，不能入库 | 复制 `.env.example` 配环境变量，或启动网页端后在「设置」页填写（页面展示一律经 `cfg.maskKey` 打码）；缺失时 `src/config.js` 回落内置 `DEFAULTS` |
| `data/` `agent-work/` `agent-work-backup/` | 运行态与智能体工作包（体量大、内嵌题面原文） | 无需补：首次 `run` 会自动重建 |
| `tools/exemplars-ch*/` | 各章实测脚本留档，内嵌题号与解析摘录 | 无需补：只是过程留档，不参与运行 |

因此**干净克隆下 `node test/run.js` 是 98/99**——唯一失败项是「输入目录可扫描且含 6 类角色」，它在 `date1/` 不存在时必然失败；放入语料后即 99/99。归纳产物（手册 / 模板库 / 校验报告）在 `output/` 内可直接查看，其中 `output/题库.json` 与 `output/题库对照解析.md` 属整册转储，同样不发布。

有两种运行模式，由 `EXAMGEN_MODE` 决定：

---

## 路径 A：生产 live 模式（调用真实大模型）

```bash
cp .env.example .env             # 或直接导出环境变量
# .env 关键项：
#   EXAMGEN_MODE=live
#   LLM_BASE_URL=https://api.deepseek.com/v1   （任意 OpenAI 兼容端点）
#   LLM_API_KEY=sk-xxxx
#   LLM_MODEL=deepseek-chat                    （留空可在网页端拉取后选择）
node src/cli.js run --chapters 1            # 按章节跑：种子导入 → 拆解 → 匹配 → 章合并 → 三道质检
node src/cli.js run --chapters 2,3,4        # 依次推进；每 5 章自动做一次跨章共性合并
node src/cli.js run --stages seed,chapter,converge --all  # 全学科推进 + 全局收敛
node src/cli.js export                      # 产出《考研数学万能通法手册.md》
```

也可以完全不写 `.env`：启动网页端 → 「设置」页 → 填 baseUrl / key → **一键获取模型**（`POST /api/models/probe`）→ **自主路由**（`POST /api/route` + `/api/route/auto`，系统按各 Skill 的长上下文 / 推理需求自动分派模型）。key 只落在本地 `config/settings.json`，页面展示一律打码（`cfg.maskKey`）。

live 模式下模型按各 Skill 的 `routingHints` 自动选型：拆解/种子导入偏长上下文，匹配/合并/校验偏推理；亦可逐 Skill 手工指定。

## 路径 B：测试 agent 模式（智能体扮演大模型）

无外部 API 时由智能体（agent）完成每次模型调用，所有调用以 **sha256(skill+model+messages) 内容寻址**缓存，重放免费：

```bash
node src/cli.js run --chapters 1 --stages seed,chapter   # 遇到未缓存调用即挂起并落盘工作包
node src/cli.js tasks                                     # 查看待作答任务
node src/cli.js tasks --dump                              # 生成 agent-work/<key>.input.md + task.json
# ……智能体阅读 input.md，按其中的输出 schema 写 agent-work/<key>.answer.json……
node tools/validateAnswers.js                             # 结构校验，必须 0 错误
node src/cli.js tasks --submit-all                        # 答案灌入 LLM 缓存
node src/cli.js run --chapters 1 --stages seed,chapter   # 自动续跑；新挂起重复上述循环
node src/cli.js export && node src/cli.js status          # 手册 + 覆盖率/收敛状态
```

作答规范（红线）：

1. 条数与顺序必须严格等于 `task.json.problem_ids`；
2. essence-match 的相似度决定动作档位（≥0.90 refine / 0.60–0.89 branch / <0.60 new），`template_id` 只能引用输入冻结摘要中的 `T-XX-NN-S`，新建写 `NEW:通法名`（≤20 字，同批同质必须命中同一模板）；
3. 步骤写成可迁移的通用操作，不含具体数值与题号；
4. 不新增题型、不改写题目、不出新题；
5. 同一批工作包只在 `agent-work/` 放 `<key>.answer.json`，不留其他文件。

## CLI 速查

| 命令 | 作用 |
| --- | --- |
| `node src/cli.js index` | 语料装配 + 结构统计 |
| `node src/cli.js run --chapters 1 [--reset] [--stages seed,chapter,converge]` | 增量迭代流水线 |
| `node src/cli.js tasks [--dump\|--submit-all]` | 测试模式工作包 |
| `node src/cli.js answer --key K --file a.json` | 单包回填 |
| `node src/cli.js status` | 模板库 / 覆盖率 / 收敛状态 |
| `node src/cli.js export` | 渲染手册与全部产物 |
| `node src/cli.js route --skill essence-match` | 查看自主路由结果 |
| `node src/cli.js reset-cache [--cache]` | 清理运行态（不动 date1/） |
| `node test/run.js` | 99 项不变量断言 |
| `node tools/browserCheck.js` | 网页端真实浏览器验证（headless Chromium + CDP，10 视图 + 点击 + 运行时错误） |
| `node src/server.js` | 网页端（EXAMGEN_PORT 默认 8787） |

## 目录结构

```
/workspace/examgen
├── date1/                  # 唯一输入语料（md：章节讲义/做题本/解析册/破天学长/公式）
├── src/
│   ├── cli.js / server.js / config.js
│   ├── ingest/             # md 解析、语料装配、题目抽取
│   ├── llm/                # invoke() / routeModel() / agentProvider（内容寻址回放）
│   ├── skills/             # registry（2 元能力 + 4 业务 + 3 质检）+ 各 SKILL.md
│   ├── pipeline/           # orchestrator 调度 + agentWorkbench 工作包
│   └── store/              # 模板库读写、版本 bump、手册渲染
├── skills/<layer>/<id>/SKILL.md
├── data/                   # 运行态（library/ problems/ runs/ agent-cache/ agent-pending/）
├── agent-work/             # 测试模式工作包（input.md / task.json / answer.json）
├── agent-work-backup/      # 每包答案的双副本备份
├── output/                 # 手册 / 模板库 / 拆解记录 / 校验报告
├── tools/                      # validateAnswers.js（答案包结构校验，提交前唯一入口）· browserCheck.js（真实浏览器验证）· repairMatch.js · exportProblemBank.js · exemplars-chN/（各章实测脚本留档）
├── web/                    # 前端（10 个导航页，见下）
└── test/run.js             # 99 项核心不变量
```

## 网页端（http://127.0.0.1:8787）

10 个导航页：**总览**（全局指标·章节进度）/**数据源**（OCR 输入与角色归类）/**题库**（筛选·拆解·通法归属）/**模板库**（学科→章节→一级通法→二级分支，支持在线编辑 `PUT /api/library/template`）/**运行**（启动归纳·SSE 实时事件流 `/api/events`）/**校验**（三道质检报告）/**输出**（嵌套产物直出，`.md` 文本直显、`?download` 附件下载）/**设置**（模式·模型接入·一键获取模型·自主路由·收敛目标）/**测试模式**（待作答工作包与回填）/**Skill**（三层能力清单与 `skills/forge` 能力自主扩展）。

## 质检体系（每个模板必须三道全过）

| 校验 | 标准 | 对应 |
| --- | --- | --- |
| math-equivalence | 代数等价 / 数值等价 / 恒等·逻辑等价 | 极致对标 |
| syllabus-coverage | 对照考点清单，知识单元无遗漏 | 知识单元完整 |
| boundary-consistency | 适用与失效不矛盾、分支触发互斥、跨模板归属消歧 | 高频回测 |

## 当前进度（2026-10-05 · 已收官）

**12 章 925 题全部闭环，一级通法收敛到 18 条（目标 15~20），待作答 0，99 项测试全绿，网页端真实浏览器验证 22/22 通过。**

| 指标 | 终态 |
| --- | --- |
| 语料 | 925 题 / 919 解析 / 对齐 99.4%（剩余 6 道系解析册整页丢失） |
| 一级通法 | **18 条**（高等数学 12 + 线性代数 6），落在 15~20 目标区间 |
| 二级分支 | 588 条（374 条历史模板记录中 356 条经 merged_into 链降为分支，内容零丢失） |
| 题目归属率 | 100%（925/925） |
| 考点覆盖率 | **97.1%（339/349）**：第 1/4/5/7/8/10/11 章 100%；第 2 章 68/69、第 3 章 72/75、第 6 章 19/21、第 9 章 19/21、第 12 章 16/18 |
| 未覆盖 10 条 | 全部是讲义批注/残句子标题或数一·数三专属条目，逐条记 `covered:false + missing_note`（守「只归纳不出题」红线，不虚构题面凑数） |
| 三道质检 | 12 章等价/边界/覆盖全部 `pass`，边界冲突 0 项未决 |
| 合并层级 | 章内合并 ch1~ch12 · cross-1-5 · cross-6-10 · 全局 converge |
| 测试模式 | 累计作答 617 包（内容寻址 cache 全回放），`data/agent-pending/` = 0 |
| 产物 | 手册 993KB / 5964 行 · 模板库 182 个 md · 各章校验报告 + 全局收敛报告 · 题库 JSON 与对照解析 |

18 条一级通法（高数 12：极限定阶分型与存在性判定 · 微分概念关系与可微性判定 · 中值定理选型与微分等式不等式证明 · 求导法则族与高阶导数 · 导数定号的性态分析与几何量 · 不定积分归型与函数还原 · 含参变限积分的求导与定数 · 积分化简对称性与几何物理微元 · 反常积分与级数的定阶判敛 · 微分方程的定型化归与建方程 · 常系数线性方程求解与解的性态 · 题型分层与一体六面框架；线代 6：行列式计算定型化简 · 矩阵运算可逆性与幂 · 向量组的秩相关性与等价判定 · 线性方程组的求解与解结构 · 特征值与相似对角化 · 二次型标准形规范形与正定）。

逐章闭环数字、合并与质检的具体纠错内容见 `HANDOFF.md` §2.3~§2.11、§8；踩坑清单（39 条）与回归防线见 §6。

## 网页端真实浏览器验证

```bash
node src/server.js &            # 127.0.0.1:8787（地址别写 localhost：Node 18 会解析到 ::1）
node tools/browserCheck.js      # 零依赖 WebSocket + CDP 驱动 headless Chromium
```

10 视图深链（锚点取自真实 API 数据 + 空态哨兵）+ 10 次导航点击 + 1 次模板卡点击 + 1 条「已并入模板」合并链深链 = **22/22 通过**，0 JS 异常 / 0 console 错误 / 0 请求失败，11 张截图与 `report.json` 落在 `output/browser/`。这一轮查出并修复了两处前端缺陷：「运行」页历史运行表因 `/api/runs` 返回 `{items}` 而永久空白；全局收敛后 356 条 `status=merged` 的历史模板被深链打开时不提示已并入哪条主干（现沿 `merged_into` 逐跳解析并给出跳转与合并链）。详见 `HANDOFF.md` §9 与坑 39。

## 已知事项

- 本机无 `npm`（测试只能 `node test/run.js`）；**有 headless Chromium**，网页端已做真实渲染验证（上一节），不再是纯 HTTP 冒烟；
- `/api/files/content` 缺 `file` 参数时返回 500（EISDIR）而非 400，属外观级健壮性问题，不影响功能；
- 单卡体量偏大：跨章合并后模板级「适用前提/失效场景」是各分支条件的并集，需按「命中其一即可」读（分支自己的 trigger 里已含局部前提）；
- 数据全是本地文件，重置走 `node src/cli.js reset-cache`；被清理的历史产物在 `.trash/`；**已闭环的章节不要复跑**（会轮换 QA key 并覆写报告，见 HANDOFF 坑 32）。
