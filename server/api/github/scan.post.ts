import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)

  if (!url || typeof url !== 'string') {
    throw createError({
      statusCode: 400,
      data: { error: 'invalid_url', message: 'A GitHub URL is required' },
    })
  }

  const parsed = parseGithubUrl(url.trim())
  if (!parsed) {
    throw createError({
      statusCode: 400,
      data: { error: 'invalid_url', message: 'Could not parse GitHub URL. Expected format: https://github.com/owner/repo' },
    })
  }

  const branch = parsed.branch || await getDefaultBranch(parsed.owner, parsed.repo)
  const { skills, detectionMethod } = await detectSkills(parsed.owner, parsed.repo, branch, parsed.path)

  if (skills.length === 0) {
    throw createError({
      statusCode: 404,
      data: { error: 'no_skills', message: 'No valid skill files found at this location' },
    })
  }

  // Check for conflicts with existing local skills
  const skillsWithConflicts = skills.map(s => ({
    ...s,
    conflict: existsSync(resolveClaudePath('skills', s.slug, 'SKILL.md')),
  }))

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    targetPath: parsed.path || '',
    skills: skillsWithConflicts,
    detectionMethod,
  }
})
