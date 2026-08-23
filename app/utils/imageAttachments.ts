import { base64Bytes, toBase64 } from '~/utils/base64'
import type { ChatAttachment, ChatMessage, ImageMediaType } from '~/types'

/**
 * Images attached to a chat turn.
 *
 * The composer could only send a string, which is all a text prompt is: a
 * screenshot of the thing you were asking about had to be described in words,
 * or saved somewhere and named in the hope the Read tool was allowed. Claude
 * Code takes a pasted image directly, and this is the same deal — the bytes
 * travel with the message and the model looks at them.
 *
 * Both ends share this file deliberately. The browser decides what it will let
 * you attach and the server decides what it will hand to the model; when those
 * were two lists, the second one is the one that would have drifted, and the
 * failure it produces is a request the API rejects for a reason the user never
 * sees.
 */

/** What the model will look at. Anything else is not an image to it. */
export const IMAGE_MEDIA_TYPES: ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/**
 * The same set by extension, because a file dragged in from some places — and
 * anything picked out of a zip or a clipboard that did not label itself —
 * arrives with an empty `type`.
 */
const EXTENSION_TYPES: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/**
 * Per image. The API refuses a request carrying more than about 5MB of image,
 * and refusing it here means one clear sentence in the composer instead of a
 * failed turn.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Per message. A screenshot or three is the case; twenty is a mistake. */
export const MAX_IMAGES_PER_MESSAGE = 5

/**
 * A file as both ends see it. Structural rather than `File` so the server can
 * import this module without the DOM, and so a test can pass a plain object.
 */
export interface PickedImage {
  name: string
  type: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface RejectedImage {
  name: string
  /** Reads after "Skipped <name> — ", so it is a phrase, not a sentence. */
  reason: string
}

/**
 * The media type to send for this file, or null if it is not an image the model
 * accepts. The browser's `type` is trusted first and the extension is the
 * fallback; `image/jpg` is not a real media type but clipboards and older
 * tools produce it, so it is read as JPEG rather than refused.
 */
export function imageMediaType(file: { name?: string; type?: string }): ImageMediaType | null {
  const type = (file.type || '').trim().toLowerCase()
  if (type === 'image/jpg') return 'image/jpeg'
  if ((IMAGE_MEDIA_TYPES as string[]).includes(type)) return type as ImageMediaType

  const ext = (file.name || '').toLowerCase().split('.').pop() ?? ''
  return EXTENSION_TYPES[ext] ?? null
}

/**
 * Split what was dropped, pasted or picked into what will be sent and what will
 * not, with a reason for each refusal.
 *
 * `alreadyAttached` is counted against the per-message limit, so dropping three
 * images onto a composer that already holds four refuses the last two rather
 * than silently building a message the API will reject.
 */
export function acceptImages(
  files: PickedImage[],
  alreadyAttached = 0,
): { accepted: PickedImage[]; rejected: RejectedImage[] } {
  const accepted: PickedImage[] = []
  const rejected: RejectedImage[] = []

  for (const file of files) {
    const name = file.name || 'image'

    if (!imageMediaType(file)) {
      rejected.push({ name, reason: 'not a PNG, JPEG, GIF or WebP image' })
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      rejected.push({ name, reason: `over ${MAX_IMAGE_BYTES / 1024 / 1024}MB` })
      continue
    }
    if (alreadyAttached + accepted.length >= MAX_IMAGES_PER_MESSAGE) {
      rejected.push({ name, reason: `over ${MAX_IMAGES_PER_MESSAGE} images in one message` })
      continue
    }

    accepted.push(file)
  }

  return { accepted, rejected }
}

/** Read one accepted file into the attachment the composer holds and sends. */
export async function readImageAttachment(file: PickedImage): Promise<ChatAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // A pasted image has no name of its own in some browsers, and an unnamed
    // chip is worse than a generic one.
    name: file.name || 'pasted image',
    mediaType: imageMediaType(file) ?? 'image/png',
    size: bytes.byteLength,
    data: toBase64(bytes),
  }
}

/** What the model is actually handed: the bytes and what they are. */
export interface ModelImage {
  name: string
  mediaType: ImageMediaType
  /** Base64, no data-URL prefix. */
  data: string
}

/**
 * The same rules again, on a request body this time.
 *
 * The browser has already applied them, which is exactly why this exists: the
 * endpoint is reachable by anything, and what it forwards ends up in a paid
 * API call. Anything unrecognised is dropped rather than rejected — a bad
 * attachment should not lose the sentence it came with.
 */
export function sanitiseAttachments(raw: unknown): ModelImage[] {
  if (!Array.isArray(raw)) return []

  const images: ModelImage[] = []

  for (const item of raw) {
    if (images.length >= MAX_IMAGES_PER_MESSAGE) break
    if (!item || typeof item !== 'object') continue

    const candidate = item as { name?: unknown; mediaType?: unknown; data?: unknown }
    if (typeof candidate.data !== 'string') continue

    const name = typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'image'
    const mediaType = imageMediaType({
      name,
      type: typeof candidate.mediaType === 'string' ? candidate.mediaType : '',
    })
    if (!mediaType) continue

    const data = stripDataUrl(candidate.data)
    if (!data || !BASE64.test(data)) continue
    if (base64Bytes(data) > MAX_IMAGE_BYTES) continue

    images.push({ name, mediaType, data })
  }

  return images
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Tolerate a data URL. Nothing here sends one, but `canvas.toDataURL` and every
 * paste helper on the web produce them, so accepting one costs a line and
 * refusing it costs an afternoon.
 */
function stripDataUrl(data: string): string {
  const clean = data.replace(/\s+/g, '')
  const comma = clean.indexOf(',')
  return clean.startsWith('data:') && comma !== -1 ? clean.slice(comma + 1) : clean
}

/** `1.2MB`, for a chip that has room for about that much. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** `data:` URL for showing an attachment the browser still holds the bytes of. */
export function attachmentSrc(attachment: ChatAttachment): string | null {
  return attachment.data ? `data:${attachment.mediaType};base64,${attachment.data}` : null
}

/**
 * A message as it is written to history: attachments keep their name, type and
 * size, and lose their bytes.
 *
 * A conversation is saved again on every turn, so leaving the base64 in would
 * rewrite a few megabytes per screenshot each time and turn a history file
 * anyone can read into one nobody can. What is kept is what the record is for —
 * that this turn had two images on it, and what they were called.
 */
export function withoutImageBytes(message: ChatMessage): ChatMessage {
  if (!message.attachments?.length) return message

  return {
    ...message,
    attachments: message.attachments.map(({ data: _data, ...rest }) => rest),
  }
}
