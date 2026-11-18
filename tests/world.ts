import { mock, type MockClock } from "claude-code/testing"
import type { AgentStatus, HttpInit, On, ProcessRunResult } from "claude-code"
import { DIMENSIONS, SCOPE_ROWS } from "../hooks/stages/spec.ts"

export const SESSION = "s1"
export const ROOT = "E:/proj"
export const REIN = "C:/Users/u/.rein/proj"
export const DIR = `${REIN}/active/login-fix`

// the session root as the engine gives it now; a test moves it as
// EnterWorktree would (a session from before Rein stopped entering
// worktrees). Each world starts it at ROOT.
export const at = { root: ROOT }

// `## 범위` with every row of SCOPE_ROWS decided.
export const SCOPE = `\n## 범위\n\n| 구성 요소 | 상태 | 근거 |\n|---|---|---|\n${SCOPE_ROWS.map(r => `| ${r} | 제외 (닿지 않음) | |`).join("\n")}\n`

// A 1-spec.md with what the approval needs: a completion line and a
// reference; and its 유형 for the grader, with `## 범위` decided.
export const SPEC_TEXT = `---\nslug: login-fix\n유형: bugfix\n참조: "없음"\n---\n\n# spec\n\n## 완료 판정\n\n로그인에 세 번 실패하면 잠긴다\n\n## 영향 범위\n\n없음\n${SCOPE}`

// a `## 완료 판정 덮기` every plan needs, its one part a piece of any
// completion line the tests use ("잠긴다").
export const COVER = '\n## 완료 판정 덮기\n\n- "잠긴다" — 확인 불가: 예시라 확인할 것이 없음\n'

// a grade.md giving every dimension `score`, citing `quote` (a piece
// of SPEC_TEXT's completion line by default).
export const gradeMd = (score = "0.9", quote = "잠긴다") =>
  DIMENSIONS.map(d => `## ${d.name}\n\n점수: ${score}\n근거: "${quote}"\n빈칸: 없음\n`).join("\n")

type Engine = { agent: { spawn: (e: never) => Promise<unknown> }; tool: { call: (e: never) => Promise<unknown> } }

// 1-spec.md as it is graded through the hook: a rein:grader is spawned,
// then writes grade.md. The Write's result, with the hook's summary.
export async function grade($: Engine, text = gradeMd()): Promise<unknown> {
  const spawn = { tool_use_id: "g", prompt: "grade", description: "grade", subagentType: "rein:grader", background: true }
  const { agentId } = (await $.agent.spawn(spawn as never)) as { agentId?: string }
  return $.tool.call({ tool: "Write", file_path: `${DIR}/agent/grade.md`, content: text, agentId } as never)
}

// 2-plan.md as it stands, reviewed through the hook: a rein:reviewer is
// spawned in plan and calls mcp__rein__plan_review on the rule files its task
// lists, every part 통과, or spec 실패 for `fail`. What the call returned, or
// the spawn's refusal.
export async function reviewed($: Engine, fail?: string): Promise<unknown> {
  const spawn = { tool_use_id: "r", prompt: "설계 리뷰", description: "review", subagentType: "rein:reviewer", background: false }
  const r = (await $.agent.spawn(spawn as never)) as { agentId?: string; deny?: string }
  if (r.agentId === undefined) return r
  const task = spawned.at(-1)?.prompt ?? ""
  const listed = task.slice(task.indexOf("Rules to check"), task.indexOf("Judge three parts"))
  const rules = [...listed.matchAll(/^- (.+?): /gm)].map(m => ({ file: m[1], verdict: "통과" }))
  const spec = fail === undefined ? { verdict: "통과" } : { verdict: "실패", why: fail }
  return $.tool.call({ tool: "mcp__rein__plan_review", rules, impact: { verdict: "통과" }, spec, agentId: r.agentId } as never)
}

// The main session writes 2-plan.md, has it reviewed and asks for plan to go
// on with the person's approval: the hook judges 2-plan.md at advance. What
// the hook said back: the refusal, or the result and the context.
export async function planned($: Engine, content: string, path = `${DIR}/2-plan.md`): Promise<string> {
  await $.tool.call({ tool: "Write", file_path: path, content } as never)
  await reviewed($)
  const r = (await $.tool.call({ tool: "mcp__rein__advance", answer: "승인" } as never)) as { deny?: string; result?: string; context?: string[] }
  return r.deny ?? [r.result, ...(r.context ?? [])].join("\n")
}

