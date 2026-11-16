// U1/U3 验收测试（node:test，零依赖；stub/注入 driver + 纯函数，不触碰网络与本机 dsh）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BotDaemon } from "../src/daemon.ts";
import type { Driver, DriverResult, RunOptions } from "../src/drivers.ts";

async function freshDaemon(driver?: Driver) {
  const stateDir = await mkdtemp(path.join(tmpdir(), "dsh-bot-test-"));
  const d = new BotDaemon(driver ? { stateDir, driver } : { stateDir, driverName: "stub" });
  await d.load();
  return { d, stateDir };
}

test("create → 独立工作区 + 持久化", async () => {
  const { d, stateDir } = await freshDaemon();
  const bot = await d.create("alice");
  assert.equal(bot.status, "idle");
  assert.ok(bot.workspace.startsWith(path.join(stateDir, "bots", "alice")));
  // 重新加载可恢复
  const d2 = new BotDaemon({ stateDir, driverName: "stub" });
  await d2.load();
  assert.ok(d2.get("alice"));
  await rm(stateDir, { recursive: true, force: true });
});

test("brief → stub driver 落运行证据（文件 + done 事件）", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("bob");
  const bot = await d.brief("bob", "整理工作区里的说明文件");
  assert.equal(bot.status, "idle");
  assert.match(bot.lastResult ?? "", /stub run complete/);
  const evidence = await readFile(path.join(bot.workspace, "last-run.md"), "utf8");
  assert.match(evidence, /bot: bob/);
  assert.ok(bot.events.some((e) => e.kind === "done"));
  await rm(stateDir, { recursive: true, force: true });
});

test("重名 / 非法名 / 不存在的 bot → 明确报错", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("carol");
  await assert.rejects(() => d.create("carol"), /already exists/);
  await assert.rejects(() => d.create("Bad Name!"), /invalid bot name/);
  await assert.rejects(() => d.brief("ghost", "x"), /no such bot/);
  await rm(stateDir, { recursive: true, force: true });
});

