<script setup lang="ts">
import type { DigestRitual, DigestSession } from '~/composables/useDigest'
import { errorMessage } from '~/utils/errors'

/**
 * The morning report.
 *
 * Everything here already existed — ritual outcomes, session verdicts, spend,
 * the blocked count — in five places, none of which is the one you open first
 * thing. The product's claim is that you can leave it running and come back to
 * what it did; this is where that claim is either kept or not.
 *
 * Ordered by the question people actually ask first: did anything go wrong.
 * What worked comes after, quieter, because a working ritual needs no reading.
 */
const { digest, loading, load } = useDigest()
const { allowRules } = useSchedules()
const { describeRule } = usePermissionRuleLabels()
const toast = useToast()

const granting = ref<string | null>(null)
const granted = ref<Set<string>>(new Set())

onMounted(() => { if (!digest.value) void load() })

/**
 * Grant the narrow rules the run was refused, from here.
 *
 * The whole point of reporting a blocked ritual is that it will be blocked
 * again tomorrow. Saying so and then sending you to another page to do
 * something about it is most of a feature.
 */
async function onAllow(item: DigestRitual) {
  if (!item.suggestedRules?.length) return

  granting.value = item.scheduleId
  try {
    await allowRules(item.scheduleId, item.suggestedRules)
    granted.value = new Set([...granted.value, item.scheduleId])
    toast.add({
      title: `${item.title} can do that now`,
      description: 'It will not stop for these again. Nothing else was granted.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not allow that', description: errorMessage(e), color: 'error' })
  } finally {
    granting.value = null
  }
}

const RITUAL: Record<DigestRitual['outcome'], { icon: string; colour: string }> = {
  ok: { icon: 'i-lucide-circle-check', colour: 'var(--success)' },
  blocked: { icon: 'i-lucide-hand', colour: 'var(--warning)' },
  failed: { icon: 'i-lucide-circle-x', colour: 'var(--error)' },
  stopped: { icon: 'i-lucide-minus-circle', colour: 'var(--text-disabled)' },
  running: { icon: 'i-lucide-loader-2', colour: 'var(--accent)' },
}

const SESSION: Record<DigestSession['state'], { label: string; colour: string }> = {
  'needs-you': { label: 'needs you', colour: 'var(--error)' },
  ready: { label: 'ready to look at', colour: 'var(--success)' },
  working: { label: 'still going', colour: 'var(--accent)' },
  'nothing-yet': { label: 'nothing yet', colour: 'var(--text-disabled)' },
}

/** Problems first, and only what is worth reading. */
const troubled = computed(() => digest.value?.rituals.filter(r => r.problem) ?? [])
const worked = computed(() => digest.value?.rituals.filter(r => !r.problem) ?? [])
const wanted = computed(() => digest.value?.sessions.filter(s => s.state === 'needs-you') ?? [])
const produced = computed(() => digest.value?.sessions.filter(s => s.state === 'ready') ?? [])

const money = computed(() => {
  const total = digest.value?.costUsd ?? 0
  if (!total) return null
  return total < 0.01 ? '<$0.01' : `$${total.toFixed(2)}`
})
</script>

