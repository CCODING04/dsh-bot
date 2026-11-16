// pr9-body.cjs —— 重建 PR #9 描述：评审裁决落地 + 术语规范化 + blob 链接 + raw 截图地址
// 用法：node scripts/pr9-body.cjs <head-sha>  → 输出 markdown 到 stdout（供 gh pr edit --body-file）
const sha = process.argv[2];
const RAW = `https://github.com/CCODING04/dsh-bot/raw/${sha}/docs/screenshots/pr9-ledger.png`;
const blob = (p) => `https://github.com/CCODING04/dsh-bot/blob/main/${p}`;
const md = `## Why

两条真实逃逸违规（escape，指通过门禁未被拦截的缺陷）需要按逃逸闭环三要素入库：git add -A 两次把审计日志文件带入提交（GAP-004）；PR #8 的提交信息声称包含 cli.ts 调试扫描豁免，但该改动实际位于本地 main 未推送分支，提交信息与实际内容不符，通过了自检（GAP-005，由 reviewer 第三轮的 blob 对照发现）。同时 reviewer 协作三轮本身是流程验证的重要实验，需要归档。

## What changed

- [docs/gate-ledger.md](${blob("docs/gate-ledger.md")}) 新增 GAP-004 与 GAP-005 两条完整逃逸条目，字段为：逃逸路径 / 应由哪层哪条规则捕获 / 未捕获原因（whyMissed）/ 修复三要素；GAP-004 的修复归属已按第三轮评审裁决修正为 PR #3（feat/gate-telemetry，提交 233906c），此前误记为 PR #4
- [docs/lab-notebook.md](${blob("docs/lab-notebook.md")}) 登记 EXP-012（独立 reviewer 协作三轮实录：三轮合计 approve 5 次、request-changes 3 次且全部成立，其中「提交信息与实际内容不符」由 reviewer 的 blob 对照发现——该项为主进程自检的盲区）；同时将全文件去重为单一副本并按实验编号升序排列（此前 main 上的副本因合并解析叠加出现了整篇重复）
- 新增 [docs/experiments/EXP-012-reviewer-collab.md](${blob("docs/experiments/EXP-012-reviewer-collab.md")})：三轮审查的任务简报与裁决格式完整方法论，作为 U4「reviewer bot」能力的提炼来源
- docs/u4-e2e-test-plan.md 与 docs/u4-group-design.md 的实验编号顺延（reviewer 协作占 EXP-012，U4 端到端实测改为 EXP-013）
- 移除一次性冲突解算脚本 scripts/nb-resolve.cjs（lab-notebook 的 add/add 冲突解算器，用后即弃；此前提交误将其入库，本 PR 修正）
- 全仓库文档与门禁脚本的用户可见文案术语规范化：审计日志（原「台账」）、回归样本集（原「样本电池」）、逃逸违规（原「漏网」）、逃逸闭环（原「漏网飞轮」）

## Scope

覆盖审计日志补记、术语规范化与实验归档。刻意不做：GAP-005 的机检规则（提交信息与实际内容的一致性无法静态检查，属门禁范畴边缘，依靠 reviewer 的 blob 对照这道人工评审防线）；截图渲染效果的自动化断言（同属范畴边缘，以「创建 PR 后打开页面人工核验」纪律替代）。

## Tradeoffs

EXP-012 的教训段落直接点名了操作序列失误（amend 前未核对当前分支，导致豁免改动落在本地 main）——如实记录而非淡化。这是实验归档制度（假设→方法→数据→结论，负面结果同样归档）确立以来的第一次真实压力测试。

## Blast Radius

纯文档与审计日志补记，零运行时改动。docs/ 变更与「行为改动须伴随文档」规则互为补充侧。

## Verification

- 回归样本集 30/30 通过（其中 13 条为本周期新增的 pr 规则样本）
- 审计事件：GAP-004 与 GAP-005 两条逃逸违规已通过 gate-ledger 的 record 接口写入审计日志（.gate-ledger/events.jsonl，本地可见，kind=escape）
- 渲染自检：PR #6/#7/#8 页面实测（browser-use DOM 断言：章节齐全、图片加载、无仓库外链接），本 PR 修复相对路径截图不渲染问题后复检通过

最终生效截图（回归样本集 30/30 + 审计日志口径 + 渲染自检记录）：

![PR9 审计日志补记验收](${RAW})
`;
console.log(md);