test("dsh driver：不存在的 bin → spawn error 事件 + ok:false", async () => {
  const { dshDriver } = await import("../src/drivers.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const stateDir = await mkdtemp(path.join(tmpdir(), "dsh-bot-drv-"));
  const events: import("../src/drivers.ts").BotEvent[] = [];
  const r = await dshDriver({ dshBin: "definitely-not-a-bin-xyz", timeoutMs: 3000 }).run(
    "t",
    stateDir,
    "hi",
    events,
  );
  assert.equal(r.ok, false);
  assert.ok(events.some((e) => e.kind === "error"));
  await rm(stateDir, { recursive: true, force: true });
});

test("HTTP 层：Web Chat 页可达 + REST 建 bot 可查询", async () => {
  const { d, stateDir } = await freshDaemon();
  const { serveHttp } = await import("../src/daemon.ts");
  const port = 8790 + Math.floor(Math.random() * 100);
  const server = await serveHttp(d, port);
  const base = `http://127.0.0.1:${port}`;

  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /dsh-bot/);

    const created = await fetch(base + "/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "webchat" }),
    });
    assert.equal(created.status, 201);
    const got = await (await fetch(base + "/bots/webchat")).json();
    assert.equal(got.name, "webchat");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---- U3：NDJSON 解析器（CB5 三类终止）----

test("解析器：completed 终止 —— final 权威 id/答案，text 事件拼接兜底", async () => {
  const { parseDshJsonStream, dshRunOk } = await import("../src/drivers.ts");
  const lines = [
    JSON.stringify({ type: "session", sessionId: "session-abc", cwd: "/ws" }),
    JSON.stringify({ type: "status", phase: "turn_start", turn: 1 }),
    JSON.stringify({ type: "thinking", text: "let me think" }),
    JSON.stringify({ type: "text", text: "部分文本、" }),
    JSON.stringify({ type: "text", text: "拼接文本" }),
    JSON.stringify({ type: "tool_call", callId: "c1", tool: "bash", input: { cmd: "ls" } }),
    JSON.stringify({ type: "tool_result", callId: "c1", status: "completed", result: "ok" }),
    JSON.stringify({ type: "final", sessionId: "session-abc", reason: { kind: "completed" }, text: "最终答案" }),
  ];
  const r = parseDshJsonStream(lines, 0);
  assert.equal(r.finalReasonKind, "completed");
  assert.equal(r.sessionId, "session-abc");
  assert.equal(r.text, "最终答案"); // final.text 无损优先，不用拼接值
  assert.deepEqual(r.toolResults, []);
  assert.equal(r.runnerError, undefined);
  assert.ok(dshRunOk(r));
  // final 与 session 的 id 交叉校验：不一致时以 final（末行权威）为准
  const mismatch = parseDshJsonStream(
    [...lines.slice(0, -1), JSON.stringify({ type: "final", sessionId: "session-xyz", reason: { kind: "completed" }, text: "x" })],
    0,
  );
  assert.equal(mismatch.sessionId, "session-xyz");
});

test("解析器：轮次内失败 —— 有 final（reason.kind=error）且无 error 事件", async () => {
  const { parseDshJsonStream, dshRunOk } = await import("../src/drivers.ts");
  const r = parseDshJsonStream(
    [
      JSON.stringify({ type: "session", sessionId: "session-err", cwd: "/ws" }),
      JSON.stringify({ type: "text", text: "失败前的部分输出" }),
      JSON.stringify({ type: "final", sessionId: "session-err", reason: { kind: "error" }, text: "" }),
    ],
    1,
  );
  assert.equal(r.finalReasonKind, "error");
  assert.equal(r.exitCode, 1);
  assert.equal(r.runnerError, undefined);
  assert.equal(dshRunOk(r), false);
  assert.equal(r.text, "失败前的部分输出"); // final.text 为空时回退 text 事件拼接
  // aborted / interrupted / 未知 kind 同样按失败映射（只有 completed 算成功）
  const aborted = parseDshJsonStream(
    [JSON.stringify({ type: "final", sessionId: "s", reason: { kind: "interrupted" }, text: "" })],
    1,
  );
  assert.equal(aborted.finalReasonKind, "error");
});

test("解析器：runner 级失败 —— 只有单个 error 事件、无 final（如 resume 不存在的 id）", async () => {
  const { parseDshJsonStream, dshRunOk } = await import("../src/drivers.ts");
  // 整段字符串输入 + S4 实测形态：stdout 仅一条 error 事件
  const r = parseDshJsonStream(
    '{"type":"session","sessionId":"session-x","cwd":"/ws"}\n{"type":"error","message":"dsh: session \\"session-x\\" does not exist; omit --session-id to start a new Session"}\n',
    1,
  );
  assert.equal(r.finalReasonKind, null);
  assert.equal(r.sessionId, "session-x"); // 无 final 时回退 session 事件
  assert.match(r.runnerError ?? "", /does not exist/);
  assert.equal(dshRunOk(r), false);
  const bare = parseDshJsonStream('{"type":"error","message":"bad option"}', 1);
  assert.equal(bare.sessionId, null);
  assert.equal(bare.finalReasonKind, null);
});

// ---- U3：permission_blocked 映射（CB4）与 spawn 参数契约（CB1/CB2）----

test("permission_blocked 映射：SANDBOX_ESCALATION/AUTO_REVIEW 码映射，其他错误码不映射", async () => {
  const { parseDshJsonStream, dshResultEvents, PERMISSION_BLOCKED_CODES } = await import("../src/drivers.ts");
  const mkToolResult = (code: string) =>
    JSON.stringify({ type: "tool_result", callId: "c1", status: "error", result: "[sandbox: file access denied]", error: { name: "SandboxEscalationError", code, reason: "escalation unavailable" } });
  const r = parseDshJsonStream(
    [
      JSON.stringify({ type: "session", sessionId: "s1", cwd: "/ws" }),
      mkToolResult("SANDBOX_ESCALATION_UNAVAILABLE"),
      mkToolResult("AUTO_REVIEW_DENIED"),
      mkToolResult("SOME_OTHER_TOOL_ERROR"),
      JSON.stringify({ type: "final", sessionId: "s1", reason: { kind: "error" }, text: "" }),
    ],
    1,
  );
  assert.deepEqual(r.toolResults.map((t) => t.code), ["SANDBOX_ESCALATION_UNAVAILABLE", "AUTO_REVIEW_DENIED", "SOME_OTHER_TOOL_ERROR"]);
  const events = dshResultEvents(r, "2026-11-16T00:00:00Z");
  const blocked = events.filter((e) => e.kind === "permission_blocked");
  assert.equal(blocked.length, 2);
  for (const e of blocked) {
    const code = e.detail.split(" ")[0];
    assert.ok(PERMISSION_BLOCKED_CODES.has(code));
  }
  assert.match(blocked[0].detail, /SANDBOX_ESCALATION_UNAVAILABLE SandboxEscalationError: escalation unavailable/);
  assert.ok(events.some((e) => e.kind === "error"), "轮次内失败终态应为 error 事件");
});

test("spawn 参数契约：--json 恒在、--approval-policy 每次必传、--session-id 仅绑定时透传", async () => {
  const { buildDshArgs } = await import("../src/drivers.ts");
  const fresh = buildDshArgs({ patchPath: "/p.yml", approvalPolicy: "never", sessionId: null });
  assert.ok(fresh.includes("--json"));
  assert.equal(fresh[fresh.indexOf("--approval-policy") + 1], "never");
  assert.equal(fresh.includes("--session-id"), false); // 无绑定不传 = 开新会话
  assert.equal(fresh[fresh.length - 1], "-"); // brief 仍走 stdin
  const resume = buildDshArgs({ patchPath: "/p.yml", approvalPolicy: "never", sessionId: "session-9" });
  assert.equal(resume[resume.indexOf("--session-id") + 1], "session-9");
  // 顺序契约（E2E 实测回归防护）：--patch 是 launcher 级选项，必须在首个 app 级选项 --json 之前
  assert.ok(fresh.indexOf("--patch") < fresh.indexOf("--json"), "--patch 必须排在 --json 之前（launcher 解析边界）");
  const locked = buildDshArgs({ patchPath: "/p.yml", approvalPolicy: "never", sessionId: null, permissionMode: "read-only" });
  assert.equal(locked[locked.indexOf("--permission-mode") + 1], "read-only");
});

// ---- U3：会话绑定（CB3）与 per-bot 串行队列（CB8）----

test("会话绑定：成功写绑定、失败清绑定（CB3 裁决：失败不延续上下文）、resume 透传、随 bots.json 持久化", async () => {
  const mk = (over: Partial<import("../src/drivers.ts").DshRunResult>): DriverResult["dsh"] => ({
    sessionId: null, finalReasonKind: null, text: "", toolResults: [], exitCode: 0, ...over,
  });
  const seen: Array<string | null> = [];
  let call = 0;
  const outcomes: DriverResult[] = [
    { ok: true, summary: "first done", dsh: mk({ sessionId: "session-1", finalReasonKind: "completed" }) },
    { ok: false, summary: "second failed", dsh: mk({ sessionId: "session-2", finalReasonKind: "error", exitCode: 1 }) },
    { ok: false, summary: "spawn dead", dsh: mk({ sessionId: null, exitCode: -1, runnerError: "spawn error: ENOENT" }) },
    { ok: true, summary: "fourth done", dsh: mk({ sessionId: "session-3", finalReasonKind: "completed" }) },
  ];
  const driver: Driver = {
    name: "scripted",
    async run(_bot, _ws, _brief, _events, opts?: RunOptions) {
      seen.push(opts?.sessionId ?? null);
      return outcomes[call++];
    },
  };
  const { d, stateDir } = await freshDaemon(driver);
  await d.create("eve");
  const b1 = await d.brief("eve", "first");
  assert.equal(b1.sessionId, "session-1");
  const b2 = await d.brief("eve", "second");
  assert.equal(b2.sessionId, null, "失败轮次清绑定（下次开新会话，不延续失败上下文）");
  const b3 = await d.brief("eve", "third");
  assert.equal(b3.sessionId, null, "spawn 级失败同样清绑定");
  const b4 = await d.brief("eve", "fourth");
  assert.equal(b4.sessionId, "session-3", "再次成功后写入新绑定");
  assert.deepEqual(seen, [null, "session-1", null, null], "仅成功绑定后的下一次调用透传 resume id");
  const d2 = new BotDaemon({ stateDir, driver });
  await d2.load();
  assert.equal(d2.get("eve")?.sessionId, "session-3", "绑定随 bots.json 持久化");
  await rm(stateDir, { recursive: true, force: true });
});

test("旧版 bots.json（无 sessionId 字段）加载后为 null，HTTP 形状向后兼容", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("legacy");
  const file = path.join(stateDir, "bots.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>[];
  for (const b of raw) delete b.sessionId;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, JSON.stringify(raw), "utf8");
  const d2 = new BotDaemon({ stateDir, driverName: "stub" });
  await d2.load();
  assert.equal(d2.get("legacy")?.sessionId, null);
  await rm(stateDir, { recursive: true, force: true });
});

