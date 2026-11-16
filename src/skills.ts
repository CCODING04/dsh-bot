// bot 技能 = 每 bot 工作区 .dsh/skills/<name>/SKILL.md 纯数据文件（U3-3，规格 K1/K3）。
// dsh 三件套（registry/filesystem/tool）在 headless profile 已内置：每次启动自动重新发现，
// 增删改即文件操作，无需安装（K2/K4/K5）。不走 plugin 通道——那是容器级全局，无法按 bot 隔离（K8）。
// 本模块只做纯函数：frontmatter 解析/序列化/校验。路径与 HTTP 装配在 daemon.ts。

import path from "node:path";

/** K3：frontmatter.name 合法形状（kebab-case）；同时是 :skill 路径段的合法形状（顺带拒绝 ../ 穿越）。 */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillMeta = { name: string; description: string };
export type SkillFile = SkillMeta & { body: string };

/** dsh 发现根 rank 100 = <projectRoot>/.dsh/skills（K2）；workspace 即 projectRoot（create 时 git init 钉住）。 */
export function skillsRoot(workspace: string): string {
  return path.join(workspace, ".dsh", "skills");
}

export function skillDir(workspace: string, name: string): string {
  return path.join(skillsRoot(workspace), name);
}

/** 解析 SKILL.md 文本；frontmatter 缺失/name 非 kebab-case/description 为空即抛错（K3）。 */
export function parseSkillFile(text: string): SkillFile {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!m) throw new Error("invalid SKILL.md: no --- frontmatter block");
  const fm = new Map<string, string>();
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const name = fm.get("name") ?? "";
  const description = fm.get("description") ?? "";
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`invalid SKILL.md: name "${name}" must be kebab-case ${SKILL_NAME_RE.source} (K3)`);
  }
  if (!description) throw new Error("invalid SKILL.md: description required (K3)");
  return { name, description, body: m[2].replace(/^\r?\n/, "") };
}

/** 序列化为 dsh 可发现的形态；parse(serialize(x)) 与 x 深相等（frontmatter 与正文间恰一空行）。 */
export function serializeSkillFile(skill: SkillFile): string {
  const body = skill.body === "" || skill.body.endsWith("\n") ? skill.body : `${skill.body}\n`;
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${body}`;
}
