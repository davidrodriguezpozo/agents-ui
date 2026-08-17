import { briefIsEmpty, readBrief, refreshBrief, renderBrief } from '../utils/brief'
import { getProjectDir } from '../utils/scope'

/**
 * What every run is being told, exactly as it is told it.
 *
 * Rebuilt before it is read rather than served from the last poll. It is local
 * file reads and costs nothing, and the alternative is a panel that shows a
 * two-minute-old version of the one thing whose whole job is being current —
 * somebody who closes a session and reloads this page should not still see it
 * listed.
 *
 * The rendered text is returned alongside the facts because it *is* the feature:
 * a panel that paraphrases what runs receive is a panel that can be wrong about
 * it. The way to know what a run is handed is to read the thing a run is handed.
 */
export default defineEventHandler(async (event) => {
  const projectDir = getProjectDir(event) ?? undefined
  const brief = (await refreshBrief()) ?? (await readBrief())

  return {
    ...brief,
    projectDir,
    /** Empty when there is nothing to say — which is what a run gets too. */
    text: briefIsEmpty(brief) ? '' : renderBrief(brief, { projectDir }),
  }
})
