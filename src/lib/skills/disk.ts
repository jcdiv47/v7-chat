/**
 * Disk-backed skill source for the TUI / evals. Reads `agent-skills/` at runtime
 * so local skill edits take effect without re-bundling. The web runtime uses the
 * bundled registry instead (src/lib/skills/loader.ts).
 */
import { readSkillsFromDisk } from "./fs-source";
import type { Skill, SkillSource } from "./types";

export function createDiskSkillSource(root = "agent-skills"): SkillSource {
  const { version, skills } = readSkillsFromDisk(root);
  const byName = new Map<string, Skill>(skills.map((s) => [s.name, s]));
  return {
    version,
    list: () => skills.map(({ name, description, directory }) => ({ name, description, directory })),
    load: (name) => byName.get(name),
  };
}
