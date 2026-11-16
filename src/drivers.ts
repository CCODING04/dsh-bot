// Driver 层：隔离"如何驱动一次 bot 任务执行"。
// U1: stub —— 无密钥冒烟，产出运行证据（workspace 内文件 + 事件）。
// U2: dsh  —— 真实驱动（headless 一发式，--json NDJSON 事件流，U3 起支持会话延续）。

export type BotEvent = {
  at: string;            // ISO timestamp
  // permission_blocked 是事后信号（非实时审批请求）：headless 事件流没有审批事件，
  // 只有 tool_result.error.code 能反映"被权限策略阻止"（U3 规格 C8/CB4）。
  kind: "created" | "brief_received" | "step" | "permission_blocked" | "done" | "error";
  detail: string;
};

/** 映射为 permission_blocked 的 tool_result.error.code 全集（CB4）。 */
export const PERMISSION_BLOCKED_CODES: ReadonlySet<string> = new Set([
  "SANDBOX_ESCALATION_UNAVAILABLE",
  "SANDBOX_ESCALATION_REJECTED",
  "SANDBOX_ESCALATION_CANCELLED",
  "AUTO_REVIEW_DENIED",
  "AUTO_REVIEW_FAILED",
]);

/** tool_result 事件携带的持久化错误形状（上游 json-stream 投影，{name, code, reason?}）。 */
export type ToolResultError = { name: string; code?: string; reason?: string };

/** dsh --json 一次运行的结构化结果。三类终止：completed / error（轮次内失败仍有 final）/ 无 final（runner 级失败或被 kill）。 */
export type DshRunResult = {
  sessionId: string | null;                       // session/final 事件给出；null = 未见到
  finalReasonKind: "completed" | "error" | null;  // null = 无 final 事件
  finalReasonRaw?: string;                        // final.reason.kind 原始值（aborted/interrupted 等诊断信息）
  text: string;                                   // final.text（无损、不限长）优先，回退 text 事件拼接（8KiB/条截断）
  toolResults: ToolResultError[];                 // 仅收集带 error 的 tool_result
  exitCode: number;                               // -1 = spawn 失败或被信号杀死（close code 为 null）
  runnerError?: string;                           // 无 final 的 error 事件（runner 挂载前/用法错误）
};

/** 成败双条件：进程退出码 0 且 final.reason.kind === "completed"（CB5）。 */
export function dshRunOk(res: DshRunResult): boolean {
  return res.exitCode === 0 && res.finalReasonKind === "completed";
}

/**
 * 纯函数：解析 --json stdout 的 NDJSON 行流（词汇 session/status/text/thinking/tool_call/tool_result/final/error）。
 * 接受行数组或整段字符串；driver 只做进程 IO，解析逻辑全部在这里以便单测。
 */
export function parseDshJsonStream(input: string | string[], exitCode: number): DshRunResult {
  const lines = typeof input === "string" ? input.split("\n") : input;
  let sessionEventId: string | null = null;
  let finalId: string | null = null;
  let finalReasonKind: DshRunResult["finalReasonKind"] = null;
  let finalReasonRaw: string | undefined;
  let finalText: string | null = null;
  let text = "";
  let runnerError: string | undefined;
  const toolResults: ToolResultError[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let ev: Record<string, any>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // 超时 kill 可能截断末行；半行不是可信事件，跳过
    }
    switch (ev.type) {
      case "session":
        if (sessionEventId === null && typeof ev.sessionId === "string") sessionEventId = ev.sessionId;
        break;
      case "text":
        if (typeof ev.text === "string") text += ev.text;
        break;
      case "tool_result":
        if (ev.error && typeof ev.error.name === "string") {
          toolResults.push({ name: ev.error.name, code: ev.error.code, reason: ev.error.reason });
        }
        break;
      case "final":
        // 末行 final 是权威定论：id 与答案以它为准（S1 交叉校验）
        if (typeof ev.sessionId === "string") finalId = ev.sessionId;
        // 只有 completed 算成功；error/aborted/interrupted/未知 kind 一律按失败
        if (typeof ev.reason?.kind === "string") finalReasonRaw = ev.reason.kind;
        finalReasonKind = ev.reason?.kind === "completed" ? "completed" : "error";
        if (typeof ev.text === "string") finalText = ev.text;
        break;
      case "error":
        runnerError = typeof ev.message === "string" ? ev.message : JSON.stringify(ev.message);
        break;
    }
  }
  return {
    sessionId: finalId ?? sessionEventId,
    finalReasonKind,
    finalReasonRaw,
    text: finalText && finalText.length > 0 ? finalText : text,
    toolResults,
    exitCode,
    runnerError,
  };
}

