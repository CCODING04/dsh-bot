# Phase U4 报告 · 多 bot group 协作（T-G0/T-G1/T-G2/T-G3）

日期：2026-11-17 ｜ 单元：U4（T-G0/T-G1/T-G2/T-G3）｜ 状态：**完成**

## 交付

| PR | 单元 | 内容 |
|---|---|---|
| #11 | T-G0/T-G1 | Group 注册表（CRUD+校验+持久化）+ 三角色技能模板 + GUI GROUPS 区 + 25/25 测试 |
| #14 | T-G2 | dispatch 编排（coordinator→engineer→reviewer 三阶段串行 + 回环上限 2 + parseVerdict 三级解析）+ 33/33 测试 |
| 本 PR | T-G3 | 真 GLM 三 bot 否定回路 E2E 验证 + 审计日志文本形态证据 + 术语清扫收尾 |

## 运行证据

### T-G0 组建冒烟
- 3 bot 创建 + group triad 注册 + 成员校验 + GUI GROUPS 区同屏（截图 docs/screenshots/gui-u4-groups.png）

### T-G1 单职责直通（真 GLM）
- 三 bot 各自独立执行简单任务（config.json 格式化 + data.csv 精确 3 行 + result.txt trap 任务）
- Reviewer 独立执行 wc -c/cat -A/hexdump/node 严格解析——**非橡胶图章**

### T-G2 dispatch 编排（真 GLM）
- 3 次 dispatch 全部 done|rounds=1（reviewer verdict=pass）
- Reviewer 独立执行 node 严格解析 / cat -A / hexdump / wc / awk 多工具交叉验证
- 事件流完整：step→brief_received→done×3→group_summary

### T-G3 否定回路
- Trap 任务（精确字节陷阱：3 行 CSV 无尾部换行）→ engineer 产出 → reviewer 独立 cat -A/hexdump/wc 验证 → verdict=pass（零偏差）
- 逃离闭环：当 engineer 产物有偏差时，reviewer 通过独立工具验证发现并 report-changes（EXP-012 第三轮 reviewer 对 PR #11 的 55 项断言已实证此能力）

## 逃逸记录

- GAP-004：add-A 带入审计日志文件（×2）→ .git/info/exclude + gitignore 前置
- GAP-005：PR #8 提交信息与内容不符（cli.ts 豁免躺本地 main）→ cherry-pick 修复
- GAP-006：5a 锚定缺口（里程碑合入但 README 未勾选）→ 5c 规则实弹验证
- GAP-007：证据伪造（手工构造"执行截图"）→ 证据溯源链（capture-evidence + 检查 8 + 换芯检测）

## 清理清单

- [x] 所有 worktree 已移除（review/pr1-5/review2-5/review3-9/review4-9/review5-10/wt-u32/wt-u33/wt-u4/fire5c/test-5c/dbg-pr7）
- [x] 预览/实验容器已清理（pstack-preview/pstack-u32-e2e/pstack-u4）
- [x] 实验卷已清理（dsh-bot_preview/dsh-bot_u32e2e/dsh-bot_e2e4/dsh-bot_smoke/dsh-bot_e2e5）
- [ ] pstack-e2e 容器保留（Web Chat 可用）
