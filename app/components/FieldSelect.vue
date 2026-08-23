<script setup lang="ts">
/**
 * The app's own select, because the browser's is not ours to style.
 *
 * `.field-select` was a native `<select>` with `appearance: none` and a chevron
 * painted on as a background image. The closed field looked right; everything
 * that happened after the click belonged to the operating system — a white
 * popup in system fonts, its own row height, a hard-coded grey chevron that
 * ignored both themes, and no room for the second line of text half of these
 * lists want. Sixteen of them across six screens, and the one moment somebody
 * is actually choosing something was the one moment the app stopped looking
 * like itself.
 *
 * **Focus never leaves the trigger.** The options are `role="option"` divs, not
 * buttons, and the active one is pointed at with `aria-activedescendant`. That
 * is the listbox pattern, and here it is also what keeps the menu working
 * inside the dialogs it opens in: Nuxt UI's modal traps focus in its panel, so
 * a menu that moved focus into a teleported element would be pulled back out
 * mid-click.
 *
 * **The menu is teleported to `<body>` and positioned `fixed`.** A dialog panel
 * scrolls (`.modal-panel`), and an absolutely positioned menu inside a scroll
 * container is clipped by it — the ritual editor's last two fields would have
 * opened into a sliver. Fixed is the only position that escapes an ancestor's
 * overflow, and escaping the ancestor means leaving its subtree too.
 *
 * **The keys are vim's.** `j`/`k` move, with counts (`3j`), `gg`/`G` go to the
 * ends, `⌃d`/`⌃u` move by half a page, `⌃n`/`⌃p` also move, `q` closes. Which
 * is why narrowing is `/` rather than just typing: a native select jumps to the
 * option starting with the letter you press, and that rule cannot coexist with
 * `j` meaning down. The footer names the layer, so it is not one nobody can see.
 */

export interface SelectOption {
  value: string | number
  label: string
  /** A second line, for when the label alone does not settle the choice. */
  hint?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string | number | null | undefined
  options: SelectOption[]
  /**
   * `field` is a form field, the same shape as the `.field-input` beside it.
   * `inline` is the small chip that sits in a header or toolbar next to a
   * button.
   */
  variant?: 'field' | 'inline'
  /** Shown when nothing in `options` matches `modelValue`. */
  placeholder?: string
  disabled?: boolean
  /** Right-aligns the menu under the trigger, for a chip near a window edge. */
  align?: 'start' | 'end'
}>(), {
  variant: 'field',
  placeholder: 'Choose…',
  disabled: false,
  align: 'start',
})

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

/*
 * Attributes land on the trigger, not on the wrapper — `aria-label` above all,
 * which every call site passes because a closed select shows a value and never
 * says what the value is for. Typed as a prop it would not survive vue-tsc:
 * `aria-label` is a known HTML attribute, so it is matched as one before it is
 * ever considered as a prop.
 */
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const label = computed(() => String(attrs['aria-label'] ?? ''))

const uid = useId()
const listboxId = `select-list-${uid}`
const optionId = (index: number) => `select-opt-${uid}-${index}`

const open = ref(false)
const active = ref(0)
const filtering = ref(false)
const filter = ref('')
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)

/** Digits typed while waiting for the motion they belong to — `3` then `j`. */
const count = ref('')
/** Whether the last key was `g`, so the next one can complete `gg`. */
const pendingG = ref(false)

const selected = computed(() =>
  props.options.find(option => option.value === props.modelValue) ?? null,
)

/**
 * Narrowing is advertised from ten options up, because that is where a list
 * stops being one you can see all of — the hour picker is twenty-four rows.
 * Below that `/` still works; the footer just does not mention it.
 */
const filterable = computed(() => props.options.length >= 10)

