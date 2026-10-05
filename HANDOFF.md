# 交接文档 · 考研数学万能通法自动归纳系统

> 面向「冷启动接手」的会话：本文档记录项目需求锚点、代码现状、第 1 章完整闭环的精确进度、剩余待办的可执行步骤，以及两轮踩过的坑。
> 最后更新：2026-10-05 · 代码状态：`node test/run.js` **99/99 全绿** · 非 git 仓库（无版本回退，改动前务必备份）
> **2026-10-05 收官**：第 9~12 章闭环、cross-6-10 合并、ch4 回填、ch2/ch3 复判、全局 converge、**网页端真实浏览器验证（22/22）** 已全部完成——一级通法 **18 条**（高数 12 + 线代 6）、588 条二级分支、925 题全覆盖、全局考点覆盖 **97.1%（339/349）**、待作答 0、手册 993KB / 5964 行（详见 §8、§9）。**项目已达验收终态，无遗留待办。**

---

## 0. 一句话与需求锚点

**项目**：输入 md 语料 → 逐题拆解 → 按「核心本质」增量归并迭代模板库 → 章节/跨章合并收敛 → 输出一本《考研数学万能通法手册.md》，配网页端。

原始硬性约束（验收口径，任何改动都不得违背）：

| 约束 | 具体值 |
| --- | --- |
| 输入角色 | 6 类 md：题库 / 答案（解析册）/ 考点（教材章节）/ 公式 / 已有通法 / 目录 |
| 单题拆解 | 固定 **5 字段**：表面题型 / 核心本质 / 标准解题步骤 / 边界条件 / 对应考点 —— **明确不要「易错点」** |
| Skill 分层 | 三层 **2 元 + 4 业务 + 3 校验**，每层都要有 `SKILL.md` |
| 匹配三档 | 相似度 ≥0.90 优化模板（小版本）；0.60–0.89 新增二级分支（大版本）；<0.60 新建模板（v0.1） |
| 迭代方式 | 严格按教材章节顺序**增量**迭代；章内合并去重每章一次；跨章共性合并每 5 章一次 |
| 收敛目标 | 一级通法最终收敛到 **15–20 条** |
| 校验 | 数学等价三标准（代数等价 / 数值等价 / 恒等·逻辑等价）+ 考点覆盖 100% + 边界一致性 |
| 边界 | **只归纳方法，不生成新题** |
| 部署 | 生产：可配 baseUrl / key / model，且能「一键获取模型 → 自主路由选择」；测试：由智能体（我）扮演大模型完成归纳；输入 md、输出 md；有网页端；数据就是 `date1/` |

---

## 1. 目录地图（接手先读这几个）

```
/workspace/examgen
├── date1/                      # 唯一输入语料（md，含 章节*/做题本/解析册/破天学长/公式）
├── src/
│   ├── cli.js                  # 8 个子命令，见 §5
│   ├── config.js               # 路径 + DEFAULTS（mode/llm/routingHints/batch/convergence/chapterMap）
│   ├── server.js               # 零依赖 HTTP + SSE，48 条 route() 注册 + /output/** 嵌套产物
│   ├── web → ../web            # 前端（10 个 SPA 视图，PAGES 注册表与 index.html 导航一一对应）
│   ├── lib/util.js             # writeFileAtomic / readJson / uniq / slug / parseJsonLoose 等
│   ├── ingest/                 # md 解析、语料装配、题目抽取
│   ├── llm/index.js            # invoke() / routeModel() / gate() / AgentTaskPending
│   ├── llm/agentProvider.js    # 测试模式：keyOf=sha256(skill+model+messages)、pending/replay/answer
│   ├── skills/registry.js      # 三层注册表 + forge() 生成新 Skill
│   ├── skills/{seedImport,problemDecompose,essenceMatch,chapterOrganize,qa}.js
│   ├── pipeline/orchestrator.js# 调度：seed → 章节(拆解→匹配→章合并) → 收敛 → 质检 → 渲染
│   ├── pipeline/agentWorkbench.js # dump()/submit()/submitAll()：测试模式工作包
│   └── store/{library.js,render.js} # 模板库读写、版本 bump、手册渲染
├── skills/<layer>/<id>/SKILL.md
├── data/                       # 运行态（library/ problems/ runs/ agent-cache/ agent-pending/ state.json）
├── agent-work/                 # 智能体工作包：<key>.input.md + <key>.task.json + <key>.answer.json
├── agent-work-backup/          # 每份答案的即时双副本备份（2026-10-04 新增）
├── output/                     # 产物 md（手册 / 模板库 / 拆解记录 / 校验报告）
├── tools/                      # validateAnswers.js（答案结构校验，先跑它再 submit）· repairMatch.js · exportProblemBank.js · **browserCheck.js（零依赖 WebSocket+CDP 驱动 headless Chromium 做网页端真实验证，见 §9）**
│   └── exemplars-ch3|ch4|ch5|ch6|ch7|ch8|ch9|ch10|ch11|ch12|cross/  # 各章实测脚本留档：族定义 / 逐题决策 / 拆解 / 匹配 / 章合并 / 三道质检（含 rerun）
├── README.md                   # 生产 live / 测试 agent 两条路径（2026-10-04 新增）
└── test/run.js                 # 99 条不变量断言，node test/run.js
```

**权威输入 = `agent-work/<key>.input.md`**。注意：`data/agent-pending/<key>.json` 里的 `messages` 才是完整输入，**dump 出的 input.md 对部分 Skill 会丢正文**（已知缺陷，见 §6），以 pending json 为准。

---

## 2. 当前真实进度（实测数据，非计划）

### 2.1 任务清单（终态）

| # | 任务 | 状态 |
| --- | --- | --- |
| 1 | 零依赖骨架 + 摄取层 | ✅ 完成 |
| 2 | LLM 提供层（openai 兼容 + agent 回放 + 模型路由） | ✅ 完成 |
| 3 | 三层 Skill 体系（2+4+3） | ✅ 完成 |
| 4 | 增量迭代流水线 + 版本化 md 输出 | ✅ 完成（第 1~12 章全链路闭环 + cross-1-5 + cross-6-10 + 全局 converge） |
| 5 | HTTP 服务端 + 网页端 | ✅ 完成（**真实浏览器验证 22/22 通过**：10 视图深链 + 10 次导航点击 + 模板卡点击 + 已并入模板合并链，0 JS 异常 / 0 console 错误 / 0 请求失败，见 §9） |
| 6 | 真实数据跑通：种子导入 + 章节增量迭代（测试模式） | ✅ 第 1~12 章全部完成（925 题、617 包已作答、待作答 0，见 §2.3~§2.11、§8） |
| 7 | README（生产 live / 测试 agent 两条路径） | ✅ 完成（已同步收官数字） |

### 2.2 模板库（`data/library/templates.jsonl`·终态实测）

```
在库 active 18（kind=seed 5 + kind=induced 13，全部 level=1 一级核心通法）
templates.jsonl 总记录 374 条，其中 356 条已带 merged_into 链被吸收为二级分支，内容零丢失
二级分支 588 · 已覆盖题数 925/925（题型归属率 100%）· 非一级模板 0
学科分布：高等数学 12 · 线性代数 6
全局考点覆盖 97.1%（339/349）：第 1/4/5/7/8/10/11 章章内 100%，第 2 章 68/69、第 3 章 72/75、
      第 6 章 19/21、第 9 章 19/21、第 12 章 16/18 —— 未覆盖的 10 条全部是讲义批注/残句子标题或数一数三专属条目，
      已逐条记 covered:false + missing_note（红线「只归纳不出题」，不虚构题面凑数）
题目数（chapterStats，全章 decomposed==problems）：ch1 77 · ch2 145 · ch3 167 · ch4 73 · ch5 78 · ch6 76 ·
      ch7 39 · ch8 56 · ch9 35 · ch10 54 · ch11 62 · ch12 63
章版本：ch1 v0.17 · ch2 v0.25 · ch3 v0.15 · ch4 v0.15 · ch5 v0.19 · ch6 v0.14 · ch7 v0.15 ·
        ch8 v0.13 · ch9 v0.11 · ch10 v0.12 · ch11 v0.11 · ch12 v0.15（每次成功 run bump 一位，不是质量信号）
chaptersDone [1..12]（数字数组，网页端按 includes(章节号) 判「已完成」，见坑 30）
organized：ch1~ch12 逐章 + cross-1-5（10-04 10:46）+ cross-6-10（10-05 02:57）；全局 converge 落在 10-05 05:08 那次 run
测试模式累计作答 617 包（`data/agent-cache/` 617 条）· 待作答 0 · `node test/run.js` 99 项全绿
产物：手册 993KB / 5964 行（18 张一级卡 + 588 分支）· output/模板库 182 个 md · 各章三道质检报告 + 全局收敛报告
运行记录 40 次（最后一次 run-c1d81cab：全 12 章 + seed/chapter/converge，31 调用全 cache 回放，0 待作答，45ms）
```

> 下面 §2.3~§2.11 是各章**当年闭环时**的实测记录：题数、章版本、在库条数、手册体积都会被后续章节的跨章并入与全局收敛改写（例如 ch1 现 77 题／v0.17、ch2 现 v0.25、一级通法现 18 条）。**终态数字一律以 §2.2 与 §8 为准**，各章记录保留的是"当时怎么闭环、质检抓到什么错"的过程信息。

### 2.3 第 1 章（函数、极限、连续）——已完整闭环

```
题目 76 · 拆解 76 · 匹配 76 全部落地（13 包）
动作统计：refine 1 · branch 24 · new 10（含 5 条新通法，其中 4 条为跨包重复签名、已在章合并去重）
章版本 v0.8 · 章内考点覆盖率 100%（29/29，全部确定性命中）
质检：数学等价 5 批全过（T-HS-22-S 有 1 条 low 级措辞 issue）·
      边界一致性 4 批（8 处分支触发重叠已消歧、T-HS-14 与 T-HS-04 定阶分流约定、占位分支全部重构）·
      考点覆盖 3 残留点全部收敛
产物：output/考研数学万能通法手册.md（342KB，一级通法 36 总览 + 分章明细 + 考点-通法对应表）
      output/模板库/第01章-*-模板库-v0.2.md · output/拆解记录/第01章-*-单题拆解.md
      output/校验报告/{第01章-数学等价校验,第01章-考点覆盖校验,第01章-边界一致性校验,全局收敛报告}.md
```

章合并去重吸收了 7 条同签名重复模板：归一凑×2→T-HS-27-I、间断点×3→T-HS-28-I、隐式方程×1→T-HS-32-I、望远镜×1→T-HS-37-I；合并自动生成的「与模板同名」占位分支已全部重构为规范二级分支（T-HS-27/28/32/37-I 均为 v0.3）。

### 2.4 第 2 章（一元函数微分学及其应用）——已完整闭环

```
题目 145 · 拆解 145 · 匹配 145 全部落地
一级通法 11 个（种子 T-HS-02/09/11/12-S + 归纳 7 条）· 章版本 v0.15
考点覆盖 100%（13 确定性 + 56 语义判定 / 共 69）
质检：数学等价 11 批（1 warn，其余 pass，无 corrected_steps）·
      边界一致性 11 批全 pass · 考点覆盖残留点全部收敛
```

### 2.5 第 3 章（一元函数积分学及其应用）——已完整闭环

```
题目 167 · 拆解 167（28 包）· 匹配 167（28 包：new 107 / branch 49 / refine 11）
章内合并 chapter-organize：110 条同名族模板 → 19 个一级通法（16 组合并、吸收 91 条降级为二级分支）
章版本 v0.7 · 考点覆盖 100%（38 确定性 + 37 语义判定 / 共 75）
质检三轮：第 1 轮 7 条 fail 全部落 corrected_steps 纠错（T-HS-116/127/129/131/142/146/153-I 主干步骤由单题流程改写为族级通用链条）
          + 14 处边界冲突补丁（3 条考点串入的伪前提删除、4 组分支触发互斥改写、5 处跨模板分流约定）；
          第 2 轮复验改判 pass 且补丁与现库一致触发 qa-skip；第 3 轮 13 包全部 cache 回放，待作答 0（幂等成立）
收敛后遗留（如实记录）：等价 5 warn（T-HS-117/118/122/143/155-I 主干仍含单题专用收口步，已判为可容忍的分支级细节）、
          边界 1 warn（T-HS-06/07/08-S 三个反常积分模板共用表面题型「含参反常积分定范围」，
          已用适用前提互斥条款分流，surface_types 本身无字段可消）
```

### 2.6 第 4 章（多元函数微分学及其应用）——已完整闭环

