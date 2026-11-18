// the images the user pasted into a run's main sessions, which spec keeps in
// the run folder's brief/ as paste-1.png, paste-2.png, … in paste order. They
// are only in the sessions' transcripts (<session>.jsonl), as base64 image
// blocks of the user's messages; the hook picks them out of the lines a
// transcript holds of the user (register.ts reads them).

// one pasted image: its media type and bytes as base64.
export type Pasted = { mediaType: string; data: string }

// what one transcript line is to the user's pastes: a prompt the person
// gave (a turn of theirs, not a tool's result), and the images it carries
// (a slash command's images ride the line its skill expands into, right
// after the prompt). undefined: a line of no user message.
function userLine(line: string): { t: number; prompt: boolean; images: Pasted[] } | undefined {
  let e: { type?: unknown; isSidechain?: unknown; isMeta?: unknown; timestamp?: unknown; message?: { content?: unknown } }
  try {
    e = JSON.parse(line) as typeof e
  } catch {
    return undefined
  }
  if (e === null || typeof e !== "object" || e.type !== "user" || e.isSidechain === true || typeof e.timestamp !== "string") return undefined
  const t = Date.parse(e.timestamp)
  const content = e.message?.content
  if (Number.isNaN(t) || (typeof content !== "string" && !Array.isArray(content))) return undefined
  const blocks = (Array.isArray(content) ? content : []) as { type?: unknown; source?: { type?: unknown; media_type?: unknown; data?: unknown } }[]
  if (blocks.some(b => b?.type === "tool_result")) return undefined
  const images = blocks.flatMap(b =>
    b?.type === "image" && b.source?.type === "base64" && typeof b.source.media_type === "string" && typeof b.source.data === "string" ? [{ mediaType: b.source.media_type, data: b.source.data }] : [],
  )
  return { t, prompt: e.isMeta !== true, images }
}

// the images pasted into the sessions that held the run, in paste order:
// each transcript's lines from the prompt that was current when its session
// took the run (`since`, ms epoch; the prompt that opened it, with its
// images, included) on.
export function pastedImages(transcripts: { lines: string[]; since: number }[]): Pasted[] {
  const found: { t: number; image: Pasted }[] = []
  for (const { lines, since } of transcripts) {
    const entries = lines.flatMap(l => userLine(l) ?? [])
    let start = entries.findLastIndex(e => e.prompt && e.t <= since)
    if (start < 0) start = entries.findIndex(e => e.t >= since)
    if (start < 0) continue
    for (const e of entries.slice(start)) found.push(...e.images.map(image => ({ t: e.t, image })))
  }
  return found.sort((a, b) => a.t - b.t).map(f => f.image)
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" }

// the n-th pasted image's name in brief/, its extension by its type.
export function pasteName(n: number, mediaType: string): string {
  const ext = EXTENSIONS[mediaType.toLowerCase()] ?? (/^image\/([a-z0-9]+)$/i.exec(mediaType)?.[1]?.toLowerCase() ?? "png")
  return `paste-${n}.${ext}`
}
