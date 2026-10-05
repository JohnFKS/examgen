---
id: seed-import
title: 种子模板导入Skill
layer: business
file: src/skills/seedImport.js
inputs: [已有通法.md（破天学长系列等）, 考点.md（章节目录）]
outputs: [标准化初始模板库（冷启动）]
---

# 种子模板导入Skill（业务执行层）

把已有优质归纳直接标准化后入库，**无需从 0 开始**，完成冷启动加速。

## 输入

单篇「已有通法」文章正文 + 系统章节目录（第1~12章，含学科归属）。

## 处理

以「重构而非摘抄」为原则：剥离公众号文案、口语、图片、例题的具体数值，只保留可复用的方法骨架；一篇文章含多个独立数学本质时拆成多个模板，同一本质的不同表面形式归为二级分支；按考点实际归属回填 `chapter_no`（跨章节方法论填 `null`）。

## 输出（标准模板结构）

| 字段 | 说明 |
| --- | --- |
| `name` | 通法名称（≤20字，含方法关键词） |
| `essence` | 一句话核心本质 |
| `scope` | 适用范围 |
| `steps[]` | 4~7 步通用解题步骤 |
| `branches[]` | `{name, trigger, steps, surface_types, boundary}` |
| `boundaries` | `{applicable[], invalid[]}` |
| `exam_points[]` / `surface_types[]` | 对应考点 / 可处理外观题型 |
| `chapter_no` | 归档章节 |
| `examples[]` | 典型例题要点（只留形式，不留数值过程） |

入库后 `kind='seed'`、`version='v0.1'`，后续被单题迭代时正常走版本升级与历史留痕，与归纳出的模板完全同质。

## 幂等

按输入文件名记账（`data/state.json.seedsImported`），重跑不重复导入；需要重新导入时在运行请求里传 `forceSeed`。
