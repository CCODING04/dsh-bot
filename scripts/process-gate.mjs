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

/**
 * 检查 7（PR 写法规范，用户 2026-11-16 定）：六节结构、UI 改动截图认证、
 * 文件引用仅限 codebase 内（反引号路径与链接均须真实存在）、项目内术语编号禁止裸引用。
 * 输入：`pr <number>`（gh pr view）或 `pr --body-file <f> --files <csv>`（旁路，供 selftest）。
 */
function checkPrBody(rawBody, files, ctx = {}) {
  // 净化：HTML 注释（模板占位符）与围栏代码块不参与写法判断（用户 2026-11-16 指令：注释会影响判断）
  const body = rawBody
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+```[\s\S]*?```$/gm, "");
  const problems = [];
  for (const sec of ["## Why", "## What changed", "## Scope", "## Verification"]) {
    if (!body.includes(sec)) problems.push(`缺少必需章节「${sec}」`);
  }
  const touchesWeb = files.some((x) => /^web\//.test(x));
  // 最终生效截图：所有 PR 必附（用户 2026-11-16 硬规则）；UI 改动另需 before/after 对照意识
  if (!/!\[[^\]]*\]\([^)]+\)|<img[\s>]/.test(body)) {
    problems.push(
      touchesWeb
        ? "改动含 web/（UI）但未附最终生效截图（![...](docs/screenshots/....png)）——UI 须 before/after 对照"
        : "未附最终生效截图认证：所有 PR 须在 Verification 内以 ![...](docs/screenshots/....png) 附最后生效的证据截图",
    );
  }
  for (const m of body.matchAll(/`([^`\n]+)`/g)) {
    const p = m[1].trim();
    if (!/^(src|test|web|scripts|docs|docker|\.github|\.zcode|\.githooks)\//.test(p)) continue;
    if (!existsSync(p)) problems.push(`引用了 codebase 外或不存在的文件：\`${p}\``);
  }
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1].trim();
    if (/^https?:\/\//.test(href)) {
      if (!/^https?:\/\/github\.com\/CCODING04\/dsh-bot\//.test(href)) {
        problems.push(`PR 引用了 codebase 以外的链接（禁止）：${href}`);
      }
    } else if (!href.startsWith("#") && !href.startsWith("mailto:")) {
      if (!existsSync(href.replace(/^\.\//, ""))) problems.push(`相对链接指向不存在的文件：${href}`);
    }
  }
  for (const line of body.split(/\r?\n/)) {
    const bare = line.match(/\b(\d+[ab]|CB-?\d+|OQ-\d+|EXP-\d+|T-G\d+|GAP-\d+)\b/);
    if (bare && !/docs\/|github\.com\/CCODING04\/dsh-bot|（/.test(line)) {
      problems.push(`术语「${bare[1]}」裸引用：该行须附 docs/ 路径、仓库链接或中文括号展开（如「CB4（docs/u3-integration-spec.md §2）」）`);
    }
  }
  // Verification 证据形态：禁止只有仪式性声明（「CI passes」「测试全部通过」）——须含命令/截图/链接
  const vSec = body
    .split(/\n##\s+/)
    .find((s) => s.trim().startsWith("Verification"));
  if (vSec !== undefined && !/`|!\[|\]\(/.test(vSec)) {
    problems.push("Verification 缺乏证据形态内容（反引号命令 / 截图 / 链接）——仪式性声明（如「CI passes」）不算验证");
  }
  // 标题（教程 §2）：Conventional Commits + 50–72 字符 + 禁模糊
  if (ctx.title !== undefined) {
    const t = ctx.title.trim();
    if (!CONVENTIONAL.test(t)) problems.push(`标题不符合 Conventional Commits 格式（type(scope): 描述）：「${t}」`);
    const len = [...t].length;
    if (len > 72) problems.push(`标题 ${len} 字符超上限 72（教程硬约束：50–72，release notes 复用要求可搜索）`);
    if (len < 10) problems.push(`标题过短（${len} < 10 字符）——须具体、可搜索`);
    const desc = t.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
    if (/^(update|misc|various|improve|changes?|fixes?)\b/i.test(desc) || /^(优化|修复一些|各种|若干|调整)/.test(desc)) {
      problems.push(`标题模糊（「${desc.slice(0, 24)}」）——如 "Improve reliability"/"Various fixes" 应直接拒绝`);
    }
  }
  // 体量（教程 §4）：>800 行缺陷发现率骤降约 40% —— 硬门槛必须拆分；400–800 警告
  if (ctx.additions !== undefined && ctx.deletions !== undefined) {
    const total = ctx.additions + ctx.deletions;
    if (total > 800) problems.push(`diff 体量 ${total} 行 > 800：必须拆分（每个 PR 独立可理解、可回滚）`);
    else if (total > 400) console.error(`[process-gate] 警告：diff ${total} 行处于 400–800 区间（审查效率下降），考虑拆分`);
  }
  // 调试输出（教程 §5 P0）：src/web 新增行含 console.log/debugger
  if (ctx.diffText && files.some((x) => /^(src|web)\//.test(x))) {
    const added = ctx.diffText.split(/\r?\n/).filter((l) => /^\+[^+]/.test(l));
    const hits = added.filter((l) => /console\.(log|debug)\(|\bdebugger\b/.test(l));
    if (hits.length) {
      problems.push(`src/web 新增调试输出 ${hits.length} 处（console.log/debugger，P0 自检项）——首行示例：${hits[0].trim().slice(0, 80)}`);
    }
  }
  if (problems.length) {
    fail(`PR 写法规范 ${problems.length} 处不合规：\n  - ${problems.join("\n  - ")}`, { rule: "pr-body", severity: "low" });
  }
}

async function runPrMode(rest) {
  const flag = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  let body;
  let files;
  let title;
  let additions = 0;
  let deletions = 0;
  let diffText = "";
  const bodyFile = flag("--body-file");
  const filesCsv = flag("--files");
  if (bodyFile && filesCsv) {
    body = readFileSync(bodyFile, "utf8");
    files = filesCsv.split(",").map((s) => s.trim()).filter(Boolean);
    title = flag("--title");
    if (flag("--additions") !== undefined) additions = Number(flag("--additions")) || 0;
    if (flag("--deletions") !== undefined) deletions = Number(flag("--deletions")) || 0;
    const diffFile = flag("--diff-file");
    if (diffFile) diffText = readFileSync(diffFile, "utf8");
  } else {
    const num = rest.find((x) => /^\d+$/.test(x));
    if (!num) fail("pr 模式需要 <pr-number>，或 --body-file <f> --files <csv>（自测旁路）");
    const parsed = JSON.parse(
      execFileSync("gh", ["pr", "view", num, "--json", "body,files,title,additions,deletions"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
    body = parsed.body ?? "";
    title = parsed.title ?? "";
    additions = parsed.additions ?? 0;
    deletions = parsed.deletions ?? 0;
    files = (parsed.files ?? []).map((x) => x.path);
    if (files.some((x) => /^(src|web)\//.test(x))) {
      diffText = execFileSync("gh", ["pr", "diff", num], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    }
  }
  checkPrBody(body, files, { title, additions, deletions, diffText });
  console.log(
    `[process-gate] PR 写法通过：${files.length} 个文件 / 六节 / 截图认证 / codebase 内引用 / 术语展开 / 标题与体量达标 / 无调试输出`,
  );
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "commit-msg") {
  const msgFile = rest[0];
  if (!msgFile) fail("commit-msg 需要 <msg-file> 参数");
  const subject = readFileSync(msgFile, "utf8").split(/\r?\n/)[0];
  checkSubject(subject);
  process.exit(0);
}

if (mode === "pr") {
  await runPrMode(rest);
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
  // 教程 §5 P0 前置：src/web 调试输出在提交时就拦（PR 层还有一道同款）
  if (staged.some((x) => /^(src|web)\//.test(x))) {
    const addedLines = git("diff", "--cached", "-U0", "--", "src", "web")
      .split(/\r?\n/)
      .filter((l) => /^\+[^+]/.test(l));
    const hits = addedLines.filter((l) => /console\.(log|debug)\(|\bdebugger\b/.test(l));
    if (hits.length) {
      fail(`src/web 新增调试输出 ${hits.length} 处（console.log/debugger，P0）——首行：${hits[0].trim().slice(0, 80)}`, { rule: "debug-output", severity: "medium" });
    }
  }
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

fail(`未知模式：${mode}（期望 commit-msg|pre-commit|ci|pr）`);
