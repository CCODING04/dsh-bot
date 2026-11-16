# Phase U2 报告 · 真实 LLM 闭环（GLM via bigmodel）

日期：2026-11-16 ｜ 单元：U2 ｜ 状态：**完成**

## 关键结论（纠错记录）

1. **此前"容器出网全坏"是误诊**：真因是 `registry.npmmirror.io` 域名在当前网络不可达（**宿主机同样不通**），而 npmjs/github/open.bigmodel.cn 容器内全部可达。**无需修改 Docker Desktop 任何设置**。
2. GLM 接法（零自研适配器）：dsh 自带 `@deepseek-ai/dsh-llm-pi-ai` 多 provider 适配器，`docker/dsh-glm-patch.yml` 手声明 `glm` 路由（`api: openai-completions` + bigmodel baseURL + `glm-5.3-flash`），并把 `agent-default-model` 行替换为 `provider: glm`。密钥经 `apiKeyEnv: GLM_API_KEY` 引用环境变量，不落任何配置文件。

## 运行证据

- 本地单元测试 **5/5**（新增 dshDriver 失败路径）。
- 容器单发验证：`dsh --profile headless --patch …` 真实执行"创建 hello.txt"任务，模型推理可见、`hello.txt` 落盘内容 `ok`。
- **全链 E2E**（compose 起服务，`dsh-bot-host`）：`POST /bots/e2e` → `POST /bots/e2e/brief`（HTTP）→ GLM 执行 → 状态机 idle→running→idle，事件序 brief_received→step→done，回复 `E2E OK`，产物 `/state/bots/e2e/ws/e2e.txt` = `hello-glm`。

## 环境事实（供复用）

| 项 | 值 |
|---|---|
| dsh 版本 | 0.2.2-rc.1（镜像内 npm 官方源安装） |
| headless 用法 | `dsh --profile headless --patch <p> --approval-policy never -`（stdin 传任务） |
| 模型路由 | pi-ai providers.glm → openai-completions → open.bigmodel.cn/api/paas/v4 |
| 密钥 | `dsh-bot/.env`（gitignored）：GLM_API_KEY / GLM_BASE_URL / GLM_MODEL=glm-5.3-flash |

## 清理清单

- [x] `.tmp/` 诊断文件待清（收尾执行）
- [x] 无一次性容器残留；`dsh-bot-host` 为具名 compose 服务，**保留运行**供 Web Chat 试用（`docker compose -f docker/compose.yml down` 可停）
- [x] 单发测试容器均 `--rm`
