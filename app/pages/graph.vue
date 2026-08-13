<script setup lang="ts">
import { VueFlow, Position, useVueFlow } from '@vue-flow/core'
import { Handle } from '@vue-flow/core'
import type { NodeMouseEvent } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { Relationship } from '~/types'
import { getAgentColor } from '~/utils/colors'

const { agents } = useAgents()
const { commands } = useCommands()
const { skills } = useSkills()
const { plugins } = usePlugins()
const router = useRouter()

const relationships = ref<Relationship[]>([])
const loading = ref(true)
const showLegend = ref(true)

onMounted(async () => {
  try {
    relationships.value = await $fetch<Relationship[]>('/api/relationships')
  } finally {
    loading.value = false
  }
})

// --- Layout constants ---
const NODE_WIDTH = 240
const COL_GAP = NODE_WIDTH + 80
const Y_GAP = 76
const HEADER_Y = -30

// --- Column labels ---
const columnLabels: Record<string, { label: string; icon: string }> = {
  command: { label: 'Commands', icon: '>_' },
  skill: { label: 'Skills', icon: 'zap' },
  agent: { label: 'Agents', icon: 'cpu' },
  plugin: { label: 'Plugins', icon: 'puzzle' },
}

// --- Connected node IDs (for orphan detection) ---
const connectedNodeIds = computed(() => {
  const ids = new Set<string>()
  for (const r of relationships.value) {
    ids.add(`${r.sourceType}-${r.sourceSlug}`)
    ids.add(`${r.targetType}-${r.targetSlug}`)
  }
  return ids
})

/**
 * Whether every skill and command a plugin brought gets its own node.
 *
 * Off by default, and this is the difference between a graph and a smear. With
 * it on there are 255 nodes, and the skills column alone is 199 × 76px ≈
 * 15,000px tall against a ~750px viewport. Fitting that needs a zoom of about
 * 0.05; `min-zoom` is 0.3. So `fit-view-on-init` was clamped an order of
 * magnitude short and the graph opened as an illegible column of slivers —
 * mathematically, not incidentally.
 *
 * A plugin is already a node. Its contents are a count on that node until
 * somebody asks for them.
 */
const showPluginContents = ref(false)

function fromPlugin(item: { source?: string }) {
  return item.source === 'plugin'
}

// --- Build columns dynamically ---
const columns = computed(() => {
  const cols: { type: string; items: any[] }[] = []

  const cmds = showPluginContents.value ? commands.value : commands.value.filter(c => !fromPlugin(c))
  const skls = showPluginContents.value ? skills.value : skills.value.filter(s => !fromPlugin(s))

  if (cmds.length > 0) cols.push({ type: 'command', items: cmds })
  if (skls.length > 0) cols.push({ type: 'skill', items: skls })
  if (agents.value.length > 0) cols.push({ type: 'agent', items: agents.value })
  if (plugins.value.length > 0) cols.push({ type: 'plugin', items: plugins.value })
  return cols
})

/** How much a plugin is hiding, for the label on its node. */
const hiddenCounts = computed(() => {
  const counts = new Map<string, number>()
  if (showPluginContents.value) return counts
  for (const list of [commands.value, skills.value]) {
    for (const item of list) {
      if (!fromPlugin(item) || !item.pluginId) continue
      counts.set(item.pluginId, (counts.get(item.pluginId) ?? 0) + 1)
    }
  }
  return counts
})

