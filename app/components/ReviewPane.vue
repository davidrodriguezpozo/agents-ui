<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * The review, composed and waiting for you to send it.
 *
 * A review session ends with findings in a conversation and the work of getting
 * them onto the pull request still to do — which was the last trip out of this
 * app that the workspace panes were built to remove. This is that trip.
 *
 * Everything here is editable and nothing leaves until the button. The agent
 * that wrote the review holds no way to post it; what goes out is this record,
 * sent by the server, after somebody read it. So the pane's job is to make
 * reading it fast: what will be said, where it will land, and what could not be
 * placed.
 */

const props = defineProps<{ sessionId: string }>()

type AnchorKind = 'inline' | 'file' | 'summary'
type Severity = 'BLOCKING' | 'WARN' | 'OK' | 'SKIP'
type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'

interface Finding {
  id: string
  location: string
  severity: Severity
  category: string
  body: string
  edited?: true
  suggestion?: string
  useSuggestion: boolean
  include: boolean
  anchor: { kind: AnchorKind; path?: string; line?: number; side?: string; reason?: string }
  alreadyRaised?: string
}

interface Draft {
  sessionId: string
  pr: number
  headSha: string
  baseRef: string
  event: ReviewEvent
  summary: string
  findings: Finding[]
  context?: string
  includeContext: boolean
  violations: string[]
  composedAt: number
  posted?: { at: number; url: string; event: ReviewEvent; comments: number }
}

interface Preview {
  event: ReviewEvent
  body: string
  comments: unknown[]
  folded: number
}

interface Payload {
  reviewable: boolean
  draft?: Draft | null
  preview?: Preview
  reason?: string
}

const draft = ref<Draft | null>(null)
const preview = ref<Preview | null>(null)
const reason = ref<string | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const sent = ref<{ url: string; comments: number; folded: number } | null>(null)
/** Which bodies are open for editing. Collapsed by default: this is a list to scan. */
const expanded = ref(new Set<string>())

const base = computed(() => `/api/sessions/${encodeURIComponent(props.sessionId)}/review`)

const included = computed(() => draft.value?.findings.filter(f => f.include) ?? [])
const inlineCount = computed(() => included.value.filter(f => f.anchor.kind !== 'summary').length)
const foldedCount = computed(() => included.value.filter(f => f.anchor.kind === 'summary').length)

const SEVERITY: Record<Severity, { colour: string; label: string }> = {
  BLOCKING: { colour: 'var(--error)', label: 'blocking' },
  WARN: { colour: 'var(--accent)', label: 'warning' },
  OK: { colour: 'var(--text-tertiary)', label: 'nit' },
  SKIP: { colour: 'var(--text-disabled)', label: 'skipped' },
}

/** What the row says about where its comment will land. */
function anchorNote(finding: Finding): string {
  if (finding.anchor.kind === 'inline') return `${finding.anchor.path}:${finding.anchor.line}`
  if (finding.anchor.kind === 'file') return `on ${finding.anchor.path} — ${finding.anchor.reason}`
  return `in the summary — ${finding.anchor.reason}`
}

