#!/usr/bin/env node
// gate-selftest.mjs —— 围栏样本电池（gate-telemetry-plan 清单 4）。
// 全部样本在 GATE_SELFTEST=1 下运行 → 台账只落 selftest 类（口径规则 3：自测不计生产指标）。
// 覆盖：guard-bash stdin 样本（不依赖 git 状态）+ process-gate commit-msg 样本 + 台账脱敏断言。
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

// ---- 台账脱敏断言（坑 1：拦截上下文不得含密钥原值） ----
// 样本用拼接构造：源码里不出现完整密钥形态字面量，避免本脚本自身触发 secret-shape 拦截
const bigmodelShape = "a".repeat(32) + ".SyntheticSuffix123";
const skShape = "sk-" + "abcdefghijklmnopqrstuvwxyz123456";
const { mask } = await import("./gate-ledger.mjs");
t("台账脱敏：bigmodel 形态", mask(`x=${bigmodelShape}`) === "x=aaaaaa***");
t("台账脱敏：sk- 形态", mask(`t=${skShape}`) === "t=sk-ab***");

// ---- selftest 类断言：本电池产生的台账事件全部 kind=selftest ----
if (before !== null) {
  const lines = readFileSync(".gate-ledger/events.jsonl", "utf8").trim().split("\n");
  const recent = lines.slice(before);
  t(
    `台账 selftest 隔离（${recent.length} 条新事件）`,
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
