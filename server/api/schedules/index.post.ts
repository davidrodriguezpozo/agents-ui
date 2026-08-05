import {
  describeRecurrence,
  projectDirForSave,
  upsertSchedule,
  type Schedule,
} from '../../utils/schedules'
import { getProjectDir } from '../../utils/scope'

export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<Schedule>>(event)

  if (!body?.input?.trim()) {
    throw createError({ statusCode: 400, message: 'input is required' })
  }
  if (!body.title?.trim()) {
    throw createError({ statusCode: 400, message: 'title is required' })
  }

  const schedule = await upsertSchedule({
    ...body,
    input: body.input.trim(),
    title: body.title.trim(),
    projectDir: projectDirForSave(body, getProjectDir(event)),
  })

  return { ...schedule, description: describeRecurrence(schedule.recurrence) }
})
