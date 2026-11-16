// evidence-core.mjs —— 证据溯源链核心（GAP-007 修复）。
// 原则：证据 PNG 只能由本工具生成——运行真实命令、逐字捕获输出、程序化渲染、写溯源元数据。
// agent 手工构造的图片没有 .meta.json（含输出哈希与命令），门禁直接拒绝。
// 校验分两级：
//   L1 完整性：meta 存在 + outputSha256 === sha256(outputText) + png 存在
//   L2 重放（安全命令白名单）：重新执行命令，比较输出哈希——不一致即伪造/陈旧
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SAFE_REPLAY = [/^node scripts\/gate-selftest\.mjs/, /^node scripts\/gate-stats\.mjs/, /^node scripts\/process-gate\.mjs/];
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isReplayable(command) {
  return SAFE_REPLAY.some((re) => re.test(command));
}

/** 运行命令 → {outputText, exitCode}（逐字捕获 stdout+stderr，标注来源流） */
export function runCaptured(command) {
  const r = spawnSync(command[0], command.slice(1), { encoding: "utf8", shell: process.platform === "win32" });
  const sections = [];
  if (r.stdout) sections.push(r.stdout.replace(/\r/g, ""));
  if (r.stderr) sections.push("[stderr]\n" + r.stderr.replace(/\r/g, ""));
  return { outputText: sections.join("\n"), exitCode: r.status ?? -1 };
}

/** 生成证据：真实命令 → 逐字输出渲染 PNG + 溯源元数据（同名单一事实源） */
export function capture(outPng, command, cwd) {
  const r = runCaptured(command);
  const outputSha = sha256(r.outputText);
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd }).stdout.trim();
  const meta = {
    kind: "evidence",
    command: command.join(" "),
    headSha,
    at: new Date().toISOString(),
    exitCode: r.exitCode,
  outputSha256: outputSha,
  outputText: r.outputText,
  };
  renderCard(outPng, meta);
  // PNG 字节绑定（换芯检测：GAP-007a）——渲染后重读最终字节写入溯源
  meta.pngSha256 = sha256(readFileSync(outPng));
  writeFileSync(outPng + ".meta.json", JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

/** 校验一张证据图：返回 {ok, reasons[]}。replay=true 时对安全命令重放比对。 */
export function verifyEvidence(pngPath, { replay = true, cwd } = {}) {
  const reasons = [];
  const metaPath = pngPath + ".meta.json";
  if (!existsSync(pngPath)) reasons.push("PNG 不存在");
  if (!existsSync(metaPath)) {
    reasons.push("缺少溯源元数据 " + path.basename(metaPath) + "（证据必须由 scripts/capture-evidence.mjs 生成，手工构造的图片不予接受）");
    return { ok: false, reasons };
  }
  const meta = (() => {
    try {
      return JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      return { kind: "malformed" }; // 畸形 meta → 统一走「缺溯源元数据」拒绝路径（fail-closed，带清晰原因）
    }
  })();
  if (meta.kind !== "evidence") reasons.push("meta.kind 非证据类型或 JSON 畸形");
  if (sha256(meta.outputText ?? "") !== meta.outputSha256) reasons.push("outputSha256 与 outputText 不匹配（元数据被篡改）");
  if (meta.pngSha256) {
    const pngSha = sha256(readFileSync(pngPath));
    if (pngSha !== meta.pngSha256) reasons.push("PNG 字节与溯源哈希不符（换芯检测：图片被替换）");
  } else {
    reasons.push("元数据缺 pngSha256（旧格式或手工构造）");
  }
  if (meta.exitCode !== 0) reasons.push(`记录的命令退出码非 0（${meta.exitCode}）——失败运行不得作为通过证据`);
  if (replay && isReplayable(meta.command)) {
    const args = meta.command.split(/\s+/);
    const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd, shell: process.platform === "win32" });
    const replaySha = sha256((r.stdout ?? "").replace(/\r/g, "") + (r.stderr ? "\n[stderr]\n" + r.stderr.replace(/\r/g, "") : ""));
    if (replaySha !== meta.outputSha256) reasons.push("重放哈希不一致——记录的输出与当前真实执行不符");
  }
  return { ok: reasons.length === 0, reasons, meta };
}

/** 程序化渲染：逐字输出 → 终端风格 PNG（内容嵌入来自 runCaptured，agent 不参与文本撰写） */
function renderCard(outPng, meta) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:12px/1.65 Consolas,monospace;background:#0f172a;color:#e2e8f0;padding:26px 32px;width:1020px}
.h{color:#7dd3fc;font-weight:700;font-size:14px;margin-bottom:6px}
.cmd{color:#fbbf24;margin-bottom:4px}
.tag{display:inline-block;font-size:11px;color:#94a3b8;border:1px solid #475569;border-radius:4px;padding:1px 8px;margin-bottom:10px}
.r{color:#f87171}hr{border:none;border-top:1px solid #334155;margin:10px 0}
pre{white-space:pre-wrap;word-break:break-all;margin:0;font:inherit}
</style></head><body>
<div class="h">命令执行证据 · 程序逐字捕获</div>
<div class="tag">capture-evidence 自动生成 | HEAD ${esc(meta.headSha.slice(0, 12))} | ${esc(meta.at)} | 输出哈希 ${esc(meta.outputSha256.slice(0, 12))}</div>
<hr>
<div class="cmd">$ ${esc(meta.command)}</div>
<pre class="${meta.exitCode === 0 ? "" : "r"}">${esc(meta.outputText)}</pre>
</body></html>`;
  const tmp = path.join(process.env.TEMP ?? ".", "pstack-evidence.html");
  writeFileSync(tmp, html, "utf8");
  const url = pathToFileURL(tmp).href;
  spawnSync(CHROME, ["--headless", "--disable-gpu", "--force-device-scale-factor=2", `--screenshot=${path.resolve(outPng)}`, "--window-size=1070,620", "--hide-scrollbars", url]);
  if (!existsSync(outPng)) throw new Error("evidence render failed: " + outPng);
}
