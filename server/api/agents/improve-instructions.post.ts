import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeExecutable } from '../../utils/claudeExecutable'
import { parseJsonFromReply } from '../../utils/extractJson'

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
        pathToClaudeCodeExecutable: claudeExecutable(),
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

  // Improvement mode answers in JSON, which the model may have fenced or
  // wrapped in commentary. Both are readable; what is not is being handed the
  // whole reply as though it were the instructions.
  const parsed = parseJsonFromReply<Partial<ImproveResponse>>(resultText)

  if (typeof parsed?.improvedInstructions === 'string' && parsed.improvedInstructions.trim()) {
    return {
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      improvedInstructions: parsed.improvedInstructions.trim(),
    }
  }

  // Refuse rather than fall back to the raw reply. What the caller does with
  // this is write it into the agent's instructions on one click — so a reply
  // we could not read must fail visibly, not arrive looking like an answer.
  throw createError({
    statusCode: 502,
    message: 'Claude replied with something this could not read as suggestions. Try again.',
  })
})