const nodes = computed(() => {
  const result: any[] = []

  columns.value.forEach((col, colIndex) => {
    const x = colIndex * COL_GAP + 40

    // Column header node (non-interactive)
    result.push({
      id: `header-${col.type}`,
      type: 'columnHeader',
      position: { x, y: HEADER_Y },
      data: { label: columnLabels[col.type]?.label ?? col.type, icon: columnLabels[col.type]?.icon },
      selectable: false,
      draggable: false,
      connectable: false,
    })

    col.items.forEach((item, i) => {
      const y = i * Y_GAP + 40
      const nodeId = col.type === 'plugin' ? `plugin-${item.id}` : `${col.type}-${item.slug}`
      const isOrphan = !connectedNodeIds.value.has(nodeId)

      if (col.type === 'agent') {
        result.push({
          id: nodeId,
          type: 'agent',
          position: { x, y },
          class: isOrphan ? 'graph-orphan' : '',
          data: {
            label: item.frontmatter.name,
            description: item.frontmatter.description,
            color: getAgentColor(item.frontmatter.color),
            model: item.frontmatter.model,
            slug: item.slug,
            orphan: isOrphan,
          },
        })
      } else if (col.type === 'command') {
        result.push({
          id: nodeId,
          type: 'command',
          position: { x, y },
          class: isOrphan ? 'graph-orphan' : '',
          data: {
            label: item.frontmatter.name,
            slug: item.slug,
            directory: item.directory,
            description: item.frontmatter.description,
            orphan: isOrphan,
          },
        })
      } else if (col.type === 'skill') {
        result.push({
          id: nodeId,
          type: 'skill',
          position: { x, y },
          class: isOrphan ? 'graph-orphan' : '',
          data: {
            label: item.frontmatter.name,
            description: item.frontmatter.description,
            slug: item.slug,
            orphan: isOrphan,
          },
        })
      } else if (col.type === 'plugin') {
        result.push({
          id: nodeId,
          type: 'plugin',
          position: { x, y },
          class: isOrphan ? 'graph-orphan' : '',
          data: {
            label: item.name,
            description: item.description,
            id: item.id,
            enabled: item.enabled,
            skillCount: item.skills.length,
            // What it is standing in for while its contents are folded away.
            hiddenCount: hiddenCounts.value.get(item.id) ?? 0,
            orphan: isOrphan,
          },
        })
      }
    })
  })

  return result
})

/**
 * `fit-view-on-init` fires once, when VueFlow mounts. The node set comes from
 * agents/commands/skills/plugins, which app.vue fetches — so on a cold load the
 * fit ran against an empty graph and never ran again. Folding the plugin
 * contents in or out changes the extent just as much.
 */
const { fitView } = useVueFlow()

watch(() => nodes.value.length, async (count, previous) => {
  if (!count || count === previous) return
  await nextTick()
  fitView({ padding: 0.15, duration: 200 })
})

const edgeRelationshipLabels: Record<string, string> = {
  spawns: 'spawns',
  'agent-frontmatter': 'uses agent',
  'spawned-by': 'invokes',
}

const edges = computed(() => {
  return relationships.value.map((r, i) => ({
    id: `edge-${i}`,
    source: `${r.sourceType}-${r.sourceSlug}`,
    target: `${r.targetType}-${r.targetSlug}`,
    type: 'smoothstep',
    animated: r.type === 'spawns',
    label: edgeRelationshipLabels[r.type] ?? r.type,
    labelStyle: { opacity: 0 },
    labelBgStyle: { opacity: 0 },
    data: { relType: r.type },
    style: {
      stroke: r.type === 'spawns' ? 'var(--accent)' : r.type === 'agent-frontmatter' ? 'var(--success)' : 'var(--text-disabled)',
      strokeWidth: r.type === 'spawns' ? 2 : 1.5,
      opacity: r.type === 'spawns' ? 0.7 : 0.4,
    },
  }))
})

// --- Hover highlighting ---
const hoveredNodeId = ref<string | null>(null)
const graphCanvasRef = ref<HTMLElement | null>(null)

const neighborMap = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const r of relationships.value) {
    const src = `${r.sourceType}-${r.sourceSlug}`
    const tgt = `${r.targetType}-${r.targetSlug}`
    if (!map.has(src)) map.set(src, new Set())
    if (!map.has(tgt)) map.set(tgt, new Set())
    map.get(src)!.add(tgt)
    map.get(tgt)!.add(src)
  }
  return map
})

const highlightedNodeIds = computed(() => {
  if (!hoveredNodeId.value) return new Set<string>()
  const neighbors = neighborMap.value.get(hoveredNodeId.value)
  const set = new Set<string>([hoveredNodeId.value])
  if (neighbors) neighbors.forEach(n => set.add(n))
  return set
})

