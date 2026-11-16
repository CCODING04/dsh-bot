# U3 集成规格：审批 × 会话延续 × 技能（dsh 0.2.2-rc.1）

> 面向实现者。整合三份 U3 机制调研（审批 / 会话 / 技能），并做交叉复核。
> 证据基线：三份调研的容器实测与上游文档取证（证据文件在 `<ws>/.tmp/dsh-approval-research/`、`.tmp/dsh-session-research/`、`.tmp/dsh-skill-probe/`），以及本次整合时补充的复现实验（见 §0.2，镜像 `dsh-bot:dev` / dsh 0.2.2-rc.1，`--network none`）。
> 所有"容器实测"均指 dsh 0.2.2-rc.1 容器行为；上游 master 文档与部署版本存在已知滞后（见 C6/C7）。

---

## 0. 交叉复核结论

### 0.1 矛盾与互相影响点裁决

| # | 类型 | 冲突/影响 | 裁决 | 依据 |
|---|------|-----------|------|------|
| C1 | **硬矛盾（实测对实测）** | 会话调研：「无 key 失败命令跑完后 DSH_HOME 下什么都没留下……连 sessions root 目录都不创建」「失败运行产生的 sessionId……下次 --session-id 它会报 does not exist」 vs 技能调研：无 key（MISSING_CREDENTIAL）失败轮次的会话日志存在且含技能目录消息（`$DSH_HOME/sessions/--probe--/<id>/session.v4.jsonl.zstd`） | **以本次复现为准：失败轮次落盘且其 id 可 resume**。三向对照（/bare 无技能、/tmp 会话调研原场景、/probe2 有技能）MISSING_CREDENTIAL（exit=1）后 `session.v4.jsonl.zstd` 全部存在；同容器内用失败轮次 id 再跑，resume 校验通过且 `turn_start turn=2`（轮次计数延续）。会话调研的"完全不落盘"在当前镜像无法复现（成因不可追溯：疑为时点/镜像构建或命令形态差异）。jsonl README 的惰性物化原文（"created-but-never-appended session leaves nothing on disk unless its owner calls handle.flush()"）仍成立，但 MISSING_CREDENTIAL 轮次并非 never-appended——user turn / turn_end error 等事件已 append 并 flush | §0.2 复现实验 A / A2 / B / C；`.tmp/dsh-skill-probe/session-log-evidence.txt:3`、`session-decompress.txt:1-2`；会话调研引 jsonl README L77 |
| C2 | 互相影响 | 审批审计事件（approval/asked、approval/decided 写入 Session 日志）× 轮次落盘条件：若失败轮次不落盘，审批审计也会丢 | 经 C1 修正后：失败轮次实测也 flush，故审批审计事件原则上随轮次日志持久化。但"日志必在"仍不应作为硬依赖（flush 是实现细节；文档级保证仅覆盖 never-appended 场景）。dsh-bot 的审批可见性主通道仍是事件流 `tool_result.error`，持久日志只作截断场景的补充读取 | 审批调研引 docs/subsystems/approval.zh.md:11/86、user-approval README.md:53/168；C1 实验 |
| C3 | 互相影响（组合契约） | 审批策略 × 会话延续：授权选项（--permission-mode / --approval-policy / --add-dir）不跨调用持久、resume 不恢复权限姿态（会话调研）；而 headless 默认审批策略由 env 推导（`DSH_PERMISSION_MODE ?? 'workspace-write'` → ask），ask 无应答者 = **静默 fail-closed**（审批调研） | 每次调用独立决定权限姿态。**daemon 每次调用必须显式传 `--approval-policy`**（推荐 never）：任何一次漏传都会静默回退到 workspace-write+ask（fail-closed 且用户毫不知情）。两份调研结论一致，组合成硬契约"每调用必传" | 会话调研引 headless README.zh.md L90；审批调研引 dump-config 行 158-163 公式、user-approval README.md:32/167 |
| C4 | 互相影响（未实测，推理组合） | 技能目录消息是"存活会话中……注入初始的持久 user-role `<system-reminder>`"（技能调研）× Session 是 append-only 日志、消息历史由重放推导（会话调研） | resume 旧会话时，模型看到的是**首次运行时注入的历史目录快照**；此后技能文件增删不会改写已入日志的目录消息。进程启动时重新扫描的是文件系统，但 resume 会话是否注入反映当前技能集的新目录消息**未实测**（openQuestions OQ-15）。集成含义：变更技能集后应新开会话，不要假设旧会话目录自动刷新 | 技能调研引 docs/subsystems/skills.zh.md「会话目录与工具约定」；会话调研引 docs/subsystems/session.md L5 |
| C5 | 互相影响（共同锚点） | 技能 projectRoot = 最近含 .git 的祖先（技能调研）× 会话按 cwd 归组 + resume 校验 cwd 一致（会话调研）：三机制都锚定 spawn 时的 cwd | cwd 是三机制共同锚点：**同一 bot 每次必须在同一 cwd（其工作区）下运行**，且 **/state 卷路径上不得出现任何 .git 目录**（否则技能 projectRoot 上移、`ws/.dsh/skills` 失效——技能调研实测目录计数 0）。在 bot ws 内自建 .git 钉住 projectRoot 是等效防御措施，对会话机制无副作用（cwd 不变） | 技能调研引 dsh-skill-filesystem README「Roots and priority」、nested-git-root2.txt 实测；会话调研引 README.zh.md L77/L96；daemon.ts:65、docker/Dockerfile VOLUME [/dsh-home,/state] |
| C6 | 文档 vs 实测（已裁决） | master 文档 permission-presets 默认表只列 workspace-write / danger-full-access，容器 0.2.2-rc.1 实际多出 read-only | 以容器枚举为准：`read-only, workspace-write, danger-full-access`。两份独立调研的 `--dump-config` 互证（本次整合已 grep 复核技能侧 dump 第 165-176 行，presets 三个俱全）。升级 dsh 版本时需重验 | 审批调研引容器 `--dump-config` 与未知 preset 报错枚举；`.tmp/dsh-skill-probe/dsh-headless-dump-config.txt:165-176` |
| C7 | 文档 vs 实测（已裁决） | master jsonl README 布局图写 v3/current，容器 0.2.2-rc.1 日志代际为 v4 | 以 v4 为准：三份调研与本次复现实验（A/A2/B/C 全部产生 `session.v4.jsonl.zstd`）一致。文档滞后 | 会话调研引 v3-to-v4 迁移包（version:4 常量）；`.tmp/dsh-skill-probe/session-log-evidence.txt:3`；§0.2 |
| C8 | 代码 vs 证据（本次整合发现） | 现有 `BotEvent` 类型已预留 `approval_request` 事件（dsh-bot/src/drivers.ts:8），但 headless 事件流**不存在审批请求事件** | `approval_request` 在 dsh driver 下永远不会被触发。应将其语义替换为**事后信号** `permission_blocked`（由 `tool_result.error.code` 映射，见 §2 CB4），或在事件模型中并存并注明前者仅 ACP 架构备选下可用 | 审批调研引 headless README.md:100「Headless has no live approval-response channel」、json-stream.ts:258-317 投影词汇；drivers.ts:8 核实 |