async function load() {
  loading.value = true
  try {
    const payload = await $fetch<Payload>(base.value)
    draft.value = payload.draft ?? null
    preview.value = payload.preview ?? null
    reason.value = payload.reason ?? null
    if (draft.value?.posted) {
      sent.value = { url: draft.value.posted.url, comments: draft.value.posted.comments, folded: 0 }
    }
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

/**
 * Save what changed.
 *
 * The whole draft is sent rather than a delta, because the server recomputes the
 * preview from what it stored — so a save that only half arrived would leave the
 * preview describing something other than what would be posted.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
/**
 * The save in flight, so sending can wait for it.
 *
 * Without this, pressing the button within the debounce window sent the draft as
 * it was *before* the last keystroke — the review you read on screen and the
 * review that arrived would differ, and nothing would say so. The one failure
 * this pane cannot be allowed to have.
 */
let saving: Promise<void> | null = null

function save(immediate = false): Promise<void> {
  if (!draft.value || draft.value.posted) return Promise.resolve()
  if (saveTimer) clearTimeout(saveTimer)

  const send = async () => {
    if (!draft.value) return
    try {
      const payload = await $fetch<{ draft: Draft; preview: Preview }>(base.value, {
        method: 'PUT',
        body: {
          event: draft.value.event,
          summary: draft.value.summary,
          includeContext: draft.value.includeContext,
          findings: draft.value.findings.map(f => ({
            id: f.id,
            body: f.body,
            include: f.include,
            useSuggestion: f.useSuggestion,
          })),
        },
      })
      preview.value = payload.preview
      error.value = null
    } catch (e) {
      error.value = errorMessage(e)
    }
  }

  if (immediate) {
    saving = send()
    return saving
  }

  saveTimer = setTimeout(() => { saving = send() }, 600)
  return Promise.resolve()
}

/** Everything typed is on the server, including a debounce still counting down. */
async function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    saving = null
    await save(true)
    return
  }
  if (saving) await saving
}

