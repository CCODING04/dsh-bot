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

export function dshDriver(opts: {
  dshBin?: string;
  patchPath?: string;
  approvalPolicy?: "ask" | "never";
  timeoutMs?: number;
} = {}): Driver {
  const dshBin = opts.dshBin ?? process.env.DSH_BIN ?? "dsh";
  const patchPath = opts.patchPath ?? process.env.DSH_PATCH ?? "/app/docker/dsh-glm-patch.yml";
  const approvalPolicy = opts.approvalPolicy ?? (process.env.DSH_APPROVAL_POLICY as "ask" | "never") ?? "never";
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DSH_TIMEOUT_MS ?? 10 * 60_000);
  return {
    name: "dsh",
    async run(botName, workspace, brief, events) {
      const { spawn } = await import("node:child_process");
      events.push({
        at: new Date().toISOString(),
        kind: "brief_received",
        detail: `${dshBin} headless · patch=${patchPath} · approval=${approvalPolicy} · cwd=${workspace}`,
      });
      const answer = await new Promise<string>((resolve) => {
        const child = spawn(
          dshBin,
          ["--profile", "headless", "--patch", patchPath, "--approval-policy", approvalPolicy, "-"],
          { cwd: workspace, stdio: ["pipe", "pipe", "pipe"] },
        );
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          err += `\n[dsh-bot] timeout after ${timeoutMs}ms`;
        }, timeoutMs);
        child.stdout.on("data", (c: Buffer) => (out += c));
        child.stderr.on("data", (c: Buffer) => (err += c));
        child.on("error", (e) => {
          clearTimeout(timer);
          resolve(`spawn error: ${e.message}`);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code === 0 ? out : `exit ${code}\n${out}\n[dsh stderr] ${err.slice(-2000)}`);
        });
        child.stdin.write(brief);
        child.stdin.end();
      });
      events.push({ at: new Date().toISOString(), kind: "step", detail: `dsh exited; answer head: ${answer.slice(0, 200)}` });
      const ok = !answer.startsWith("spawn error:") && !answer.startsWith("exit ") && !answer.includes("[dsh-bot] timeout");
      events.push({ at: new Date().toISOString(), kind: ok ? "done" : "error", detail: ok ? "dsh run complete" : answer.slice(0, 500) });
      return { ok, summary: answer.trim().slice(0, 2000) || "(empty)" };
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
