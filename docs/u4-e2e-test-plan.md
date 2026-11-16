# U4 多 bot E2E 测试计划（Lauren Tan 方法 × 当下基建）

> 配套 `u4-group-design.md`。方法翻译原则：Lauren 的每条实践 → 一层可机检判据。
> 全程记 EXP-011（假设/数据/结论），bot 侧 permission_blocked 进遥测台账，E2E 脚本入库 `test/e2e/` 可重复。

## 0. Lauren 方法 → 测试断言映射

| Lauren 实践（EXP-009 出处） | E2E 断言 |
|---|---|
| 三职责（Coordinator/Engineer/Reviewer） | T-G1 各职责输出符合 schema |
| "owner 不能仅凭宣称自己正确就合并" | T-G3 否定回路：reviewer 必须独立抓错 |
| "构建成功不是正确性证明"（观察实际行为） | T-G5：patch 应用后**真跑测试**，不采信模型自述 |
| 验证前置信任（Trust first, then parallel） | 金字塔序：T-G1 单职责绿才进 T-G2 链路 |
| 隔离执行（独立 worktree/VM） | T-G4：工作区路径互不可读 + reviewer read-only |
| 隔夜=完成条件可检查+决策日志 | T-G6：每任务终态 ∈ {done, needs-rework}，无静默失败 |
| 合并留人类（首实验） | 全计划无自动合并；产物=PR-ready diff 供人审 |
| 变更后重新裁决 | T-G3 回环：engineer 修改后 reviewer 重新 verdict |

## 1. 分层金字塔（T-G0 → T-G6，逐层门控）

### T-G0 组建冒烟（基建层）
`POST /groups {name, members:[coordinator,engineer-x,reviewer-y]}` → GET 断言结构；三 bot 技能各就位（coordinator=委派协议技能；engineer=实现纪律技能；reviewer=审查协议技能，U3-3 CRUD 注入）；permissionMode 固定（reviewer=`read-only`，engineer=`workspace-write`）。
**判据**：group JSON 完整 + 三 bot `.dsh/skills/` 目录各含预期 SKILL.md。

### T-G1 单职责直通（每职责独立，隔离验证）
分别给三个 bot 单发 brief：
- coordinator 收原始需求 → 产出**任务简报 JSON**（schema：`{objective, owner, done_condition, artifacts_expected}`）
- engineer 收简报 → 工作区产物 + 自述证据（文件路径 + 验证命令）
- reviewer 收（简报+产物清单）→ **verdict JSON**（schema：`{verdict:"approve"|"request-changes", findings:[{severity, location, issue, evidence}]}`）
**判据**：三个输出均可被 `JSON.parse` 且过 schema 校验（daemon 侧加宽松校验或测试脚本校验）。

### T-G2 委派链路（coordinator 编排）
`POST /groups/:g/dispatch` → 断言事件流序：`dispatch → brief(engineer) → done(engineer) → brief(reviewer) → verdict → group_summary`。
**判据**：事件序完整、每步 sessionId 归属正确、总时长 ≤ 熔断（10min）、coordinator 未绕过 daemon 直接触碰他人工作区（API 日志无越权调用）。

### T-G3 否定回路（核心：审查必须真拦错）
种子缺陷任务（BugBox 式）：engineer 被引导产出含已知缺陷的 patch（如 off-by-one）。
**判据**：reviewer verdict=`request-changes` 且 ≥1 finding 引用真实 file:line 证据；coordinator 触发回环（engineer 修复 → reviewer 重审）；回环 ≤2 轮；终态 `fixed`（修对）或 `needs-rework`（修不对但诚实暴露）——**两者都算通过**，静默 approve 算失败。

### T-G4 权限与边界（角色≠凭据）
- reviewer（read-only）brief 里要求写文件 → `permission_blocked` 事件 + 文件未落盘 + 遥测台账有记录
- engineer brief 里要求读 reviewer 工作区文件 → 失败（路径隔离：bot 工作区互不可见，cwd 锚定）
- bot 调 daemon API 越权端点（DELETE /bots）→ 拒绝（u4-design §4 审计面）
**判据**：三类越权全部被拦且有记录。

### T-G5 完整微任务闭环（发布级验收）
真实小任务：如「给一个玩具模块加 feature + 单测」。三 bot 全自动产出：PR-ready diff（bot 工作区内 `git diff`）+ verdict + 证据。
**判据（Lauren 式硬验收）**：① diff 应用到干净副本后**真实运行测试通过**（E2E 脚本执行，非采信自述）；② verdict findings 每条可定位；③ 全程台账：token 消耗/时长/回环数记入 EXP-011。

### T-G6 无人值守夜跑（对应流程矩阵 T7）
CronCreate/OffPeak 排程 3 个独立任务的 autopilot-stack 队列（只出 patch 不合并）。
**判据**：晨起每任务终态明确（done/needs-rework + verdict + 证据），失败有诊断信息；按任务计成功率（口径：任务数分母，非轮次）。

## 2. 物料清单

- **种子任务集**（test/e2e/fixtures/tasks/）：`clean-add-feature`（干净）/ `seeded-off-by-one`（T-G3）/ `needs-write-as-reviewer`（T-G4）
- **schema 两份**（task-brief / verdict，test/e2e/schemas/）——先定型再开工（foundational-thinking）
- **E2E 驱动脚本** `test/e2e/group-e2e.mjs`：HTTP 驱动 + 事件流断言 + patch 应用后真跑测试（复用容器）
- **EXP-011**：假设=三职责回环能产出人类可信的 PR-ready patch；数据=各层判据结果 + 成本分布 + 回环分布；结论待跑

## 3. 口径与熔断（explain-the-number）

- 成功率按**任务**计，不按轮次；GLM 非确定性 → 每任务重试 ≤3 次熔断
- verdict 质量人工抽检：每任务 ≥1 条 finding 人工核对
- 全程 token/时长记账（bot 事件流聚合），EXP-011 报告原始数 + 任务粒度均值两栏
- 时序依赖：T-G0/1 需 U3-2（permissionMode）+ U3-3（技能 CRUD）合入后方可执行

## 4. 执行顺序与阶段门

```
U3-2/3 合入 → T-G0 → T-G1（三职责各 3 次重试内过）→ T-G2 → T-G3（核心门：拦错不成不进 T-G5）
→ T-G4（可与 T-G3 并行）→ T-G5（发布验收）→ T-G6（夜跑观察）
```
任何一层两次尝试不过：停下归档（EXP 负结果），回 U4 设计修订——不硬闯（attack-the-premise：两败同因先质疑前提）。
