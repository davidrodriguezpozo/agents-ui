import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ModelImage } from '~/utils/imageAttachments'

/**
 * The prompt for one chat turn — the text, plus any images attached to it.
 *
 * `query({ prompt })` takes a string, and a string cannot carry a screenshot.
 * Its other shape is an async iterable of user messages, whose content is a
 * block list, and that is the only way to put an image in front of the model
 * without first writing it to disk and hoping Read is allowed there.
 *
 * A turn with no images still goes as a plain string. Not caution — the SDK
 * writes a string prompt to the CLI as exactly this message with one text
 * block, so the two paths meet immediately — but a string also marks the query
 * as a single user turn, which is how the SDK knows to close stdin as soon as
 * the result arrives. Handing it a one-message iterable instead makes it wait
 * for the first result and then close, which is the same ending by a longer
 * road. Nothing is bought by taking that road on every message.
 *
 * Images come before the text in the block list, which is what Anthropic's own
 * guidance asks for: the question reads as being about the images above it.
 */
export function chatPrompt(text: string, images: ModelImage[]): string | AsyncIterable<SDKUserMessage> {
  if (!images.length) return text

  return oneTurn(userTurn(text, images))
}

/**
 * The message itself, split out so a test can look at the blocks without
 * draining an iterator.
 *
 * `session_id` is empty on the way in — this is the same value the SDK writes
 * for a string prompt, and the CLI is what assigns the real one. Which session
 * is resumed is a `query` option, not a field on the message.
 */
export function userTurn(text: string, images: ModelImage[]): SDKUserMessage {
  return {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        ...images.map(image => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mediaType,
            data: image.data,
          },
        })),
        // An image on its own is a complete message — "look at this" is what
        // dropping it in said — so an empty text block is left off rather than
        // sent as one the model has to interpret.
        ...(text.trim() ? [{ type: 'text' as const, text }] : []),
      ],
    },
  }
}

async function* oneTurn(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
  yield message
}
