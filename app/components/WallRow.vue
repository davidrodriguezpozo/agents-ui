<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { describeToolCall, presentVerb } from '~/utils/toolCalls'
import { sessionBadge } from '~/utils/sessionBadge'
import { elapsedLabel, landedLabel, urgencyOf, type WallPrompt, type WallRowData } from '~/utils/wall'

/**
 * One session, one line.
 *
 * The tile this replaces was built for a wall: two lines of title, a lot of air,
 * twelve of them at most. What this screen turned out to be used for is
 * orchestration — twenty sessions across four repositories, read at a desk, to
 * decide what to look at next — and for that, density is the feature. A row is
 * about a third the height of a tile and lines its columns up with its neighbours,
 * which is what makes twenty of them scannable rather than twenty things to read.
 *
 * **It can be acted on.** A row that says a session is blocked carries the answer
 * to the thing blocking it: the prompt, and the two or three buttons that resolve
 * it. That is the whole difference between a dashboard and a tool — the count was
 * always enough to *know*, and never enough to *do*, and the trip to the session
 * page to press the same buttons is the one this screen exists to save. Stopping a
 * turn is here for the same reason: it is the brake, and a brake you have to
 * navigate to is not a brake.
 *
 * **And right-clicked.** The buttons on the row are the two or three things worth
 * a permanent target; the rest of what you might want to do with a session —
 * open its pull request, take the branch name, go to the project it is in — are
 * real wants that do not each deserve a column on a row twenty of which have to
 * fit on a screen. A context menu is where those go.
 *
 * Nothing here decides anything: the row emits, and the page owns the requests. So
 * a row cannot answer a prompt twice, and the busy state belongs to whoever is
 * doing the waiting.
 */
const props = defineProps<{
  row: WallRowData
  /** Ticked once a second by the page, for the elapsed clock. */
  now: number
  /** Ids of prompts currently being answered, and whether a stop is in flight. */
  busy?: string[]
  stopping?: boolean
  /**
   * The right-click menu, built by the page.
   *
   * Built there and not here for the same reason nothing else on this row
   * decides anything: half the entries need facts a row does not carry — which
   * checkout a repository name refers to, whether that project is the one
   * currently selected — and all of the ones that write need the page to own the
   * request. See `sessionMenu` in `wall.vue`.
   */
  menu?: ContextMenuItem[][]
}>()

const emit = defineEmits<{
  answer: [prompt: WallPrompt, decision: { behavior: 'allow' | 'deny'; scope?: 'once' | 'session' }]
  stop: []
  /** Told to the page so Escape closes the menu instead of leaving the screen. */
  'menu-open': [open: boolean]
}>()

const urgency = computed(() => urgencyOf(props.row))

const TONES = {
  'needs-you': 'var(--accent)',
  broken: 'var(--error)',
  working: 'var(--accent)',
  settled: 'var(--text-disabled)',
} as const

/**
 * The verdict wording comes from `sessionBadge`, so a row and the session page it
 * points at can never disagree about whether the work is good. `changesUnknown`
 * is set only while the slower poll has not answered: once it has, the file count
 * is real and the badge may use it.
 */
const badge = computed(() => sessionBadge({
  activity: props.row.activity,
  check: props.row.check,
  checkStale: props.row.detail?.checkStale,
  changedFiles: props.row.detail?.changedFiles,
  changesUnknown: props.row.detail?.changedFiles === undefined,
  behind: props.row.detail?.behind,
  landed: Boolean(props.row.landedAt),
}))

/** What it is doing this second, or what it did, in the words a person would use. */
const activity = computed(() => {
  if (props.row.doing) {
    const call = describeToolCall({ toolName: props.row.doing.toolName, input: props.row.doing.input })
    return { text: `${call.verb} ${call.target}`.trim(), icon: call.icon, live: true }
  }

  if (props.row.landedAt) {
    return { text: landedLabel(props.row.landedHow ?? 'merged'), icon: 'i-lucide-git-merge', live: false }
  }

  // The sentence written from the diff, when there is one: what it *did* beats
  // what it was asked to do on a row somebody is triaging.
  if (props.row.detail?.summary) {
    return { text: props.row.detail.summary, icon: 'i-lucide-quote', live: false }
  }

  return { text: badge.value.label, icon: badge.value.icon, live: false }
})

