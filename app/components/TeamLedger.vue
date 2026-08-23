<script setup lang="ts">
/**
 * What the team shipped, when the team is more than one machine.
 *
 * Everything above this on the page is one laptop's answer. This is every
 * laptop that has pushed, and the honest thing about it is the part most
 * dashboards hide: a machine is only as current as its last sync, so each one
 * says when it last had anything to say, and a machine that has not pushed for
 * a week reads as a week behind rather than as a quiet week.
 *
 * Three things it deliberately does not do:
 *
 *   - **It does not average over a gap.** No "team velocity", no per-person
 *     rate. A missing machine is a missing machine and the row says so.
 *   - **It does not reconcile with the ledger above it.** That one is this
 *     machine's run log joined to its sessions; this one is one line per
 *     outcome from everybody. Presenting them as one number would be the
 *     arithmetic nobody can reproduce.
 *   - **It shows people by the address git gave.** There is nothing to sign
 *     in to, so that is all anybody is called here — and rituals, which name
 *     nobody, are kept out of the table and counted underneath it.
 *
 * Nothing loads from the network on mount. Reading is local; a sync is a thing
 * somebody presses, through a repository they pick.
 */

const { data, loading, syncing, error, lastSync, load, sync } = useTeamLedger()
const { projects, active, ensureLoaded } = useProjects()

const projectOptions = computed(() =>
  projects.value.map(project => ({ value: project.path, label: project.name })),
)
const toast = useToast()

const repoDir = ref<string>('')

onMounted(async () => {
  await Promise.all([load(), ensureLoaded()])
  repoDir.value = active.value?.path ?? projects.value[0]?.path ?? ''
})

const machines = computed(() => data.value?.machines ?? [])
const people = computed(() => data.value?.people ?? [])

/** Money, always two places, so a column of it lines up. */
function money(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—'
  return `$${usd.toFixed(2)}`
}

/**
 * The counts a machine row is really about: has it said anything, and when.
 * `entries` alone reads as activity, which a stale file would fake.
 */
function freshness(lastAt?: number): string {
  if (!lastAt) return 'nothing yet'
  return `${relativeTime(lastAt)}`
}

const unreadable = computed(() =>
  machines.value.reduce((total, machine) => total + machine.corrupt, 0),
)
const fromNewer = computed(() =>
  machines.value.reduce((total, machine) => total + machine.newer, 0),
)

/** What the last sync came to, in one sentence a person can act on. */
const syncNote = computed(() => {
  const result = lastSync.value
  if (!result) return null

  const pushed = result.push.pushed
    ? 'This machine’s ledger went up.'
    : SKIPS[result.push.skip ?? ''] ?? 'Nothing went up.'

  const pulled = result.pull.machines.length
    ? `${result.pull.machines.length} other ${result.pull.machines.length === 1 ? 'machine' : 'machines'} came down.`
    : SKIPS[result.pull.skip ?? ''] ?? 'Nothing came down.'

  return `${pushed} ${pulled}`
})

/**
 * Each of these is an ordinary state rather than a failure, and each says what
 * to do about it — or that there is nothing to do, which is the usual case.
 */
const SKIPS: Record<string, string> = {
  'no-remote': 'That repository has no remote, so there is nowhere to put the ledger.',
  'no-branch': 'Nobody has pushed the ledger branch yet — the first push makes it.',
  'unreachable': 'The remote could not be reached, so nothing moved. The lines are safe here.',
  'up-to-date': 'Already up to date.',
  'rejected': 'Somebody pushed while this did; the next sync will carry it.',
  'nothing-to-push': 'This machine has nothing recorded yet.',
}

async function syncNow() {
  if (!repoDir.value) {
    toast.add({ title: 'Pick a repository first', color: 'warning' })
    return
  }

  const result = await sync(repoDir.value)
  if (!result) {
    toast.add({ title: 'Could not sync the ledger', description: error.value ?? undefined, color: 'error' })
  }
}
</script>

