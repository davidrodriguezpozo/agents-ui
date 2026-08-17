<script setup lang="ts">
import type { DigestRitual } from '~/composables/useDigest'

/**
 * The sources a run could not read, in the run's own words.
 *
 * Shared by the two bands that can show it — a run that only lost sources, and
 * a blocked one that lost sources as well — because they are the same fact and
 * a reader should not have to notice they are worded differently.
 *
 * The reasons are the model's prose, printed rather than interpreted. They are
 * better than anything this app could infer: "workspace hit its Query Data
 * Source usage limit mid-pull" says the source was there, answered, and then
 * stopped, and no permission model on this side knows that happened.
 */
defineProps<{ item: DigestRitual }>()

/**
 * A reason is a sentence the model wrote and can run to a paragraph. The first
 * one carries it; the rest is advice about a document you are one click from.
 */
function firstSentence(reason: string): string {
  const end = reason.search(/[.;](\s|$)/)
  return end === -1 ? reason : reason.slice(0, end + 1)
}
</script>

<template>
  <div class="min-w-0">
    <p class="type-meta ink-warn">{{ item.partial }}</p>
    <!--
      Named one per line rather than counted. Which source is missing decides
      whether it matters: a calendar that is out of reach every morning reads
      differently from a database that answered and then hit a usage limit, and
      a count of three cannot tell them apart.
    -->
    <p v-for="entry in item.skipped" :key="entry.source" class="type-meta">
      <span class="type-strong">{{ entry.source }}</span>
      <template v-if="entry.reason"> — {{ firstSentence(entry.reason) }}</template>
    </p>
  </div>
</template>
