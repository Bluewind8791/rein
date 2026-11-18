import { sha256Text } from "./hash.ts"

// A run's trace is trace.jsonl, then trace-2.jsonl, trace-3.jsonl, … in its
// folder's agent/: the engine refuses a file over 4 MiB, so a line that would take the
// newest file past TRACE_LIMIT starts the next one.
export const TRACE_LIMIT = 3 * 1024 * 1024

export const traceFile = (n: number) => (n === 1 ? "agent/trace.jsonl" : `agent/trace-${n}.jsonl`)

export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length

// the fields of a tool's input that carry file contents, kept in the trace
// as their length and SHA-256 only: the file itself holds the text.
const CONTENT: Record<string, string[]> = {
  Write: ["content"],
  Edit: ["old_string", "new_string"],
  NotebookEdit: ["new_source"],
}

const digest = async (text: string) => ({ length: text.length, sha256: await sha256Text(text) })

export async function traceInput(tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fields = CONTENT[tool]
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const edits = await Promise.all(input.edits.map(async (e: unknown) => (e !== null && typeof e === "object" ? traceInput("Edit", e as Record<string, unknown>) : e)))
    return { ...input, edits }
  }
  if (!fields) return input
  const out = { ...input }
  for (const f of fields) if (typeof out[f] === "string") out[f] = await digest(out[f] as string)
  return out
}