const highlightedEdgeIds = computed(() => {
  if (!hoveredNodeId.value) return new Set<string>()
  const set = new Set<string>()
  relationships.value.forEach((r, i) => {
    const src = `${r.sourceType}-${r.sourceSlug}`
    const tgt = `${r.targetType}-${r.targetSlug}`
    if (src === hoveredNodeId.value || tgt === hoveredNodeId.value) {
      set.add(`edge-${i}`)
    }
  })
  return set
})

function onNodeMouseEnter({ node }: NodeMouseEvent) {
  if (node.id.startsWith('header-')) return
  hoveredNodeId.value = node.id
  applyHighlightClasses()
}

function onNodeMouseLeave() {
  hoveredNodeId.value = null
  clearHighlightClasses()
}

function applyHighlightClasses() {
  const el = graphCanvasRef.value
  if (!el) return

  el.classList.add('graph-dimmed')

  nextTick(() => {
    // Highlight nodes
    el.querySelectorAll('.vue-flow__node').forEach((nodeEl) => {
      const id = nodeEl.getAttribute('data-id')
      if (id && highlightedNodeIds.value.has(id)) {
        nodeEl.classList.add('graph-highlighted')
      } else {
        nodeEl.classList.remove('graph-highlighted')
      }
    })

    // Highlight edges + show labels
    el.querySelectorAll('.vue-flow__edge').forEach((edgeEl) => {
      const id = edgeEl.getAttribute('data-id')
      if (id && highlightedEdgeIds.value.has(id)) {
        edgeEl.classList.add('graph-edge-highlighted')
        const labelEl = edgeEl.querySelector('.vue-flow__edge-text') as HTMLElement | null
        const labelBgEl = edgeEl.querySelector('.vue-flow__edge-textbg') as HTMLElement | null
        if (labelEl) labelEl.style.opacity = '1'
        if (labelBgEl) labelBgEl.style.opacity = '1'
      } else {
        edgeEl.classList.remove('graph-edge-highlighted')
        const labelEl = edgeEl.querySelector('.vue-flow__edge-text') as HTMLElement | null
        const labelBgEl = edgeEl.querySelector('.vue-flow__edge-textbg') as HTMLElement | null
        if (labelEl) labelEl.style.opacity = '0'
        if (labelBgEl) labelBgEl.style.opacity = '0'
      }
    })
  })
}

function clearHighlightClasses() {
  const el = graphCanvasRef.value
  if (!el) return

  el.classList.remove('graph-dimmed')
  el.querySelectorAll('.graph-highlighted').forEach(e => e.classList.remove('graph-highlighted'))
  el.querySelectorAll('.graph-edge-highlighted').forEach(e => e.classList.remove('graph-edge-highlighted'))

  // Hide all edge labels
  el.querySelectorAll('.vue-flow__edge-text').forEach((e) => {
    ;(e as HTMLElement).style.opacity = '0'
  })
  el.querySelectorAll('.vue-flow__edge-textbg').forEach((e) => {
    ;(e as HTMLElement).style.opacity = '0'
  })
}

// --- Tooltip ---
const tooltip = ref<{ text: string; x: number; y: number } | null>(null)

function showTooltip(event: MouseEvent, description: string | undefined) {
  if (!description) return
  tooltip.value = {
    text: description,
    x: event.clientX + 12,
    y: event.clientY + 12,
  }
}

function hideTooltip() {
  tooltip.value = null
}

// Combined handlers
function handleNodeMouseEnter(payload: NodeMouseEvent) {
  onNodeMouseEnter(payload)
  const { event, node } = payload
  if (node.data?.description) showTooltip(event as MouseEvent, node.data.description)
}

function handleNodeMouseLeave() {
  onNodeMouseLeave()
  hideTooltip()
}

function onNodeClick({ node }: NodeMouseEvent) {
  if (node.type === 'agent') router.push(`/agents/${node.data.slug}`)
  else if (node.type === 'command') router.push(`/commands/${node.data.slug}`)
  else if (node.type === 'skill') router.push(`/skills/${node.data.slug}`)
  else if (node.type === 'plugin') router.push(`/plugins/${node.data.id}`)
}
</script>

