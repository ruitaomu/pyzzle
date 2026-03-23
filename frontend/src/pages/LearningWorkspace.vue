<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import BlockPalette from '../components/blocks/BlockPalette.vue'
import CodeCanvas from '../components/editor/CodeCanvas.vue'
import InputPromptModal from '../components/console/InputPromptModal.vue'
import { useEditorStore } from '../stores/editorStore'
import { useRunSessionStore } from '../stores/runSessionStore'
import type { BlockType } from '../types/blocks'

const editorStore = useEditorStore()
const runStore = useRunSessionStore()

const pendingPromptText = computed(() => runStore.pendingPrompt?.promptText ?? '')
const isPromptOpen = computed(() => !!runStore.pendingPrompt)

function addRoot(type: BlockType) {
  editorStore.addBlockToRoot(type)
}

function runCode() {
  const code = editorStore.codeText.trim()
  runStore.startRun(code || 'print("Hello")')
}

function stopRun() {
  runStore.stopRun()
}

function submitPrompt(value: string) {
  runStore.submitInput(value)
}

function clearAll() {
  editorStore.clearWorkspace()
  runStore.clearConsole()
  runStore.resetRunStateOnRefresh()
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
  runStore.resetRunStateOnRefresh()
}

onMounted(() => {
  editorStore.initFromStorage()
  runStore.attachRunner()
  runStore.resetRunStateOnRefresh()
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <main class="workspace">
    <header class="topbar">
      <div>
        <h1>Pyzzle 学习工作台</h1>
        <p>拖拽模块 + 手工输入，一页完成编写与运行</p>
      </div>
      <div class="actions">
        <button type="button" class="run" @click="runCode">运行</button>
        <button type="button" class="stop" @click="stopRun">停止</button>
        <button type="button" class="clear" @click="clearAll">清除</button>
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
    </section>

    <button
      type="button"
      class="trash-fixed"
      title="拖拽代码块到这里删除"
      @dragover.prevent.stop
      @drop="onTrashDrop"
    >
      <span aria-hidden="true">BIN</span>
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

.actions {
  display: flex;
  gap: 8px;
}

.actions button {
  min-height: 42px;
  border-radius: 12px;
  border: 2px solid var(--stroke);
  padding: 0 14px;
  font-weight: 800;
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

.content {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(420px, 2.3fr);
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