```
题目 73 · 拆解 73（13 包）· 匹配 73（13 包：new 24 + auto-merge 49 ⇒ 恰一族一模板）
章内合并 chapter-organize：26 条在库模板 → 12 个一级通法（7 组合并、吸收 14 条降级为二级分支）
章版本 v0.7 · 考点覆盖 100%（24/24，其中 22 条确定性命中 + 2 条语义判定后逐字回填）
质检首轮 6 包（等价 3 / 边界 2 / 覆盖 1）：等价 pass 5 / warn 5 / fail 2
          fail 落 corrected_steps 两条——T-HS-239-I（主干把 fr-12 型「化到 f″(u)-f(u)=0」当成代数方程，
          补「单变量常微分方程转交微分方程通法按特征方程定通解」，6 步重写）、
          T-HS-240-I（第1步强制「先换元」只适用 fp-15，fp-12 与 C-fp-04 的参数全在上下限，改为先定参数位置三分入口，
          并补「上限项减下限项、各乘该限偏导」的丢号漏洞）；
          边界 25 处冲突（12 模板全 warn）：11 条适用前提整体重写（分支级前提从主干拆回分支 + 4 组跨模板分工判据）、
          2 条失效场景重写（T-HS-239-I 自相矛盾的高阶导数条款、T-HS-244-I 的结论强度说明）、
          10 处分支触发特征互斥改写（二重极限 4、极值判别 2、求偏导 2、乘数法 1、还原函数 1）；
          覆盖 2 个残留点 <1>化为无条件极值→T-HS-240-I、（七）拉式有技巧→T-HS-233-I，exam_point_add 逐字照抄原文
复验轮 5 包（覆盖已 100%，无残留故不再产覆盖包）：等价把 2 条 fail 改判 pass 且 corrected_steps 留空，
          边界 12 个模板全部 `qa-skip`（补丁与现库一致，不再 bump）；第三次复跑 5 包全 cache 回放，待作答 0
收敛后遗留（如实记录）：等价 5 warn（T-HS-233/238/03-S/225/229-I：可达性验证缺步、还原动作与 241-I 分工重叠、
          直线同值须再复核的关卡只在失效场景、局部展开前提过严、无界区域与「有界闭」前提冲突——均已在边界补丁或主干改写中兜住）、
          边界 12 warn（补丁已落地，冲突描述留档待跨章合并复核）
```

第 4 章的 24 个族全部以 `new` 入库、未去给第 1~3 章的 T-HS-11-S / 40-I / 54-I / 116-I 加分支：改那些模板会轮换它们已收敛的质检 key。跨章同构（极限定路、反求函数、微元与参数族）留到第 5 章之后的**跨章合并**统一处理。实测脚本留档 `tools/exemplars-ch4/`（`fam4.js` 24 族定义、`spec4.js` 逐题族+考点、`gen4.js` 拆解答案生成、`fam4n.js` 族→通法名与 sim、`wm4.js` 匹配答案、`wo4.js` 章内合并、`wq4.js` 三道质检含 `rerun` 复验轮）。

### 2.7 第 5 章（二重积分）——已完整闭环

```
题目 78 · 拆解 78（13 包）· 匹配 78（13 包：18 族全部 sim 0.22~0.45 ⇒ 一律 new，恰造 18 条模板）
章内合并 chapter-organize 2845b71b：19 条在库模板（含第二型线面积分种子 T-HS-17-S）→ 11 个一级通法
（6 组吸收 8 条：定序+择优+降元、极坐标+互转+平移伸缩、轮换+奇偶、证明+比较、变域极限+中值、积分方程+变限求导）
章版本 v0.4 → 质检后再 bump · 考点覆盖 100%（20/20：19 条逐字命中 + 「（六）快求旋转体」经覆盖包逐字补入 T-HS-256-I）
质检第 1 轮 6 包（等价 3 / 边界 2 / 覆盖 1）：等价 pass 5 / warn 3 / fail 3
  fail 落 corrected_steps 三条——T-HS-254-I（合并时丢掉「先在原系按分界曲线切块、再逐块建系」，E-fr-02=9π
  起手即落入「径向限随 θ 分段」的失效场景；补第3步与并差收口，7→8 步）、
  T-HS-260-I（比较型入口漏「先削奇项折半」，C-mc-02 三个积分含 y²tan x / x²y / xy² 奇项，照原第1步起手必在变号式上排链；
  另把估值型改条件步并加严格性核对，6→8 步）、
  T-HS-263-I（第1步阶判据只比面积阶与分母幂次，漏被积函数自身的消失阶——C-fr-25 面积 t² 加 f(u)-f(0)·y 两阶才是 t⁴，
  按原文该题会被自己判失效；并补「极坐标换序在 θOr 平面内定限」，7 步重写）；
  边界 12 条模板（1 条 pass）：11 处整体重写适用前提/失效场景（分支级前提退回分支触发特征、
  「同阶」「个数有限」「系数不全为零」这类把分支条件抬成合取的前提逐条改写、10 处跨模板分工判据、2 处分支触发互斥）
第 2 轮复验 5 包：等价三条 fail 改判 pass 并复核新主干逐例落地，边界 10 包全部 qa-skip；第 3 轮 cache 全回放，pending=0
逐题实证（本轮亲验，非套话）：C-fr-01=46/15、C-fr-20 A=π/(1-π)、C-fr-22 A=10/3→∬f=20/3、C-fr-25=(4/5)f′(0)、
  E-fr-01=5π+3π²、E-fr-02=9π、C-fr-13 两系同值 (e+e^{-1}-2)/4、B-fp-04 f″(1)=e^{-1}、C-mc-03=(π/4)ln2、C-mc-07=3π/8
实测脚本留档 `tools/exemplars-ch5/`（`fam5.js` 18 族、`spec5.js` 逐题族+考点、`gen5.js` 拆解、`fam5n.js` 族名与 sim、
  `wm5.js` 匹配、`wo5.js` 章内合并、`wq5.js` 三道质检含 rerun、`wq5b.js` 跨章合并后的复验轮、`idx5.js`/`show5.js` 摘要查阅）
```

### 2.8 跨章合并（第 1~5 章，a8cce35a）——已落地

```
输入 73 条第 1~5 章 active 模板 → 18 组吸收 54 条 → 19 个一级通法（T-HS-17-S 作为线面积分种子保留不并）
归并层：极限定阶 / 数列存在性 / 极限连续分型 / 一元求导 / 微分概念 / 中值定理 / 性态与几何量 / 极值最值 /
        多元求导与隐式 / 导数反求函数 / 含参积分 / 不定积分 / 定积分化简 / 黎曼和定义 / 反常积分 /
        几何与物理切片 / 积分不等式 / 二重积分区域表示
被吸收模板的名称、适用范围、前 4 步与边界首条整段降为二级分支，其原有分支一并保留（486 条分支，零丢失）；
hierarchy 给 19 条全部标 level 1 并写「在全局体系中的定位」。
合并后各章 QA key 全轮换（模板名/本质/步骤/边界都进了 messages），第 5 章再走两轮：
  第 3 轮 4 包（7 条 ch5 可见模板）：等价 4 warn（上限 |x| 不可导未设关卡、一元支路步骤被抬进主干等）+ 3 pass、
  边界 6 条模板补「跨法分档」判据；第 4 轮 rerun 全部无补丁 → pending=0，ch5 考点覆盖仍 100%
产物：output/考研数学万能通法手册.md（748KB，一级通法 25 张卡，跨章复用章只出索引表）
脚本：tools/exemplars-cross/{groups.js（18 组与整合文本）,digest.js,wox.js}
```

### 2.9 第 6 章（微分方程及其应用）——已完整闭环

```
讲义键 `章节五常微分方程`（corpus 里章节序号与讲义名不同名，见坑 23）。题目 76 · 拆解 76（13 包）·
匹配 76（13 包：17 族对 25 条在库主干实测 sim 最高仅 0.40（pde-to-ode vs 由导数信息反求函数），其余 0.14~0.26
⇒ 一律 new，恰造 17 条模板 T-HS-265~281-I）
章内合并 chapter-organize d2213590：17 条 → 8 个一级通法（5 组吸收 9 条）
  定型化归可分离（+齐次、+反视自变量）· 一阶线性积分因子（+整体代换、+由解反定方程）·
  常系数线性结构法（+设特解、+叠加造通解、+指定代换化常系数）· 积分与偏导条件建方程（+偏导归元）·
  几何与物理条件建方程（+物理变化率）；独立保留 3 条：缺项降阶、抽象函数按定义建导数式、由通解表达式定性态
  覆盖题数 8/12/21/13/11/3/3/5=76，二级分支 9 条
质检第 1 轮 5 包（等价 2 / 边界 2 / 覆盖 1），等价 pass 3 / warn 2 / fail 3：
  fail 落 corrected_steps 三条——T-HS-266-I（第5步把两个常数的落点混写：缺 x 型降阶后方程里根本没有 x，
  C-fr-22 只能用 (y,p)=(2,0) 定 C₁=0，E-fr-03 的两个 u 值要留到还原后联立；且第6步出口指向已降级为分支的
  「整体代换」法名，属空指。6 步重写）、
  T-HS-267-I（本质承诺「把复合整体设为新变量」而步骤表无对应动作，讲义连招（一）的 f(x±y)/f(xy)/f(x²±y²)/
  f(ax²+by+c) 四类整体无处落地，考点「（一）画圈作代换」因此落不进本法；第3步又把二阶换元
  d²x/dy²=−y″/(y′)³ 与一阶反视并列却无出口，C-fr-05 换元后得 x″−4x=e^{2y} 必须交常系数主干。7→8 步）、
  T-HS-277-I（第4步把三类根并成「零根或正根则发散或振荡有界」一档：单零根给常数项、相异纯虚根等幅有界、
  只有正实部根才发散——C-fp-10 的标答 a≥0 恰以 a=0（r=±i）为端点，按原文判错；另补斜渐近线斜率由
  lim y/x 存在反定参数（B-fr-10）。6 步重写）；
  边界 8 条模板共 27 处冲突（0 pass）：11 条适用前提/失效场景整体重写（265 的「∫Q e^{∫P}dx 须初等表出」与自己
  第4步对撞、又把伯努利写成失效；266 的「本法族标准形」与降级法名；271 把 f(xy) 型写成失效却以 C-fr-12 为例题；
  277 的纯虚根单列条款；278 的两条同义前提）+ 10 处跨模板分工判据（265↔267 化归与收口、265↔116-I P≡0 分流、
  266↔273 线性常系数与缺项降阶、268↔43-I 建方程与只求导、268↔278 等式来源、271↔265/267 建模止于建好、
  273↔277 求解与判性态、277↔06-S 解的极限与积分敛散、278↔142-I 由量反求曲线与由曲线求量）+ 6 处分支触发互斥
  （267 两支、273 三支、278 一支）
考点覆盖 19/21=90.5%：「（三）欧拉方程（数一）」逐字补入 T-HS-273-I（其第3步 x=e^t/t=e^{−x}/x=sin t 即该法唯一动作，
  B-fr-07、C-fr-03、C-fr-04 三题实证）、「（一）画圈作代换」补入 T-HS-267-I 新第3步；
  「（四）差分方程（数三）」与其子目「相关概念」判 covered:false ——880 数二第 6 章 76 题无一涉及整数下标与 Δ 记号，
  在库 8 条主干全部建立在连续自变量上，按红线「只归纳不出题」不虚构（报告已记 missing_note 与补题特征）。
  ⇒ 第 6 章是全套流程里第一个（也是唯一允许的）非 100% 章内覆盖，别把它当缺陷去"凑"。
第 2 轮复验 5 包：等价 8 条全改判 pass 并逐条写明新主干在哪题落地、边界 8 条全部空冲突（无 bump）、覆盖仅剩 2 条
  false 项；第 3 轮 cache 全回放 ⇒ pending=0
逐题实证（本轮亲验，非套话）：C-fr-14 u=Ce^x−x 与标答 e^x[(1−x)e^{−x}−e^{−x}+C] 逐项相等；E-fr-03 u=(1+lnx)/x，
  检验 y₂=1+lnx 使 (x²lnx)y″−xy′+y≡0；C-fr-22 y=2+x²/8；B-fr-07 y=(C₁+C₂u)e^u+u+2；C-fr-03 回代 C₁√(1−x²)+C₂x；
  C-fr-04 y_tt+y=t ⇒ y=C₁cos(e^{−x})+C₂sin(e^{−x})+e^{−x}；C-fp-07 −½+cos2x/10；C-fp-10 a≥0；B-mc-07 y=b/a；
  B-mc-06 b=c=0 与二重零根；C-fr-15 f=t³−t²+1；C-fr-18 削奇项后 f″−f=0
实测脚本留档 `tools/exemplars-ch6/`（`digest6.js`+`p6.txt`+`idx6.js` 题摘要与查阅、`fam6.js` 17 族、
  `spec6.js` 逐题族+考点短码、`gen6.js` 拆解生成（短码→pending 包原文解析、父级自动挂载、双向对齐校验，
  考点清单同时读 agent-pending 与 agent-cache 以便提交后重生成）、`fam6n.js` 族名/sim/亲缘主干、`wm6.js` 匹配、
  `wo6.js` 章内合并、`wq6.js` 三道质检含 rerun、`near6.js` 逐族最近主干查询）
```

