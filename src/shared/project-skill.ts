export interface ProjectSkillRef {
  root: string;
}

export function matchesSkill(skillPath: string, root: string): boolean {
  const picked = normalize(skillPath);
  const folder = normalize(root);
  if (!picked || !folder) return false;
  return picked === folder || picked === `${folder}/SKILL.md`;
}

export function skillPathForWorkspace(currentSkill: string, previousWorkspace: string, skills: ProjectSkillRef[]): string {
  const matched = skills.find((skill) => matchesSkill(currentSkill, skill.root));
  if (matched) return matched.root;
  const belonged = !currentSkill.trim() || isInside(currentSkill, previousWorkspace);
  if (belonged && skills.length === 1) return skills[0]?.root ?? "";
  if (belonged) return "";
  return currentSkill;
}

function isInside(child: string, parent: string): boolean {
  const file = normalize(child);
  const folder = normalize(parent);
  if (!file || !folder) return false;
  return file === folder || file.startsWith(`${folder}/`);
}

function normalize(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}
