#!/usr/bin/env node
// capture-evidence.mjs —— 唯一合法的证据生成入口（GAP-007：杜绝手工构造证据）。
// 用法：node scripts/capture-evidence.mjs --out docs/screenshots/<名>.png -- <命令...>
// 行为：运行命令 → 逐字捕获输出 → 程序化渲染 PNG → 写 <名>.png.meta.json 溯源元数据（含输出哈希）。
// 门禁（检查 8）只接受带溯源元数据的截图；无元数据 = 拒绝合并。
import { capture } from "./evidence-core.mjs";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
if (outIdx < 0 || !argv[outIdx + 1] || argv[outIdx + 2] !== "--" || argv.length <= outIdx + 3) {
  console.error("用法: node scripts/capture-evidence.mjs --out <png路径> -- <命令...>");
  process.exit(3);
}
const outPng = argv[outIdx + 1];
const command = argv.slice(outIdx + 3);
const meta = capture(outPng, command);
console.log(`[capture-evidence] 已生成 ${outPng}`);
console.log(`  命令: ${meta.command}`);
console.log(`  输出哈希: ${meta.outputSha256}`);
console.log(`  溯源元数据: ${outPng}.meta.json`);
