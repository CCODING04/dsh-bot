# EXP-009 原始数据 · 角色方案调研：Lauren Tan 的子代理/角色设计（2026-11-16）

触发：用户问"是否应给每个子代理一个 role md 文件，唤醒时读 role + PR/issue + codebase？Lauren 的方法如何做？"

## 方法

本地 pstack 副本证据（58 技能目录清点）+ 网络检索（她的 X 长文《The Complete Guide to pstack》、MTS 访谈 "I stopped writing code"、第三方分析 aiidelist.com——该文诚实标注了证据边界）。

## 数据

### 本地 pstack 一手证据

- `agents/` 恰好 **2 个文件**：`poteto-agent.md`（9 行薄包装：先读 poteto-mode 全文）+ `comment-sicko.md`（只读审查特例）
- 知识在 `skills/`（56 个 SKILL.md）按需路由；角色差异靠 setup-pstack 的 **模型路由**（role→model 行），不靠 persona 文件
- poteto-mode 规定："Routed workflow skills (interrogate, reflect, swarm) set their own subagent_type"——角色由被路由的技能自己定

### 检索结论（aiidelist 转述 MTS 访谈，含证据等级标注）

- **两个循环**：外循环（Grok Bots 扫描 Slack bug/X 抱怨/功能想法→发现工作）、内循环（Cursor Cloud Agent 隔离 VM 实现/测试/PR）
- **Chief of Staff** = 协调角色（谁拥有任务/输入是否最新/交接是否完成），非 root 权限
- **三职责起步建议**：Coordinator（任务简报+owner+完成条件）/ Engineering owner（PR+证据）/ Independent reviewer（带复现裁决）
- **Trust first, then parallel**：先建验证技能与信任，再并行化（5→100 agents、月 2500 PR 的路径是验证驱动）
- **关键警告**：同账号 Bots 共享一台云电脑（文件+已登录浏览器）——**角色不构成凭据边界**（原文明确）
- 合并：验证门通过 + 明确授权才自动合并；**首个实验把最终合并留给人类**
- 证据边界：'20+ GrokBots' 与 'Control Glass/CDP' 缺一手证据（aiidelist 标注）

## 结论（本仓库采纳）

1. **不做 N 个 role md**。角色 = f(读什么技能, 什么权限, 什么模型)——函数不是文件。落地：2 个薄 agent 包装（`.zcode/agents/poteto-agent.md` + `comment-sicko.md`）+ 知识留在 `.zcode/skills/`。
2. dsh-bot 侧"角色"= 工作区技能集（`.dsh/skills/<name>/SKILL.md`，dsh 原生懒加载：目录消息只给 name+description，`skill({name})` 按需读正文）+ permission-mode + 会话记忆。U3-3 的技能管理即角色系统的实现；U4 三职责 bot 用不同技能集区分。
3. 唤醒协议（用户设想的形态成立）：brief = 安全边界 + 指向要读的 SKILL + 任务 + 成功标准——U3-1 的委派 brief 已是该形态的首个样本。
4. 凭据边界警告写入 AGENTS.md 角色表：隔离靠容器/工作区/密钥边界，不靠 persona。

## 来源

- https://x.com/poteto/article/2094457600259842065（The Complete Guide to pstack Pt.1）
- https://aiidelist.com/blog/lauren-tan-grok-bot-pstack-workflow（MTS 访谈转述，含证据边界标注）
- 本地 `.zcode/skills/`（58 目录清点）与 `agents/`（2 文件）