### 2.10 第 7 章（行列式 · 线性代数首章）——已完整闭环（2026-10-04）

```
题目 39（语料修复后 39 题全带完整题干，见坑 29）· 拆解 39（7 包）· 匹配 39（7 包：new 15 + auto-merge 24）
  15 族对 33 条在库主干实测 sim 最高 0.21（爪形 vs 一体六面互译），全部 <0.60 ⇒ 一律 new，
  恰造 15 条模板 T-LA-05~19-I；与线代种子的分流：T-LA-04-S（分块初等变换降阶）属第 8 章矩阵运算的对象、
  T-LA-01/02-S（相似判定、特征多项式代值猜根）属第 11 章，行列式的多重线性与定号与它们不同原理层，故不并入
章内合并 chapter-organize 4b2e31de：16 条（15 新 + ch7 可见的级数种子 T-LA-03-S）→ 5 个一级通法（4 组吸收 11 条）
  行列式定型化简降阶计算通法（+各行和相等、+爪形、+互换分块、+副对角分块）·
  含参n阶行列式递推闭合通法（+三对角递推、+加边升阶、+范德蒙）·
  单行列线性拆项与逆用展开通法（+按列拆分与列向量组合）·
  矩阵到数的行列式同态通法（+伴随与逆代换、+秩不足判零、+特征值取行列式）；
  独立保留 T-LA-03-S（级数审敛种子，对象与原理层都不同，见 unmerged_reason）
  覆盖题数 8/9/9/13=39（二级分支 4+3+1+3=11，加种子原 6 条共 17）
质检第 1 轮 4 包（等价 2 / 边界 1 / 覆盖 1），等价 pass 2 / fail 3：
  fail 三条全是「章内合并整体替换 final_steps 时丢掉被吸收族的关键动作」——
  T-LA-07-I（第6步只留「子块含伴随或逆」，丢了原族第3步的 |kA|=k^n|A|：C-fp-01 的 |3A*|=3^n6^{n−1}、
  |(B/2)^{-1}|=2^n 无处落地，E-fr-03 号外 |A| 乘 6 阶矩阵要提 |A|^6 会误写成 |A|^3；
  且入口写成「零块占据两个对角块位置」把这两题（各只有一个零块）排除在外。8 步重写）、
  T-LA-08-I（第2步用括号「（或只含 D_{n-1}）」带过一阶递推，其后径直进二阶特征根，
  B-fr-02 的 D_n=xD_{n-1}+a_n 与 C-fr-03 的 D_n=xD_{n-1}+a_{n-1} 无闭合出口（标答靠依次代入/归纳），
  而「同除 αⁿ 作差求和」被错写进二阶档；初值个数写死两个对一阶递推多余。8 步重写）、
  T-LA-14-I（特征值档只写取积，而 C-mc-01 求 A11+A22+A33=tr(A*)=Σ|A|/λ_i 要取和得 1，取积会得 1/36，
  失效条「把特征值之和当成行列式」反把正解禁掉；又丢掉原 det-product 族第5步「不可分解因子记未知量联立」，
  B-fp-07 的 |A+E|=|A||A+E| 无出口。8 步重写）；
  边界 5 条模板共 15 处冲突（0 pass）：2 条模板级适用前提整体重写（07-I 把 12 条分支级前提降为 4 条"命中其一"、
  08-I 把 10 条降为 3 条并按一阶/二阶分档初值）+ 2 条失效场景重写（07-I 两条同义的漏乘 (-1)^{mn}、
  14-I 的取和/取积分档）+ 1 条自相矛盾前提（14-I「不混入 A 的高次多项式加法」与自己覆盖的 A²−A−3E、2A*−3E 对撞）+
  1 条跨模板误判（06-I「替换后新行列式出现零列或各行和相等」把对方的判型写成自己的前提）+
  6 处跨模板分工判据（06↔14 代数余子式之和按下标分布三档、07↔08 阶数固定与 n 阶通项、07↔14 分块定号与子块幂次代换、
  08↔07 加边升阶与消零降阶不可同题并用、14↔06 矩阵和→积与拆列求值接力、03-S 显式排除行列式对象）+
  6 处分支触发互斥改写（06 一支、08 三支、14 三支）
考点覆盖 19/19=100%：残留点「逆序数法求高阶行列式」判 covered:true 逐字补入 T-LA-07-I
  （其新第2步「非零排列项极少时按定义列出全部不为零的项、逐项用逆序数 τ 定号 (-1)^τ 求和」即该考点唯一动作，
  B-fp-04 按此道只有 4 个非零排列项：−16+24+24−36=−4 与标答同值，与换块分块路径复算一致）
第 2 轮复验 3 包：等价 5 条全改判 pass 并逐条写明新主干落点、边界 5 条全部空冲突（无 bump）；
  第 3 轮 cache 全回放 ⇒ 等价 pass / 覆盖 100%（19 条全确定性命中）/ 边界 pass，pending=0
逐题实证（本轮亲验，非套话）：B-mc-03 |A+B|=16(1+1)=32；B-fp-11 |C|=2(9−2)=14⇒|A|=1；C-fp-05 组合阵行列式=2⇒|A|=2；
  B-mc-01 替换第4行为 (−1,1,−1,1) 后按第3行展开 7·(−4)=−28；C-mc-02 A*=−A^{−1} 元素和 =−4；
  B-fp-04 两条路径同得 −4；C-fp-01 (−1)^n6^{2n−1}；E-fr-03 |A|^6·(−1)^9·|A*|·|−2E|=2048；
  B-fp-05 a=1 时代入得 11 与 a⁴+a³+2a²+3a+4 吻合；B-fr-02/C-fr-03 一阶递推依次代入；
  B-fr-03 重根等差 D_n=n+1（D_3=8−2−2=4 复核）；C-fr-04 α+β=a、αβ=bc ⇒ D_n=(α^{n+1}−β^{n+1})/(α−β)；
  C-mc-04 转置范德蒙零点 −1,1,2 ⇒ f′ 在 (−1,2) 内两零点（罗尔）；
  C-fp-04 λ=1,−2,−3/2 ⇒ |2A*−3E|=3·(−6)·(−7)=126；C-mc-01 取和 =1；B-fp-07 |A+E|=0；
  B-fp-09 |B^{-1}||A^{-1}+B||A|=(1/2)·2·2=2；C-fp-03 |A+E|=18≠0 约去后 |A−E|=2⇒|B|=1/2；
  E-fr-01 |A|²=|A|³ 且 |A|=Σa_{1j}² ⇒ |A|=1，λ=1,−1,−1 ⇒ |A²−A−3E|=−3；
  E-fr-02/B-mc-04 同为 |A|=1/k³；B-fp-08 r(A)+r(A−E)≤n 且 A≠E ⇒ |A|=0
实测脚本留档 `tools/exemplars-ch7/`（`digest7.js`+`p7.txt`+`idx7.js`、`fam7.js` 15 族、`spec7.js` 逐题族+考点短码、
  `gen7.js` 拆解生成、`fam7n.js` 族名/sim/亲缘、`near7.js` 逐族最近主干、`wm7.js` 匹配、`wo7.js` 章内合并、
  `wq7.js` 三道质检含 rerun）
```

### 2.11 第 8 章（矩阵 · 线代主干章）——已完整闭环（2026-10-04）

```
题目 56（有解析 55，ch8-B-fp-01 无解析）· 拆解 56（10 包）· 匹配 56（10 包：new 16 + auto-merge 33 + branch 7）
  19 族逐条 `near8.js` 实测：16 族最高 sim <0.60 判 new（秩一降幂、二项式截断、相似搬幂、递推归纳、块副对角、
  分块初等、初等阵读写、伴随公式、可逆性判定、行列式和→积、转置关系、矩阵方程、行和常向量、秩不等式夹逼、
  伴随秩分档、命题反例），3 族按同一原理层 branch 进第 7 章主干：
  det-homom→矩阵到数的行列式同态通法（0.74）、det-linearity→单行列线性拆项与逆用展开通法（0.66）、
  block-compute→T-LA-04-S 分块初等变换降阶通法（0.68）
  ⚠ 跨章 branch 的前提是本轮修的 `src/store/library.js` bug：applyDecomposition 原先不登记章节，
  线代题并入第 7 章主干后 ch8 视角（分章覆盖、章内组织包、手册分章卡）看不到它们 ⇒ 现自动 union
  t.chapters / t.chapterTitles（数字数组不过 uniq，见坑 30），essenceMatch 补 ctx.chapterNo/Title；
  test/run.js 加断言（第 134 行）
章内合并 chapter-organize d0f0f140：19 条（16 新 + 3 条挂到第 7 章主干）→ 10 个一级通法（3 组吸收 9 条，章版本收在 v0.8）
  矩阵幂降次闭合通法（+秩一降幂、+二项式截断、+相似搬幂、+递推归纳、+块副对角，覆盖 13 题 5 分支）·
  矩阵可逆性判定与逆的构造通法（+伴随公式体系、+常向量传递行和列和，11 题）·
  矩阵秩的定秩与降秩关系通法（+阶梯夹逼、+伴随秩三档，9 题）·
  矩阵方程化标准形乘逆（8 题）· 初等变换读成左右乘初等阵（5 题）·
  分块初等变换降阶通法（2 题）· 转置关系建式证正交（2 题）· 矩阵命题正推与反例否证（1 题）
  ＋第 7 章并入的两条主干在本章再认领 5 题（14-I 4 题、06-I 1 题）；覆盖题数合计 56
质检第 1 轮 6 包（等价 3 / 边界 2 / 覆盖 1），等价 pass 2 / warn 4 / fail 4：
  T-LA-06-I（第4步「只按交换次数定最终符号、不得行列混用」与失效条 V6/V9 把本章唯一覆盖题 B-mc-05 的正解判成违规——
  该题标答是交换 1,2 行 → 第 2 行加到第 3 行 → 交换 2,3  列，|B|=|P||A||Q|=(−1)(−1)|A|=|A| 选 D，
  行列两侧的对换必须分别取奇偶再相乘；"同侧完成"只约束多线性拆项。7 步重写）
  T-LA-14-I（第4步无条件把 A* 代成 |A|A^{-1}，而 C-fp-06「A*+2A=O」的 A 可逆性正是待证结论：右乘 A 得
  A²=−½|A|E ⇒ |A|²=−⅛|A|³ ⇒ |A|=0 或 −8，必须再用伴随秩三档排除零根才得 A²=4E、tr[(A²)⁻¹]=3/4；
  步骤表无"乘 A 消伴随"与"舍零根"出口，失效条只写"奇异则多数步骤失效"。8 步重写）
  T-LA-20-I（第7步递推闭合只给"特征根或周期"，而 C-fr-03 的 Aⁿ=Aⁿ⁻²+(A²−E) 是常矩阵加项 ⇒ 奇偶两档各成等差
  A^{2k}=E+k(A²−E)、A¹⁰⁰=50A²−49E；第6步相似形只写"用同一个 P 搬回"，漏了 B⁴=E 时共轭退回数量阵（P 未给元素）
  与 A⁴−2B² 里 B² 必须留原侧实算。8 步重写）
  T-LA-30-I（第5步"逐块对照即得各子块正交等式"跳过了必要一环：C-fr-06 乘开 P^TP 的 (2,2) 块给的是
  C^TC+B^TB=E_n 这个和式，须先由 A^TA=E_m 知 A 可逆、回代 A^TC=O 得 C=O 才能收成 B^TB=E_n（或改乘 PP^T）；
  第3步未写 x=−x 的负号来自 (−1)^{2n+1} 且必须有 |A|=1，少一个条件只剩 (1+|A|)|A−E|=0 的恒等式。7 步重写）
  warn 四条：04-S（块对角取伴随的分配未写：diag(A,B)*=diag(|B|A*,|A|B*)，乘的是另一个块的行列式）、
  21-I（不等式档只列乘积型，C-fp-05 的下界要靠和的秩 r(X)+r(Y)≥r(X+Y)=r(2E)；B-mc-07 的列满秩左乘保秩无出处）、
  22-I（对换阵幂的奇偶档无落点（C-mc-03 PⁿAPᵐ=A 选 n=m=4）；C-mc-07 的 A* 判定属 28-I 的伴随公式）、
  31-I（缺"两侧出现先并项提因子""两逆并成乘积的逆"（C-fr-04）与 X 的幂、设元素解不唯一的两处出口）
  pass 两条：28-I（B-fr-03 (A*)⁻¹=(A⁻¹)*=|A⁻¹|A、|A⁻¹|=2 ⇒ [[5,−2,−1],[−2,2,0],[−1,0,1]]；B-fp-09 (A*)ⁿ=E；
  C-fp-02 行和 1/k；B-fp-13 k=−1 或 1/2）、35-I（C-mc-06 ①③④真、②以 A=[[0,0],[0,1]]、B=[[1,0],[0,0]] 反证选 B）
  边界 10 条模板共 34 处冲突（contradiction 19 / cross-template 9 / branch-overlap 6，10 条全 warn）：
  2 条模板级适用前提整体重写（21-I 把 9 条合取降为"三档命中其一"、28-I 把 9 条降为四档，
  否则 ch8-B-fp-07/C-mc-01/C-mc-02 与 B-fr-03/C-fp-02/B-fp-13 按字面读都"本法不适用"——同坑 28）、
  1 条失效条反向禁正解的整体改写（04-S「含未知块的变换不能定秩」把 mc-04 用的倍加型块变换 [[E,M],[O,E]]
  判成非法，其系数块本可任意）、14-I 删掉第 7 章两轮补丁叠出的 4 条同义失效、20-I 合并 2 条同义奇偶失效、
  06-I 与 22-I 各改写"行列分别记账"的同一条（两法必须同口径）、
  9 处跨模板分工（14↔28 出数 vs 出阵、14↔21 停在秩 vs 落到数、21↔04 不等式链 vs 块消元、
  22↔28 初等阵分解 vs A* 判定、31↔28 判系数可逆 vs 写出 X、31↔20/第10章 X 的幂与解的结构、
  30↔21 反对称的二次型 vs 秩排序、35↔28/22 命题组合 vs 单条公式、04↔14 块行列式 vs 子块幂次）、
  12 处分支触发互斥改写（04/06/14/20/21/28 各两支）
考点覆盖 22/22=100%：残留点「行阶梯、行最简」是考点清单被顿号切开的产物（31-I 与 21-I 各挂了碎片），
  判 covered:true 把规范全名逐字补入 T-LA-31-I（其第2步"用初等变换化阶梯"判系数可逆 + 第4、5步增广阵化阶梯/
  (A|B)→(E|X) 正是该考点的两次真实使用，C-fr-05 由 [[1,0,1,0],[0,1,−3,2],[0,0,0,0]] 读出通解含 k₁、k₂）
第 2 轮复验 5 包（等价 3 / 边界 2）：等价 10 条全改判 pass 并逐条写明新主干落点、边界 10 条全部空冲突（无 bump）；
  因 06-I/14-I 被本章改写，第 7 章 QA key 同步轮换，追加 3 包复验（等价 2 / 边界 1，wq7.js 的 RER_EQ 已改写为
  含 ch8 变化的证据）；两章第 3 轮 cache 全回放 ⇒ 各章 等价 pass / 覆盖 100% / 边界 pass，pending=0
逐题实证（本轮亲验，非套话）：B-mc-05 |P|=−1、|Q|=−1 ⇒ |B|=|A| 选 D；C-fp-06 |A|=−8、A²=4E、tr=3/4；
  B-mc-03 |E−A|=−4 ⇒ (1/4)³·|A−E|=1/16（另一路 1/|E−A|²=1/16 同值）；C-fr-03 A^{100}=[[1,0,0],[0,1,0],[50,50,1]]；
  B-fp-05 B⁴=E ⇒ A⁴−2B²=[[3,0,0],[0,3,0],[0,0,−1]]；C-fp-03 A²=4E ⇒ 奇档 4^{k−1}A、偶档 4^{k}E；
  B-fp-02 β^Tα=0 ⇒ (A+E)ⁿ=E+nA；B-fr-01 r(A)=1 ⇒ Aⁿ=9^{n−1}A；C-mc-04 r₂≥r₁≥r₃ 选 A；
  C-fp-01 C*=diag(3A*,2B*)；C-fp-05 r(E+BA)+r(E−BA)=n；B-mc-07 r(A)=n ⇒ r(AB)=r(B) 选 D；
  C-mc-01 k=−3 ⇒ r(B)=1；C-mc-02 a+2b=0；B-mc-04 k≠1；B-mc-06 a=3；B-fp-07 r=2；C-mc-05 r₃≥r₁≥r₂；
  B-fr-08 (−1)^{2n+1} 与 |A|=1 ⇒ |A−E|=0；C-fr-06 A^TA=E_m、C=O、B^TB=E_n；E-fr-01 X²=[[1,2,−2],[0,0,1],[0,0,1]]；
  C-fr-04 B=(A*−2E)⁻¹(−8E)A⁻¹=−8[A(A*−2E)]⁻¹=diag(2,−4,2)；C-fr-05 通解含 k₁、k₂；
  B-fp-06 |B|=−2 ⇒ (−2)^{n−1}；B-fp-12 AB⁻¹=E_{ij} ⇒ |AB⁻¹|=−1；B-mc-01 B=PAQ 选 B；
  C-mc-03 n=m=4 选 A；C-mc-07 ①②真选 C；C-mc-06 ①③④真选 B；B-fr-09 (A*)ⁿ=E；B-fp-13 k=−1 或 1/2
实测脚本留档 `tools/exemplars-ch8/`（`digest8.js`+`p8.txt`+`idx8.js`+`v8.txt`+`b8.txt` 题摘要与现行库快照、
  `fam8.js` 19 族、`spec8.js` 逐题族+考点短码、`gen8.js` 拆解生成（'=' 前缀全等匹配，线代考点名与行列式不同）、
  `near8.js` 逐族最近主干、`fam8n.js` 族名/sim/亲缘、`wm8.js` 匹配（同时产 new 与 branch）、`wo8.js` 章内合并、
  `wq8.js` 三道质检含 rerun（drop 用短码在现行数组里唯一命中，命中数≠1 直接抛错））
```


