import { toBeScreens, type Check, type Layout } from "./parse.ts"

// The layout check of a Rein run: rein:layout-verifier compares
// pictures of a screen, the way Claude Design's verifier does, and answers
// 맞음 or 다름 per screen. In spec it compares each to-be of 1-mockup.html
// with the planning document's picture it is drawn from, and a 다름 sends the
// sketcher back to draw again.

export const LAYOUT_VERIFIER = "rein:layout-verifier"
export const SPEC_VERDICT = "agent/layout-verify.md"
// where the hook renders the mockup's to-be screens, relative to the run.
export const MOCKUP_SHOTS = "agent/layout/mockup"
// the drawings in a row that differ before the sketcher gets the
// measurement of its last to-be, and, in spec, before the hook stops drawing
// even while the drawings still get closer: a cap never shown before it is
// reached (a drawing that got no closer stops it sooner).
export const MEASURE_AT = 3
export const GIVE_UP_AT = 5

// the planning-document picture each to-be screen is drawn from: the
// sketcher's `<!-- to-be source: brief/<file> (<page>) -->` inside the
// screen's section. Only to-be screens; one without the comment has none.
export function toBeSources(html: string): Record<string, string> {
  const screens = new Set(toBeScreens(html))
  const out: Record<string, string> = {}
  for (const part of html.split(/<section\b/i).slice(1)) {
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(part.slice(0, part.indexOf(">")))?.[1]
    if (id === undefined || !screens.has(id)) continue
    const close = part.search(/<\/section>/i)
    const source = /<!--\s*to-be source:\s*([\s\S]*?)\s*-->/i.exec(close < 0 ? part : part.slice(0, close))?.[1]
    if (source) out[id] = source.replace(/\s+/g, " ")
  }
  return out
}

// stuck: under 다름, the verifier's `진전: 없음`, every difference it names
// was named last time too.
export type ScreenVerdict = { id: string; match: boolean; diffs: string[]; stuck?: true }

