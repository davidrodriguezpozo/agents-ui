export default defineEventHandler(async (event) => {
  const { plugin } = await readBody<{ plugin: string }>(event)

  if (!plugin) {
    throw createError({ statusCode: 400, message: 'plugin name is required' })
  }

  const { stdout } = await runClaude(['plugin', 'remove', plugin])
  return { success: true, output: stdout || 'Plugin removed successfully' }
})
