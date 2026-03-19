export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)

  if (!url) {
    throw createError({ statusCode: 400, message: 'URL is required' })
  }

  const { stdout } = await runClaude(['plugin', 'marketplace', 'add', url])
  return { success: true, output: stdout || 'Marketplace added successfully' }
})
