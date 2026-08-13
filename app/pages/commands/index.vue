<script setup lang="ts">
/**
 * Merged into the Library, which holds agents, commands and skills together —
 * the split between them was the system's rather than anybody's.
 *
 * Kept as a redirect rather than deleted: these paths are in bookmarks, in the
 * sidebar of older builds, and in `?tab=` links from the plugin pages.
 */
await navigateTo({ path: '/library', query: { type: 'commands' } }, { replace: true })
</script>
