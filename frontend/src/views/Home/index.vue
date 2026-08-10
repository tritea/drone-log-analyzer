<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/modules/shared/ui-store'
import { useLogStore } from '@/modules/log'
import DataSidebar from '@/views/Home/components/DataSidebar.vue'
import WelcomeScreen from '@/views/Home/components/WelcomeScreen.vue'
import LogLoadingOverlay from '@/views/Home/components/LogLoadingOverlay.vue'
import CenterStage from '@/views/Home/components/CenterStage.vue'
import ChartToolbar from '@/modules/analysis/components/ChartToolbar.vue'
import LogInspector from '@/modules/log/components/LogInspector.vue'
import FieldDelete from '@/modules/fields/components/FieldDelete.vue'
import FieldExport from '@/modules/fields/components/FieldExport.vue'
import SimplePicker from '@/modules/shared/components/SimplePicker.vue'

const { ui } = storeToRefs(useUiStore())
const logStore = useLogStore()
const { log } = storeToRefs(logStore)
</script>

<template>
<div id="app">
  <ChartToolbar v-if="log.loaded" />

  <div class="main" :class="{ 'view-three': ui.mainView === 'three' }" v-if="log.loaded">
    <DataSidebar v-show="ui.mainView !== 'three'" />

    <CenterStage />
  </div>

  <WelcomeScreen />

  <div v-if="ui.toast" class="toast" :class="ui.toast.type">{{ ui.toast.msg }}</div>
  <FieldDelete />
  <FieldExport />
  <SimplePicker />
  <LogInspector />
  <LogLoadingOverlay />
</div>
</template>
