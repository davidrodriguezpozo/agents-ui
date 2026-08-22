<script setup lang="ts">
import { LEDGER_DAYS, type LedgerDimension, type LedgerRow, type LedgerTable } from '~/composables/useLedger'

/**
 * What the work that actually shipped cost.
 *
 * The spend chart answers what a day cost, a day late. This answers the question
 * that gets a bad ritual deleted: cost per accepted merge, by ritual, agent,
 * model and repository, next to the same figure for the window before.
 *
 * Everything on this page is arithmetic somebody else did. `joinOutcomes` is the
 * join and `buildLedger` is the pairing; both have tests over fixtures. The one
 * thing decided here is what a number is *called*, which is most of what makes a
 * ledger honest:
 *
 *   - **"Per merge" is spend on the sessions that merged, over the merges.** Not
 *     total spend over merges — a ritual's briefing is not part of what a merge
 *     cost. The total is shown separately so the two can be reconciled.
 *   - **"Nothing merged" is not "wasted".** It is spend that no merge will be
 *     credited with: a session set aside, and every turn no session owns.
 *     Sessions still going are their own column, because unresolved is not lost.
 *   - **Dollars are indicative, said once.** On a subscription nothing is billed
 *     per turn, so these are list-price equivalents. Repeating the caveat on
 *     every figure would be noise; saying it nowhere would imply precision the
 *     records do not have.
 *   - **"Since reverted" is a count, not a verdict.** It is the merges in the
 *     window whose work has been taken back out of the base branch since. Shown
 *     without colour and without comparison to the window before: a revert is
 *     regularly the right thing to have happened, and the earlier window has had
 *     longer for its merges to be reverted, so the two counts are not comparable.
 *     Nothing is drawn at all when it is zero, which is the usual case.
 *   - **"By person" is git, and nothing else.** No account, no sign-in, no list
 *     of colleagues: the name is whatever the repository resolved when the turn
 *     was sent. So the table runs short of the total by every ritual and by
 *     everything recorded before the app kept a name, and the line under it says
 *     so — an unattributed row folded in among real people would be read as one.
 */

const { data, loading, error, days, load } = useLedger()
const { nameFor } = useProjects()

onMounted(() => { void load() })

const current = computed(() => data.value?.current ?? null)

/** Money, always two places, so a column of it lines up. */
function money(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—'
  return `$${usd.toFixed(2)}`
}

const DIMENSIONS: Record<LedgerDimension, { heading: string; column: string; empty: string }> = {
  ritual: {
    heading: 'By ritual',
    column: 'Ritual',
    empty: 'No ritual ran in this window.',
  },
  agent: {
    heading: 'By agent',
    column: 'Agent',
    empty: 'No turn in this window named an agent.',
  },
  model: {
    heading: 'By model',
    column: 'Model',
    empty: 'No turn in this window recorded which model answered it.',
  },
  repository: {
    heading: 'By repository',
    column: 'Repository',
    empty: 'No turn in this window could be placed in a repository.',
  },
  person: {
    heading: 'By person',
    column: 'Person',
    empty: 'No turn in this window was sent by a named person. Set git\'s user.name and '
      + 'user.email in a repository and its turns start carrying it.',
  },
}

/** A repository row reads as the project's name; everything else names itself. */
function rowName(table: LedgerTable, row: LedgerRow): string {
  if (table.dimension === 'repository') return nameFor(row.key)
  return row.label ?? row.key
}

/** The full path or id behind the name, for the hover. */
function rowTitle(table: LedgerTable, row: LedgerRow): string {
  return rowName(table, row) === row.key ? '' : row.key
}

/**
 * The change, in words rather than an arrow alone.
 *
 * Null when either window had no merge — `perLandingChange` refuses to divide
 * then, and a "0%" here would read as "no change" rather than "no answer".
 */
const change = computed(() => {
  const ratio = data.value?.perLandingChange
  if (ratio === null || ratio === undefined) return null

  const percent = Math.round(Math.abs(ratio) * 100)
  // Under a percent is a rounding artefact, not news.
  if (percent < 1) return { text: 'about the same', tone: 'var(--text-tertiary)' }

  return ratio < 0
    ? { text: `${percent}% cheaper per merge`, tone: 'var(--success)' }
    : { text: `${percent}% dearer per merge`, tone: 'var(--warning)' }
})

/** Spend that no merge will be credited with — see the note at the top. */
const unmerged = computed(() => {
  const totals = current.value
  if (!totals) return 0
  return totals.abandonedCostUsd + totals.unattributedCostUsd
})