export function buildDshArgs(o: {
  patchPath: string;
  approvalPolicy: "ask" | "never";
  sessionId?: string | null;
  permissionMode?: string;
}): string[] {
  // --approval-policy 必须每次显式传：resume 不恢复权限姿态，漏传会静默回退
  // env 推导的 workspace-write+ask（headless 无应答者 = fail-closed，CB2/CB3）。
  // 顺序契约（E2E 实测）：--patch 是 launcher 级选项，必须排在 --json 之前——
  // launcher 遇到第一个非自身选项（--json）即停止解析并把剩余整体交给 app 层，
  // app 不认识 --patch 会报 "runner: unknown option '--patch'"。
  const args = ["--profile", "headless", "--patch", o.patchPath, "--json", "--approval-policy", o.approvalPolicy];
  if (o.permissionMode) args.push("--permission-mode", o.permissionMode);
  // dsh 拒绝空串 id；无绑定不传 = 开新会话（失败重开策略由 daemon 决定，CB3）
  if (o.sessionId) args.push("--session-id", o.sessionId);
  args.push("-");
  return args;
}

/** 把解析结果映射为事件（permission_blocked 事后信号 + 终态），纯函数可单测（3.2.8 事件转发）。 */
export function dshResultEvents(res: DshRunResult, at: string): BotEvent[] {
  const events: BotEvent[] = [];
  for (const tr of res.toolResults) {
    if (tr.code !== undefined && PERMISSION_BLOCKED_CODES.has(tr.code)) {
      events.push({
        at,
        kind: "permission_blocked",
        detail: `${tr.code} ${tr.name}${tr.reason ? `: ${tr.reason}` : ""}`,
      });
    }
  }
  events.push({
    at,
    kind: "step",
    detail: `dsh exit=${res.exitCode} final=${res.finalReasonKind ?? "none"}${res.finalReasonRaw && res.finalReasonRaw !== res.finalReasonKind ? `(${res.finalReasonRaw})` : ""} session=${res.sessionId ?? "-"}`,
  });
  events.push({
    at,
    kind: dshRunOk(res) ? "done" : "error",
    detail: dshRunOk(res)
      ? "dsh run complete"
      : res.runnerError ?? `exit ${res.exitCode} final=${res.finalReasonKind ?? "none"}`,
  });
  return events;
}

export type RunOptions = { sessionId?: string | null };

export type DriverResult = { ok: boolean; summary: string; dsh?: DshRunResult };

export interface Driver {
  readonly name: string;
  /** 在 bot 工作区内执行一次 brief；返回结果摘要。禁止触碰工作区以外路径。 */
  run(botName: string, workspace: string, brief: string, events: BotEvent[], opts?: RunOptions): Promise<DriverResult>;
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
  permissionMode?: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs?: number;
} = {}): Driver {
  const dshBin = opts.dshBin ?? process.env.DSH_BIN ?? "dsh";
  const patchPath = opts.patchPath ?? process.env.DSH_PATCH ?? "/app/docker/dsh-glm-patch.yml";
  const approvalPolicy = opts.approvalPolicy ?? (process.env.DSH_APPROVAL_POLICY as "ask" | "never") ?? "never";
  const permissionMode = opts.permissionMode; // 不传时交给 dsh 自身的 env 推导（A5）
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DSH_TIMEOUT_MS ?? 10 * 60_000);
  return {
    name: "dsh",
    async run(botName, workspace, brief, events, runOpts) {
      const { spawn } = await import("node:child_process");
      const sessionId = runOpts?.sessionId ?? null;
      const args = buildDshArgs({ patchPath, approvalPolicy, sessionId, permissionMode });
      events.push({
        at: new Date().toISOString(),
        kind: "brief_received",
        detail: `${dshBin} headless --json · patch=${patchPath} · approval=${approvalPolicy} · session=${sessionId ?? "new"} · cwd=${workspace}`,
      });
      let timedOut = false;
      let stderrTail = "";
      const res = await new Promise<DshRunResult>((resolve) => {
        const child = spawn(dshBin, args, { cwd: workspace, stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout.on("data", (c: Buffer) => (out += c));
        child.stderr.on("data", (c: Buffer) => (err += c));
        child.on("error", (e) => {
          // 进程都没起来：无事件流可解析
          clearTimeout(timer);
          resolve({ sessionId: null, finalReasonKind: null, text: "", toolResults: [], exitCode: -1, runnerError: `spawn error: ${e.message}` });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          stderrTail = err;
          const parsed = parseDshJsonStream(out, code ?? -1);
          if (timedOut) parsed.runnerError = [parsed.runnerError, `[dsh-bot] timeout after ${timeoutMs}ms`].filter(Boolean).join("; ");
          resolve(parsed);
        });
        child.stdin.write(brief);
        child.stdin.end();
      });
      events.push(...dshResultEvents(res, new Date().toISOString()));
      const ok = dshRunOk(res);
      const summary = ok
        ? res.text.trim().slice(0, 2000) || "(empty)"
        : [
            res.runnerError ? `runner: ${res.runnerError}` : `exit ${res.exitCode} final=${res.finalReasonKind ?? "none"}`,
            res.text.trim().slice(0, 500),
            stderrTail.trim() ? `[dsh stderr] ${stderrTail.slice(-2000)}` : "",
          ]
            .filter(Boolean)
            .join("\n");
      return { ok, summary, dsh: res };
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
