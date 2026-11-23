// Screen documents: one file per screen of `## 화면`, the requirements
// landed so far, one table row per requirement keyed by the element's
// data-id. They live in ~/.rein/<project>/requirements/<domain>/<id>.md (a
// project with no domain keeps them in requirements/<id>.md, on this PC
// only) and sync with the hub's catalog as knowledge/ does. Spec reads them;
// land writes the updated copy into the run's agent/requirements/, in the
// same layout, and the hook copies it out once the run closes.

export const REQ_DIR = "agent/requirements"

// a screen document found for a screen id: its path relative to
// requirements/ (`<domain>/<id>.md` or `<id>.md`), and the absolute one.
export type ScreenDoc = { id: string; rel: string; path: string }

// the table body of a screen document, one trimmed line per row, its
// header and separator left out.
export function docRows(text: string): string[] {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith("|"))
  return rows.filter(r => !r.replace(/^\||\|$/g, "").split("|").every(c => /^\s*:?-+:?\s*$/.test(c))).slice(1)
}

// the rows the updated copy adds and the rows it drops, against the
// document as it stands (none: a new document). A changed row is both.
export function rowChanges(before: string | undefined, after: string): { added: string[]; removed: string[] } {
  const was = before === undefined ? [] : docRows(before)
  const now = docRows(after)
  return { added: now.filter(r => !was.includes(r)), removed: was.filter(r => !now.includes(r)) }
}

// the approval's lines for the screen documents land updates: each copy
// with the rows it adds (+) and drops (-), in Korean as the approval is.
export function docChangeLines(docs: { rel: string; before: string | undefined; after: string }[], home: string): string | undefined {
  if (docs.length === 0) return undefined
  const parts = docs.map(d => {
    const { added, removed } = rowChanges(d.before, d.after)
    const head = d.before === undefined ? `  ${d.rel} (새 문서)` : `  ${d.rel} (바뀐 줄 ${added.length + removed.length})`
    return [head, ...removed.map(r => `    - ${r}`), ...added.map(r => `    + ${r}`)].join("\n")
  })
  return [`화면 문서 (run이 닫히면 ${home}/requirements/로 옮김):`, ...parts].join("\n")
}

// the main session's line in spec, once per screen whose document it
// has not been told of.
export function specNotice(docs: ScreenDoc[]): string {
  return `Screen documents from earlier runs, the requirements landed so far for screens of \`## 화면\`: ${docs.map(d => d.path).join(", ")}. Read each now. Each row is a decision already made: 요소 is the element's data-id, 상태 구현됨, 보류 or 폐기. In \`## 요구사항\` write only the lines this run adds, changes or drops, and reuse a document's element keys. When the request touches a row of them (changes a 구현됨 row, brings back a 보류 or 폐기 one), ask the user before you write it. rein:sketcher and rein:collator get these documents from the hook.`
}

// the sketcher's lines on the screen documents.
export function sketcherLines(docs: ScreenDoc[]): string[] {
  if (docs.length === 0) return []
  return [
    `The screen documents of earlier runs, the requirements landed so far: ${docs.map(d => d.path).join(", ")}. Read each. A row's 요소 is the data-id of its element. Where 1-spec.md says nothing of an element, keep it as its row says: draw a 구현됨 row as it is, never draw a 폐기 row, and draw a 보류 row only when a line of \`## 요구사항\` takes it up. A line of 1-spec.md wins over a row.`,
  ]
}

// the collator's lines on the screen documents, after the main session's prompt.
export function collatorLines(docs: ScreenDoc[]): string {
  return `The screen documents of earlier runs, the requirements landed so far for the screens of this spec: ${docs.map(d => d.path).join(", ")}. Read each. A requirement of the planning documents that a row holds as the document says is not missing. Report under \`지난 결정과 다름:\` each requirement of the planning documents that differs from a row of them, with the row.`
}
