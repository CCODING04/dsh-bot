# 围栏台账·滚动摘要（提交版）

> 原始台账 `.gate-ledger/events.jsonl` 永不入库（含上下文，已 gitignore）。本文件是**脱敏后的阶段粒度摘要**，随阶段报告更新。指标口径见 `scripts/gate-stats.mjs` 页脚。

## 阶段摘要模板（每阶段一节，复制填写）

### 阶段 N（日期区间）

- 拦截（原始 / 加权）：X / Y
- escape 数：Z（每条对应下方 fence-gap 条目）
- 已发现口径拦截率：X/(X+Z)
- 高价值拦截摘录（severity≥medium，脱敏）：…

## fence-gap 条目模板（escape 飞轮，每个 escape 一条）

### GAP-NNN（日期）·一句话标题

- **漏网路径**：怎么发生的（可复现命令/场景）
- **shouldHaveBeenCaughtBy**：层+规则 id，或 `none(围栏范畴外)`
- **whyMissed**：规则缺失 / 规则太窄 / 层未激活 / 范围错配 / 范畴外
- **remediation**：新规则 id + `scripts/gate-selftest.mjs` 样本 + EXP-NNN 引用（三件齐 = 闭环）

## 历史条目

- GAP-001（2026-11-16）：`npm i -g` 在 L3 未加载期真跑 ×2 —— whyMissed=层未激活；remediation=ws 根配置+会话重启加载（EXP-007 附录）
- GAP-002（2026-11-16）：`--patch/--json` 顺序 bug 穿过 13 项单测、被容器 E2E 抓住 —— whyMissed=规则缺失（单测无法检验 CLI 解析语义）；remediation=参数顺序防回归断言（EXP-008）
- GAP-003（2026-11-16）：rebase 冲突标记随坏合并提交穿过门禁（CI 亦未拦，时序上先于规则存在）—— whyMissed=规则缺失；remediation=**新规则 conflict-marker（检查 6）**+ 手动 pre-commit 拦截实测 + CI 全量复查（暂存区类样本属电池范畴外，见 gate-selftest.mjs 头注；当日闭环，EXP-010）
