# Phase U1 报告 · 骨架 + 沙箱 + stub 证据链

日期：2026-11-16 ｜ 单元：U1 ｜ 状态：**完成**

## 做了什么

1. **L0 迁移（零分叉）**：pstack 58 个技能原样入 `.zcode/skills/`；新增 `zcode-harness/SKILL.md` 运行时适配表（词典式，不改技能本体）；仓库 `AGENTS.md` 声明开发流程与围栏。
2. **dsh-bot 骨架**：`src/daemon.ts`（bot 生命周期 + brief 下发 + 事件流，HTTP/CLI 同源）、`src/drivers.ts`（driver 层隔离 dsh preview 期变动：stub 可用 / dsh 占位）、`src/cli.ts`（create|brief|status|logs|serve）。
3. **Web 临时 Chat**（用户指定替代 Slack）：`web/index.html` 零依赖单页，同源 REST，事件流轮询。
4. **Docker 沙箱**：`docker/`（Dockerfile + compose + 出网理由记录），本机 dsh 桌面版零交互（只读参照）。

## 运行证据

- 本地单元测试 **4/4 通过**（`npm test`）：创建/持久化、stub 运行证据落盘、非法输入报错、HTTP 层（Web Chat 页 200 + REST 建查）。
- **断网容器闭环**（`--network none`）：`create demo → brief → logs` 全链通过，事件序正确（brief_received → step → done），状态机 idle→running→idle。
- 镜像 `dsh-bot:dev` 构建成功（node:24-bookworm-slim 经 daocloud 镜像源拉取）。

## 阻塞与下一步（U2）

**阻塞**：容器内出网全败（默认/`--dns`/`--network host` 三种模式均 DNS ENOTFOUND；宿主机网络正常）。Docker Desktop 虚拟机网络问题，修复需用户侧操作（Docker Desktop 设置代理 / 检查 VPN 互作用 / 重启 Docker Desktop）。因此 **dsh 未能装入镜像**（构建期 npm install 被静默吞错，已去掉 `|| true` 改为显式失败）。

**U2 解锁条件**：① 容器出网修复；② `DEEPSEEK_API_KEY`（环境变量注入，不入库）。之后：容器内探测 `dsh --help` 固定 headless 调用参数 → 实装 `dshDriver` → 真实 LLM 任务闭环。

## 清理清单

- [x] 冒烟卷 `dsh-bot_smoke` 待删（收尾执行）
- [x] 无 dangling 容器（全部 `--rm`）
- [ ] 保留：镜像 `dsh-bot:dev` 与 `node:24-bookworm-slim`（重建复用；镜像源 tag `docker.m.daocloud.io/library/node` 同一镜像层，不额外占空间）
