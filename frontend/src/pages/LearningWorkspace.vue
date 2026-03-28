<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import BlockPalette from '../components/blocks/BlockPalette.vue'
import ConsolePanel from '../components/console/ConsolePanel.vue'
import CodeCanvas from '../components/editor/CodeCanvas.vue'
import InputPromptModal from '../components/console/InputPromptModal.vue'
import { useEditorStore } from '../stores/editorStore'
import { useRunSessionStore } from '../stores/runSessionStore'
import type { BlockType } from '../types/blocks'
import { getUserName, setUserName } from '../utils/userIdentity'

const editorStore = useEditorStore()
const runStore = useRunSessionStore()

const pendingPromptText = computed(() => runStore.pendingPrompt?.promptText ?? '')
const isPromptOpen = computed(() => !!runStore.pendingPrompt)
const runButtonLabel = computed(() => (runStore.isRunInProgress ? '停止' : '运行'))
const runButtonClass = computed(() => (runStore.isRunInProgress ? 'stop' : 'run'))
const runButtonDisabled = computed(() => !runStore.isRunInProgress && !runStore.canRun)
const submitButtonDisabled = computed(() => !runStore.canSubmit || runStore.isRunInProgress)
const userName = ref('')
const blockFileInputRef = ref<HTMLInputElement | null>(null)

function addRoot(type: BlockType) {
  editorStore.addBlockToRoot(type)
}

function runCode() {
  if (runStore.isRunInProgress) {
    runStore.stopRun()
    return
  }

  runStore.clearConsole()
  const code = editorStore.codeText.trim()
  runStore.startRun(code || '# 代码区为空', userName.value.trim())
}

function submitCode() {
  const code = editorStore.codeText.trim()
  runStore.submitCode(code || '# 代码区为空', userName.value.trim())
}

function onUserNameChange() {
  setUserName(userName.value)
}

function saveProgram() {
  const snapshot = editorStore.exportSnapshot()
  const payload = JSON.stringify(snapshot, null, 2)
  downloadText('pyzzle-program.pyz', payload, 'application/json')
}

function triggerLoadProgram() {
  blockFileInputRef.value?.click()
}

async function onLoadProgramChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  try {
    const raw = await file.text()
    const parsed = JSON.parse(raw)
    editorStore.importSnapshot(parsed)
    runStore.lines.push({ id: `${Date.now()}-load-program`, stream: 'system', text: '已读取程序文件。', ts: Date.now() })
  } catch {
    runStore.lines.push({ id: `${Date.now()}-load-program-failed`, stream: 'stderr', text: '程序文件无效，读取失败。', ts: Date.now() })
  } finally {
    input.value = ''
  }
}

function downloadText(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function submitPrompt(value: string) {
  runStore.submitInput(value)
}

function clearAll() {
  editorStore.clearWorkspace()
  runStore.clearConsole()
}

function onTrashDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!event.dataTransfer) {
    return
  }
  const blockId = event.dataTransfer.getData('application/x-pyzzle-block-id')
  if (!blockId) {
    return
  }
  editorStore.removeBlockById(blockId)
}

function onBeforeUnload() {
  runStore.shutdownSession()
}

onMounted(() => {
  editorStore.initFromStorage()
  userName.value = getUserName()
  runStore.initSession()
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  runStore.shutdownSession()
})
</script>

