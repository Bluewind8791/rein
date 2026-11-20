// 1-mockup.html in two parts: rein:as-is draws each screen as it is now in
// agent/asis.html, once; rein:sketcher draws the to-be in agent/tobe.html,
// again as the answers come in, with `<!-- rein:as-is <id> -->` where each
// screen's as-is goes. The hook joins the two into 1-mockup.html.
export const AS_IS = "rein:as-is"
export const ASIS_FILE = "agent/asis.html"
export const TOBE_FILE = "agent/tobe.html"

// the sections of an HTML page by id, each up to its `</section>`.
function sections(html: string): { id: string; body: string }[] {
  return html.split(/<section\b/i).slice(1).flatMap(part => {
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(part.slice(0, part.indexOf(">")))?.[1]
    const close = part.search(/<\/section>/i)
    return id === undefined ? [] : [{ id, body: close < 0 ? part : part.slice(0, close) }]
  })
}

const BEFORE = /<div\b[^>]*\bclass\s*=\s*"(?:[^"]*\s)?before(?:\s[^"]*)?"/i
const COMPARE = /\bclass\s*=\s*"(?:[^"]*\s)?compare(?:\s[^"]*)?"/i
const MARKER = /<!--\s*rein:as-is\s+(\S+?)\s*-->/gi

// each screen of agent/asis.html: its `.before` block, from the div to the
// end of its section, by id.
export function asIsBlocks(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of sections(html)) {
    const at = s.body.search(BEFORE)
    if (at >= 0) out[s.id] = s.body.slice(at).trim()
  }
  return out
}

const styles = (html: string) => html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []

// 1-mockup.html: the to-be with each marker replaced by the same id's
// `.before` of the as-is, and the as-is's `<style>` right before the
// to-be's last one. Or why not: a `.compare` with no marker, or a marker
// whose id the as-is does not draw.
export function joinMockup(tobe: string, asis: string): { html: string } | { problem: string } {
  const blocks = asIsBlocks(asis)
  const bare = sections(tobe).filter(s => COMPARE.test(s.body) && !new RegExp(MARKER.source, "i").test(s.body)).map(s => `#${s.id}`)
  const unknown = [...new Set([...tobe.matchAll(MARKER)].map(m => m[1]!).filter(id => blocks[id] === undefined))].map(id => `#${id}`)
  const why = [
    ...(bare.length > 0 ? [`the .compare of ${bare.join(", ")} has no \`<!-- rein:as-is <id> -->\` where the as-is goes`] : []),
    ...(unknown.length > 0 ? [`${ASIS_FILE} has no as-is of ${unknown.join(", ")}, which agent/tobe.html places`] : []),
  ]
  if (why.length > 0) return { problem: why.join("; ") }
  const joined = tobe.replace(MARKER, (_, id: string) => blocks[id]!)
  const css = styles(asis).join("\n")
  if (css === "") return { html: joined }
  const last = [...joined.matchAll(/<style\b/gi)].at(-1)?.index
  if (last !== undefined) return { html: `${joined.slice(0, last)}${css}\n${joined.slice(last)}` }
  const head = joined.search(/<\/head>/i)
  return { html: head >= 0 ? `${joined.slice(0, head)}${css}\n${joined.slice(head)}` : `${css}\n${joined}` }
}
