/**
 * Paragraph breaks between the blocks of a streamed answer.
 *
 * Text arrives as content block deltas, and a turn that stops to run a tool
 * resumes in a new block. Nothing in a delta says where one block ended and the
 * next began, so appending them as they arrive glues the last sentence of one
 * onto the first word of the next: "…let me read the pieces I'll be
 * modifying.Now I have what I need." The browser and the terminal both fold the
 * stream by concatenation, which is why this looked like a rendering bug in two
 * places at once and was neither — it was already glued when it left here.
 *
 * A block that opens after something has already been said opens a paragraph.
 * The first one does not, so an answer never begins with blank lines.
 *
 * Thinking is tracked apart from text: they are two separate strings on screen,
 * and a break belongs to whichever of them the block was.
 */
export type BlockKind = 'text' | 'thinking'

export interface ParagraphBreaks {
  /** Called for every `content_block_start`; any other block type is ignored. */
  startBlock: (type: string | undefined) => void
  /**
   * The delta as it should be appended, or null when it carries nothing worth
   * sending. A block whose first delta is only whitespace has no paragraph to
   * start yet, so the break waits for the first real word rather than landing
   * before it and being followed by more blank lines.
   */
  delta: (kind: BlockKind, text: string) => string | null
}

export function paragraphBreaks(): ParagraphBreaks {
  const said = new Set<BlockKind>()
  const opening = new Set<BlockKind>()

  return {
    startBlock(type) {
      if ((type === 'text' || type === 'thinking') && said.has(type)) opening.add(type)
    },

    delta(kind, text) {
      if (!opening.has(kind)) {
        if (!text) return null
        said.add(kind)
        return text
      }

      const body = text.replace(/^\s+/, '')
      if (!body) return null

      opening.delete(kind)
      said.add(kind)
      return `\n\n${body}`
    },
  }
}
