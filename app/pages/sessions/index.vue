<script setup lang="ts">
/**
 * Merged into Work, which lists sessions and runs together.
 *
 * Kept as a redirect rather than deleted: /sessions is the most-linked path in
 * the app — the sidebar of older builds, toasts, bookmarks, and every "see your
 * sessions" empty state.
 */
await navigateTo({ path: '/work', query: { origin: 'session' } }, { replace: true })
</script>
