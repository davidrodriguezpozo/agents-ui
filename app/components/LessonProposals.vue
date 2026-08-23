<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { relativeTime } from '~/utils/time'

/**
 * What has gone wrong twice, and one line you might want to write about it.
 *
 * The panel is arranged around the thing that makes this acceptable rather than
 * creepy: **nothing is written until you press accept, and you see the exact line
 * and the exact file first.** So the order on screen is the order of the
 * decision — the lesson, then where a line could go, then the line, then the
 * diff, then two buttons.
 *
 * Three things it deliberately does not do:
 *
 *   - **It does not propose anything until asked.** Reading the list is free;
 *     writing a line costs a model call. One press, one lesson, one destination.
 *   - **It never shows a line without the file it would change.** A rule with no
 *     destination is a suggestion; with one it is a diff.
 *   - **It has no "apply automatically".** There is no switch here because there
 *     is no switch anywhere — see `lessonProposals.ts`.
 */

interface Lesson {
  key: string
  kind: 'reverted' | 'base-broken' | 'denied'
  count: number
  lastAt: number
  firstAt: number
  repoDir?: string
  subjects: string[]
  sessions: { id: string; title: string }[]
}

interface Destination {
  destination: 'claude-md' | 'brief' | 'shared-project'
  label: string
  path: string
  exists: boolean
  creates: boolean
}

interface Decision {
  key: string
  verdict: 'accepted' | 'rejected'
  at: number
  destination?: string
  line?: string
}

interface Proposal {
  key: string
  destination: Destination['destination']
  path: string
  line: string
  diff: string
  creates: boolean
}

const lessons = ref<Lesson[]>([])
const decided = ref<Decision[]>([])
const destinations = ref<Destination[]>([])
const repoDir = ref<string | null>(null)
const loading = ref(true)
const busy = ref<string | null>(null)
const proposal = ref<Proposal | null>(null)
const chosen = ref<Record<string, Destination['destination']>>({})

/** A file that does not exist yet says so on its own line, not in brackets. */
const destinationOptions = computed(() =>
  destinations.value.map(d => ({
    value: d.destination,
    label: d.label,
    hint: d.creates ? 'a new file' : undefined,
  })),
)
const toast = useToast()

/** What each signal is, in the fewest words that let somebody judge it. */
const KINDS: Record<Lesson['kind'], string> = {
  'reverted': 'work that was taken back out',
  'base-broken': 'a check that went red after a merge',
  'denied': 'the same tool or host refused',
}

