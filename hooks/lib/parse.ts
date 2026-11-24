import { resolve, same } from "./paths.ts"

export type PlanParse = { ok: true; files: string[]; handoff: string[] } | { ok: false; rule: string; reason: string }

// 2-plan.md has `## 접근 방법` and `## 상세 설계`, the design has at
// least one `### <path>` item, every item carries `테스트:` or
// `테스트 면제:`, and every path a `테스트:` line names is an item too.
// Only the form is judged. Fenced code is skipped, so a
// sample inside it counts for nothing. Item paths resolve against root.
export function parsePlan(text: string, root: string): PlanParse {
  const lines = unfenced(text)
  const h2 = (title: string) => lines.findIndex(l => new RegExp(`^##\\s+${title}\\s*$`).test(l))
  if (h2("접근 방법") < 0) return { ok: false, rule: "D45", reason: "2-plan.md has no `## 접근 방법` section." }
  const start = h2("상세 설계")
  if (start < 0) return { ok: false, rule: "D45", reason: "2-plan.md has no `## 상세 설계` section." }
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  const design = lines.slice(start + 1, end < 0 ? undefined : end)

  const items: { heading: string; path: string | undefined; body: string[] }[] = []
  for (const line of design) {
    const head = /^###\s+(.*)$/.exec(line)
    if (head) items.push({ heading: head[1]!.trim(), path: itemPath(head[1]!), body: [] })
    else items.at(-1)?.body.push(line)
  }
  if (items.length === 0) {
    return { ok: false, rule: "D45", reason: "`## 상세 설계` has no `### <file path>` item." }
  }
  const unnamed = items.filter(item => item.path === undefined).map(item => `\`### ${item.heading}\``)
  if (unnamed.length > 0) {
    const reason = `these item headings are not one file path, optionally followed by \`— 새 파일\`: ${unnamed.join(", ")}. Put a path with spaces in backticks.`
    return { ok: false, rule: "D45", reason }
  }
  const untested = items.filter(item => !item.body.some(l => /^\s*(?:[-*]\s+)?테스트(?: 면제)?\s*:\s*\S/.test(l)))
  if (untested.length > 0) {
    const names = untested.map(item => item.path).join(", ")
    return { ok: false, rule: "D68", reason: `these items have neither \`테스트:\` nor \`테스트 면제:\`: ${names}.` }
  }
  const files: string[] = []
  for (const item of items) {
    const path = resolve(item.path!, root)
    if (!files.some(f => same(f, path))) files.push(path)
  }
  // dev writes every test a `테스트:` line names, an existing one too,
  // so each must be a file of the design, with an item of its own.
  const orphans: string[] = []
  for (const line of items.flatMap(item => item.body)) {
    const value = /^\s*(?:[-*]\s+)?테스트\s*:\s*(\S.*?)\s*$/.exec(line)?.[1]
    if (value === undefined) continue
    const named = itemPath(value) ?? value.replace(/`/g, "").split(/\s+/)[0]!
    if (!files.some(f => same(f, resolve(named, root))) && !orphans.includes(named)) orphans.push(named)
  }
  if (orphans.length > 0) {
    const reason = `these test files named on a \`테스트:\` line have no \`### <path>\` item of their own: ${orphans.join(", ")}. dev writes them, so list each as an item (an existing test file too; a new one with \`— 새 파일\`) whose line is \`테스트: <itself>\`.`
    return { ok: false, rule: "D68", reason }
  }
  const handoff = parseHandoff(lines)
  if ("reason" in handoff) return { ok: false, rule: "D163", reason: handoff.reason }
  return { ok: true, files, handoff: handoff.names }
}

// a handoff file is one plain file name in the run's handoff/ folder.
export const handoffName = (name: string) => /^[^\\/:*?"<>|\s.][^\\/:*?"<>|\r\n]*$/.test(name) && !/[. ]$/.test(name)

// the optional `## 넘길 것` section, what dev writes for the person to
// apply outside the repositories (a DB script, say): `### <file name>`
// items, each with a line saying what the person does with it.
function parseHandoff(lines: string[]): { names: string[] } | { reason: string } {
  const start = lines.findIndex(l => /^##\s+넘길 것\s*$/.test(l))
  if (start < 0) return { names: [] }
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  const items: { heading: string; name: string | undefined; said: boolean }[] = []
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const head = /^###\s+(.*)$/.exec(line)
    if (head) {
      const name = /^\s*(?:`([^`]+)`|(\S+))\s*$/.exec(head[1]!)
      const named = (name?.[1] ?? name?.[2])?.trim()
      items.push({ heading: head[1]!.trim(), name: named !== undefined && handoffName(named) ? named : undefined, said: false })
    } else if (line.trim() !== "" && items.length > 0) items.at(-1)!.said = true
  }
  if (items.length === 0) return { reason: "`## 넘길 것` has no `### <file name>` item; drop the section or add one." }
  const bad = items.filter(i => i.name === undefined).map(i => `\`### ${i.heading}\``)
  if (bad.length > 0) return { reason: `these \`## 넘길 것\` headings are not one plain file name (no folder, none of / \\ : * ? " < > |, not starting with a dot or space): ${bad.join(", ")}.` }
  const silent = items.filter(i => !i.said).map(i => i.name)
  if (silent.length > 0) return { reason: `these \`## 넘길 것\` items do not say what the person does with the file: ${silent.join(", ")}.` }
  const names: string[] = []
  for (const i of items) if (!names.some(n => n.toLowerCase() === i.name!.toLowerCase())) names.push(i.name!)
  return { names }
}

export type Impacts = { items: { path: string; rest: string }[]; none: boolean }

// the `## 영향 범위` section of 1-spec.md or 2-plan.md. Each bullet is
// `- <path> — <text>`, the path backticked or the first token, a `:line`
// suffix dropped; none when a line says 없음. undefined when the section is
// absent.
export function parseImpacts(text: string): Impacts | undefined {
  const lines = unfenced(text)
  const start = lines.findIndex(l => /^##\s+영향 범위\s*$/.test(l))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  const impacts: Impacts = { items: [], none: false }
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)?.[1]?.trim()
    if (bullet === undefined) {
      if (/^없음(?:\s|[.—–-]|$)/.test(line.trim())) impacts.none = true
      continue
    }
    const m = /^(?:`([^`]+)`|(\S+))(.*)$/.exec(bullet)
    const path = (m?.[1] ?? m?.[2] ?? "").trim().replace(/:(?:\d+(?:-\d+)?)?$/, "")
    if (path === "없음") impacts.none = true
    else if (path !== "") impacts.items.push({ path, rest: (m?.[3] ?? "").replace(/^\s*(?:[—–]+|-+|:)?\s*/, "").trim() })
  }
  return impacts
}

// one aside check of 2-plan.md's `## e2e 확인`, as it runs: its title and
// kind for the person (absent in a plan from before they were asked for),
// the app of config `e2e.apps` it opens, the page it looks at and the menus
// that reach it (absent in a plan from before they were asked for), what to
// do there and what must show (one item per line), why the data was chosen,
// when it says, whether it saves, its own time limit in minutes, when it
// sets one, the account it logs in as, when it names one (the app's
// login says how, a shared password, say), and the design and handoff files
// its screen runs on, when it names them: a pass of the check stands while
// none of them changes. evidence, the `- 증거:` lines: what a screenshot
// cannot show, each with its kind, for the ego driver (and aside's prompt).
// data, the `- 데이터 조건:` lines (one item per line): what the data of
// 할 일 must be for the check to show its 기대; the ego driver checks it
// and finds or makes other data when it no longer holds.
export type Check = { name: string; title?: string; kind?: CheckKind; app: string; page?: string; route?: string; todo: string; expect: string; data?: string; reference?: string; saves: boolean; minutes?: number; account?: string; files?: string[]; evidence?: Evidence[] }

// what a check is for: 변경, its expectation differs from what the screen
// shows with the code before the change; 대조, it looks the same before
// and after.
export type CheckKind = "변경" | "대조"

// a check's steps or expectation as its items, one per line; a check from
// before they were lists is one item.
export const itemsOf = (text: string) => text.split("\n")

// steps or an expectation after `- <label>: ` on a markdown line: one item
// as it is, more each on its own line under it, numbered or not.
export function listed(text: string, numbered: boolean, indent = "  "): string {
  const items = itemsOf(text)
  return items.length === 1 ? items[0]! : items.map((x, i) => `\n${indent}${numbered ? `${i + 1}.` : "-"} ${x}`).join("")
}

// the kinds a `- 증거:` line may name.
export const EVIDENCE_KINDS = ["측정", "앱 상태", "서버 응답", "네트워크", "콘솔", "다운로드", "snapshot"] as const
export type Evidence = { kind: (typeof EVIDENCE_KINDS)[number]; text: string }

// a check name is a slug, the name of its evidence folder.
const checkName = (name: string) => name.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)

// the `## e2e 확인` section: `### <name>` items (a slug, at most 40
// characters), each with one line of `- 제목:`, `- 구분: 변경|대조`,
// `- 앱:`, `- 페이지:`, `- 경로:`, `- 할 일:`, `- 기대:` (each of these two
// with its value, or empty with indented `- ` or `1.` items under it) and
// `- 저장: 없음|있음`, and optionally `- 데이터 조건:` (in the same two
// forms), `- 참고: <why this data>`,
// `- 시간: <minutes, 1 to 60>`,
// `- 계정: <account>`, `- 파일: <file>[, <file>...]` (on one line or
// more, the files as 2-plan.md names them) and `- 증거: <kind> — <what>` (on
// any number of lines); or the line `없음` alone, nothing to check. undefined when the section is absent.
export function parseChecks(text: string): { checks: Check[] } | { reason: string } | undefined {
  const lines = unfenced(text)
  const start = lines.findIndex(l => /^##\s+e2e 확인\s*$/.test(l))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  const items: { name: string; fields: Record<string, string[]>; lists: Record<string, string[]> }[] = []
  let none = false
  // the items of the `- 할 일:`, `- 기대:` or `- 데이터 조건:` line just
  // above, while its indented items go on.
  let open: string[] | undefined
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const item = open && /^\s+(?:[-*]|\d+[.)])\s+(.*?)\s*$/.exec(line)
    if (item) {
      if (item[1] !== "") open!.push(item[1]!)
      continue
    }
    open = undefined
    const head = /^###\s+(.*)$/.exec(line)
    if (head) {
      items.push({ name: head[1]!.replace(/`/g, "").trim(), fields: {}, lists: {} })
      continue
    }
    const field = /^\s*[-*]\s+(제목|구분|앱|페이지|경로|할 일|기대|데이터 조건|참고|저장|시간|계정|파일|증거)\s*:\s*(.*?)\s*$/.exec(line)
    if (field && items.length > 0) {
      const { fields, lists } = items.at(-1)!
      const key = field[1]!
      fields[key] = [...(fields[key] ?? []), field[2]!]
      if ((key === "할 일" || key === "기대" || key === "데이터 조건") && field[2] === "") open = lists[key] = []
    } else if (items.length === 0 && /^없음(?:\s|[.—–-]|$)/.test(line.trim())) none = true
  }
  const form = `Each check is \`### <name>\` (lowercase letters, digits and single hyphens, at most 40 characters) with one line each of \`- 제목: <what it looks at, in a few words>\`, \`- 구분: 변경\` (its expectation differs from the screen before the change) or \`- 구분: 대조\` (it looks the same before and after), \`- 앱: <an app of config e2e.apps>\`, \`- 페이지: <the page it looks at>\`, \`- 경로: <the menus that reach it, as A > B > C>\`, \`- 할 일:\` (the steps, each on its own indented \`1.\` line under it), \`- 기대:\` (what must show, each part on its own indented \`- \` line under it) and \`- 저장: 없음\` or \`- 저장: 있음\`, and optionally \`- 데이터 조건:\` (what the data of 할 일 must be for the check to show its 기대, each condition on its own indented \`- \` line under it), \`- 참고: <why this data, what the screen does not show>\`, \`- 시간: <minutes, 1 to 60>\`, \`- 계정: <the account to log in as>\`, \`- 파일: <file>[, <file>...]\` (the design or handoff files the screen runs on) and \`- 증거: <kind> — <what to record>\` lines, the kind one of ${EVIDENCE_KINDS.join(", ")}. With no screen to check, the section holds only the line \`없음\`.`
  if (items.length === 0) return none ? { checks: [] } : { reason: `\`## e2e 확인\` has no \`### <name>\` check and no line \`없음\`. ${form}` }
  const bad = items.filter(i => !checkName(i.name)).map(i => `\`### ${i.name}\``)
  if (bad.length > 0) return { reason: `these check names are not a slug: ${bad.join(", ")}. ${form}` }
  const twice = items.map(i => i.name).filter((n, i, all) => all.indexOf(n) !== i)
  if (twice.length > 0) return { reason: `these check names appear more than once: ${[...new Set(twice)].join(", ")}.` }
  const wrong: string[] = []
  const checks: Check[] = []
  for (const { name, fields, lists } of items) {
    // a value on its line, or the items under an empty `- 할 일:`,
    // `- 기대:` or `- 데이터 조건:`, one per line.
    const one = (key: string) => (fields[key]?.length !== 1 ? undefined : fields[key]![0] !== "" ? fields[key]![0] : lists[key]?.length ? lists[key]!.join("\n") : undefined)
    const missing = ["제목", "구분", "앱", "페이지", "경로", "할 일", "기대", "저장"].filter(k => one(k) === undefined)
    if (missing.length > 0) wrong.push(`${name} needs exactly one non-empty line of ${missing.map(k => `\`- ${k}:\``).join(", ")}`)
    const kind = one("구분")
    if (kind !== undefined && kind !== "변경" && kind !== "대조") wrong.push(`${name} says \`- 구분: ${kind}\`, not 변경 or 대조`)
    const data = one("데이터 조건")
    if (fields["데이터 조건"] !== undefined && data === undefined) wrong.push(`${name} needs at most one \`- 데이터 조건:\` line, with its conditions`)
    const reference = one("참고")
    if (fields["참고"] !== undefined && reference === undefined) wrong.push(`${name} needs at most one non-empty \`- 참고:\` line`)
    const saves = one("저장")
    if (saves !== undefined && saves !== "없음" && saves !== "있음") wrong.push(`${name} says \`- 저장: ${saves}\`, not 없음 or 있음`)
    const time = fields["시간"]
    const minutes = time === undefined ? undefined : Number(time[0])
    if (time !== undefined && !(time.length === 1 && /^\d+$/.test(time[0]!) && minutes! >= 1 && minutes! <= 60)) wrong.push(`${name} needs at most one \`- 시간:\` line, a whole number of minutes from 1 to 60`)
    const account = one("계정")
    if (fields["계정"] !== undefined && account === undefined) wrong.push(`${name} needs at most one non-empty \`- 계정:\` line`)
    const files = fields["파일"]?.flatMap(v => v.split(",")).map(f => f.replace(/`/g, "").trim())
    if (files?.some(f => f === "")) wrong.push(`${name} has an empty file on a \`- 파일:\` line`)
    const evidence = fields["증거"]?.map(evidenceOf)
    for (const [i, e] of (evidence ?? []).entries()) if (e === undefined) wrong.push(`${name} has \`- 증거: ${fields["증거"]![i]}\`, not \`<kind> — <what>\` with a kind of ${EVIDENCE_KINDS.join(", ")}`)
    const named = evidence?.filter((e): e is Evidence => e !== undefined)
    checks.push({ name, title: one("제목") ?? "", kind: kind === "대조" ? "대조" : "변경", app: one("앱") ?? "", page: one("페이지") ?? "", route: one("경로") ?? "", todo: one("할 일") ?? "", expect: one("기대") ?? "", ...(data !== undefined ? { data } : {}), ...(reference !== undefined ? { reference } : {}), saves: saves === "있음",...(minutes !== undefined ? { minutes } : {}), ...(account !== undefined ? { account } : {}), ...(files !== undefined ? { files } : {}), ...(named?.length ? { evidence: named } : {}) })
  }
  if (wrong.length > 0) return { reason: `in \`## e2e 확인\`: ${wrong.join("; ")}. ${form}` }
  return { checks }
}

// one `- 증거:` value, `<kind> — <what>` (an en dash or a hyphen too).
function evidenceOf(value: string): Evidence | undefined {
  const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(value)
  const kind = EVIDENCE_KINDS.find(k => k === m?.[1]?.trim())
  return kind && m ? { kind, text: m[2]!.trim() } : undefined
}

// one screen of 2-plan.md's `## 배치 대조`: the `.screen` id of its to-be
// in 1-mockup.html, the page and the menus that reach it, and what in it to
// compare. The person compares it by hand in integration qa. saves, when
// the to-be shows only with saved data: 경로 makes that data and puts it back.
export type Layout = { anchor: string; page: string; route: string; look: string; saves?: true }

// the `## 배치 대조` section: `### <anchor>` items, each with one line of
// `- 페이지:`, `- 경로:` and `- 볼 곳:`, and optionally `- 저장: 있음|없음`
// (no line is 없음); or the line `없음` alone. undefined
// when the section is absent.
export function parseLayouts(text: string): { layouts: Layout[] } | { reason: string } | undefined {
  const lines = unfenced(text)
  const start = lines.findIndex(l => /^##\s+배치 대조\s*$/.test(l))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  const items: { anchor: string; fields: Record<string, string[]> }[] = []
  let none = false
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const head = /^###\s+(.*)$/.exec(line)
    if (head) {
      items.push({ anchor: head[1]!.replace(/`/g, "").replace(/^#/, "").trim(), fields: {} })
      continue
    }
    const field = /^\s*[-*]\s+(페이지|경로|볼 곳|저장)\s*:\s*(.*?)\s*$/.exec(line)
    if (field && items.length > 0) (items.at(-1)!.fields[field[1]!] ??= []).push(field[2]!)
    else if (items.length === 0 && /^없음(?:\s|[.—–-]|$)/.test(line.trim())) none = true
  }
  const form = "Each screen is `### <its .screen id in 1-mockup.html>` with one line each of `- 페이지: <the page>`, `- 경로: <the menus that reach it, as A > B > C>` and `- 볼 곳: <what of its layout to compare>`, and `- 저장: 있음` when the to-be shows only with saved data (경로 then saves it and puts it back). With no to-be screen in 1-mockup.html, the section holds only the line `없음`, or is left out."
  if (items.length === 0) return none ? { layouts: [] } : { reason: `\`## 배치 대조\` has no \`### <anchor>\` screen and no line \`없음\`. ${form}` }
  const twice = items.map(i => i.anchor).filter((a, i, all) => all.indexOf(a) !== i)
  if (twice.length > 0) return { reason: `these screens appear more than once in \`## 배치 대조\`: ${[...new Set(twice)].join(", ")}.` }
  const wrong: string[] = []
  const layouts: Layout[] = []
  for (const { anchor, fields } of items) {
    const one = (key: string) => (fields[key]?.length === 1 && fields[key]![0] !== "" ? fields[key]![0] : undefined)
    const missing = ["페이지", "경로", "볼 곳"].filter(k => one(k) === undefined)
    if (missing.length > 0) wrong.push(`${anchor} needs exactly one non-empty line of ${missing.map(k => `\`- ${k}:\``).join(", ")}`)
    const saves = one("저장")
    if (fields["저장"] !== undefined && saves !== "있음" && saves !== "없음") wrong.push(`${anchor} needs at most one \`- 저장:\` line, 있음 or 없음`)
    layouts.push({ anchor, page: one("페이지") ?? "", route: one("경로") ?? "", look: one("볼 곳") ?? "", ...(saves === "있음" ? { saves: true as const } : {}) })
  }
  if (wrong.length > 0) return { reason: `in \`## 배치 대조\`: ${wrong.join("; ")}. ${form}` }
  return { layouts }
}

// the ids of 1-mockup.html's `.screen` sections that draw a to-be: an
// element of class `after` inside them, as rein:sketcher draws it.
export function toBeScreens(html: string): string[] {
  const ids: string[] = []
  for (const part of html.replace(/<!--[\s\S]*?-->/g, "").split(/<section\b/i).slice(1)) {
    const tag = part.slice(0, part.indexOf(">"))
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(tag)?.[1]
    const screen = /\bclass\s*=\s*"(?:[^"]*\s)?screen(?:\s[^"]*)?"/i.test(tag)
    const close = part.search(/<\/section>/i)
    const body = close < 0 ? part : part.slice(0, close)
    if (id && screen && /\bclass\s*=\s*"(?:[^"]*\s)?after(?:\s[^"]*)?"/i.test(body)) ids.push(id)
  }
  return ids
}

// one line of `## 완료 판정 덮기`: a part of the spec's completion line
// and how it is checked: by e2e checks, by a test file, or not at all.
export type Cover = { part: string } & ({ by: "e2e"; checks: string[] } | { by: "테스트"; file: string } | { by: "확인 불가"; reason: string })

// the `## 완료 판정 덮기` section, one bullet per part:
// `- "<part>" — e2e: <check>[, <check>...]`, `- "<part>" — 테스트: <file>` or
// `- "<part>" — 확인 불가: <reason>`. undefined when the section is absent.
export function parseCover(text: string): { cover: Cover[] } | { reason: string } | undefined {
  const lines = unfenced(text)
  const start = lines.findIndex(l => /^##\s+완료 판정 덮기\s*$/.test(l))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  const cover: Cover[] = []
  const wrong: string[] = []
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const bullet = /^\s*[-*]\s+(.*?)\s*$/.exec(line)?.[1]
    if (bullet === undefined) continue
    const m = /^["“](.+?)["”]\s*(?:[—–]+|-+)\s*(e2e|테스트|확인 불가)\s*:\s*(.*)$/.exec(bullet)
    if (!m) {
      wrong.push(bullet)
      continue
    }
    const [part, by, value] = [m[1]!, m[2]!, m[3]!.trim()]
    if (by === "e2e") cover.push({ part, by: "e2e", checks: value.split(",").map(s => s.replace(/`/g, "").trim()).filter(s => s !== "") })
    else if (by === "테스트") cover.push({ part, by: "테스트", file: itemPath(value) ?? value.replace(/`/g, "").split(/\s+/)[0]! })
    else cover.push({ part, by: "확인 불가", reason: value })
  }
  const form = "Each line is `- \"<part of the completion line>\" — e2e: <check>[, <check>...]`, `- \"<part>\" — 테스트: <test file>` or `- \"<part>\" — 확인 불가: <reason>`."
  if (wrong.length > 0) return { reason: `these \`## 완료 판정 덮기\` lines are not in the form: ${wrong.join(" | ")}. ${form}` }
  if (cover.length === 0) return { reason: `\`## 완료 판정 덮기\` has no line. ${form}` }
  return { cover }
}

// every part is a substring of the completion line, every e2e check
// is one of `## e2e 확인`, every test file is a design item or a file that
// exists (present), and every 확인 불가 gives a reason. The reason, or
// undefined when it holds.
export function judgeCover(cover: Cover[], completion: string, checks: string[], files: string[], present: string[], root: string): string | undefined {
  const wrong: string[] = []
  for (const c of cover) {
    if (!completion.includes(c.part)) wrong.push(`"${c.part}" is not part of the completion line`)
    if (c.by === "e2e") {
      const unknown = c.checks.filter(n => !checks.includes(n))
      if (c.checks.length === 0) wrong.push(`"${c.part}" says e2e but names no check`)
      else if (unknown.length > 0) wrong.push(`"${c.part}" names ${unknown.join(", ")}, not a check of \`## e2e 확인\``)
    } else if (c.by === "테스트") {
      const known = [...files, ...present].some(f => same(f, resolve(c.file, root)))
      if (c.file === "") wrong.push(`"${c.part}" says 테스트 but names no file`)
      else if (!known) wrong.push(`"${c.part}" names the test ${c.file}, which is neither a \`### <path>\` item of \`## 상세 설계\` nor an existing file`)
    } else if (c.reason === "") wrong.push(`"${c.part}" says 확인 불가 but gives no reason`)
  }
  if (wrong.length === 0) return undefined
  return `in \`## 완료 판정 덮기\`: ${wrong.join("; ")}. Each part is copied from the spec's completion line (\`${completion}\`), character for character.`
}

// The path an item names: the backticked span if there is one, else the
// first token without spaces. Only a new-file note may follow it
// (`— 새 파일` or `(새 파일)`); anything else leaves no path.
export function itemPath(text: string): string | undefined {
  const m = /^\s*(?:`([^`]+)`|([^\s`]+))\s*(.*)$/.exec(text)
  const path = (m?.[1] ?? m?.[2])?.trim()
  const rest = m?.[3]?.trim() ?? ""
  if (!path) return undefined
  return rest === "" || /^(?:[—–-]+\s*새 파일|\(새 파일\))$/.test(rest) ? path : undefined
}

// Lines outside fenced code. A fence closes only on its own marker, at least
// as long as the one that opened it, with nothing after it.
function unfenced(text: string): string[] {
  let open: { ch: string; len: number } | undefined
  return text.split(/\r?\n/).filter(line => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!open) {
      if (m) open = { ch: m[1]![0]!, len: m[1]!.length }
      return !m
    }
    if (m && m[1]![0] === open.ch && m[1]!.length >= open.len && m[2]!.trim() === "") open = undefined
    return false
  })
}

export type DevItem = { path: string; checked: boolean }

// dev-items.md's checklist, `- [x] <path>` or `- [ ] <path>`, the path as
// 2-plan.md wrote it (backticks and `— 새 파일` dropped), resolved against root.
export function parseDev(text: string, root: string): DevItem[] {
  const items: DevItem[] = []
  for (const line of unfenced(text)) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)
    if (m) items.push({ path: resolve(itemPath(m[2]!) ?? m[2]!, root), checked: m[1] !== " " })
  }
  return items
}

