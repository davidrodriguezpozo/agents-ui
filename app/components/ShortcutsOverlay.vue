<script setup lang="ts">
import {
  ACTION_SHORTCUTS, EDITOR_SHORTCUTS, JUMP_SHORTCUTS, LIST_SHORTCUTS,
  NAV_SHORTCUTS, PALETTE_SHORTCUTS,
} from '~/utils/shortcuts'

/**
 * `?`.
 *
 * A keyboard layer nobody can see is a keyboard layer nobody uses, and the
 * alternative — a hint line on every page — is how a screen ends up 30% legend.
 * One panel, one key, and the key is the one every app that has this uses.
 *
 * Built from the same tables the handler switches on, so a shortcut cannot be
 * documented here and missing there.
 */
const { shortcutsOpen: open } = useShortcuts()

const columns = computed(() => [
  { title: 'Do', rows: ACTION_SHORTCUTS },
  { title: 'In a list', rows: LIST_SHORTCUTS },
  { title: 'Jumplist', rows: JUMP_SHORTCUTS },
  { title: 'In ⌘K', rows: PALETTE_SHORTCUTS },
  { title: 'While editing', rows: EDITOR_SHORTCUTS },
])
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="modal-panel bg-overlay rounded-lg p-6 space-y-5">
        <div class="flex items-baseline gap-3 flex-wrap">
          <h2 class="fs-lg font-semibold" style="color: var(--text-primary); font-family: var(--font-display);">
            Keyboard
          </h2>
          <p class="type-meta">
            Anywhere that is not a text box — and never inside the terminal, which keeps every key.
          </p>
        </div>

        <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <section class="space-y-1.5">
            <div class="text-section-label">Go to</div>
            <p class="type-meta pb-1">
              Press <kbd class="kbd-key">g</kbd>, then the letter.
            </p>
            <div
              v-for="item in NAV_SHORTCUTS"
              :key="item.to"
              class="flex items-center gap-3 py-1"
            >
              <span class="flex items-center gap-1 shrink-0">
                <kbd class="kbd-key">g</kbd>
                <kbd class="kbd-key">{{ item.key }}</kbd>
              </span>
              <span class="type-detail">{{ item.label }}</span>
            </div>
          </section>

          <div class="space-y-5">
            <section
              v-for="column in columns"
              :key="column.title"
              class="space-y-1.5"
            >
              <div class="text-section-label">{{ column.title }}</div>
              <div
                v-for="item in column.rows"
                :key="item.keys"
                class="flex items-center gap-3 py-1"
              >
                <kbd class="kbd-key shrink-0">{{ item.keys }}</kbd>
                <span class="type-detail">{{ item.label }}</span>
              </div>
            </section>
          </div>
        </div>

        <p class="type-meta pt-3" style="border-top: 1px solid var(--border-subtle);">
          Ctrl and ⌘ are interchangeable for ⌘K, ⌘J and ⌘S. Everything spelled ⌃ is Ctrl on
          both platforms, because that is where those keys live in vim.
        </p>
      </div>
    </template>
  </UModal>
</template>