const elapsed = computed(() => elapsedLabel(props.row.startedAt, props.now))

/** The prompt a blocked row offers to answer. The first is the one it is stuck on. */
const prompt = computed<WallPrompt | null>(() => props.row.prompts[0] ?? null)

/**
 * A question, not a tool call. Two buttons that say Allow and Deny are the
 * wrong pair for one — allowing it answers nothing — so the row says what it is
 * and sends you to the session, which is where a question can be answered.
 */
const asking = computed(() => Boolean(prompt.value?.questions?.length))

/**
 * What it is asking for, in the present tense — the thing has not happened yet,
 * which is the entire reason it is asking. See `presentVerb`.
 */
const promptText = computed(() => {
  if (!prompt.value) return ''
  const question = prompt.value.questions?.[0]?.question
  if (question) return `ask you: ${question}`
  const { target } = describeToolCall({ toolName: prompt.value.toolName, input: prompt.value.input })
  return `${presentVerb(prompt.value.toolName)} ${target}`.trim()
})

const answering = computed(() => Boolean(prompt.value && props.busy?.includes(prompt.value.id)))

function answer(behavior: 'allow' | 'deny', scope?: 'once' | 'session') {
  if (!prompt.value || answering.value) return
  emit('answer', prompt.value, { behavior, scope })
}
</script>

<template>
  <UContextMenu
    :items="menu"
    :disabled="!menu?.length"
    :content="{ collisionPadding: 8 }"
    @update:open="open => emit('menu-open', open)"
  >
    <div
      data-row
      tabindex="0"
      class="row focus-ring"
      :class="[`is-${urgency}`, { 'is-open': prompt }]"
      :style="{ '--row-tone': TONES[urgency] }"
    >
      <div class="row-line">
        <UIcon
          :name="badge.icon"
          class="row-glyph"
          :class="{ 'animate-spin': badge.spin }"
          :style="{ color: TONES[urgency] }"
        />

        <NuxtLink :to="`/sessions/${row.sessionId}`" class="row-where" :title="`${row.repo} · ${row.branch}`">
          <span class="row-repo">{{ row.repo }}</span>
          <span class="row-branch">{{ row.branch }}</span>
        </NuxtLink>

        <NuxtLink data-row-open :to="`/sessions/${row.sessionId}`" class="row-title" :title="row.title">
          {{ row.title }}
        </NuxtLink>

        <span class="row-activity" :class="{ 'is-live': activity.live }" :title="activity.text">
          <UIcon :name="activity.icon" class="row-activity-icon" />
          <span class="row-activity-text">{{ activity.text }}</span>
        </span>

        <!--
          The numbers, in fixed columns so twenty rows read down as well as across.
          A dash is not zero: it is "the slower poll has not answered", and on a
          screen used to choose what to look at next those are different facts.
        -->
        <span class="row-num" :title="row.detail?.changedFiles === undefined ? 'Not asked yet' : 'Files changed'">
          {{ row.detail?.changedFiles === undefined ? '·' : row.detail.changedFiles || '—' }}
        </span>
        <span
          class="row-num"
          :class="{ 'is-warn': (row.detail?.behind ?? 0) > 0 }"
          :title="row.detail?.behind ? `${row.detail.behind} commits behind its base` : 'Level with its base'"
        >{{ row.detail?.behind ? `↓${row.detail.behind}` : '·' }}</span>
        <span class="row-num" :title="`${row.turns} turns`">{{ row.turns }}</span>

        <span class="row-clock">{{ elapsed || '' }}</span>

        <span class="row-actions">
          <a v-if="row.prUrl" :href="row.prUrl" target="_blank" rel="noopener" class="row-action" title="Pull request">
            <UIcon name="i-lucide-git-pull-request" class="size-3.5" />
          </a>
          <button
            v-if="row.activity === 'working'"
            class="row-action"
            :disabled="stopping"
            title="Stop this turn — what it has written stays"
            @click.stop.prevent="emit('stop')"
          >
            <UIcon :name="stopping ? 'i-lucide-loader-2' : 'i-lucide-square'" class="size-3.5" :class="{ 'animate-spin': stopping }" />
          </button>
        </span>
      </div>

      <!--
        The second line, only for a row that is waiting on a person: what it wants,
        and the answer. `Always` appears only when the CLI proposed a narrow rule for
        it — inventing one from the arguments is how somebody grants more than they
        meant, which is the reasoning the session page's prompt already follows.
      -->
      <div v-if="prompt" class="row-prompt">
        <UIcon name="i-lucide-hand" class="row-prompt-icon" />
        <span class="row-prompt-text" :title="promptText">wants to {{ promptText }}</span>
        <span v-if="row.pending > 1" class="row-prompt-more">+{{ row.pending - 1 }} more</span>

        <span class="row-prompt-actions">
          <NuxtLink
            v-if="asking"
            class="row-answer is-allow"
            :to="`/sessions/${row.sessionId}`"
            @click.stop
          >Answer</NuxtLink>
          <template v-else>
            <button class="row-answer is-allow" :disabled="answering" @click.stop="answer('allow', 'once')">Allow</button>
            <button
              v-if="prompt.canRemember && prompt.rule"
              class="row-answer"
              :disabled="answering"
              :title="`Allow ${prompt.rule} for the rest of this run`"
              @click.stop="answer('allow', 'session')"
            >Always</button>
            <button class="row-answer is-deny" :disabled="answering" @click.stop="answer('deny')">Deny</button>
          </template>
        </span>
      </div>
    </div>
  </UContextMenu>