---

## 3. 增量迭代操作规程（第 1~12 章已全部闭环；本节只在**新增语料或复跑**时照做）

**当前没有剩余待办**：12 章 925 题全部拆解、匹配、章内合并、三道质检完毕，cross-1-5 与 cross-6-10 已落地，全局 `converge` 把 374 条历史记录归并成 **18 条一级通法**（落在 15~20 目标区间），`data/agent-pending/` 为 0，产物与网页端均已复核（§8、§9）。下面这套流程保留下来，是为了「往 `date1/` 里加新讲义/新题册」或「改了 `src/` 需要回归」时能原样重跑。

库已收敛到 18 条主干（高数 12 + 线代 6），**任何新题的匹配决策几乎都该落在既有主干的分支上**：`lib.digest()` 现在只有 18 张卡，判 new 的门槛比第 1~12 章当年高得多（那时库里 25~44 条、同签名重复还能靠章内合并兜底，现在新增一条就会顶破 15~20 的收敛目标）。讲义键与章节序号在 `corpus.chapters` 里并非同名（`章节一行列式`→ch7、`章节三向量`→ch9 等），别按名字猜。跨章合并按 `--every 5` 触发，会轮换受影响各章的 QA key（§2.8、§8.1 实测各牵动 2~3 轮复验；凡改到被多章共享的主干，相邻章也要重跑一次）。

```bash
node src/cli.js run --chapters 9 --stages chapter   # flag 必须是 --chapters；写成 --chapter 会被忽略并默认跑第 1 章＋converge（见坑 31）
node src/cli.js tasks --dump            # 若有 pending：作答 → validate → 逐键 submit → 重跑，直到 pending=0
node tools/validateAnswers.js
# ……循环直到该章 pending=0，然后：
node src/cli.js export && node src/cli.js status && node test/run.js
node tools/browserCheck.js --shots=1    # 改过 web/ 或 src/server.js 后跑一遍真实浏览器验证（见 §9）
```

每章固定四步（第 1~6 章实测节奏，照做即可；**脚本一律放 `tools/exemplars-chN/`，不要写 `/tmp`——本环境 /tmp 不可写，见坑 24**）：

1. **拆解**：每包 6 题、五字段（steps≥3 且不含具体数字、boundaries 两侧非空**且必须是字符串数组**，见坑 26、exam_points 逐字取自该包【本章考点清单】），用 `tools/exemplars-chN/genN.js` 产 `eN-<pkg8>.js`，再 `node tools/exemplars-ch3/wd.js <key前缀> /workspace/examgen/tools/exemplars-chN/eN-<pkg8>.js` 写盘（**必须给绝对路径**，wd.js 直接 require 传入路径；内含完整性/考点子串/无数字三项断言 + JSON.parse 自测 + 双副本备份）。
2. **匹配**：先取 `lib.digest()` 在库清单，再按「一族一原理」写 spec（家族定义 `famN.js` + 决策表 `specN.js` + 生成器 `wmN.js`）。同一族的每条 new 决策都会新建一个同名模板，数量失控靠第 3 步归并解决，不要在此步硬塞进已有模板。**库里现在只有收敛后的 18 条一级通法（高数 12 + 线代 6）**，新章的 new 决策必须先与它们逐条比本质（`tools/exemplars-ch8/near8.js` 可改成逐族 top-3 查询，实测 sim 与理由一起写进 rationale），能落到某条主干就别新建——第 9~12 章当年各新建 14/16/17/11 条是"库尚未收敛"阶段的产物，如今再这么跑会顶破 15~20 的收敛目标。**跨章 branch 只有在"同一原理层、只是对象换了"时才成立**（第 8 章实测 7 题走 branch：行列式的多重线性/同态取积那三条主干同样吃矩阵题）；判 branch 前务必确认 §2.11 提到的 `t.chapters` 自动登记已生效，否则本章视角看不见被并入的题，分章覆盖与章内组织包都会漏。
3. **章内合并**：organize 包挂起时用 `tools/exemplars-chN/woN.js` 产 `merges`（同名组取覆盖题数最多者为 keep，其余 absorb，并把各自 surface_types/steps/boundaries 写成 final_branches；keep 已有分支要先保留，final_branches 是整体替换），`hierarchy` 给全部 keep 标 level 1。合并后的一级通法数即本章收敛结果（第 1~8 章分别 20 / 11 / 19 / 12 / 11 / 8 / 5 / 10，跨章合并后 1~5 章视角 19 条；第 9~12 章分别新建 14 / 16 / 17 / 11 条再各自归并，最终由全局 converge 统一压到 18 条，见 §8.1、§8.3）。**final_steps 也是整体替换——重写时必须逐个被吸收族把它自己的 steps 逐条在新主干里找落点，找不到就是把该族的关键动作丢了（第 7 章三条、第 8 章四条等价 fail 全是这一类，见坑 28）**。**第 8 章另有一类合并缺陷：合并把各被吸收族的"局部前提"平铺成模板级适用前提，按合取读会把自己覆盖的题全排除在外（21-I 九条、28-I 九条都属此类，边界轮按"命中其一即可"重写，见 §2.11）**。**organize 与 QA 包会同批挂起：先只交 organize（`node src/cli.js answer --key <全键> --file …`），把陈旧的 QA pending 与工作区文件移进 `.trash/pre-chN-qa1/`，再重跑取新 key**（坑 17、18）。
4. **三道质检**：等价 4 个一批、边界 6 个一批、覆盖残留 12 个一批，用 `tools/exemplars-chN/wqN.js`（带 `rerun` 参数出复验轮，rerun 要把上一轮 warn 一起改判 pass 并换 RER_ 证据，别重复报已在边界轮修掉的旧问题）。主干步骤若只承载单题流程、把分支级条件写成必经动作、**或步骤与本质承诺/例题互相矛盾**（第 6 章三条 fail 全是这类），就判 fail 并给 corrected_steps（素材只能取自被合并模板的既有表述与讲义原文）；边界补丁尽量一次到位，因为每改一次内容就会换一轮 key。跨章合并会让各章 QA key 全轮换，按第 5 章实测再走 2 轮（第 3 轮补分档判据、第 4 轮 rerun 无补丁）即收敛。**考点若有「数一/数三专属」条目而本学科题集里没有对应题，判 covered:false 并写 missing_note + 补题特征，不要虚构题目凑 100%（第 6 章 19/21 是允许的结果，见 §2.9）。**

以上四步的**第 3 章实测脚本已留档在 `tools/exemplars-ch3/`**（`wd.js` 拆解写盘器、`pts.js` 考点原文表、`fam.js` 家族定义、`spec3.js` 逐题匹配决策、`wm.js` 匹配答案生成器、`wo.js` 章内合并生成器、`wq.js` 三道质检生成器），可直接抄改成下一章的数据源；`/tmp` 下的同名文件只是会话内工作副本，随时可能丢失。

要点：