// the verifier's file: one `## #<id>` section per screen asked, each with
// `판정: 맞음` or `판정: 다름`, and under 다름 one `- ` line per difference and,
// when it was given the differences of the last drawing, `진전: 있음` or `진전: 없음`.
export function parseLayoutVerdict(text: string, ids: string[]): { verdicts: ScreenVerdict[] } | { problem: string } {
  const sections = new Map<string, string>()
  for (const part of text.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf("\n")
    const head = (nl < 0 ? part : part.slice(0, nl)).trim().replace(/^`?#?/, "").replace(/`$/, "")
    sections.set(head, nl < 0 ? "" : part.slice(nl + 1))
  }
  const missing = ids.filter(id => !sections.has(id))
  if (missing.length > 0) return { problem: `it has no \`## #<id>\` section for ${missing.map(m => `#${m}`).join(", ")}` }
  const verdicts: ScreenVerdict[] = []
  for (const id of ids) {
    const body = sections.get(id)!
    const said = [...body.matchAll(/^판정:\s*(\S+)\s*$/gm)].map(m => m[1])
    if (said.length !== 1 || (said[0] !== "맞음" && said[0] !== "다름")) return { problem: `#${id} needs exactly one line \`판정: 맞음\` or \`판정: 다름\`` }
    const diffs = body.split(/\r?\n/).filter(l => /^\s*[-*]\s+\S/.test(l)).map(l => l.trim().replace(/^[-*]\s+/, ""))
    if (said[0] === "다름" && diffs.length === 0) return { problem: `#${id} is 다름 with no \`- \` line saying what differs` }
    const stuck = said[0] === "다름" && /^진전:\s*없음\s*$/m.test(body)
    verdicts.push({ id, match: said[0] === "맞음", diffs: said[0] === "맞음" ? [] : diffs, ...(stuck ? { stuck } : {}) })
  }
  return { verdicts }
}

const FORM = (file: string, ids: string[], progress = false) => [
  `Write ${file} with Write, one section per screen, in this form, and nothing else:`,
  "",
  "```",
  ...ids.flatMap(id => [`## #${id}`, "판정: 맞음 | 다름", "- <under 다름, one line per difference: where, what the picture shows, what the mockup shows>", ...(progress ? ["진전: 있음 | 없음 <under 다름 only>"] : []), ""]),
  "```",
  "",
  "Then answer with the verdict of each screen in one line, and stop.",
]

// rein:layout-verifier's task in spec: the to-be of each screen, rendered,
// against the planning document's picture it is drawn from. The mockup's
// other to-be screens (the menu tabs above a tab's body, a popup) may draw
// part of the same picture, so they come along. Paths of the pictures and
// sources are relative to the run folder.
// last: the differences the verifier named in the drawing before, by screen,
// when this one is drawn again to fix them.
export function specVerifierTask(dir: string, shots: Record<string, string>, sources: Record<string, string>, others: Record<string, string> = {}, last?: Record<string, string[]>): string {
  const ids = Object.keys(shots)
  const rest = Object.keys(others)
  return [
    `Compare pictures of screens for a Rein run whose folder is ${dir}. You did not see the conversation, and you do not fix anything.`,
    "",
    "For each screen: the first picture is the target screen as the mockup draws it, rendered; the second is the screen as the planning document draws it. Open both with Read; the document's page is the one named in parentheses (for a PDF, Read it with that page in `pages`).",
    ...ids.map(id => `- #${id}: mockup ${dir}/${shots[id]}; document ${dir}/${sources[id]}`),
    "",
    ...(ids.length + rest.length > 1
      ? [
          `The mockup may split one page of the document into several screens, such as the menu tabs and title above in one and a tab's body in another. All its to-be screens: ${[...ids.map(i => `#${i} ${dir}/${shots[i]}`), ...rest.map(i => `#${i} ${dir}/${others[i]}`)].join(", ")}. Open them too. A region of the picture that another of them draws as a screen of its own (a popup, a tab's body) is not missing from the screen you judge: compare each screen only with the part of the picture it covers. That holds only for a region another screen really draws; a region left as words instead of drawn (such as \`(생략, 변경 없음)\`) is missing.`,
          "",
        ]
      : []),
    "Judge the layout only: the regions of the screen and their order, the number and order of the columns of each table, the order of the fields of a form or a search bar, and the place and size of each chart, panel, tab and button relative to the others. A difference in colors, fonts, borders, exact pixel sizes or the sample data is not one: the mockup takes the look of the service's existing screens on purpose.",
    `The user changed or dropped some of the document's requirements: read the \`## 기획서 대조\` section of ${dir}/1-spec.md, and nothing else of it. Where the mockup follows a line marked 변경 or 제외 there and the document does not, that is not a difference.`,
    ...(last
      ? [
          "",
          "This drawing was made to fix the differences found in the one before:",
          ...Object.entries(last).flatMap(([id, diffs]) => diffs.map(d => `- #${id}: ${d}`)),
          "For each screen that still differs, add `진전: 없음` when every difference you name is one of those, still there; otherwise `진전: 있음`.",
        ]
      : []),
    "",
    ...FORM(`${dir}/${SPEC_VERDICT}`, ids, last !== undefined),
  ].join("\n")
}

// what the sketcher is told when its last to-be came out different.
export function redrawLines(dir: string, fails: number, boxes: string[]): string[] {
  const lines = [
    "",
    `Your last to-be differs from the planning document's picture: ${dir}/${SPEC_VERDICT} says where, screen by screen. Look at the picture again and fix every difference it names; keep what it does not name.`,
  ]
  if (fails < MEASURE_AT) return lines
  return [
    ...lines,
    `It came out different ${fails} times in a row. Before you draw, read the measurement of your last to-be (each element, its position and size in pixels): ${boxes.map(b => `${dir}/${b}`).join(", ")}. Compare it with the picture, write the cause in one sentence as \`<!-- 원인: ... -->\` at the top of that to-be, then fix that cause at once.`,
  ]
}

// In integration qa, on the ego path, each to-be screen of `## 배치 대조`
// is an ego check of its own, `배치-<id>`: a rein:ego-driver opens the screen
// as built and screenshots it, and rein:layout-verifier, as its judge,
// compares it with the to-be. 맞음 checks the screen's box in 5-checklist.md;
// when only such checks failed, the run goes back to dev on its own.
export const LAYOUT_PREFIX = "배치-"
export const isLayoutCheck = (name: string) => name.startsWith(LAYOUT_PREFIX)
export const layoutIdOf = (name: string) => name.slice(LAYOUT_PREFIX.length)
export const LAYOUT_FAILS = "agent/layout-fails.md"

// the ego check of screen l, in app `app`; from the MEASURE_AT-th try on,
// its driver also measures the regions to compare.
export function layoutCheck(l: Layout, app: string, measure: boolean): Check {
  return {
    name: `${LAYOUT_PREFIX}${l.anchor}`,
    app,
    page: l.page,
    route: l.route,
    todo: `${l.page} 화면을 연다 (경로: ${l.route}). 데이터가 다 그려질 때까지 기다린 뒤, 화면 전체를 스크린샷으로 찍는다 (fullPage).`,
    expect: `배치가 1-mockup.html#${l.anchor}의 to-be와 같다: ${l.look}`,
    saves: false,
    ...(measure ? { evidence: [{ kind: "측정" as const, text: `${l.look}의 영역마다 위치와 크기 (getBoundingClientRect)` }] } : {}),
  }
}

// rein:layout-verifier's task as the judge of a layout check: the screen as
// built (the driver's screenshots) against the to-be of 1-mockup.html,
// rendered, in judge.md's form. The verifier has only Read and Write, so it
// cannot list the folder: the hook names each screenshot.
export function builtVerifierTask(id: string, look: string, mockup: string | undefined, html: string, shots: string[], file: string): string {
  return [
    `Compare a screen as built with its target, for a Rein run's integration qa. You did not see the conversation, and you do not fix anything.`,
    "",
    `The target: the to-be of screen #${id} in ${html}${mockup ? `, rendered as ${mockup}` : " (it could not be rendered: read the section with that id, the part with class `after`)"}. Where to look: ${look}.`,
    `The screen as built: the screenshots a driver saved, each to open with Read: ${shots.join(", ") || "(none)"}. The log of round NN is round-NN.log in the same folder and says what the driver did.`,
    "",
    "Judge the layout and the design: the regions and their order, the columns of each table and their order, the order of the fields, the place and size of each chart, panel, tab and button relative to the others, and their look (colors, borders, font sizes, spacing). The data differs (the mockup's is a sample): that is not a difference. The mockup's notes are hidden from the rendering and are not part of the screen.",
    "",
    `Write ${file} with Write, once, whole, in exactly this form:`,
    "",
    "```",
    "## 기대 대조",
    "",
    `- 배치 #${id}: 통과 — <the screenshot files that show it, by name>`,
    "",
    "판정: 통과",
    "```",
    "",
    `When it differs: \`- 배치 #${id}: 실패 — <each difference: where, what the to-be shows, what the screen shows; separated by ; >\` and \`판정: 실패\`. When no screenshot shows the whole screen: \`- 배치 #${id}: 증거 부족 — <what is missing>\` and \`판정: 증거 부족\`.`,
    "Then answer with the hook's answer, word for word, and stop.",
  ].join("\n")
}

// 5-checklist.md with screen id's box checked, why at the end of its line;
// as it was when the box is not there or already checked.
export function tickLayout(text: string, id: string, why: string): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(`^(\\s*[-*+]\\s+)\\[ \\](\\s+\\*\\*배치 ${esc}\\*\\*.*?)(\\r?)$`, "m"), `$1[x]$2 (${why})$3`)
}

