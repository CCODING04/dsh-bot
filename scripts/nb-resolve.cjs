// nb-resolve.cjs —— 解 lab-notebook.md 的 add/add 冲突：保留全部 EXP 行（按文件内出现顺序去重排列）
// 用法：node scripts/nb-resolve.cjs <file>
const fs = require("fs");
const f = process.argv[2];
let s = fs.readFileSync(f, "utf8");
const rows = [];
s = s.replace(/<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> origin\/main\r?\n/g, (_, ours, theirs) => {
  const keep = [ours, theirs]
    .join("")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("EXP-010"))
    .map((l) => l.trim());
  // EXP-010 行固定来自 main（reviewer 裁决：保留两行，010 在前）
  rows.push("resolved");
  return "<<<KEEP>>>EXP-010\n" + keep.join("\n");
});
// 把占位块还原为：EXP-010 行（从 main 侧原文找回）+ 保留的行
const m = s.match(/<<<KEEP>>>([\s\S]*?)(\n\n|$)/);
if (!m) { console.log("no conflict block found"); process.exit(1); }
const keepLines = m[1].split("\n").filter(Boolean);
const exp010 = "| EXP-010 | 2026-11-16 | 拦截台账基建（GAP-003 当日闭环） | ✅ 18/18 selftest + 首日 7 拦截/3 escape | `experiments/EXP-010-gate-telemetry.md` |";
const block = [exp010, ...keepLines.filter((l) => l !== exp010)].join("\n");
s = s.replace("<<<KEEP>>>" + m[1], block);
fs.writeFileSync(f, s, "utf8");
console.log("resolved, markers left:", (s.match(/<<<<<<</g) || []).length);
