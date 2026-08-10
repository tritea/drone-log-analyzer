<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
</script>

<template>
  <svg
    class="app-icon"
    :width="size || 16"
    :height="size || 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'plus'"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></template>
    <template v-else-if="name === 'folder'"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></template>
    <template v-else-if="name === 'settings'"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" /><path d="m19.4 15 .1-2 .1-2 2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15.2 3h-6.4l-.3 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5.1 2-.1 2-2 1.5 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.3 3.1h6.4l.3-3.1c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2.2-1.5Z" /></template>
    <template v-else-if="name === 'search'"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></template>
    <template v-else-if="name === 'chevron-right'"><polyline points="9 18 15 12 9 6" /></template>
    <template v-else-if="name === 'chevron-down'"><polyline points="6 9 12 15 18 9" /></template>
    <template v-else-if="name === 'upload'"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></template>
    <template v-else-if="name === 'download'"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></template>
    <template v-else-if="name === 'trash'"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></template>
    <template v-else-if="name === 'edit'"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></template>
    <template v-else-if="name === 'close'"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></template>
    <template v-else-if="name === 'eye'"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></template>
    <template v-else-if="name === 'play'"><polygon points="5 3 19 12 5 21 5 3" /></template>
    <template v-else-if="name === 'pause'"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></template>
    <template v-else-if="name === 'eye-off'"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></template>
    <template v-else-if="name === 'map-pin'"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></template>
    <template v-else-if="name === 'move'"><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></template>
    <template v-else-if="name === 'grid'"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></template>
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  vertical-align: middle;
  flex: 0 0 auto;
}
</style>
