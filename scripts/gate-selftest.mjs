#!/usr/bin/env node
// gate-selftest.mjs —— 围栏样本电池（gate-telemetry-plan 清单 4）。
// 全部样本在 GATE_SELFTEST=1 下运行 → 审计日志只落 selftest 类（口径规则 3：自测不计生产指标）。
// 覆盖：guard-bash stdin 样本（不依赖 git 状态）+ process-gate commit-msg 样本 + 审计日志脱敏断言。
// 已知局限（诚实标注）：依赖暂存区/git 历史的 pre-commit、ci 样本无法在此电池构造，
// 由 L2 CI（每次 push 重跑真门禁）与 EXP-007/PR 验收手册覆盖。
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const env = { ...process.env, GATE_SELFTEST: "1" };
const before = ledgerSize(); // 先取基线，样本跑完后的新事件才可归因于本电池
let pass = 0;
let failCount = 0;
const t = (name, ok) => {
  console.log(`${ok ? "✔" : "✖"} ${name}`);
  ok ? pass++ : failCount++;
};

// ---- guard-bash：stdin 样本（拦截 6 / 放行 5） ----
const gb = (cmd) => {
  const r = spawnSync("node", ["scripts/guard-bash.mjs"], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }),
    env,
    encoding: "utf8",
  });
  return r.status;
};
t("拦：docker run 无 --rm/-d/--name", gb("docker run node:24 echo hi") === 2);
t("放：docker run --rm", gb("docker run --rm node:24 echo hi") === 0);
t("放：docker run -d --name", gb("docker run -d --name svc nginx") === 0);
t("放：docker compose", gb("docker compose up -d") === 0);
t("拦：npm i -g", gb("npm i -g something") === 2);
t("放：npm install 本地", gb("npm install lodash") === 0);
t("拦：docker system prune", gb("docker system prune -af") === 2);
t("拦：写 D:/Dev/DSH", gb("echo x > D:/Dev/DSH/file.txt") === 2);
t("放：读 DSH + stderr 丢弃", gb("cat D:/Dev/DSH/readme 2>/dev/null") === 0);
t("拦：mv ~/.dsh", gb("mv ~/.dsh/x.yml /tmp/") === 2);
t("放：普通命令", gb("ls -la") === 0);

// ---- process-gate：commit-msg 样本（不依赖 git 状态） ----
const tmp = mkdtempSync(path.join(tmpdir(), "pstack-gate-selftest-"));
const cm = (subject) => {
  const f = path.join(tmp, "msg");
  writeFileSync(f, subject + "\n", "utf8");
  return spawnSync("node", ["scripts/process-gate.mjs", "commit-msg", f], { env, encoding: "utf8" }).status;
};
t("拦：非 conventional", cm("bad message") === 1);
t("放：feat:", cm("feat: 测试消息") === 0);
t("放：Merge 前缀", cm("Merge branch 'x'") === 0);
t("拦：空主题", cm("   ") === 1);

