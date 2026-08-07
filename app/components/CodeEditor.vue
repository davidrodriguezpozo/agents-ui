<script setup lang="ts">
import { languageFor, tokenize } from '~/utils/highlight'

/**
 * A textarea you can read.
 *
 * The colours come from a `<pre>` sitting exactly behind a transparent
 * textarea, which is the oldest trick there is for this and the only one that
 * keeps native editing — selection, undo, spellcheck, the caret, IME — working
 * as it should. A contenteditable would look the same and break all of it.
 *
 * The whole illusion rests on the two layers laying text out identically, so
 * every property that affects glyph position is set once in CSS on both, and
 * neither wraps: `pre` with a shared horizontal scroll means one line of file
 * is always one line on screen, which is also what makes the gutter line up.
 */

const props = defineProps<{
  modelValue: string
  /** Only used to choose the language, never read from disk. */
  path?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const input = ref<HTMLTextAreaElement | null>(null)
const highlight = ref<HTMLPreElement | null>(null)
const gutter = ref<HTMLDivElement | null>(null)

const language = computed(() => languageFor(props.path ?? ''))

const tokens = computed(() => tokenize(props.modelValue, language.value))

const lineCount = computed(() => {
  const lines = props.modelValue.split('\n').length
  return Math.max(lines, 1)
})

/** The three layers scroll as one, or the colours slide off the characters. */
function syncScroll() {
  const el = input.value
  if (!el) return

  if (highlight.value) {
    highlight.value.scrollTop = el.scrollTop
    highlight.value.scrollLeft = el.scrollLeft
  }
  if (gutter.value) gutter.value.scrollTop = el.scrollTop
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  // Typing past the right edge scrolls the textarea without firing `scroll`
  // in every browser, so the layers are re-aligned here too.
  nextTick(syncScroll)
}

/**
 * Tab inserts a tab rather than leaving the editor.
 *
 * Losing focus to the next control mid-line is the single most jarring thing a
 * plain textarea does to somebody editing code. `execCommand` is deprecated and
 * is still the only way to insert text without destroying the undo stack.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.shiftKey) return

  event.preventDefault()
  const el = event.target as HTMLTextAreaElement

  if (!document.execCommand('insertText', false, '  ')) {
    // Refused (some browsers, some contexts) — fall back to doing it by hand
    // and accept the undo-stack cost rather than swallowing the keystroke.
    const { selectionStart: start, selectionEnd: end, value } = el
    const next = `${value.slice(0, start)}  ${value.slice(end)}`
    emit('update:modelValue', next)
    nextTick(() => el.setSelectionRange(start + 2, start + 2))
  }
}
</script>

<template>
  <div class="code-editor">
    <div ref="gutter" class="code-editor__gutter" aria-hidden="true">
      <div v-for="n in lineCount" :key="n">{{ n }}</div>
    </div>

    <div class="code-editor__body">
      <!-- Behind the textarea, and never read by a screen reader: it is a
           duplicate of text the textarea already exposes. -->
      <!--
        The trailing newline is not decoration: a textarea reserves a line box
        after the last one and a `pre` does not, so without it the two layers
        differ in scroll height and the colours drift as you reach the bottom.
      -->
      <pre ref="highlight" class="code-editor__layer" aria-hidden="true"><span
        v-for="(token, i) in tokens"
        :key="i"
        :class="`tok-${token.type}`"
      >{{ token.text }}</span>{{ '\n' }}</pre>

      <textarea
        ref="input"
        class="code-editor__layer code-editor__input"
        :value="modelValue"
        :disabled="disabled"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        wrap="off"
        @input="onInput"
        @scroll="syncScroll"
        @keydown="onKeydown"
      />
    </div>
  </div>
</template>
