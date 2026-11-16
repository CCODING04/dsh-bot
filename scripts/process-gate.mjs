#!/usr/bin/env node
// process-gate.mjs — 流程硬约束 L1 层（lint）：本地 hook 与 CI 共用，零依赖。
// 六项检查：1 提交信息规范 / 2 密钥值形态 / 3 Dockerfile 吞错 / 4 档案交叉引用 / 5a README 里程碑同步 / 5b 行为改动带文档。
// 用法：
//   node scripts/process-gate.mjs commit-msg <msg-file>   # 检查 1
//   node scripts/process-gate.mjs pre-commit              # 检查 2/3/4/5（暂存区范围 + 全局交叉引用）
//   node scripts/process-gate.mjs ci [--base <ref>]       # 全部（ref 缺省取 env BASE 或 HEAD~1）
// 退出码：0 通过；1 拦截（原因打到 stderr）。拦截同步落台账 .gate-ledger/events.jsonl（docs/gate-telemetry-plan.md）。
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { recordSync } from "./gate-ledger.mjs";

const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test|perf|ci|build|style)(\(.+\))?!?: .+/;
const GENERATED = /^(Merge|Revert) /;
// 密钥扫描匹配「值形态」，不匹配变量名（已定决策）：GLM/bigmodel 形状 + sk- 前缀形状
const SECRET_SHAPES = [
  /[0-9a-f]{32}\.[A-Za-z0-9]{12,}/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];
// 排除表：本脚本与台账脚本自身含正则字面量会自匹配（EXP 教训，plan §2 ⚠️）
const SECRET_EXCLUDES = [/^scripts\/process-gate\.mjs$/, /^scripts\/gate-ledger\.mjs$/];

const fail = (m, meta) => {
  console.error(`[process-gate] 拦截：${m}`);
  if (meta) {
    recordSync({
      kind: "interception",
      layer: "L1",
      rule: meta.rule,
      severity: meta.severity,
      actor: "unknown",
      context: m,
      trigger: process.argv[2] ?? "unknown",
    });
  }
  process.exit(1);
};
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

function checkSubject(subject) {
  const s = subject.trim();
  if (!s) fail("提交信息为空", { rule: "commit-convention", severity: "low" });
  if (GENERATED.test(s)) return; // git 自动生成的 Merge/Revert 放行
  if (!CONVENTIONAL.test(s)) {
    fail(`提交信息不符合 Conventional Commits：「${s}」\n  期望形如 feat(scope): 描述 / fix: 描述（类型：feat|fix|docs|chore|refactor|test|perf|ci|build|style）`, { rule: "commit-convention", severity: "low" });
  }
}

function scanSecrets(files) {
  for (const f of files) {
    if (SECRET_EXCLUDES.some((re) => re.test(f))) continue;
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // 二进制或已删除
    }
    for (const re of SECRET_SHAPES) {
      const m = text.match(re);
      if (m) fail(`疑似密钥泄露（值形态命中 ${re.source.slice(0, 24)}…）：${f} → ${m[0].slice(0, 6)}***`, { rule: "secret-shape", severity: "high" });
    }
  }
}

function scanDockerfileSwallow(files) {
  for (const f of files.filter((x) => /(^|\/)Dockerfile(\..+)?$/.test(x))) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/npm\s+install/.test(line) && /\|\|\s*true\s*$/.test(line.trim().replace(/\\$/, ""))) {
        fail(`${f}:${i + 1} RUN 行含 npm install 且以 || true 结尾（吞错，EXP-002 教训）`, { rule: "dockerfile-swallow", severity: "medium" });
      }
    });
  }
}

function checkArchiveCrossRef() {
  const notebook = "docs/lab-notebook.md";
  const expDir = "docs/experiments";
  if (!existsSync(notebook) || !existsSync(expDir)) return;
  const text = readFileSync(notebook, "utf8");
  const referenced = new Set([...text.matchAll(/experiments\/(EXP-[A-Za-z0-9-]+\.md)/g)].map((m) => m[1]));
  const onDisk = new Set(readdirSync(expDir).filter((f) => /^EXP-.*\.md$/.test(f)));
  for (const r of referenced) {
    if (!onDisk.has(r)) fail(`lab-notebook 引用的档案不存在：docs/experiments/${r}`, { rule: "archive-xref", severity: "low" });
  }
  for (const d of onDisk) {
    if (!referenced.has(d)) fail(`档案未被 lab-notebook 引用：docs/experiments/${d}`, { rule: "archive-xref", severity: "low" });
  }
}

