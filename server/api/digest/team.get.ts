import { readTeamDelivery, teamCommandsRefusal, buildTeamDigestNow, windowForTeam } from '../../utils/teamDelivery'
import { shouldSendTeam } from '../../utils/teamDigest'

/**
 * What the team digest is set to, and what it would say right now.
 *
 * The preview is the point. This message goes to a room other people are in, so
 * "what exactly will they read" has to be answerable before the first send and
 * before every scheduled one after it — and the answer is composed by the same
 * function the send uses, not by a second one that could drift.
 */
export default defineEventHandler(async () => {
  const state = await readTeamDelivery()
  const now = Date.now()
  const since = windowForTeam(state, now)
  const digest = await buildTeamDigestNow(since, now)
  const verdict = shouldSendTeam(digest)

  return {
    state,
    digest,
    /** Whether a scheduled send would go out, and why not when it would not. */
    wouldSend: verdict.send,
    because: verdict.send ? null : verdict.because,
    /** Always a refusal. Shown where somebody would look for the switch. */
    commands: teamCommandsRefusal(state),
  }
})
