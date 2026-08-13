<script setup lang="ts">
import { buildNowQueue, NOW_LOOK, type NowItem } from '~/utils/nowQueue'
import { errorMessage } from '~/utils/errors'
import { relativeTime } from '~/utils/time'

/**
 * What needs you, in one place, ranked.
 *
 * The four red counters in the sidebar were an admission that this view was
 * missing: blocked sessions lived on /sessions, reviews on /pulls, failing
 * rituals on /schedules, and the morning report on /. You had to visit four
 * pages to find out whether your morning was going to go well.
 *
 * Every row resolves from here or goes straight to the one place it can be
 * resolved. Reporting a blocked ritual and then sending you elsewhere to do
 * something about it is most of a feature.
 */
const { digest, loading: digestLoading, load: loadDigest } = useDigest()
const { all: pulls, loading: pullsLoading, work } = useGithubPulls()
const { attention, refresh: refreshAttention } = useAttention()
const { allowRules } = useSchedules()
const router = useRouter()
const toast = useToast()

onMounted(() => { if (!digest.value) void loadDigest() })

/** Resolved locally so a row disappears the moment you deal with it. */
const settled = ref<Set<string>>(new Set())
const busy = ref<string | null>(null)

const items = computed(() =>
  buildNowQueue({
    attention: attention.value.items,
    pulls: pulls.value,
    digest: digest.value,
  }).filter(item => !settled.value.has(item.key)),
)

const loading = computed(() => (digestLoading.value || pullsLoading.value) && !digest.value)

async function resolve(item: NowItem) {
  if (!item.action) return
  busy.value = item.key

  try {
    if (item.action.kind === 'allow-rules') {
      await allowRules(String(item.action.target), item.action.rules ?? [])
      settled.value = new Set([...settled.value, item.key])
      // The badge counts a failing streak, which granting a rule does not
      // clear — but the next run will. Re-read so the two stay in step.
      void refreshAttention()
      toast.add({
        title: `${item.title} can do that now`,
        description: 'It will not stop for these again. Nothing else was granted.',
        color: 'success',
      })
      return
    }

    if (item.action.kind === 'work-on-pull') {
      const session = await work(Number(item.action.target))
      settled.value = new Set([...settled.value, item.key])
      if (session?.id) router.push(`/sessions/${session.id}`)
    }
  } catch (e) {
    toast.add({ title: 'Could not do that', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section aria-labelledby="now-queue-title">
    <div class="flex items-baseline gap-2.5 mb-3">
      <h2 id="now-queue-title" class="text-section-label">Needs you</h2>
      <span v-if="items.length" class="type-mono-meta">{{ items.length }}</span>
    </div>

    <div v-if="loading" class="space-y-1">
      <SkeletonRow v-for="i in 3" :key="i" />
    </div>

    <!--
      Said plainly. An empty list on the one screen that is meant to tell you
      whether anything is wrong reads as a page that failed to load.
    -->
    <div
      v-else-if="!items.length"
      class="rounded-lg px-4 py-5 flex items-start gap-3 bg-card"
    >
      <UIcon name="i-lucide-check" class="size-4 shrink-0 mt-0.5" style="color: var(--success);" />
      <div>
        <p class="type-strong">Nothing is waiting on you.</p>
        <p class="type-detail mt-0.5">
          No session is blocked, no ritual has broken, and nothing is sitting unreviewed.
        </p>
      </div>
    </div>

    <ul v-else class="rounded-lg overflow-hidden bg-card divide-y" style="border-color: var(--border-subtle);">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-start gap-3 px-4 py-3 hover-row"
      >
        <UIcon
          :name="NOW_LOOK[item.kind].icon"
          class="size-4 shrink-0 mt-0.5"
          :style="{ color: NOW_LOOK[item.kind].colour }"
        />

        <div class="flex-1 min-w-0">
          <!-- The whole row is the link; the action beside it is the shortcut. -->
          <component
            :is="item.href ? 'a' : 'NuxtLink'"
            :to="item.href ? undefined : item.to"
            :href="item.href"
            :target="item.href ? '_blank' : undefined"
            class="type-strong block truncate focus-ring rounded"
          >
            {{ item.title }}
          </component>
          <p class="type-detail mt-0.5">{{ item.because }}</p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <span v-if="item.at" class="type-mono-meta hidden sm:inline">{{ relativeTime(item.at) }}</span>
          <UButton
            v-if="item.action"
            :label="item.action.label"
            size="xs"
            variant="soft"
            :loading="busy === item.key"
            :disabled="busy !== null && busy !== item.key"
            @click="resolve(item)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>