// ① the checklist is 2-plan.md's file list ② every item is checked ③ every
// write the hook recorded is on the list. Every offending file is named.
// Writes are never forgotten, so a write off the list is settled only by the
// arbiter sending the design back to plan, once per plan pass.
export function judgeDev(items: DevItem[], planFiles: string[], writes: string[], arbiterRuled: boolean): string | undefined {
  const has = (list: string[], p: string) => list.some(x => same(x, p))
  const listed = items.map(i => i.path)
  const missing = planFiles.filter(f => !has(listed, f))
  const extra = listed.filter(p => !has(planFiles, p))
  const unchecked = items.filter(i => !i.checked).map(i => i.path)
  const outside = writes.filter(w => !has(planFiles, w))
  const reasons: string[] = []
  if (missing.length > 0) reasons.push(`2-plan.md lists files the checklist lacks: ${missing.join(", ")}.`)
  if (extra.length > 0) reasons.push(`the checklist has files 2-plan.md does not list: ${extra.join(", ")}.`)
  if (unchecked.length > 0) reasons.push(`unchecked items: ${unchecked.join(", ")}.`)
  if (outside.length > 0) {
    const next = arbiterRuled
      ? "The arbiter already ruled in this dev pass, so the run cannot leave dev: stop and tell the user (U43)."
      : "The hook keeps every write, so undoing the change does not help: spawn rein:arbiter so plan can list the file (D22)."
    reasons.push(`files written outside the design: ${outside.join(", ")}. ${next}`)
  }
  return reasons.length > 0 ? reasons.join(" ") : undefined
}

