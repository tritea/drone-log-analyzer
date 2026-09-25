<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/modules/shared/ui-store'
import { useLogStore } from '@/modules/log'
import { useCommandsStore, useMAVLinkCommandsStore } from '@/modules/commands'
import { useParametersStore } from '@/modules/parameters'
import { useAnalysisStore } from '@/modules/analysis'
import ModalShell from '@/modules/shared/components/ModalShell.vue'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import AppButton from '@/modules/shared/components/AppButton.vue'
import type { RecordTab } from '@/types'

const { t } = useI18n()

const uiStore = useUiStore()
const { ui } = storeToRefs(uiStore)

const logStore = useLogStore()
const { log, filteredMessages } = storeToRefs(logStore)

const commandsStore = useCommandsStore()
const { commands, filteredCommands } = storeToRefs(commandsStore)
const { loadCommands } = commandsStore

const mavlinkStore = useMAVLinkCommandsStore()
const { mavlinkCommands, filteredMAVLinkCommands } = storeToRefs(mavlinkStore)
const { loadMAVLinkCommands } = mavlinkStore

const parametersStore = useParametersStore()
const { parameters, filteredParameters } = storeToRefs(parametersStore)
const { loadParameters } = parametersStore

const { formatMessageTime, formatTime, formatParameterValue, formatCoord } = useAnalysisStore()

function close(): void {
  ui.value.recordOpen = false
}

function selectTab(tab: RecordTab): void {
  ui.value.recordTab = tab
}

function ensureTabLoaded(tab: RecordTab): void {
  if (tab === 'commands' && !commands.value.loaded) loadCommands()
  else if (tab === 'mavlink' && !mavlinkCommands.value.loaded) loadMAVLinkCommands()
  else if (tab === 'parameters' && !parameters.value.items.length && !parameters.value.loading) loadParameters()
}

watch(() => ui.value.recordTab, ensureTabLoaded)
watch(() => ui.value.recordOpen, (open) => {
  if (open) ensureTabLoaded(ui.value.recordTab)
})
</script>

