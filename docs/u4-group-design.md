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

> 进度 2026-11-16（T-G0/T-G1 实现层）：交付物 1 的 groups CRUD（注册/查询/解散，随 groups.json 持久化）与交付物 2 的三技能模板已落地——`skillTemplates/` 三份 SKILL.md（coordinator-brief / engineer-discipline / reviewer-verdict），读取在 `src/role-templates.ts`，经既有 `PUT /bots/:n/skills` 安装；交付物 1 的 dispatch 路由与 group 事件流、交付物 3/4/5 归 T-G2 及后续。

> 进度 2026-11-16（T-G2 dispatch 编排实现层）：daemon 侧编排已落地（`src/daemon.ts` 的 `BotDaemon.dispatch()`）——`POST /groups/:g/dispatch {objective}` 异步受理（返回 `{dispatchId, state}`，daemon 后台串行委派 coordinator→engineer→reviewer，每阶段复用既有 per-bot 队列的 `brief()` 驱动），`GET /groups/:g/dispatches/:id` 查详情；`Group` 增加 `status`/`dispatches`（`GroupDispatch`：objective/dispatchedAt/state/summary/verdict/rounds），随 groups.json 持久化。角色按成员名前缀解析（coordinator-/engineer-/reviewer-，缺任一即拒绝）；coordinator 简报 JSON 不解析、全文透传 engineer（v0，§2 路由形态由 daemon 代行，bot 自驱 curl 协议仍归后续）；verdict 宽松三级解析（纯 JSON→嵌入对象→裸键值），不可判定 → dispatch failed，绝不静默 approve；request-changes 回环一次（上限 2 轮，第二轮仍拒 → 终态 needs-rework，T-G3 判据）；每阶段结果以既有 BotEvent kind 落 group.events（step=dispatch 开始/group_summary、brief_received/done=各阶段、error=编排失败）。测试：`test/daemon.test.ts` T-G2 节 8 项（串行顺序/回环上限/重入守门/失败收敛/HTTP 形态）；真实进程冒烟：`node test/e2e/dispatch-smoke.mjs`（scripted driver，不需 GLM）。开放点：编排级总熔断未做（现依赖 dsh driver 单轮 10min 超时）；bot 调 API 越权审计面（§4）归 T-G4。

1. daemon：groups CRUD + dispatch 路由 + group 事件流（EXP-013 存档位）
2. 三个技能模板（SKILL.md，coordinator 含委派 curl 协议原文）
3. `POST /bots/:n/brief` 增加 `waitFor: "completion"` 语义或 coordinator 轮询节奏约定（防死循环：回环上限 2）
4. E2E：一个三 bot group 跑通"实现一个函数+审查"微任务（真 GLM），产物与 verdict 落档
5. 门禁关系：bot 产物只存在 bot 工作区；进主仓库仍走 PR + 人类 merge（角色表不变）

## 4. 风险与开放问题

- coordinator 的 curl 能力=把 daemon API 暴露给模型——需审计面（哪些 endpoint 允许 bot 调：brief/status 可，create/delete bot 应拒——加 actor 区分，v0 用 UA 标记 bot 流量只放行白名单端点）
- 轮询节奏：coordinator sleep 循环浪费 token——约定 engineer brief 完成即写约定文件，coordinator 一次长轮询
- GLM 上下文长度对长任务的分解粒度约束（实测定）
- parseVerdict 支持裁决同义词扩展：真 GLM 产出 "fail"/"PASS" 而非标准值——normalize 函数归类为标准 approve/request-changes（GAP-007 实测反馈）
