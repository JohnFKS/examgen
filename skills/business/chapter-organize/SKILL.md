---
id: chapter-organize
title: 章节分类与组织Skill
layer: business
file: src/skills/chapterOrganize.js
inputs: [章内/跨章模板集合（压缩视图）, 收敛目标区间]
outputs: [merges / renames / hierarchy / 组织结论]
---

# 章节分类与组织Skill（业务执行层）

匹配负责「一题归一处」，组织负责「多法归一统」。严格按教材章节目录归档，不允许跨章乱序。

## 三个触发时机

| 时机 | 范围 | scopeNote |
| --- | --- | --- |
| 每题入库时（确定性） | 模板 `chapters` / `chapterTitles` 字段 | 由 `essence-match` 落库，无需模型 |
| 每章结束后 | 本章涉及的模板 | 「第 N 章章内合并去重」 |
| 每 5 章 + 最终收敛 | 全部 active 模板 | 「跨章共性合并 / 全局收敛」 |

## 合并判据

核心本质一致（代数等价 / 恒等变形等价 / 逻辑等价）的模板**必须**合并为一个一级通法，表面差异降级为二级分支。本质不同的不许强合——`unmerged_reason` 字段要求逐个说明「为何各自独立」，把「不合并」也变成有据可查的决策。

## 数量约束

一级通法总量目标区间由配置 `convergence.firstLevelTargetMin~Max`（默认 15~20）注入提示词。本批次只处理给定集合，但必须以全局目标为约束——防止模型在局部章内无节制新造。

最终收敛阶段若模型合并得不够，流水线会追加**强制合并**：对相似度 ≥0.75 的模板对按字符二元组相似度直接合并，不再询问模型。目标是保证阶段一结束必落入 15~20 区间。

## 禁止发明内容

合并后的 `final_essence` / `final_steps` / `final_branches` 必须是被合并模板表述的**整合**，不得引入任何未在题库中出现过的数学结论。组织阶段是重排，不是创作。

## 落库产物

`merges` 应用时被合并模板置 `status='merged'` 并写 `merged_into`，其 `branches` / `examples` / `exam_points` / `boundaries` 全部并入保留模板（去重取并集）。版本记为大版本升级，历史留一条 `organize` 记录，网页端可回看每个模板被谁吃掉、什么时候。