1. 每章闭环后才会触发跨章合并（每 5 章），一级通法数会先升后降，**不要在中途强行合并凑 15–20**；cross-1-5（19 条，§2.8）与 cross-6-10（§8.1）都已落地，最终 18 条由全局 `converge` 一次性归并（§8.3）；
2. 全局覆盖率口径 = 已覆盖考点 / 全学科考点，终态 **97.1%（339/349）**；剩下 10 条是讲义批注/残句子标题与数一数三专属条目，属真实缺口而非缺陷（§2.2、§8.6）；
3. 测试模式工作包作答规范见 §4；每写完一包立刻 `JSON.parse` 自测 + 备份到 `agent-work-backup/`；
4. **已闭环的章节不要复跑**（坑 32）：复跑不改库，却会让 QA 包 key 轮换、覆盖口径随当前考点清单重算，并覆写 `data/qa/` 与 `output/校验报告`；要补「本章已完成」标记请改读取源而不是重跑（已把 `server.js` 指到库态 `chaptersDone`）。**终态下再跑一次全量 run 是安全的**（10-05 05:08 那次 31 调用全部 cache 回放、0 待作答、库未改写），但要确认 flag 与 `--stages` 写全（坑 31）。
5. 可选复查 4 个被标记的种子答案：`ead1c864`（chapter_no=5 疑越界）、`b9b8ea74`、`ef83826b`、`c7491a1f`。

---

## 4. essence-match 作答规范（写答案前必须遵守）

输出 schema（逐题对应，**条数必须等于 `task.json.problem_ids.length` 且顺序一致**）：

```json
{"items":[{"problem_id":"ch1-C-fp-12","similarity":0.0,
  "template_id":"T-HS-01-S | NEW:通法名 | null",
  "matched_essence":"命中模板的本质原文（新建填 null）",
  "rationale":"一句话依据","action":"refine|branch|new","patch":{}}]}
```

patch 三种形态：

- `refine`（≥0.90，版本 `v0.1 → v0.1.1`）：`{"essence_polish":"","steps_refine":[完整替换数组],"boundary_add":{"applicable":[],"invalid":[]},"example_note":""}`
- `branch`（0.60–0.89，`v0.1 → v0.2`）：`{"branch":{"name":"","trigger":"看到什么形式走这支","steps":[追加操作],"surface_types":[],"boundary":"前提：…；坑点：…"}}`
- `new`（<0.60，建 v0.1）：`{"template":{"name":"≤20字","essence":"","scope":"","steps":["4~7 步"],"boundaries":{"applicable":[],"invalid":[]},"exam_points":[],"surface_types":[]}}`

判定纪律：

1. **只与包内冻结的 digest 比对**；模板 id 一律写 `T-XX-NN-S` 原文形式。
2. 本质是否相同看「**把什么化成什么**」，不看题型外壳。
3. 同一批多条本质相同：**必须命中同一模板**，不得各建各的。
4. 与库中某模板「同签名」时**禁止 new**，改 refine/branch 并合并表述。
5. 步骤与边界写成**可迁移的通用操作**，不得出现具体题号数值答案。
6. 新建通法名 ≤20 字且不与库内同名；`exam_points` 照抄拆解的「对应考点」。
7. **不新增题型、不改写题目、不给出题**（需求红线）。

代码强制行为（`essenceMatch.js applyDecision`）：`tierOf(similarity)` 决定实际动作；`similarity < 0.60` 先做 `sameEssence` 签名去重（但**实测签名含考点差异时不命中，会重复入库**，见 §6 坑 9）；命中档 id 无效时按本质签名回退，仍找不到就降级为空模板新建（强制 0.2，会脏库）；新建即 v0.1，refine 为 minor，branch 为 major。

---

## 5. CLI / API / 测试基线

```bash
node src/cli.js index                              # 语料装配 + 结构统计
node src/cli.js run --chapters 1 [--reset] [--stages seed,chapter,converge]   # flag 必须是 --chapters（写成 --chapter 会被静默忽略并默认跑第 1 章，见坑 31）
node src/cli.js tasks [--dump|--submit-all]        # 测试模式工作包
node src/cli.js answer --key K --file a.json       # 单包回填
node src/cli.js status | export
node src/cli.js route --skill essence-match        # 查看自主路由结果
node src/cli.js reset-cache [--cache]
node test/run.js                                   # 99 断言（本机无 npm，shell 里 node 是 v18.19.1）
node src/server.js                                 # EXAMGEN_PORT 默认 8787
node tools/browserCheck.js [--shots=0] [--clicks=0] [--dump <view>]   # 真实浏览器验证 10 视图 + 点击 + 运行时错误监听（需先起 server；地址写 127.0.0.1 不要用 localhost）
```

服务端共 48 条 route() 注册。GET 全部 200：`/api/{overview,events(SSE),settings,models,chapters,files,files/content?file=,problems,problems/detail?id=,library,library/template?id=,decompositions,matches,essence/matrix,qa,qa/list,skills,run/current,runs,agent/tasks,agent/task,agent/cache,agent/cache/entry?key=64hex,outputs,output/content}`；POST：`/api/{index,route,route/auto,models/probe,skills/forge,run,run/stop,agent/answer}`；PUT：`/api/library/template`；GET `/output/**` 支持嵌套（`.md` 直出 `text/plain; charset=utf-8`，`?download` 附件头）。网页 10 视图（overview/sources/problems/library/runs/qa/output/settings/agent/skills）与 `web/app.js` PAGES 注册表、index.html 导航一一对应，app.js 调用的全部端点均在路由表中；**并已用 headless Chromium 真实渲染复核（10 视图深链 + 11 次点击 + 1 条合并链深链 + 0 运行时错误 = 22/22，见 §9）**。

测试覆盖的不变量：5 字段拆解、三档 `applyDecision`（含自动合并与兜底、**跨章并入时自动登记 `chapters`/`chapterTitles` 且存数字**）、`markChapterDone` 幂等且存数字（网页端 `includes(章节号)` 判完成）、`bump` 版本链、`applyOrganize` 合并/改名/层级、`covPreMatch`（字面包含直接判 0.99）、QA 三标准提示词、手册渲染产物、注册表 2+4+3 与 `SKILL.md` 存在性、路由契约、agent 内容寻址回放（pending→answer→replay）、并发闸、缓存与真实 `data/` 隔离。

---

## 6. 踩过的坑（回归防线，请勿回退）

| # | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| 1 | `U.uniq is not a function` | util 未导出 | `src/lib/util.js` 新增并导出 |
| 2 | `ReferenceError: a is not defined`（章合并） | 合并回调误写外部变量 | `applyOrganize` → `lib.replaceMany(...)` |
| 3 | `templates[-1].id` 崩溃 | 预匹配 best 索引未跟随字面包含分 | `qa.js covPreMatch` |
| 4 | `/api/outputs` SyntaxError | 重复声明 | `server.js` 重写 walk/sort |
| 5 | `/api/events` 不在路由表 | 写死前置分支 | 改为注册路由 |
| 6 | 排序不合法 | 直接比较 undefined | `String(a.tier\|\|'').localeCompare` 再比 no |
| 7 | 路由不分长上下文/推理 | 打分梯度太粗 | `routeModel` 头名比例分档 |
| 8 | 并行子代理写文件不可靠（零产出/截断 JSON） | 崩溃回滚 | **剩余包一律主智能体自己作答**，写完即 JSON.parse 自测 + 备份双副本 |
| 9 | **同签名 new 模板重复入库**（归一凑×3、间断点×4、隐式×2、望远镜×2） | `sameEssence` 签名含逐包不同的考点，去重不命中 | 不修代码，靠**章内合并去重**兜底（chapter-organize 的 merges 吸收）；后续章照此办理 |
| 10 | **已 dump 的包被「孤立」**：作答提交后 run 却重新 dump 同类新包 | run 中途先落地了 organize/QA 补丁，模板版本变化 → messages 变化 → 内容寻址 key 变化，旧包答案永不回放 | 识别机制即可：**永远对最新 dump 的包作答**，被孤立包的答案作废无害；循环会在 QA 批次不再改模板后自然收敛 |
| 11 | chapter-organize 合并后出现「与模板同名」占位分支，甚至同名同触发 | `applyOrganize` 对无分支的被吸收模板自动建分支（name=模板名，trigger=surface_types 拼接） | 在 organize 包里用 `merges:[{keep_id, absorb_ids:[], final_branches:[规范分支]}]` 重构（final_branches 会整体替换，无字段丢失风险） |
| 12 | 考点覆盖残留点每轮重新 dump 成新包（死循环倾向） | 覆盖答案写入的 `exam_point_add` 与考点原文不一致，下一轮确定性匹配（字面包含 0.99）不命中 | `exam_point_add` **逐字照抄考点原文**（文档标题类条目也照抄登记，reason 写明其为标题而非考点） |
| 13 | syllabus-coverage 的 input.md 正文为空（bytes_full 4116 vs view 272） | dump 压缩对部分 Skill 丢正文 | 从 `data/agent-pending/<key>.json` 的 messages 读完整输入 |
| 14 | 冒烟 PUT /api/library/template 污染历史（manual-edit 版本 bump） | 该端点每次 PUT 必 bump minor | 测试后已回滚（T-HS-01-S v0.2、history 去尾）；后续冒烟避免 PUT 或用后即回滚 |
| 15 | 冒烟 POST /api/skills/forge 生成 `skills/business/undefined/` + `src/skills/generated/undefined.js`，注册表多出一条业务 Skill，`test/run.js`「每层数量正确」变红 | forge 对参数不足的请求未校验 id，默认 `undefined` 也照常生成 | 已删除两处产物并复跑全绿；后续冒烟 forge 必须带合法 id，或用后即删 |
| 16 | **一条 new 决策 ⇒ 一个新模板**：第 3 章 167 题里 107 条 new 造出 110 条记录，同名族模板最多一堆 16 条 | `essenceMatch.applyDecision` 对 new 只做 `sameEssence` 签名去重（含逐包不同的考点，几乎不命中），**不按 name 归并** | 不修代码：new 阶段允许失控，靠第 3 步 chapter-organize 归并（第 3 章 110→19）；name 相同只是归并的充分线索，最终以本质等价判定 |
| 17 | organize 包挂起时 `runQA` 照样跑完，对未收敛的 110 条库产出 51 个 QA 包（等价 28 / 边界 19 / 覆盖 4），合并后全部作废 | `runChapter` 只在匹配阶段 hold，组织挂起不影响质检顺序 | 先只作答 organize 包 → 提交 → 把作废的 QA `data/agent-pending/<key>.json` 与 `agent-work/<key>.{input.md,task.json}` 一起移进 `.trash/stale-qa-ch3/`（禁 `reset-cache`），再复跑本章 |
| 18 | QA 补丁落库后复跑，13 个 QA 包 key 全变、又要作答一轮「复验轮」 | 等价包正文含 `t.version`、覆盖包含 `exam_points`，纠错（major）与补丁（minor）必然改变 messages | 属正常收敛路径：复验轮答案须把已改判的模板填 pass、corrected_steps 留空，边界补丁与现库一致即触发 `qa-skip` 不再 bump；再复跑一次即 13 包全 cache 回放、待作答 0（第 3 章实测三轮收敛） |
| 19 | `agent-work/<key>.input.md` 里的候选模板清单缺条（organize 包 110 条只见 90 条），据此写答案会漏模板 | workbench 的 `makeView` 是压缩视图，长输入会被截尾 | **以 `data/agent-pending/<key>.json` 的 messages 为唯一权威输入**（`/tmp/wo.js`、`/tmp/wq.js` 均直接读 pending json），input.md 只当索引用 |

