/**
 * Whether a scrolling column is at its end.
 *
 * One line of arithmetic, extracted because it is the whole of a decision and it
 * is easy to get backwards — and getting it backwards is not a visible bug. It
 * is a transcript that stops following a live turn, or one that yanks you back
 * to the bottom while you are reading something four turns up. Both read as the
 * page being flaky rather than as a comparison written the wrong way round.
 */

/**
 * Near enough to the end to count as at it — roughly a line of text.
 *
 * Not zero, for two reasons: a fractional device pixel ratio leaves
 * `scrollHeight - scrollTop - clientHeight` at 0.5 when the column is visibly
 * at its end, and a reader who has nudged a few pixels up has not stopped
 * following the conversation.
 */
export const PINNED_SLACK = 80

export interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function atEnd(metrics: ScrollMetrics, slack = PINNED_SLACK): boolean {
  const { scrollHeight, scrollTop, clientHeight } = metrics
  return scrollHeight - scrollTop - clientHeight <= slack
}
