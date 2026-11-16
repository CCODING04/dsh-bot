// dsh-bot daemon：命名 bot 的生命周期 + 任务下发 + 事件流。
// U1 形态：进程内 registry（JSON 持久化），HTTP + CLI 共用同一实现。
// 每个 bot 的"电脑"= state 目录下独立 workspace（容器内卷）。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer, type IncomingMessage } from "node:http";
import { makeDriver, dshRunOk, type BotEvent, type Driver } from "./drivers.ts";

const webIndex = path.join(import.meta.dirname, "..", "web", "index.html");

export type Bot = {
  name: string;
  createdAt: string;
  status: "idle" | "running" | "awaiting_approval" | "failed";
  workspace: string;
  sessionId: string | null; // 绑定最后一次成功轮次的 dsh 会话（resume 用，随 bots.json 持久化）；失败不动（CB3）
  events: BotEvent[];
  lastBrief: string | null;
  lastResult: string | null;
};

export type DaemonOptions = {
  stateDir: string;          // 持久化根（容器内 /state）
  driverName?: string;       // stub | dsh
  driver?: Driver;           // 直接注入 driver 实例（测试/装配用）；缺省按 driverName/env 构造
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
      for (const b of raw) {
        if (b.sessionId === undefined) b.sessionId = null; // U3 前的 bots.json 无此字段
        this.bots.set(b.name, b);
      }
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
      sessionId: null,
      events: [{ at: new Date().toISOString(), kind: "created", detail: `workspace at ${workspace}` }],
      lastBrief: null,
      lastResult: null,
    };
    this.bots.set(name, bot);
    await this.persist();
    return bot;
  }

  /** 同 bot 的任务串行排队（前一进程 close 后再下一个），不同 bot 并行（CB8 单写者纪律）。 */
  private queues = new Map<string, Promise<unknown>>();

  /** 下发一次 brief：同 bot 有未完成任务时等待，然后驱动执行、落事件、更新状态、维护会话绑定。 */
  async brief(name: string, brief: string): Promise<Bot> {
    const bot = this.bots.get(name);
    if (!bot) throw new Error(`no such bot: ${name}`);
    const prev = this.queues.get(name) ?? Promise.resolve();
    const run = prev.then(() => this.runBrief(bot, brief));
    // 队尾吞掉 rejection 只是防止链式 unhandledRejection；调用方仍拿到原始拒绝
    this.queues.set(name, run.then(() => undefined, () => undefined));
    return run;
  }

  private async runBrief(bot: Bot, brief: string): Promise<Bot> {
    const driver = this.opts.driver ?? makeDriver(this.opts.driverName ?? process.env.DSH_BOT_DRIVER);
    bot.status = "running";
    bot.lastBrief = brief;
    try {
      const r = await driver.run(bot.name, bot.workspace, brief, bot.events, { sessionId: bot.sessionId });
      bot.status = r.ok ? "idle" : "failed";
      bot.lastResult = r.summary;
      // CB3（主会话裁决）：失败清绑定——失败轮次不延续上下文，下次 brief 开新会话；
      // 仅 exit==0 且 final=completed 时写入本轮 id（不依赖失败轮次是否落盘）
      if (r.dsh && dshRunOk(r.dsh) && r.dsh.sessionId !== null) {
        bot.sessionId = r.dsh.sessionId;
      } else if (r.dsh) {
        bot.sessionId = null;
      }
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