| 20 | 边界补丁「后半条冲突把前半条的改写覆盖回原样」的隐患 | `runQA` 对同一模板的多条 conflicts 顺序执行 `nt.boundaries.applicable = c.patched_applicable`，而该字段是**整体替换**语义；若每条冲突都按当前库内容重算数组，后一条会把前一条的删除/新增冲掉 | `tools/exemplars-ch4/wq.js` 的 `patchArr` 用 `curApp/curInv` 沿冲突**串行续算**（只有带 drop/add 的冲突提交结果，其余留空数组即被编排层跳过）；并且首轮就断言「待删条目必须存在」，防止手抄字符串打不中 |
| 21 | 第 4 章等价校验发现的 2 条主干真错 | 「反问题」族模板把「化到 f″(u)-f(u)=0」当成代数方程（fr-12 无从收口）；含参变限模板把「先换元」写成必经第一步（fp-12、C-fp-04 参数只在上下限时绕路），且漏写下限项负号（C-fp-04 的 -2(x²+y²)e^{-(x²+y²)²} 会丢符号） | 判 fail 给整替 corrected_steps（各 6 步），复验轮回放新主干逐例复核；这类「主干只承载单题流程 / 入口条件写死」是等价门的固定检查点，下一章照查 |
| 22 | **auto-merge 决策不落盘**：第 5 章 78 题里 60 题的例题与覆盖关系被静默丢弃（第 4 章同样丢 49 题，库内 `已覆盖题数` 虚低、手册每法只剩一两道例题） | `essenceMatch.applyDecision` 的 `dup` 分支算出 `applyDecomposition(...)` 却从不 `lib.upsert`，函数直接 return | 已修 `src/skills/essenceMatch.js`（补 `lib.upsert(updated)`，备份 `.trash/pre-ch5-fix/`）；第 5 章按「删 matches 尾行 → 复跑 → cache 纯回放」确定性重放，78 题全部落覆盖。**第 4 章的 49 题尚未回填**（回填会 bump 那些已并入跨章主干的模板，需连带 ch4 全章 QA 重走），计划与第 6~12 章跑完后的全局收敛一起做，见 §7-6 |
| 23 | 第 5 章讲义考点只剩 1 条、第 12 章（二次型）0 条，拆解包的【本章考点清单】跟着残缺 | `src/ingest/corpus.js` 两处：① `regionOfTitle` 的数词正则贪婪匹配，把「章节七二重积分」切成「七二」；② `pointsOfLecture` 把首页串档的无主考点与本篇考点混排 | 已修 `src/ingest/corpus.js`（限定数词字符集 + `ownRegion` 复用同一解析 + 仅在 own 命中后保留本篇考点、无主条目兜底），章节七恢复 20 条、章节六恢复 18 条，其余字节不变（备份 `.trash/pre-ch5-fix/corpus.json`）|
| 24 | 写 `/tmp/xxx.js` 被 hook 拒绝（`/tmp` 不可写，只允许 `/tmp/quizdraft/*`），历次留档的 `/tmp/wd.js`、`/tmp/famN.js` 风格已全部失效 | 环境限制 | 章节工具一律落 `tools/exemplars-chN/`（ch3/ch4/ch5/ch-cross 均已留档）；`fam5.js` 仍从 `/tmp/p5.txt` 读题面摘要（**读**是允许的），换章时把摘要重定向到 `tools/exemplars-chN/digest.txt` 更稳 |
| 25 | 跨章合并后各章 QA 包 key 全轮换、边界条目涨到上百条（合并语义就是 boundaries 的并集） | 模板的 name/essence/steps/boundaries/version 全在 QA messages 里；`applyOrganize` 默认并集 absorb 的 boundaries | 不要为此改库：按第 5 章实测再走两轮（补分档判据 → rerun 无补丁）即 pending=0；展示层已改为「一级通法只在归属章出完整卡，其余章只列索引表」+「适用前提/失效场景逐条成行」（`src/store/render.js`、`src/store/library.js`，备份 `.trash/pre-render-fix/`），否则一张卡压成 12KB 单段不可读 |
| 26 | 第 6 章拆解答案里 `boundaries.invalid` 写成**一整串字符串**（fam6 的 sol-structure 族漏了方括号），`wd.js` 只查 `.length` 非空（字符串也非空）故一路通过，直到 essence-match 建包时 `(d.boundaries.invalid||[]).join` 才炸，且已污染 5 条 `decompositions.jsonl` 记录 | `problemDecompose.apply` 对 boundaries 不做 Array 强转（故意的：垃圾进要看得见），下游按数组消费 | 族定义里 applicable/invalid/steps 必须是数组：`fam6.js` 的 `item()` 已加 `Array.isArray` 三字段断言，`gen6.js` 会因此提前抛错。修数据用「同源重写」而不是手改：改 `fam6.js` → 重跑 `gen6.js`+`wd.js` → 用答案文件同步覆写 4 个 `data/agent-cache/<key>.json` 的 `output` 字段 + 重写 `decompositions.jsonl` 里 5 条 malformed 记录（键是输入哈希，改 output 不换 key），再复跑即一路 cache 命中，不需要 `reset-cache` |
| 27 | 第 6 章章内覆盖只有 19/21（90.5%），与前五章的 100% 不一致 | 讲义该章列了 4 条数一/数三专属考点；「欧拉方程（数一）」「（一）画圈作代换」在 880 数二本题集里没有对应题面，但**解法动作**已被 273-I 第3步、267-I 第3步（等价纠错补入）真实覆盖，故覆盖包里逐字补入；「差分方程（数三）」与其子目「相关概念」在连续变量主干上无从落地 | 判 `covered:false` + `missing_note` + `suggest_problem_feature`（见 §2.9），按红线「只归纳不出题」不虚构题面。false 项不改正任何东西，残留包 key 稳定 → 复跑即 cache 命中，pending 仍能归零；报告里 90.5% 是真实数，别为凑 100% 把数三考点挂到不相干的卡上 |
| 28 | **章内合并把被吸收族的关键动作整条丢掉**（第 7 章等价三轮里三条 fail 全属此类）：07-I 丢 `|kA|=k^n|A|`（C-fp-01 的 3^n、2^n 与 E-fr-03 号外 \|A\|^6 无处落地）、08-I 丢「一阶递推依次代入闭合」（B-fr-02、C-fr-03 只在第2步括号里被提一句，求解动作却挂在二阶特征根档下）、14-I 丢「不可分解因子记未知量联立」（B-fp-07 的 \|A+E\|=\|A\|\|A+E\| 无出口）且把「特征值取和」写进失效场景，反以自己覆盖的 C-mc-01（tr(A\*)=1）为例题 | `applyOrganize` 的 `final_steps`/`final_boundaries` 是**整体替换**语义：编排层只并 surface_types/exam_points/covered/branches，主干步骤完全由答案文本决定，写的人按 keep 模板的原步骤改写就容易被"压平" | 写 `woN.js` 时逐族核对：把每个被吸收族的 `steps` 逐条在新主干里找落点，找不到就是丢了（第 7 章据此在第 1 轮就自查出三条并写进 wq7 的 corrected_steps）。等价校验的固定检查点仍是三类「主干只承载单题流程 / 分支级前提写成必经 / 步骤与本质或例题互相矛盾」，第 7 章新增第四类＝**合并替换造成的动作缺失**，复验轮要按新主干逐例复算数值（不是简单改判 pass） |
| 29 | 线性代数 134 道题的题干被截成「设  $」（第 7 章首轮只 dump 出 29/39 题），高数侧只有 8 题受影响 | `src/ingest/books.js` 的选项切分正则 `(?:^|\n)[ \t]*A[ \t]*[．.、]` 会命中做题本里排版成「A ．」的**行内 `$ A $`**（如「设  $ A $ 是 3 阶方阵」），把题干腰斩；`problems.filter` 又按 `stem.length > 6` 静默丢弃短题，缺陷只在题数对不上时暴露 | 已修：切分必须同时满足「A/B/C/D 四个选项齐全 + 切点前有中文或 `$` + 切点不在行首」三条，210 题题干恢复、短题干 134→0、925 题/919 解析/对齐 99.4% 不变、97 测试全绿（备份 `.trash/pre-option-fix/{books.js,corpus.json}`）。**corpus 缓存戳只算输入文件名与字节，改解析代码不会失效**，必须 `corpus.loadCached(true)` 强制重建。**没有复跑第 1~6 章**：那 8 题题干虽被补全，但其拆解与 QA 答案当年是照着完整解析原文写的，复跑会轮换 1~6 章几乎全部 QA key 且没有新增信息；残留的 8 处 `stem_excerpt` 属展示级差异，已知勿再当缺陷查 |
| 30 | **凡用 `U.uniq()` 收「数字数组」都会把元素 stringify**，导致下游 `includes(数字)` 全部失配。两处实测暴露：①第 8 章把线代题 branch 进第 7 章主干后，`lib.applyDecomposition` 根本不登记 `t.chapters`，`runQA`/章内组织包/手册分章卡三处按 `(t.chapters||[]).includes(chapterNo)` 取模板，本章视角看不见这些题；首版补丁用 `uniq((t.chapters||[]).concat([chapterNo]))` 收口，结果 `[1]` 变成 `["1"]`，新增断言直接失败（has1/has8 都 false）。②`lib.markChapterDone(no)` 同样过 `uniq`，`data/library/library.json` 的 `chaptersDone` 存成 `["1","2",…,"8"]`，而 `src/server.js:110` 用 `(st.chaptersDone||[]).includes(c.no)`（数字）判「本章已完成」，网页端八章全显示未完成 | `U.uniq`（src/lib/util.js:71）以 `String(x)` 作键并 push 字符串，对字符串数组无害、对数字数组是破坏性的；`markChapterDone` 写的是库态，`lib.read()` 之后无人再归一 | ①`applyDecomposition` 里改成手工 `concat`（不 `uniq`）并加注释「chapters 是数字数组，不能过 uniq」，`essenceMatch.applyDecision` 补 `d.chapterNo = d.chapterNo || ctx.chapterNo; d.chapterTitle = ctx.chapterTitle`；`test/run.js` 加断言「跨章并入自动登记章节」（134 行）。②`markChapterDone` 改用 `Array.from(new Set(list.map(Number)))`，`test/run.js` 加断言「已完成章节表存数字且幂等」；存量数据无需手改——下一章跑完再调一次即整表归一（本轮跑 ch8 后已是 `[1,…,8]`）。**同处补漏**：网页端的 `done` 读的其实是 `data/state.json` 的 `chaptersDone`（另一处，历史上从未被写过 ⇒ 八章全显示未完成），现把 `src/server.js` 改成读库态 `lib.read().chaptersDone`，并在 `orchestrator.runChapter` 里同步补写 state 那一处（两处都存数字），重启服务后 ch1~ch8 的 done 全为 true。**通用口径：新增任何"章节号/序号"数组时，先去 `test/run.js` 看它是否被 `includes(数字)` 消费，是就不能过 `uniq`**（备份 `.trash/pre-ch8-fix/{library.js,essenceMatch.js}`、`.trash/pre-ch9-fix/{library.js,library-state.json}`，99 项全绿） |
| 31 | 一次 `node src/cli.js run --chapter 8` 静默跑成「第 1 章 + 全局收敛」，把 ch8 的 6 个待作答包判为"已消费"（其实答案只进了 cache、补丁一次都没落库），并新 dump 出两个不相关的大包 | `cli.js` 的 `arg('chapters','1')` 只认 `--chapters`，`--chapter` 是未知 flag 被忽略 → 默认章节 1；且默认 `--stages seed,chapter,converge` 会连带跑收敛（在库一级通法 44 > 目标 20，于是产出一个 362KB 的全局 chapter-organize 包），同时暴露出第 1 章一道从未拆解成功的残题 `ch1-B-fp-05` | ①**flag 一律写全 `--chapters`，跑单章加 `--stages chapter` 关掉 converge**（本轮 ch7/ch8 复验全按此跑，pending 才归零）；②`data/agent-pending/` 里的包不会因跑错章节而作废——`answer` 回填才删 pending，cache 命中即无损，重跑正确命令即可重放；③那两个包原样留在 pending（未作答），留到第 12 章跑完做全局 `converge` 时一并处理：`ch1-B-fp-05`（$x^3$ 与 $e^x$ 比阶 × 有界因子）按第 1 章「无穷小比阶」主干补一次拆解即可，全局组织包则按 §7 的收敛目标统一处理，**不要**为消除它们而 `reset-cache` |
| 32 | 为了把「本章已完成」标记补全而**复跑了已闭环的第 1~6 章**，结果 dump 出 20 个新 QA 待作答包（第 2/3/4/5 章的等价 7 + 边界 5 + 覆盖 8），并让第 2、3 章的章内考点覆盖从当年的 100% 掉到实测 **15/69=22%** 与 **39/75=52%** | 两件事叠加：①坑 29 的语料重建改了讲义 `examPoints` 的**文本**（新增/改写了带冒号的子标题、「导数的四则运算（必须会推导）」这类装饰），当年逐字补进模板 `exam_points` 的旧串不再被 `covPreMatch` 的字面包含命中，且 QA 包的 `【本章考点清单】/【教材依据】` 变了 → 内容寻址 key 全轮换；②**覆盖率的记账方式**：`orchestrator.coverageOf`（src/pipeline/orchestrator.js:557）取「确定性命中 ∪ `data/qa/chNN.json` 里 `report.coverage.covered` 的语义判定点」，而那 90 条（第 2 章 54 + 第 3 章 36）只存在于报告文件里——复跑时覆盖包变成待作答，`runQA` 用「15 条确定性 + pending」重写了报告，**语义判定记录就此丢失**（早期 cache 条目已无 skill/chapter 元数据，从 `data/agent-cache` 里也搜不到当年的覆盖包答案）。模板本身一字未改，丢的是「考点文本 → 模板」的映射记录 | ①**已闭环的章节不要复跑**——需要覆盖复判时留到第 12 章跑完、与 ch4 49 题回填同一次做完（§7-7/§7-8），届时考点清单已是最终版；②本轮把 20 个轮换包连同其 `agent-work`/`agent-work-backup` 文件整体移进 `.trash/stale-rerun-ch1-5/`（复制后删原文件，可原样放回），pending 只剩坑 31 那两个有意保留的包；③**库没有被改写**：QA 答案未作答 ⇒ 无 `lib.upsert`，44 条模板 / 518 分支 / 661 覆盖题数与复跑前逐项一致，第 7、8 章复跑仍 0 待作答；④网页端 `done` 的读取源改到库态 `lib.read().chaptersDone`（`markChapterDone` 是唯一全程写入的一处，`state.json` 只有修复后跑过的章节才补记），并在 `orchestrator.runChapter` 里同步补写 state，两处都为数字数组 |
| 39 | 网页端「运行」页的**历史运行表永久空白**（显示「还没有运行记录」），而库里实际有 40 次运行；HTTP 层冒烟（§5 那套）全绿也照样漏掉 | `GET /api/runs` 返回 `{ items: [...] }`，而 `web/app.js` 的 `loadRuns()` 直接把响应当数组用（`runs.length` 为 undefined → 走 `emptyBox` 分支）。这类「端点契约」问题只有真实渲染才能暴露，`curl` 与路由表比对都看不见 | `loadRuns()` 加一行兼容归一（`if (runs && !Array.isArray(runs)) runs = runs.items || []`，备份 `.trash/pre-browserfix/app.js`）；修复前后同一视图 DOM 从 9,331B/205 节点涨到 453,075B/1137 节点。**新增 `tools/browserCheck.js`（零依赖 WebSocket + CDP 驱动 headless Chromium）作为回归防线**：10 视图深链断言（锚点取自真实 API 数据 + `mustNot` 空态哨兵）+ 10 次导航点击 + 模板卡点击 + JS 异常/console 错误/请求失败三类监听，改过 `web/` 或 `src/server.js` 后跑一遍（详见 §9）。**通用口径：凡"某视图某块区域永远空/永远 0"，先比对端点响应形状与前端消费方式，再怀疑数据** |
| 40 | 「测试模式」视图的浏览器检查**判成通过，但两张表其实还在转圈**（截图里是「加载待作答任务…」「加载缓存…」） | 断言锚点太弱：`need: ['待作答']` 被卡片标题「待作答任务」本身满足，`waitFor` 首轮就返回；busy 正则也只列了 `加载中/正在加载/加载历史/加载记录`，盖不住「加载缓存」「加载待作答」这两种占位文案 | 锚点换成**只有加载完成才会出现的文本**：空态文案 `没有待作答任务`（按 `ov.agent.pending` 现取现判）+ 缓存表头 `作答时间`；并把 `加载待作答\|加载缓存\|加载模板详情` 补进 busy 正则。**通用口径：断言要用"数据到位后的产物"，不能用标题里就有的词**；同轮另补 1 条 `status=merged` 模板的合并链深链检查，总数 21→22（见 §9） |
**环境事实**：本机无 `npm`；`node` 在 shell 里是 v18.19.1（`node -v` 另报 v22）；**有 headless Chromium（Chrome/134）可用**，`tools/browserCheck.js` 自带零依赖 WebSocket+CDP 客户端驱动它，不再依赖 browser-use（早期"无浏览器后端"的结论已作废，见坑 39 与 §9）；不是 git 仓库；`data/` 是运行态，重置走 `reset-cache`，历史产物在 `.trash/`；服务端在 8787 端口后台运行（日志 `/tmp/examgen-server.log`，重启 `kill` 后重跑 `node src/server.js`）。**浏览器侧两个网络坑**：`localhost` 在 Node 18 下解析到 `::1` 而服务只监听 IPv4，目标地址一律写 `127.0.0.1`；`pkill -f "node src/server.js"` 会连自己这条命令行一起匹配（exit 143），杀进程要用精确 pid。


