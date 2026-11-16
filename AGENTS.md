# dsh-bot · 仓库代理公约

本仓库是 **pstack 工作流的真实项目验证载体**（见 `docs/PLAN.md`），同时是一个对齐 xAI Grok Bot 能力的 DeepSeek Harness (dsh) bot 运行时。

## 硬约束（继承工作区围栏）

完整围栏见 `../AGENTS.md`（工作区级）。本仓库补充：

1. **沙箱优先**：所有 dsh 相关改动与运行发生在 Docker 容器内（`docker/`）；**绝不**改动 `D:\Dev\DSH`（本机桌面安装）与 `~/.dsh`（本机配置），对它们只读。
2. **密钥**：`DEEPSEEK_API_KEY` 等只经环境变量注入容器；不入库、不入日志、不下发子代理。
3. **清理**：容器一律 `--rm` 或具名可追踪；临时物进 `.tmp/`（已 gitignore），阶段收尾清空。
4. **上游纪律**：本仓库不 fork/修改 deepseek-harness 本体；依赖经 npm 正常安装。

## 开发流程（本仓库存在的意义）

每个功能单元走 pstack 流程，接受验证：

1. 任务进入时读 `.zcode/skills/zcode-harness/SKILL.md`（适配表），再按 poteto-mode 的 **feature** 或 **refactoring** playbook 执行。
2. 小步可验证单元：每单元以"运行证据"收尾（prove-it-works），测试便宜时先写失败测试（tdd）。
3. Conventional Commits（`feat:`/`fix:`/`chore:`/`docs:`）；每单元一个分支 + PR；PR 描述含 `## Why`（复述用户目标）。
4. 合并前 unslop 自查；审查阶段按 no-comments / interrogate 映射执行（见适配表）。
5. 每阶段（U1–U4）在 `docs/phase-N-report.md` 记录：做了什么 / 运行证据 / 清理清单。

## 实验存档制度（review 硬要求）

**每个实验**（成功与失败 alike）必须记入 `docs/lab-notebook.md`：假设 → 方法（可复现命令）→ 数据（输出摘录，原始件存 `docs/experiments/EXP-NNN-*.md`）→ 结论。负结果与误诊过程照录——它们是 pstack 流程验证的核心 review 依据。诊断类实验必须分层多目标 + 双环境（容器/宿主机）对照后才许下结论（EXP-002 教训）。

## 流程约束（自动执行，勿凭自觉）

规则已固化为三层门禁，违反会被机器拦截而非靠记忆：**L1** `scripts/process-gate.mjs`（提交信息规范 / 密钥值形态扫描 / Dockerfile 吞错 / 档案交叉引用 / README 里程碑同步 / 行为改动带文档）经 `.githooks/`（`core.hooksPath` 已启用，仓库本地）在 commit-msg 与 pre-commit 强制；**L2** `.github/workflows/ci.yml` 在 push/PR 上重跑全部检查 + `npm test`（且为分支保护 required check）；**L3** `.zcode/config.json` 的 PreToolUse(Bash) hook 调 `scripts/guard-bash.mjs` 拦危险 shell。设计与验收数据见 `docs/process-enforcement-plan.md` 与 EXP-007。修改门禁规则 = 改上述脚本并同步过一遍坏样本验收，不是加一段新文字。

**围栏遥测（自动记录）**：每次拦截/漏网自动落 `.gate-ledger/events.jsonl`（本地 gitignored，context 强制脱敏）；`node scripts/gate-selftest.mjs` 是围栏样本电池（改门禁规则必须跑绿并提交对应样本）；`node scripts/gate-stats.mjs` 出效能指标（口径四条随输出，含"已发现错误中的拦截率"限定）。每个 escape 走飞轮三件套：EXP 条目 + 规则修正 + selftest 样本（见 `docs/gate-ledger.md`）。PR 的 Verification 节应附本期 gate-stats 差量。

## 维护角色（职能约定，2026-11-16 定；U4 后做机器账号隔离）

参照 Lauren Tan 的实践（两个循环 + 三职责起步，见 EXP-009 调研存档）：**角色是"读什么技能 + 什么权限"的函数，不是 N 份 persona 文件**。本仓库只有两个薄 agent 包装：`.zcode/agents/poteto-agent.md`（通用委派：先读 poteto-mode 全文）与 `.zcode/agents/comment-sicko.md`（只读审查特例）；知识活在 `.zcode/skills/`，按需路由。

| 角色 | 职能 | 边界 |
|---|---|---|
| 人类（主厨） | 唯一 merge 执行者；密钥管理；不可逆动作批准 | main 分支保护 required `gate` 收敛一切合并到 PR |
| 主会话 agent | 开分支 / 实现 / 验证 / 开 PR | **不 merge**（merge 是人类职能） |
| 委派子代理（poteto-agent） | 带 brief 的实现/辅助任务 | 不 commit；密钥不下发；产物在分支 |
| comment-sicko | 只读 diff 审查 | 不编辑文件 |
| CI（gate） | 唯一绿灯裁判 | required check，绕不过（服务端） |
| dsh-bot（U4 起） | 经 issue/PR 触发；三职责起步：coordinator（任务简报+owner+完成条件）/ engineer（PR+证据）/ reviewer（带复现裁决），**以不同技能集区分而非 persona 文件** | 产物只在自己分支；合并留人类 |

**警告（Lauren 实践中的一手教训）**：角色不是凭据边界——同凭据下的 bots/agents 共享文件与会话。真正的隔离靠：容器/工作区物理边界、密钥分发边界（guard-bash + 围栏 §2）、分支权限。任何"角色隔离"的设计先过这条检查。

## pstack 技能位置

`<pstack>` = `.zcode/skills/`（本仓库根）。poteto-mode 入口：`.zcode/skills/poteto-mode/SKILL.md`。
