/**
 * Read + assemble skills from the `agent-skills/` directory on disk. Node-only
 * (uses fs/crypto). Shared by the build-time bundler (which serializes the
 * result into the deployed registry) and the TUI's disk skill source.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Skill } from "./types";

/** Priority order for skill listing (unlisted skills follow, alphabetically). */
const SKILL_ORDER = [
  "mall-domain-analysis",
  "postgres-analysis",
  "business-answer-style",
  "chart-selection",
];

type Frontmatter = { name?: string; description?: string; body: string };

function parseFrontmatter(md: string): Frontmatter {
  // Normalize CRLF first: the frontmatter and per-line kv regexes assume LF,
  // and a Windows checkout would otherwise silently lose name/description.
  const normalized = md.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { body: normalized.trim() };
  const [, yaml, body] = match;
  const fm: Frontmatter = { body: body.trim() };
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    const clean = value.trim().replace(/^["']|["']$/g, "");
    if (key === "name") fm.name = clean;
    if (key === "description") fm.description = clean;
  }
  return fm;
}

function assembleContent(body: string, references: Array<{ file: string; text: string }>): string {
  if (references.length === 0) return body;
  const parts = [body, ""];
  for (const ref of references) {
    parts.push(`---`, `## Reference: ${ref.file}`, "", ref.text.trim(), "");
  }
  return parts.join("\n").trim();
}

export type ReadSkillsResult = {
  version: string;
  skills: Skill[];
};

export function readSkillsFromDisk(root = "agent-skills"): ReadSkillsResult {
  if (!existsSync(root)) {
    return { version: "mall-v1.empty", skills: [] };
  }

  const hash = createHash("sha256");
  const entries = readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort();

  const skills: Skill[] = [];
  for (const dir of entries) {
    const skillPath = join(root, dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const raw = readFileSync(skillPath, "utf8");
    hash.update(`${dir}/SKILL.md\n${raw}\n`);
    const fm = parseFrontmatter(raw);

    const refsDir = join(root, dir, "references");
    const references: Array<{ file: string; text: string }> = [];
    if (existsSync(refsDir) && statSync(refsDir).isDirectory()) {
      for (const refFile of readdirSync(refsDir).sort()) {
        const refPath = join(refsDir, refFile);
        if (!statSync(refPath).isFile()) continue;
        const text = readFileSync(refPath, "utf8");
        hash.update(`${dir}/references/${refFile}\n${text}\n`);
        references.push({ file: refFile, text });
      }
    }

    skills.push({
      name: fm.name ?? dir,
      description: fm.description ?? "",
      directory: join(root, dir),
      content: assembleContent(fm.body, references),
    });
  }

  skills.sort((a, b) => {
    const ai = SKILL_ORDER.indexOf(a.name);
    const bi = SKILL_ORDER.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  const version = `mall-v1.${hash.digest("hex").slice(0, 8)}`;
  return { version, skills };
}
