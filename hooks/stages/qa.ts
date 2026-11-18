import { quoted } from "../lib/quote.ts"
import type { QaFailure, Run } from "../lib/state.ts"

const TAIL = 1500

export type CommandResult = { root: string; cmd: string; exit: number; out: string }

// what ran and how it ended, and the tail of the first failure's
// output, cut mechanically; the hook cannot pick out the failing part.
export function commandReport(results: CommandResult[]): string {
  const lines = results.map(r => `- \`${r.cmd}\` (${r.root}) — exit ${r.exit}`)
  const tail = failedTail(results)
  return tail === undefined ? lines.join("\n") : `${lines.join("\n")}\n\n${tail}`
}

// the tail of the first failure's output as a code block; undefined when
// all passed.
export function failedTail(results: CommandResult[]): string | undefined {
  const failed = results.find(r => r.exit !== 0)
  if (!failed) return undefined
  const out = failed.out.trimEnd()
  const tail = out.length > TAIL ? `…${out.slice(-TAIL)}` : out
  return `\`\`\`\n${tail}\n\`\`\``
}

// the first failing command of a hook rerun, with the tail the person
// sees in the next rerun question; undefined when all passed.
const QUESTION_TAIL = 600
export function failureOf(results: CommandResult[]): QaFailure | undefined {
  const failed = results.find(r => r.exit !== 0)
  if (!failed) return undefined
  const out = failed.out.trimEnd()
  return { root: failed.root, cmd: failed.cmd, exit: failed.exit, tail: out.length > QUESTION_TAIL ? `…${out.slice(-QUESTION_TAIL)}` : out }
}

// what the person judges a rerun by: the failing hook run of this
// visit (asked only after one) and how many advance reruns this visit
// has had.
export function rerunQuestion(run: Run): string {
  const f = run.qaFailure
  const failure = f ? `\n\n이번 qa에서 훅이 마지막으로 돌린 결과 실패한 명령:\n\`${f.cmd}\` (${f.root}) — exit ${f.exit}\n출력:\n${quoted(f.tail)}` : ""
  return `qa 명령을 다시 돌릴까요? 이번 qa의 advance 재실행: ${run.qaVisit?.reruns ?? 0}회.${failure}`
}

// the whole output of each failing command of a hook run, in the run
// folder for the qa agent to read the failure from; each cut to its
// last OUTPUT_MAX characters.
export const OUTPUT_FILE = "agent/qa-output.log"
const OUTPUT_MAX = 256 * 1024
export function outputLog(results: CommandResult[]): string {
  return results
    .filter(r => r.exit !== 0)
    .map(r => {
      const out = r.out.trimEnd()
      return `$ ${r.cmd}  (${r.root}) — exit ${r.exit}\n${out.length > OUTPUT_MAX ? `…${out.slice(-OUTPUT_MAX)}` : out}\n`
    })
    .join("\n")
}

// the failure the hook adds when a config it had frozen changed while
// its commands ran, by the code under test or by hand: the run does not
// pass and goes back to dev as any failing qa does.
export function rewrote(paths: string[]): CommandResult {
  const root = paths[0]!.replace(/\/\.rein\/config\.json$/, "")
  const out = `config changed while the commands ran (by the code or by hand): ${paths.join(", ")} (D120). A run whose checks changed under it does not pass; the config is left as it is, and at the next qa the user approves it or not (D200).`
  return { root, cmd: ".rein/config.json unchanged", exit: 1, out }
}

// e2e.backends became required, so a config written before that is
// refused in qa too; say what to add and who may add it.
export function backendsHint(problem: string): string {
  return problem.includes("e2e.backends")
    ? " `e2e.backends` is required since D142 (the hosts the app sends requests to): /rein:setup adds it, and the user approves the changed config at the next advance (D176)."
    : ""
}

// the last hook run of this qa visit failed, so qa.md may report it.
// A pass clears failed; `passed` is checked too, since a record from before
// an older version could keep failed after a passing rerun.
export const failedRun = (run: Run): boolean => run.qaVisit?.failed === true && !run.qaVisit.passed

