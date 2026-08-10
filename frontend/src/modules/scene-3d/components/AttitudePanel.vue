<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useScene3dStore } from '@/modules/scene-3d'

const threeStore = useScene3dStore()
const { three } = storeToRefs(threeStore)
const registerThreeAttitude = (el: any): void => { threeStore.registerThreeAttitude(el) }
</script>

<template>
  <div class="three-side-panel attitude-panel">
    <div :ref="registerThreeAttitude" class="attitude-canvas"></div>
  </div>
</template>
