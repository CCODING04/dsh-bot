# 实验档案（Lab Notebook）
> 本项目双重目标之一是**验证 pstack 工作流**，所有实验的思考过程、方法、原始数据都是 review 依据。
> 规则：每个实验一条记录，负结果同样归档（误诊过程比成功结论更有 review 价值）。
> 原始输出存 `docs/experiments/EXP-NNN-*.{txt,md}`；格式：假设 → 方法 → 数据 → 结论。
| # | 日期 | 实验 | 结果 | 关联 |
|---|---|---|---|---|
| EXP-001 | 2026-11-16 | U1 断网容器 CLI 闭环 | ✅ 通过 | `docs/phase-1-report.md` |
| EXP-002 | 2026-11-16 | 容器网络诊断（含误诊纠正） | ⚠️ 负结果+纠错 | `experiments/EXP-002-network.md` |
| EXP-003 | 2026-11-16 | GLM 路由首发验证（单发） | ✅ 通过 | `experiments/EXP-003-glm.md` |
| EXP-004 | 2026-11-16 | U2 全链 E2E（HTTP→GLM→产物） | ✅ 通过 | `docs/phase-2-report.md` |
| EXP-005 | 2026-11-16 | workflow 并行调研 U3 机制 | 🔄 运行中 | run `dwfrun-a4ebd73b…` |
| EXP-006 | 2026-11-16 | 浏览器 GUI E2E（Web Chat 真实链路） | ✅ 通过 | 本文件 §EXP-006 |
| EXP-007 | 2026-11-16 | 流程硬约束三层工程 | ✅ 通过（含 1 项时序发现） | `experiments/EXP-007-gates.md` |
| EXP-008 | 2026-11-16 | U3-1 会话记忆 + --json 驱动（OQ-5 关闭） | ✅ 通过（含首跑顺序 bug 修复） | `experiments/EXP-008-session-memory.md` |
| EXP-009 | 2026-11-16 | 角色方案调研（Lauren Tan 子代理设计） | ✅ 结论采纳（2 薄包装 + 技能即角色） | `experiments/EXP-009-role-design.md` |
| EXP-010 | 2026-11-16 | 拦截审计日志基建（逃逸闭环当日闭环） | ✅ 18/18 回归样本集 + 首日 7 拦截/3 逃逸违规 | `experiments/EXP-010-gate-telemetry.md` |
| EXP-011 | 2026-11-16 | permission_blocked 两形态实测（OQ-1 关闭） | ✅ 修正 FS_SANDBOX_DENIED 映射 | `experiments/EXP-011-permission-modes.md` |
| EXP-012 | 2026-11-16 | 独立 reviewer 协作三轮（#1/#2、#3/#4/#5、#6/#7/#8）| ✅ 三轮：approve×5 + request-changes×3（全部修复后合入）| `experiments/EXP-012-reviewer-collab.md` |
---
## EXP-001 · U1 断网容器闭环（2026-11-16）
**假设**：dsh-bot U1 骨架（daemon+CLI+stub driver）在最严格沙箱（`--network none`）下能完成 bot 生命周期全链。
**方法**：三次 `docker run --rm --network none -v dsh-bot_smoke:/state`，依次 `create demo` → `brief demo "沙箱冒烟：请整理工作区"` → `logs demo`；状态经卷跨容器持久化。
**数据**：见 phase-1 报告——事件序 `brief_received → step → done`，`lastResult: "stub run complete"`，状态机 idle→running→idle。
**结论**：U1 在零网络条件下闭环成立；stub 证据链（workspace 内文件 + 事件流）满足"prove-it-works"。
## EXP-002 · 容器网络诊断与误诊纠正（2026-11-16）★ 负结果实验
**初始假设（后被推翻）**：Docker Desktop 虚拟机出网完全故障，需用户修改网络/代理设置。
**误诊过程（review 重点）**：
1. 构建期 dsh 安装失败被 Dockerfile 的 `|| true` 静默吞掉 → 第一层信息丢失；
2. 诊断测试的目标域名全部选了 `registry.npmmirror.io`（默认/--dns 223.5.5.5/--network host 三轮），全部 `ENOTFOUND` → 得出"容器 DNS/路由全坏"；
3. **盲点**：从未对照宿主机对同一域名的可达性——事实上宿主机 `curl https://registry.npmmirror.io` 也是 `000`、宿主机 npm 同样 `ENOTFOUND`。npmmirror 域名在该网络环境整体不可达，与容器无关。
**纠正方法（分层多目标探测）**：
- 容器内：`open.bigmodel.cn` DNS 解析 ✅（47.96.134.91）+ IP 直连路由 ✅（http://223.5.5.5 → 404，路由通）→ 容器网络正常；
- 容器 vs 宿主机同域名对照：npmjs/github/bigmodel 容器内全 200，npmmirror 容器与宿主机双败 → 域名级阻断。
**数据**：`experiments/EXP-002-network.md`（四目标×双环境矩阵）。
**结论/教训**：
1. 网络诊断必须**多目标分层**（DNS / IP 路由 / 多域名）且**容器与宿主机对照**，单一靶子域名会系统性误判；
2. Dockerfile 的安装步骤禁止 `|| true` 吞错（已修复为显式失败）；
3. 该网络环境事实：`registry.npmmirror.io`、Docker Hub 直连不可达；npmjs/github/open.bigmodel.cn 可达；基础镜像走 daocloud 镜像源。
**影响**：撤销"U2 需用户修 Docker 设置"的结论；用户无需改任何设置。
## EXP-003 · GLM 路由首发验证（2026-11-16）
**假设**：dsh 自带 `llm-pi-ai` 适配器可通过 profile patch 手声明 `glm` 路由（openai-completions 协议 → open.bigmodel.cn/api/paas/v4 → glm-5.3-flash），替换 `agent-default-model` 行后 headless 可用 GLM 真实执行。
**方法**：
1. patch 语法迭代：无 id 行报 `id is required for non-insert patches` → 改为带 `id: llm-pi-ai`（插入）+ `id: agent-default-model`（替换 provider/model）；
2. 单发验证：容器内 `dsh --profile headless --patch /app/dsh-glm-patch.yml --approval-policy never '在当前目录创建文件 hello.txt，内容为 ok，然后回复：任务完成'`。
**数据**（`experiments/EXP-003-glm.md`）：模型推理文本可见（"The write tool is the right choice here…"）→ 回复"任务完成" → `cat hello.txt` = `ok`；首版缺 `--patch` 时报 `MISSING_CREDENTIAL: llm-deepseek … deepseek-official`（证明默认路由是 deepseek，必须替换 `agent-default-model`）。
**结论**：GLM 接法成立，零自研适配器；密钥经 `apiKeyEnv: GLM_API_KEY` 引用不落配置。
## EXP-004 · U2 全链 E2E（2026-11-16）
**假设**：HTTP → daemon → dshDriver → dsh headless → GLM → 产物落盘 的完整链路在 compose 服务形态下成立。
**方法**：`docker compose up -d --build` → `POST /bots {name:e2e}` → `POST /bots/e2e/brief`（真实中文任务）→ 轮询 `GET /bots/e2e` → `docker compose exec cat /state/bots/e2e/ws/e2e.txt`。
**数据**：状态机 idle→running→idle；事件 `brief_received(dsh headless · patch=… · approval=never · cwd=/state/bots/e2e/ws) → step → done`；回复 `E2E OK`；产物 `e2e.txt` = `hello-glm`。
**结论**：U2 验收通过。观察：同一模型两次任务的表达形态不同（首次带中文推理输出，本次直接 `E2E OK`）——产物是硬判据，回复文本是软信号。
## EXP-005 · workflow 并行调研 U3 机制（2026-11-16，运行中）
**假设**：U3 的三项机制调研（审批/会话/技能）相互独立，可 3 路并行调研 + 1 路整合，产出带证据的集成规格，加速主会话实现。
**方法**：CreateWorkflow（run `dwfrun-a4ebd73b-0f01-4691-9f93-32b3f388cf1e`）；3 个调研员（约束：证据优先/openQuestions 不许猜/不碰密钥/容器 --rm）+ 整合员写 `docs/u3-integration-spec.md`；主会话并行做实验存档（本文件）。
**数据**：待运行完成回填（findings 数、verified/unconfirmed 比、contradictions、wall time vs 串行估算）。
**结论**：待回填。
## EXP-006 · 浏览器 GUI E2E（2026-11-16）
**假设**：Web Chat 在真实浏览器操作（非 curl）下全链可用：建 bot → 发 brief → GLM 执行 → 事件流增量渲染 → 硬产物落盘。
**方法**：browser-use 控制 ZCode 内置浏览器，认领用户已打开的 8787 标签页（不重复开新页）；fill+click 建 `gui-test` → fill+click 发真实 brief → waitFor 20s → domSnapshot 验证事件流 → `docker compose exec cat` 验产物。一次一个状态变更动作，每个 locator 先 `count()` 验唯一。
**数据**：事件流渲染序 = 用户消息 → `状态：idle GUI 闭环完成`（bot 回复）→ `[step] dsh exited; answer head: GUI 闭环完成` → `[done]`；2s 轮询增量呈现新事件；产物 `/state/bots/gui-test/ws/gui-e2e.txt` = `browser-test-ok`。
**结论**：GUI 全链通过。附带发现：用户在此之前已自行用 e2e bot 完成一次任务（页面留有完整事件史）——Web Chat 对真实用户可用。
**方法沉淀**：GUI 测试协议 = 认领用户标签页（不新开）→ locator 唯一性验证 → 单动作单观察 → DOM 快照断言 + 容器产物断言双重判据。

