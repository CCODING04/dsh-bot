# Docker 沙箱说明

## 隔离承诺

- 本机 `D:\Dev\DSH`（桌面安装）与 `~/.dsh`（配置）**只读、零交互**；dsh 在镜像内独立安装。
- 容器一次性使用（`--rm`）或具名可追踪（compose 的 `dsh-bot-host`）；状态全在卷里，容器可弃重建。
- 只删除本项目创建的资源：`docker compose down`、`docker volume rm dsh-bot_bot-state dsh-bot_dsh-home`、`docker rmi dsh-bot:dev`。**不跑**全局 prune。

## 网络出网记录（围栏要求写明理由）

| 阶段 | 目标 | 理由 |
|---|---|---|
| build | npm registry | 安装 dsh 依赖 |
| 运行（dsh driver） | `api.deepseek.com` | LLM 调用，唯一必需出网 |
| 运行（stub driver） | 无 | 冒烟测试建议 `--network none` |

严格域名白名单（egress proxy / network policy）列入 L3 加固项。

## 常用命令

```bash
# 构建
docker compose -f docker/compose.yml build

# stub 冒烟（零网络）
docker run --rm --network none -v dsh-bot_smoke:/state dsh-bot:dev \
  node src/cli.ts create demo
docker run --rm --network none -v dsh-bot_smoke:/state dsh-bot:dev \
  node src/cli.ts brief demo "hello from sandbox"
docker run --rm --network none -v dsh-bot_smoke:/state dsh-bot:dev \
  node src/cli.ts logs demo

# 常驻 daemon（需 LLM 出网时）
DEEPSEEK_API_KEY=sk-*** DSH_BOT_DRIVER=dsh docker compose -f docker/compose.yml up -d
```
