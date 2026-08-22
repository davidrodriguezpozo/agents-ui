import { outcomeTurnOf } from './outcomes'
import { runRecordsSince } from './runStore'
import { readSessions } from './sessions'
import { appendLocalLedger, ledgerEntriesOf, type LedgerEntry } from './sharedLedger'

/**
 * Turning what this machine has done into lines it can share.
 *
 * `sharedLedger.ts` defines the file and `ledgerSync.ts` moves it; this is the
 * one step between them, and it is its own file because it is the only part
 * that reads the local stores. Keeping it out of the format is why the format's
 * tests need no store at all.
 *
 * It re-reads a wide window every time, on purpose. The alternative is a
 * high-water mark, which is a second piece of state that can disagree with the
 * file it describes: a crash between the append and the mark either writes
 * lines that are never counted or counts lines that were never written. The
 * entry ids make a repeat free — see `appendLedgerText` — so the cheap correct
 * thing is to offer the same window again and let the file decide what is new.
 * A machine that was off for a fortnight catches up for the same reason.
 */

/** Wide enough to cover a holiday, bounded so the run log is not read twice over. */
export const COLLECT_DAYS = 30

/**
 * Append everything from the last `days` that is not already in this machine's
 * file, and report what that came to.
 *
 * Never throws: this runs on the way to rendering a page, and a team total
 * missing today's lines is worth more than a page that fails to load. A read
 * that fails leaves the file exactly as it was, and the next collect fixes it.
 */
export async function collectLocalLedger(
  now: number = Date.now(),
  days: number = COLLECT_DAYS,
): Promise<{ added: number; skipped: number }> {
  try {
    const since = now - Math.max(1, days) * 86_400_000

    const runs = await runRecordsSince(since)
    const sessions = await readSessions()

    // `outcomeTurnOf` is the conversion the local ledger already uses, so a
    // turn counted here and a turn counted there are the same turn — including
    // the person it names, which is the field two machines have to agree on.
    const entries: LedgerEntry[] = ledgerEntriesOf({
      turns: runs.map(outcomeTurnOf),
      // The window applies to sessions too. `readSessions` is not windowed the
      // way the run log is, so without this a first collect would write a line
      // for every landing this machine has ever made — all real, all unbounded,
      // and the ledger is a record of what is happening rather than an archive
      // of what did.
      sessions: sessions.filter(session => outcomeAt(session) >= since),
    })

    return await appendLocalLedger(entries)
  } catch {
    return { added: 0, skipped: 0 }
  }
}

/** The most recent thing that happened to a session, as far as the ledger cares. */
function outcomeAt(session: {
  landed?: { at: number }
  reverted?: { at: number; committedAt?: number }
  check?: { at: number }
}): number {
  return Math.max(
    session.landed?.at ?? 0,
    session.reverted?.committedAt ?? session.reverted?.at ?? 0,
    session.check?.at ?? 0,
  )
}
