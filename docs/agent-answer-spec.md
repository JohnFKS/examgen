# 测试模式作答规范（智能体扮演大模型）

本项目有两种运行模式：

- `live`（生产）：由真实大模型完成归纳推理，网页端「设置」里配置 baseUrl / apiKey / model，或一键拉取模型列表后自主路由选择。
- `agent`（测试）：**由智能体扮演大模型**。流水线仍走完全相同的代码路径，只是把「模型推理」换成智能体的推理，结果按内容寻址缓存到 `data/agent-cache/`，可反复重放。

本文档规定 `agent` 模式下作答的唯一标准。答错格式 → 流水线丢弃该结果；答错内容 → 质检层报错。

## 一、任务包结构

```
agent-work/
  INDEX.md                      # 待作答总清单
  <key>.task.json               # {key, skill, chapter, problem_ids, answerFile, inputRule}
  <key>.input.md                # 压缩后的输入（等价于发给大模型的 user prompt）
  <key>.answer.json             # ← 把答案写在这里（一个 task 一个文件）
```

提交：`node src/cli.js tasks --submit-all`（或网页端「测试模式」页逐条提交）。
提交后任务从 `data/agent-pending/` 消失，重跑 `node src/cli.js run --chapters 1` 即进入下一阶段。

## 二、通用硬规则

1. **只输出 JSON**，顶层对象结构与 schema 完全一致，字段名不得改名、不得增删必备字段。
2. **标识原样回填**：`problem_id` 必须与输入中的 `【题 n｜xxxx】` 完全一致，数量必须等于输入题目数。
3. **禁止照搬**：`essence`/`steps` 里不得出现该题的具体数值、具体函数表达式、具体选项字母。步骤是「任何人遇到同类题都能照着做」的操作指令。
4. **只归纳不生成**：不得虚构新题目、新考点、输入里不存在的数学结论。
5. **本质优先**：判断异同看「为什么这样做一定有效」（代数等价 / 数值等价 / 恒等变形等价），不看措辞与表面形式。
6. 中文表述，术语与考研大纲一致；`surface_type` 4~12 字；`essence` 一句话（≤60 字）；`steps` 4~7 步。

## 三、单题标准化拆解（skill = `problem-decompose`）

固定 5 字段，**无易错点**。

```json
{"items":[{
  "problem_id":"ch1-C-fr-03",
  "surface_type":"递推数列极限",
  "essence":"把递推关系转化为差分等比数列，通项可求，极限由等比收敛性确定",
  "steps":["写出相邻两项的差满足的递推关系","判定差分序列为等比（或可化为等比）","求出差分通项并累加求原数列通项","根据公比绝对值与首项符号判定极限存在性","求出极限值并回代递推式验证"],
  "boundaries":{"applicable":["递推式右端为前若干项的线性组合","特征方程根均在单位圆内或重根情形可显式求和"],"invalid":["递推式含非线性项（如 arctan、指数复合）时不能直接求通项，需改用单调有界准则"]},
  "exam_points":["数列极限","单调有界准则"],
  "stem_excerpt":"设 x1=1,x2=2,x_{n+2}=…"
}]}
```

字段要求：

| 字段 | 含义 | 反面例子（禁止） |
| --- | --- | --- |
| `surface_type` | 题目外观形式分类，同批同类题必须用完全相同的短语 | 「第一题」「求极限」 |
| `essence` | 底层数学原理，回答「为什么一定有效」 | 「用代入法做」「套公式即可」 |
| `steps` | 通用可复用步骤，动词开头，含判别/检验点 | 「x2=2 代入得 a1=1」 |
| `boundaries` | 适用前提 + 失效场景（何时会算错/不可用） | 空数组、"无" |
| `exam_points` | 优先从输入的「本章考点清单」原文中选取，1~3 个 | 自造考纲没有的名词 |

## 四、种子模板导入（skill = `seed-import`）

把一篇已有的优质通法文章重构为标准模板。剥离口语/公众号文案/图片；例题只留要点。

```json
{"templates":[{
  "name":"夹逼准则的三段乘积通法",
  "essence":"乘积各因子趋于 1 时，取对数或用单调放缩把乘积夹在同极限的两侧序列之间",
  "scope":"n 项乘积/和式极限，各因子上限趋于 1 且偏离量可求和",
  "steps":["判定目标结构为 n 项乘积或和","找出偏离 1 的主阶量","构造两侧可控的放缩序列","验证两侧序列同极限","由夹逼准则得原式极限"],
  "branches":[{"name":"对数化分支","trigger":"乘积项为正且因子形如 1+o(1)","steps":["取对数化积为和","对和式用放缩或定积分定义","指数还原"],"surface_types":["n 项乘积极限"],"boundary":"因子存在非正项时不可取对数"}],
  "boundaries":{"applicable":["放缩后的两侧极限存在且相等"],"invalid":["放缩过度导致两侧极限不等，夹逼失效"]},
  "exam_points":["夹逼准则","数列极限"],
  "surface_types":["n项乘积极限","含阶乘的极限"],
  "chapter_no":1,
  "examples":[{"title":"lim (1+1/n)(1+2/n)…(1+n/n) 型","note":"取对数后转定积分定义"}],
  "version_note":"种子 v0.1，导入自破天学长专题"
}]}
```

`chapter_no` 必须取自输入的章节目录（1~12），无法归属填 `null`。

## 五、本质匹配与模板迭代（skill = `essence-match`）

系统会按 `similarity` **强制执行**三档，请务必给出真实相似度而非迎合动作：

| 相似度 | 动作 | patch 内容 |
| --- | --- | --- |
| ≥ 0.90 | `refine` 完全匹配：优化已有模板，小版本升级 | `essence_polish`/`steps_refine`/`boundary_add`/`example_note` |
| 0.60~0.89 | `branch` 部分匹配：归入该模板，新增二级分支 | `branch{name,trigger,steps,surface_types,boundary}` |
| < 0.60 | `new` 不匹配：新建一级通法 | `template{name,essence,scope,steps,boundaries,exam_points,surface_types}` |

`template_id` 写现有模板编号；新建时写 `NEW:通法名`（同批次内本质相同的题必须使用相同的 `NEW:` 名）。

## 六、章节合并（skill = `chapter-organize`）

只允许合并输入中出现的模板，`keep_id` ∈ 输入集合，`absorb_ids` 不含 `keep_id`；
合并后的 `final_essence`/`final_steps` 必须由被合并模板的表述整合而来。

## 七、校验类（skill = `math-equivalence` / `syllabus-coverage` / `boundary-consistency`）

- 等价校验：按代数等价 / 数值等价 / 逻辑等价三维度给 verdict，必须写出你实际做的检验（代入的具体数值或恒等变形式）。发现错误时 `corrected_steps` 给出**完整替换用**的步骤数组，否则给空数组。
- 覆盖校验：只对输入的「待判定考点」逐个输出；`covered=true` 必须给出 `template_id`。
- 边界一致性：触发特征重叠要给出可执行的互斥化改写（`patched_branch_triggers`）。
