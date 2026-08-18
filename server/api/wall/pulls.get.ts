import { readWallPulls } from '../../utils/wallPulls'

/**
 * The pull requests waiting on you, everywhere on this machine.
 *
 * Held for a minute in `wallPulls.ts`, so this handler is free to call at the
 * wall's own poll rate and costs `gh` only when the reading has expired.
 * `?force=1` is the refresh button: somebody standing in front of the screen who
 * has just merged something is allowed to not wait out the minute.
 */
export default defineEventHandler(async (event) => {
  const force = String(getQuery(event).force ?? '') === '1'
  return readWallPulls({ force })
})
