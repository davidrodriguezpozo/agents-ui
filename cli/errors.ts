import { errorMessage, isOffline } from '~/utils/errors'

/**
 * The sentence to show for a thrown thing.
 *
 * The server reports failures in several shapes and `errorMessage` is the
 * tested place that knows all of them. `isOffline` is the one case worth
 * rewording: "fetch failed" means the server has gone, and that is actionable.
 */
export function describeError(error: unknown): string {
  return isOffline(error)
    ? 'Lost the server. It may have stopped — check `agents-studio status`.'
    : errorMessage(error)
}
