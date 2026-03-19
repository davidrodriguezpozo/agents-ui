export default defineEventHandler(async (event) => {
  const { marketplace, plugin } = await readBody<{ marketplace: string; plugin: string }>(event)

  if (!marketplace || !plugin) {
    throw createError({ statusCode: 400, message: 'marketplace and plugin are required' })
  }

  const { stdout } = await runClaude(['plugin', 'add', `${marketplace}/${plugin}`])
  return { success: true, output: stdout || 'Plugin installed successfully' }
})
