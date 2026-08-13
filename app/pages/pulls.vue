<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { relativeTime } from '~/utils/time'
import type { Pull, WorkIntent } from '~/composables/useGithubPulls'

/**
 * The two questions you open github.com for, answered where the sessions are.
 *
 * **What is waiting on me** and **where has my own work got to**. Everything on
 * the page is one of those, and anything that is neither — pull requests you
 * are merely subscribed to, the repository's activity feed, somebody else's
 * team's queue — is deliberately absent. This is not a GitHub client. A worse
 * GitHub inside a smaller window is not worth building; the thing worth
 * building is the row that turns into a session.
 *
 * Which is what every row does. A red pull request of yours is one press from a
 * workspace with the branch checked out and an agent reading the actual CI
 * logs. A review asked of you is one press from one that has the diff and has
 * been told to go and read around it. That is the difference between this and a
 * list of links, and it is the only reason the list is here.
 */

const { reading, summary, loading, loaded, busy, refresh, watchContinuously, stopWatching, work, merge }
  = useGithubPulls()
const { workingDir } = useWorkingDir()
const toast = useToast()

/** The pull request a merge has been offered on but not yet confirmed. */
const confirming = ref<number | null>(null)

onMounted(() => watchContinuously())
onUnmounted(stopWatching)

// Another project is another repository and another set of pull requests.
watch(workingDir, () => { void refresh() })

const nothingAtAll = computed(() =>
  reading.value.ok && !reading.value.reviewing.length && !reading.value.mine.length
)

/**
 * Yours, split by whether the next move is yours.
 *
 * The split is the page. A flat list of "my pull requests" is a list you have
 * to read all of to find the two that need you, which is the work this was
 * supposed to remove.
 */
const mineOnYou = computed(() => reading.value.mine.filter(p => p.verdict.onYou))
const mineWaiting = computed(() => reading.value.mine.filter(p => !p.verdict.onYou))

async function startWork(pull: Pull, intent?: WorkIntent) {
  try {
    const session = await work(pull.number, intent)
    if (session.startError) {
      toast.add({ title: 'Session started, but not working', description: session.startError, color: 'warning' })
    }
    await navigateTo(`/sessions/${session.id}`)
  } catch (e: any) {
    toast.add({ title: `Could not start on #${pull.number}`, description: errorMessage(e), color: 'error' })
  }
}

