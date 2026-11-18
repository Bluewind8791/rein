// a text with its line endings as LF. An editor that opens a frozen
// file may write its CRLF back as LF (Obsidian does); the words are the same,
// so it is no change.
export const eol = (text: string): string => text.replace(/\r\n/g, "\n")

// the lines that differ from `before` to `after`, in order, "- " for a
// line only in before and "+ " for one only in after (a longest common
// subsequence of lines). Line endings do not count. Empty when the lines are
// the same.
export function lineDiff(before: string, after: string): string[] {
  const a = eol(before).split("\n")
  const b = eol(after).split("\n")
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const at = (i: number, j: number) => common[i]![j]!
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) common[i]![j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (j >= b.length || (i < a.length && at(i + 1, j) >= at(i, j + 1))) {
      out.push(`- ${a[i++]}`)
    } else {
      out.push(`+ ${b[j++]}`)
    }
  }
  return out
}
