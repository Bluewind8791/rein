import type { StageSpec } from "../lib/state.ts"

// The write rule for a stage the hook does not know (a run stored by another version):
// no write goes through until the run is back on a known stage.
export const unbuilt: StageSpec = {
  write(_path, c) {
    return { deny: `D46: the hook does not know the ${c.run.stage} stage, so it refuses every write.` }
  },
}