async function confirmMerge(pull: Pull) {
  // Asked twice on purpose. Everything else on this page is a read or a local
  // workspace; this one is visible to everybody the moment it lands.
  if (confirming.value !== pull.number) {
    confirming.value = pull.number
    return
  }

  confirming.value = null
  try {
    await merge(pull.number)
    toast.add({ title: `#${pull.number} merged`, description: pull.title, color: 'success' })
  } catch (e: any) {
    toast.add({ title: `#${pull.number} was not merged`, description: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <div>
    <PageHeader title="Reviews">
      <template #trailing>
        <span v-if="summary.onYou" class="fs-mono font-mono ink-accent">
          {{ summary.onYou }} on you
        </span>
      </template>
      <template #right>
        <span v-if="reading.readAt" class="type-mono-meta hidden sm:inline">
          read {{ relativeTime(reading.readAt) }}
        </span>
        <button
          class="p-1.5 rounded-md hover-bg focus-ring press-scale"
          style="color: var(--text-tertiary);"
          title="Ask GitHub again"
          :disabled="loading"
          @click="refresh()"
        >
          <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{ 'animate-spin': loading }" />
        </button>
      </template>
    </PageHeader>

    <div class="page-container page-container--measure py-4 space-y-6">
      <p class="type-body leading-relaxed">
        Open pull requests in
        <span v-if="reading.repo" class="font-mono fs-sm ink">{{ reading.repo }}</span>
        <span v-else>this project</span>
        that have your name on them — asked of you, or opened by you. Read through
        <code class="font-mono fs-mono">gh</code>, with the sign-in you already have.
      </p>

      <!--
        A reason, never an empty list. Telling somebody nothing is waiting when
        really nobody asked is how a page teaches you to stop trusting it.
      -->
      <div
        v-if="!reading.ok"
        class="flex items-start gap-3 p-3.5 rounded-lg"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <UIcon name="i-lucide-plug-zap" class="size-4 shrink-0 mt-0.5 ink-warn" />
        <div class="min-w-0 space-y-1">
          <p class="type-strong text-body">GitHub could not be asked</p>
          <p class="type-detail">{{ reading.reason }}</p>
        </div>
      </div>

      <template v-else>
        <!-- Four numbers that answer "is there anything here for me" from the doorway -->
        <div v-if="!nothingAtAll" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div
            v-for="stat in [
              { label: 'on you', value: summary.onYou, tone: 'var(--accent)' },
              { label: 'to review', value: summary.toReview, tone: 'var(--text-primary)' },
              { label: 'ready to merge', value: summary.toMerge, tone: 'var(--success)' },
              { label: 'waiting on others', value: summary.waiting, tone: 'var(--text-tertiary)' },
            ]"
            :key="stat.label"
            class="px-3 py-2.5 rounded-lg"
            style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          >
            <div class="stat-number tabular-nums" :style="{ color: stat.value ? stat.tone : 'var(--text-disabled)' }">
              {{ stat.value }}
            </div>
            <div class="stat-label">{{ stat.label }}</div>
          </div>
        </div>

        <div v-if="loading && !loaded" class="space-y-2">
          <SkeletonRow v-for="i in 3" :key="i" />
        </div>

        <template v-else>
          <section v-if="reading.reviewing.length" class="space-y-2">
            <h2 class="text-section-label">Waiting for your review</h2>
            <PullCard
              v-for="pull in reading.reviewing"
              :key="pull.number"
              :pull="pull"
              :busy="busy === pull.number"
              class="stagger-item"
              @work="intent => startWork(pull, intent)"
            />
          </section>

          <section v-if="mineOnYou.length" class="space-y-2">
            <h2 class="text-section-label">Yours, waiting on you</h2>
            <div v-for="pull in mineOnYou" :key="pull.number" class="space-y-1.5 stagger-item">
              <PullCard
                :pull="pull"
                :busy="busy === pull.number"
                :can-merge="pull.verdict.state === 'ready'"
                @work="intent => startWork(pull, intent)"
                @merge="confirmMerge(pull)"
              />
              <!-- The second press, spelled out rather than a modal over the list -->
              <div
                v-if="confirming === pull.number"
                class="flex items-center gap-2 px-3 py-2 rounded-md ml-3"
                style="background: var(--success-wash); border: 1px solid var(--success-edge);"
              >
                <UIcon name="i-lucide-git-merge" class="size-3.5 shrink-0 ink-ok" />
                <span class="type-detail flex-1">
                  Merge #{{ pull.number }} into <span class="font-mono">{{ pull.baseBranch }}</span>?
                  Everyone on this repository sees it.
                </span>
                <button
                  class="fs-mono px-2 py-1 rounded press-scale focus-ring"
                  style="color: var(--text-tertiary);"
                  @click="confirming = null"
                >
                  Cancel
                </button>
                <button
                  class="fs-mono px-2.5 py-1 rounded font-medium press-scale focus-ring"
                  style="background: var(--success); color: white;"
                  @click="confirmMerge(pull)"
                >
                  Merge it
                </button>
              </div>
            </div>
          </section>

          <section v-if="mineWaiting.length" class="space-y-2">
            <h2 class="text-section-label">Yours, waiting on somebody else</h2>
            <PullCard
              v-for="pull in mineWaiting"
              :key="pull.number"
              :pull="pull"
              :busy="busy === pull.number"
              class="stagger-item"
              @work="intent => startWork(pull, intent)"
            />
          </section>

          <EmptyState
            v-if="nothingAtAll"
            icon="i-lucide-git-pull-request"
            title="Nothing open with your name on it"
            :description="reading.repo
              ? `No open pull request in ${reading.repo} is yours or waiting on your review. When one is, it turns up here — and one press starts a session on it.`
              : 'No open pull request here is yours or waiting on your review.'"
            action-label="See your sessions"
            action-to="/work"
          />
        </template>
      </template>
    </div>
  </div>
</template>
