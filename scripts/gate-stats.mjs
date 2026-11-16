#!/usr/bin/env node
// gate-stats.mjs —— 围栏效能聚合（gate-telemetry-plan 清单 5）。
// 数据源：本地 .gate-ledger/events.jsonl（L1/L3 拦截 + escape + selftest）+ gh api（L2 失败 run）。
// 口径规则（§4）三脚注强制随报告输出；selftest 剔除生产计数。
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const WEIGHT = { high: 3, medium: 2, low: 1 };
const events = existsSync(".gate-ledger/events.jsonl")
  ? readFileSync(".gate-ledger/events.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

const prod = events.filter((e) => e.kind === "interception" || e.kind === "escape");
const selftests = events.filter((e) => e.kind === "selftest");

// L2：gate workflow 失败且失败 step 为 process-gate 的 run（只读聚合，不从 CI 写台账）
let l2count = 0;
let l2note = "gh 不可用";
try {
  const runs = JSON.parse(
    execFileSync("gh", ["run", "list", "--workflow", "gate", "--limit", "30", "--json", "databaseId,conclusion"], { encoding: "utf8" }),
  );
  for (const r of runs.filter((x) => x.conclusion === "failure")) {
    const jobs = JSON.parse(
      execFileSync("gh", ["api", `repos/CCODING04/dsh-bot/actions/runs/${r.databaseId}/jobs`], { encoding: "utf8" }),
    );
    if (jobs.jobs?.some((j) => j.steps?.some((s) => s.name.includes("process-gate") && s.conclusion === "failure"))) {
      l2count++;
    }
  }
  l2note = `${runs.length} 个 run 扫描`;
} catch {
  /* gh 不可用时只报本地 */
}

// 聚合
const byKey = new Map();
for (const e of prod) {
  const k = `${e.layer ?? "?"}·${e.kind === "escape" ? "escape" : e.rule ?? "?"}`;
  byKey.set(k, (byKey.get(k) ?? 0) + 1);
}
const rawTotal = prod.filter((e) => e.kind === "interception").length;
const weighted = prod
  .filter((e) => e.kind === "interception")
  .reduce((s, e) => s + (WEIGHT[e.severity] ?? 1), 0);
const escapes = prod.filter((e) => e.kind === "escape").length;
const ratio = rawTotal + escapes > 0 ? `${rawTotal}/${rawTotal + escapes}（${Math.round((rawTotal / (rawTotal + escapes)) * 100)}%）` : "n/a（无数据）";

console.log("== 围栏效能（gate-stats）==");
console.log(`拦截总数（原始）: ${rawTotal} ｜ 加权: ${weighted}（high=3/medium=2/low=1）`);
console.log(`escape 数: ${escapes} ｜ selftest: ${selftests.length}（不计入生产）`);
console.log(`L2 CI 拦截: ${l2count}（${l2note}）`);
if (byKey.size) {
  console.log("分层/分规则：");
  for (const [k, v] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
}
console.log(`
—— 口径（explain-the-number）——
1. 分母不可知：未发现的漏网数永远未知，效能比仅为「已发现错误中的拦截率」=${ratio}，禁止表述为"预防了 X% 错误"。
2. 计数≠质量：原始计数与 severity 加权计数必须同时阅读。
3. selftest 已剔除：GATE_SELFTEST=1 产生的事件只进 selftest 类。
4. 层激活状态：L1=本地 hooks 常开；L2=CI 常开；L3=需会话启动时加载 .zcode/config.json（本会话未激活时 L3 计数为 0，不代表失效）。`);
