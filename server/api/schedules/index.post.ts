import {
  describeSchedule,
  projectDirForSave,
  upsertSchedule,
  type Schedule,
} from '../../utils/schedules'
import { getProjectDir } from '../../utils/scope'
import type { EventTrigger } from '../../utils/eventTriggers'

export default defineEventHandler(async (event) => {
  // `projectDir` and `trigger` are both nullable on the way in: null clears,
  // absent keeps. See projectDirForSave.
  const body = await readBody<
    Partial<Omit<Schedule, 'projectDir' | 'trigger'>>
    & { projectDir?: string | null; trigger?: EventTrigger | null }
  >(event)

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

  return { ...schedule, description: describeSchedule(schedule) }
})