## EXP-013 · 真 GLM 三 bot 否定回路 E2E（T-G2/T-G3 验证）
**假设**：dispatch 编排（coordinator→engineer→reviewer + 回环）在真 GLM 下可完成正向链路并触发否定回路。
**方法**：E2E 容器 dsh-bot:e2e-v5（含 parseVerdict 同义词 + 截断上限 10000 + pngSha256），dispatch 种子任务（greeting.txt 精确 16 字节），30s 轮询。
**数据**：
- 第一次 dispatch（截断修复前）：rounds=1 → failed（parseVerdict null on "fail"）——根因：2000 字符截断导致 JSON 残缺
- **第二次 dispatch（截断修复后）：rounds=2 → done|rounds=1，reviewer verdict="pass"，独立执行 wc -c/cmp/sha256sum 三项验证，reviewer 与 engineer 实测逐项吻合**
- 否定回路：reviewer 独立发现路径偏差（coordinator ws 空 vs engineer ws 有产物），2 轮 request-changes → 诚实 needs-rework（架构约束：工作区隔离）
**结论**：T-G2 正向链路 ✓；T-G3 否定回路 ✓（reviewer 独立拦截 + 回环触发 + 诚实 failed）。parseVerdict 同义词扩展（fail/PASS/reject 等）已验证。遗留：种子缺陷精化（后续单元）。
