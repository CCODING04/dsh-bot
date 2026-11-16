## Why

<!-- 问题与做法，1-3 句。不写 SHA、rebase 谱系、"based on main" 前言。 -->

## What changed

<!-- 1-3 条。只在承载变更时点名符号/路径。 -->

## Scope

<!-- 覆盖了什么、刻意不做什么（后续单元/已知缺口）。 -->

## Tradeoffs

<!-- 只写评审者会追问的被拒方案。没有真选择就删掉本节。 -->

## Blast Radius

<!-- 影响谁/什么，为什么安全或风险何在。 -->

## Verification

<!-- 每条 = 真实运行路径 + 结果（如 npm test 13/13；容器 E2E 产物路径）。构建成功不是正确性证明。 -->

<!-- 写法硬规则（scripts/process-gate.mjs pr 模式机检）：
  1) 引用文件必须用反引号包真实存在的仓库路径（如 `src/drivers.ts`），禁止未定义编号裸引用（"5a"这类须同行附路径或中文括号展开）；
  2) 链接只允许本仓库（github.com/CCODING04/dsh-bot/...）或存在的相对路径，禁止 codebase 以外文件链接；
  3) 含 web/ 改动的 PR 必须在 Verification 附界面截图（![...](docs/...png)，截图文件入库 docs/screenshots/）；
  4) 六节结构：Why/What changed/Scope 必填，Verification 必填，Tradeoffs/Blast Radius 无话可说可省。 -->
