<script setup lang="ts">
defineProps<{
  statusText: string
}>()
</script>

<template>
  <div class="flex items-center gap-2 py-0.5">
    <div class="chat-wave">
      <span /><span /><span /><span /><span />
    </div>
    <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
      {{ statusText }}
    </span>
  </div>
</template>

<style scoped>
.chat-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 14px;
}
.chat-wave span {
  display: block;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}
.chat-wave span:nth-child(1) { animation: waveBar 0.8s ease-in-out 0s infinite; }
.chat-wave span:nth-child(2) { animation: waveBar 0.8s ease-in-out 0.15s infinite; }
.chat-wave span:nth-child(3) { animation: waveBar 0.8s ease-in-out 0.3s infinite; }
.chat-wave span:nth-child(4) { animation: waveBar 0.8s ease-in-out 0.45s infinite; }
.chat-wave span:nth-child(5) { animation: waveBar 0.8s ease-in-out 0.6s infinite; }

@keyframes waveBar {
  0%, 100% { height: 4px; opacity: 0.4; }
  50% { height: 12px; opacity: 1; }
}
</style>
