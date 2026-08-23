<script setup lang="ts">
import { isSendKey } from "~/utils/keys";
import { IMAGE_MEDIA_TYPES, imageMediaType } from "~/utils/imageAttachments";
import type { ChatAttachment } from "~/types";

const props = defineProps<{
  modelValue: string;
  placeholder: string;
  disabled: boolean;
  isStreaming: boolean;
  projectDisplayPath: string | null;
  /** Images already on this message. Read-only here — the panel owns them. */
  attachments?: ChatAttachment[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
  /**
   * Pasted or picked. A file *dropped* in does not come through here — the whole
   * surface catches those, see `useChatAttachments`.
   */
  attach: [files: File[]];
  remove: [id: string];
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const attached = computed(() => props.attachments ?? []);

/** An image on its own is a message, so it is enough to enable the button. */
const canSend = computed(() => Boolean(props.modelValue.trim()) || attached.value.length > 0);

function autoResize() {
  const el = inputRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function handleKeydown(e: KeyboardEvent) {
  // Already behaved this way; going through the shared rule so it picks up the
  // input-method guard and cannot drift from the other boxes later.
  if (isSendKey(e)) {
    e.preventDefault();
    emit("send");
  }
}

/**
 * ⌘V of a screenshot, which is how this gets used nearly every time.
 *
 * Only the image files are taken, and only then is the paste swallowed: a
 * clipboard carrying both text and an image — copying a cell out of a
 * spreadsheet does this — still pastes its text.
 */
function handlePaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files ?? []).filter(file => imageMediaType(file));
  if (!files.length) return;

  e.preventDefault();
  emit("attach", files);
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) emit("attach", files);
  // Cleared so picking the same file twice in a row still fires `change`.
  input.value = "";
}

function focus() {
  inputRef.value?.focus();
}

function resetHeight() {
  if (inputRef.value) inputRef.value.style.height = "auto";
}

defineExpose({ focus, resetHeight });
</script>

<template>
  <div class="shrink-0 px-5 pb-5 pt-2">
    <div
      class="relative rounded-xl transition-all duration-200"
      :style="{
        background: 'var(--surface-raised)',
        border: isStreaming
          ? '1px solid var(--accent-muted)'
          : '1px solid var(--border-subtle)',
        boxShadow: isStreaming
          ? '0 0 20px var(--accent-glow), 0 2px 8px var(--card-shadow)'
          : '0 2px 8px var(--card-shadow)',
      }"
    >
      <!-- What is going with the next message -->
      <ChatAttachmentStrip
        v-if="attached.length"
        class="px-3 pt-3"
        :attachments="attached"
        removable
        @remove="(id: string) => emit('remove', id)"
      />

      <textarea
        ref="inputRef"
        :value="modelValue"
        rows="1"
        class="w-full resize-none bg-transparent fs-base outline-none px-4 pt-3 pb-10"
        style="
          color: var(--text-primary);
          font-family: var(--font-sans);
          max-height: 120px;
        "
        :placeholder="placeholder"
        :disabled="disabled"
        @keydown="handleKeydown"
        @paste="handlePaste"
        @input="
          (e) => {
            emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
            autoResize();
          }
        "
      />

      <div
        class="absolute bottom-2.5 left-3 right-3 flex items-center justify-between"
      >
        <span
          class="fs-micro font-mono flex items-center gap-1.5"
          style="color: var(--text-disabled)"
        >
          <template v-if="projectDisplayPath">
            <UIcon
              name="i-lucide-folder"
              class="size-3"
              style="color: var(--accent)"
            />
            <span class="truncate max-w-[120px]">{{ projectDisplayPath }}</span>
            <span>&middot;</span>
          </template>
          &#x23CE; Send &middot; &#x21E7;&#x23CE; New line &middot; Paste or drop an image
        </span>

        <div class="flex items-center gap-1.5">
          <input
            ref="fileInput"
            type="file"
            multiple
            :accept="IMAGE_MEDIA_TYPES.join(',')"
            class="hidden"
            @change="onPick"
          >
          <button
            class="p-1.5 rounded-md transition-all hover-bg"
            style="color: var(--text-tertiary)"
            title="Attach an image"
            :disabled="disabled"
            @click="fileInput?.click()"
          >
            <UIcon
              name="i-lucide-paperclip"
              class="size-3"
            />
          </button>
          <button
            v-if="isStreaming"
            class="p-1.5 rounded-md transition-all"
            style="background: var(--error); color: white"
            title="Stop"
            @click="emit('stop')"
          >
            <UIcon
              name="i-lucide-square"
              class="size-3"
            />
          </button>
          <button
            v-else
            class="p-1.5 rounded-md transition-all duration-200"
            :style="{
              background: canSend ? 'var(--accent)' : 'var(--badge-subtle-bg)',
              color: canSend ? 'white' : 'var(--text-disabled)',
              boxShadow: canSend ? '0 0 12px var(--accent-glow)' : 'none',
            }"
            :disabled="!canSend"
            @click="emit('send')"
          >
            <UIcon
              name="i-lucide-arrow-up"
              class="size-3"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
