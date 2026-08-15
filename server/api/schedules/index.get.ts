import { describeSchedule, readSchedules } from '../../utils/schedules'
import { deadRulesFor } from '../../utils/deadRules'

export default defineEventHandler(async () => {
  const schedules = await readSchedules()

  /*
   * Which of a ritual's granted rules cannot do anything.
   *
   * A rule for an MCP tool the run cannot reach looks exactly like one that
   * works — same green shield, same wording — and the only way to find out
   * otherwise was a morning that came to nothing. This is the same judgement
   * the digest makes after a refusal, moved to where the rules are listed and
   * where each one already has a button to take it off.
   *
   * Attached here rather than stored, because it is a fact about the machine
   * now and not about the ritual: signing a server in should make the warning
   * go away without anything being rewritten.
   */
  const dead = await deadRulesFor(schedules)

  return schedules
    .map(s => ({
      ...s,
      description: describeSchedule(s),
      deadRules: dead.get(s.id),
    }))
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
})
