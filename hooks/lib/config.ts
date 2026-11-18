import { checkConfig } from "./parse.ts"

// a repository's .rein/config.json, as qa reads it. plan made
// sure `qa` is there (checkConfig); the rest is optional.

// one app aside or ego drives: where it opens, and how to log in (free
// text: the account, its password, the way to log in). note, what every
// check of the app must mind (a dialog after login, say), free text the
// person reads too, so no password. On the ego path, profile, the ego
// profile the app's checks run in, and profiles, the profile of each
// account a check's `- 계정:` names, both by profile name.
export type App = { url: string; login?: string; note?: string; profile?: string; profiles?: Record<string, string> }

export type E2e = {
  apps: Record<string, App>
  production: string[]
  backends: string[] // the hosts the apps send their requests to
  timeout?: number // minutes per check, default 30, max 60
  model?: string
  effort?: string
}

// setup: `worktree.setup`, what the hook runs in a worktree it just made
// (installing dependencies, say); [] for none.
export type Config = { qa: string[]; integration: string[]; e2e?: E2e; setup: string[] }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined)

// `apps`, or the form before it (`url`, `account`), read as one app
// named `app` whose login is the account.
function appsOf(e2e: Record<string, unknown>): Record<string, App> | undefined {
  const apps = e2e.apps
  if (apps && typeof apps === "object" && !Array.isArray(apps)) {
    const out: Record<string, App> = {}
    for (const [name, v] of Object.entries(apps as Record<string, unknown>)) {
      const app = (v && typeof v === "object" ? v : {}) as Record<string, unknown>
      const url = text(app.url)
      const profiles = app.profiles && typeof app.profiles === "object" && !Array.isArray(app.profiles)
        ? Object.fromEntries(Object.entries(app.profiles as Record<string, unknown>).flatMap(([account, p]) => (text(p) ? [[account, text(p)!]] : [])))
        : undefined
      if (url) {
        out[name] = {
          url,
          ...(text(app.login) ? { login: text(app.login) } : {}),
          ...(text(app.note) ? { note: text(app.note) } : {}),
          ...(text(app.profile) ? { profile: text(app.profile) } : {}),
          ...(profiles && Object.keys(profiles).length > 0 ? { profiles } : {}),
        }
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  const url = text(e2e.url)
  return url ? { app: { url, ...(text(e2e.account) ? { login: text(e2e.account) } : {}) } } : undefined
}

export function readConfig(raw: string): Config {
  const data = JSON.parse(raw.replace(/^﻿/, "")) as Record<string, unknown>
  const e2e = data.e2e as Record<string, unknown> | undefined
  const apps = e2e ? appsOf(e2e) : undefined
  const worktree = data.worktree as Record<string, unknown> | undefined
  return {
    qa: strings(data.qa),
    integration: strings(data["qa-integration"]),
    setup: worktree && typeof worktree === "object" ? strings(worktree.setup) : [],
    e2e:
      e2e && apps
        ? {
            apps,
            production: strings(e2e.production),
            backends: strings(e2e.backends),
            timeout: typeof e2e.timeout === "number" ? e2e.timeout : undefined,
            model: text(e2e.model),
            effort: text(e2e.effort),
          }
        : undefined,
  }
}

// what the person approved of a config, kept at every freeze so the
// next approval question can show what changed: the commands and every e2e
// field (where e2e may go, as whom, how long, on which model).
export type ConfigView = {
  qa: string[]
  integration: string[]
  e2e?: { apps: Record<string, App>; production: string[]; backends: string[]; timeout?: number; model?: string; effort?: string }
}

export function viewOf(config: Config): ConfigView {
  const e2e = config.e2e
  const head = { qa: config.qa, integration: config.integration }
  if (!e2e) return head
  const { apps, production, backends, timeout, model, effort } = e2e
  return { ...head, e2e: { apps, production, backends, timeout, model, effort } }
}

// the lines that differ between the approved view and the file as it
// is now (undefined: it does not exist), one field per line. A file the
// hook cannot use shows why instead (checkConfig), not a diff of what it
// would read from it.
export function changeLines(path: string, before: ConfigView | undefined, now: string | undefined): string[] {
  if (now === undefined) return [path, "  (파일 없음)"]
  const bad = checkConfig(now)
  if (bad !== undefined) return [path, `  (쓸 수 없음: ${bad})`]
  const after = viewOf(readConfig(now))
  const show = (v: unknown) => (v === undefined ? "(없음)" : JSON.stringify(v))
  const fields: [string, (v: ConfigView) => unknown][] = [
    ["qa", v => v.qa],
    ["qa-integration", v => v.integration],
    ["e2e.apps", v => v.e2e?.apps],
    ["e2e.production", v => v.e2e?.production],
    ["e2e.backends", v => v.e2e?.backends],
    ["e2e.timeout", v => v.e2e?.timeout],
    ["e2e.model", v => v.e2e?.model],
    ["e2e.effort", v => v.e2e?.effort],
  ]
  const lines = fields
    .filter(([, get]) => before === undefined || show(get(before)) !== show(get(after)))
    .map(([name, get]) => (before === undefined ? `  ${name}: ${show(get(after))}` : `  ${name}: ${show(get(before))} → ${show(get(after))}`))
  const head = before === undefined ? `${path} (비교할 승인 기록 없음, 지금 내용)` : path
  return lines.length > 0 ? [head, ...lines] : [head, "  (qa·qa-integration·e2e 필드는 그대로, 그 밖의 필드만 바뀜)"]
}