### 0.2 本次整合补充的复现实验（裁决 C1 的依据，全部在本 ask 内运行）

镜像 `dsh-bot:dev`（194f28993386），`docker run --rm --network none -e DSH_HOME=/tmp/dshh`：

| 实验 | 命令要点 | 结果 |
|---|---|---|
| A | `mkdir -p /bare && cd /bare && dsh --profile headless --json "say hi"`（无技能、无 key） | exit=1（MISSING_CREDENTIAL）；`find /tmp/dshh` 显示 `sessions/--bare--/session-56d4af73-6d92-4ca6-8692-52401676e540/session.v4.jsonl.zstd` **存在** |
| A2 | 精确复现会话调研场景：`cd /tmp && dsh --profile headless --json "say hi"` | exit=1；`sessions/--tmp--/session-ad0c0bab-…/session.v4.jsonl.zstd` **存在** |
| B | `mkdir -p /probe2/.dsh/skills/s1`（含合法 SKILL.md）后同命令 | exit=1；`sessions/--probe2--/session-fa6dd3ea-…/session.v4.jsonl.zstd` **存在** |
| C | 同容器内第二次运行：`dsh --profile headless --json --session-id <实验内第一次失败轮次的id> "hi again"` | stdout 首行 `{"type":"session","sessionId":"session-42446952-…"}`，随后 `turn_start turn=2`——**resume 校验通过，轮次计数延续**（该次运行随后同样因无 key 失败，与 resume 无关） |

---

## 1. 三项机制各自的契约

### 1.1 审批（approval）

- **A1 取值域**：`--approval-policy` 仅 `ask | never`（commander choice 校验）；非法值在 --json 模式输出 `{"type":"error","message":"option '--approval-policy <policy>' argument 'bogus' is invalid. Allowed choices are ask, never."}` 并 exit=1。
  【证据】容器实测 `echo "test" | docker run --rm -i -e DSH_HOME=/tmp/dshh dsh-bot:dev dsh --profile headless --json --approval-policy bogus -`；`dsh --profile headless --help`；`type ApprovalPolicy = 'ask' | 'never'`（docs/subsystems/approval.zh.md:46）。