</template>

<style scoped>
.row {
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
}

.row:hover {
  background: var(--surface-hover);
}

.row-line {
  display: grid;
  grid-template-columns:
    16px                                  /* status */
    minmax(120px, 15%)                    /* repo · branch */
    minmax(140px, 1fr)                    /* title */
    minmax(140px, 30%)                    /* what it is doing */
    40px 46px 40px                        /* files, behind, turns */
    46px                                  /* clock */
    46px;                                 /* actions */
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  min-width: 0;
}

.row-glyph {
  width: 13px;
  height: 13px;
}

/* Identity is monospaced because it is scanned, not read. */
.row-where {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.row-repo {
  color: var(--text-secondary);
  white-space: nowrap;
}

.row-branch {
  color: var(--text-disabled);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-title {
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-title:hover, .row-where:hover .row-repo {
  text-decoration: underline;
}

.row-activity {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.row-activity.is-live {
  color: var(--text-secondary);
}

.row-activity-icon {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
}

.row-activity-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-num, .row-clock {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--text-tertiary);
}

.row-num.is-warn {
  color: var(--warning);
}

.row-clock {
  color: var(--row-tone);
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  /* Quiet until the row is under the cursor: on a screen of twenty rows, forty
     buttons competing with the words is a screen nobody can read. */
  opacity: 0;
  transition: opacity 0.12s ease;
}

.row:hover .row-actions, .row-actions:focus-within {
  opacity: 1;
}

.row-action {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--text-tertiary);
  cursor: pointer;
}

.row-action:hover {
  background: var(--badge-subtle-bg);
  color: var(--text-primary);
}

.row-action:disabled {
  cursor: default;
  opacity: 0.5;
}

/* ── The waiting row's second line ──────────────────────────────────────────── */

.row.is-open {
  background: var(--accent-muted);
}

.row.is-needs-you {
  box-shadow: inset 2px 0 0 var(--accent);
}

.row.is-broken {
  box-shadow: inset 2px 0 0 var(--error);
}

.row-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 10px 7px 39px;
}

.row-prompt-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--accent);
}

.row-prompt-text {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-prompt-more {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.row-prompt-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.row-answer {
  padding: 2px 9px;
  border-radius: 5px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  border: 1px solid var(--border-default);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}

/* The one that navigates is a link, so it needs saying that it is not underlined. */
a.row-answer {
  text-decoration: none;
}

.row-answer:hover:not(:disabled) {
  border-color: var(--border-emphasis);
  color: var(--text-primary);
}

.row-answer:disabled {
  cursor: default;
  opacity: 0.5;
}

.row-answer.is-allow {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--accent);
}

.row-answer.is-deny {
  border-color: color-mix(in srgb, var(--error) 35%, transparent);
  color: var(--error);
}
</style>
