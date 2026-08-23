import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { IMAGE_MEDIA_TYPES, type ModelImage } from '~/utils/imageAttachments'
import type { ChatAttachmentRef } from '~/types'

/**
 * Images belonging to a message that is waiting rather than being sent.
 *
 * A turn that goes now needs no help from this file: the bytes arrive on the
 * request, travel through `startTurn` in memory and reach the CLI on the run's
 * opening message. The queue is the other case, and the queue is the reason
 * this exists — it is the one thing here deliberately built to outlive the tab,
 * the navigation and the laptop lid, because the turn it waits for runs on the
 * server and survives all three. Images held in memory would not, and a
 * screenshot that quietly vanished between typing a message and it being sent
 * is worse than one that was refused.
 *
 * So the bytes go on disk and the session record keeps only what a chip needs:
 * a name, a type and a size. Not an optimisation — `sessions.json` is rewritten
 * on every status change and every queue operation, and a few megabytes of
 * base64 per screenshot in a file on that path would make the queue expensive
 * to touch at all.
 *
 * Not in the worktree, which is the other place bytes could go. A worktree is
 * the session's diff; a screenshot dropped into a composer is not a change to
 * the code, and putting it there means it shows up in the review and can be
 * committed by the very agent it was shown to.
 */

function attachmentsDir(sessionId: string): string {
  return join(getClaudeDir(), 'agents-ui', 'queued-attachments', segment(sessionId))
}

/** Ids are ours, but they end up as path segments, so they are held to one. */
function segment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * `.bin` rather than `.png`, deliberately. Nothing reads these files except
 * `loadQueuedAttachments`, which is handed the type from the record beside the
 * file — and a filename that would have to be parsed to be trusted is a second
 * copy of a fact that already has an owner.
 */
function filePath(sessionId: string, id: string): string {
  return join(attachmentsDir(sessionId), `${segment(id)}.bin`)
}

/**
 * Put a message's images on disk and hand back what the record should hold.
 *
 * A failed write is not fatal to the message. The sentence someone typed is the
 * part they care about most, and losing it because a screenshot could not be
 * saved would be the wrong trade — the image is dropped, the message is queued,
 * and the row shows one fewer chip than they attached.
 */
export async function storeQueuedAttachments(
  sessionId: string,
  messageId: string,
  images: ModelImage[],
): Promise<ChatAttachmentRef[]> {
  if (!images.length) return []

  const stored: ChatAttachmentRef[] = []
  await mkdir(attachmentsDir(sessionId), { recursive: true })

  for (const [index, image] of images.entries()) {
    const id = `${segment(messageId)}-${index}`
    const bytes = Buffer.from(image.data, 'base64')

    try {
      await writeFile(filePath(sessionId, id), bytes)
      stored.push({ id, name: image.name, mediaType: image.mediaType, size: bytes.byteLength })
    } catch (e) {
      console.error(`[queuedAttachments] could not save ${image.name}`, e)
    }
  }

  return stored
}

/**
 * Read a waiting message's images back, ready to hand to the model.
 *
 * A reference whose file is gone is skipped rather than thrown: the directory is
 * swept when a session is deleted and when a queue is dropped, and a message
 * that raced one of those still has text worth sending. The media type comes
 * from the record and is checked against the list the model accepts, so a
 * hand-edited `sessions.json` cannot put an arbitrary string in an API request.
 */
export async function loadQueuedAttachments(
  sessionId: string,
  refs: ChatAttachmentRef[] | undefined,
): Promise<ModelImage[]> {
  if (!refs?.length) return []

  const images: ModelImage[] = []

  for (const ref of refs) {
    if (!IMAGE_MEDIA_TYPES.includes(ref.mediaType)) continue

    const path = filePath(sessionId, ref.id)
    if (!existsSync(path)) continue

    try {
      images.push({
        name: ref.name,
        mediaType: ref.mediaType,
        data: (await readFile(path)).toString('base64'),
      })
    } catch (e) {
      console.error(`[queuedAttachments] could not read ${ref.name}`, e)
    }
  }

  return images
}

/**
 * Forget a message's images — it has been sent, or taken back out of the queue.
 *
 * Called after the bytes are in memory and the turn has started rather than
 * before, so a turn that could not start leaves the queue exactly as it was:
 * `flushQueue` puts the message back, and the files it points at are still
 * there to be read on the next attempt.
 */
export async function dropQueuedAttachments(
  sessionId: string,
  refs: ChatAttachmentRef[] | undefined,
): Promise<void> {
  for (const ref of refs ?? []) {
    await rm(filePath(sessionId, ref.id), { force: true }).catch(() => {})
  }
}

/**
 * Everything this session was still holding. The session is gone, or its queue
 * has been dropped because nothing in it could ever send.
 */
export async function clearQueuedAttachments(sessionId: string): Promise<void> {
  await rm(attachmentsDir(sessionId), { recursive: true, force: true }).catch(() => {})
}

/**
 * How many files are sitting under a session, for a test to assert on and for
 * anyone wondering whether this cleans up after itself.
 */
export async function countQueuedAttachments(sessionId: string): Promise<number> {
  try {
    return (await readdir(attachmentsDir(sessionId))).length
  } catch {
    return 0
  }
}
