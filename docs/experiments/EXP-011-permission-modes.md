# EXP-011 · permission_blocked 两形态实测与映射修正（2026-11-16）

**假设**：read-only 模式下 bot 写文件会产生 permission_blocked 事件（CB4 五码映射）。

**方法**：容器真跑 GLM（镜像 dsh-bot:u32，`--permission-mode read-only` + `--approval-policy never`），任务"创建文件 t.txt，被拒后放弃"；先经 8788 服务形态跑一次，再用单发 headless 抓 NDJSON 原始事件流核对 error code。

**数据**：
- 单发 NDJSON 原文（关键行）：`{"type":"tool_result",...,"status":"error","result":"Error: [sandbox: file access denied under read-only mode]\n[sandbox: escalation available — retry ... with sandbox_permissions ...]","error":{"name":"FsError","code":"FS_SANDBOX_DENIED"}}`
- 8788 服务形态：文件确实未创建（read-only 生效 ✓），但 permission_blocked 事件 **0 条**——模型两次尝试均为普通 write（未带 sandbox_permissions 升权），error code 为 `FS_SANDBOX_DENIED`，不在 CB4 五码集合（五码只在升权重试被 never 拒时出现）。
- 对照失误记录：诊断首跑误加 `--network none` 把 bigmodel 出网也断了（TRANSPORT EAI_AGAIN）——去掉后复现成功；一次性容器 LLM 出网属已记录白名单场景。

**结论（OQ-1 关闭 + 修正）**：
1. 阻断有两形态：**沙箱直接拒（FS_SANDBOX_DENIED，常见路径）** 与 **升权请求被拒（SANDBOX_ESCALATION_*/AUTO_REVIEW_*，仅在模型选择升权重试时）**。映射集合补入 FS_SANDBOX_DENIED（drivers.ts PERMISSION_BLOCKED_CODES，测试覆盖 3 映射码 + 1 非映射码）。
2. 修正后 read-only 拒绝在事件流可见——web 呈现链路闭合。
