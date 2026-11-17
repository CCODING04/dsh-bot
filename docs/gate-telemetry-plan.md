# 拦截审计日志（Gate Telemetry）方案 · 交给主进程落实

> 来源：2026-11-16 侧聊天讨论，用户批准。原则 = pstack 的 **prove-it-works**（围栏自身也要持续被证明有效）+ **explain-the-number**（指标必须讲口径）+ **encode-lessons-in-structure**（逃逸闭环制度化）。
> 方法论佐证：Lauren Tan "Loops You Can Trust"——信任来自可审计的循环；工程师角色 = agent 厨房的质检台，质检台的工作语言是拦截数 / 逃逸违规数 / 逃逸违规原因。
> 本文档是**唯一需要落实的产物**：下列文件均未创建，由主进程按清单实施。本文档不 commit 由主进程随实现一并入库。

## 1. 目标与反目标

**目标**：自动记录每次围栏拦截（含上下文）与每次逃逸违规（escape），产出可信的围栏效能指标，让"保底工作流有效"从口头判断变成数据。

**反目标（用户明确）**：
- 不为凑拦截数故意制造 chaos / conflict
- 不把自测样本计入生产指标（anti-gaming 机检化，见 §4）

## 2. 数据模型（本地 `.gate-ledger/events.jsonl`，gitignored）

三类事件，一行一条 JSON：

```jsonc
// interception —— 围栏拦下的真实执行
{ "kind": "interception", "at": "ISO", "layer": "L1|L2|L3", "rule": "secret-shape",
  "severity": "high|medium|low", "actor": "human|main-session|subagent|ci|unknown",
  "context": "已脱敏的命令/提交主题/文件:行", "trigger": "commit-msg|pre-commit|ci|PreToolUse" }

// escape —— 逃逸违规后在审查/E2E/事后被发现的错误
{ "kind": "escape", "at": "ISO", "foundAt": "review|e2e|postmortem",
  "what": "错误描述", "shouldHaveBeenCaughtBy": "层+规则id 或 \"none(围栏范畴外)\"",
  "whyMissed": "规则缺失|规则太窄|层未激活|范围错配|围栏范畴外",
  "remediation": "新规则id + EXP-NNN 引用" }

// selftest —— 回归样本集自测（不计入生产指标）
{ "kind": "selftest", "at": "ISO", "rule": "...", "expected": "blocked|passed", "actual": "..." }
```

**严重度表**（现有规则）：

| severity | 规则 |
|---|---|
| high | secret-shape（密钥值形态）、L3 dsh-readonly 写入 |
| medium | dockerfile-swallow、L3 docker-run-无生命周期、L3 npm-g、L3 prune |
| low | commit-convention、archive-xref、readme-milestone(5a)、readme-docs-with-code(5b) |

## 3. 各层记录方式

| 层 | 记录路径 |
|---|---|
| L1 process-gate.mjs | 拦截时同步 append 本地 events.jsonl（`fail()` 内接线，一处改动覆盖全部检查） |
| L3 guard-bash.mjs | 阻断（exit 2）前 append 同一文件 |
| L2 CI | **只做读侧聚合，不从 CI 写审计日志**（CI 容器临时；写回需 PAT，复杂度不值）：`gate-stats.mjs` 经 gh api 查 job=gate 且 step `Run node scripts/process-gate.mjs ci` 失败的 run，计入 L2 拦截 |

## 4. 口径规则（explain-the-number，写进 stats 输出页脚）

1. **分母不可知**：未发现的逃逸违规数永远未知 → 效能比只命名为「已发现错误中的拦截率」，禁止表述为「预防了 X% 错误」。
2. **计数≠质量**：commit-msg 拼写霸榜（高频低价值）→ 报告必须**同时**给原始计数与 severity 加权计数，缺一不可。
3. **selftest 剔除**：`GATE_SELFTEST=1` 环境下产生的 interception 一律落为 selftest 事件；生产统计只聚合 kind=interception/escape。

## 5. 逃逸闭环（escape → rule → sample）

