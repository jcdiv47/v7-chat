/** Skill metadata + content types (runtime-agnostic). */

export type SkillMeta = {
  name: string;
  description: string;
  /** Project-relative directory, e.g. "agent-skills/mall-domain-analysis". */
  directory: string;
};

export type Skill = SkillMeta & {
  /** Full assembled instructions: SKILL.md body + any references/ files. */
  content: string;
};

export interface SkillSource {
  /** Content-derived version string, e.g. "mall-v1.a1b2c3d4". */
  version: string;
  list(): SkillMeta[];
  load(name: string): Skill | undefined;
}
