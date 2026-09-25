<script setup lang="ts">
import { useView3dStore } from '@/modules/view3d'

const view3dStore = useView3dStore()
const registerDialHost = (el: any): void => { view3dStore.registerDialHost(el) }
</script>

<template>
  <div class="three-side-panel attitude-panel">
    <div :ref="registerDialHost" class="attitude-canvas"></div>
  </div>
</template>
