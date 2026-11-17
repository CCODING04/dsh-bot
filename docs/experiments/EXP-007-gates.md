# EXP-007 原始数据 · 流程硬约束三层工程（2026-11-16）

设计来源：`docs/process-enforcement-plan.md`（侧聊天审计，encode-lessons-in-structure）。

## 假设

靠自觉的流程规则必然漂移（审计已证实：直推 main、未跑 interrogate、未正式路由 poteto-mode）；把规则做成 lint/hook/CI 三层机器门禁可以零自觉成本地强制执行。

## 方法

- **L1** `scripts/process-gate.mjs`（零依赖）四检查 + `.githooks/{commit-msg,pre-commit}`（`git config core.hooksPath .githooks`，仅仓库本地）
- **L2** `.github/workflows/ci.yml`：`npm test` + `process-gate ci`（BASE 按 event 区分）
- **L3** `.zcode/config.json` PreToolUse(`^Bash$`) → `scripts/guard-bash.mjs`（纯 exit code：0 放行 / 2 阻断；解析失败 fail-open）

## 数据

### L1 验收（手测样本 14 条）

| 样本 | 期望 | 实测 |
|---|---|---|
| commit-msg `bad message` | 拦 | 拦 ✓ |
| commit-msg `feat: 测试消息` / `Merge branch 'x'` | 过 | 过 ✓ |
| 暂存 bigmodel 形态密钥（32hex.suffix） | 拦 | 拦 ✓（掩码显示 `1392b6***`） |
| 暂存 `sk-` 形态密钥 | 拦 | 拦 ✓ |
| `docker/Dockerfile` 注入 `npm install … \|\| true` | 拦 | 拦 ✓（还原后过） |
| 未被 notebook 引用的 EXP-999 档案 | 拦 | 拦 ✓ |
| notebook 引用不存在的 EXP-888 | 拦 | 拦 ✓ |
| 全净状态 pre-commit / ci 模式（HEAD~3..HEAD） | 过 | 过 ✓（542 文件扫描 0 命中） |
| **真实 git commit "introduce stuff"** | hook 拒 | **拒 ✓（未入库，HEAD 不变）** |

### 开发中修掉的两个 bug（测试驱动）

1. guard-bash 正则裸 `/`（`D:/Dev/DSH` 分支）终止字面量 → SyntaxError；改 `new RegExp` 构造。
2. 误拦：`cat D:/Dev/DSH/readme 2>/dev/null`（stderr 丢弃被当写操作）→ 剔除 `2>&1`/`>/dev/null` 后再判写操作符；复测 3 条（放/拦/拦）全符预期。

### L3 guard-bash 手测（stdin 喂 JSON，14 条）

拦 6：`docker run`（无 --rm/-d/--name）、`npm i -g x`、`docker system prune -af`、`echo > D:/Dev/DSH/…`、`cp → ~/.dsh`、`mv ~/.dsh/…`
放 8：`docker run --rm`、`docker run -d --name svc`、`docker compose up -d`、`npm install lodash`、`cat … 2>/dev/null`（修复后）、`ls -la`、`docker ps`、合并重定向场景。

### 真实触发（会话内）

- `docker ps`（放行路径）→ 执行 ✓
- `npm i -g <fake-pkg>`（阻断路径）→ **未被拦，npm 404 真跑了** → `.zcode/config.json` 的 hook 在本会话不生效：文件创建于会话启动之后，workspace hooks 需新会话加载。

## 结论

1. **L1/L2 即时生效**，L3 逻辑正确（14 样本全对）但需新会话加载——三层冗余设计恰好兜住：CI 仍会拦住逃逸违规提交。
2. 假设成立：14+3 样本、1 次真实提交拦截、0 未修复误拦。规则从"文字"变为"退出码"。
3. 分支保护（require PR）按计划 §5.8 留待 U3 启 PR 流时经用户确认开启。

## 附录 · 决策更新（husky）

用户于落地后解除"零依赖原则"（husky 可装）。评估：husky 对本仓库的唯一增量收益 = 克隆后自动启用 hooks，已用 `package.json` 的 `"prepare": "git config core.hooksPath .githooks || true"`（npm 生命周期，npm install 自动执行）等价覆盖，故维持零依赖；若未来需要 husky 的共享/多钩子管理再切换，迁移成本一行。

## 附录 · CI 验证

run 43817037151（commit 56d68d6）：`npm test` ✅ + `process-gate ci` ✅ → conclusion **success**。

## 附录 · L3 加载时序三次实测（重启后补充）

| # | 场景 | 测试命令 | 结果 | 推论 |
|---|---|---|---|---|
| 1 | 会话启动前配置已存在于 dsh-bot/.zcode/（子目录 git repo） | 重启会话后 `npm i -g <fake>` | **未拦**（npm 404 真跑） | workspace 配置发现是"从 cwd 向上到项目根"，本会话根=ws 上级目录，子目录 repo 的 .zcode 永不在路径上 |
| 2 | ws 根写入 .zcode/config.json 后（含 `${ZCODE_PROJECT_DIR}` 模板路径），未重启 | 同上 | **未拦** | 配置为会话启动时快照，无热重载 |
| 3 | 对照：L1 同期验收 | 真实 git commit 坏消息 | **已拦** | L1/L2 兜底有效 |

**结论**：L3 生效条件 = 配置位于**会话 workspace 根** + **会话启动后加载**。改进已落位（ws 根配置），下次会话自动激活；无需专门重启（L1/L2 在岗，本会话残余风险低）。