// what the worker reads when only layout checks failed: per screen, the
// target, the screen as built and what differs; from the MEASURE_AT-th
// difference in a row, the measurements and the cause to write.
export function layoutFailsText(dir: string, fails: { id: string; mockup?: string; shots: string[]; diffs: string; count: number; measured: string[] }[]): string {
  return [
    "# 배치 대조 실패",
    "",
    "통합 qa의 배치 확인에서 구현된 화면이 1-mockup.html의 to-be와 달랐습니다. 화면마다 to-be와 구현 화면을 Read로 열어 보고, 다른 곳을 고치세요.",
    "",
    ...fails.flatMap(f => [
      `## #${f.id}`,
      "",
      `- to-be: ${dir}/1-mockup.html#${f.id}${f.mockup ? ` (렌더링: ${dir}/${f.mockup})` : ""}`,
      `- 구현 화면: ${f.shots.map(s => `${dir}/${s}`).join(", ") || "(스크린샷 없음)"}`,
      `- 다른 곳: ${f.diffs}`,
      `- 연속으로 다른 횟수: ${f.count}`,
      ...(f.count >= MEASURE_AT
        ? [`- ${f.count}번 연속 달랐습니다. 고치기 전에 to-be의 요소 측정(${dir}/${MOCKUP_SHOTS}/${f.id}.boxes.txt)${f.measured.length > 0 ? `과 구현 화면의 측정(${f.measured.map(m => `${dir}/${m}`).join(", ")})` : ""}을 비교하고, 원인을 한 문장으로 dev-items.md의 그 파일 항목에 적은 뒤 그 원인을 한 번에 고치세요.`]
        : []),
      "",
    ]),
  ].join("\n")
}
