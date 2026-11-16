// evidence-core.mjs —— 证据溯源链核心（GAP-007 修复 · 文本形态）。
// 原则：非 UI 证据 = 文本——运行真实命令、逐字捕获输出、写 <名>.log + <名>.log.meta.json。
// agent 手工构造的内容没有配套 .meta.json（含输出哈希），门禁直接拒绝。
// UI 证据（真实界面状态）走 Playwright 浏览器截图，不经本模块。
// 校验分两级：
//   L1 完整性：meta 存在 + sha256(log 文件内容) === meta.outputSha256 + log 文件存在
//   L2 重放（安全命令白名单）：重新执行命令，比较输出哈希——不一致即伪造/陈旧
//   重放延后说明：输出含非确定片段（计数/时间戳），白名单重放会误报——排期结构化输出改造
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isReplayable(command) {
  return SAFE_REPLAY.some((re) => re.test(command));
}

const SAFE_REPLAY = [/^node scripts\/gate-selftest\.mjs/];

/** 运行命令 → {outputText, exitCode}（逐字捕获 stdout+stderr，标注来源流） */
export function runCaptured(command) {
  const r = spawnSync(command[0], command.slice(1), { encoding: "utf8", shell: process.platform === "win32" });
  const sections = [];
  if (r.stdout) sections.push(r.stdout.replace(/\r/g, ""));
  if (r.stderr) sections.push("[stderr]\n" + r.stderr.replace(/\r/g, ""));
  return { outputText: sections.join("\n"), exitCode: r.status ?? -1 };
}

/** 生成证据：真实命令 → 逐字输出 .log + 溯源元数据（同名单一事实源） */
export function capture(outLog, command, cwd) {
  const r = runCaptured(command);
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd }).stdout.trim();
  mkdirSync(path.dirname(outLog), { recursive: true });
  writeFileSync(outLog, r.outputText, "utf8");
  const meta = {
    kind: "evidence",
    command: command.join(" "),
    headSha,
    at: new Date().toISOString(),
    exitCode: r.exitCode,
    outputSha256: sha256(r.outputText),
  };
  writeFileSync(outLog + ".meta.json", JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

/** 校验一条证据日志：返回 {ok, reasons[]}。replay=true 时对白名单命令重放比对。 */
export function verifyEvidence(logPath, { replay = true, cwd } = {}) {
  const reasons = [];
  const metaPath = logPath + ".meta.json";
  if (!existsSync(logPath)) reasons.push("证据 .log 文件不存在");
  if (!existsSync(metaPath)) {
    reasons.push("缺少溯源元数据 " + path.basename(metaPath) + "（证据必须由 capture-evidence 生成，手工构造不予接受）");
    return { ok: false, reasons };
  }
  const meta = (() => {
    try { return JSON.parse(readFileSync(metaPath, "utf8")); }
    catch { return { kind: "malformed" }; }
  })();
  if (meta.kind !== "evidence") reasons.push("meta.kind 非证据类型或 JSON 畸形");
  // L1 完整性：log 文件字节哈希 === meta 声明（防篡改）
  if (sha256(readFileSync(logPath, "utf8")) !== meta.outputSha256) {
    reasons.push("log 内容与 outputSha256 不匹配（证据被篡改）");
    return { ok: false, reasons, meta };
  }
  if (meta.exitCode !== 0) reasons.push(`记录的命令退出码非 0（${meta.exitCode}）——失败运行不得作为通过证据`);
  // L2 重放（安全命令白名单）：重新执行并比对
  if (replay && isReplayable(meta.command)) {
    const args = meta.command.split(/\s+/);
    const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd, shell: process.platform === "win32" });
    const replayText = (r.stdout ?? "").replace(/\r/g, "") + (r.stderr ? "\n[stderr]\n" + r.stderr.replace(/\r/g, "") : "");
    if (sha256(replayText) !== meta.outputSha256) reasons.push("重放哈希不一致——记录的输出与当前真实执行不符");
  }
  return { ok: reasons.length === 0, reasons, meta };
}

/** 便捷入口：生成并校验一条证据。返回 {meta, verified} */
export function captureAndVerify(outLog, command, cwd) {
  const meta = capture(outLog, command, cwd);
  const r = verifyEvidence(outLog, { replay: false });
  return { meta, verified: r.ok, reasons: r.reasons };
}