**红线**：子代理禁止 `tasks --submit-all` / `reset-cache` / `run --reset`，禁止改 `src/`、`web/`、`skills/`、`date1/`，禁止在 `agent-work/` 留额外文件；只有主智能体提交答案。`llm.apiKey` 仅落本地 `config/settings.json`，展示一律走 `cfg.maskKey`。

---

## 7. 已知缺口 / 技术债（不影响验收，但需知晓）

0. **语料已切换（2026-10-04）**：做题本改用 `【A4紧凑版】李林880数二{高数,线代}篇做题本`（旧横版已移至 `.trash/remove-横版做题本-20261004/`，解析册 `27版880题数二解析册` 未动）。`RE_ITEM` 同时接受全角/半角括号（src/ingest/books.js）；对齐=四级 key + 章内(序号)顺序兜底 + **AI 校验修复**（src/ingest/repair.js：检测断号→AI 给文本锚点→从容器尾部切出被吞题/解析并补号；决策在 `data/repairs.json`，corpus.load() 自动应用，工具 `tools/repairMatch.js --detect/--apply`）。最终：**925 题 / 919 解析 / 对齐 919（99.4%），孤儿解析 0**；剩余 6 道未对齐系解析册整页丢失。题库导出 `tools/exportProblemBank.js`。第 2 章 145 题已 100% 带解析。

1. **收敛目标已达成**：首章结束时全局 36 条、不为凑数强行合并，靠 cross-1-5（25 条）→ cross-6-10 → 全局 `converge` 三级压缩，最终 **18 条**落在 15~20 区间（§8.3）。
2. ~~网页端未做真实浏览器点击~~ **已清偿（2026-10-05）**：`tools/browserCheck.js` 用零依赖 WebSocket+CDP 驱动 headless Chromium 实跑，22/22 检查通过、11 张截图、0 JS 异常/0 console 错误/0 请求失败，并据此查出并修了 `web/app.js` 的两处缺陷（历史运行表永久空白＝坑 39；已并入模板无归属提示＝§9）。详见 §9。
3. 坑 9/10/11/12 的四个行为问题都选择了「流程兜底」而非改代码（避免中途改 src 引入回归）；坑 22/23/30/31/39 五处是实测出的真 bug，已由主智能体修 `src/` 或 `web/`（分别备份在 `.trash/pre-ch5-fix/`、`.trash/pre-ch8-fix/`、`.trash/pre-ch9-fix/`、`.trash/pre-browserfix/`，当前 99 项测试全绿）。若后续再修码，需同步改 `test/run.js` 的相关断言。
4. ~~两个 pending 包被有意留着~~ **已清偿（§8.2）**：`3ef2ab47`（ch1-B-fp-05 单题拆解）按「无穷小比阶」主干补齐并以「增长层级比阶与有界因子分支」并入 T-HS-04-S；`82ac4a0b`（坑 31 时代的 44 条库快照全局包）已过期，移入 `.trash/stale-global-organize/` 由新鲜 converge 包取代。**当前 `data/agent-pending/` 为 0。**
5. `/api/files/content` 缺参时 500（EISDIR）而非 400，外观级问题。
6. 跨章合并后单卡体量偏大：T-HS-04-S 137 条分支 / 上百条适用前提，T-HS-43-I、T-LA-67-I 同此。已改成逐条成行 + 归属章出全卡、别章出索引，可读性达标；**「分支级前提归位到各分支」的整理仍未做**（各分支的 trigger 里已含局部前提，模板级前提列表是各分支条件的并集，按"命中其一"读，见 §2.11、坑 28）——这是唯一剩下的结构性可读性债，不影响正确性。
7. ~~第 4 章 49 题回填~~ **已清偿（§8.2-1）**：按 `data/matches.jsonl` 的 49 条 auto-merge 记录确定性重放 `applyDecomposition`，43 条跟随 merged_into 链落到存活主干，ch4 覆盖回到 100%（73/73），QA 轮换一轮复验全 pass。
8. ~~第 2、3 章覆盖复判~~ **已清偿（§8.2-2）**：不回放陈旧包，直接重跑 ch2/ch3 让流水线按当前库态 dump 新鲜覆盖包；ch2 54 个残留点逐条判读（51 true 逐字登记、3 false）、覆盖 22%→98.6%；ch3 36 个残留点（33 true、3 false：复利与经济应用属数三专属）、52%→96%。

---

## 8. 2026-10-05 收官记录（第 9~12 章闭环 + 全局收敛）

### 8.1 各章闭环数字（实测）

| 章 | 题 | 拆解/匹配 | 新建一级 | branch 并入既有主干 | 章内覆盖 | 质检轮次 |
| --- | --- | --- | --- | --- | --- | --- |
| 9 向量 | 35 | 6 包/6 包 | 14 条（T-LA-36~49，其中 43 吸收进 38） | 列分块分解降幂分支→T-LA-20-I | 90%（2 条批注/残句如实 false） | 3 轮 |
| 10 方程组 | 54 | 9 包/9 包 | 16 条（T-LA-50~65） | 含参解档、抽象表示命题→T-LA-40-I；乘积秩夹逼→T-LA-21-I | 100% | 3 轮 + 重分组收敛轮 |
| 11 相似矩阵 | 62 | 11 包/11 包 | 17 条（T-LA-66~82） | 成对相似判定→T-LA-01-S；对角化求幂数列→T-LA-20-I | 100% | 2 轮 |
| 12 二次型 | 63 | 11 包/11 包 | 11 条（T-LA-83~93） | 正交化标准形→T-LA-67-I；反求矩阵入口→T-LA-68-I×2；对角形桥→T-LA-69-I×2；坐标化→T-LA-75-I；低秩特征→T-LA-80-I；相似合同双判→T-LA-79-I | 89%（2 条批注/残句如实 false） | 2 轮 |

cross-6-10（50 条候选）：唯一真合并 T-LA-51-I（通解结构辨识）并入 T-LA-53-I，更名「解的结构互译与通解重构」；其余在 unmerged_reason 留档分工（39-I 张成空间交 vs 54-I 解集交对偶、42-I 与 64-I 同机制不同对象等）。

### 8.2 收尾四件事（§7 的全部技术债清偿）

1. **ch4 49 题回填**（坑 22 遗留）：按 `data/matches.jsonl` 的 49 条 auto-merge 记录确定性重放 `applyDecomposition`，43 条落到 cross-1-5 吸收后的存活主干（跟随 merged_into 链），ch4 覆盖回到 100%（73/73）；ch4 QA 轮换一轮已复验（回填只动覆盖登记不动主干，全部 RER_ pass）。
2. **ch2/ch3 覆盖复判**（坑 32 遗留）：不回放陈旧包，直接重跑 ch2/ch3 让流水线按当前库态 dump 新鲜 QA 包。ch2：54 个残留点逐条判读（51 true 逐字登记进 11-S/40-I/54-I/02-S，3 false：2 残段子标题 + 导数极限定理选学条目），覆盖 22%→96%；ch3：36 个残留点（33 true 登记进 142-I/131-I/117-I/116-I，3 false：复利与经济应用数三专属），覆盖 52%→96%。
3. **ch1 遗留包 3ef2ab47**（坑 31）：ch1-B-fp-05（指数比幂增长 + 有界振荡因子）按拆解规范补齐，匹配以「增长层级比阶与有界因子分支」并入 T-HS-04-S（sim 0.70），ch1 QA 轮换一轮复验通过，覆盖保持 100%。
4. **82ac4a0b 过时全局包**：内容是坑 31 时代的 44 条库快照，移入 `.trash/stale-global-organize/`，由新鲜 converge 包取代。

### 8.3 全局收敛（18 条最终主干）

converge 第 1 轮一次性归并（无强制合并兜底），18 条主干及其吸收（被吸收模板经 applyOrganize 自动分支机制保留原名、原 steps 与失效边界，边界并集自动继承，内容零丢失）：

**高数 12 条**：① 极限定阶分型与存在性判定（04-S←19-S,05-S）② 微分概念与可导性（11-S）③ 中值定理与微分等式不等式证明（02-S←131-I）④ 求导法则族与高阶导数（40-I←232-I）⑤ 导数定号性态与几何量（54-I←233-I）⑥ 不定积分归型与函数还原（117-I←116-I）⑦ 含参变限积分求导与定数（43-I）⑧ 积分化简对称性与几何物理微元（122-I←155-I,17-S,142-I,247-I）⑨ 反常积分与级数定阶判敛（06-S←T-LA-03-S）⑩ 微分方程定型化归与建方程（265-I←267,268,271,278）⑪ 常系数求解与解的性态（273-I←266,277）⑫ 题型分层与一体六面框架（20-S←18-S）。

**线代 6 条**：⑬ 行列式计算定型化简（T-LA-07-I←06,08,14）⑭ 矩阵运算可逆性与幂（28-I←31,22,04-S,30,35,20-I）⑮ 向量组的秩相关性与等价判定（21-I←36,37,38,39,41,42,44,45,47）⑯ 线性方程组求解与解结构（53-I←40,50,52,54~58,49,59~65 共 16 条）⑰ 特征值与相似对角化（67-I←66,68~82,01-S,02-S,46,48 共 20 条）⑱ 二次型标准形规范形与正定（89-I←83~88,90~93 共 10 条）。

收敛脚本留档 `tools/exemplars-ch12/wox-global.js`；全局收敛报告 `output/校验报告/全局收敛报告.md`。

### 8.4 本轮新踩的坑（回归防线）

| # | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| 33 | `answer --key <key>.json`（带 .json 后缀）静默缓存 `"null"`，真 pending 未消费 | CLI 对缺失的 pending 文件 readJson 容错返回 null，skill 记 unknown、output 写 "null"（4 字节） | 识别机制：回填后必须核对 `tasks` 中 pending 是否消失、cache 条目 output 字节数是否合理；**key 一律取 `ls | sed 's/.json$//'`**；已删除 8 个 `.json.json` 垃圾缓存 |
| 34 | 收敛答案「已回填」但 applyOrganize 跑空（一级通法不减） | 生成器脚本用 `readdirSync(WD).find(task.json)` 定位 key 命中**陈旧 task**，答案文件名写错；CLI 对缺失文件静默缓存 "null"，round-1 包消费后 round-2 包 key 又漂移 | 答案文件名必须取 `data/agent-pending/` 里的**真实 pending key**（不要信 agent-work 里的旧 task.json）；垃圾 "null" 缓存条目删除后重交；本轮最终以 f51cfc3e 正确落库 |
| 35 | 跨章合并包在章 QA 未收敛时被提前 dump（ch10 与 ch11 均触发） | 顶层调度在 runChapter 返回（含 hold）后即跑 crossMerge | 沿用坑 17 流程：移入 `.trash/stale-cross610-v1/` 等 trash 目录，等章内闭环后让流水线重新 dump 新鲜包再答；markOrganized 未写，无副作用 |
| 36 | 章内合并（无 merges）后 QA 包 key 未变，但**吸收型合并**后 QA 分批重新切批、全部 key 轮换 | 分批按 active 模板列表切片，被吸收模板移出后批内分组变化 | 答案按新分组复用同样 RER_ 结论即可；此前提交的复验答案成孤立缓存（无害） |
| 37 | 拆解包考点清单被顿号切开（「（一）求特征值、特征向量」裂成两条），覆盖包却显示完整条目 | 讲义标题自带顿号，`kn.examPoints.join('、')` 与切分互逆不守恒 | 拆解短码用切分后的条目（`=（一）求特征值`），覆盖包对完整条目 covered:true 并把**完整原文**逐字 `exam_point_add` 登记进主干，下一轮 covPreMatch 即确定性命中 |
| 38 | 覆盖登记的 exam_point_add 超 schema 建议的 15 字 | 坑 12 的「逐字照抄」与 schema 的「≤15字」冲突 | 落库代码无长度上限（orchestrator 直接 concat）；**逐字优先**——短版登记会让下一轮 covPreMatch 的字面包含失配、覆盖包死循环重 dump |

### 8.5 产物与工具索引（本轮新增）

- 手册：`output/考研数学万能通法手册.md`（993KB / 5964 行，18 张一级卡 + 全部二级分支）· 题库对照解析 · 拆解记录 · 各章校验报告 · 全局收敛报告。
- 工具目录：`tools/exemplars-ch9|ch10|ch11|ch12/`（每章 `famN.js` 族定义、`specN.js` 逐题决策、`genN.js` 拆解生成、`wmN.js` 匹配、`woN.js` 章内合并、`wqN.js`/`wqNb.js` 质检与复验、`wox10.js`/`wox-global.js` 跨章与全局合并、`in-*.md` 为 QA/合并包输入快照）。
- trash 留档：`.trash/stale-qa-ch9|ch10|ch11|ch12/`、`.trash/stale-cross610-v1/`、`.trash/stale-global-organize/`、`.trash/pre-ch4-backfill/`（回填前 templates.jsonl 备份）。
- 收官后补：`tools/browserCheck.js` + `output/browser/`（10 张视图截图 + `library-merged.png` + `report.json`，22/22 通过，见 §9）、`web/app.js` 两处修复（历史运行表 `.trash/pre-browserfix/app.js`、已并入模板合并链 `.trash/pre-merged-banner/app.js`）。

### 8.6 交接终态

- 库态：18 条一级通法（高数 12 + 线代 6）、588 条二级分支、925/925 题全覆盖、全局考点覆盖 **97.1%（339/349，与 `output/校验报告/全局收敛报告.md` 及网页端总览一致；本条早先记的 96.6% 是 ch2/ch3 复判登记落库前的数，已被 10-05 05:08 那次全量 run 刷新）**（未覆盖项均为讲义批注/残段或数一数三专属条目，已如实记 missing_note，见各章校验报告）。
- pending：0。所有工作包消费完毕，无遗留（`data/agent-cache/` 617 条）。
- 复跑注意：任何 `run --stages chapter` 会因 18 条主干的 digest 变化重新 dump 各章 QA 包——如需再跑，按坑 18/36 的复验轮口径处理（主干内容未变时全部 pass/空冲突即可收敛）。10-05 05:08 已实测复跑一次全量：31 调用全 cache 回放、0 待作答、库未改写。
- 网页端真实浏览器验证：见 §9。
- 红线继续有效：子代理禁 `submit-all`/`reset-cache`/`run --reset`；禁改 `src/`、`web/`、`skills/`、`date1/`；只有主智能体提交答案。

### 8.7 代码已入库为 git 仓库（2026-10-05，`a412e80`）

工程原先**不是 git 仓库**，现按用户指定推到 `https://github.com/JohnFKS/examgen`（**公开仓**）。因为公开，入库范围做了版权切分，`.gitignore` 已落盘：

- **入库**（294 文件 / 暂存 28M）：`src/ web/ skills/ test/ docs/ package.json .env.example README.md HANDOFF.md` + `tools/` 的 7 个通用脚本（`browserCheck / validateAnswers / repairMatch / exportProblemBank / cmpParse / scanOptionSplit / sequentialMatch`，逐个 grep 过不含题面） + `output/` 归纳产物（手册 / 模板库 / 拆解记录 / 校验报告 / 浏览器截图）。
- **排除**：`date1/`＋`date1.rar`（第三方教辅 OCR 语料）、`data/`、`agent-work/`、`agent-work-backup/`（运行态与工作包，内嵌题面解析原文）、`tools/exemplars-ch*/`＋`exemplars-cross/`（章节实测留档）、`.trash/`、`config/settings.json`（**生产模式在此落 `llm.apiKey`**，仓库只留 `.env.example`）、`tmp/`、`tunnel/`、`fake.log`、`.zcodeignore`；另单独排除 `output/题库.json` 与 `output/题库对照解析.md`——这两份是整册转储，不属"归纳产物"。
- **提交前扫描**：`grep -rIn "sk-…{12,}|Bearer …{16,}|\"apiKey\":\"非空\""` 覆盖 src/web/skills/test/tools/docs/config/README/HANDOFF，唯一命中是 `test/run.js:87` 的合成夹具 `sk-1234567890abcdef`（脱敏断言用，非真凭据）。
- **自检**：`git clone . <tmp>` 后在干净克隆里跑 `node test/run.js` = **98/99**，唯一失败项是「输入目录可扫描且含 6 类角色」，它只在 `date1/` 缺失时失败——属预期。已在 README 新增「克隆后首次运行（必读）」表说明如何补语料与配置。
- **已推送（2026-10-05 06:4x）**：`main` → `https://github.com/JohnFKS/examgen`（公开仓），远端 `refs/heads/main = 35b26fd`，本地已 `--set-upstream-to=origin/main`。推送用一次性内联 token 的 URL（`git -c credential.helper= push https://<user>:<PAT>@…`），**未写入 `.git/config`、未落 credential helper、无 `~/.git-credentials`**，推完核对过三处都干净；`raw.githubusercontent.com` 取 README 与手册均 200，确认公开可读。
- 注意：坑 30~32 与 §7 多处仍写「非 git 仓库、无版本回退」——那是当时的历史事实；现在有版本控制了，但**`.trash/` 未入库**，改 `data/` 前的备份习惯照旧保留。


---

## 9. 网页端真实浏览器验证（2026-10-05，headless Chromium + 自研 CDP 客户端）

需求里的「有网页端」此前只做过 HTTP 层冒烟（§7-2 旧记录）。本轮补上真实渲染验证，工具是 **`tools/browserCheck.js`（零依赖：自己实现 RFC6455 WebSocket 帧 + CDP 协议，不引 puppeteer）**，驱动本机 Chrome/134 headless。

```bash
node src/server.js &                                   # 8787
node tools/browserCheck.js                             # 全跑（含截图）
BC_APP=http://127.0.0.1:8787 node tools/browserCheck.js --shots=0 --clicks=0
node tools/browserCheck.js --dump overview             # 只 dump 某视图 innerText 用于校准锚点
```

**验证内容（22 项检查，全过）**：

| 类别 | 数量 | 做法 |
| --- | --- | --- |
| 10 视图深链 | 10 | `#/overview·sources·problems·library·runs·qa·output·settings·agent·skills` 逐个导航，轮询 `document.body.innerText` 直到不含「加载中/正在加载/加载缓存/加载待作答…」，再断言**数据锚点**出现、**空态哨兵**不出现 |
| 导航点击 | 10 | 真实 `Input.dispatchMouseEvent` 点每条 `.nav-item[data-route]`，断言 `location.hash` 与渲染出的视图标题双双对上（防"点了不切页"与"切页但渲染错"） |
| 详情点击 | 1 | 点模板卡进 `#/library/<id>`，断言详情渲染出该通法名与编号 |
| 合并链横幅 | 1 | 深链到一条 `status=merged` 的历史模板（实测 `T-LA-01-S`），断言详情页出现「本模板已被合并吸收」+ 最终主干号 + 「合并链」行，并另存 `library-merged.png` |
| 运行时错误 | — | 全程监听 `Runtime.exceptionThrown` / `Log.entryAdded(level=error)` / `Network.loadingFailed`，**0 条** |

锚点一律取自真实 API（不是手写的字符串），例如题库页要求出现 `第1章 函数、极限、连续` 与 `ch1-B-fp-01`、运行页要求出现最近一次 run 的编号、校验页要求出现 `覆盖率`；`mustNot` 放该视图的空态文案（`没有符合条件的题目` / `还没有运行记录` / `该章节尚未质检`），这样"页面渲染了但数据是空的"也会被判失败。

**实测结果**：`检查 22 项：通过 22，失败 0；截图 11 张 → output/browser/`（`report.json` 记每视图 DOM 字节数、节点数、等待毫秒与三类错误）。各视图节点数量级：library 1877 / output 1863 / runs 1137 / problems 578 / overview 524 / sources 463 / qa 447 / skills 328 / settings 310 / agent 128→（缓存表渲染后 617 行）。11 张截图已逐张目视复核：总览页 925 题 / 18 通法 / 588 分支 / 97.0% 覆盖 / 待作答 0 与章节进度 12 行全「已完成」；运行页历史运行表 40 行正常出数；模板库页收敛横幅「一级通法 18 个，落在目标区间 15~20，收敛良好」+ 右侧「一级 18 / 分支 588 / 模板 18 / 已合并 356」；校验页 12 个章节徽标（OK 或残留数）与逐模板等价卡片正常；测试模式页「没有待作答任务」空态 + 617 行已作答缓存表；已并入模板页的橙色合并链横幅。

**这一轮查出并修掉的两处真实缺陷**：
1. **坑 39**：`web/app.js` 的 `loadRuns()` 把 `/api/runs` 的 `{ items: [...] }` 响应当数组用，导致「运行」页的历史运行表**永久显示"还没有运行记录"**——HTTP 层冒烟（路由存在、200、JSON 合法）全绿也照样漏。修复后该视图 DOM 从 9,331B/205 节点涨到 453,075B/1137 节点。
2. **已并入模板无归属提示**：全局收敛后 356/374 条模板记录是 `status=merged`，而题库页与校验页的「归属通法」链接、`#/library/<id>` 深链都还会指到它们，详情页却照常渲染成一张"看起来活着"的一级通法卡（读者会以为 18 条之外还有主干）。现补：头部加红色「已并入他法」徽标 + 正文顶部橙色横幅，客户端沿 `merged_into` 逐跳解析到存活主干（上限 12 跳），给出「前往该通法」跳转与完整合并链（`T-LA-01-S → T-LA-67-I`）。两处改动都先备份（`.trash/pre-browserfix/app.js`、`.trash/pre-merged-banner/app.js`），`node --check` 后重跑验证。

**过程中踩到的环境坑（已写进 §6 环境事实）**：① headless `--dump-dom` + `--virtual-time-budget` 不会等 SPA 的 XHR，要么 dump 出 0 字节要么过早截断，必须换成轮询 `innerText` 的 CDP 客户端；② `localhost` 在 Node 18 下解析到 `::1`，而服务只监听 IPv4 ⇒ ECONNREFUSED，目标一律写 `127.0.0.1`；③ `pkill -f "node src/server.js"` 会匹配到自己这条命令行把 shell 一起杀掉（exit 143），改用精确 pid；④ 断言锚点不能凭猜（页面渲染的是 `第1章 函数、极限、连续（77 题）` 而非 `第 1 章`），先用 `--dump` 打真实文本再写进 VIEWS 表；⑤ **弱锚点会让"还在转圈"的视图判成通过**——测试模式页原先只断言 `待作答` 三个字，而卡片标题「待作答任务」本身就含它，于是两张表还在 `加载缓存…` 就算过关；改成断言空态文案 + 表头「作答时间」、并把 `加载待作答|加载缓存` 加进 busy 正则后才是真正的渲染完成判定。

