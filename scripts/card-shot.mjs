// card-shot.mjs —— 证据卡截图助手：HTML 卡片 → Chrome 无头 2x PNG（入库 docs/screenshots/）。
// 用法：node scripts/card-shot.mjs <card.html 或 -> <<'EOF' stdin> <out.png> [width] [height]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [, , htmlIn, outPng, w = "1030", h = "560"] = process.argv;
const html = htmlIn === "-" ? readFileSync(0, "utf8") : readFileSync(htmlIn, "utf8");
const tmp = path.join(process.env.TEMP ?? ".", "pstack-card.html");
writeFileSync(tmp, html, "utf8");
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
execFileSync(chrome, [
  "--headless",
  "--disable-gpu",
  "--force-device-scale-factor=2",
  `--screenshot=${path.resolve(outPng)}`,
  `--window-size=${w},${h}`,
  "--hide-scrollbars",
  pathToFileURL(tmp).href,
]);
console.log(`saved: ${path.resolve(outPng)}`);