<template>
  <div class="relative h-screen flex flex-col">
    <!-- Floats over the canvas, but the same height and type as every other page -->
    <PageHeader overlay title="Graph">
      <template #right>
        <span class="type-mono-meta">
          {{ nodes.filter(n => n.type !== 'columnHeader').length }} nodes
        </span>
        <span class="type-mono-meta">
          {{ edges.length }} edges
        </span>
        <button
          class="type-mono px-2 py-1 rounded focus-ring"
          style="background: var(--surface-raised); border: 1px solid var(--border-default);"
          :style="showPluginContents
            ? 'background: var(--accent-muted); border: 1px solid var(--accent-glow); color: var(--accent);'
            : 'background: var(--surface-raised); border: 1px solid var(--border-default);'"
          :title="showPluginContents
            ? 'Fold each plugin back down to one node'
            : 'Give every skill and command a plugin brought its own node — there are a lot of them'"
          @click="showPluginContents = !showPluginContents"
        >
          Plugin contents
        </button>
        <button
          class="type-mono px-2 py-1 rounded focus-ring"
          style="background: var(--surface-raised); border: 1px solid var(--border-default);"
          @click="showLegend = !showLegend"
        >
          {{ showLegend ? 'Hide' : 'Show' }} legend
        </button>
      </template>
    </PageHeader>

    <div v-if="loading" class="flex-1 flex items-center justify-center" style="background: var(--surface-base);">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin ink-4" />
    </div>

    <div v-else ref="graphCanvasRef" class="flex-1 graph-canvas">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        fit-view-on-init
        :default-edge-options="{ type: 'smoothstep' }"
        :min-zoom="0.05"
        :max-zoom="2"
        @node-click="onNodeClick"
        @node-mouse-enter="handleNodeMouseEnter"
        @node-mouse-leave="handleNodeMouseLeave"
      >
        <!-- Column header (non-interactive label) -->
        <template #node-columnHeader="{ data }">
          <div class="graph-col-header">
            <span class="graph-col-header__icon">
              <UIcon v-if="data.icon === 'zap'" name="i-lucide-zap" class="size-3.5" />
              <UIcon v-else-if="data.icon === 'cpu'" name="i-lucide-cpu" class="size-3.5" />
              <UIcon v-else-if="data.icon === 'puzzle'" name="i-lucide-puzzle" class="size-3.5" />
              <span v-else class="font-mono fs-micro font-bold">&gt;_</span>
            </span>
            {{ data.label }}
          </div>
        </template>

        <!-- Agent node -->
        <template #node-agent="{ data }">
          <Handle type="target" :position="Position.Left" class="graph-handle" />
          <Handle type="source" :position="Position.Right" class="graph-handle" />
          <div
            class="graph-node graph-node--agent"
            :class="{ 'graph-node--orphan': data.orphan }"
            :style="{
              '--node-accent': data.color,
              '--node-glow': `${data.color}25`,
              borderColor: data.orphan ? undefined : `${data.color}30`,
            }"
          >
            <div class="graph-node__accent-line" :style="{ background: data.color }" />
            <div class="flex items-center gap-2">
              <div class="size-2.5 rounded-full shrink-0" :style="{ background: data.color, boxShadow: `0 0 0 2px ${data.color}30` }" />
              <span class="font-mono fs-mono font-semibold truncate ink">
                {{ data.label }}
              </span>
            </div>
            <div v-if="data.model" class="mt-1.5 flex items-center">
              <span
                class="fs-micro font-mono font-medium px-1.5 py-px rounded-full"
                :style="{
                  background: data.model === 'opus' ? 'color-mix(in srgb, var(--model-opus) 15%, transparent)' : data.model === 'sonnet' ? 'color-mix(in srgb, var(--model-sonnet) 15%, transparent)' : 'var(--warning-tint)',
                  color: data.model === 'opus' ? 'var(--model-opus)' : data.model === 'sonnet' ? 'var(--model-sonnet)' : 'var(--model-haiku)',
                }"
              >
                {{ data.model }}
              </span>
            </div>
          </div>
        </template>

        <!-- Command node -->
        <template #node-command="{ data }">
          <Handle type="target" :position="Position.Left" class="graph-handle" />
          <Handle type="source" :position="Position.Right" class="graph-handle" />
          <div class="graph-node graph-node--command" :class="{ 'graph-node--orphan': data.orphan }">
            <div class="flex items-center gap-1.5">
              <span class="font-mono fs-micro font-bold shrink-0 ink-4">
                &gt;_
              </span>
              <span class="font-mono fs-mono truncate ink-2">
                /{{ data.label }}
              </span>
            </div>
          </div>
        </template>

        <!-- Skill node -->
        <template #node-skill="{ data }">
          <Handle type="target" :position="Position.Left" class="graph-handle" />
          <Handle type="source" :position="Position.Right" class="graph-handle" />
          <div class="graph-node graph-node--skill" :class="{ 'graph-node--orphan': data.orphan }">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-zap" class="size-3 shrink-0" style="color: var(--model-haiku);" />
              <span class="font-mono fs-mono font-medium truncate ink-2">
                {{ data.label }}
              </span>
            </div>
          </div>
        </template>

        <!-- Plugin node -->
        <template #node-plugin="{ data }">
          <Handle type="target" :position="Position.Left" class="graph-handle" />
          <Handle type="source" :position="Position.Right" class="graph-handle" />
          <div class="graph-node graph-node--plugin" :class="{ 'graph-node--orphan': data.orphan }">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-puzzle" class="size-3 shrink-0" style="color: var(--model-sonnet);" />
              <span class="font-mono fs-mono font-medium truncate ink-2">
                {{ data.label }}
              </span>
              <span
                class="ml-auto fs-micro font-mono px-1 py-px rounded-full shrink-0"
                :style="{
                  background: data.enabled ? 'var(--success-tint)' : 'var(--badge-subtle-bg)',
                  color: data.enabled ? 'var(--success)' : 'var(--text-disabled)',
                }"
              >
                {{ data.enabled ? 'on' : 'off' }}
              </span>
            </div>
            <div v-if="data.skillCount" class="fs-micro mt-1 ink-3">
              {{ data.skillCount }} skill{{ data.skillCount !== 1 ? 's' : '' }}
            </div>
          </div>
        </template>

        <Controls position="bottom-right" />
        <MiniMap position="top-right" :style="{ marginTop: '64px' }" />
      </VueFlow>

      <!-- Hover tooltip -->
      <div
        v-if="tooltip"
        class="graph-tooltip"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        {{ tooltip.text }}
      </div>

      <!-- Legend -->
      <Transition name="page">
        <div
          v-if="showLegend"
          class="absolute bottom-4 left-4 z-10 rounded-lg p-3.5 fs-mono space-y-2"
          style="background: color-mix(in srgb, var(--surface-base) 92%, transparent); backdrop-filter: blur(12px); border: 1px solid var(--border-default);"
        >
          <div class="font-mono font-semibold mb-2 ink-2">Legend</div>
          <div class="flex items-center gap-2">
            <div class="size-2.5 rounded-full" style="background: var(--accent);" />
            <span style="color: var(--text-tertiary);">Agent</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-mono fs-micro font-bold ink-4">&gt;_</span>
            <span style="color: var(--text-tertiary);">Command</span>
          </div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-zap" class="size-3" style="color: var(--model-haiku);" />
            <span style="color: var(--text-tertiary);">Skill</span>
          </div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-puzzle" class="size-3" style="color: var(--model-sonnet);" />
            <span style="color: var(--text-tertiary);">Plugin</span>
          </div>
          <hr style="border-color: var(--border-subtle);" />
          <div class="flex items-center gap-2">
            <div class="w-5 h-[2px] rounded-full" style="background: var(--accent);" />
            <span style="color: var(--text-tertiary);">Spawns / provides</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-5 h-[1px] rounded-full" style="background: var(--success); opacity: 0.5;" />
            <span style="color: var(--text-tertiary);">Uses</span>
          </div>
          <hr style="border-color: var(--border-subtle);" />
          <div class="flex items-center gap-2">
            <div class="size-3 rounded" style="border: 1px dashed var(--border-default); opacity: 0.55;" />
            <span style="color: var(--text-tertiary);">No connections</span>
          </div>
          <div class="mt-1 ink-4">
            Hover a node to highlight connections
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>