- **A2 ask 的行为（headless 下）**：stdin 非交互管道下遇到需审批操作**不挂起、不读 stdin**——headless 组合了 dsh-user-approval 但未组合任何应答者，ask 落到空 waterfall 的默认值 `unavailable`（fail-closed），调用方一律按拒绝处理，工具结果带 `SandboxEscalationError`（code `SANDBOX_ESCALATION_UNAVAILABLE`）。审批触发路径：被沙箱阻止的文件操作报 `[sandbox: file access denied under <mode> mode]` 后模型可带 `sandbox_permissions+justification` 重试一次，该重试才引发审批。
  【证据】容器 `--dump-config`（99 行 patch）只有 approval 服务无任何应答者；user-approval README.md:32「Without a terminal answerer, requests resolve unavailable and fail closed」、:167；approval.zh.md:21/41-46；tool-bash README.zh.md:70/199（错误码族 `SANDBOX_ESCALATION_INVALID_ARGUMENT/_UNAVAILABLE/_REJECTED/_CANCELLED`）。

- **A3 事件流无审批事件**：--json NDJSON 词汇仅 `session/status/text/thinking/tool_call/tool_result/final/error`；`approval/asked`、`approval/decided` 是 log-only SessionEvent，被投影层 default 分支丢弃。外部进程无法经事件流应答审批；审批结果只能从 `tool_result` 事件的 `error` 字段（`{name, code, reason?}`）间接感知。
  【证据】json-stream.ts:258-317（switch 只投影 turn/step/assistant/tool 事件，default return）；:320/:327 写 session/final；headless README.md:100「Headless has no live approval-response channel.」；README.zh.md:104-106；user-approval README.md:57/147；容器实测事件流（无密钥失败形态）只见 session/status/turn_end/final。

- **A4 permission preset**：`--permission-mode` 三值：`read-only`（sandbox=read-only+approval=ask）、`workspace-write`（workspace-write+ask）、`danger-full-access`（danger-full-access+never）；`custom` 是派生显示态不可选，`auto` 是 experimental 保留名（danger-full-access+ask），默认 headless 未组合 auto-review，选 auto 按未知预设失败。**注意 master 文档默认表缺 read-only，以容器枚举为准**（C6）。
  【证据】容器 `--dump-config` presets 原文；容器实测未知预设报错 `permission: unknown preset "bogus" (known: read-only, workspace-write, danger-full-access)` exit=1；permission-presets.zh.md:11/:49；容器 dump-config grep auto-review 无命中。

- **A5 默认值推导**：`policy = (DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'`；sandbox 默认 mode 同样取 `DSH_PERMISSION_MODE ?? 'workspace-write'`。即默认（无 env）headless 以 workspace-write+ask 运行 = 静默 fail-closed。
  【证据】容器 `--dump-config` 行 141-146（sandbox-policy）与行 158-163（approval policy 公式）；本次整合 grep 复核 `.tmp/dsh-skill-probe/dsh-headless-dump-config.txt:158-176` 一致。

- **A6 选项应用顺序**：runner 在任务提交前先 `permissions.set(session, preset)`（一次写 sandbox+approval 两 knob），随后 CLI 显式 `--approval-policy` 若与当前 override 不同则 `setApprovalPolicy` 覆写——**--approval-policy 后于 preset 生效**，可覆盖 preset 隐含策略；未知 preset 在任务运行前抛错（--json 下 error 事件、无 final）。
  【证据】packages/bundle/headless/src/index.ts:339-348 与 :403-405（`permissions.set(...)` 后 `setApprovalPolicy(...)`）；cli-help.md:121-122。

- **A7 机器应答通道（仅 ACP）**：真正的标准机器应答通道是 `dsh --profile acp`（stdio JSON-RPC/MCP）：客户端经 `session/request_permission` 收到带一次性允许/拒绝选项的权限提示并可自动应答；ACP 桥接层为其 agent 充当机器应答者（要求请求带 callId）。headless 无法扩展出应答通道。
  【证据】acp README.zh.md:74 协议调用表；approval.zh.md:5；cli-help.md:88-98；user-approval README.md:166。

- **A8 审计可见性**：每次审批在发起会话的 Session 日志写入 `approval/asked` 与 `approval/decided` 事件对（仅记日志、不进模型 transcript）；轮次外发起的请求直接抛错；崩溃恢复不重放挂起审批（pending approvals 是进程局部的）。
  【证据】approval.zh.md:11/86；user-approval README.md:53、:168。落盘条件受 C1/C2 约束。

### 1.2 会话（session）

- **S1 id 的产生**：session id 由 dsh 自动生成，格式 `session-<uuid>`；监督进程必须用 `--json` 从事件流第一个 `session` 事件的 `sessionId` 字段获得（纯文本模式 stdout 只有最终答案，拿不到 id）；末行 `final` 事件带同名字段可交叉校验。
  【证据】headless README.zh.md L77/L92；json-stream.ts L320、L327；容器实测首行 `{"type":"session","sessionId":"session-56d98115-…","cwd":"/tmp"}`。

