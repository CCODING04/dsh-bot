# 项目归档（2026-11-17）

> 用户指令：终止项目进一步开发，本地运行时资源全部释放，构建方法留档。
> 本文档是复活本项目的唯一入口：从这里可以重建一切。

## 交付终态

- **功能**：U1~U4 全部交付——会话记忆 / 权限模式 / 技能管理 / 三职责 group + dispatch 编排（回环上限 2）；E2E T-G0~T-G3 全验证（真 GLM，T-G3 否定回路闭环：reviewer 独立拦截 → 2 轮 request-changes → 诚实 needs-rework）
- **流程资产**：三层门禁（L1 pre-commit 9 检查 / L2 CI required / L3 PreToolUse hook）+ 证据溯源链（文本 .log+SHA256；图片 pngSha256）+ PR 写法 lint（41 条回归样本集）+ 审计日志遥测 + 逃逸闭环（GAP-001~008 全闭环，EXP-001~014 存档）
- **pstack 验证结论**：Lauren Tan 方法论（两个循环 + 三职责 + prove-it-works + encode-lessons-in-structure）在本仓库完成全流程实证
- 终态 commit：`main@969638f`（tag `archive-final`）；远端仓库保留（public，分支保护不动）

## 构建方法（留档）

### 镜像构建

```bash
docker build -f docker/Dockerfile -t dsh-bot:<tag> .
# 网络受限环境（实测 2026-11-16）：
#   - Docker Hub 不可达：基础镜像经 docker.m.daocloud.io 拉取后 retag
#   - npmmirror.io 不可达：NPM_REGISTRY 用官方源（Dockerfile 默认即官方）
#   - dsh 版本由 build 时锁定（ARG DSH_VERSION），记录在镜像 label
```

### 容器运行（web chat + daemon）

```bash
# 密钥经环境变量注入（值放 <ws>/.secrets/.env，绝不入仓库/文档/日志）
export GLM_API_KEY="$(grep GLM_API_KEY <ws>/.secrets/.env | cut -d= -f2)"
docker run -d --rm --name pstack-e2e \
  -p 127.0.0.1:8790:8787 \
  -e GLM_API_KEY \
  -e DSH_BOT_DRIVER=dsh \
  -e DSH_PATCH=/app/docker/dsh-glm-patch.yml \
  -v dsh-bot_e2estate:/state \
  dsh-bot:<tag> node src/cli.ts serve
# 网页：http://127.0.0.1:8790/（容器内 8787）
```

### GLM 路由

`docker/dsh-glm-patch.yml`（pi-ai provider → open.bigmodel.cn/api/paas/v4 + agent-default-model 替换），经 `DSH_PATCH` 环境变量由 dsh CLI 加载；模型 glm 小_flash 级（实测产出 "fail"/"PASS" 等非标准裁决值，parseVerdict 同义词集已覆盖）。

### E2E dispatch

```bash
# 容器内：REST POST /groups 建三职责组（技能模板随镜像 skillTemplates/ 分发）
# REST POST /dispatch 下发任务 → 30s 轮询 → 产物核对（EXP-013 全记录）
```

### 本地（非容器）开发

```bash
npm install && npm test          # 41 条回归样本集 + 单测
node src/cli.ts serve            # 宿主起 daemon（需本机 dsh CLI）
```

## 复活指南

1. `git clone https://github.com/CCODING04/dsh-bot && npm ci && npm test`（41/41 为基线）
2. 按「构建方法」重建镜像与容器（全部命令可直接复制执行）
3. **先还债再开发**（复活后第一周）：
   - 门禁债五笔：①debug-output pre-commit/pr 口径统一 ②5c fail-open 文档化 ③截图 URL 未校验扩展名（.log 充当"截图"渲染成链接）④检查 8 图片分支三观察（meta.kind 不强制 / 畸形 meta 未捕获异常 / verifyEvidence 死导入）⑤证据捕获须在最终 commit 后重跑（headSha 对齐）
   - UX 债：web chat poll 每 2s 整表重建 → 增量渲染
4. 遵守仓库 AGENTS.md 全部围栏；新会话加载 `.zcode/config.json`（L3 hook）

## 本次归档释放清单（2026-11-17 执行）

| 类别 | 对象 | 处置 |
|---|---|---|
| 容器 | `pstack-e2e`（Up，含 8790 端口映射） | stop + rm |
| 容器 | `dsh-bot-host`（Exited 255） | rm |
| 镜像 | `dsh-bot:{dev,u32,preview,u4,u4-fix,u4-e2e,e2e-v3,e2e-v4,e2e-v5,e2e-final}` ×10（约 19GB） | rmi（构建方法已留档） |
| 卷 | `dsh-bot_e2efinal` / `docker_dsh-home` / `docker_bot-state` | rm（state 数据随项目终止废弃） |
| worktree | `.tmp/review9/pr15`（detached） | remove |
| 本地分支 | `feat/gate-telemetry` / `feat/process-hardening` / `feat/u3-json-driver-sessions`（已合并） | delete |
| 远端分支 | 已合并 PR 分支（chore/gate-ledger-gaps 等） | delete |
| 临时文件 | `/tmp/pstack-*`（b3~b14 brief、检查 png 等） | delete |

> 保留：GitHub 仓库与全部 PR/CI 历史、归档 tag `archive-final`、`<ws>/.secrets/.env`（密钥仍在用户手中）、ZCode L3 hook 配置（随仓库）。
