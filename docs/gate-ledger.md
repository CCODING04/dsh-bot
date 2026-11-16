# 围栏审计日志·滚动摘要（提交版）

> 原始审计日志 `.gate-ledger/events.jsonl` 永不入库（含上下文，已 gitignore）。本文件是**脱敏后的阶段粒度摘要**，随阶段报告更新。指标口径见 `scripts/gate-stats.mjs` 页脚。

## 阶段摘要模板（每阶段一节，复制填写）

### 阶段 N（日期区间）

- 拦截（原始 / 加权）：X / Y
- 逃逸违规数：Z（每条对应下方逃逸条目）
- 已发现口径拦截率：X/(X+Z)
- 高价值拦截摘录（severity≥medium，脱敏）：…

## 逃逸条目模板（逃逸闭环机制，每条逃逸违规一条）

### GAP-NNN（日期）·一句话标题

- **逃逸路径**：怎么发生的（可复现命令/场景）
- **shouldHaveBeenCaughtBy**：层+规则 id，或 `none(门禁范畴外)`
- **whyMissed**：规则缺失 / 规则太窄 / 层未激活 / 范围错配 / 范畴外
- **remediation**：新规则 id + `scripts/gate-selftest.mjs` 回归样本 + EXP-NNN 引用（三件齐 = 闭环）

## 历史条目

- GAP-001（2026-11-16）：`npm i -g` 在 L3 未加载期真跑 ×2 —— whyMissed=层未激活；remediation=ws 根配置+会话重启加载（EXP-007 附录）
- GAP-002（2026-11-16）：`--patch/--json` 顺序 bug 穿过 13 项单测、被容器 E2E 抓住 —— whyMissed=规则缺失（单测无法检验 CLI 解析语义）；remediation=参数顺序防回归断言（EXP-008）
- GAP-003（2026-11-16）：rebase 冲突标记随坏合并提交穿过门禁（CI 亦未拦，时序上先于规则存在）—— whyMissed=规则缺失；remediation=**新规则 conflict-marker（检查 6）**+ 手动 pre-commit 拦截实测 + CI 全量复查（暂存区类样本属回归样本集范畴外，见 gate-selftest.mjs 头注；当日闭环，EXP-010）

### GAP-004（2026-11-16）· git add -A 两次带入审计日志文件

- **逃逸路径**：`git add -A` 时 `.gate-ledger/` 的 gitignore 行在未合并分支上（各分支独立演进），新分支无保护 → 审计日志文件两次进入提交（均被发觉后重写/移除，未推送到远端）
- **shouldHaveBeenCaughtBy**：L1·secret-shape（部分——日志文件非密钥形态，仅一次含真实密钥形态时被拦）
- **whyMissed**：范围错配——无「add-A 后 staged 含他分支 gitignored 路径」的专用规则
- **remediation**：`.git/info/exclude` 本地兜底（全分支即时生效）+ gitignore 前置行随 PR #3（feat/gate-telemetry，提交 233906c）落库 + GAP-004 条目（本条）

### GAP-005（2026-11-16）· 提交信息声称的改动未在内容中

- **逃逸路径**：cli.ts 调试扫描豁免的编辑落在本地 main（3ba4223 未推送），而 amend 提交在 feat/pr-body-lint 上——#8 的提交信息与 PR 描述均声称「cli.ts 调试扫描豁免」，内容却没有该改动，穿过 PR 审查（reviewer 第三轮以 blob 对照抓出）
- **shouldHaveBeenCaughtBy**：pr-body lint 无法机检「信息-内容一致性」（范畴边缘）；人审第三道防线生效
- **whyMissed**：操作序列失误（amend 前未核对 `git branch --show-current`）+ 信息与内容不符
- **remediation**：cherry-pick 3ba4223 上 PR #7 分支即时修复（gate 双绿验证豁免生效）；教训入本条：**amend 前必须核对当前分支**；EXP-012 记录完整时间线