<template>
  <ModalShell :open="ui.recordOpen" variant="command-modal record-modal" :title="t('log.inspector.title')" :subtitle="t('log.inspector.subtitle')" @close="close">
    <div class="tabs">
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'messages' }" type="button" @click="selectTab('messages')">
        {{ t('log.inspector.tab.messages') }}<span v-if="log.messages.length" class="tab-count">{{ log.messages.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'commands' }" type="button" @click="selectTab('commands')">
        {{ t('log.inspector.tab.commands') }}<span v-if="commands.items.length" class="tab-count">{{ commands.items.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'mavlink' }" type="button" @click="selectTab('mavlink')">
        MAVLink<span v-if="mavlinkCommands.items.length" class="tab-count">{{ mavlinkCommands.items.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'parameters' }" type="button" @click="selectTab('parameters')">
        {{ t('log.inspector.tab.parameters') }}<span v-if="parameters.items.length" class="tab-count">{{ parameters.items.length }}</span>
      </button>
    </div>

    <template v-if="ui.recordTab === 'messages'">
      <div class="record-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="log.messageFilter" class="parameter-filter" :placeholder="t('log.inspector.search.messages')" />
          <button v-if="log.messageFilter" class="parameter-clear" type="button" @click="log.messageFilter = ''" :title="t('log.inspector.clearSearch')">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">{{ t('log.inspector.showCount', { shown: filteredMessages.length, total: log.messages.length }) }}</span>
      </div>
      <div class="message-list record-message-list">
        <div v-for="message in filteredMessages" :key="message.lineno" class="message-row">
          <span class="message-time">{{ formatMessageTime(message) }}</span>
          <span class="message-text">{{ message.message }}</span>
        </div>
        <div v-if="!filteredMessages.length" class="message-empty">{{ t('log.inspector.empty.messages') }}</div>
      </div>
    </template>

    <template v-else-if="ui.recordTab === 'commands'">
      <div class="parameter-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="commands.filter" class="parameter-filter" :placeholder="t('log.inspector.search.commands')" />
          <button v-if="commands.filter" class="parameter-clear" type="button" @click="commands.filter = ''" :title="t('log.inspector.clearSearch')">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">{{ t('log.inspector.showCount', { shown: filteredCommands.length, total: commands.items.length }) }}</span>
        <AppButton size="xs" :disabled="commands.loading" @click="loadCommands">{{ t('log.inspector.refresh') }}</AppButton>
      </div>
      <div class="command-table-wrap">
        <table class="command-table">
          <thead>
            <tr>
              <th>{{ t('log.inspector.col.time') }}</th>
              <th>{{ t('log.inspector.col.seq') }}</th>
              <th>{{ t('log.inspector.col.command') }}</th>
              <th>P1</th>
              <th>P2</th>
              <th>P3</th>
              <th>P4</th>
              <th>{{ t('log.inspector.col.lat') }}</th>
              <th>{{ t('log.inspector.col.lng') }}</th>
              <th>{{ t('log.inspector.col.alt') }}</th>
              <th>{{ t('log.inspector.col.frame') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="command in filteredCommands" :key="'cmd-' + command.sequence + '-' + command.command + '-' + command.timeMs">
              <td class="command-time" :title="formatTime(command.timeMs, true)">{{ formatTime(command.timeMs, true) }}</td>
              <td class="command-num">{{ command.sequence }}</td>
              <td class="command-cmd" :title="command.commandName ? command.commandName + ' (' + command.command + ')' : 'MAV_CMD ' + command.command">
                <span class="command-cmd-name">{{ command.commandName || 'CMD_' + command.command }}</span>
                <span class="command-cmd-id">{{ command.command }}</span>
              </td>
              <td class="command-param">{{ formatParameterValue(command.param1 ?? '') }}</td>
              <td class="command-param">{{ formatParameterValue(command.param2 ?? '') }}</td>
              <td class="command-param">{{ formatParameterValue(command.param3 ?? '') }}</td>
              <td class="command-param">{{ formatParameterValue(command.param4 ?? '') }}</td>
              <td class="command-coord">{{ formatCoord(command.latitude) }}</td>
              <td class="command-coord">{{ formatCoord(command.longitude) }}</td>
              <td class="command-alt">{{ formatParameterValue(command.altitude) }}</td>
              <td class="command-frame" :title="command.frameName ? command.frameName + ' (' + command.frame + ')' : 'FRAME ' + command.frame">{{ command.frameName || command.frame }}</td>
            </tr>
            <tr v-if="!commands.loading && !filteredCommands.length"><td colspan="11" class="parameter-empty">{{ t('log.inspector.empty.commands') }}</td></tr>
            <tr v-if="commands.loading"><td colspan="11" class="parameter-empty">{{ t('log.inspector.loading') }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else-if="ui.recordTab === 'mavlink'">
      <div class="parameter-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="mavlinkCommands.filter" class="parameter-filter" :placeholder="t('log.inspector.search.mavlink')" />
          <button v-if="mavlinkCommands.filter" class="parameter-clear" type="button" @click="mavlinkCommands.filter = ''" :title="t('log.inspector.clearSearch')">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">{{ t('log.inspector.showCount', { shown: filteredMAVLinkCommands.length, total: mavlinkCommands.items.length }) }}</span>
        <AppButton size="xs" :disabled="mavlinkCommands.loading" @click="loadMAVLinkCommands">{{ t('log.inspector.refresh') }}</AppButton>
      </div>
      <div class="command-table-wrap">
        <table class="command-table">
          <thead>
            <tr>
              <th>{{ t('log.inspector.col.time') }}</th>
              <th>{{ t('log.inspector.col.command') }}</th>
              <th>P1</th>
              <th>P2</th>
              <th>P3</th>
              <th>P4</th>
              <th>{{ t('log.inspector.col.lat') }}</th>
              <th>{{ t('log.inspector.col.lng') }}</th>
              <th>{{ t('log.inspector.col.alt') }}</th>
              <th>{{ t('log.inspector.col.frame') }}</th>
              <th>{{ t('log.inspector.col.target') }}</th>
              <th>{{ t('log.inspector.col.source') }}</th>
              <th>{{ t('log.inspector.col.result') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="command in filteredMAVLinkCommands" :key="'mavc-' + command.timeMs + '-' + command.command + '-' + command.targetSystem + '-' + command.targetComponent">
              <td class="command-time" :title="formatTime(command.timeMs, true)">{{ formatTime(command.timeMs, true) }}</td>
              <td class="command-cmd" :title="command.commandName ? command.commandName + ' (' + command.command + ')' : 'MAV_CMD ' + command.command">
                <span class="command-cmd-name">{{ command.commandName || 'CMD_' + command.command }}</span>
                <span class="command-cmd-id">{{ command.command }}</span>
              </td>
              <td class="command-param">{{ formatParameterValue(command.param1 ?? '') }}</td>
              <td class="command-param">{{ formatParameterValue(command.param2 ?? '') }}</td>
              <td class="command-param">{{ formatParameterValue(command.param3 ?? '') }}</td>
              <td class="command-param">{{ formatParameterValue(command.param4 ?? '') }}</td>
              <td class="command-coord">{{ formatCoord(command.latitude) }}</td>
              <td class="command-coord">{{ formatCoord(command.longitude) }}</td>
              <td class="command-alt">{{ formatParameterValue(command.altitude) }}</td>
              <td class="command-frame" :title="command.frameName ? command.frameName + ' (' + command.frame + ')' : 'FRAME ' + command.frame">{{ command.frameName || command.frame }}</td>
              <td class="command-coord">{{ command.targetSystem }}({{ command.targetComponent }})</td>
              <td class="command-coord">{{ command.sourceSystem }}({{ command.sourceComponent }})</td>
              <td class="mavc-result" :title="command.resultName ? command.resultName + ' (' + command.result + ')' : 'RESULT ' + command.result">
                <span class="command-cmd-name">{{ command.resultName || 'RES_' + command.result }}</span>
              </td>
            </tr>
            <tr v-if="!mavlinkCommands.loading && !filteredMAVLinkCommands.length"><td colspan="13" class="parameter-empty">{{ t('log.inspector.empty.mavlink') }}</td></tr>
            <tr v-if="mavlinkCommands.loading"><td colspan="13" class="parameter-empty">{{ t('log.inspector.loading') }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="parameter-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="parameters.filter" class="parameter-filter" :placeholder="t('log.inspector.search.parameters')" />
          <button v-if="parameters.filter" class="parameter-clear" type="button" @click="parameters.filter = ''" :title="t('log.inspector.clearSearch')">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">{{ t('log.inspector.showCount', { shown: filteredParameters.length, total: parameters.items.length }) }}</span>
        <AppButton size="xs" :disabled="parameters.loading" @click="loadParameters">{{ t('log.inspector.refresh') }}</AppButton>
      </div>
      <div class="parameter-table-wrap">
        <table class="parameter-table">
          <thead>
            <tr>
              <th>{{ t('log.inspector.col.name') }}</th>
              <th>{{ t('log.inspector.col.value') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="parameter in filteredParameters" :key="parameter.name">
              <td class="parameter-name" :title="parameter.name">{{ parameter.name }}</td>
              <td class="parameter-value" :title="formatParameterValue(parameter.value)">{{ formatParameterValue(parameter.value) }}</td>
            </tr>
            <tr v-if="!parameters.loading && !filteredParameters.length"><td colspan="2" class="parameter-empty">{{ t('log.inspector.empty.parameters') }}</td></tr>
            <tr v-if="parameters.loading"><td colspan="2" class="parameter-empty">{{ t('log.inspector.loading') }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </ModalShell>
</template>
