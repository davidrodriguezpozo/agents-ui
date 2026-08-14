<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Agent, AgentFrontmatter } from "~/types";

const props = defineProps<{
  mode: "create" | "edit";
  initial?: Agent;
  template?: { frontmatter: AgentFrontmatter; body: string };
}>();

const emit = defineEmits<{
  saved: [agent: Agent];
  cancel: [];
}>();

const { create, update } = useAgents();
const toast = useToast();
const saving = ref(false);
const submitted = ref(false);

const source = props.initial || props.template;

const frontmatter = ref<AgentFrontmatter>({
  name: source?.frontmatter.name || "",
  description: source?.frontmatter.description || "",
  model: source?.frontmatter.model,
  color: source?.frontmatter.color,
  memory: source?.frontmatter.memory,
});

const body = ref(source?.body || "");

const errors = computed(() => {
  const e: Record<string, string> = {};
  if (!frontmatter.value.name.trim()) e.name = "Name is required";
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(frontmatter.value.name.trim()))
    e.name =
      "Names can only contain lowercase letters, numbers, and hyphens (e.g., marketing-agent)";
  if (!frontmatter.value.description.trim())
    e.description = "Description is required";
  return e;
});

const isValid = computed(() => Object.keys(errors.value).length === 0);

function fieldError(field: string) {
  return submitted.value ? errors.value[field] : undefined;
}

async function save() {
  submitted.value = true;
  if (!isValid.value) return;

  saving.value = true;
  try {
    const isEdit = props.mode === "edit" && props.initial;
    const agent = isEdit
      ? await update(props.initial!.slug, {
          frontmatter: frontmatter.value,
          body: body.value,
        })
      : await create({ frontmatter: frontmatter.value, body: body.value });
    toast.add({
      title: isEdit ? "Agent updated" : "Agent created",
      color: "success",
    });
    emit("saved", agent);
  } catch (e: any) {
    toast.add({
      title: `Failed to ${props.mode} agent`,
      description: errorMessage(e),
      color: "error",
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="p-6 space-y-4 bg-overlay modal-panel flex flex-col w-fit">
    <h3 class="text-page-title">
      {{ mode === "edit" ? "Edit Agent" : "New Agent" }}
    </h3>
    <p class="fs-sm leading-relaxed text-label">
      Agents are specialized AI assistants with custom instructions. Give yours
      a name and describe when it should be used.
    </p>

    <div class="flex sm:grid-cols-2 gap-4">
      <div class="field-group">
        <label
          class="field-label"
          data-required
          >Name</label
        >
        <input
          v-model="frontmatter.name"
          class="field-input"
          :class="{ 'field-input--error': fieldError('name') }"
          placeholder="my-agent"
        />
        <span
          v-if="fieldError('name')"
          class="field-error"
          >{{ fieldError("name") }}</span
        >
        <span
          v-else
          class="field-hint"
          >This is used as an identifier (e.g., marketing-agent)</span
        >
      </div>

      <div class="field-group">
        <label class="field-label">Model</label>
        <div class="pill-picker">
          <button
            type="button"
            class="pill-picker__option"
            :class="{ 'pill-picker__option--active': !frontmatter.model }"
            @click="frontmatter.model = undefined"
          >
            none
          </button>
          <button
            type="button"
            class="pill-picker__option pill-picker__option--opus"
            :class="{
              'pill-picker__option--active': frontmatter.model === 'opus',
            }"
            @click="frontmatter.model = 'opus'"
          >
            opus
          </button>
          <button
            type="button"
            class="pill-picker__option pill-picker__option--sonnet"
            :class="{
              'pill-picker__option--active': frontmatter.model === 'sonnet',
            }"
            @click="frontmatter.model = 'sonnet'"
          >
            sonnet
          </button>
          <button
            type="button"
            class="pill-picker__option pill-picker__option--haiku"
            :class="{
              'pill-picker__option--active': frontmatter.model === 'haiku',
            }"
            @click="frontmatter.model = 'haiku'"
          >
            haiku
          </button>
        </div>
      </div>
    </div>

    <div class="field-group">
      <label
        class="field-label"
        data-required
        >Description</label
      >
      <textarea
        v-model="frontmatter.description"
        rows="2"
        class="field-textarea"
        :class="{ 'field-input--error': fieldError('description') }"
        placeholder="When to use this agent..."
      />
      <span
        v-if="fieldError('description')"
        class="field-error"
        >{{ fieldError("description") }}</span
      >
    </div>

    <div class="field-group">
      <label class="field-label">Instructions</label>
      <span class="field-hint"
        >Tell this agent how it should behave, what tone to use, and what rules
        to follow.</span
      >
      <textarea
        v-model="body"
        class="editor-textarea editor-textarea--standalone"
        spellcheck="false"
        placeholder="Tell this agent how it should behave..."
      />
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <UButton
        label="Cancel"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="emit('cancel')"
      />
      <UButton
        :label="mode === 'edit' ? 'Save' : 'Create'"
        size="sm"
        :loading="saving"
        @click="save"
      />
    </div>
  </div>
</template>
