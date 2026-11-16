// Driver 层：隔离"如何驱动一次 bot 任务执行"。
// U1: stub —— 无密钥冒烟，产出运行证据（workspace 内文件 + 事件）。
// U2: dsh  —— 真实驱动（headless 一发式）。dsh 处于 developer preview，
//             CLI 细节以容器内探测结果为准后再固定参数（见 docs/PLAN.md 风险节）。

export type BotEvent = {
  at: string;            // ISO timestamp
  kind: "created" | "brief_received" | "step" | "approval_request" | "done" | "error";
  detail: string;
};

export type DriverResult = { ok: boolean; summary: string };

export interface Driver {
  readonly name: string;
  /** 在 bot 工作区内执行一次 brief；返回结果摘要。禁止触碰工作区以外路径。 */
  run(botName: string, workspace: string, brief: string, events: BotEvent[]): Promise<DriverResult>;
}

export function stubDriver(): Driver {
  return {
    name: "stub",
    async run(botName, workspace, brief, events) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      events.push({ at: new Date().toISOString(), kind: "brief_received", detail: brief.slice(0, 200) });
      await mkdir(workspace, { recursive: true });
      const evidence = path.join(workspace, "last-run.md");
      await writeFile(
        evidence,
        `# stub run\n\nbot: ${botName}\nat: ${new Date().toISOString()}\nbrief: ${brief}\n\nevidence: this file is the run artifact written inside the bot workspace.\n`,
        "utf8",
      );
      events.push({ at: new Date().toISOString(), kind: "step", detail: "stub: wrote last-run.md" });
      events.push({ at: new Date().toISOString(), kind: "done", detail: "stub run complete" });
      return { ok: true, summary: "stub run complete (see workspace/last-run.md)" };
    },
  };
}

export function dshDriver(): Driver {
  // U2 实装。占位实现先给出可探测的错误信息，避免静默误跑。
  return {
    name: "dsh",
    async run(_botName, _workspace, _brief, events) {
      events.push({
        at: new Date().toISOString(),
        kind: "error",
        detail: "dsh driver not wired yet (U2). Set DSH_BOT_DRIVER=stub for smoke runs.",
      });
      return { ok: false, summary: "dsh driver pending U2" };
    },
  };
}

export function makeDriver(which: string | undefined): Driver {
  switch (which) {
    case "dsh":
      return dshDriver();
    case "stub":
    case undefined:
    case "":
      return stubDriver();
    default:
      throw new Error(`unknown driver: ${which} (expected "stub" | "dsh")`);
  }
}
