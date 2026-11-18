import { describe, expect, test } from "claude-code/testing"
import { pastedImages, pasteName } from "../hooks/lib/brief.ts"
import { clock, DIR, grade, ran, relay, SPEC_TEXT, world } from "./world.ts"

// The images the user pastes into the run's main session are kept in the
// run folder's brief/ as paste-1.png, paste-2.png, … in paste order. They
// are only in the session's transcript, as base64 image blocks of the user's
// messages.

const at = (ms: number) => new Date(ms).toISOString()
const image = (data: string, type = "image/png") => ({ type: "image", source: { type: "base64", media_type: type, data } })
const user = (t: number, content: unknown, more: Record<string, unknown> = {}) => JSON.stringify({ type: "user", isSidechain: false, timestamp: at(t), message: { role: "user", content }, ...more })

// a transcript around a run opened at `open`: an older prompt with its own
// image, the /rein:spec prompt whose skill line carries the pasted image, a
// screenshot the session read (a tool's result), the request copy the engine
// keeps and a subagent's line.
const transcript = (open: number) => [
  user(open - 60_000, [{ type: "text", text: "이전 이야기" }, image("OLD")], { imagePasteIds: [1] }),
  user(open - 1000, "<command-message>rein:spec</command-message>\n<command-name>/rein:spec</command-name>"),
  user(open - 1000, [image("AAA"), { type: "text", text: "Base directory for this skill: …" }], { isMeta: true }),
  user(open - 500, [{ tool_use_id: "t1", type: "tool_result", content: [image("SHOT")] }]),
  JSON.stringify({ type: "api-request-blob", message: { role: "user", content: [image("AAA")] } }),
  user(open - 400, [image("SIDE")], { isSidechain: true }),
]

describe("pasted images", () => {
  test("from the prompt the run opened on, the user's own images in paste order; not a tool's result, an earlier prompt or a subagent's", () => {
    const open = Date.parse("2026-11-13T00:00:00Z")
    const later = user(open + 5000, [{ type: "text", text: "이것도 [Image #2]" }, image("BBB", "image/jpeg"), image("CCC", "image/webp")], { imagePasteIds: [2, 3] })
    expect(pastedImages([{ lines: [...transcript(open), later, "{broken"], since: open }])).toEqual([
      { mediaType: "image/png", data: "AAA" },
      { mediaType: "image/jpeg", data: "BBB" },
      { mediaType: "image/webp", data: "CCC" },
    ])
    // a session that took the run later counts from its own prompt; the sessions' images go by time.
    const other = [user(open - 9000, [image("EEE")]), user(open + 2000, [{ type: "text", text: "/rein:plan login-fix" }, image("DDD")])]
    expect(pastedImages([{ lines: [...transcript(open), later], since: open }, { lines: other, since: open + 2500 }]).map(i => i.data)).toEqual(["AAA", "DDD", "BBB", "CCC"])
    expect(pastedImages([{ lines: [], since: open }])).toEqual([])
  })

  test("each name's extension follows the image's type", () => {
    expect([pasteName(1, "image/png"), pasteName(2, "image/jpeg"), pasteName(3, "image/gif"), pasteName(4, "image/webp"), pasteName(5, "image/svg+xml")]).toEqual(["paste-1.png", "paste-2.jpg", "paste-3.gif", "paste-4.webp", "paste-5.png"])
  })

  test("saved in brief/ when the run opens, and the later ones as rein:collator starts and when 1-spec.md is approved; a name there already is kept", async ($, on) => {
    const files: Record<string, string> = { "C:/Users/u/.claude/projects/E--proj/s1.jsonl": "" }
    let lines: string[] = []
    const saved: { to: string; data: string | undefined }[] = []
    world(on, files, () => "승인", null, {
      run: (argv, _cwd, stdin, env) => {
        if (argv[0] !== "node") return { exitCode: 0 }
        if (env?.REIN_FILE === "C:/Users/u/.claude/projects/E--proj/s1.jsonl") return { exitCode: 0, stdout: `${lines.join("\n")}\n` }
        if (env?.REIN_TO !== undefined) {
          saved.push({ to: env.REIN_TO, data: stdin })
          files[env.REIN_TO] = "bytes"
        }
        return { exitCode: 0 }
      },
    })
    const open = clock.now()
    lines = transcript(open)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    expect(saved).toEqual([{ to: `${DIR}/brief/paste-1.png`, data: "AAA" }])
    // Node reads the transcript and writes the bytes: $.fs reads 4 MiB at most and writes text only.
    expect(ran.filter(x => x.argv[0] === "node" && x.argv[1] === "-e")).toHaveLength(2)
    lines = [...lines, user(open + 1000, [{ type: "text", text: "이 화면도" }, image("BBB", "image/jpeg")])]
    // the collator reads them, so they are saved before it starts.
    await $.agent.spawn({ tool_use_id: "c1", prompt: "collate", description: "collate", subagentType: "rein:collator" } as never)
    expect(saved).toEqual([{ to: `${DIR}/brief/paste-1.png`, data: "AAA" }, { to: `${DIR}/brief/paste-2.jpg`, data: "BBB" }])
    lines = [...lines, user(open + 2000, [{ type: "text", text: "마지막" }, image("CCC")])]
    files[`${DIR}/1-spec.md`] = SPEC_TEXT
    await grade($)
    await relay($, { tool: "mcp__rein__advance" } as never)
    expect(saved).toEqual([{ to: `${DIR}/brief/paste-1.png`, data: "AAA" }, { to: `${DIR}/brief/paste-2.jpg`, data: "BBB" }, { to: `${DIR}/brief/paste-3.png`, data: "CCC" }])
  })

  test("with no transcript found nothing is run", async ($, on) => {
    world(on, {}, undefined, null)
    await $.tool.call({ tool: "mcp__rein__open_run", runId: "login-fix" } as never)
    expect(ran.filter(x => x.argv[0] === "node" && x.argv[1] === "-e")).toEqual([])
  })
})