<template>
  <main class="workspace">
    <header class="topbar">
      <div>
        <h1>Pyzzle 学习工作台</h1>
        <p>拖拽模块 + 手工输入，一页完成编写与运行</p>
        <div class="user-name-row">
          <label for="user-name">姓名</label>
          <input id="user-name" v-model="userName" type="text" maxlength="32" placeholder="可选，留空使用 user_id" @change="onUserNameChange" @blur="onUserNameChange" />
        </div>
        <p class="connection" :class="runStore.connectionState">{{ runStore.connectionDisplay }}</p>
      </div>
      <div class="actions">
        <button type="button" class="submit" :disabled="submitButtonDisabled" @click="submitCode">提交</button>
        <button type="button" :class="runButtonClass" :disabled="runButtonDisabled" @click="runCode">
          {{ runButtonLabel }}
        </button>
        <button type="button" class="clear" @click="clearAll">清除</button>
        <button type="button" class="save" @click="saveProgram">保存程序</button>
        <button type="button" class="load" @click="triggerLoadProgram">读取程序</button>
        <input ref="blockFileInputRef" type="file" accept=".pyz,application/json" class="file-input" @change="onLoadProgramChange" />
      </div>
    </header>

    <section class="content">
      <BlockPalette @add="addRoot" />

      <CodeCanvas
        :blocks="editorStore.blocks"
        :code-text="editorStore.codeText"
        :has-manual-edit="editorStore.hasManualEdit"
        @insert-root="editorStore.addBlockToRoot($event.type, $event.index)"
        @move-root="editorStore.moveBlockToRoot($event.blockId, $event.index)"
        @drop-inline="editorStore.addBlockToInlineSlot($event.slotId, $event.type, $event.draggedBlockId)"
        @input-inline="editorStore.updateInlineText($event.slotId, $event.value)"
        @insert-child="editorStore.addBlockToChildren($event.blockId, $event.type, $event.index)"
        @move-child="editorStore.moveBlockToChildren($event.blockId, $event.draggedBlockId, $event.index)"
        @range-arity-change="editorStore.setRangeArity($event.blockId, $event.arity)"
      />

      <ConsolePanel :lines="runStore.lines" :run-state="runStore.runState" :connection-state="runStore.connectionState" />
    </section>

    <button
      type="button"
      class="trash-fixed"
      title="拖拽代码块到这里删除"
      @dragover.prevent.stop
      @drop="onTrashDrop"
    >
      <span aria-hidden="true">🗑️</span>
      <small>删除</small>
    </button>

    <InputPromptModal
      :open="isPromptOpen"
      :prompt-text="pendingPromptText"
      @submit="submitPrompt"
      @cancel="runStore.stopRun"
    />
  </main>
</template>

<style scoped>
.workspace {
  min-height: 100vh;
  padding: 16px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 14px;
}

.topbar {
  border: 2px solid var(--stroke);
  border-radius: 20px;
  background: linear-gradient(120deg, #b3ecff 0%, #e8ffb7 100%);
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  margin: 0;
}

p {
  margin: 6px 0 0;
  color: #24445c;
}

.connection {
  margin-top: 8px;
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid #9ec5d8;
  background: #e8f7ff;
  color: #1c4f68;
}

.connection.reconnecting {
  border-color: #f7bc6f;
  background: #fff7e8;
  color: #9a4d00;
}

.connection.blocked,
.connection.terminated {
  border-color: #f59ea0;
  background: #fff1f1;
  color: #912018;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.actions button {
  min-height: 42px;
  border-radius: 12px;
  border: 2px solid var(--stroke);
  padding: 0 14px;
  font-weight: 800;
}

.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.run {
  background: #8ce99a;
}

.stop {
  background: #ffcad4;
}

.clear {
  background: #ffd98e;
}

.save {
  background: #d9f3ff;
}

.load {
  background: #e8ffd8;
}

.submit {
  background: #c7f9d8;
}

.user-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.user-name-row label {
  font-size: 12px;
  font-weight: 700;
  color: #24445c;
}

.user-name-row input {
  min-height: 30px;
  border-radius: 10px;
  border: 1px solid #9ec5d8;
  padding: 0 10px;
  font-size: 13px;
  min-width: 220px;
}

.file-input {
  display: none;
}

.content {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(420px, 2.3fr) minmax(280px, 1.2fr);
  gap: 12px;
  align-items: start;
}

.trash-fixed {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 92px;
  height: 74px;
  border: 2px dashed #ef4444;
  border-radius: 14px;
  background: #fff1f2;
  color: #991b1b;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-weight: 800;
  z-index: 2;
}

.trash-fixed span {
  font-size: 15px;
  letter-spacing: 1px;
}

.trash-fixed small {
  font-size: 12px;
}

@media (max-width: 980px) {
  .content {
    grid-template-columns: 1fr;
  }

  .topbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
