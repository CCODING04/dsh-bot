// U1 验收测试（node:test，零依赖；stub driver，不触碰网络与本机 dsh）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BotDaemon } from "../src/daemon.ts";

async function freshDaemon() {
  const stateDir = await mkdtemp(path.join(tmpdir(), "dsh-bot-test-"));
  const d = new BotDaemon({ stateDir, driverName: "stub" });
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
