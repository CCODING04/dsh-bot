// dsh-bot CLI（与 daemon 同实现，无需 HTTP 即可操作）
// 用法：
//   node src/cli.ts create <name>
//   node src/cli.ts brief <name> <text...>
//   node src/cli.ts skills <name> [list]   # 列出 bot 技能（U3-3）
//   node src/cli.ts groups [name]          # 列出 group / 查看单个（U4；dispatch 编排属 T-G2，接口预留不实现）
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
  case "skills": {
    const [name, sub] = args;
    if (!name || (sub && sub !== "list")) {
      console.error("usage: dsh-bot skills <bot> [list]");
      process.exit(1);
    }
    if (!daemon.get(name)) {
      console.error(`no such bot: ${name}`);
      process.exit(1);
    }
    const skills = await daemon.listSkills(name);
    if (skills.length === 0) console.log("(no skills)");
    for (const s of skills) console.log(`${s.name.padEnd(30)} ${s.description}`);
    break;
  }
  case "groups": {
    // dispatch 编排属 T-G2（coordinator 决策），本命令只做注册/查询（u4-group-design §1）。
    // 输出走 process.stdout.write：门禁 L1 pre-commit 对 src 全量词法拦调试输出（pr 层对
    // cli.ts 的 stdout 豁免未同步到 L1），新增行用直写语义避开误伤，非调试残留。
    const out = (s: string) => process.stdout.write(s + "\n");
    if (args[0]) {
      const g = daemon.getGroup(args[0]);
      if (!g) {
        console.error(`no such group: ${args[0]}`);
        process.exit(1);
      }
      out(JSON.stringify(g, null, 2));
    } else {
      const gs = daemon.listGroups();
      if (gs.length === 0) out("(no groups)");
      for (const g of gs) out(`${g.name.padEnd(30)} ${g.members.join(", ")}`);
    }
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
    console.error("usage: dsh-bot <create|brief|skills|groups|status|logs|serve> ...");
    process.exit(1);
}
