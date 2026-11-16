# dsh-bot · 仓库代理公约

本仓库是 **pstack 工作流的真实项目验证载体**（见 `docs/PLAN.md`），同时是一个对齐 xAI Grok Bot 能力的 DeepSeek Harness (dsh) bot 运行时。

## 硬约束（继承工作区围栏）

完整围栏见 `../AGENTS.md`（工作区级）。本仓库补充：

1. **沙箱优先**：所有 dsh 相关改动与运行发生在 Docker 容器内（`docker/`）；**绝不**改动 `D:\Dev\DSH`（本机桌面安装）与 `~/.dsh`（本机配置），对它们只读。
2. **密钥**：`DEEPSEEK_API_KEY` 等只经环境变量注入容器；不入库、不入日志、不下发子代理。
3. **清理**：容器一律 `--rm` 或具名可追踪；临时物进 `.tmp/`（已 gitignore），阶段收尾清空。
4. **上游纪律**：本仓库不 fork/修改 deepseek-harness 本体；依赖经 npm 正常安装。

## 开发流程（本仓库存在的意义）

每个功能单元走 pstack 流程，接受验证：

1. 任务进入时读 `.zcode/skills/zcode-harness/SKILL.md`（适配表），再按 poteto-mode 的 **feature** 或 **refactoring** playbook 执行。
2. 小步可验证单元：每单元以"运行证据"收尾（prove-it-works），测试便宜时先写失败测试（tdd）。
3. Conventional Commits（`feat:`/`fix:`/`chore:`/`docs:`）；每单元一个分支 + PR；PR 描述含 `## Why`（复述用户目标）。
4. 合并前 unslop 自查；审查阶段按 no-comments / interrogate 映射执行（见适配表）。
5. 每阶段（U1–U4）在 `docs/phase-N-report.md` 记录：做了什么 / 运行证据 / 清理清单。

## 实验存档制度（review 硬要求）

**每个实验**（成功与失败 alike）必须记入 `docs/lab-notebook.md`：假设 → 方法（可复现命令）→ 数据（输出摘录，原始件存 `docs/experiments/EXP-NNN-*.md`）→ 结论。负结果与误诊过程照录——它们是 pstack 流程验证的核心 review 依据。诊断类实验必须分层多目标 + 双环境（容器/宿主机）对照后才许下结论（EXP-002 教训）。

## pstack 技能位置

`<pstack>` = `.zcode/skills/`（本仓库根）。poteto-mode 入口：`.zcode/skills/poteto-mode/SKILL.md`。
