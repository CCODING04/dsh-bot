# dsh-bot

Bot 运行时：基于 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)，对齐 [xAI Grok Bot](https://x.ai/bot) 的能力形态——**常驻命名 bot、各有沙箱电脑、brief 下任务、端到端执行、只在需要审批时回来**。

> 本项目同时是 **pstack 工作流的真实项目验证载体**：开发全程按 poteto-mode playbook 推进（见 `docs/PLAN.md`），每个单元以运行证据收尾。

## 快速开始（stub 冒烟，无需密钥）

```bash
npm test                        # 单元测试（3 项）
node src/cli.ts create demo
node src/cli.ts brief demo "整理工作区说明文件"
node src/cli.ts logs demo
```

## Docker 沙箱

见 `docker/README.md`。原则：容器即 bot 的电脑；本机 dsh 桌面版零交互；stub 模式可完全断网验证。

## 状态

- [x] **U1** 骨架 + 沙箱 + stub 证据链（3/3 测试过）
- [ ] **U2** dsh 真实驱动（需 `DEEPSEEK_API_KEY`；headless 一发式执行）
- [ ] **U3** approval surfaced + 技能安装路径
- [ ] **U4** 多 bot group 协作

## 布局

```
src/daemon.ts    bot 生命周期 + 任务下发 + 事件流（HTTP+CLI 同源）
src/drivers.ts   driver 层：stub（现状）/ dsh（U2）——隔离 preview 期 CLI 变动
src/cli.ts       create | brief | status | logs | serve
test/            node:test 零依赖
docker/          沙箱镜像 + compose + 出网理由记录
.zcode/skills/   pstack 技能原样副本 + zcode-harness 适配表（零分叉迁移）
docs/PLAN.md     双重目标 / Grok Bot 对齐矩阵 / 里程碑 / 风险
```
