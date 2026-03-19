export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name: string }>(event)

  if (!name) {
    throw createError({ statusCode: 400, message: 'Marketplace name is required' })
  }

  const { stdout } = await runClaude(['plugin', 'marketplace', 'update', name])
  return { success: true, output: stdout || 'Marketplace updated successfully' }
})