- **S2 持久化布局**：root 为 `<DSH_HOME>/sessions`（`dshHomePath('sessions')`），三层布局 `<root>/--<normalized-cwd>--/<encoded-id>/session.v4.jsonl.zstd`（zstd 压缩 JSONL；0.2.2-rc.1 代际 v4，C7）；session id 注入式转义为单一安全路径段。
  【证据】cordis.patch.yml L138-141；容器 `--dump-config` 同文；persistence-jsonl README L59-71/L73；v3-to-v4 迁移包 `version: 4` 常量；`.tmp/dsh-skill-probe/session-log-evidence.txt:3` 与 §0.2 实验 A/A2/B 的实际路径。

- **S3 失败轮次的落盘（C1 修正后）**：**实测失败轮次（MISSING_CREDENTIAL，exit=1）也落盘且其 id 可 resume**（§0.2 实验 A/A2/B/C）。jsonl README 的惰性物化保证（"created-but-never-appended session leaves nothing on disk unless its owner calls handle.flush()"）覆盖的是从未 append 的会话；MISSING_CREDENTIAL 轮次已 append 事件并 flush。会话调研原始实测（"完全不落盘"）无法在当前镜像复现，**不作为集成依据**；但"失败轮次是否落盘"不应被任何一侧当作硬依赖。
  【证据】§0.2 四实验；jsonl README L77；`.tmp/dsh-session-research/` 原始实测记录（保留用于追溯）。

- **S4 resume 不存在的 id**：任务运行前立即失败，stderr 报 `dsh: session "<id>" does not exist; omit --session-id to start a new Session`，exit=1；--json 模式 stdout 只写一条 `{"type":"error","message":…}`、**无 final 事件**。
  【证据】容器实测（0.2.2-rc.1）json/非 json 两形态；headless README.zh.md L136；cli-help.md L117-118。

- **S5 上下文延续机制**：Session 是 append-only 事件日志，LLM 消息历史由日志重放推导（不单独存储）；resume 同 id 时第一次的交换作为对话历史被模型看到。
  【证据】docs/subsystems/session.md L5；e2e resume.e2e.ts L11-17/L59-61（key-gated，代码断言级证据）；headless README.zh.md L12。真实 key 端到端未实测（OQ-9）。

- **S6 resume 前置校验与授权不持久**：cwd 必须与首次运行一致；拒绝子 agent 会话、无记录 cwd、preset 不匹配/记录畸形的会话、以及本进程内已有同 id 活 Agent 的情况；`--add-dir/--permission-mode/--approval-policy` 等授权**不跨调用持久**，resume 时必须重新传（与 C3 组合）。
  【证据】headless README.zh.md L77/L90/L191；persistence.md L110。

- **S7 崩溃恢复纪律**：监督者中断进程后必须等待进程退出再 resume 其 Session（单写者独占）；同一 bot 的任务必须串行排队，前一个进程退出后再 resume。
  【证据】headless README.zh.md L96；会话调研单写者语义分析。跨进程并发 resume 的具体报错形态未实测（OQ-13），dsh-bot 侧按串行规避。

- **S8 凭据解析**：启动环境变量 → `<运行目录>/.env` → `$DSH_HOME/.env` 三级后备；headless 禁用托管凭据存储（GUI 存的 key 不用）；无 key 时模型请求发出前报 `MISSING_CREDENTIAL`。
  【证据】headless README.zh.md L56；容器实测无 key 报错全文（code=MISSING_CREDENTIAL）。

### 1.3 技能（skills）

- **K1 双通道定位**：bot「技能」与 dsh「插件」是两条不同通道。推荐 bot 技能走**每 bot 工作区 `.dsh/skills/`**（纯数据文件），不全局装 plugin。
  【证据】技能调研整体结论；dsh-bot 现状 drivers.ts:61-64（cwd=workspace spawn）+ dsh-skill-filesystem 按 cwd 发现。

- **K2 发现根与优先级**：rank 100 `<projectRoot>/.dsh/skills`、200 `<projectRoot>/.agents/skills`、300 `Config.customSkillDirs`、400 `<DSH_HOME>/skills`、500 `$DSH_AGENTS_HOME|~/.agents/skills`、600 bundled；**projectRoot = 最近含 .git 的祖先目录，找不到才用 cwd**；低 rank 赢重名；发现按 lookup 的 cwd 进行（cwd 敏感）。
  【证据】dsh-skill-filesystem README「Roots and priority」表（`.tmp/dsh-skill-probe/dsh-skill-filesystem-readme.txt`）；上游 docs/subsystems/skills.zh.md「本地发现优先级」。

