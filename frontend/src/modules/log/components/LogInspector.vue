<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useUiStore } from '@/modules/shared/ui-store'
import { useLogStore } from '@/modules/log'
import { useCommandsStore, useMAVLinkCommandsStore } from '@/modules/commands'
import { useParametersStore } from '@/modules/parameters'
import { useAnalysisStore } from '@/modules/analysis'
import ModalShell from '@/modules/shared/components/ModalShell.vue'
import AppIcon from '@/modules/shared/components/AppIcon.vue'
import AppButton from '@/modules/shared/components/AppButton.vue'
import type { RecordTab } from '@/types'

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
  <ModalShell :open="ui.recordOpen" variant="command-modal record-modal" title="记录浏览" subtitle="消息、航点命令、MAVLink 命令与参数按需加载。" @close="close">
    <div class="tabs">
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'messages' }" type="button" @click="selectTab('messages')">
        消息<span v-if="log.messages.length" class="tab-count">{{ log.messages.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'commands' }" type="button" @click="selectTab('commands')">
        航点命令<span v-if="commands.items.length" class="tab-count">{{ commands.items.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'mavlink' }" type="button" @click="selectTab('mavlink')">
        MAVLink<span v-if="mavlinkCommands.items.length" class="tab-count">{{ mavlinkCommands.items.length }}</span>
      </button>
      <button class="tab" :class="{ 'is-active': ui.recordTab === 'parameters' }" type="button" @click="selectTab('parameters')">
        参数<span v-if="parameters.items.length" class="tab-count">{{ parameters.items.length }}</span>
      </button>
    </div>

    <template v-if="ui.recordTab === 'messages'">
      <div class="record-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="log.messageFilter" class="parameter-filter" placeholder="搜索消息..." />
          <button v-if="log.messageFilter" class="parameter-clear" type="button" @click="log.messageFilter = ''" title="清空搜索">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">显示 {{ filteredMessages.length }} / {{ log.messages.length }}</span>
      </div>
      <div class="message-list record-message-list">
        <div v-for="message in filteredMessages" :key="message.lineno" class="message-row">
          <span class="message-time">{{ formatMessageTime(message) }}</span>
          <span class="message-text">{{ message.message }}</span>
        </div>
        <div v-if="!filteredMessages.length" class="message-empty">暂无消息</div>
      </div>
    </template>

    <template v-else-if="ui.recordTab === 'commands'">
      <div class="parameter-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="commands.filter" class="parameter-filter" placeholder="搜索命令、序号或坐标..." />
          <button v-if="commands.filter" class="parameter-clear" type="button" @click="commands.filter = ''" title="清空搜索">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">显示 {{ filteredCommands.length }} / {{ commands.items.length }}</span>
        <AppButton size="xs" :disabled="commands.loading" @click="loadCommands">刷新</AppButton>
      </div>
      <div class="command-table-wrap">
        <table class="command-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>序号</th>
              <th>命令</th>
              <th>P1</th>
              <th>P2</th>
              <th>P3</th>
              <th>P4</th>
              <th>纬度</th>
              <th>经度</th>
              <th>高度(m)</th>
              <th>坐标系</th>
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
            <tr v-if="!commands.loading && !filteredCommands.length"><td colspan="11" class="parameter-empty">暂无航点命令</td></tr>
            <tr v-if="commands.loading"><td colspan="11" class="parameter-empty">加载中...</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else-if="ui.recordTab === 'mavlink'">
      <div class="parameter-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="mavlinkCommands.filter" class="parameter-filter" placeholder="搜索命令、结果或坐标..." />
          <button v-if="mavlinkCommands.filter" class="parameter-clear" type="button" @click="mavlinkCommands.filter = ''" title="清空搜索">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">显示 {{ filteredMAVLinkCommands.length }} / {{ mavlinkCommands.items.length }}</span>
        <AppButton size="xs" :disabled="mavlinkCommands.loading" @click="loadMAVLinkCommands">刷新</AppButton>
      </div>
      <div class="command-table-wrap">
        <table class="command-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>命令</th>
              <th>P1</th>
              <th>P2</th>
              <th>P3</th>
              <th>P4</th>
              <th>纬度</th>
              <th>经度</th>
              <th>高度(m)</th>
              <th>坐标系</th>
              <th>目标</th>
              <th>来源</th>
              <th>结果</th>
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
            <tr v-if="!mavlinkCommands.loading && !filteredMAVLinkCommands.length"><td colspan="13" class="parameter-empty">暂无 MAVLink 命令</td></tr>
            <tr v-if="mavlinkCommands.loading"><td colspan="13" class="parameter-empty">加载中...</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="parameter-toolbar">
        <div class="parameter-search">
          <AppIcon name="search" :size="14" class="parameter-search-mark" />
          <input v-model="parameters.filter" class="parameter-filter" placeholder="搜索参数名称..." />
          <button v-if="parameters.filter" class="parameter-clear" type="button" @click="parameters.filter = ''" title="清空搜索">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <div class="parameter-toolbar-spacer"></div>
        <span class="parameter-count">显示 {{ filteredParameters.length }} / {{ parameters.items.length }}</span>
        <AppButton size="xs" :disabled="parameters.loading" @click="loadParameters">刷新</AppButton>
      </div>
      <div class="parameter-table-wrap">
        <table class="parameter-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="parameter in filteredParameters" :key="parameter.name">
              <td class="parameter-name" :title="parameter.name">{{ parameter.name }}</td>
              <td class="parameter-value" :title="formatParameterValue(parameter.value)">{{ formatParameterValue(parameter.value) }}</td>
            </tr>
            <tr v-if="!parameters.loading && !filteredParameters.length"><td colspan="2" class="parameter-empty">暂无参数</td></tr>
            <tr v-if="parameters.loading"><td colspan="2" class="parameter-empty">加载中...</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </ModalShell>
</template>
