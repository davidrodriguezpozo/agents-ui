import { query } from '@anthropic-ai/claude-agent-sdk'

interface ImproveRequest {
  name: string
  description: string
  currentInstructions: string
}

interface Suggestion {
  type: string
  description: string
  original: string
  suggested: string
}

interface ImproveResponse {
  suggestions: Suggestion[]
  improvedInstructions: string
}

export default defineEventHandler(async (event): Promise<ImproveResponse> => {
  const body = await readBody<ImproveRequest>(event)

  if (!body.name) {
    throw createError({ statusCode: 400, message: 'name is required' })
  }

  const isGeneration = !body.currentInstructions?.trim()

  const prompt = isGeneration
    ? `Generate instructions for an AI agent named "${body.name}" described as: "${body.description}". Write clear, specific instructions that tell the agent what to do, how to behave, and what constraints to follow. Return ONLY the instructions text, no JSON or metadata.`
    : `Review and improve these instructions for an AI agent named "${body.name}" (${body.description}):\n\n${body.currentInstructions}\n\nReturn a JSON object with this exact shape:\n{"suggestions": [{"type": "specificity|clarity|completeness|tone", "description": "what to improve", "original": "original text", "suggested": "improved text"}], "improvedInstructions": "full improved instructions"}\n\nReturn ONLY valid JSON, nothing else.`

  let resultText = ''

  try {
    for await (const message of query({
      prompt,
      options: {
        maxTurns: 1,
        allowedTools: [],
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: 'You are helping improve agent instructions. Be concise and actionable.',
        },
      },
    })) {
      if ('result' in message) {
        resultText = message.result
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to call Claude'
    throw createError({ statusCode: 500, message: msg })
  }

  if (!resultText) {
    throw createError({ statusCode: 500, message: 'No response from Claude' })
  }

  // For generation mode, return raw text
  if (isGeneration) {
    return { suggestions: [], improvedInstructions: resultText.trim() }
  }

  // For improvement mode, try to parse JSON
  try {
    const parsed = JSON.parse(resultText) as ImproveResponse
    if (parsed.improvedInstructions && Array.isArray(parsed.suggestions)) {
      return parsed
    }
  } catch {
    // Malformed JSON fallback: return raw text
  }

  return { suggestions: [], improvedInstructions: resultText.trim() }
})
