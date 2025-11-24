const SKILL_SOURCE_GROUPS = [
  { id: "workspace", label: "Workspace Skills", sources: ["genosos-workspace"] },
  { id: "built-in", label: "Built-in Skills", sources: ["genosos-bundled"] },
  { id: "installed", label: "Installed Skills", sources: ["genosos-managed"] },
  { id: "extra", label: "Extra Skills", sources: ["genosos-extra"] },
];
export function groupSkills(skills) {
  const groups = new Map();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: def.label, skills: [] });
  }
  const builtInGroup = SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in");
  const other = { id: "other", label: "Other Skills", skills: [] };
  for (const skill of skills) {
    const match = skill.bundled
      ? builtInGroup
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter((group) =>
    Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}