// The engine hands paths over in the platform's form, backslashes on Windows.
export const key = (p: string) => p.replace(/\\/g, "/")

// The spawns that reached the engine, as the plugin left them.
export const spawned: { type: string; background: boolean; prompt?: string; cwd?: string }[] = []

// The commands the plugin ran through $.process.run, with their cwd.
export const ran: { argv: string[]; cwd?: string }[] = []

// The subcommand of a git argv the hook ran, past its hardening -c pairs.
export function gitSub(argv: string[]): string | undefined {
  let i = 1
  while (argv[i] === "-c") i += 2
  return argv[i]
}

// The host beneath the plugin: what a command exits with, whether a URL
// answers (and with what), and what a Bash tool call returns (undefined: the default ok).
export type Host = {
  run?: (argv: string[], cwd: string | undefined, stdin?: string, env?: Record<string, string>) => { exitCode: number; stdout?: string; stderr?: string }
  fetch?: (url: string, init?: HttpInit) => boolean | "hang" | { status: number; text?: string }
  bash?: (command: string) => Record<string, unknown> | undefined
  // Whether aside saves a screenshot in the folder its command names; undefined: it does.
  shots?: false
  // What any other tool call answers; undefined: Write/Edit change files, ok.
  call?: (tool: string, input: Record<string, unknown>) => Record<string, unknown> | undefined
  // Whether a path is a folder (fs.stat's kind); undefined: a file.
  isDir?: (path: string) => boolean
  // Where a path really lands (a link or junction); undefined: where it says.
  real?: (path: string) => string | undefined
  // USERPROFILE; undefined: C:/Users/u.
  home?: string
  // More environment variables, e.g. COMPUTERNAME.
  env?: Record<string, string>
  // Whether the hook's folder move succeeds; undefined: it does.
  move?: (from: string, to: string) => boolean
  // Store entries besides the run's, e.g. other runs and legacy keys.
  store?: Record<string, unknown>
  // Whether a store write fails (the engine rejects past 4 MiB); undefined: it does not.
  storeFails?: (key: string, value: unknown) => boolean
  // Whether a file write fails; undefined: it does not.
  writeFails?: (path: string) => boolean
  // Where each spawned agent's loop stands ($.agent.list); undefined: running.
  agents?: Record<string, AgentStatus>
}

// The plugin's store, as JSON the engine keeps, for a test to read or change.
export const store = new Map<string, unknown>()
const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
// a child that ran to its end, its output whole.
const exited = (r: { exitCode: number; stdout?: string; stderr?: string }): { value: ProcessRunResult } => ({ value: { stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false, ...r } })

// the names /rename ran with, the hook's and the test's, in order.
export const renames: string[] = []

// the toasts the hook showed, in order.
export const toasts: string[] = []

// The folder moves the hook made through $.process.run, kept out of `ran`.
export const moves: { from: string; to: string; argv: string[] }[] = []

// The mocked clock of the current world, to move time while a call waits.
export let clock: MockClock

// A write held until its gate opens, to play two writes in flight at once.
export const gates: Record<string, Promise<void>> = {}

// The person's answer to the AskUserQuestion call, or undefined to dismiss it.
export type Person = (question: string) => string | undefined

// The person of the current world, for relay().
let current: Person = () => undefined

