# U4 设计骨架 · 三职责 bot group（coordinator / engineer / reviewer）

> 状态：骨架（待 U3-2/U3-3 合入后细化并实施）。依据：EXP-009（Lauren Tan 两循环/三职责）、u3-integration-spec（CB1-CB10）、已落地的会话记忆/权限配置/技能管理。

## 1. 形态选择（已定方向）

**「技能即角色」+ daemon 最小编排**，两层：

- **daemon 层（薄）**：group = 命名 bot 集合（`POST /groups {name, members:[bot...]}`）；`POST /groups/:g/dispatch {task}` 按职责路由（见 §2）。daemon 只做注册/路由/结果聚合，**不做智能决策**——决策在 coordinator bot。
- **bot 层（角色=技能集）**：三个 bot 模板，各装不同 `.dsh/skills/`（U3-3 的技能 CRUD 直接复用）：
  - `coordinator`：技能 = 任务分解（产出任务简报：owner+完成条件，EXP-009 协调者职责）+ 委派协议（见 §3）+ 汇总裁决
  - `engineer`：技能 = 实现纪律（poteto-mode 的浓缩版：最小改动/证明可行/测试收尾）
  - `reviewer`：技能 = 独立审查协议（不写+必执行+结构化 verdict——本次 PR review 已有人类版先例可蒸馏）

## 2. 委派协议（bot 间通信）

dsh headless 无自定义工具，但 bot 在容器内可 `curl` daemon HTTP API（同机 127.0.0.1:8787）：

```
coordinator 收 dispatch → 产出任务简报 → curl POST /bots/engineer-x/brief {简报}
  → engineer 完成（产物在其工作区 + lastResult）→ coordinator 轮询 GET /bots/engineer-x
  → curl POST /bots/reviewer-y/brief {简报 + engineer 结果摘要}
  → reviewer verdict → coordinator 汇总 → group 状态 = done / needs-rework（可回环一轮，有界）
```

关键边界（对齐 EXP-009 警告"角色≠凭据边界"）：bot 间只经 daemon API 通信（**不允许** bot 直接读他人工作区文件）；所有 curl 走 localhost；permissionMode 三 bot 各自固定（engineer=workspace-write，reviewer=read-only——reviewer 天然只读）。

## 3. 交付物（实施清单，待细化）

1. daemon：groups CRUD + dispatch 路由 + group 事件流（EXP-011 存档位）
2. 三个技能模板（SKILL.md，coordinator 含委派 curl 协议原文）
3. `POST /bots/:n/brief` 增加 `waitFor: "completion"` 语义或 coordinator 轮询节奏约定（防死循环：回环上限 2）
4. E2E：一个三 bot group 跑通"实现一个函数+审查"微任务（真 GLM），产物与 verdict 落档
5. 门禁关系：bot 产物只存在 bot 工作区；进主仓库仍走 PR + 人类 merge（角色表不变）

## 4. 风险与开放问题

- coordinator 的 curl 能力=把 daemon API 暴露给模型——需审计面（哪些 endpoint 允许 bot 调：brief/status 可，create/delete bot 应拒——加 actor 区分，v0 用 UA 标记 bot 流量只放行白名单端点）
- 轮询节奏：coordinator sleep 循环浪费 token——约定 engineer brief 完成即写约定文件，coordinator 一次长轮询
- GLM 上下文长度对长任务的分解粒度约束（实测定）
