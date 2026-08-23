import { sessionStore, type Session } from './sessions'
import {
  clearQueuedAttachments, dropQueuedAttachments, storeQueuedAttachments,
} from './queuedAttachments'
import type { ModelImage } from '~/utils/imageAttachments'
import type { ChatAttachmentRef } from '~/types'

/**
 * What you typed while it was still working.
 *
 * A session takes one turn at a time — two agents in one worktree is the exact
 * problem sessions exist to prevent — and the composer said so by going dead
 * for the whole of a turn. Which is precisely when you have something to add:
 * the thing you forgot, the correction you thought of watching it go the wrong
 * way, the next step you already know follows. All of it had to be held in your
 * head until the turn ended, and a five-minute turn means you are back to
 * watching a progress bar so you do not forget your own sentence.
 *
 * So the box stays live and what you write waits here instead, and goes as its
 * own turn the moment the running one finishes. The queue lives
 * on the session record rather than in the page: the turn it is waiting for
 * runs on the server and outlasts the tab, so a message held in a component
 * would be lost by the reload, the navigation, or the laptop lid that the run
 * itself survives.
 *
 * This module owns the queue and nothing else. It never starts a turn —
 * `sessionTurn` owns that, and keeping the dependency one-directional is what
 * stops "a turn ends, so flush, so a turn starts" from becoming a circular
 * import.
 *
 * It owns one more thing by consequence: where a waiting message's images live.
 * A turn that goes now carries its bytes in memory and needs nothing from disk,
 * so persisting them is the queue's problem and nobody else's — see
 * `queuedAttachments`, and note that every path out of the queue below deletes
 * what it took.
 */

export interface QueuedMessage {
  /**
   * Stable for as long as it waits, so the row that shows it can be the row
   * that removes it. Position cannot do that job: the queue shifts underneath
   * the page every time a turn ends.
   */
  id: string
  text: string
  at: number
  /**
   * Images attached to this message, by name and type only. The bytes are in
   * `queuedAttachments`, keyed by these ids — a session record carrying a few
   * megabytes of base64 would be one nothing could afford to write, and this is
   * written on every turn.
   */
  attachments?: ChatAttachmentRef[]
}

function messageId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Every write goes through `sessionStore.update` rather than read-then-patch.
 *
 * The queue is the one field on a session written from both ends at once — you
 * add to the back while a turn that has just ended takes from the front — and
 * a read-modify-write of the whole array is how one of the two silently loses.
 */
export async function queueMessage(
  id: string,
  text: string,
  images: ModelImage[] = [],
): Promise<QueuedMessage | null> {
  const trimmed = text.trim()

  // An image with nothing typed under it is a whole message — it is what
  // dropping a screenshot in already said — so emptiness is about both.
  if (!trimmed && !images.length) return null

  const messageKey = messageId()
  const message: QueuedMessage = {
    id: messageKey,
    text: trimmed,
    at: Date.now(),
    // Written before the record so the record never points at bytes that are
    // not there yet. The other order has a window in which a flush finds a
    // reference to a file still being written.
    attachments: await storeQueuedAttachments(id, messageKey, images),
  }

  const queued = await sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const session = sessions[index]!
    sessions[index] = {
      ...session,
      queued: [...(session.queued ?? []), message],
      updatedAt: Date.now(),
    }
    return message
  })

  // No such session. The files would otherwise sit under an id nothing will
  // ever look up again.
  if (!queued) await dropQueuedAttachments(id, message.attachments)

  return queued
}

/** Take the next message off the front. Null when there is nothing waiting. */
export async function takeQueuedMessage(id: string): Promise<QueuedMessage | null> {
  return sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const session = sessions[index]!
    const [next, ...rest] = session.queued ?? []
    if (!next) return null

    sessions[index] = { ...session, queued: rest, updatedAt: Date.now() }
    return next
  })
}

/**
 * Put a message back at the front, having failed to send it.
 *
 * It is still the next thing you meant to say, and the reasons sending fails
 * here — a turn that started underneath the flush, the day's budget spent — are
 * ones the queue can wait out. Losing the sentence instead would be the worst
 * of the options: it was typed, it was accepted, and nothing would say where
 * it went.
 */
export async function requeueMessage(id: string, message: QueuedMessage): Promise<void> {
  await sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const session = sessions[index]!
    sessions[index] = {
      ...session,
      queued: [message, ...(session.queued ?? [])],
      updatedAt: Date.now(),
    }
    return message
  })
}

/** Remove one waiting message — you changed your mind about it. */
export async function dropQueuedMessage(id: string, messageId: string): Promise<Session | null> {
  const dropped = await sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const session = sessions[index]!
    const going = (session.queued ?? []).find(m => m.id === messageId)
    sessions[index] = {
      ...session,
      queued: (session.queued ?? []).filter(m => m.id !== messageId),
      updatedAt: Date.now(),
    }
    return { session: sessions[index]!, going }
  })

  if (!dropped) return null

  // After the record, not before: a file deleted first and then a write that
  // fails leaves a row pointing at nothing.
  await dropQueuedAttachments(id, dropped.going?.attachments)

  return dropped.session
}

export async function clearQueue(id: string): Promise<Session | null> {
  const cleared = await sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const session = sessions[index]!
    if (!session.queued?.length) return session

    sessions[index] = { ...session, queued: [], updatedAt: Date.now() }
    return sessions[index]!
  })

  // The whole directory rather than a file per message: the queue is empty, so
  // anything left under it belongs to nothing.
  if (cleared) await clearQueuedAttachments(id)

  return cleared
}
