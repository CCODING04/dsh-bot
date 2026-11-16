// U1/U3 验收测试（node:test，零依赖；stub/注入 driver + 纯函数，不触碰网络与本机 dsh）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

test("permission_blocked 映射：FS_SANDBOX_DENIED/SANDBOX_ESCALATION/AUTO_REVIEW 码映射，其他错误码不映射", async () => {
  const { parseDshJsonStream, dshResultEvents, PERMISSION_BLOCKED_CODES } = await import("../src/drivers.ts");
  const mkToolResult = (code: string, name = "SandboxEscalationError") =>
    JSON.stringify({ type: "tool_result", callId: "c1", status: "error", result: "[sandbox: file access denied]", error: { name, code, reason: "escalation unavailable" } });
  const r = parseDshJsonStream(
    [
      JSON.stringify({ type: "session", sessionId: "s1", cwd: "/ws" }),
      mkToolResult("SANDBOX_ESCALATION_UNAVAILABLE"),
      mkToolResult("FS_SANDBOX_DENIED", "FsError"),
      mkToolResult("AUTO_REVIEW_DENIED"),
      mkToolResult("SOME_OTHER_TOOL_ERROR"),
      JSON.stringify({ type: "final", sessionId: "s1", reason: { kind: "error" }, text: "" }),
    ],
    1,
  );
  assert.deepEqual(r.toolResults.map((t) => t.code), ["SANDBOX_ESCALATION_UNAVAILABLE", "FS_SANDBOX_DENIED", "AUTO_REVIEW_DENIED", "SOME_OTHER_TOOL_ERROR"]);
  const events = dshResultEvents(r, "2026-11-16T00:00:00Z");
  const blocked = events.filter((e) => e.kind === "permission_blocked");
  assert.equal(blocked.length, 3);
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

test("旧版 bots.json（无 sessionId / permissionMode 字段）加载后回填，HTTP 形状向后兼容", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("legacy");
  const file = path.join(stateDir, "bots.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>[];
  for (const b of raw) {
    delete b.sessionId;
    delete b.permissionMode;
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, JSON.stringify(raw), "utf8");
  const d2 = new BotDaemon({ stateDir, driverName: "stub" });
  await d2.load();
  assert.equal(d2.get("legacy")?.sessionId, null);
  assert.equal(d2.get("legacy")?.permissionMode, "workspace-write");
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

// ---- U3-3：bot 技能管理（K1/K3 + C5/K6 git init 钉 projectRoot）----

test("技能 CRUD roundtrip：写 → 列表 → 落盘 .dsh/skills/<name>/SKILL.md → 删（幂等）", async () => {
  const { d, stateDir } = await freshDaemon();
  const bot = await d.create("sk-bob");
  // git init 钉住 projectRoot（C5/K6）：工作区内应有 .git，此后技能路径恒为 <ws>/.dsh/skills
  assert.ok((await stat(path.join(bot.workspace, ".git"))).isDirectory(), "create 应在工作区 git init");
  assert.equal((await d.listSkills("sk-bob")).length, 0);
  const meta = await d.putSkill("sk-bob", "tidy-report", { name: "tidy-report", description: "整理工作区产出报告", body: "把结果写入 REPORT.md。" });
  assert.deepEqual(meta, { name: "tidy-report", description: "整理工作区产出报告" });
  assert.deepEqual(await d.listSkills("sk-bob"), [meta]);
  const file = path.join(bot.workspace, ".dsh", "skills", "tidy-report", "SKILL.md");
  const text = await readFile(file, "utf8");
  assert.ok(text.startsWith("---\nname: tidy-report\ndescription: 整理工作区产出报告\n---\n"), "frontmatter 按契约落盘（dsh 可发现形态）");
  assert.ok(text.includes("把结果写入 REPORT.md。"), "正文原样写入");
  // 覆盖写 = 幂等 upsert；删除两次收敛为同一终态（无此技能）
  await d.putSkill("sk-bob", "tidy-report", { name: "tidy-report", description: "改描述", body: "新正文" });
  assert.equal((await d.listSkills("sk-bob"))[0].description, "改描述");
  await d.deleteSkill("sk-bob", "tidy-report");
  await d.deleteSkill("sk-bob", "tidy-report");
  assert.equal((await d.listSkills("sk-bob")).length, 0);
  await assert.rejects(() => readFile(file, "utf8"), /ENOENT/, "删除后目录应消失");
  await rm(stateDir, { recursive: true, force: true });
});

test("frontmatter 非法拒绝（K3）：大写名/缺 description/name 与 :skill 不匹配/路径穿越", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("sk-val");
  await assert.rejects(() => d.putSkill("sk-val", "Tidy-Report", { name: "Tidy-Report", description: "x", body: "" }), /invalid skill name/);
  await assert.rejects(() => d.putSkill("sk-val", "tidy-report", { name: "tidy-report", description: "   ", body: "" }), /description required/);
  await assert.rejects(() => d.putSkill("sk-val", "tidy-report", { name: "other-name", description: "x", body: "" }), /mismatch/);
  await assert.rejects(() => d.putSkill("sk-val", "../escape", { name: "../escape", description: "x", body: "" }), /invalid skill name/);
  assert.equal((await d.listSkills("sk-val")).length, 0, "全部被拒，不应有任何落盘");
  // 手写的非法 SKILL.md：与 dsh 发现行为一致（列表跳过），不影响其余技能
  const root = path.join(stateDir, "bots", "sk-val", "ws", ".dsh", "skills", "broken");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "SKILL.md"), "no frontmatter here", "utf8");
  await d.putSkill("sk-val", "ok-one", { name: "ok-one", description: "好技能", body: "x" });
  assert.deepEqual((await d.listSkills("sk-val")).map((s) => s.name), ["ok-one"]);
  await rm(stateDir, { recursive: true, force: true });
});

test("git init 容错：git 不可用时降级只建目录，事件注明，技能 CRUD 不受影响", async () => {
  const { d, stateDir } = await freshDaemon();
  const origPath = process.env.PATH;
  process.env.PATH = "";
  let bot;
  try {
    bot = await d.create("sk-nogit");
  } finally {
    process.env.PATH = origPath;
  }
  assert.ok(bot.workspace.startsWith(path.join(stateDir, "bots", "sk-nogit")));
  assert.ok(bot.events.some((e) => e.kind === "created" && /git init unavailable/.test(e.detail)), "降级必须在事件注明");
  await d.putSkill("sk-nogit", "works-anyway", { name: "works-anyway", description: "x", body: "y" });
  assert.equal((await d.listSkills("sk-nogit"))[0].name, "works-anyway");
  await rm(stateDir, { recursive: true, force: true });
});

test("HTTP 层：技能 REST roundtrip（PUT → GET → DELETE）+ 404/400 形态", async () => {
  const { d, stateDir } = await freshDaemon();
  const { serveHttp } = await import("../src/daemon.ts");
  const port = 8820 + Math.floor(Math.random() * 100);
  const server = await serveHttp(d, port);
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(base + "/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "websk" }) });
    const put = await fetch(base + "/bots/websk/skills/calc-tax", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "calc-tax", description: "计算税费", body: "按 13% 计算。" }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { name: "calc-tax", description: "计算税费" });
    assert.deepEqual(await (await fetch(base + "/bots/websk/skills")).json(), [{ name: "calc-tax", description: "计算税费" }]);
    const bad = await fetch(base + "/bots/websk/skills/BadName", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "BadName", description: "x", body: "" }),
    });
    assert.equal(bad.status, 400);
    const del = await fetch(base + "/bots/websk/skills/calc-tax", { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.deepEqual(await (await fetch(base + "/bots/websk/skills")).json(), []);
    assert.equal((await fetch(base + "/bots/ghost/skills")).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---- U3-2：per-bot permissionMode（CB2 每调用显式权限姿态）----

test("permissionMode：默认 workspace-write、创建可指定、runBrief 按次透传给 driver（CB2）", async () => {
  const seen: Array<RunOptions | undefined> = [];
  const driver: Driver = {
    name: "scripted",
    async run(_bot, _ws, _brief, _events, opts?: RunOptions) {
      seen.push(opts);
      return { ok: true, summary: "x" };
    },
  };
  const { d, stateDir } = await freshDaemon(driver);
  assert.equal((await d.create("mode-default")).permissionMode, "workspace-write");
  assert.equal((await d.create("mode-locked", "read-only")).permissionMode, "read-only");
  await d.brief("mode-default", "t");
  await d.brief("mode-locked", "t");
  assert.deepEqual(seen.map((o) => o?.permissionMode), ["workspace-write", "read-only"]);
  await d.update("mode-locked", { permissionMode: "danger-full-access" });
  await d.brief("mode-locked", "t");
  assert.equal(seen[2]?.permissionMode, "danger-full-access", "改动后下一次 brief 生效");
  await rm(stateDir, { recursive: true, force: true });
});

test("update：permissionMode 非法值（含 auto）与未知字段拒绝，合法值随 bots.json 持久化", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("patchy");
  await assert.rejects(() => d.update("patchy", { permissionMode: "auto" }), /invalid permissionMode/); // C6：auto 不可选
  await assert.rejects(() => d.update("patchy", { permissionMode: "super" }), /invalid permissionMode/);
  await assert.rejects(() => d.update("patchy", { name: "new-name" } as Record<string, unknown>), /permissionMode only/);
  await assert.rejects(() => d.update("ghost", { permissionMode: "read-only" }), /no such bot/);
  assert.equal((await d.update("patchy", { permissionMode: "read-only" })).permissionMode, "read-only");
  const d2 = new BotDaemon({ stateDir, driverName: "stub" });
  await d2.load();
  assert.equal(d2.get("patchy")?.permissionMode, "read-only");
  await rm(stateDir, { recursive: true, force: true });
});

test("HTTP 层：POST /bots 可带 permissionMode，PATCH /bots/:n 改 mode（非法值 400）", async () => {
  const { d, stateDir } = await freshDaemon();
  const { serveHttp } = await import("../src/daemon.ts");
  const port = 8790 + Math.floor(Math.random() * 100);
  const server = await serveHttp(d, port);
  const base = `http://127.0.0.1:${port}`;
  const post = (body: unknown) =>
    fetch(base + "/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const patch = (name: string, body: unknown) =>
    fetch(`${base}/bots/${name}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const created = await post({ name: "locked", permissionMode: "read-only" });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).permissionMode, "read-only");
    assert.equal((await post({ name: "nope", permissionMode: "auto" })).status, 400);
    assert.equal((await patch("locked", { permissionMode: "danger-full-access" })).status, 200);
    const got = await (await fetch(base + "/bots/locked")).json();
    assert.equal(got.permissionMode, "danger-full-access");
    assert.equal((await patch("locked", { permissionMode: "yolo" })).status, 400);
    assert.equal((await patch("locked", { status: "idle" })).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---- U4：bot group（T-G0 组建层，daemon 只做注册/查询，不做调度决策）----

test("group CRUD roundtrip：建组 → 查询 → groups.json 持久化 → 解散（bot 不受影响）", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("coordinator-x");
  await d.create("engineer-y");
  const g = await d.createGroup("team-1", ["coordinator-x", "engineer-y"]);
  assert.equal(g.name, "team-1");
  assert.deepEqual(g.members, ["coordinator-x", "engineer-y"]);
  assert.ok(g.createdAt, "应有 createdAt");
  assert.ok(g.events.some((e) => e.kind === "created"), "建组落 created 事件（复用 BotEvent kind）");
  assert.deepEqual(d.getGroup("team-1"), g);
  assert.deepEqual(d.listGroups().map((x) => x.name), ["team-1"]);
  // groups.json 与 bots.json 同目录，重载可恢复
  const raw = JSON.parse(await readFile(path.join(stateDir, "groups.json"), "utf8")) as unknown[];
  assert.equal(raw.length, 1);
  const d2 = new BotDaemon({ stateDir, driverName: "stub" });
  await d2.load();
  assert.deepEqual(d2.getGroup("team-1")?.members, ["coordinator-x", "engineer-y"]);
  // 解散：组消失，bot 原样保留
  await d2.deleteGroup("team-1");
  assert.equal(d2.getGroup("team-1"), undefined);
  assert.ok(d2.get("coordinator-x"), "解散组不得删 bot");
  assert.equal(d2.listGroups().length, 0);
  await assert.rejects(() => d2.deleteGroup("team-1"), /no such group: team-1/, "重复解散明确报错");
  await rm(stateDir, { recursive: true, force: true });
});

test("group 校验：不存在 bot 拒绝 / 重复成员去重 / 去重后不足 2 拒绝 / 非法名与重名拒绝", async () => {
  const { d, stateDir } = await freshDaemon();
  await d.create("alice");
  await d.create("bob");
  await assert.rejects(() => d.createGroup("g1", ["alice", "ghost"]), /no such bot: ghost/);
  await assert.rejects(() => d.createGroup("g1", ["alice"]), />= 2 distinct/, "去重后不足 2 个拒绝");
  await assert.rejects(() => d.createGroup("g1", ["alice", 42] as unknown as string[]), /bot name string/);
  await assert.rejects(() => d.createGroup("g1", "alice,bob"), /array/, "非数组 members 拒绝");
  const dedup = await d.createGroup("dedup", ["alice", "alice", "bob"]);
  assert.deepEqual(dedup.members, ["alice", "bob"], "重复成员去重后 ≥2 即通过");
  await assert.rejects(() => d.createGroup("Bad Name!", ["alice", "bob"]), /invalid group name/);
  await assert.rejects(() => d.createGroup("dedup", ["alice", "bob"]), /already exists/);
  await assert.rejects(() => d.createGroup(undefined, ["alice", "bob"]), /invalid group name/);
  await rm(stateDir, { recursive: true, force: true });
});

test("HTTP 层：groups REST roundtrip（POST 201 → GET 列表/单个 → DELETE → 404）", async () => {
  const { d, stateDir } = await freshDaemon();
  const { serveHttp } = await import("../src/daemon.ts");
  const port = 8860 + Math.floor(Math.random() * 100);
  const server = await serveHttp(d, port);
  const base = `http://127.0.0.1:${port}`;
  const postBot = (name: string) =>
    fetch(base + "/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const postGroup = (body: unknown) =>
    fetch(base + "/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    for (const n of ["http-a", "http-b", "http-c"]) await postBot(n);
    const created = await postGroup({ name: "crew", members: ["http-a", "http-b"] });
    assert.equal(created.status, 201);
    const g = await created.json();
    assert.deepEqual(g.members, ["http-a", "http-b"]);
    assert.deepEqual(await (await fetch(base + "/groups")).json(), [g]);
    assert.deepEqual(await (await fetch(base + "/groups/crew")).json(), g);
    assert.equal((await fetch(base + "/groups/ghost")).status, 404);
    // 校验失败 400：成员 bot 不存在 / 去重后不足 2
    assert.equal((await postGroup({ name: "bad", members: ["http-a", "ghost"] })).status, 400);
    assert.equal((await postGroup({ name: "bad2", members: ["http-a"] })).status, 400);
    // 解散：组 404，bot 保留
    assert.equal((await fetch(base + "/groups/crew", { method: "DELETE" })).status, 200);
    assert.equal((await fetch(base + "/groups/crew")).status, 404);
    assert.equal((await fetch(base + "/groups/crew", { method: "DELETE" })).status, 404);
    assert.equal(((await (await fetch(base + "/bots/http-a")).json()) as { name: string }).name, "http-a");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---- U4：三职责角色技能模板（「技能即角色」，模板随 skillTemplates/ 分发）----

test("角色模板契约：三模板齐全、frontmatter 合法、正文 200-400 字且含各自 JSON schema 关键字段", async () => {
  const { listRoleTemplates } = await import("../src/role-templates.ts");
  const ts = await listRoleTemplates();
  assert.deepEqual(ts.map((t) => t.name), ["coordinator-brief", "engineer-discipline", "reviewer-verdict"]);
  for (const t of ts) {
    assert.ok(t.description.length > 0, `${t.name} description 必填`);
    assert.ok(t.body.length >= 200 && t.body.length <= 400, `${t.name} 正文应 200-400 字（实际 ${t.body.length}）`);
  }
  // T-G1 schema：coordinator 简报四字段必须出现在正文
  const coordinator = ts.find((t) => t.name === "coordinator-brief")!;
  for (const field of ["objective", "owner", "done_condition", "artifacts_expected"]) {
    assert.ok(coordinator.body.includes(field), `coordinator 正文缺简报字段 ${field}`);
  }
  // EXP-012 裁决格式：verdict/findings 及四 finding 字段必须出现在正文
  const reviewer = ts.find((t) => t.name === "reviewer-verdict")!;
  for (const token of ["verdict", "approve", "request-changes", "findings", "severity", "location", "issue", "evidence"]) {
    assert.ok(reviewer.body.includes(token), `reviewer 正文缺裁决字段 ${token}`);
  }
  // poteto prove-it-works 浓缩：最小改动/先看后改/验证/不凭宣称报完成
  const engineer = ts.find((t) => t.name === "engineer-discipline")!;
  for (const token of ["最小改动", "先看后改", "验证命令", "不凭宣称报完成"]) {
    assert.ok(engineer.body.includes(token), `engineer 正文缺纪律 ${token}`);
  }
});

test("模板安装：listRoleTemplates 输出可直接 putSkill，listSkills 可见且落盘为 dsh 可发现形态", async () => {
  const { listRoleTemplates, getRoleTemplate } = await import("../src/role-templates.ts");
  const { d, stateDir } = await freshDaemon();
  try {
    await d.create("role-bot");
    for (const t of await listRoleTemplates()) {
      const meta = await d.putSkill("role-bot", t.name, t);
      assert.deepEqual(meta, { name: t.name, description: t.description });
    }
    assert.deepEqual((await d.listSkills("role-bot")).map((s) => s.name), [
      "coordinator-brief",
      "engineer-discipline",
      "reviewer-verdict",
    ]);
    const disk = await readFile(
      path.join(stateDir, "bots", "role-bot", "ws", ".dsh", "skills", "reviewer-verdict", "SKILL.md"),
      "utf8",
    );
    assert.match(disk, /^---\nname: reviewer-verdict\n/);
    assert.ok(disk.includes("request-changes"));
    assert.deepEqual(await getRoleTemplate("engineer-discipline"), (await listRoleTemplates()).find((t) => t.name === "engineer-discipline"));
    assert.equal(await getRoleTemplate("no-such-role"), undefined);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

// ---- U4/T-G2：dispatch 编排（coordinator→engineer→reviewer 串行委派 + 回环上限 2 + 状态机）----

type ScriptedReply = string | ((call: number) => string);

/** 按 bot 名出词的 scripted driver：记录每次 (bot, brief)，可指定某 bot 永远失败。 */
function scriptedDispatchDriver(
  replies: Record<string, ScriptedReply>,
  log: Array<{ bot: string; brief: string }>,
  opts: { failBot?: string } = {},
): Driver {
  const calls = new Map<string, number>();
  return {
    name: "scripted-dispatch",
    async run(botName, _ws, brief) {
      log.push({ bot: botName, brief });
      const n = (calls.get(botName) ?? 0) + 1;
      calls.set(botName, n);
      if (opts.failBot === botName) return { ok: false, summary: `scripted failure in ${botName}` };
      const r = replies[botName];
      return { ok: true, summary: typeof r === "function" ? r(n) : (r ?? "ok") };
    },
  };
}

async function threeRoleGroup(driver: Driver, name = "dev-team") {
  const { d, stateDir } = await freshDaemon(driver);
  for (const n of ["coordinator-x", "engineer-y", "reviewer-z"]) await d.create(n);
  await d.createGroup(name, ["coordinator-x", "engineer-y", "reviewer-z"]);
  return { d, stateDir };
}

/** 轮询到 dispatch 收敛（终态或失败），超时即断言失败。 */
async function waitSettled(d: BotDaemon, group: string) {
  for (let i = 0; i < 2000 && d.getGroup(group)?.status === "dispatching"; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.notEqual(d.getGroup(group)?.status, "dispatching", "dispatch 应在限时内收敛");
}

test("dispatch 编排：三阶段严格串行（coordinator→engineer→reviewer），各 brief 携带角色技能名与上游输出", async () => {
  const mission = JSON.stringify({ objective: "实现 add(a,b) 并配单测", owner: "engineer-y", done_condition: "node math.test.js 通过", artifacts_expected: ["math.js"] });
  const engineerOut = "已实现 math.js；验证命令 node math.test.js；预期输出 3=3";
  const verdict = JSON.stringify({ verdict: "approve", findings: [] });
  const log: Array<{ bot: string; brief: string }> = [];
  const { d, stateDir } = await threeRoleGroup(
    scriptedDispatchDriver({ "coordinator-x": mission, "engineer-y": engineerOut, "reviewer-z": verdict }, log),
  );
  const r = await d.dispatch("dev-team", "给玩具模块加一个加法函数");
  assert.deepEqual(r, { dispatchId: "1", state: "running" }, "异步受理：返回 dispatchId 与 running");
  await waitSettled(d, "dev-team");
  assert.deepEqual(log.map((l) => l.bot), ["coordinator-x", "engineer-y", "reviewer-z"], "三阶段按角色顺序严格串行");
  assert.match(log[0].brief, /coordinator-brief/);
  assert.match(log[0].brief, /加法函数/, "coordinator 收到原始需求");
  assert.match(log[1].brief, /engineer-discipline/);
  assert.ok(log[1].brief.includes(mission), "coordinator 回复全文透传为 engineer 简报（v0 不解析）");
  assert.match(log[2].brief, /reviewer-verdict/);
  assert.ok(log[2].brief.includes(engineerOut), "engineer 产物自述进入 reviewer 审查输入");
  const disp = d.getGroup("dev-team")!.dispatches[0];
  assert.deepEqual(
    { state: disp.state, rounds: disp.rounds, verdict: disp.verdict },
    { state: "done", rounds: 1, verdict },
  );
  assert.ok(disp.objective.includes("加法函数") && disp.dispatchedAt, "GroupDispatch 形状完整");
  assert.equal(d.getGroup("dev-team")!.status, "done", "approve → 组终态 done");
  // T-G2 事件流序（events[0] 是建组 created）：dispatch → brief(c) → done(c) → brief(e) → done(e) → brief(r) → done(r) → group_summary
  const g = d.getGroup("dev-team")!;
  assert.deepEqual(
    g.events.slice(1).map((e) => e.kind),
    ["step", "brief_received", "done", "brief_received", "done", "brief_received", "done", "step"],
  );
  assert.match(g.events[1].detail, /dispatch 1 started/);
  assert.match(g.events[2].detail, /stage=coordinator/);
  assert.match(g.events.at(-1)!.detail, /group_summary.*state=done/);
  await rm(stateDir, { recursive: true, force: true });
});

test("dispatch 回环上限 2：两轮 request-changes → engineer 再委派一次、reviewer 重审后终态 needs-rework", async () => {
  const mission = "任务简报：修 off-by-one";
  const v1 = JSON.stringify({ verdict: "request-changes", findings: [{ severity: "high", location: "math.js:1", issue: "加法写成减法", evidence: "node math.test.js 输出 0" }] });
  const v2 = JSON.stringify({ verdict: "request-changes", findings: [{ severity: "high", location: "math.js:2", issue: "仍未修", evidence: "test 仍红" }] });
  const outs = ["第一版产物自述", "修复版产物自述"];
  const log: Array<{ bot: string; brief: string }> = [];
  const { d, stateDir } = await threeRoleGroup(
    scriptedDispatchDriver(
      { "coordinator-x": mission, "engineer-y": (n) => outs[n - 1] ?? "第三版", "reviewer-z": (n) => (n === 1 ? v1 : v2) },
      log,
    ),
  );
  await d.dispatch("dev-team", "种子缺陷任务");
  await waitSettled(d, "dev-team");
  assert.deepEqual(
    log.map((l) => l.bot),
    ["coordinator-x", "engineer-y", "reviewer-z", "engineer-y", "reviewer-z"],
    "request-changes 只回环一次（共 2 轮），不多委派",
  );
  assert.ok(log[3].brief.includes(v1) && log[3].brief.includes(outs[0]), "第二轮 engineer 简报带上轮产物与裁决");
  const allDetails = d.getGroup("dev-team")!.events.map((e) => e.detail).join("\n");
  assert.match(allDetails, /stage=engineer-r2/);
  assert.match(allDetails, /stage=reviewer-r2/, "回环阶段在事件流中可辨");
  assert.ok(log[4].brief.includes(outs[1]), "reviewer 重审收到修复后产物");
  const disp = d.getGroup("dev-team")!.dispatches[0];
  assert.equal(disp.rounds, 2);
  assert.equal(disp.state, "needs-rework");
  assert.equal(disp.verdict, v2, "verdict 存终轮裁决全文");
  assert.equal(d.getGroup("dev-team")!.status, "needs-rework");
  assert.match(d.getGroup("dev-team")!.events.at(-1)!.detail, /state=needs-rework/);
  await rm(stateDir, { recursive: true, force: true });
});

test("dispatch 回环后修复通过：第二轮 approve → 终态 done（reviewer 重新裁决生效）", async () => {
  const v1 = JSON.stringify({ verdict: "request-changes", findings: [{ severity: "low", location: "a.js:1", issue: "缺注释", evidence: "目测" }] });
  const v2 = JSON.stringify({ verdict: "approve", findings: [] });
  const log: Array<{ bot: string; brief: string }> = [];
  const { d, stateDir } = await threeRoleGroup(
    scriptedDispatchDriver(
      { "coordinator-x": "简报", "engineer-y": (n) => `产物 v${n}`, "reviewer-z": (n) => (n === 1 ? v1 : v2) },
      log,
    ),
  );
  await d.dispatch("dev-team", "任务");
  await waitSettled(d, "dev-team");
  assert.equal(log.length, 5, "回环一次后 reviewer 批准，停止");
  const disp = d.getGroup("dev-team")!.dispatches[0];
  assert.deepEqual({ state: disp.state, rounds: disp.rounds, verdict: disp.verdict }, { state: "done", rounds: 2, verdict: v2 });
  assert.equal(d.getGroup("dev-team")!.status, "done");
  await rm(stateDir, { recursive: true, force: true });
});

test("dispatch 不阻塞其他 bot：coordinator 阶段挂起时，组外 bot 的 brief 正常并行完成", async () => {
  let releaseCoordinator: () => void = () => {};
  const coordinatorGate = new Promise<void>((r) => (releaseCoordinator = r));
  const driver: Driver = {
    name: "gated-dispatch",
    async run(botName) {
      if (botName === "coordinator-x") await coordinatorGate;
      return { ok: true, summary: botName === "coordinator-x" ? "coord done" : "x" };
    },
  };
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(pred(), "condition not reached");
  };
  const { d, stateDir } = await threeRoleGroup(driver);
  await d.create("solo");
  await d.dispatch("dev-team", "任务");
  await until(() => d.get("coordinator-x")?.status === "running");
  const solo = await d.brief("solo", "独立任务");
  assert.equal(solo.status, "idle", "组外 bot 不受 dispatch 影响，正常完成");
  assert.equal(d.get("coordinator-x")?.status, "running", "coordinator 此刻仍在执行（未被打断）");
  releaseCoordinator();
  await waitSettled(d, "dev-team");
  await rm(stateDir, { recursive: true, force: true });
});

test("dispatch 状态机守门：缺三角色/未知组/空 objective/重入拒绝；dispatches 随 groups.json 持久化", async () => {
  const log: Array<{ bot: string; brief: string }> = [];
  const driver = scriptedDispatchDriver(
    { "coordinator-x": "简报", "engineer-y": "产物", "reviewer-z": '{"verdict":"approve","findings":[]}' },
    log,
  );
  const { d, stateDir } = await freshDaemon(driver);
  for (const n of ["coordinator-x", "engineer-y", "reviewer-z", "alice", "bob"]) await d.create(n);
  await d.createGroup("two-only", ["alice", "bob"]);
  await assert.rejects(() => d.dispatch("two-only", "x"), /coordinator-.*engineer-.*reviewer-|must include/, "缺任一角色拒绝");
  await assert.rejects(() => d.dispatch("ghost", "x"), /no such group/);
  await assert.rejects(() => d.dispatch("two-only", "   "), /objective/);
  await assert.rejects(() => d.dispatch("two-only", 42 as unknown as string), /objective/);
  await d.createGroup("ok-team", ["coordinator-x", "engineer-y", "reviewer-z"]);
  await d.dispatch("ok-team", "任务");
  await waitSettled(d, "ok-team");
  assert.equal(d.getGroup("ok-team")!.status, "done");
  // 重入：终态后可再次 dispatch（新记录追加，id 递增）
  const second = await d.dispatch("ok-team", "第二个任务");
  assert.equal(second.dispatchId, "2");
  await waitSettled(d, "ok-team");
  assert.equal(d.getGroup("ok-team")!.dispatches.length, 2);
  // 持久化：重载后 dispatch 记录仍在
  const d2 = new BotDaemon({ stateDir, driver });
  await d2.load();
  assert.equal(d2.getDispatch("ok-team", "1")?.state, "done");
  assert.equal(d2.getDispatch("ok-team", "2")?.state, "done");
  assert.equal(d2.getDispatch("ok-team", "3"), undefined);
  assert.equal(d2.getDispatch("ghost", "1"), undefined);
  await rm(stateDir, { recursive: true, force: true });
});

test("dispatch 阶段失败：bot run 失败 → dispatch failed、group failed、error 事件、后续阶段不执行；终态后可重新发起", async () => {
  const log: Array<{ bot: string; brief: string }> = [];
  const driver: Driver = {
    name: "fail-mid",
    async run(botName) {
      log.push({ bot: botName, brief: "" });
      if (botName === "engineer-y") return { ok: false, summary: "engineer boom" };
      return { ok: true, summary: "m" };
    },
  };
  const { d, stateDir } = await threeRoleGroup(driver);
  await d.dispatch("dev-team", "任务");
  await waitSettled(d, "dev-team");
  assert.deepEqual(log.map((l) => l.bot), ["coordinator-x", "engineer-y"], "失败后不进入 reviewer 阶段");
  const g = d.getGroup("dev-team")!;
  const disp = g.dispatches[0];
  assert.equal(disp.state, "failed");
  assert.equal(disp.verdict, null, "未走到审查，verdict 为 null");
  assert.match(disp.summary, /engineer/);
  assert.equal(g.status, "failed");
  assert.ok(g.events.some((e) => e.kind === "error" && /dispatch 1 failed/.test(e.detail)), "失败落 error 事件");
  // failed 是终态而非 dispatching：可立即重新发起
  const second = await d.dispatch("dev-team", "重试任务");
  assert.deepEqual(second, { dispatchId: "2", state: "running" });
  await waitSettled(d, "dev-team");
  await rm(stateDir, { recursive: true, force: true });
});

test("verdict 解析：纯 JSON / 混入正文 / 畸形 JSON 裸键值可辨 / 不可判定返回 null", async () => {
  const { parseVerdict } = await import("../src/daemon.ts");
  assert.equal(parseVerdict('{"verdict":"approve","findings":[]}'), "approve");
  assert.equal(parseVerdict('审查结论如下：\n{"verdict":"request-changes","findings":[{"severity":"high"}]}\n以上。'), "request-changes");
  assert.equal(parseVerdict('{"verdict":"approve", 非法尾随'), "approve", "畸形 JSON 但键值形态可辨");
  assert.equal(parseVerdict('{"verdict":"maybe"}'), null, "枚举外取值不可判定");
  assert.equal(parseVerdict("完全无法判定的回复"), null);
  assert.equal(parseVerdict(""), null);
});

test("HTTP 层：POST /groups/:g/dispatch 异步受理 + GET dispatches/:id 详情 + 404/400 形态", async () => {
  const { d, stateDir } = await threeRoleGroup(
    scriptedDispatchDriver(
      { "coordinator-x": "任务简报", "engineer-y": "产物自述", "reviewer-z": '{"verdict":"approve","findings":[]}' },
      [],
    ),
  );
  const { serveHttp } = await import("../src/daemon.ts");
  const port = 8880 + Math.floor(Math.random() * 100);
  const server = await serveHttp(d, port);
  const base = `http://127.0.0.1:${port}`;
  try {
    const post = await fetch(base + "/groups/dev-team/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "HTTP 冒烟任务" }),
    });
    assert.equal(post.status, 200);
    assert.deepEqual(await post.json(), { dispatchId: "1", state: "running" });
    let disp: Record<string, unknown> = {};
    for (let i = 0; i < 400; i++) {
      disp = (await (await fetch(base + "/groups/dev-team/dispatches/1")).json()) as Record<string, unknown>;
      if (disp.state !== "running") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(disp.state, "done");
    assert.equal(disp.rounds, 1);
    assert.ok(String(disp.verdict).includes("approve"));
    assert.ok(String(disp.summary).includes("approved"));
    assert.equal((await fetch(base + "/groups/dev-team/dispatches/99")).status, 404);
    assert.equal((await fetch(base + "/groups/ghost/dispatches/1")).status, 404);
    assert.equal((await fetch(base + "/groups/ghost/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objective: "x" }) })).status, 400);
    const bad = await fetch(base + "/groups/dev-team/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 400, "缺 objective 拒绝");
    // group JSON 现在带 status/dispatches，供前端与轮询使用
    const g = (await (await fetch(base + "/groups/dev-team")).json()) as { status: string; dispatches: unknown[] };
    assert.equal(g.status, "done");
    assert.equal(g.dispatches.length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(stateDir, { recursive: true, force: true });
  }
});
