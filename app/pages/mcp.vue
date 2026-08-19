<script setup lang="ts">
/**
 * Folded into the Library, where the servers are a facet after the divider —
 * "what can Claude reach" is the question that page already answers, and MCP
 * did not need an eighth nav item to answer part of it.
 *
 * Kept as a redirect rather than deleted: this path is in bookmarks and in the
 * sidebar of older builds.
 */
await navigateTo({ path: '/library', query: { type: 'mcp' } }, { replace: true })
</script>
