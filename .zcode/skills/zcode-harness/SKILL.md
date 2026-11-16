---
name: zcode-harness
description: pstack 技能在 ZCode harness 下的运行时适配表。使用任何 pstack 技能（poteto-mode 及其 playbook、interrogate、swarm、arena 等）之前先读本文件，把技能里的 Cursor 词汇映射为 ZCode 等价物。Map pstack's Cursor vocabulary to ZCode at runtime.
---

# pstack → ZCode 运行时适配表

pstack 技能使用 Cursor 词汇书写。在 ZCode 会话中执行任何 pstack 技能前，读一次本文件，然后按表映射。`<pstack>` 指本仓库的 `.zcode/skills/` 目录。Cursor 字段没有对应行时：丢弃该字段并说明一句，不停止，不重试。绝不向工具 schema 传入它不接受的字段。

## 工具映射

| Cursor | ZCode |
| --- | --- |
| `Task` 工具 | `Agent` 工具 |
| `AskQuestion` | `AskUserQuestion`（无此工具的无人值守场景用纯文本提问并采用默认值） |
| 打开 todo list | `TodoWrite`；不可用时在回复中维护清单并每阶段更新 |
| 运行另一个 pstack 技能（`/name` 或 "the **name** skill"） | `Read` `<pstack>/<name>/SKILL.md` 并照做 |
| `Grep` / `Glob` | 专用搜索工具；不可用时 `Bash` + `rg` |
| 终端长任务 | `Bash`（`run_in_background`）；需要定时唤醒时 `CronCreate` |

## 子代理映射

| Cursor | ZCode |
| --- | --- |
| `subagent_type: generalPurpose` | `subagent_type: general-purpose` |
| `subagent_type: poteto-agent` | `general-purpose`，且 brief 第一行写明：先完整阅读 `<pstack>/poteto-mode/SKILL.md`（含内联 Principles 索引）再开始任何工作 |
| `subagent_type: comment-sicko` | `Explore`（只读），brief 附 "不要编辑文件"，结束后用 `git status` 复核 |
| `readonly: true` | `subagent_type: Explore` |
| `readonly: false` | `general-purpose` |
| `environment: "cloud"` + `cloud_base_branch: <b>` | 指示 worker 在独立 worktree（`git worktree add`）检出 `<b>` 或其派生分支后工作；容器可用时改在 docker 容器内 |
| `run_in_background: true` | `run_in_background: true`（同名） |
| `resume` | 新建 agent 并把先前结果贴进 brief |
| `file_attachments` | 在 brief 中列出路径 |

## 模型与路由

| Cursor | ZCode |
| --- | --- |
| `claude-opus-5-5-xhigh` 等家族 slug | 由会话模型执行；需要差异模型时经 `Agent` 工具的可用类型分发 |
| `gemini-*` 等非 Claude slug | 同上（会话模型），并在报告中注明 |
| `auto` / `inherit-parent` | 会话模型 |
| `setup-pstack` 写 `~/.cursor/rules/pstack-models.mdc` | 改写为本仓库 `AGENTS.md` 的 `## pstack 模型路由` 段落（不写任何用户目录） |
| 角色值 `<model> <effort>` | 记录到同一段落，执行时映射到会话模型 |

## 路径映射

| Cursor | ZCode |
| --- | --- |
| `~/.cursor/plugins/…/skills/poteto-mode/SKILL.md` | 本仓库 `<pstack>/poteto-mode/SKILL.md`（绝对路径在 AGENTS.md 中给出） |
| `.cursor/skills/`、`.cursor/automations/` | `.zcode/skills/`；automations 不迁移 |
| pstack GitHub 链接 | 优先读本地 `.zcode/skills/` 副本，不给用户留外链依赖 |
| `~/.cursor/projects/<slug>/agent-transcripts/` | 不可用；需要历史时读本仓库 git log 与 `docs/` 阶段报告 |

## Cursor 专属功能（遇即一行跳过）

无 ZCode 等价物：Cursor Automations（routines/webhooks）、Bugbot、Cursor 云代理 dashboard、内置 PR 工具（用 `gh` 替代，不算跳过）。遇到时输出一行 `Skipped in ZCode: <步骤>. <原因>.` 然后继续，不停止不询问。

## 附加能力（ZCode 侧）

- `/loop` 语义 → `CronCreate`（定时）/ `OffPeakCreate`（闲时）
- 展示 diff/定位 → `code --diff a b`、`code path/file.ts:42`（VSCode 在场时）
