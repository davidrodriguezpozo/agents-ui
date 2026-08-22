import { collectAttention } from '../utils/attention'

export type { Attention, AttentionItem, AttentionKind } from '../utils/attention'

/**
 * What, if anything, wants you.
 *
 * One small endpoint the whole app can poll, so the sidebar can say "one needs
 * you" rather than "six agents exist". Counting how much you own is not a
 * reason to look at a page; being blocked is.
 *
 * It returns the items and not only the tally, and that is the point. The Now
 * queue used to be assembled from `/api/digest`, which reports on a *window* —
 * so a ritual that broke before the window began was counted by this endpoint
 * and missing from the queue, and the sidebar said "3" over a screen that said
 * "nothing is waiting on you". A badge that contradicts the view it points at is
 * worse than no badge. Both now read one payload and cannot disagree.
 *
 * The derivation is in `utils/attention.ts` because the MCP server's `blocked`
 * tool has to give the same answer this does.
 */
export default defineEventHandler(() => collectAttention())
