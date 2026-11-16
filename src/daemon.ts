// dsh-bot daemon：命名 bot 的生命周期 + 任务下发 + 事件流。
// U1 形态：进程内 registry（JSON 持久化），HTTP + CLI 共用同一实现。
// 每个 bot 的"电脑"= state 目录下独立 workspace（容器内卷）。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import { makeDriver, type BotEvent } from "./drivers.ts";

const webIndex = path.join(import.meta.dirname, "..", "web", "index.html");

export type Bot = {
  name: string;
  createdAt: string;
  status: "idle" | "running" | "awaiting_approval" | "failed";
  workspace: string;
  events: BotEvent[];
  lastBrief: string | null;
  lastResult: string | null;
};

export type DaemonOptions = {
  stateDir: string;          // 持久化根（容器内 /state）
  driverName?: string;       // stub | dsh
};

export class BotDaemon {
  private bots = new Map<string, Bot>();
  private readonly botsFile: string;
  private readonly opts: DaemonOptions;

  constructor(opts: DaemonOptions) {
    this.opts = opts;
    this.botsFile = path.join(opts.stateDir, "bots.json");
  }

  async load() {
    await mkdir(this.opts.stateDir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.botsFile, "utf8")) as Bot[];
      for (const b of raw) this.bots.set(b.name, b);
    } catch {
      /* 首次启动无文件 */
    }
  }

  private async persist() {
    await mkdir(this.opts.stateDir, { recursive: true });
    await writeFile(this.botsFile, JSON.stringify([...this.bots.values()], null, 2), "utf8");
  }

  list(): Bot[] {
    return [...this.bots.values()];
  }

  get(name: string): Bot | undefined {
    return this.bots.get(name);
  }

  async create(name: string): Promise<Bot> {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
      throw new Error(`invalid bot name: ${name}`);
    }
    if (this.bots.has(name)) throw new Error(`bot already exists: ${name}`);
    const workspace = path.join(this.opts.stateDir, "bots", name, "ws");
    await mkdir(workspace, { recursive: true });
    const bot: Bot = {
      name,
      createdAt: new Date().toISOString(),
      status: "idle",
      workspace,
      events: [{ at: new Date().toISOString(), kind: "created", detail: `workspace at ${workspace}` }],
      lastBrief: null,
      lastResult: null,
    };
    this.bots.set(name, bot);
    await this.persist();
    return bot;
  }

  /** 下发一次 brief：驱动执行、落事件、更新状态。串行化以保证事件序。 */
  async brief(name: string, brief: string): Promise<Bot> {
    const bot = this.bots.get(name);
    if (!bot) throw new Error(`no such bot: ${name}`);
    const driver = makeDriver(this.opts.driverName ?? process.env.DSH_BOT_DRIVER);
    bot.status = "running";
    bot.lastBrief = brief;
    try {
      const r = await driver.run(name, bot.workspace, brief, bot.events);
      bot.status = r.ok ? "idle" : "failed";
      bot.lastResult = r.summary;
      if (bot.events.some((e) => e.kind === "approval_request")) bot.status = "awaiting_approval";
    } catch (err) {
      bot.status = "failed";
      bot.lastResult = String(err);
      bot.events.push({ at: new Date().toISOString(), kind: "error", detail: String(err) });
    }
    await this.persist();
    return bot;
  }
}

/** 极简 JSON HTTP 服务：POST /bots, POST /bots/:n/brief, GET /bots, GET /bots/:n；返回 server 以便测试关闭 */
export function serveHttp(daemon: BotDaemon, port: number): Promise<import("node:http").Server> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      try {
        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          const html = await readFile(webIndex, "utf8");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(html);
        }
        if (req.method === "GET" && parts.length === 1 && parts[0] === "bots") return json(200, daemon.list());
        if (req.method === "POST" && parts.length === 1 && parts[0] === "bots") {
          const body = JSON.parse(await readBody(req)) as { name: string };
          return json(201, await daemon.create(body.name));
        }
        if (req.method === "GET" && parts.length === 2 && parts[0] === "bots") {
          const bot = daemon.get(parts[1]);
          return bot ? json(200, bot) : json(404, { error: `no such bot: ${parts[1]}` });
        }
        if (req.method === "POST" && parts.length === 3 && parts[0] === "bots" && parts[2] === "brief") {
          const body = JSON.parse(await readBody(req)) as { text: string };
          return json(200, await daemon.brief(parts[1], body.text));
        }
        json(404, { error: "not found" });
      } catch (err) {
        json(400, { error: String(err) });
      }
    });
    server.listen(port, () => resolve(server));
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
