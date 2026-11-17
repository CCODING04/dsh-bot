// gate-ledger.mjs —— 拦截审计日志共享模块（docs/gate-telemetry-plan.md §2/§7）。
// 审计日志永不入库（.gitignore）；context 强制脱敏（坑 1）；单行 appendFile（坑 2/6：Windows 不依赖 shell >>）。
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const LEDGER_DIR = path.join(import.meta.dirname, "..", ".gate-ledger");
const LEDGER_FILE = path.join(LEDGER_DIR, "events.jsonl");

// 与 process-gate 的 SECRET_SHAPES 同源；审计日志侧独立声明以免循环依赖（坑 1 单测锚定处引用本表）
const MASKERS = [
  [/[0-9a-f]{32}\.[A-Za-z0-9]{12,}/g, (m) => `${m.slice(0, 6)}***`],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, (m) => `${m.slice(0, 5)}***`],
];

/** 脱敏：任何密钥值形态替换为头部前缀 + ***（审计日志绝不存原值） */
export function mask(text) {
  let out = String(text ?? "");
  for (const [re, fn] of MASKERS) out = out.replace(re, fn);
  return out;
}

/**
 * 记录一条事件（单行 JSONL）。
 * GATE_SELFTEST=1 环境下任何 kind 强制降为 selftest（口径规则 3：自测不计生产指标）。
 */
export async function record(event) {
  // 异步接口保留（兼容 await 调用方）；实现走同步追加，语义与坑 2/6 一致
  recordSync(event);
}

/** 同步版：拦截路径用（process.exit 前必须落盘） */
export function recordSync(event) {
  mkdirSync(LEDGER_DIR, { recursive: true });
  appendFileSync(LEDGER_FILE, buildLine(event), "utf8");
}

function buildLine(event) {
  const kind = process.env.GATE_SELFTEST === "1" ? "selftest" : event.kind;
  return (
    JSON.stringify({
      ...event,
      kind,
      at: new Date().toISOString(),
      context: mask(event.context ?? ""),
    }) + "\n"
  );
}