每个 escape 必须同时交付三件，缺一不算闭环：
1. lab-notebook 一条 fence-gap 条目（EXP-NNN，假设=围栏为何应拦 / 方法=逃逸违规路径复现 / 数据=证据 / 结论）；
2. 新规则或规则修正（进 process-gate / guard-bash）；
3. 一条坏样本进 `scripts/gate-selftest.mjs`（永久回归）。

**历史回填**（审计日志上线当天即有真实数据）：
- escape #1：`npm i -g` 在 L3 未加载期真跑两次（whyMissed=层未激活；remediation=ws 根配置+重启加载，EXP-007 附录在档）
- escape #2：`--patch/--json` 顺序 bug 穿过 13 项单测、被 E2E 抓住（whyMissed=规则缺失-单测无法检验 CLI 解析语义；remediation=顺序断言，EXP-008 在档）
- 非 围栏范畴示例：EXP-002 网络误诊（流程规则问题，机器围栏不背锅，标 `shouldHaveBeenCaughtBy: none`）

## 6. 主进程执行清单（有序，含验收）

1. [ ] `scripts/gate-ledger.mjs`：共享 `record(event)`（分类+脱敏+单行 append）→ 单测：密钥形态上下文入审计日志后**不含**原值（复用 process-gate 的掩码逻辑）
2. [ ] process-gate `fail()` / guard-bash 阻断路径接线（`GATE_SELFTEST=1` 落 selftest 类）→ 验收：真实提交一条坏消息 → events.jsonl 出现脱敏记录
3. [ ] `.gitignore` 加 `.gate-ledger/` → 验收：`git status` 不见该目录
4. [ ] `scripts/gate-selftest.mjs`：EXP-007 的 14+3 样本迁入（stdin 喂样本），断言全部按预期拦截/放行 → 验收：一条命令跑绿，事件全为 selftest 类
5. [ ] `scripts/gate-stats.mjs`：本地 JSONL + gh api(L2 失败 run) 聚合；输出分层/分规则原始计数、加权计数、escape 数、已发现口径效能比 + §4 三条口径页脚 → 接进 `status.sh` 新增一节
6. [ ] `docs/gate-ledger.md`：提交版滚动摘要模板（阶段粒度）+ fence-gap 条目模板
7. [ ] AGENTS.md「流程约束」节加两行：围栏规则变更必须跑 selftest 并提交对应样本；PR Verification 节附本期 gate-stats 差量
8. [ ] §5 两笔历史 escape 回填 + lab-notebook 记 **EXP-010**（假设=持续拦截/逃逸违规数据能证明围栏有效性；方法=本方案；数据=上线首日计数与回填；结论）
9. [ ] conventional commits 分单元提交（过自家门禁）→ 开 PR（六节 body）

## 7. 坑位清单（每条都有出处，勿重蹈）

1. **密钥回流**：secret-shape 拦下的那行本身含密钥，审计日志若原样存上下文 = 密钥集散地 → record() 强制走掩码（单测锚定）。
2. **并发 append**：多 hook 同写 JSONL → 单次 `appendFile` 写完整行（<4KB 实际原子），禁止分片写。
3. **审计日志永不入库**：raw JSONL 含上下文，只进 gitignore + 脱敏摘要。
4. **CI 聚合的误报**：只统计 job=gate 且失败 step 为 process-gate 的 run（`npm test` 失败不算围栏拦截）。
5. **L3 时序**：hook 会话启动快照加载——接线时 L3 事件可能为零（未激活 ≠ 失效），stats 页脚注明各层激活状态。
6. **Windows**：JSONL 追加用 `node:fs/promises` appendFile，勿依赖 shell `>>`（CRLF/转义坑）。

## 8. 已定决策（勿重新讨论）

- 审计日志本地 gitignored；仓库只进脱敏滚动摘要（`docs/gate-ledger.md`）
- selftest 剔除生产计数（用户明确：不许为拦截造 chaos）
- CI 只读侧聚合，不从 CI 写审计日志
- 报告必须原始计数 + 加权计数并存；效能比只称「已发现错误中的拦截率」
- escape 录入是人工/agent 判定后结构化录入（自动发现逃逸违规是另一课题，不在本期）
