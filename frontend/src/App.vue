<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import HomeView from '@/views/Home/index.vue'
import { appMounted, appBeforeUnmount } from '@/lifecycle'

onMounted(() => appMounted())
onBeforeUnmount(() => appBeforeUnmount())
</script>

<template>
  <HomeView />
</template>