function windowLabel(from: number, to: number): string {
  const day = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${day(from)} – ${day(to)}`
}
</script>

<template>
  <section
    class="rounded-lg overflow-hidden"
    style="border: 1px solid var(--border-subtle); background: var(--surface-raised);"
    aria-labelledby="ledger-title"
  >
    <header
      class="flex items-center gap-3 flex-wrap px-4 py-2.5"
      style="background: var(--surface-base); border-bottom: 1px solid var(--border-subtle);"
    >
      <h2 id="ledger-title" class="text-section-label">What shipped, and what it cost</h2>
      <!--
        Only once the window has come back. Before that the dates are derived
        from a clock that reads differently on the server than in the browser,
        which is a hydration mismatch waiting for a day boundary to fall between
        the two.
      -->
      <span v-if="data" class="type-mono-meta">
        {{ windowLabel(data.window.since, data.window.until) }}, today included
      </span>

      <div class="flex items-center gap-1 ml-auto" role="group" aria-label="Window">
        <button
          v-for="option in LEDGER_DAYS"
          :key="option"
          class="px-2 py-0.5 rounded fs-mono font-medium transition-colors focus-ring"
          :style="{
            background: days === option ? 'var(--accent-muted)' : 'transparent',
            color: days === option ? 'var(--accent)' : 'var(--text-tertiary)',
          }"
          :aria-pressed="days === option"
          @click="load(option)"
        >
          {{ option }}d
        </button>
      </div>
    </header>

    <p v-if="error" class="px-4 py-3 fs-sm ink-error">
      {{ error }} — the ledger reads the run log, so this usually means a run file could not
      be opened. It reloads on the next window you pick.
    </p>

    <p v-else-if="loading && !data" class="px-4 py-8 text-center type-meta">
      Reading the run log. Every turn in the window is opened, so a long window takes a moment.
    </p>

    <!-- Held quieter on refetch rather than replaced by a skeleton — the window
         buttons are next to it and a flash on every press never settles. -->
    <div
      v-else-if="data && current"
      class="ledger"
      :class="{ 'ledger--stale': loading }"
    >
      <!-- ── Headline ── -->
      <div class="headline">
        <div>
          <div class="headline-label">Spend per merge</div>
          <div class="headline-figure">
            {{ current.costPerLandingUsd === null ? 'No merges' : money(current.costPerLandingUsd) }}
          </div>
        </div>

        <p class="headline-note">
          <template v-if="current.costPerLandingUsd !== null">
            {{ current.landings.total }} merge{{ current.landings.total === 1 ? '' : 's' }} from
            {{ money(current.landedCostUsd) }} spent on the sessions behind them.
          </template>
          <template v-else>
            {{ money(current.costUsd) }} spent and nothing merged in this window.
          </template>

          <br>

          <template v-if="data.previous.costPerLandingUsd !== null">
            The {{ data.window.days }} days before:
            <b>{{ money(data.previous.costPerLandingUsd) }}</b> per merge
            <template v-if="change"> — <span :style="{ color: change.tone }">{{ change.text }}</span></template>.
          </template>
          <template v-else>
            Nothing merged in the {{ data.window.days }} days before, so there is nothing to
            compare it with.
          </template>
        </p>
      </div>

      <!-- Said once, and not repeated on every figure. -->
      <p class="caveat">
        Indicative. On a Claude subscription nothing is billed per turn, so these are what the
        same work would have cost at API list price rather than money that left your account.
        A session's cost is all of its turns, rework and changes of mind included, so per merge
        is an upper bound on the work and a lower bound on the waste.
      </p>

      <!-- ── Reconciliation: the four buckets, which add back up to the total ── -->
      <dl class="stats">
        <div>
          <dt>Spent</dt>
          <dd>{{ money(current.costUsd) }}</dd>
        </div>
        <div>
          <dt>On what merged</dt>
          <dd>{{ money(current.landedCostUsd) }}</dd>
        </div>
        <div>
          <dt>Nothing merged</dt>
          <dd>{{ money(unmerged) }}</dd>
        </div>
        <div>
          <dt>Still going</dt>
          <dd>{{ money(current.openCostUsd) }}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{{ current.turns }}</dd>
        </div>
        <!--
          Only when there is one. A permanent "Since reverted: 0" invites reading
          the column as a scoreboard, and on most machines it would never move.
        -->
        <div v-if="current.revertedLandings">
          <dt>Since reverted</dt>
          <dd>{{ current.revertedLandings }}</dd>
        </div>
      </dl>

      <p class="caveat">
        "Nothing merged" is spend a merge will never be credited with: sessions set aside, plus
        every turn no session owns — a ritual's morning briefing is real output, and it is not a
        merge. Sessions still going are the column beside it, because unresolved is not lost.
        <template v-if="current.changedFiles.measured">
          {{ current.changedFiles.turns }} of {{ current.changedFiles.measured }} turns changed a
          file; a turn that only edited through a shell command is counted as one that did not.
        </template>
        <template v-if="current.side.calls">
          A further {{ money(current.side.costUsd) }} went on
          {{ current.side.calls }} session summar{{ current.side.calls === 1 ? 'y' : 'ies' }},
          which are not turns and are not in the figures above.
        </template>
      </p>

      <p v-if="current.revertedLandings" class="caveat">
        "Since reverted" counts merges from this window whose work has since been taken back out
        of the base branch — as of today, not as of the end of the window, so an older window has
        had longer to accumulate them. It is a floor: only a revert whose commit message says
        what it reverts is seen. It is not a verdict on the work, and the spend above still counts
        it as a merge, because it was one.
      </p>

      <!-- ── The four breakdowns ── -->
      <div v-for="table in data.tables" :key="table.dimension" class="breakdown">
        <h3 class="text-section-label">{{ DIMENSIONS[table.dimension].heading }}</h3>

        <p v-if="!table.rows.length" class="type-meta">{{ DIMENSIONS[table.dimension].empty }}</p>

        <div v-else class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ DIMENSIONS[table.dimension].column }}</th>
                <th class="num">Spend</th>
                <th class="num">Merges</th>
                <th class="num">Per merge</th>
                <th class="num">Nothing merged</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in table.rows" :key="row.key">
                <td class="what" :title="rowTitle(table, row)">{{ rowName(table, row) }}</td>
                <td class="num">{{ money(row.costUsd) }}</td>
                <!--
                  The reverted count rides inside the merges cell rather than
                  taking a column of its own. A fifth column that is empty on
                  every row of every table on most machines is a worse table.
                -->
                <td class="num">
                  {{ row.landings }}
                  <span
                    v-if="row.revertedLandings"
                    class="ink-3"
                    :title="`${row.revertedLandings} of them have since been reverted`"
                  >(−{{ row.revertedLandings }})</span>
                </td>
                <td class="num">{{ money(row.costPerLandingUsd) }}</td>
                <td class="num">{{ money(row.unmergedCostUsd) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p class="caveat">
        A turn with no value for a column is left out of that table rather than put in an
        "unknown" row, so a table can add up to less than {{ money(current.costUsd) }}. A merge is
        counted once, under the last hand on it, so a session run under two models does not appear
        as two merges. <b>By person</b> is git's <span class="font-mono">user.name</span> and
        <span class="font-mono">user.email</span> as the repository resolved them when the turn was
        sent — there is nothing to sign in to, and a ritual or a turn recorded before this app kept
        a name is left out as unattributed rather than counted as yours.
      </p>
    </div>
  </section>
</template>

<style scoped>
.ledger {
  padding: 14px 16px 12px;
  transition: opacity var(--duration) var(--ease-out);
}
/* No skeleton on refetch — the previous window stays up, just quieter. */
.ledger--stale { opacity: 0.55; }

/* ── Headline ─────────────────────────────────── */

.headline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 26px;
}

.headline-label {
  font-size: var(--fs-micro);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.headline-figure {
  font-size: var(--fs-title);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.headline-note {
  flex: 1 1 22rem;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-secondary);
}
.headline-note b { color: var(--text-primary); font-variant-numeric: tabular-nums; }

/* ── The honesty lines ────────────────────────── */

.caveat {
  margin: 10px 0 0;
  font-size: var(--fs-micro);
  line-height: 1.55;
  color: var(--text-tertiary);
}

/* ── Reconciliation ───────────────────────────── */

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 26px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.stats div { display: flex; flex-direction: column; gap: 1px; }
.stats dt {
  font-size: var(--fs-micro);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.stats dd {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: 1.2;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* ── Breakdowns ───────────────────────────────── */

.breakdown {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.breakdown h3 { margin-bottom: 6px; }

.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: var(--fs-micro); }
.table th {
  text-align: left;
  font-size: var(--fs-micro);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-weight: 500;
  padding: 0 10px 5px 0;
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}
.table td {
  padding: 5px 10px 5px 0;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  vertical-align: top;
}
/* Money and counts are compared down the column, so they align on the digit and
   never wrap. */
.table .num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}
.table .what {
  color: var(--text-primary);
  min-width: 10rem;
  max-width: 24rem;
  overflow-wrap: anywhere;
}
</style>
