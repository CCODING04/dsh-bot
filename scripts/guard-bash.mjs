#!/usr/bin/env node
// guard-bash.mjs — 流程硬约束 L3 层（agent 行为）：ZCode PreToolUse(Bash) hook。
// stdin 读 hook 输入 JSON，提取 Bash command；只靠退出码表达判定（不输出 JSON，坑 8 规避）：
//   exit 0 = 放行；exit 2 = 阻断（原因到 stderr）；解析失败 = 放行（fail-open，防 schema 漂移锁死会话）。
const RULES = [
  {
    id: "docker-run-lifecycle",
    severity: "medium",
    name: "docker run 必须一次性或显式常驻",
    test: (cmd) => {
      if (!/\bdocker\s+run\b/.test(cmd)) return false;
      if (/\bdocker\s+compose\b/.test(cmd)) return false; // 具名服务走 compose
      const hasRm = /(--rm\b|--rm=)/.test(cmd);
      const hasDetached = /(-d\b|--detach\b)/.test(cmd);
      const hasName = /(--name\s+\S+)/.test(cmd); // 具名=有意常驻，可追踪
      return !hasRm && !hasDetached && !hasName;
    },
    why: "容器必须 --rm（一次性）、-d（常驻服务）或 --name（具名可追踪）之一；三者皆无 = 匿名泄漏容器（围栏 §3）",
  },
  {
    id: "npm-global",
    severity: "medium",
    name: "禁止全局 npm 安装",
    test: (cmd) => /\bnpm\s+(install|i)\s+(-g|--global)\b/.test(cmd),
    why: "npm -g 污染系统（围栏 §1 白名单外）；确需全局包先获用户明示批准",
  },
  {
    id: "docker-global-prune",
    severity: "medium",
    name: "禁止 docker 全局清理",
    test: (cmd) => /\bdocker\s+(system\s+prune|image\s+prune\s+-a|volume\s+prune)\b/.test(cmd),
    why: "全局 prune 可能删掉非本项目资源（围栏 §3：只删自己创建的）",
  },
  {
    id: "dsh-readonly-write",
    severity: "high",
    name: "禁止写入本机 dsh 环境",
    test: (cmd) => {
      // 剔除无害重定向（stderr 丢弃 / 合并）后再判写操作，避免只读命令误拦
      const cmd2 = cmd.replace(/\s*2>&1/g, " ").replace(/\s*(2>)?>\/dev\/null\b/g, " ");
      const writeOp = /(>{1,2}\s*)|(\bmv\b)|(\brm\b)|(\btee\b)|(\bcp\b)/;
      const dshTarget = new RegExp(
        "(D:\\\\+Dev\\\\+DSH|D:/Dev/DSH|~/\\.dsh|\\$HOME/\\.dsh|C:\\\\+Users\\\\+[^\\s]+\\\\+\\.dsh)",
        "i",
      );
      return writeOp.test(cmd2) && dshTarget.test(cmd);
    },
    why: "本机 D:\\Dev\\DSH 与 ~/.dsh 只读零写入（AGENTS.md 硬约束）",
  },
];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  let cmd = null;
  try {
    const input = JSON.parse(raw);
    // 多形态防御式提取：PreToolUse 输入的确切 schema 以实测为准
    cmd =
      input?.tool_input?.command ?? input?.toolInput?.command ?? input?.command ?? input?.input?.command ?? null;
  } catch {
    cmd = null; // 非 JSON 或字段缺失 → 放行（fail-open）
  }
  if (typeof cmd !== "string" || cmd.length === 0) process.exit(0);
  for (const r of RULES) {
    if (r.test(cmd)) {
      console.error(`[guard-bash] 阻断（${r.name}）：${r.why}\n  命令：${cmd.slice(0, 200)}`);
      try {
        const { recordSync } = await import("./gate-ledger.mjs");
        recordSync({
          kind: "interception",
          layer: "L3",
          rule: r.id,
          severity: r.severity,
          actor: "unknown",
          context: cmd.slice(0, 300),
          trigger: "PreToolUse",
        });
      } catch {
        // 台账失败不阻断拦截本身
      }
      process.exit(2);
    }
  }
  process.exit(0);
});
