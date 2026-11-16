// dsh-bot CLI（与 daemon 同实现，无需 HTTP 即可操作）
// 用法：
//   node src/cli.ts create <name>
//   node src/cli.ts brief <name> <text...>
//   node src/cli.ts status [name]
//   node src/cli.ts logs <name>
//   node src/cli.ts serve [port]

import { BotDaemon, serveHttp } from "./daemon.ts";
import path from "node:path";

const stateDir = process.env.DSH_BOT_STATE ?? path.resolve("state");
const [cmd, ...args] = process.argv.slice(2);

const daemon = new BotDaemon({ stateDir });
await daemon.load();

switch (cmd) {
  case "create": {
    const bot = await daemon.create(args[0]);
    console.log(JSON.stringify(bot, null, 2));
    break;
  }
  case "brief": {
    const [name, ...text] = args;
    const bot = await daemon.brief(name, text.join(" "));
    console.log(JSON.stringify({ name: bot.name, status: bot.status, lastResult: bot.lastResult }, null, 2));
    break;
  }
  case "status": {
    console.log(JSON.stringify(args[0] ? daemon.get(args[0]) : daemon.list(), null, 2));
    break;
  }
  case "logs": {
    const bot = daemon.get(args[0]);
    if (!bot) {
      console.error(`no such bot: ${args[0]}`);
      process.exit(1);
    }
    for (const e of bot.events) console.log(`${e.at}  ${e.kind.padEnd(17)} ${e.detail}`);
    break;
  }
  case "serve": {
    const port = Number(args[0] ?? 8787);
    await serveHttp(daemon, port);
    console.log(`dsh-bot daemon on http://127.0.0.1:${port} (state: ${stateDir})`);
    break;
  }
  default:
    console.error("usage: dsh-bot <create|brief|status|logs|serve> ...");
    process.exit(1);
}
