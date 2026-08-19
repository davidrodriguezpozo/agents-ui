<script setup lang="ts">
/**
 * A shell on the Work view, in the project you already have selected.
 *
 * The only shell in this app used to be inside a session, which meant that
 * running `git status` against the repository you were looking at started with
 * creating a session to hold a prompt. Work is the page you stand on between
 * sessions and the one that already knows which project you mean, so the shell
 * belongs here.
 *
 * Docked to the bottom rather than placed in the page, because it is a thing
 * you keep open while you read the rest: a panel in the flow scrolls away the
 * moment you go looking at the sessions it was meant to be helping with.
 */

const { workingDir, displayPath } = useWorkingDir()
const { nameFor } = useProjects()
const { open, height, minHeight, maxHeight, setOpen, setHeight } = useWorkTerminal()

const status = ref<'connecting' | 'live' | 'ended'>('connecting')
const pane = ref<{ focus: () => void; clear: () => void; closeShell: () => Promise<void>; openFind: () => void } | null>(null)

/**
 * A shell per project, and every one of them kept.
 *
 * `opened` is what makes switching projects cheap: the pane for a project you
 * have already been in stays mounted and is merely hidden, so its SSE
 * connection, its scrollback and its selection all survive the trip. Mounting a
 * fresh pane instead would reattach, replay the whole scrollback, and lose
 * whatever was half-typed at the prompt. The session view uses the same trick
 * for its four panes.
 */
const opened = ref<Set<string>>(new Set())

watchEffect(() => {
  if (open.value && workingDir.value) opened.value.add(workingDir.value)
})

const projectName = computed(() => (workingDir.value ? nameFor(workingDir.value) : ''))

function urls(dir: string) {
  return {
    post: '/api/terminal',
    // A query parameter rather than the usual `x-project-dir` header, because
    // `EventSource` cannot send headers. The server accepts either.
    stream: `/api/terminal/stream?projectDir=${encodeURIComponent(dir)}`,
  }
}

/**
 * Dragging the top edge.
 *
 * Same shape as the session view's divider: listeners on `window` rather than
 * the handle, because the pointer routinely leaves a 6px strip mid-drag and a
 * handle-scoped `mousemove` drops the gesture the instant it does. `select-none`
 * on the body for the duration, or the drag paints the page blue.
 */
const dragging = ref(false)
let startY = 0
let startHeight = 0

function startDrag(event: MouseEvent) {
  dragging.value = true
  startY = event.clientY
  startHeight = height.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'ns-resize'
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}

function onDrag(event: MouseEvent) {
  // Upwards is taller, so the delta is inverted.
  setHeight(startHeight + (startY - event.clientY))
}

function endDrag() {
  dragging.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
}

onBeforeUnmount(endDrag)

/** The same gesture from the keyboard, for anyone not using a mouse. */
function nudge(delta: number) {
  setHeight(height.value + delta)
}

async function closeShell() {
  await pane.value?.closeShell()
}

const statusLabel = computed(() => (
  status.value === 'live' ? 'running' : status.value === 'ended' ? 'closed' : 'starting…'
))
</script>

<template>
  <!-- Nothing to open a shell in until a project is chosen. -->
  <div
    v-if="open && workingDir"
    class="terminal-dock"
    :style="{ height: `${height}px` }"
  >
    <div
      class="dock-handle"
      :class="{ 'dock-handle--active': dragging }"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      tabindex="0"
      @mousedown.prevent="startDrag"
      @keydown.up.prevent="nudge(32)"
      @keydown.down.prevent="nudge(-32)"
    />

    <div class="dock-header">
      <UIcon name="i-lucide-square-terminal" class="size-3.5 shrink-0" style="color: var(--text-tertiary);" />
      <span class="text-section-label">{{ projectName || 'Terminal' }}</span>
      <span class="type-meta truncate">{{ displayPath }}</span>

      <span class="dock-status" :class="`dock-status--${status}`" />
      <span class="type-meta">{{ statusLabel }}</span>

      <div class="flex-1" />

      <UButton
        icon="i-lucide-search"
        size="xs"
        variant="ghost"
        color="neutral"
        title="Find in terminal (⌘F)"
        @click="pane?.openFind()"
      />
      <UButton
        icon="i-lucide-eraser"
        size="xs"
        variant="ghost"
        color="neutral"
        title="Clear screen (⌘K)"
        @click="pane?.clear()"
      />
      <UButton
        label="Close shell"
        size="xs"
        variant="ghost"
        color="neutral"
        :disabled="status === 'ended'"
        title="End whatever is running in it"
        @click="closeShell"
      />
      <UButton
        icon="i-lucide-chevron-down"
        size="xs"
        variant="ghost"
        color="neutral"
        title="Hide terminal (Ctrl+`)"
        @click="setOpen(false)"
      />
    </div>

    <div class="dock-body">
      <div
        v-for="dir in [...opened]"
        v-show="dir === workingDir"
        :key="dir"
        class="h-full"
      >
        <TerminalPane
          :ref="el => { if (dir === workingDir) pane = el as any }"
          :post-url="urls(dir).post"
          :stream-url="urls(dir).stream"
          :chrome="false"
          @status="value => { if (dir === workingDir) status = value }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Above the page, below the chat drawer.
 *
 * The chat panel is z-50 with a z-40 backdrop, and it is a modal thing you
 * opened on purpose; the terminal is furniture. Sitting under the backdrop is
 * the right answer for both.
 */
.terminal-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: #1e1e2e;
  border-top: 1px solid var(--border-subtle);
  box-shadow: 0 -8px 24px rgb(0 0 0 / 0.18);
}

.dock-handle {
  height: 5px;
  flex-shrink: 0;
  cursor: ns-resize;
  background: transparent;
  transition: background 120ms ease;
}

.dock-handle:hover,
.dock-handle:focus-visible,
.dock-handle--active {
  background: var(--ui-primary);
  outline: none;
}

.dock-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 12px;
  flex-shrink: 0;
  background: #181825;
  border-bottom: 1px solid #313244;
}

/* The header sits on the editor surface, which is dark in both app themes, so
   its text has to come from the editor palette rather than the page's. */
.dock-header :deep(.text-section-label) {
  color: #cdd6f4;
}

.dock-header :deep(.type-meta) {
  color: #7f849c;
}

.dock-status {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #6c7086;
}

.dock-status--live {
  background: #a6e3a1;
}

.dock-status--ended {
  background: #f38ba8;
}

.dock-body {
  flex: 1;
  min-height: 0;
}
</style>
