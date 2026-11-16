#!/bin/sh
# dsh-bot 状态巡检：git / CI / 服务 / 回滚锚点 一屏尽收（只读，随时可跑）
set -e
cd "$(dirname "$0")/.."
C_G="\033[32m"; C_R="\033[31m"; C_Y="\033[33m"; C_0="\033[0m"

sec() { printf "\n${C_Y}== %s ==${C_0}\n" "$1"; }

sec "git 工作树"
echo "branch : $(git branch --show-current)"
echo "clean  : $([ -z "$(git status --porcelain)" ] && echo 'yes ✓' || echo 'NO —— 有未提交改动:')"
git status --porcelain | head -8
echo "recent :"; git log --oneline -5

sec "回滚锚点（tag）"
git tag -l | while read -r t; do
  echo "  $t → $(git rev-parse --short "$t") $(git log -1 --format=%s "$t" | head -c 50)"
done
echo "回滚方式: git reset --hard <tag>（本地）/ git push -f origin <tag>^:main（远端，慎用）"

sec "CI（最近 3 次）"
gh run list --limit 3 --json displayTitle,conclusion,createdAt --jq '.[] | "  \(.conclusion // "running")  \(.createdAt[0:16])  \(.displayTitle[0:60])"' 2>/dev/null || echo "  gh 不可用"

sec "服务（dsh-bot-host）"
if docker compose -f docker/compose.yml ps --status running 2>/dev/null | grep -q bot-host; then
  echo "  容器: running ✓"
  BOTS=$(curl -s -m 3 http://127.0.0.1:8787/bots 2>/dev/null | grep -o '"name"' | wc -l)
  echo "  Web Chat: http://127.0.0.1:8787 （bots: $BOTS）"
else
  echo "  容器: 未运行（启动: docker compose -f docker/compose.yml up -d）"
fi

sec "测试"
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" | sed 's/^/  /'
