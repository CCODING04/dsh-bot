# 开发流程约束化方案（交给主进程落实）

> 来源：2026-11-16 侧聊天审计。原则 = pstack 的 **encode-lessons-in-structure**：把规则做成 lint/CI/hook，而不是更多文字。
> 本文档是**唯一需要落实的产物**：以下所有文件均未创建，由主进程按本方案实施。

## 1. 审计结论（为什么要做）

gui-test（EXP-006）目的：验证 Web Chat 渠道（benny 的 Slack 替身）对真实人类操作可用——已通过。

pstack 流程执行审计：**守其形，未动其器**。

| pstack 实践 | 状态 |
|---|---|
| laziness-protocol（最小改动） | ✅ stub 先行、零依赖、driver 隔离 |
| sequence-verifiable-units | ✅ U1→U2 里程碑 + 单元提交 + 运行证据 |
| prove-it-works | ✅ 容器产物/测试收尾 + lab-notebook 制度 |
| attack-the-premise | ✅（事后）EXP-002 误诊纠正即此原则 |
| foundational-thinking | ✅ driver 接缝、bot=workspace 先定型 |
| **poteto-mode 正式路由** | ❌ 按精神跟随，未在任务入口正式读 SKILL.md 选 playbook |
| **poteto-agent 子代理包装** | ❌ 未带"先读 poteto-mode 全文"brief |
| **interrogate / no-comments 门禁** | ❌ 推送前未跑 |
| **分支 + PR 每单元** | ⚠️ AGENTS.md 有此规，实际直推 main |

差距 = 约束缺失：靠自觉的规则一定会漂移。以下三层把已遵守的固化、未遵守的强制。

## 2. L1 · lint 层：`scripts/process-gate.mjs` + git hooks

**门禁脚本**（node 零依赖，CI 与本地 hook 共用）四项检查：

| # | 检查 | 规则 | 来源教训 |
|---|---|---|---|
| 1 | conventional commits | `git log --pretty=%s <base>..HEAD` 逐条匹配 `^(feat\|fix\|docs\|chore\|refactor\|test\|perf\|ci\|build\|style)(\(.+\))?!?: .+` | 已遵守，固化 |
| 2 | 密钥扫描 | 对 `git ls-files` 全文匹配 **密钥值形态**（非变量名）：`/[0-9a-f]{32}\.[A-Za-z0-9]{12,}/`（bigmodel key 形状）与 `sk-[A-Za-z0-9]{20,}` | 围栏 §2 |
| 3 | Dockerfile 吞错 | 含 `npm install` 的 RUN 行禁止以 `\|\| true` 结尾 | **EXP-002 直接教训** |
| 4 | 档案交叉引用 | `docs/lab-notebook.md` 中引用的 `docs/experiments/EXP-*.md` 必须存在，反之亦然 | 存档制度硬要求 |

⚠️ 实现注意：检查 2 的排除表必须包含 gate 脚本自身（它含正则字面量，会自匹配）。

**git hooks**（仓库本地，不碰全局配置）：

```
.githooks/commit-msg   → node scripts/process-gate.mjs commit-msg <msg-file>   # 只查该条消息
.githooks/pre-commit   → node scripts/process-gate.mjs pre-commit              # 查 2/3/4（暂存区范围）
git config core.hooksPath .githooks    # 启用；此配置只写本仓库 .git/config
```

**验收**：故意提交 `bad message` → 被拒；`.env` 内容拷进任意 tracked 文件 → pre-commit 拒；正常提交通过。

## 3. L2 · CI 层：`.github/workflows/ci.yml`

```yaml
on: [push, pull_request]     # private 仓库，月 2000 分钟免费额度足够
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm test                        # 现有 5 项测试
      - run: node scripts/process-gate.mjs ci
        env:
          BASE: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || 'HEAD~1' }}
```

**验收**：push 后 `gh run watch` 全绿；改坏一条 commit message 重推 → CI 红。

## 4. L3 · agent 行为层：ZCode PreToolUse hook（格式已调研确认）

