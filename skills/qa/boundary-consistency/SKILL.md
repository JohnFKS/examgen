---
id: boundary-consistency
title: 边界一致性校验Skill
layer: qa
file: src/skills/qa.js
inputs: [模板（适用前提/失效场景/二级分支触发特征/表面题型）]
outputs: [conflicts 清单 + 可直接执行的 patch 字段]
---

# 边界一致性校验Skill（质量校验层）

前两层保证「方法对、覆盖全」，这一层保证**归属唯一**：一道题进来，必须能确定地落到唯一一个模板的唯一一条分支上。边界互相打架的通法手册是不可执行的。

## 三类检查

| kind | 问题 |
| --- | --- |
| `contradiction` | 同一模板内「适用前提」与「失效场景」互相矛盾（如前提写「分母趋于 0」而失效写「0/0 型不可用」） |
| `branch-overlap` | 同模板不同二级分支的触发特征重叠，一道题同时落进两条分支 |
| `cross-template` | 不同模板之间边界冲突，导致题目归属不确定 |

`targets` 字段列出涉及的模板 id，跨模板冲突因此可追溯。

## 消歧方案必须可执行

prompt 明确要求「给出可直接执行的消歧方案」，并把方案落在结构化的 patch 字段里，而不是只写一句建议：

- `patched_applicable` / `patched_invalid`：整段替换该模板的边界；
- `patched_branch_triggers`：按分支名替换 `trigger`（细化触发特征、补互斥条件）；
- 或者 `resolution` 里直接建议合并，交给 `chapter-organize` 在下一轮处理。

无冲突的模板也必须输出 `verdict=pass` 的空 `conflicts`，否则报告无法证明「这一张确实查过了」——覆盖率式的要求同样适用于校验本身。

## 自动修补

流水线对每个有冲突的模板做深拷贝修补：应用 `patched_*`，**小版本升级**，并在 `history` 追加 `boundary-fix` 记录（含冲突描述摘要）。报告写 `output/qa/第NN章-边界一致性校验.md`，章级结论按 fail / warn / pass 汇总。

## 与另两层的关系

- 等价校验解决「这一步是不是真的对」；
- 覆盖校验解决「有没有漏掉的考点」；
- 边界校验解决「手册用起来会不会走错分支」。

三者共同构成 QA 层，每章一次，均在章内合并与跨章合并之后执行，避免校验一个马上要被合并掉的模板。
