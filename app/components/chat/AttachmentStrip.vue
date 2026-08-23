<script setup lang="ts">
import { attachmentSrc, formatBytes } from '~/utils/imageAttachments'
import type { ChatAttachment, ChatAttachmentRef } from '~/types'

/**
 * The images going with a message, as chips above the box you typed it in.
 *
 * One component rather than markup in each composer. There are three of them
 * now — the assistant panel, the studio's test box and a session — and the
 * thing that would have drifted first is whether a chip can be removed at all.
 *
 * Also draws an attachment read back from a record, which has a name and a size
 * and no bytes: the thumbnail becomes an icon and `removable` is off. That is
 * what a turn in a session's history is, and it is worth saying "this came with
 * two images" rather than showing the words alone.
 */
const props = defineProps<{
  attachments: ChatAttachment[] | ChatAttachmentRef[]
  /** Off for a record. There is nothing to take back out of something sent. */
  removable?: boolean
  /** `sm` for history, where the chip sits inside a turn rather than above one. */
  size?: 'sm' | 'md'
}>()

const emit = defineEmits<{ remove: [id: string] }>()

const box = computed(() => (props.size === 'sm' ? 'size-9' : 'size-14'))
</script>

<template>
  <div
    v-if="attachments.length"
    class="flex flex-wrap gap-2"
  >
    <div
      v-for="attachment in attachments"
      :key="attachment.id"
      class="relative group rounded-lg overflow-hidden shrink-0"
      style="border: 1px solid var(--border-subtle); background: var(--badge-subtle-bg)"
      :title="`${attachment.name} · ${formatBytes(attachment.size)}`"
    >
      <img
        v-if="attachmentSrc(attachment)"
        :src="attachmentSrc(attachment)!"
        :alt="attachment.name"
        class="object-cover"
        :class="box"
      >
      <div
        v-else
        class="flex items-center justify-center"
        :class="box"
      >
        <UIcon
          name="i-lucide-image"
          class="size-4"
          style="color: var(--text-disabled)"
        />
      </div>
      <button
        v-if="removable"
        class="absolute top-0.5 right-0.5 rounded-full p-0.5 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
        style="background: var(--surface-base); color: var(--text-secondary)"
        :title="`Remove ${attachment.name}`"
        @click="emit('remove', attachment.id)"
      >
        <UIcon
          name="i-lucide-x"
          class="size-3"
        />
      </button>
    </div>
  </div>
</template>