const matches = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (!needle) return props.options
  return props.options.filter(option =>
    `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle),
  )
})

/** Where the menu sits, in viewport coordinates. Set by `place()`. */
const position = ref({ top: 0, bottom: 0, left: 0, right: 0, minWidth: 180, maxHeight: 320, above: false })

/**
 * Below the trigger, unless the room below is both too small to be useful and
 * smaller than the room above — the only case where flipping helps. Never
 * taller than the space it has, so a long list scrolls inside the menu rather
 * than running off the bottom of the window.
 */
function place() {
  const el = trigger.value
  if (!el) return

  const rect = el.getBoundingClientRect()
  const gap = 6
  const margin = 12
  const below = window.innerHeight - rect.bottom - gap - margin
  const above = rect.top - gap - margin
  const flip = below < 180 && above > below

  position.value = {
    top: rect.bottom + gap,
    bottom: window.innerHeight - rect.top + gap,
    left: rect.left,
    right: window.innerWidth - rect.right,
    // A chip's menu is wider than the chip; a field's matches the field.
    minWidth: Math.max(rect.width, 200),
    maxHeight: Math.max(140, Math.min(340, flip ? above : below)),
    above: flip,
  }
}

const menuStyle = computed(() => ({
  top: position.value.above ? 'auto' : `${position.value.top}px`,
  bottom: position.value.above ? `${position.value.bottom}px` : 'auto',
  left: props.align === 'end' ? 'auto' : `${position.value.left}px`,
  right: props.align === 'end' ? `${position.value.right}px` : 'auto',
  '--select-menu-min-width': `${position.value.minWidth}px`,
  '--select-menu-max-height': `${position.value.maxHeight}px`,
}))

function openMenu() {
  if (props.disabled || !props.options.length) return

  filtering.value = false
  filter.value = ''
  count.value = ''
  pendingG.value = false
  // Opens on what is chosen, so the list starts where the eye already is.
  active.value = Math.max(props.options.findIndex(option => option.value === props.modelValue), 0)

  open.value = true
  place()
  scrollActiveIntoView()
}

function closeMenu() {
  open.value = false
  filtering.value = false
  filter.value = ''
  count.value = ''
  pendingG.value = false
}

function choose(index = active.value) {
  const option = matches.value[index]
  if (!option || option.disabled) return

  emit('update:modelValue', option.value)
  closeMenu()
  // Back to the trigger, so the next Tab carries on from this field rather
  // than from the top of the document.
  trigger.value?.focus()
}

function move(by: number) {
  const list = matches.value
  if (!list.length) return

  const step = Math.sign(by) || 1
  // Wraps: a list you can fall off the end of makes you look at it.
  let next = ((active.value + by) % list.length + list.length) % list.length
  // A disabled option is stepped over in the direction of travel rather than
  // landed on, so `j` never appears to do nothing.
  for (let i = 0; i < list.length && list[next]?.disabled; i++) {
    next = ((next + step) % list.length + list.length) % list.length
  }
  active.value = next
  scrollActiveIntoView()
}

function jump(to: number) {
  active.value = Math.max(0, Math.min(matches.value.length - 1, to))
  scrollActiveIntoView()
}

/**
 * After the render, not before it: `data-active` moves when Vue flushes, so
 * looking for it now finds the row the highlight has just left.
 */
function scrollActiveIntoView() {
  void nextTick(() => {
    menu.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

/** The count typed before a motion, or one. Consumed by being read. */
function takeCount() {
  const n = Number(count.value || '1')
  count.value = ''
  return Number.isFinite(n) && n > 0 ? n : 1
}

function onClosedKeydown(event: KeyboardEvent) {
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'j', 'k'].includes(event.key)) {
    event.preventDefault()
    openMenu()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) {
    onClosedKeydown(event)
    return
  }

  const key = event.key

  /*
   * Escape is swallowed rather than left to bubble: reaching the dialog around
   * this menu, it would close the whole half-filled form. The first one leaves
   * the filter — normal mode — and only a second one closes the list.
   */
  if (key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (filtering.value) {
      filtering.value = false
      filter.value = ''
      active.value = 0
    } else {
      closeMenu()
    }
    return
  }

  if (key === 'Enter' || (key === ' ' && !filtering.value)) {
    // Enter activates a button on keydown and Space on keyup, so both have to
    // be prevented here or the click that follows would toggle the menu shut
    // again on the way out.
    event.preventDefault()
    choose()
    return
  }

  if (key === 'Tab') {
    // A field left half-chosen commits nothing: Tab is "move on", not "pick".
    closeMenu()
    return
  }

  const half = Math.max(1, Math.floor(matches.value.length / 2))

  if (event.ctrlKey || event.metaKey) {
    if (key === 'n' || key === 'j') { event.preventDefault(); move(1) }
    else if (key === 'p' || key === 'k') { event.preventDefault(); move(-1) }
    else if (key === 'd') { event.preventDefault(); move(half) }
    else if (key === 'u') { event.preventDefault(); move(-half) }
    return
  }

  if (key === 'ArrowDown') { event.preventDefault(); move(takeCount()); return }
  if (key === 'ArrowUp') { event.preventDefault(); move(-takeCount()); return }
  if (key === 'Home') { event.preventDefault(); jump(0); return }
  if (key === 'End') { event.preventDefault(); jump(matches.value.length - 1); return }
  if (key === 'PageDown') { event.preventDefault(); move(half); return }
  if (key === 'PageUp') { event.preventDefault(); move(-half); return }

  // Once `/` is open the letters are the filter's, so the vim layer only owns
  // them while it is not.
  if (filtering.value) {
    if (key === 'Backspace') {
      event.preventDefault()
      filter.value = filter.value.slice(0, -1)
      active.value = 0
      return
    }
    if (key.length === 1) {
      event.preventDefault()
      filter.value += key
      active.value = 0
    }
    return
  }

  if (key === '/') {
    event.preventDefault()
    filtering.value = true
    active.value = 0
    return
  }

  if (key === 'q') { event.preventDefault(); closeMenu(); return }

  if (key === 'g') {
    event.preventDefault()
    if (pendingG.value) jump(0)
    pendingG.value = !pendingG.value
    return
  }
  pendingG.value = false

  if (key === 'G') { event.preventDefault(); jump(matches.value.length - 1); return }
  if (key === 'j') { event.preventDefault(); move(takeCount()); return }
  if (key === 'k') { event.preventDefault(); move(-takeCount()); return }

  // `0` is a motion in vim and a digit here only once a count has started.
  if (/^[1-9]$/.test(key) || (key === '0' && count.value)) {
    event.preventDefault()
    count.value += key
  }
}

/**
 * Closed by a pointer landing anywhere else, in the capture phase.
 *
 * Capture, because the menu stops its own pointer events from bubbling — a
 * dialog's dismiss layer would otherwise read a click on an option as a click
 * outside the dialog and close the whole thing. A bubble-phase listener here
 * would never hear about the clicks that matter.
 */
function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target as Node
  if (trigger.value?.contains(target) || menu.value?.contains(target)) return
  closeMenu()
}

/**
 * The menu is fixed to the viewport, so anything that moves the trigger within
 * it moves the trigger out from under the menu. Cheaper to follow than to
 * close, and closing on scroll is the behaviour people read as a bug.
 */
function onViewportChange() {
  if (open.value) place()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})

// An option list that changed under an open menu — a project added, refs
// arriving — must not leave the highlight past the end of it.
watch(matches, (list) => { if (active.value >= list.length) active.value = 0 })
</script>

<template>
  <div class="select" :class="{ 'select--block': variant === 'field' }">
    <button
      ref="trigger"
      type="button"
      role="combobox"
      class="select-trigger"
      :class="{ 'select-trigger--inline': variant === 'inline' }"
      v-bind="attrs"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      :aria-activedescendant="open ? optionId(active) : undefined"
      :disabled="disabled || !options.length"
      :data-open="open"
      @click="open ? closeMenu() : openMenu()"
      @keydown="onKeydown"
    >
      <span class="select-value" :class="{ 'select-value--empty': !selected }">
        {{ selected?.label ?? placeholder }}
      </span>
      <UIcon name="i-lucide-chevron-down" class="select-chevron" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        :id="listboxId"
        ref="menu"
        role="listbox"
        class="select-menu"
        :aria-label="label"
        :style="menuStyle"
        @pointerdown.prevent.stop
      >
        <div v-if="filtering" class="select-filter">
          <UIcon name="i-lucide-search" class="select-filter-icon" />
          <span class="select-filter-text" :data-empty="!filter">
            {{ filter || 'type to narrow' }}
          </span>
        </div>

        <div class="select-list">
          <div
            v-for="(option, index) in matches"
            :id="optionId(index)"
            :key="option.value"
            role="option"
            class="select-option"
            :data-active="index === active"
            :data-selected="option.value === modelValue"
            :aria-selected="option.value === modelValue"
            :aria-disabled="option.disabled || undefined"
            @pointerenter="active = index"
            @click="choose(index)"
          >
            <UIcon name="i-lucide-check" class="select-check" :data-shown="option.value === modelValue" />
            <span class="select-option-body">
              <span class="select-option-label">{{ option.label }}</span>
              <span v-if="option.hint" class="select-option-hint">{{ option.hint }}</span>
            </span>
          </div>

          <div v-if="!matches.length" class="select-empty">
            Nothing here matches “{{ filter }}”
          </div>
        </div>

        <div class="select-footer">
          j/k to move · ↵ to pick{{ filterable ? ' · / to narrow' : '' }} · esc to leave
        </div>
      </div>
    </Teleport>
  </div>
</template>