test("per-bot 串行队列：同 bot 排队（前一完成才开下一个），不同 bot 并行", async () => {
  const started: string[] = [];
  let running = 0;
  let maxOverlap = 0;
  const gates: Array<() => void> = [];
  const driver: Driver = {
    name: "gated",
    async run(botName: string) {
      started.push(botName);
      running += 1;
      maxOverlap = Math.max(maxOverlap, running);
      await new Promise<void>((r) => gates.push(r)); // 挂起直到测试放行，模拟未结束的进程
      running -= 1;
      return { ok: true, summary: "x" };
    },
  };
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(pred(), "condition not reached");
  };
  const { d, stateDir } = await freshDaemon(driver);
  await d.create("a1");
  await d.create("b1");
  const p1 = d.brief("a1", "t1"); // a1 第一个任务，立即开跑
  await until(() => started.length === 1);
  const p2 = d.brief("a1", "t2"); // 同 bot：必须排队
  const p3 = d.brief("b1", "t3"); // 不同 bot：立即并行
  await until(() => started.length === 2);
  assert.equal(started.filter((n) => n === "a1").length, 1, "同 bot 第二个任务不得提前开跑");
  assert.ok(started.includes("b1"), "不同 bot 应并行启动");
  gates[0](); // 放行 a1 第一个任务 → close 后 a1 第二个任务才开跑
  await until(() => started.filter((n) => n === "a1").length === 2);
  gates[1]();
  gates[2]();
  await Promise.all([p1, p2, p3]);
  assert.equal(maxOverlap, 2, "同 bot 从未并行（若并行则与 b1 叠成 3）");
  await rm(stateDir, { recursive: true, force: true });
});
