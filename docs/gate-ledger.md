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

### GAP-006（2026-11-16）· 里程碑全部合入但 README 未勾选（5a 锚定缺口）

- **逃逸路径**：U3 拆为三个 PR（#1/#6/#7）陆续合入，阶段报告按习惯推迟到阶段收尾——收尾被后续任务连续推迟；5a 规则锚定在 phase-N-report 文件存在性，报告未落盘时规则双向均无触发点，「单元全部合入 = 里程碑实质完成」这一事件无人监听
- **shouldHaveBeenCaughtBy**：L1·readme-milestone（5a 的完成方向锚定缺口）+ 阶段收尾流程纪律
- **whyMissed**：锚定缺口——规则只覆盖「报告与勾选不一致」，不覆盖「该写报告而未写」
- **remediation**：phase-3-report.md 补齐 + README U3 勾选 + 规则升级：README 未勾选的 U-N 行若引用的 PR 已全部合并 → 拦截（gh 查 merge state，CI 与本地均可执行）；EXP-012 记录 reviewer 判据同源缺口

### GAP-007 补记（2026-11-16）· 重放校验延后的决策与理由

- **决策**：证据溯源的 L2 重放校验（CI 内重新执行命令并比对输出哈希）暂缓——回归样本集与审计日志口径的输出含非确定片段（计数随审计日志状态变化、时间戳），重放必然不一致，会产生系统性误报
- **当前防线**：L1 完整性校验（outputText 哈希 + PNG 字节绑定 pngSha256 换芯检测）+ 捕获工具唯一化（agent 无法参与文本撰写）已覆盖「手工构造」与「事后换芯」两类伪造；重放针对的剩余形态是「陈旧证据冒充新运行」——由 meta 的 HEAD/时间戳字段供人工核验
- **收口条件**：gate-selftest/gate-stats 输出改造为确定性结构化格式（如 --json 固定 schema）后启用重放，届时 SAFE_REPLAY 白名单按命令粒度启用

### GAP-008（2026-11-17）· 术语旧称清扫遗漏，子代理回读脏语料复用旧称

- **逃逸路径**：2026-11-16 术语规范化（一次性清扫脚本，43+ 处替换）只处理了旧称全词形态（样+本+电+池），漏掉变体（此/本/验收 前缀+电+池）与其他三类旧称在注释、计划文档、实验存档中的残留分布（合计 47 行 / 13 文件，含 gate-stats 口径页脚这一活跃输出）；reviewer 子代理审查 PR #16 时按 brief 回读 `scripts/gate-selftest.mjs`，把文件头旧称原样带回审查报告
- **shouldHaveBeenCaughtBy**：清扫后立即全仓 `git grep` 验证 0 残留（当时只验证了「活跃输出已清扫」，未验证全仓）+ 机检禁用
- **whyMissed**：清扫脚本按替换执行、无残留断言；黑名单无机检——复发无人拦（脏语料即行为：文档里写什么，回读它的子代理就说什么）
- **remediation**：全仓二次清扫（本 PR）+ 检查 9 术语黑名单（pre-commit / ci 扫文本文件、pr 模式扫 PR body；黑名单拆字声明防自匹配，同密钥排除表教训）+ 回归样本 2 条；证据家族（`docs/evidence/`、`docs/screenshots/`、`*.meta.json`）豁免——哈希绑定不可改，改=伪造证据（GAP-007 原则）；EXP-014 存档

### EXP-013（2026-11-17）· T-G2 真 GLM 三 bot 否定回路 E2E
- **假设**：三职责 dispatch 编排（coordinator→engineer→reviewer）在真 GLM 下可完成正向链路并触发否定回路
- **方法**：E2E 容器（dsh-bot:e2e-v5，含 parseVerdict 同义词修复 + 截断上限 10000）dispatch 种子任务 → 30s 轮询 → 产物核对
- **数据**：rounds=1，verdict="pass"（reviewer 独立执行 wc -c/cmp/sha256sum 三项验证），state=done
- **结论**：T-G2 正向链路 ✓。否定回路（种子缺陷）待 T-G3 后续验证（需要精心设计工程 bot 可能出错的种子任务）
