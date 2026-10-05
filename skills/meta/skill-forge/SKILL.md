---
id: skill-forge
title: Skill生成元Skill
layer: meta
file: src/skills/registry.js
inputs: [{id,title,layer,purpose,input,schema,check}]
outputs: [skills/<layer>/<id>/SKILL.md, src/skills/generated/<id>.js]
---

# Skill生成元Skill（元能力层）

当流水线缺失某个业务 Skill 时，按统一规范**自动生成新 Skill 并入库注册**，使系统能力可自主扩展。

## 统一规范（生成的每个 Skill 都遵循）

一个 Skill = 一份规范 + 一个实现：

```
skills/<layer>/<id>/SKILL.md      # 规范：用途、输入、输出 schema、校验标准
src/skills/generated/<id>.js      # 实现：{ id, layer, title, desc, hook, buildMessages(input), apply(input, data) }
```

提示词一律采用**统一 5 段式**：`目标 → 参考引导 → 知识支撑（考点/公式/教材）→ 数据 → 输出 schema`，与业务 Skill 完全同构，保证任何扩展 Skill 的推理接口一致。

## 接入方式

生成的 Skill 声明 `hook: 'post-chapter'`，任务调度Skill 在每章「合并去重之后、质量校验之前」自动调用它，输入为该章的活动模板集合。扩展 Skill 若抛错只记事件、不中断主流程。

## 调用

- HTTP：`POST /api/skills/forge`（网页端「Skill」页的表单）
- 返回：`{ok, skill:{id, layer, title, files:[...]}}`
- 冲突保护：同名 Skill 已存在时返回 400，需显式传 `overwrite: true`
