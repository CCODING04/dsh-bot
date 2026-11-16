// 三职责角色技能模板（U4「技能即角色」，u4-group-design §1）：coordinator / engineer / reviewer。
// 纯读取模块：skillTemplates/<name>/SKILL.md 与 PUT /bots/:n/skills 的写入契约同构（parseSkillFile），
// 读取结果可直接作为 putSkill 输入安装到 bot 工作区（安装即既有技能写入能力，本模块不做装配）。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSkillFile, type SkillFile } from "./skills.ts";

export type RoleTemplate = SkillFile;

export function skillTemplatesRoot(): string {
  return path.join(import.meta.dirname, "..", "skillTemplates");
}

/** 列出全部角色模板（按名字排序）。模板随仓库/镜像分发，文件缺失或非法即抛错显式失败，不静默跳过。 */
export async function listRoleTemplates(): Promise<RoleTemplate[]> {
  const entries = await readdir(skillTemplatesRoot(), { withFileTypes: true });
  const out: RoleTemplate[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    out.push(parseSkillFile(await readFile(path.join(skillTemplatesRoot(), e.name, "SKILL.md"), "utf8")));
  }
  if (out.length === 0) throw new Error(`no role templates found in ${skillTemplatesRoot()}`);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRoleTemplate(name: string): Promise<RoleTemplate | undefined> {
  return (await listRoleTemplates()).find((t) => t.name === name);
}
