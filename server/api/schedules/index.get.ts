import { describeRecurrence, readSchedules } from '../../utils/schedules'

export default defineEventHandler(async () => {
  const schedules = await readSchedules()

  return schedules
    .map(s => ({ ...s, description: describeRecurrence(s.recurrence) }))
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
})
