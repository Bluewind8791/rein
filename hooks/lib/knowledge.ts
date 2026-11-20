import { frontMatter, unquote } from "./rules.ts"

// one domain knowledge file, or a folder of them (path ending in /): where it is and its `description:` line.
export type Knowledge = { path: string; description: string | null }

// The `description:` of a knowledge file's front matter; null without one.
export function knowledgeDescription(text: string): string | null {
  const line = frontMatter(text)?.find(l => /^description[ \t]*:/.test(l))
  return (line && unquote(line.replace(/^description[ \t]*:/, ""))) || null
}

// what each agent that gets the index may use it for. The reviewer
// and the grader get none: they judge by rules and design.
export const PLAN_USE = "Use it for the design, and give this list to rein:test-planner with its task."
export const WORKER_USE = "Use it for how to write what the design asks for; it never widens the design."
export const ARBITER_USE = "Use it to weigh a claim about what the domain (a framework, a library) allows."
export const AS_IS_USE = "Look in it first for the screen's files and for how to read its current layout."
export const STATUS_USE = "The main session, rein:as-is, rein:worker, rein:arbiter and rein:test-planner use it."

// where status keeps the index, in the run directory: status names the
// file instead of repeating the index on every call.
export const KNOWLEDGE_FILE = "agent/knowledge.md"

// status's line for the index it wrote to path.
export const knowledgePointer = (items: Knowledge[], path: string) =>
  `Domain knowledge (D211): ${items.length} files and folders, each with its description, listed in ${path}. ${STATUS_USE} Read it when your work needs it.`

// the knowledge index for an agent's instructions, led by what the
// agent may use it for; undefined when there is no knowledge.
export function knowledgeIndex(items: Knowledge[], use: string): string | undefined {
  if (items.length === 0) return undefined
  const folders = items.some(k => k.path.endsWith("/"))
    ? " A path ending in / is a folder (D212): find what you need in it with Glob and Grep, starting from its SCHEMA.md."
    : ""
  return [
    `Domain knowledge (D211): reference, not rules. ${use} Read a file with Read only when it bears on your work.${folders}`,
    ...items.map(k => (k.description ? `- ${k.path}: ${k.description}` : `- ${k.path}`)),
  ].join("\n")
}