export type DeviationParse = { ok: true; verdict: "합당" | "부당" } | { ok: false; reason: string }

// G3: deviation.md holds exactly one `판정: 합당` or `판정: 부당` line and a
// `## 사유` section with text under it.
export function parseDeviation(text: string): DeviationParse {
  const lines = text.split(/\r?\n/)
  const verdicts = lines.filter(l => /^\s*판정\s*:/.test(l))
  const verdict = verdicts.length === 1 ? /^\s*판정:\s*(합당|부당)\s*$/.exec(verdicts[0]!)?.[1] : undefined
  if (verdict !== "합당" && verdict !== "부당") {
    return { ok: false, reason: "deviation.md needs exactly one line `판정: 합당` or `판정: 부당`." }
  }
  const at = lines.findIndex(l => /^##\s+사유\s*$/.test(l))
  if (at < 0) return { ok: false, reason: "deviation.md has no `## 사유` section." }
  const end = lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
  const body = lines.slice(at + 1, end < 0 ? undefined : end)
  if (!body.some(l => l.trim() !== "")) return { ok: false, reason: "the `## 사유` section of deviation.md is empty." }
  return { ok: true, verdict }
}

// G9: what qa needs from <repository root>/.rein/config.json: a JSON
// object whose `qa` is a non-empty list of commands; `qa-integration`, when
// there, a list of commands too (it may be empty). undefined when usable.
export function checkConfig(text: string): string | undefined {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return "it is not valid JSON"
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return "it is not a JSON object"
  const cfg = data as Record<string, unknown>
  const commands = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string" && x.trim() !== "")
  if (!commands(cfg.qa) || (cfg.qa as unknown[]).length === 0) return "`qa` must be a non-empty array of command strings"
  // `worktree.setup`, when there: the commands run in a worktree just made.
  const worktree = cfg.worktree as Record<string, unknown> | undefined
  if (worktree !== undefined && (!worktree || typeof worktree !== "object" || Array.isArray(worktree) || (worktree.setup !== undefined && !commands(worktree.setup)))) {
    return "`worktree` must be an object whose `setup` is an array of command strings"
  }
  // `e2e`, when there, has apps (each an http(s) url and,
  // optionally, a login sentence, a note and the ego profiles; the form before it, one `url` and an
  // `account`, still reads), a production list (required, may be empty), a
  // backends list and a timeout of at most 60 whole minutes.
  const e2e = cfg.e2e as Record<string, unknown> | undefined
  if (e2e !== undefined) {
    if (!e2e || typeof e2e !== "object" || Array.isArray(e2e)) return "`e2e` must be an object"
    const http = (url: unknown) => {
      try {
        const protocol = new URL(String(url)).protocol
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    }
    if (e2e.apps !== undefined) {
      const apps = e2e.apps as Record<string, unknown>
      if (!apps || typeof apps !== "object" || Array.isArray(apps) || Object.keys(apps).length === 0) {
        return "`e2e.apps` must be an object of apps, `{\"<name>\": {\"url\": \"...\", \"login\": \"...\"}}`, with at least one"
      }
      for (const [name, v] of Object.entries(apps)) {
        const app = v as Record<string, unknown>
        if (!app || typeof app !== "object" || Array.isArray(app) || !http(app.url)) return `\`e2e.apps.${name}.url\` must be an http or https url`
        if (app.login !== undefined && typeof app.login !== "string") return `\`e2e.apps.${name}.login\` must be a string`
        if (app.note !== undefined && typeof app.note !== "string") return `\`e2e.apps.${name}.note\` must be a string`
        if (app.profile !== undefined && (typeof app.profile !== "string" || app.profile.trim() === "")) return `\`e2e.apps.${name}.profile\` must be an ego profile name`
        const profiles = app.profiles as Record<string, unknown> | undefined
        if (profiles !== undefined && (!profiles || typeof profiles !== "object" || Array.isArray(profiles) || !Object.values(profiles).every(p => typeof p === "string" && p.trim() !== ""))) {
          return `\`e2e.apps.${name}.profiles\` must map each account to an ego profile name, \`{"<account>": "<profile>"}\``
        }
      }
    } else if (!http(e2e.url)) return "`e2e.apps` must name the apps aside drives, each with an http or https `url`"
    if (!Array.isArray(e2e.production) || !e2e.production.every(p => typeof p === "string")) {
      return "`e2e.production` must be an array of hosts (it may be empty)"
    }
    // the hosts the app sends requests to, checked against production
    // like the url; [] only when the app calls no backend.
    if (!Array.isArray(e2e.backends) || !e2e.backends.every(b => typeof b === "string" && b.trim() !== "")) {
      return "`e2e.backends` must be an array of the hosts the app sends requests to (empty only when it calls no backend)"
    }
    const t = e2e.timeout
    if (t !== undefined && !(typeof t === "number" && Number.isInteger(t) && t >= 1 && t <= 60)) {
      return "`e2e.timeout` must be a whole number of minutes from 1 to 60"
    }
  }
  return undefined
}

export type ReviewParse = { ok: true; pass: true } | { ok: true; pass: false; cause: Cause } | { ok: false; reason: string }

// whether the code or the design must change for a failure, as the
// reviewer or the triage judged it.
export type Cause = "구현" | "설계"

// a failure file's (review.md, qa.md) `## 실패 원인` section: its lines
// that start `원인: 구현` or `원인: 설계` name one cause; anything after it on
// that line, and the other lines there, are the reason. Lines in a fence do
// not count.
export function parseCause(text: string): { ok: true; cause: Cause } | { ok: false; reason: string } {
  const lines = unfenced(text)
  const at = lines.findIndex(l => /^##\s+실패 원인\s*$/.test(l))
  const end = at < 0 ? -1 : lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
  const body = at < 0 ? [] : lines.slice(at + 1, end < 0 ? undefined : end)
  const said = new Set(body.flatMap(l => /^\s*(?:[-*]\s+)?원인\s*:\s*(구현|설계)(?![가-힣A-Za-z0-9])/.exec(l)?.[1] ?? []))
  if (said.size !== 1) return { ok: false, reason: "a failure needs a `## 실패 원인` section with the line `원인: 구현` or `원인: 설계`, naming one cause." }
  return { ok: true, cause: [...said][0] as Cause }
}

// review.md has `## 설계 대조` and `## 정확성`, each with one `판정:`
// line that is exactly 통과 or 실패, and `## 룰 체크`. Each section heading
// appears once. The hook reads `## 룰 체크` only for a failed rule (a line
// with 판정 실패); its rule list and line form are the reviewer's task. pass is
// true when no verdict is 실패.
export function parseReview(text: string): ReviewParse {
  const lines = unfenced(text)
  const heads = lines.map(l => /^##\s+(.+?)\s*$/.exec(l)?.[1]).filter((h): h is string => h !== undefined)
  const twice = heads.find((h, i) => heads.indexOf(h) !== i)
  if (twice !== undefined) return { ok: false, reason: `review.md has \`## ${twice}\` more than once.` }
  const section = (title: string) => {
    const at = lines.findIndex(l => new RegExp(`^##\\s+${title}\\s*$`).test(l))
    if (at < 0) return undefined
    const end = lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
    return lines.slice(at + 1, end < 0 ? undefined : end)
  }
  const design = section("설계 대조")
  const check = section("룰 체크")
  const correct = section("정확성")
  if (!design || !check || !correct) return { ok: false, reason: "review.md needs `## 설계 대조`, `## 룰 체크` and `## 정확성`." }

  const verdictish = (l: string) => /^\s*(?:[-*]\s+)?판정/.test(l)
  const verdicts: string[] = []
  for (const [title, body] of [["설계 대조", design], ["정확성", correct]] as const) {
    const said = body.filter(verdictish)
    const verdict = said.length === 1 ? /^\s*판정:\s*(통과|실패)\s*$/.exec(said[0]!)?.[1] : undefined
    if (!verdict) return { ok: false, reason: `\`## ${title}\` needs exactly one line \`판정: 통과\` or \`판정: 실패\`, and no other line starting with 판정.` }
    verdicts.push(verdict)
  }

  if (check.some(l => /판정\s*:?\s*실패/.test(l))) verdicts.push("실패")
  if (verdicts.every(v => v === "통과")) return { ok: true, pass: true }
  const cause = parseCause(text)
  return cause.ok ? { ok: true, pass: false, cause: cause.cause } : { ok: false, reason: `review.md: ${cause.reason}` }
}

// one dimension of the grader's grade.md: its score, the quotes it
// cites from 1-spec.md, and its first gap (undefined for 없음).
export type GradeDim = { name: string; score: number; quotes: string[]; gap?: string }

export type GradeParse = { ok: true; dims: GradeDim[] } | { ok: false; reason: string }

// grade.md has a `## <dimension>` section for each name and no other,
// each with one `점수: <0..1>` line, one or more `근거: "<quote>"` lines (or
// one `근거: 없음`) and one `빈칸: <gap or 없음>` line. Other lines are ignored.
export function parseGrade(text: string, names: string[]): GradeParse {
  const lines = unfenced(text)
  const heads = lines.map(l => /^##\s+(.+?)\s*$/.exec(l)?.[1]).filter((h): h is string => h !== undefined)
  const sorted = (list: string[]) => [...list].sort().join(", ")
  if (sorted(heads) !== sorted(names) || new Set(heads).size !== heads.length) {
    return { ok: false, reason: `grade.md must have one \`## <dimension>\` section for each of these and no others: ${names.join(", ")}.` }
  }
  const dims: GradeDim[] = []
  for (const name of names) {
    const at = lines.findIndex(l => /^##\s+(.+?)\s*$/.exec(l)?.[1] === name)
    const end = lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
    const body = lines.slice(at + 1, end < 0 ? undefined : end).map(l => l.trim())
    const scores = body.filter(l => l.startsWith("점수"))
    const score = scores.length === 1 ? /^점수:\s*(0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/.exec(scores[0]!)?.[1] : undefined
    if (score === undefined) return { ok: false, reason: `\`## ${name}\` needs exactly one line \`점수: <0 to 1, at most two decimals>\`.` }
    const cited = body.filter(l => l.startsWith("근거"))
    const quotes = cited.map(l => /^근거:\s*"(.+)"$/.exec(l)?.[1])
    const none = cited.length === 1 && /^근거:\s*없음$/.test(cited[0]!)
    if (!none && (cited.length === 0 || quotes.some(q => q === undefined))) {
      return { ok: false, reason: `\`## ${name}\` needs one or more lines \`근거: "<words copied from 1-spec.md>"\`, or one line \`근거: 없음\`.` }
    }
    const gaps = body.filter(l => l.startsWith("빈칸"))
    const gap = gaps.length === 1 ? /^빈칸:\s*(.+)$/.exec(gaps[0]!)?.[1] : undefined
    if (gap === undefined) return { ok: false, reason: `\`## ${name}\` needs exactly one line \`빈칸: <its first gap>\` or \`빈칸: 없음\`.` }
    dims.push({ name, score: Number(score), quotes: none ? [] : (quotes as string[]), ...(gap === "없음" ? {} : { gap }) })
  }
  return { ok: true, dims }
}