<template>
  <div v-if="loading && !digest" class="flex items-center gap-2 py-6">
    <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-meta" />
    <span class="type-meta">Working out what happened…</span>
  </div>

  <div v-else-if="digest" class="rounded-lg p-5 space-y-4 bg-card">
    <div class="flex items-baseline justify-between gap-3 flex-wrap">
      <h3 class="text-section-title">While you were away</h3>
      <span class="type-meta">
        Since {{ relativeTime(digest.since) }}<template v-if="money"> · {{ money }}</template>
      </span>
    </div>

    <!-- Nothing ran. Said plainly, because empty lists read as a broken page. -->
    <p v-if="digest.quiet" class="type-body">
      Nothing ran. No rituals were due and no session moved.
    </p>

    <template v-else>
      <!-- A ritual the scheduler gave up on is the loudest thing there is: it
           has stopped happening, and will keep not happening until you say so. -->
      <div v-for="item in digest.stopped" :key="item.id" class="flex items-start gap-2.5">
        <UIcon name="i-lucide-pause-circle" class="size-4 shrink-0 mt-0.5" style="color: var(--warning);" />
        <div class="flex-1 min-w-0">
          <NuxtLink to="/schedules" class="type-strong hover:underline">{{ item.title }}</NuxtLink>
          <span class="type-detail"> is no longer running — {{ item.reason }}</span>
        </div>
      </div>

      <div v-for="item in troubled" :key="item.scheduleId + item.at" class="flex items-start gap-2.5">
        <UIcon
          :name="RITUAL[item.outcome].icon"
          class="size-4 shrink-0 mt-0.5"
          :style="{ color: RITUAL[item.outcome].colour }"
        />
        <div class="flex-1 min-w-0">
          <NuxtLink to="/schedules" class="type-strong hover:underline">{{ item.title }}</NuxtLink>
          <p class="type-detail">{{ item.problem }}</p>

          <!--
            The fix, where the problem is reported. Naming the rules rather than
            counting them, because "allow 3 rules" asks you to trust a number.
          -->
          <!--
            `alreadyAllowed` comes from the server, `granted` from this page.
            Both are needed: the first survives a reload, the second answers
            immediately without waiting for the digest to be rebuilt. Before
            the first existed, granting worked and then offered itself again on
            every load, for good — the rules were on the ritual and nothing
            ever compared them against what the report was still asking for.
          -->
          <div
            v-if="item.suggestedRules?.length || item.alreadyAllowed"
            class="flex items-center gap-2 flex-wrap mt-1"
          >
            <template v-if="granted.has(item.scheduleId) || item.alreadyAllowed">
              <UIcon name="i-lucide-shield-check" class="size-3.5" style="color: var(--success);" />
              <span class="type-meta">Allowed. It will not stop for these again.</span>
            </template>
            <template v-else>
              <UButton
                label="Allow this from now on"
                icon="i-lucide-shield-check"
                size="xs"
                variant="soft"
                :loading="granting === item.scheduleId"
                :disabled="Boolean(granting)"
                @click="onAllow(item)"
              />
              <!-- Two of them, then a count. Five rule descriptions is a wall,
                   and the button is the thing being decided on. -->
              <span class="type-meta truncate">
                {{ (item.suggestedRules ?? []).slice(0, 2).map(describeRule).join(' · ')
                }}{{ (item.suggestedRules?.length ?? 0) > 2
                  ? ` · and ${(item.suggestedRules?.length ?? 0) - 2} more`
                  : '' }}
              </span>
            </template>
          </div>
        </div>
        <span class="type-meta shrink-0">{{ relativeTime(item.at) }}</span>
      </div>

      <div v-for="item in wanted" :key="item.id" class="flex items-start gap-2.5">
        <UIcon name="i-lucide-circle-alert" class="size-4 shrink-0 mt-0.5" style="color: var(--error);" />
        <div class="flex-1 min-w-0">
          <NuxtLink :to="`/sessions/${item.id}`" class="type-strong hover:underline">{{ item.title }}</NuxtLink>
          <p class="type-detail">
            {{ item.check === 'failing' ? 'Its checks do not pass.'
              : item.check === 'errored' ? 'Its checks could not run, so there is no verdict.'
              : 'Stopped waiting for a permission.' }}
          </p>
        </div>
      </div>

      <!-- What came out of it. Deliberately below the problems, and terser:
           work that went well needs acknowledging, not reading. -->
      <div v-if="produced.length" class="pt-1 space-y-2">
        <div v-for="item in produced" :key="item.id" class="flex items-start gap-2.5">
          <UIcon name="i-lucide-circle-check" class="size-4 shrink-0 mt-0.5" style="color: var(--success);" />
          <div class="flex-1 min-w-0">
            <NuxtLink :to="`/sessions/${item.id}`" class="type-strong hover:underline">{{ item.title }}</NuxtLink>
            <p v-if="item.summary" class="type-detail">{{ item.summary }}</p>
            <p v-if="item.behindBase" class="type-detail" style="color: var(--warning);">
              Verified before its base moved on — worth bringing it up to date first.
            </p>
          </div>
        </div>
      </div>

      <p v-if="worked.length" class="type-meta pt-1">
        {{ worked.length }} scheduled {{ worked.length === 1 ? 'run' : 'runs' }} went through
        without trouble.
      </p>
    </template>
  </div>
</template>