- **K3 技能文件形态**：扫描根顶层目录包 `<name>/SKILL.md` 或扁平文件 `<name>.md`（嵌套 `**/SKILL.md` 故意不发现）；frontmatter 必填 `name`（kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`）与 `description`，可选 `whenToUse/metadata/disable-model-invocation/user-invocable`；目录（摘要）与正文分离，每次加载重读文件。
  【证据】dsh-skill-filesystem README；skills.zh.md「skill 身份」节。

- **K4 注册三件套已内置**：`@deepseek-ai/dsh-skill`（注册表服务 ctx.skills，合并目录/重名按 rank 裁决/按需加载）+ `dsh-skill-filesystem`（本地发现）+ `dsh-tool-skill`（模型 `skill({name})` 工具）已是 headless profile 默认挂载，**无需安装**。
  【证据】容器 dump-config（`.tmp/dsh-skill-probe/dsh-headless-dump-config.txt:202-206`）；dsh-skill README「resolves duplicate names predictably…includes no skill content itself」。

- **K5 注入时机（端到端实证）**：headless 会话启动即在**首个模型步前**把目录注入持久 user-role `<system-reminder><available_skills>`（只含排序的 name + 规范化 XML 转义的 description，不含正文/路径/来源）；模型经 `skill({name})` 工具按需加载正文；发现不依赖密钥。
  【证据】容器实测：/probe 放技能后无 key 运行，解压会话日志已含目录消息（`.tmp/dsh-skill-probe/catalog-full-text.txt`、`session-decompress.txt`）；skills.zh.md「会话目录与工具约定」。

- **K6 projectRoot 陷阱（实证）**：bot 工作区上层出现 .git 时，工作区自己的 `.dsh/skills` 完全不被发现；技能为空时连目录消息都不注入（完整空视图不发送任何内容）。
  【证据】对照实验 nested-git-root2.txt：`grep -c available_skills` = 0；skills.zh.md 空视图不发消息。

- **K7 现有集成形态**：dshDriver 以 `cwd = $DSH_BOT_STATE/bots/<name>/ws`（/state 卷内、无 .git，cwd 即 projectRoot）spawn `dsh --profile headless --patch <GLM> --approval-policy never -`，brief 从 stdin 传入；会话按 cwd 归组存储。
  【证据】drivers.ts:61-64、daemon.ts:65、docker/Dockerfile（ENV DSH_HOME=/dsh-home、DSH_BOT_STATE=/state、VOLUME [/dsh-home,/state]）；本次整合已复核 drivers.ts 与 daemon.ts 现状（drivers.ts:63 确无 --json/--session-id）。

- **K8 插件通道（不用于 bot 技能）**：`dsh plugin --profile <name> add <pkg>` 把组合包装进 `$DSH_HOME/profiles/<name>`（pnpm 执行，落 node_modules/package.json 依赖/dsh.profile.bundles/cordis.patch.yml disabled 覆盖），**改动影响使用该 profile 的全部会话**（容器级全局，无法按 bot 隔离）；当前镜像无 pnpm，实测 `spawn pnpm ENOENT`。仅代码级扩展（新工具/provider）才走此通道或继续用 --patch overlay。
  【证据】`dsh plugin --help` 实测；plugin-manager README.zh.md；实测 add 失败输出（profile-init-layout.txt）；dsh README.zh.md。

- **K9 共享技能**：所有 bot 通用技能放 `$DSH_HOME/skills`（rank 400），或在 DSH_PATCH overlay 给 dsh-skill-filesystem 加 `customSkillDirs: [...]`（rank 300）；bot 工作区技能（rank 100）天然压过全局，可做 per-bot 覆盖。
  【证据】K2 rank 表；技能调研 integrationNotes 第 4 点。

---

## 2. 组合行为（跨机制契约）

- **CB1 cwd 是三机制共同锚点（C5）**：同一 bot 的每次调用必须同一 cwd（bot 工作区）。它同时决定：① 会话存储归组（`--<normalized-cwd>--`，S2）；② resume 校验通过与否（S6）；③ 技能 projectRoot（无 .git 时 cwd 即 projectRoot，K2/K7）；④ 凭据二级后备 `<cwd>/.env`（S8）。前置条件：**/state 卷路径上没有任何 .git 目录**（C5）。

- **CB2 每次调用独立决定权限姿态（C3）**：会话延续不延续权限配置。resume 时漏传 `--approval-policy` 会静默回退 env 推导（默认 ask = fail-closed，A5）。契约：daemon 每次调用显式传 `--approval-policy never`（无人值守推荐姿态；approval.zh.md:44 称 never 为 "The strict headless stance (CI, unattended runs)"，且 never 下运行时上下文快照会告知模型不要请求 sandbox_permissions，避免浪费轮次）。如需 sandbox 约束，同时显式传 `--permission-mode read-only|workspace-write`（--approval-policy 后于 preset 生效可覆盖其隐含 ask，A6）。

- **CB3 失败轮次与会话绑定策略（C1 裁决后的决策点）**：技术上失败轮次的 id 也可 resume（实验 C），因此绑定策略是**语义决策而非技术必须**。推荐保守策略：只在 `exit==0 && final.reason.kind==="completed"` 后把 sessionId 写入 bot→session 绑定；失败重试默认**不带 --session-id** 开新轮（不自动延续失败上下文，且不依赖"失败轮次落盘与否"这一不稳定实现细节）。若产品语义要求"失败也续同一会话"（例如保留已完成的中间步骤），实验 C 证明可行，但需自行验证非 MISSING_CREDENTIAL 类失败（如超时 kill 后的 interruptedTurnClosers 补写路径，S7/persistence.md L110）。

- **CB4 审批的 surfaced 是事后信号（A3 + C8）**：headless 无审批请求事件、无应答通道。daemon 解析 `tool_result` 事件，把 `error.code ∈ {SANDBOX_ESCALATION_UNAVAILABLE, SANDBOX_ESCALATION_REJECTED, SANDBOX_ESCALATION_CANCELLED, AUTO_REVIEW_DENIED, AUTO_REVIEW_FAILED}` 映射为 HTTP 层 `permission-blocked` 事件/状态；error 形态 `{name, code, reason?}`。注意事件流是投影：final 之外字符串上限 8KiB/行上限 32KiB，截断记录可能省略结构化详情——需完整理由时读持久 Session 日志（C2：失败轮次实测也落盘，该路径可用，但仅作补充）。现有 `BotEvent.approval_request`（drivers.ts:8）在该架构下永不可触发，改为 `permission_blocked`。

- **CB5 事件流解析统一契约**：NDJSON 按行解析，词汇 `session/status/text/thinking/tool_call/tool_result/final/error`。判定成败 = **进程退出码 + `final.reason.kind==='completed'`** 双条件；轮次内失败仍以 final（reason.kind=error）结束且无 error 事件；runner 挂载前的用法/参数错误（非法 --approval-policy、未知 preset、resume 不存在 id）只有单个 error 事件**无 final**。首行 session 事件拿 sessionId，末行 final 交叉校验同 id。
  【证据】A1/A3/S1/S4 及三份调研容器实测的失败形态。

- **CB6 技能 × 会话延续（C4）**：目录消息是入日志的持久内容；resume 后模型看到的历史目录快照不随后续技能文件增删而变。变更技能集后建议开新会话；resume 会话是否注入新目录消息未实测（OQ-15）。

- **CB7 技能 × 审批（本次组合推论）**：技能是纯数据（SKILL.md），不经审批通道安装（K1）；但技能正文若指示模型执行需升权的操作，在 never 策略下会被拒并产生 `SANDBOX_ESCALATION_*` → permission-blocked 事件（CB4）。技能内容设计应避免诱导越权；web 端把 permission-blocked 呈现给用户后，可按需临时以更高 `--permission-mode` 重试。

- **CB8 串行与生命周期（S7）**：headless 一次进程只跑一个任务；bot 的"会话记忆" = 同一 sessionId 串起来的多次一发式运行。同一 bot 的任务串行排队（同 id 不能被并发驱动；写句柄单写者独占），前一个进程退出后再 resume。超时 kill 的进程必须等退出（进程 close 事件）后才允许下一次调用——现有 driver 的 `child.kill("SIGKILL")` + `close` 回调模式（drivers.ts:68-78）已满足该纪律。

- **CB9 持久化三元组**：会话延续需要三样东西同时持久：① `$DSH_HOME` 卷（sessions 本体，S2）；② bot→session 绑定映射（daemon 自建）；③ bot 工作区 cwd（/state 卷）。映射丢失但卷还在时理论上可经 sessionPersistence.list()/session-query 枚举找回，但 encoded-id/cwd 编码规则复杂——**首选保证映射不丢**。

- **CB10 架构级备选（A7）**：若产品需要真正的交互式审批应答，不在 headless 上造通道；改用 `dsh --profile acp` 作为 per-session stdio 子进程，daemon 充当 ACP 客户端应答 `session/request_permission`（一次性 allow/deny），多会话单连接、支持 session/resume。这是 driver 从"管道 headless"到"ACP 客户端"的架构替换，需先做协议级取证（OQ-2）。

---

## 3. daemon / driver / web 需要的改动清单

### 3.1 driver（dsh-bot/src/drivers.ts）

现状核实（本次整合读取）：spawn 参数 `["--profile","headless","--patch",patchPath,"--approval-policy",approvalPolicy,"-"]`，`{cwd: workspace, stdio:["pipe","pipe","pipe"]}`，stdout 以纯文本收集当 answer（drivers.ts:61-88）。

1. **加 `--json`**：改为 NDJSON 模式，stdout 不再是纯文本 answer。
2. **加 `--session-id <id>` 透传**：daemon 传入绑定的 sessionId；无绑定（首跑/失败重开）时不传。
3. **加 `--permission-mode <mode>` 可选透传**：与 `--approval-policy` 顺序无关（A6：CLI approval 覆盖 preset 隐含值），默认不传时受 `DSH_PERMISSION_MODE` env 推导（A5）——daemon 层应给出确定值而非依赖 env。
4. **NDJSON 流式解析器**：逐行解析（CB5 词汇表）；产出结构化结果 `{sessionId, finalReasonKind, text, toolResults[], exitCode}`；区分三类终止：正常 final / 轮次内失败 final（reason.kind=error）/ runner 级 error（无 final）。
5. **permission-blocked 映射**：`tool_result.error.code` ∈ CB4 集合 → `BotEvent.kind: "permission_blocked"`；将 drivers.ts:8 的 `approval_request` 事件类型替换或并存标注（C8）。
6. **保留现有纪律**：SIGKILL 超时 + 等 close（CB8）；stdin 传 brief；stderr 收集尾部用于诊断。
7. 失败重试调用**不带 --session-id**（CB3 推荐策略，由 daemon 决定，driver 只按参数执行）。

### 3.2 daemon（dsh-bot/src/daemon.ts）

1. **bot→session 绑定存储**：随 bots.json 或独立文件持久化 `bot_id → {sessionId, cwd}`；只在 `exit==0 && final.reason.kind==="completed"` 后写入（CB3）；同 cwd 字段冗余存储便于自检（resume 校验用，S6）。
2. **任务串行队列（per bot）**：同一 bot 的任务排队，前一个进程 close 后再启动下一个（CB8）；不同 bot 可并行（各自独立 cwd/工作区）。
3. **固定 cwd 契约**：每次以 `$DSH_BOT_STATE/bots/<name>/ws` 为 cwd spawn（CB1）；启动时校验 /state 路径上无 .git（C5/K6），或在创建 bot 时在 ws 内 `git init` 钉住 projectRoot。
4. **每调用显式权限参数**：`--approval-policy never` 默认（现状已是 drivers.ts:49 默认 never，保持）；新增按 bot/按请求的 `--permission-mode` 配置项（CB2）。
5. **bot 技能管理 API**：写 `$DSH_BOT_STATE/bots/<name>/ws/.dsh/skills/<skill-name>/SKILL.md`（frontmatter 校验：name kebab-case、description 必填，K3）；增删改即文件操作，下次 headless 调用自动重新发现（K2/K5）；变更技能后按 CB6 决定是否建议开新会话。
6. **共享技能目录**：`$DSH_HOME/skills`（rank 400）放全局技能；或扩展 DSH_PATCH overlay 加 `customSkillDirs`（rank 300，K9）。不走 plugin 通道（K8：容器级全局 + 镜像无 pnpm）。
7. **凭据注入**：key 经环境变量注入容器（env → `<cwd>/.env` → `$DSH_HOME/.env` 三级，S8），不落盘不进日志。
8. **事件转发**：把 driver 的结构化事件（含 permission_blocked、finalReasonKind）转成 HTTP 层事件/状态给 web。
9. **持久化三元组保障**（CB9）：/dsh-home 与 /state 卷已在 Dockerfile VOLUME 声明，保持；绑定映射与卷同生命周期备份。

### 3.3 web（dsh-bot/web）

1. **会话延续可视化**：展示 bot 当前绑定的 sessionId、每次运行的 finalReasonKind、运行历史（同 id 串起的轮次）。
2. **permission-blocked 呈现**（CB4）：把 `SANDBOX_ESCALATION_*` / `AUTO_REVIEW_*` 错误码翻译为用户可读的"被权限策略阻止"状态，附 `reason` 文案；提供"以更高 --permission-mode 重试"入口（CB7）。
3. **bot 技能管理界面**：列出/新增/编辑/删除 bot 技能（对应 daemon API 5），编辑器写 SKILL.md（frontmatter 提示 name/description/whenToUse 等）；提示"技能变更对已绑定会话的历史目录不生效"（CB6）。
4. **权限配置界面**：per bot 的 --permission-mode 选择（read-only / workspace-write / danger-full-access，容器枚举为准，C6）+ approval 固定 never 的说明（不可配 ask——headless 下 ask = 静默 fail-closed，A2/C3）。
5. 失败重试语义提示：默认失败重试开新会话（CB3），若实现"续失败会话"选项需明确标注实验性（依赖 C1 实测行为）。

---

## 4. openQuestions 汇总（三份调研合并 + 整合新增）

**审批（源：审批调研）**
- OQ-1 无 LLM key，未实测真实模型驱动下 ask 策略触发沙箱升权审批的端到端运行：`tool_result.error.code` 是否确切呈现 `SANDBOX_ESCALATION_UNAVAILABLE`（当前结论基于 tool-bash README.zh.md:199 文档，未跑通完整链路）。
- OQ-2 ACP `session/request_permission` 逐字段报文结构（requestId、options 格式、应答方法名）未与 ACP v1 协议规范核对；若走 CB10 备选需另做协议级取证。
- OQ-3 `--permission-mode auto` 启用 auto-review 的具体组合步骤（--patch overlay 内容）未实测；启用后 auto preset 是否出现在 known 列表未验证。
- OQ-4 preset 枚举版本差异（master 文档缺 read-only，容器 rc.1 有）：固定 0.2.2-rc.1 时以容器为准；升级 dsh 版本需重验（C6）。

**会话（源：会话调研；OQ-10/14 经 C1 修正）**
- OQ-5 真实 DEEPSEEK_API_KEY 下"同 id 两次运行第二次能复述第一次事实"的端到端行为未实测（证据为 resume.e2e.ts 代码断言 + session.md/persistence.md 文档）。
- OQ-6 v4 格式变更细节（docs/persistence-changes/2026-09-16-session-format-v4.md）未逐字核对。
- OQ-7 encoded-id 注入转义与 `--<normalized-cwd>--` 目录名精确编码算法未读源码核对（对集成无影响，dsh-bot 不直接拼这两个路径）。
- OQ-8 `--session-id` 传空串/带空白字符串的行为未实测（README L77 称标识不透明、原样使用）。
- OQ-9 ~~真实 key 端到端~~（同 OQ-5，合并）。
- OQ-10 **（已被 C1 部分回答）**"失败轮次不落盘、id 不可 resume"已证伪于当前镜像；残留问题：落盘/flush 的精确触发条件（何种失败形态会 never-append）未系统测定。
- OQ-11 同一 sessionId 跨进程并发 resume（两容器同时 --session-id 同一 id）的具体报错形态未实测；dsh-bot 按串行排队规避（CB8）。
- OQ-12 /tmp 下 `dsh-spill-*` 残留目录生命周期未查证（与 session 延续无关）。

**技能（源：技能调研）**
- OQ-13 plugin add 的成功路径未端到端实测（镜像无 pnpm，为遵守 --network none 纪律未装）；装完后组合包如何进入配置树、cordis.patch.yml 实际 diff 形态仅文档证据。
- OQ-14 长驻会话内技能热更新（Chokidar watch）未实测；对 dsh-bot 的多次独立 headless 调用无影响（每次启动重新发现）——与 OQ-15 相关但不同。
- OQ-15 **（整合新增，C4）** resume 的会话是否注入反映当前技能集的新目录消息：技能增删后旧会话内模型可见性未实测。集成侧先按"不刷新"保守处理（CB6）。
- OQ-16 容器内 `$DSH_AGENTS_HOME` 未设置时 `~/.agents=/root/.agents` 的实际内容未检查（推测为空、不影响发现）。
- OQ-17 `dsh plugin` 对非随附名称新 profile 初始化为 base 根未实测（仅文档证据；dsh-bot 不走此通道，K8）。

**整合新增**
- OQ-18（C1 后续）会话调研原始"不落盘"实测与本次复现的差异成因（镜像构建时点 / 命令形态 / flush 竞态）无法追溯；若后续复现出"不落盘"形态，CB3 的保守绑定策略不受影响，但 CB9 的找回路径需重估。

---

## 附：裁决实验的可复现命令（本次整合运行）

```bash
# A（无技能失败轮次落盘）
MSYS_NO_PATHCONV=1 docker run --rm --network none -e DSH_HOME=/tmp/dshh dsh-bot:dev \
  sh -c 'mkdir -p /bare && cd /bare && dsh --profile headless --json "say hi" >/dev/null 2>&1; echo EXIT=$?; find /tmp/dshh | sort'
# 结果: EXIT=1 且 sessions/--bare--/session-56d4af73-…/session.v4.jsonl.zstd 存在

# A2（会话调研原场景复现: cd /tmp）→ sessions/--tmp--/session-ad0c0bab-…/session.v4.jsonl.zstd 存在
# B（带技能）→ sessions/--probe2--/session-fa6dd3ea-…/session.v4.jsonl.zstd 存在
# C（同容器 resume 失败轮次 id）→ 首行 {"type":"session","sessionId":"session-42446952-…"} + turn_start turn=2
```