// the hook asks no one, so a test plays the main session. It calls a
// tool; when the hook says it needs the user's answer, the person reads what
// the hook knows (the question as the hook would have put it) and the Rein
// tool is called again with their label. A refused git commit takes
// its answer through advance, and once approved the same command runs
// again. A dismissed question ends there, as the main session would: the
// first answer is the result. When spec or plan stops for the user, the
// person's label is what the skill they type passes ("승인" for /rein:plan
// or /rein:dev); undefined is a user who has not typed it.
const UNANSWERED = /^(?:D\d+: )?this (?:needs (?:the user's answer|a decision)|waits for the user)[\s\S]*?\n\nWhat the hook knows here:\n([\s\S]*?)(?:\n\nPass the answer to mcp__rein__advance;[^\n]*)?$/
export async function relay($: { tool: { call: (e: never) => Promise<unknown> } }, input: unknown): Promise<unknown> {
  const first = await $.tool.call(input as never)
  const asked = first as { deny?: string; result?: string }
  const facts = UNANSWERED.exec(asked.deny ?? asked.result ?? "")?.[1]
  if (facts === undefined) return first
  const label = current(facts)
  if (label === undefined) return first
  if ((input as { tool: string }).tool.startsWith("mcp__rein__")) return $.tool.call({ ...(input as object), answer: label } as never)
  const answered = (await $.tool.call({ tool: "mcp__rein__advance", answer: label } as never)) as { result?: string }
  return answered.result?.startsWith("The user approved the commit") ? $.tool.call(input as never) : answered
}

// The world beneath the plugin. `files` is the file system, a folder existing
// when a file lies under it. The person answers the main session's
// AskUserQuestion (a tool.call hook) and the questions relay() passes on. Write
// and Edit change `files`; every other tool answers ok. `run` is the stored
// run, null for none.
export function world(
  on: On,
  files: Record<string, string>,
  person: Person = () => undefined,
  run: Record<string, unknown> | null = { stage: "spec", runId: "login-fix" },
  host: Host = {},
) {
  // the session's run is a slug record it owns, and the session points to it.
  current = person
  const runId = (run?.runId as string | undefined) ?? "login-fix"
  const seeded = run ? { [`runs:proj/${runId}`]: { ...run, status: "active", owner: SESSION }, [`session:${SESSION}`]: { project: "proj", runId } } : {}
  store.clear()
  for (const [k, v] of Object.entries({ ...seeded, ...host.store })) store.set(k, json(v))
  on("store.get", async (_$, e) => ({ value: json(store.get(e.key)) }))
  on("store.set", async (_$, e) => {
    if (host.storeFails?.(e.key, e.value)) throw new Error("the store is over 4 MiB")
    store.set(e.key, json(e.value))
    return { value: undefined }
  })
  on("store.delete", async (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on("store.keys", async () => ({ value: [...store.keys()] }))
  mock.env(on, { USERPROFILE: host.home ?? "C:/Users/u", SHELL: "C:/Program Files/Git/bin/bash.exe", ...host.env })
  clock = mock.clock(on)
  on("session.id", async () => ({ value: SESSION }))
  at.root = ROOT
  on("session.root", async () => ({ value: at.root }))
  on("turn.complete", async () => ({ text: "" }))
  renames.length = 0
  on("command.run", async (_$, e) => {
    if (e.command === "rename") renames.push(e.args)
    return { text: "" }
  })
  on("fs.exists", async (_$, e) => ({ value: Object.keys(files).some(f => f === key(e.path) || f.startsWith(`${key(e.path)}/`)) }))
  on("fs.read", async (_$, e) => {
    const text = files[key(e.path)] ?? ""
    if (e.as !== "bytes") return { value: text }
    return { value: { base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))) } }
  })
  on("fs.write", async (_$, e) => {
    if (host.writeFails?.(key(e.path))) throw new Error("EACCES: permission denied")
    files[key(e.path)] = e.text
    return { value: undefined }
  })
  on("fs.list", async (_$, e) => {
    const dir = `${key(e.path).replace(/\/$/, "")}/`
    const entries = new Map<string, "file" | "dir">()
    for (const f of Object.keys(files).filter(f => f.startsWith(dir))) {
      const rest = f.slice(dir.length)
      entries.set(rest.split("/")[0]!, rest.includes("/") ? "dir" : "file")
    }
    const list = [...entries].sort(([a], [b]) => (a < b ? -1 : 1))
    return { value: list.map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  ran.length = 0
  moves.length = 0
  on("process.run", async (_$, e) => {
    // the hook's folder move, PowerShell on Windows (paths in the
    // environment) or mv elsewhere; mkdir -p makes nothing here.
    const env = e.init?.env ?? {}
    const isPs = e.argv[0] === "powershell.exe" && env.REIN_FROM !== undefined
    if (e.argv[0] === "mkdir") return exited({ exitCode: 0 })
    if (isPs || e.argv[0] === "mv") {
      const [from, to] = isPs ? [env.REIN_FROM!, env.REIN_TO!] : [e.argv[2]!, e.argv[3]!]
      moves.push({ from, to, argv: [...e.argv] })
      if (host.move?.(from, to) === false) return exited({ exitCode: 1, stderr: "The process cannot access the file because it is being used by another process.\r\n" })
      for (const f of Object.keys(files)) {
        if (!f.startsWith(`${from}/`)) continue
        files[`${to}${f.slice(from.length)}`] = files[f]!
        delete files[f]
      }
      return exited({ exitCode: 0 })
    }
    ran.push({ argv: [...e.argv], cwd: e.init?.cwd })
    const r = host.run?.([...e.argv], e.init?.cwd, e.init?.stdin, e.init?.env) ?? { exitCode: 0 }
    return exited(r)
  })
  on("http.fetch", async (_$, e) => {
    const answer = host.fetch?.(e.url, e.init) ?? true
    if (answer === "hang") await clock.sleep(600_000)
    if (answer === false) throw new Error(`ECONNREFUSED ${e.url}`)
    const { status, text = "" } = typeof answer === "object" ? answer : { status: 200 }
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })
  on("fs.stat", async (_$, e) => {
    const path = key(e.path)
    const realPath = host.real?.(path) ?? path
    const kind = host.isDir?.(path) ? "dir" : "file"
    return { value: { kind, size: 0, mtimeMs: 0, isLink: realPath !== path, realPath: e.resolve ? realPath : undefined } }
  })
  // the toast stack.
  toasts.length = 0
  on("ui.toast", async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on("tool.check", async () => ({ decision: "ask" }) as never)
  // $.tool.call raises tool.check first, as a background subagent's loop
  // does, and an ask nobody answers refuses the call. The person allows
  // every prompt: Rein's refusals are tool.call's, never the prompt's.
  on("classic.PermissionRequest", async () => ({ decision: { behavior: "allow" } }) as never)
  spawned.length = 0
  // The first spawn of a type is agent-<type>, the next agent-<type>-2, ...
  // A resume (SendMessage to an agent that stopped) goes on under its id.
  on("agent.spawn", async (_$, e) => {
    const resumed = (e as { resume?: { agentId: string } }).resume?.agentId
    if (resumed !== undefined) return { model: "m", agentId: resumed }
    spawned.push({ type: e.subagentType, background: e.background, prompt: e.prompt, ...(e.cwd !== undefined ? { cwd: e.cwd } : {}) })
    const n = spawned.filter(s => s.type === e.subagentType).length
    return { model: "m", agentId: n === 1 ? `agent-${e.subagentType}` : `agent-${e.subagentType}-${n}` }
  })
  // every agent spawned so far, as $.agent.list() gives it.
  on("agent.list", async () => ({
    value: spawned.map((s, i) => {
      const n = spawned.slice(0, i + 1).filter(x => x.type === s.type).length
      const id = n === 1 ? `agent-${s.type}` : `agent-${s.type}-${n}`
      return { id, description: "d", type: s.type, status: host.agents?.[id] ?? "running" }
    }),
  }))
  on("tool.call", async (_$, e) => {
    const input = e as unknown as Record<string, string>
    if (e.tool === "AskUserQuestion") {
      const question = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
      const label = person(question)
      if (label === undefined) return { deny: "dismissed" } as never
      return { result: { answers: { [question]: label } }, text: label } as never
    }
    if (e.tool === "Bash") {
      const folder = / in the folder (.+?), and nothing else there\./.exec(input.command!)?.[1]
      if (folder && host.shots !== false) files[`${folder}/shot.png`] = ""
      const said = host.bash?.(input.command!)
      if (said) return said as never
    }
    const answer = host.call?.(e.tool, input)
    if (answer) return answer as never
    const gate = input.file_path === undefined ? undefined : gates[key(input.file_path)]
    if (gate) await gate
    if (e.tool === "Write") files[key(input.file_path!)] = input.content!
    if (e.tool === "Edit") {
      const path = key(input.file_path!)
      files[path] = (files[path] ?? "").replace(input.old_string!, input.new_string!)
    }
    return { result: "ok", text: "ok" } as never
  })
}
