# Phase U3 报告 · 审批 × 会话 × 技能（三单元合并收尾）

日期：2026-11-16 ｜ 单元：U3（U3-1/U3-2/U3-3）｜ 状态：**完成，main 已合入**

## 交付（按合入顺序）

| PR | 单元 | 内容 | 审查 |
|---|---|---|---|
| #1 | U3-1 | 会话记忆：dsh driver `--json` 化、NDJSON 解析器（三类终止）、bot→session 绑定（CB3：失败清绑定）、per-bot 串行队列、`--patch` 在 `--json` 前顺序契约 | approve |
| #6 | U3-2 | per-bot 权限模式三值配置端到端（枚举单一源/PATCH/透传）+ permission_blocked 事件与 web 红条 + `FS_SANDBOX_DENIED` 实测补入（EXP-011） | approve |
| #7 | U3-3 | bot 技能管理（工作区 `.dsh/skills/` CRUD + frontmatter 校验 + git init 钉 projectRoot + 降级）+ 合并集成 U3-2 | approve |

## 运行证据

- 单元测试：main 上 20/20（U3-1 前 13 + U3-2 三项 + U3-3 四项，全部断言用户可见行为）
- 容器 E2E：会话延续两轮暗号实验（OQ-5 关闭，EXP-008）；read-only 拒绝负空间证明 + `FS_SANDBOX_DENIED` 事件（EXP-011）；真 GLM 任务产物落盘多次复现
- 浏览器 GUI 走查（EXP-006 协议）：权限标签循环切换、阻止红条渲染、技能面板增删、会话延续——5 张截图入库 docs/screenshots/
- 独立 reviewer 三轮覆盖 U3 的 PR：approve（#1/#6/#7 各自轮次）+ 第六轮对 #11 的 55 项断言含 U3 集成态

## 本阶段逃逸记录

- GAP-005：PR #8 提交信息声称的 cli.ts 豁免实际未随分支（3ba4223 躺本地 main）——reviewer blob 对照抓出，cherry-pick 修复后随 #7 合入
- README U3 未勾选漂移至 #11 合并后（本报告即修复）——见 GAP-006

## 清理清单

- [x] 分支 feat/u3-permission-surfaced、feat/u3-skill-management 合并后删除
- [x] review3/review4 worktree 与预览容器清理
- [ ] 遗留：UX 债（poll 每 2s 整表重建）与 gate 口径差异（pre-commit 全 src 扫 vs pr 层 cli.ts 豁免）——分别记待办与 gate-fix 单元
