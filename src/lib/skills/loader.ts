/**
 * V8-safe skill source over the build-time-generated registry. Used by the
 * Convex web runtime, which cannot read the filesystem. The registry module is
 * produced by `scripts/bundle-skills.ts` (run via predev / prebuild / preconvex)
 * and inlines every SKILL.md + references file.
 */
import { SKILLS_VERSION, SKILL_REGISTRY } from "./registry.generated";
import type { Skill, SkillMeta, SkillSource } from "./types";

export const bundledSkillSource: SkillSource = {
  version: SKILLS_VERSION,
  list(): SkillMeta[] {
    return Object.values(SKILL_REGISTRY).map(({ name, description, directory }) => ({
      name,
      description,
      directory,
    }));
  },
  load(name: string): Skill | undefined {
    return SKILL_REGISTRY[name];
  },
};

/** Skills whose names + descriptions are injected into the agent instructions. */
export function defaultActiveSkillNames(): string[] {
  return bundledSkillSource.list().map((s) => s.name);
}