async function recompose() {
  busy.value = true
  error.value = null
  try {
    const payload = await $fetch<{ draft: Draft; preview: Preview }>(`${base.value}/compose`, { method: 'POST' })
    draft.value = payload.draft
    preview.value = payload.preview
    reason.value = null
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

/**
 * Send it.
 *
 * Confirmed in words rather than with a dialog: the button already names the
 * count and the pull request, and a second click-through in front of an action
 * somebody came here specifically to take is the kind of gate people learn to
 * dismiss without reading.
 */
async function post() {
  busy.value = true
  error.value = null
  try {
    // Awaited, not fired: what is sent has to be what is on screen.
    await flush()
    const result = await $fetch<{ url: string; comments: number; folded: number }>(`${base.value}/post`, {
      method: 'POST',
    })
    sent.value = result
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

function toggleExpanded(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <div
      class="rounded-md overflow-hidden"
      style="border: 1px solid var(--border-subtle);"
    >
      <div
        class="px-4 py-2.5 flex items-center justify-between gap-3"
        style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
      >
        <span class="text-section-label">
          Review<span v-if="draft"> · #{{ draft.pr }}</span>
        </span>
        <span v-if="draft" class="type-mono-meta" style="color: var(--text-tertiary);">
          {{ draft.baseRef }}...{{ draft.headSha.slice(0, 12) }}
        </span>
      </div>

      <div class="px-4 py-3 space-y-3">
        <p v-if="loading" class="type-detail" style="color: var(--text-tertiary);">Reading the review…</p>

        <!-- Nothing to compose from yet. Not an error: a review that has not
             finished has not said anything to post. -->
        <p v-else-if="!draft" class="type-detail" style="color: var(--text-secondary);">
          {{ reason ?? 'There is no review here yet.' }}
        </p>

        <template v-else>
          <!-- Already sent. The pane becomes a record rather than a form. -->
          <div
            v-if="draft.posted"
            class="px-3 py-2 rounded"
            style="background: var(--success-wash); border: 1px solid var(--success-edge);"
          >
            <p class="type-detail" style="color: var(--text-primary);">
              Sent as {{ draft.posted.event === 'REQUEST_CHANGES' ? 'a request for changes' : draft.posted.event.toLowerCase() }}
              — {{ draft.posted.comments }}
              {{ draft.posted.comments === 1 ? 'comment' : 'comments' }}.
              <a
                :href="draft.posted.url"
                target="_blank"
                rel="noreferrer"
                class="underline"
                style="color: var(--accent);"
              >Read it on GitHub</a>
            </p>
          </div>

          <!--
            The report broke its own format. Shown rather than papered over,
            because the alternative is posting a five-word table cell as a
            review comment and nothing saying why it was so thin.
          -->
          <div
            v-if="draft.violations.length"
            class="px-3 py-2 rounded space-y-1"
            style="background: var(--error-wash); border: 1px solid var(--error-edge);"
          >
            <p class="type-detail" style="color: var(--text-primary);">
              {{ draft.violations.length === 1 ? 'One thing' : `${draft.violations.length} things` }}
              about the report itself:
            </p>
            <p
              v-for="(violation, i) in draft.violations"
              :key="i"
              class="type-detail"
              style="color: var(--text-secondary);"
            >
              {{ violation }}
            </p>
          </div>

          <!-- The findings. Checked ones are what gets posted. -->
          <p v-if="!draft.findings.length" class="type-detail" style="color: var(--text-secondary);">
            The review found nothing. The summary below is all there is to send.
          </p>

          <div v-else class="space-y-2">
            <div
              v-for="finding in draft.findings"
              :key="finding.id"
              class="rounded px-3 py-2 space-y-1.5"
              :style="{
                border: `1px solid ${finding.include ? 'var(--border-default)' : 'var(--border-subtle)'}`,
                opacity: finding.include ? 1 : 0.6,
              }"
            >
              <div class="flex items-start gap-2.5">
                <input
                  :id="`include-${finding.id}`"
                  v-model="finding.include"
                  type="checkbox"
                  class="mt-0.5 shrink-0"
                  :disabled="Boolean(draft.posted)"
                  @change="save(true)"
                >
                <div class="flex-1 min-w-0 space-y-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono type-detail truncate">{{ finding.location || 'unlocated' }}</span>
                    <span
                      class="type-mono-meta px-1.5 py-px rounded-full shrink-0"
                      :style="{ color: SEVERITY[finding.severity].colour, border: `1px solid ${SEVERITY[finding.severity].colour}` }"
                    >
                      {{ SEVERITY[finding.severity].label }}
                    </span>
                    <span class="type-mono-meta shrink-0" style="color: var(--text-disabled);">
                      {{ finding.category }}
                    </span>
                    <span v-if="finding.edited" class="type-mono-meta shrink-0" style="color: var(--accent);">
                      edited
                    </span>
                  </div>

                  <!--
                    Where the comment will land. The whole reason a review
                    composer works rather than failing on GitHub: a finding
                    aimed at a line outside the diff says so here, before it is
                    sent, rather than taking the other seven down with it.
                  -->
                  <p class="type-mono-meta" :style="{ color: finding.anchor.kind === 'inline' ? 'var(--text-tertiary)' : 'var(--accent)' }">
                    {{ anchorNote(finding) }}
                  </p>

                  <!-- Somebody already said this. Kept, unchecked, and named. -->
                  <p v-if="finding.alreadyRaised" class="type-detail" style="color: var(--text-tertiary);">
                    Already raised — {{ finding.alreadyRaised }}
                  </p>

                  <p
                    v-if="!expanded.has(finding.id)"
                    class="type-detail line-clamp-2 cursor-pointer"
                    style="color: var(--text-secondary);"
                    @click="toggleExpanded(finding.id)"
                  >
                    {{ finding.body }}
                  </p>
                  <textarea
                    v-else
                    v-model="finding.body"
                    rows="8"
                    class="w-full rounded px-2 py-1.5 font-mono"
                    style="background: var(--input-bg); border: 1px solid var(--border-subtle); font-size: var(--fs-sm);"
                    :disabled="Boolean(draft.posted)"
                    @input="save()"
                    @blur="save(true)"
                  />

                  <div class="flex items-center gap-3">
                    <button
                      class="type-mono-meta"
                      style="color: var(--text-disabled);"
                      @click="toggleExpanded(finding.id)"
                    >
                      {{ expanded.has(finding.id) ? 'Collapse' : 'Edit' }}
                    </button>

                    <!--
                      Off by default. The `Suggested fix` cell is prose, and
                      prose inside a suggestion block is a diff the author
                      cannot commit — so only a fenced block from the report is
                      ever offered here, and only when somebody asks for it.
                    -->
                    <label
                      v-if="finding.suggestion"
                      class="flex items-center gap-1.5 type-mono-meta cursor-pointer"
                      style="color: var(--text-disabled);"
                    >
                      <input
                        v-model="finding.useSuggestion"
                        type="checkbox"
                        :disabled="Boolean(draft.posted)"
                        @change="save(true)"
                      >
                      as a committable suggestion
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- The review body. -->
          <div class="space-y-1.5 pt-1">
            <label class="text-section-label" for="review-summary">Summary</label>
            <textarea
              id="review-summary"
              v-model="draft.summary"
              rows="4"
              class="w-full rounded px-2 py-1.5"
              style="background: var(--input-bg); border: 1px solid var(--border-subtle); font-size: var(--fs-sm);"
              :disabled="Boolean(draft.posted)"
              @input="save()"
              @blur="save(true)"
            />
            <p v-if="foldedCount" class="type-detail" style="color: var(--text-tertiary);">
              {{ foldedCount }}
              {{ foldedCount === 1 ? 'finding' : 'findings' }}
              could not be attached to a line and will be included here, named.
            </p>
            <label
              v-if="draft.context"
              class="flex items-center gap-1.5 type-mono-meta cursor-pointer"
              style="color: var(--text-disabled);"
            >
              <input
                v-model="draft.includeContext"
                type="checkbox"
                :disabled="Boolean(draft.posted)"
                @change="save(true)"
              >
              include what was reviewed and against what
            </label>
          </div>

          <!--
            Approve is offered, because refusing to offer it only moves that
            click to github.com. It is never the default: nothing derived from a
            machine reading a diff should arrive pre-selected as your approval.
          -->
          <div v-if="!draft.posted" class="flex items-center gap-3 flex-wrap pt-1">
            <label
              v-for="option in [
                { id: 'COMMENT' as const, label: 'Comment' },
                { id: 'REQUEST_CHANGES' as const, label: 'Request changes' },
                { id: 'APPROVE' as const, label: 'Approve' },
              ]"
              :key="option.id"
              class="flex items-center gap-1.5 type-detail cursor-pointer"
              style="color: var(--text-secondary);"
            >
              <input
                v-model="draft.event"
                type="radio"
                :value="option.id"
                @change="save(true)"
              >
              {{ option.label }}
            </label>
          </div>

          <div v-if="!draft.posted" class="flex items-center gap-2 pt-1">
            <button
              class="px-3 py-1.5 rounded fs-sm"
              style="background: var(--accent); color: white;"
              :disabled="busy || (!inlineCount && !draft.summary.trim())"
              @click="post"
            >
              {{ busy ? 'Sending…' : `Post ${inlineCount} ${inlineCount === 1 ? 'comment' : 'comments'} to #${draft.pr}` }}
            </button>
            <button
              class="px-3 py-1.5 rounded fs-sm"
              style="background: var(--input-bg); color: var(--text-secondary);"
              :disabled="busy"
              title="Read the session's newest report again. Anything you have rewritten is kept."
              @click="recompose"
            >
              Recompose
            </button>
          </div>
        </template>

        <p v-if="error" class="type-detail" style="color: var(--error);">{{ error }}</p>
      </div>
    </div>

    <!--
      What will actually be sent, assembled by the same code that sends it. A
      preview built separately is a preview that can lie about what you are
      about to say under your own name.
    -->
    <details v-if="preview && !draft?.posted" class="rounded-md" style="border: 1px solid var(--border-subtle);">
      <summary class="px-4 py-2.5 cursor-pointer text-section-label" style="background: var(--surface-raised);">
        The review body as it will arrive
      </summary>
      <pre
        class="px-4 py-3 whitespace-pre-wrap font-mono overflow-x-auto"
        style="font-size: var(--fs-sm); color: var(--text-secondary);"
      >{{ preview.body || '(empty)' }}</pre>
    </details>
  </div>
</template>
