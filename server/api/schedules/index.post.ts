import {
  describeSchedule,
  projectDirForSave,
  upsertSchedule,
  type Schedule,
} from '../../utils/schedules'
import { getProjectDir } from '../../utils/scope'
import type { EventTrigger } from '../../utils/eventTriggers'
import type { ChainStep } from '../../utils/ritualChain'

export default defineEventHandler(async (event) => {
  // `projectDir`, `trigger` and `steps` are all nullable on the way in: null
  // clears, absent keeps. See projectDirForSave.
  const body = await readBody<
    Partial<Omit<Schedule, 'projectDir' | 'trigger' | 'steps'>>
    & { projectDir?: string | null; trigger?: EventTrigger | null; steps?: ChainStep[] | null }
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