/** 检查 5a（里程碑同步）：docs/phase-N-report.md 存在 ⇔ README 状态节 U<N> 已勾选。 */
function checkReadmeSync() {
  if (!existsSync("README.md") || !existsSync("docs")) return;
  const readme = readFileSync("README.md", "utf8");
  const phases = readdirSync("docs")
    .map((f) => f.match(/^phase-(\d+)-report\.md$/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const boxes = new Map(
    [...readme.matchAll(/- \[([ x])\] \*\*U(\d+)\*\*/g)].map((m) => [Number(m[2]), m[1] === "x"]),
  );
  for (const n of phases) {
    if (!boxes.has(n)) fail(`phase-${n}-report.md 已落盘，但 README 状态节没有 U${n} 条目`, { rule: "readme-milestone", severity: "low" });
    if (boxes.get(n) !== true) fail(`phase-${n}-report.md 已落盘，但 README 的 U${n} 未勾选（文档漂移）`, { rule: "readme-milestone", severity: "low" });
  }
  for (const [n, checked] of boxes) {
    if (checked && !phases.includes(n)) fail(`README 勾选了 U${n}，但 docs/phase-${n}-report.md 不存在（勾选必须有报告支撑）`, { rule: "readme-milestone", severity: "low" });
  }
}

/** 检查 5b（行为改动带文档）：改动含 src/** 或 web/** 时必须同时改 README.md 或 docs/**。 */
function checkDocsDrift(files) {
  const behavior = files.filter((f) => /^(src|web)\//.test(f));
  if (behavior.length === 0) return;
  const hasDocs = files.some((f) => f === "README.md" || /^docs\//.test(f));
  if (!hasDocs) {
    fail(`本提交改动行为代码（${behavior.slice(0, 3).join("、")}…）但未更新 README.md 或 docs/ —— 文档必须与行为同步`, { rule: "readme-docs-with-code", severity: "low" });
  }
}

/** 检查 6（冲突标记）：文件含未解决的 git 冲突标记即拦（escape #3 实时转化，2026-11-16）。 */
function scanConflictMarkers(files) {
  for (const f of files.filter((x) => /\.(md|mjs|ts|json|yml|yaml|html|sh)$/.test(x))) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^(<{7}|>{7}) /.test(line)) {
        fail(`${f}:${i + 1} 含未解决的 git 冲突标记「${line.slice(0, 12)}…」——先解决冲突再提交`, { rule: "conflict-marker", severity: "medium" });
      }
    });
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "commit-msg") {
  const msgFile = rest[0];
  if (!msgFile) fail("commit-msg 需要 <msg-file> 参数");
  const subject = readFileSync(msgFile, "utf8").split(/\r?\n/)[0];
  checkSubject(subject);
  process.exit(0);
}

if (mode === "pre-commit") {
  const staged = git("diff", "--cached", "--name-only", "--diff-filter", "ACMR").split(/\r?\n/).filter(Boolean);
  scanSecrets(staged);
  scanDockerfileSwallow(staged);
  scanConflictMarkers(staged);
  checkArchiveCrossRef();
  checkReadmeSync();
  checkDocsDrift(staged);
  process.exit(0);
}

if (mode === "ci") {
  const baseIdx = rest.indexOf("--base");
  const base = baseIdx >= 0 ? rest[baseIdx + 1] : (process.env.BASE || "HEAD~1");
  const subjects = git("log", "--pretty=%s", `${base}..HEAD`).split(/\r?\n/).filter(Boolean);
  if (subjects.length === 0) fail(`提交范围为空（base=${base}），CI 门禁无可检查对象`);
  for (const s of subjects) checkSubject(s);
  const tracked = git("ls-files").split(/\r?\n/).filter(Boolean);
  const changed = git("diff", "--name-only", "--diff-filter", "ACMR", `${base}...HEAD`).split(/\r?\n/).filter(Boolean);
  scanSecrets(tracked);
  scanDockerfileSwallow(tracked);
  scanConflictMarkers(tracked);
  checkArchiveCrossRef();
  checkReadmeSync();
  checkDocsDrift(changed);
  console.log(`[process-gate] 通过：${subjects.length} 条提交信息 / ${tracked.length} 个文件密钥扫描 / Dockerfile / 冲突标记 / 档案交叉引用 / README 里程碑同步 / 行为改动带文档`);
  process.exit(0);
}

fail(`未知模式：${mode}（期望 commit-msg|pre-commit|ci）`);
