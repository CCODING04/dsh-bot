# EXP-008 原始数据 · U3-1 会话记忆与 --json 驱动（2026-11-16）

规格来源：`docs/u3-integration-spec.md`（workflow dwfrun-a4ebd73b 产物，21 条 verified 结论 + C1-C8 裁决）。

## 假设

按规格实现 driver `--json` 化 + bot→session 绑定（CB3）后，真实容器中 bot 具备**跨调用会话记忆**（OQ-5：同 id 两轮运行，第二轮凭历史作答）。

## 方法

1. 实现：poteto-agent 式子代理（brief 首行读 poteto-mode 全文）产出 drivers.ts/daemon.ts/test 改动；主会话 review diff 后裁决其 openQuestions：
   - **OQ-B 裁决：失败清绑定**（对齐规格 CB3 推荐——失败不延续上下文；子代理原实现"失败保持绑定"偏离规格）
   - OQ-C 采纳：`finalReasonRaw` 留痕原始 kind（aborted/interrupted 诊断信息）
   - OQ-A 同意：permission-mode 配置项留后续单元；OQ-D 不动（够用）
2. 单测：13/13（新增 8：解析器三类终止/交叉校验/permission_blocked 五码映射/参数契约/绑定策略/串行队列）
3. 容器 E2E（真 GLM，两轮暗号实验）。

## 数据

### E2E 第一跑：抓到参数顺序 bug（单测不可见）

`--json` 放在 `--patch` 前 → `runner: unknown option '--patch'`（exit 失败）。
根因：`--patch` 是 **launcher 级**选项；launcher 遇到第一个非自身选项（`--json`）即停止解析，剩余整体交给 app 层（headless runner 不认识 `--patch`）。U2 旧序（无 --json）恰好正确。
修复：`--profile headless --patch <p> --json --approval-policy …`；加顺序防回归断言（`indexOf("--patch") < indexOf("--json")`）。
教训：**fake-bin 单测无法检验 CLI 的选项解析语义**（子代理已记录 Windows 下假脚本不可行），真实 E2E 是唯一判据——EXP-006 协议（DOM/容器双重判据）再次验证。

### E2E 第二跑：会话延续实证（OQ-5 关闭）

| 轮 | brief 要点 | status | sessionId | 产物 |
|---|---|---|---|---|
| 1 | "记住暗号 pineapple；memo.txt 写入 pineapple；回复：已记住" | idle | `session-2fd9a35c-151f-4ccd-811a-a8074568c050`（**绑定写入**） | memo.txt=pineapple |
| 2 | "把之前约定的暗号写入 answer.txt"（**brief 不含 pineapple**） | idle | **同 id**（resume 生效） | **answer.txt=pineapple** |

会话存储：`/dsh-home/sessions/` 按 cwd 归组（`--state-bots-mem2-ws--`），与规格 S2 布局一致。

## 结论

1. OQ-5 关闭：跨调用会话记忆成立，绑定/resume/串行全链通过。
2. 首跑失败即价值：E2E 抓到 launcher 解析边界 bug，已修复并加防回归。
3. poteto-agent 式委派（审查分离）+ 主会话裁决：子代理 4 个 openQuestions 全部按证据裁决，无猜测。

## 三条主线自查（用户 2026-11-16 框架）

| 主线 | 状态 | 证据 |
|---|---|---|
| ① 留档完整（思考链/实验/错误） | ✅ | 本文件含失败首跑全记录；规格含 workflow 全部证据引用；EXP-001~007 在档；裁决链（OQ-B/C）留痕于 commit 与本文件 |
| ② Lauren Tan 方法论：硬约束拉高下限 | ✅ | 三层门禁在岗（本单元提交已过自家 pre-commit/commit-msg hook）；本单元 13 单测 + E2E 双判据；CB 契约以代码注释锚定（drivers.ts 顺序契约注释） |
| ③ Grok Bot 对齐 + pstack 自动化 | 🔄 | 本单元对齐「常驻记忆」（Grok Bot: persistent teammates）；流程侧首次完整走 poteto-mode 正式路由（Feature playbook 8 步 + poteto-agent 委派 + Opening a PR）；permission surfaced（对齐 approvals）与技能安装（对齐 skills）在下两单元 |