<template>
  <section class="rounded-lg p-5 bg-card">
    <header class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 class="type-strong text-body">Across the team</h2>
        <p class="type-meta">
          Every machine that has pushed, over the last {{ data?.days ?? 30 }} days. Read from this
          disk, so each row is only as current as its last sync.
        </p>
      </div>

      <!--
        The picker only appears when there is something to pick. An empty select
        beside an enabled button is a control that looks ready and is not; with
        no project registered there is no repository to carry the ledger, and
        saying that is more use than offering the press.
      -->
      <div class="flex items-center gap-2 shrink-0">
        <FieldSelect
          v-if="projects.length"
          v-model="repoDir"
          :options="projectOptions"
          variant="inline"
          aria-label="Repository to sync the ledger through"
        />
        <span v-else class="type-meta">Add a project to sync through</span>
        <UButton
          label="Sync now"
          size="xs"
          variant="soft"
          :loading="syncing"
          :disabled="!projects.length"
          @click="syncNow"
        />
      </div>
    </header>

    <p v-if="loading && !data" class="type-meta mt-3">Reading what is on this disk…</p>

    <p v-else-if="error && !data" class="type-meta mt-3">{{ error }}</p>

    <p v-else-if="data && !machines.length" class="type-meta mt-3">
      Nothing has been recorded yet. This machine writes its own file as soon as a turn finishes,
      and <b>Sync now</b> puts it on the
      <span class="font-mono">{{ data.branch }}</span> branch of the repository above — which nobody
      reviews and nothing else reads.
    </p>

    <template v-else-if="data">
      <dl class="stats">
        <div>
          <dt>Spend</dt>
          <dd>{{ money(data.totals.costUsd) }}</dd>
        </div>
        <div>
          <dt>Turns</dt>
          <dd>{{ data.totals.turns }}</dd>
        </div>
        <div>
          <dt>Merges</dt>
          <dd>
            {{ data.totals.landings }}
            <span
              v-if="data.totals.reverts"
              class="ink-3 text-sm"
              :title="`${data.totals.reverts} have since been reverted`"
            >(−{{ data.totals.reverts }})</span>
          </dd>
        </div>
        <!-- Passed out of recorded, because a bare count of passes says nothing. -->
        <div :title="`${data.totals.checks.passing} of ${data.totals.checks.passing + data.totals.checks.failing} recorded verdicts passed`">
          <dt>Checks passed</dt>
          <dd>{{ data.totals.checks.passing }} / {{ data.totals.checks.passing + data.totals.checks.failing }}</dd>
        </div>
        <div>
          <dt>Machines</dt>
          <dd>{{ machines.length }}</dd>
        </div>
      </dl>

      <div class="breakdown">
        <h3 class="type-strong text-sm">By machine</h3>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Last heard</th>
                <th class="num">Spend</th>
                <th class="num">Turns</th>
                <th class="num">Merges</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="machine in machines" :key="machine.machine">
                <td class="what">
                  {{ machine.machine }}
                  <span v-if="machine.machine === data.machine" class="ink-3">· this one</span>
                </td>
                <td>{{ freshness(machine.lastAt) }}</td>
                <td class="num">{{ money(machine.totals.costUsd) }}</td>
                <td class="num">{{ machine.totals.turns }}</td>
                <td class="num">{{ machine.totals.landings }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="people.length" class="breakdown">
        <h3 class="type-strong text-sm">By person</h3>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Person</th>
                <th class="num">Spend</th>
                <th class="num">Turns</th>
                <th class="num">Merges</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="person in people" :key="person.person">
                <td class="what">{{ person.person }}</td>
                <td class="num">{{ money(person.totals.costUsd) }}</td>
                <td class="num">{{ person.totals.turns }}</td>
                <td class="num">{{ person.totals.landings }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p v-if="syncNote" class="type-meta mt-3">{{ syncNote }}</p>

      <p class="caveat">
        Every machine keeps its own file and never writes anybody else's, so a sync is a
        concatenation and nothing here can be overwritten by a colleague.
        <template v-if="data.unattributedCostUsd">
          {{ money(data.unattributedCostUsd) }} of the spend names nobody — rituals, and anything
          recorded before this app kept a name — so <b>by person</b> adds up to less than the total.
        </template>
        <template v-if="unreadable">
          {{ unreadable }} {{ unreadable === 1 ? 'line was' : 'lines were' }} unreadable and left out.
        </template>
        <template v-if="fromNewer">
          {{ fromNewer }} {{ fromNewer === 1 ? 'line is' : 'lines are' }} from a newer version of this
          app than yours, so {{ fromNewer === 1 ? 'it is' : 'they are' }} not counted. Updating will
          count {{ fromNewer === 1 ? 'it' : 'them' }}.
        </template>
      </p>
    </template>
  </section>
</template>

<style scoped>
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

.caveat {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--text-tertiary);
}
</style>