async function load() {
  loading.value = true
  try {
    const answer = await $fetch<{
      lessons: Lesson[]
      decided: Decision[]
      destinations: Destination[]
      repoDir: string | null
    }>('/api/lessons')

    lessons.value = answer.lessons
    decided.value = answer.decided
    destinations.value = answer.destinations
    repoDir.value = answer.repoDir
  } catch (e) {
    toast.add({ title: 'Could not read the lessons', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function propose(lesson: Lesson) {
  const destination = chosen.value[lesson.key] ?? destinations.value[0]?.destination
  if (!destination) return

  busy.value = lesson.key
  proposal.value = null
  try {
    proposal.value = await $fetch<Proposal>('/api/lessons/propose', {
      method: 'POST',
      body: { key: lesson.key, destination },
    })
    if (!proposal.value.line) {
      toast.add({
        title: 'Nothing worth a rule',
        description: 'The record was too thin to write a line from. That is an answer too.',
        color: 'warning',
      })
    }
  } catch (e) {
    toast.add({ title: 'Could not draft a line', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

async function accept() {
  if (!proposal.value) return

  busy.value = proposal.value.key
  try {
    const result = await $fetch<{ message: string }>('/api/lessons/decide', {
      method: 'POST',
      body: { accept: proposal.value },
    })
    toast.add({ title: 'Written', description: result.message, color: 'success' })
    proposal.value = null
    await load()
  } catch (e) {
    toast.add({ title: 'Could not write it', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

async function reject(key: string) {
  busy.value = key
  try {
    await $fetch('/api/lessons/decide', { method: 'POST', body: { reject: key } })
    if (proposal.value?.key === key) proposal.value = null
    toast.add({ title: 'Left alone', description: 'It will not come back next week.', color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: 'Could not record that', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div id="settings-lessons" class="rounded-lg p-5 space-y-4 bg-card">
    <h3 class="text-section-label">What went wrong twice</h3>
    <p class="fs-sm text-meta">
      Three things this machine counts: work that was reverted, a check that went red after a
      merge, and the same tool or host refused over and over. Each one can become a line in a
      file — <span class="font-mono">CLAUDE.md</span> in the repository, so a rule you accept
      improves everybody's agents on their next pull. Nothing is ever written without you.
    </p>

    <p v-if="loading" class="fs-sm text-label">Counting…</p>

    <p v-else-if="!lessons.length" class="fs-sm text-label">
      Nothing has gone wrong twice in the last thirty days.
      <template v-if="decided.length">
        {{ decided.length }} {{ decided.length === 1 ? 'lesson has' : 'lessons have' }} been ruled
        on already.
      </template>
    </p>

    <template v-else>
      <div v-if="!repoDir" class="fs-sm text-label">
        Pick a project folder in the sidebar first — a rule has to land in a repository.
      </div>

      <div v-for="lesson in lessons" :key="lesson.key" class="lesson">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <p class="type-strong text-body">
              {{ lesson.subjects.slice(0, 2).join(', ') || KINDS[lesson.kind] }}
              <span class="ink-3 fs-micro font-mono">×{{ lesson.count }}</span>
            </p>
            <p class="type-meta">
              {{ KINDS[lesson.kind] }} · last {{ relativeTime(lesson.lastAt) }}
              <template v-if="lesson.sessions.length">
                · {{ lesson.sessions.length }}
                {{ lesson.sessions.length === 1 ? 'session' : 'sessions' }}
              </template>
            </p>
          </div>

          <div v-if="repoDir" class="flex items-center gap-2 shrink-0">
            <!--
              Shows the first destination while nothing has been picked, because
              that is the one "Draft a line" would use. A placeholder here would
              claim the button did not know where to write yet.
            -->
            <FieldSelect
              :model-value="chosen[lesson.key] ?? destinations[0]?.destination"
              :options="destinationOptions"
              variant="inline"
              :aria-label="`Where a line about ${lesson.subjects[0] ?? 'this'} would go`"
              @update:model-value="value => { chosen[lesson.key] = value as Destination['destination'] }"
            />
            <UButton
              label="Draft a line"
              size="xs"
              variant="soft"
              :loading="busy === lesson.key"
              @click="propose(lesson)"
            />
            <UButton
              label="Not a rule"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="busy === lesson.key"
              @click="reject(lesson.key)"
            />
          </div>
        </div>

        <!--
          The diff, and the two buttons that are the whole decision. Shown under
          the lesson it belongs to rather than in a modal: the point is to read
          the line next to what produced it.
        -->
        <div v-if="proposal && proposal.key === lesson.key && proposal.line" class="proposal">
          <pre class="diff">{{ proposal.diff }}</pre>
          <div class="flex items-center gap-2 flex-wrap">
            <UButton
              :label="proposal.creates ? 'Create the file with this line' : 'Add this line'"
              size="xs"
              :loading="busy === proposal.key"
              @click="accept"
            />
            <UButton
              label="No"
              size="xs"
              variant="ghost"
              color="neutral"
              @click="() => { proposal = null }"
            />
            <span class="type-meta">
              Writes to your working tree. Nothing is committed — the diff is yours to review.
            </span>
          </div>
        </div>
      </div>
    </template>

    <!--
      What has already been ruled on. Kept because "we decided not to" is a fact
      worth being able to check, and because an accepted rule should be traceable
      to the lesson that produced it.
    -->
    <details v-if="decided.length" class="ruled">
      <summary class="type-meta cursor-pointer">{{ decided.length }} already ruled on</summary>
      <ul class="space-y-1 mt-2">
        <li v-for="entry in decided" :key="entry.key" class="type-detail">
          <span class="font-mono fs-micro" :style="{ color: entry.verdict === 'accepted' ? 'var(--success)' : 'var(--text-tertiary)' }">
            {{ entry.verdict }}
          </span>
          <span class="ink-3"> {{ entry.key }}</span>
          <template v-if="entry.line"> — “{{ entry.line }}”</template>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.lesson {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--input-bg);
}
.lesson + .lesson { margin-top: 8px; }

.proposal {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* A diff is read column by column, so it never wraps and never proportional. */
.diff {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--surface-base);
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--text-secondary);
  overflow-x: auto;
  white-space: pre;
}

.ruled { border-top: 1px solid var(--border-subtle); padding-top: 10px; }
</style>