放 `<repo>/.zcode/config.json`（**工作区级，自动加载**）。已核对的格式硬规则（来源：zcode-guide:diagnosing-hooks）：

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "PreToolUse": [
        {
          "matcher": "^Bash$",
          "hooks": [
            {
              "type": "process",
              "command": "node",
              "args": ["scripts/guard-bash.mjs"],
              "timeoutMs": 5000,
              "statusMessage": "安全围栏检查"
            }
          ]
        }
      ]
    }
  }
}
```

坑位清单（每条都来自官方 pitfalls，主进程勿重蹈）：

1. **`hooks.enabled: true` 必须显式**——配置文件 hook 默认禁用（坑 1）
2. **matcher 大小写敏感正则**：`"bash"` 不匹配 `Bash`；无效正则**静默不匹配**（坑 3）
3. **用 `type: "process"`（args 向量）而非 `"command"`（shell 字符串）**——Windows 跨平台（坑 10）；两类型字段不得混用（坑 7）
4. **exit 0 = 放行，exit 2 = 阻断**，其他非零 = 报错（坑 11）；stdout 输出 JSON 需严格 schema，多余 key 整个失效（坑 8）——**最稳做法：不输出任何东西，纯靠 exit code**
5. `timeout` 是秒、`timeoutMs` 是毫秒，勿混（坑 6）

**`scripts/guard-bash.mjs` 拦截清单**（从 stdin 读 hook 输入 JSON，取 Bash command 字段；输入的确切 schema 主进程需实测一次——手动喂样本验证，见下方验收）：

- `docker run` 不含 `--rm` 且不含 `-d`（具名服务除外）→ 阻断
- `npm install -g` / `npm i -g` → 阻断（围栏：需用户明示批准）
- `docker system prune` → 阻断
- 命令含对 `D:\Dev\DSH` 或 `~/.dsh` 的写操作（`>`、`mv`、`rm`、`tee` 指向这些路径）→ 阻断

**验收**（对应官方 localization workflow 第 5-6 步）：手动 `echo '{"..."}' | node scripts/guard-bash.mjs` 验 exit code；然后会话内真实触发一次（如 `docker ps`）应放行、`npm i -g x` 应被阻断；到 ZCode 日志确认 hook 记录（source/matcher/outcome）。

## 5. 主进程执行清单（有序）

1. [ ] 写 `scripts/process-gate.mjs`（四检查 + `--base` 参数）→ 手跑四条坏样本全拦、好样本全过
2. [ ] 写 `.githooks/{commit-msg,pre-commit}` + `git config core.hooksPath .githooks` → 验收：坏消息被拒
3. [ ] 写 `ci.yml` → push → `gh run watch` 绿
4. [ ] 写 `scripts/guard-bash.mjs` + `.zcode/config.json` → 手测 + 真实触发 + 查日志
5. [ ] `AGENTS.md` 加一节「流程约束（自动执行）」：一段话 + 指向上列文件
6. [ ] lab-notebook 记 **EXP-007**（流程约束工程本身：假设=自动门禁能替代自觉；方法=三层；数据=拦截样本数/误拦数；结论）
7. [ ] 全部按 conventional commits 提交（自己的门禁自己先过）+ push
8. [ ] **U3 启动时**：启用 PR-per-unit 流程；分支保护（require PR）此时再开——现在开会立即阻断主进程自己的直推，留给用户拍板
9. [ ] U3 实现正式走 pstack 机制：任务入口读 `.zcode/skills/poteto-mode/SKILL.md` 选 playbook → poteto-agent 式 brief（适配表）→ 交付前 no-comments/interrogate 适配版 → 这是流程验证 T2-T4 的正式证据

## 6. 已定决策（勿重新讨论）

- 密钥扫描匹配**值形态**不匹配变量名（`GLM_API_KEY=` 作为 env 名在 docs/compose 里合法出现）
- 不设全局 git hooks（`core.hooksPath` 仅仓库本地）；不装 husky 等依赖（零依赖原则）
- hook 不输出 JSON，纯 exit code（坑 8 规避）
- 分支保护 = U3 开启 PR 流时经用户确认后开（现在开会锁死当前工作流）
