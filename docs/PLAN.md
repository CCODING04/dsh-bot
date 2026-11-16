# dsh-bot 项目规划

> 一句话：在 DeepSeek Harness (dsh) 之上构建一个对齐 xAI Grok Bot 能力的 bot 运行时；**开发过程本身用 pstack 工作流驱动，作为《PStack 自建迁移实施方案》的真实项目闭环验证**。

## 0. 双重目标

| 目标 | 说明 | 验收 |
|---|---|---|
| **产品目标** | dsh-bot：常驻、有自己沙箱电脑、可 brief、端到端干活、要审批时才找人的 bot 运行时 | U1–U4 里程碑 + Grok Bot 对齐矩阵全绿 |
| **流程目标** | 用 pstack（poteto-mode）开发本项目，验证 L0 迁移有效性 | T1–T7 全过（见 §4），每单元有运行证据 |

## 1. Grok Bot 功能对齐矩阵（调研 2026-11-16）

来源：x.ai/news/introducing-grok-bot（2026-08）、x.ai/news/team-bots（2026-09）、x.ai/bot。

| Grok Bot 能力 | dsh-bot 对齐设计 | 里程碑 |
|---|---|---|
| 常驻 agent 团队（always-on） | bot daemon：管理命名 bot 的生命周期，会话持久化 | U1 |
| 每个 bot 一台"云电脑" | 每 bot 独立工作区（容器内目录 + 卷）；容器即宿主电脑 | U1 |
| 端到端完成任务，只在需审批时回来 | dsh 自带 sandbox + approval policy（dsh-base）→ daemon 把 approval 请求 surfaced 成事件 | U3 |
| 可教技能（skills/plugins） | 透传 dsh 插件/skill 机制到 bot 工作区 | U3 |
| 文件 / 密钥管理 | per-bot files 目录 + 容器 env 注入（密钥不入库） | U2 |
| 多 agent 协作（groups） | group 概念：多 bot 共享任务上下文，daemon 编排分发 | U4 |
| 团队共享（publish to team） | 后置（L2+，超 MVP） | — |
| Composio 工具包集成 | 后置（L2+） | — |

## 2. 架构（U1 形态）

```
宿主 PC（不碰 D:\Dev\DSH 与 ~/.dsh —— 只读）
└─ Docker 容器 "dsh-bot-host"（node:24 + @deepseek-ai/dsh，DSH_HOME=/dsh-home 卷）
   ├─ dsh-bot daemon（本仓库 src/，TypeScript）
   │   ├─ POST /bots            建命名 bot（= 独立工作区 /state/bots/<name>/ws）
   │   ├─ POST /bots/:n/brief   下任务 → 驱动 dsh 执行（driver 可换）
   │   ├─ GET  /bots/:n/status  状态/产物/待审批
   │   └─ GET  /bots/:n/events  事件流（含 approval 请求）
   ├─ driver: dsh（默认，headless/sdk profile）| stub（无密钥冒烟）
   └─ CLI: dsh-bot create|brief|status|logs（同 daemon 进程内直连，无需 HTTP 亦可）
```

## 3. 里程碑（每步 = 一个 pstack 可验证单元）

| 单元 | 内容 | 运行证据 |
|---|---|---|
| **U1** 骨架 + 沙箱 | Docker 镜像、daemon、CLI、stub driver | 容器内 `dsh-bot create demo && dsh-bot brief demo "..."` 走通（stub） |
| **U2** 真实闭环 | dsh driver 接入（headless 一发式执行），真实 LLM 完成一个文件任务 | 需要 `DEEPSEEK_API_KEY`（用户提供后注入）；产物落 bot 工作区 |
| **U3** 审批 + 技能 | approval 事件 surfaced；bot 工作区技能安装路径。U3-2 进度 2026-11-16：per-bot permissionMode 三值配置 + daemon 每调用透传 + PATCH /bots/:n + permission_blocked web 呈现（见 `docs/u3-integration-spec.md` §3.2/§3.3）。U3-3 进度：每 bot 工作区 `.dsh/skills/<name>/SKILL.md` 技能 CRUD（frontmatter 校验 K3）+ `git init` 钉 projectRoot（C5/K6，git 不可用降级）+ CLI `skills` 子命令 + web 技能面板（增删后提示"建议新会话"，CB6） | 触发一次需审批操作 → CLI 可见待办 |
| **U4** 多 bot 协作 | group 编排，多 bot 并行各领子任务。进度 2026-11-16（T-G0/T-G1 实现层）：bot group 注册/查询/解散贯通 daemon/CLI/REST/web 三面（`Group = {name, members, createdAt, events}` 随 groups.json 持久化，成员校验：须为已存在 bot、去重 ≥2）；三职责角色技能模板见 `docs/u4-group-design.md` §3。dispatch 编排（coordinator 决策）属 T-G2，接口已预留不实现 | 两 bot 各出产物且互不污染 |

## 4. 流程验证矩阵（对齐《实施方案》T1–T7）

| # | 在本项目的落点 |
|---|---|
| T1 适配器冒烟 | 本文件 + `.zcode/skills/` 落地即测：技能可被 ZCode 发现 |
| T2 bug-fix 闭环 | U2 之后：注入一个真实缺陷 → poteto-mode bug-fix playbook 修复 |
| T3 子代理 fan-out | U4：两个 general-purpose 扮演 poteto-agent 并行 |
| T4 证据型审查 | 首个 PR 起：interrogate 裁剪版审查（L1 就绪前人工执行） |
| T5 舰队隔离 | U4 的容器/worktree 双隔离 |
| T6 issue 驱动 | 仓库 issue 开任务 → bot/agent 领取（benny v0 模式） |
| T7 无人值守 | OffPeakCreate 排程跑 U2 回归 |

## 5. 风险与边界

- dsh 处于 developer preview，breaking changes 常态 → driver 层隔离 dsh 调用细节，锁版本。
- 无 `DEEPSEEK_API_KEY` 时一切真实执行阻塞 → stub driver 保证 U1 与管线可验证。
- 容器网络：build 期需 registry；运行期需 LLM API 出网，理由与白名单记录于 `docker/README.md`（严格断网壳属 L3 加固）。
- 本机 dsh 桌面版（D:\Dev\DSH）与本仓库零交互，仅作版本参照（只读）。
