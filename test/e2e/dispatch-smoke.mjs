#!/usr/bin/env node
// U4/T-G2 真实进程冒烟：起真 daemon（HTTP，独立进程）→ 建三职责 bot + group → dispatch 小任务
// → 轮询到终态并打印 dispatch 记录与组事件流。scripted driver（stub 落盘产物 + 按角色出词回复），
// 不需要真 GLM 与密钥。用法：node test/e2e/dispatch-smoke.mjs [port]（默认 8791）。
import { rm, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { BotDaemon, serveHttp } from "../../src/daemon.ts";
import { stubDriver } from "../../src/drivers.ts";

const port = Number(process.argv[2] ?? 8791);
const stateDir = path.resolve(".tmp/dispatch-smoke-state");

// scripted 回复按角色 bot 名出词（真 GLM 时这些话由模型产出，编排逻辑完全一致）
const replies = {
  "coordinator-x": JSON.stringify(
    {
      objective: "在工作区新建 hello.txt，内容为 hello dispatch",
      owner: "engineer-y",
      done_condition: "cat hello.txt 输出 hello dispatch",
      artifacts_expected: ["hello.txt"],
    },
    null,
    2,
  ),
  "engineer-y": "已实现：hello.txt 已写入工作区（内容 hello dispatch）。验证命令：cat hello.txt；预期输出：hello dispatch；证据：文件已落盘。",
  "reviewer-z": JSON.stringify({ verdict: "approve", findings: [] }, null, 2),
};

const base = stubDriver();
const driver = {
  name: "stub-scripted",
  async run(botName, workspace, brief, events, opts) {
    const r = await base.run(botName, workspace, brief, events, opts);
    if (botName === "engineer-y") {
      // engineer 角色真落产物（stub 的 last-run.md 之外，补任务要求的 hello.txt）
      await writeFile(path.join(workspace, "hello.txt"), "hello dispatch\n", "utf8");
    }
    if (replies[botName] !== undefined) r.summary = replies[botName];
    return r;
  },
};

const api = async (p, opt) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, opt);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? r.status);
  return body;
};

await rm(stateDir, { recursive: true, force: true });
const daemon = new BotDaemon({ stateDir, driver });
await daemon.load();
const server = await serveHttp(daemon, port);
console.log(`[smoke] daemon on http://127.0.0.1:${port} (state: ${stateDir})`);

try {
  for (const [name, permissionMode] of [["coordinator-x", "workspace-write"], ["engineer-y", "workspace-write"], ["reviewer-z", "read-only"]]) {
    await api("/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, permissionMode }) });
  }
  await api("/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "smoke-team", members: ["coordinator-x", "engineer-y", "reviewer-z"] }) });
  const accepted = await api("/groups/smoke-team/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ objective: "新建 hello.txt（内容 hello dispatch）并自验" }),
  });
  console.log(`[smoke] dispatch 受理：${JSON.stringify(accepted)}`);

  let disp;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    disp = await api("/groups/smoke-team/dispatches/" + accepted.dispatchId);
    if (disp.state !== "running") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!disp || disp.state !== "done") throw new Error(`dispatch 未收敛为 done: ${JSON.stringify(disp)}`);
  console.log(`[smoke] dispatch 终态：${JSON.stringify(disp, null, 2)}`);

  const group = await api("/groups/smoke-team");
  console.log(`[smoke] group status: ${group.status}`);
  for (const e of group.events) console.log(`[smoke][evt] ${e.kind.padEnd(15)} ${e.detail.slice(0, 120)}`);
  const ws = path.join(stateDir, "bots", "engineer-y", "ws");
  console.log(`[smoke] engineer 工作区产物：${(await readdir(ws)).join(", ")}`);
  console.log("[smoke] PASS：dispatch 编排收敛为 done，事件流完整");
} finally {
  await new Promise((r) => server.close(r));
  await rm(stateDir, { recursive: true, force: true });
}