// ---- pr 模式样本（旁路参数：--body-file/--files/--title/--additions/--deletions/--diff-file） ----
const pr = (body, opts = {}) => {
  const f = path.join(tmp, "pr-body.md");
  writeFileSync(f, body, "utf8");
  const args = ["scripts/process-gate.mjs", "pr", "--body-file", f, "--files", opts.files ?? "docs/x.md"];
  if (opts.title) args.push("--title", opts.title);
  if (opts.additions !== undefined) args.push("--additions", String(opts.additions));
  if (opts.deletions !== undefined) args.push("--deletions", String(opts.deletions));
  if (opts.diffFile) args.push("--diff-file", opts.diffFile);
  return spawnSync("node", args, { env, encoding: "utf8" }).status;
};
const FULL = "## Why\nw\n## What changed\nw\n## Scope\nw\n## Verification\n![e](https://github.com/CCODING04/dsh-bot/raw/main/docs/screenshots/.gitkeep)\n";
t("pr拦：缺章节", pr("## Why\nw\n") === 1);
t("pr拦：web 改动无截图（全 PR 截图规则）", pr(FULL.replace(/!\[e\]\([^)]*\)/, ""), { files: "web/index.html" }) === 1);
t("pr拦：反引号引用不存在文件", pr(FULL + "\n见 `src/not-exist-xyz.ts`\n") === 1);
t("pr拦：codebase 外链接", pr(FULL + "\n[外](https://example.com/x)\n") === 1);
t("pr拦：术语裸引用（同行无展开）", pr(FULL + "\n加了 CB4 检查\n") === 1);
t("pr放：术语带 docs/ 展开", pr(FULL + "\n加了 CB4（docs/u3-integration-spec.md §2）检查\n") === 0);
t("pr拦：标题超 72", pr(FULL, { title: "feat: " + "好".repeat(80) }) === 1);
t("pr拦：标题模糊", pr(FULL, { title: "fix: fixes" }) === 1);
t("pr拦：体量 >800", pr(FULL, { additions: 500, deletions: 350 }) === 1);
t("pr放：体量 450 警告但过", pr(FULL, { additions: 400, deletions: 50 }) === 0);
t("pr拦：仪式性 Verification（截图在别处，Verification 纯文字）", pr("## Why\n![e](https://github.com/CCODING04/dsh-bot/raw/main/docs/screenshots/.gitkeep)\n## What changed\nw\n## Scope\nw\n## Verification\nCI passes\n") === 1);
t("pr拦：src 新增调试输出", pr(FULL, { files: "src/a.ts", diffFile: writeDebugDiff(tmp) }) === 1);
// img 标签形态（reviewer 第五轮：img src 不得逃逸截图 URL 校验）
const RAW = "https://github.com/CCODING04/dsh-bot/raw/main/docs/screenshots/.gitkeep";
t("pr拦：img 标签相对路径逃逸", pr("## Why\n" + '<img src="docs/screenshots/x.png">' + "\n" + FULL + "\n") === 1);
t("pr拦：img 标签外域地址", pr("## Why\n" + '<img src="https://example.com/a.png">' + "\n" + FULL + "\n") === 1);
t("pr放：img 标签 raw 绝对地址", pr("## Why\n" + `<img src="${RAW}">` + "\n" + FULL + "\n") === 0);
t("pr放：markdown title 语法（可选引号标题不误报）", pr('## Why\nw\n## What changed\nw\n## Scope\nw\n## Verification\n![e](' + RAW + ' "shot")\n') === 0);
function writeDebugDiff(tmp) {
  const f = path.join(tmp, "d.diff");
  writeFileSync(f, "diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n+console.log(\"debug\");\n", "utf8");
  return f;
}

// ---- 审计日志脱敏断言（坑 1：拦截上下文不得含密钥原值） ----
// 样本用拼接构造：源码里不出现完整密钥形态字面量，避免本脚本自身触发 secret-shape 拦截
const bigmodelShape = "a".repeat(32) + ".SyntheticSuffix123";
const skShape = "sk-" + "abcdefghijklmnopqrstuvwxyz123456";
const { mask } = await import("./gate-ledger.mjs");
t("审计日志脱敏：bigmodel 形态", mask(`x=${bigmodelShape}`) === "x=aaaaaa***");
t("审计日志脱敏：sk- 形态", mask(`t=${skShape}`) === "t=sk-ab***");

// ---- selftest 类断言：本回归样本集产生的审计日志事件全部 kind=selftest ----
if (before === null) {
  console.log("- 审计日志隔离断言 skipped（审计日志尚不存在，首跑无基线；二跑起生效）");
} else {
  const lines = readFileSync(".gate-ledger/events.jsonl", "utf8").trim().split("\n");
  const recent = lines.slice(before);
  t(
    `审计日志 selftest 隔离（${recent.length} 条新事件）`,
    recent.length > 0 && recent.every((l) => JSON.parse(l).kind === "selftest"),
  );
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\nselftest：${pass} 通过 / ${failCount} 失败`);
process.exit(failCount === 0 ? 0 : 1);

function ledgerSize() {
  try {
    return readFileSync(".gate-ledger/events.jsonl", "utf8").trim().split("\n").length;
  } catch {
    return null;
  }
}
