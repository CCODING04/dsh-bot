# EXP-012 · 独立 reviewer 协作三轮实录（2026-11-16）

**假设**：主进程（协调者）+ 独立 reviewer（沙盒 worktree、不写仓库、必须执行验证）的协作流程，能产出可信的结构化裁决并提升合入质量——即 U4「三职责」中 reviewer 职责的单 bot 先行版。

**方法**：三轮审查（PR #1/#2、#3/#4/#5、#6/#7/#8），每轮：独立 worktree × N → 亲测验证（单测复现/真实容器 NDJSON/门禁坏样本/merge-tree 合并预演）→ 结构化裁决（verdict + findings{severity,位置,问题,证据}）→ 主进程按裁决执行。第二轮起修正纪律措辞：「只读」→「不写 + 必执行」（读码不算证据）。

**数据**：
- 裁决分布：approve ×5（#1/#2/#3/#6/#7），request-changes ×3（#4 基线漂移/rebase 后合、#5 样本未入电池+fail 签名依赖、#8 分支不含自身描述的改动/cherry-pick 修复）
- **request-changes 全部成立**：#4 的 867 行幻影 diff（merge-base 实证 e52bf9e≠main）；#5 的样本缺失（grep 电池 0 命中）与 fail-meta 顺序依赖（新旧签名对比实测）；#8 的「提交信息声称 cli.ts 豁免但 blob 对照内容不含」（3ba4223 仅在本地 main）
- **真 bug 捕获**：#6/#7 合并顺序预警（5a 规则会拦旧基线 PR，实测应验）；PR#7 的 cli.ts console.log 被新 lint 拦截（产品代码调试残留）
- 修复成本：全部廉价（rebase / 补样本 / cherry-pick），无一需要改设计

**结论**：假设成立。reviewer 的三个高价值动作——基线核对（抓幻影 diff）、样本核对（抓电池缺口）、blob 对照（抓信息与内容不符）——全部是主进程自查盲区。教训两条入档：① 审查纪律必须「不写+必执行」；② **amend 前必须核对当前分支**（GAP-005：#8 信息声称的豁免实际躺在本地 main，提交信息与内容不符穿过了自检，由 reviewer blob 对照抓出）。

**对 U4 的输入**：reviewer 协议已具雏形（不写+必执行+结构化 verdict+merge 前置），T-G3 的 reviewer bot 技能直接蒸馏本实验的三次 brief 与裁决格式。
