# EXP-002 原始数据 · 网络诊断矩阵（2026-11-16）

## 纠正后的完整对照矩阵

| 目标 | 容器内 | 宿主机 | 判定 |
|---|---|---|---|
| registry.npmmirror.io | ❌ ENOTFOUND（三种网络模式全败） | ❌ HTTP 000 / npm ENOTFOUND | **域名级阻断（与容器无关）** |
| registry.npmjs.org | ✅ HTTP 200（HEAD @deepseek-ai/dsh） | ✅ HTTP 200 | 可达 |
| github.com | ✅ HTTP 200 | ✅（gh api 全程可用） | 可达 |
| open.bigmodel.cn | ✅ DNS→47.96.134.91，fetch OK | ✅ | 可达（GLM 端点） |
| docker.io（Hub 直连） | — | ❌ 拉取超时 | 走 daocloud 镜像源替代 |
| IP 直连路由（http://223.5.5.5） | ✅ HTTP 404（路由通） | — | 容器路由正常 |
| 本机代理端口 7890/7897/10809/1080/8888 | — | ❌ 全部不通 | 无本地代理可配 |

## 误诊时间线（review 用）

1. `docker build`（npmmirror build-arg）→ dsh 未装入；Dockerfile `|| true` 吞错，构建"成功"。
2. 容器探测 `registry.npmmirror.io` → ENOTFOUND；`--dns 223.5.5.5` → ENOTFOUND；`--network host` → ENOTFOUND。
3. **错误结论**："Docker Desktop VM 出网全败，需用户修设置"（已写入 phase-1 报告并在 phase-2 报告纠正）。
4. 用户问"docker 怎么设置" → 重新分层诊断：换靶子（bigmodel/npmjs/github）+ 双环境对照 → 发现宿主机对 npmmirror 同样失败 → 真因定位。
5. 回归验证：官方源重建镜像 21.9s 成功，dsh 0.2.2-rc.1 装入。

## 沉淀的环境事实（后续实验直接引用）

- npm 源：用官方 `registry.npmjs.org`（**禁用 npmmirror**）
- 基础镜像：`docker.m.daocloud.io/library/node:24-bookworm-slim` → retag
- 容器 LLM 出网：仅需 `open.bigmodel.cn`
- Git Bash 坑：容器路径参数需 `MSYS_NO_PATHCONV=1`
