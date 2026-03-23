<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, lineNumbers } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { BlockType } from '../../types/blocks'
import type { BlockModel } from '../../types/blocks'
import { getIfChainRoles, getIfChains } from '../../types/blocks'
import BlockNode from '../blocks/BlockNode.vue'

const props = defineProps<{
  blocks: BlockModel[]
  codeText: string
  hasManualEdit: boolean
}>()

const emit = defineEmits<{
  insertRoot: [payload: { type: BlockType; index: number }]
  moveRoot: [payload: { blockId: string; index: number }]
  dropInline: [payload: { slotId: string; type?: BlockType; draggedBlockId?: string }]
  inputInline: [payload: { slotId: string; value: string }]
  insertChild: [payload: { blockId: string; type: BlockType; index: number }]
  moveChild: [payload: { blockId: string; draggedBlockId: string; index: number }]
  rangeArityChange: [payload: { blockId: string; arity: number }]
  codeInput: [value: string]
}>()

const activeRootInsertIndex = ref<number | null>(null)
const copied = ref(false)
const editorHost = ref<HTMLDivElement | null>(null)
const editorView = shallowRef<EditorView | null>(null)
const rootChainRoles = computed(() => getIfChainRoles(props.blocks))
const rootChains = computed(() => getIfChains(props.blocks))
let copyTimer: number | null = null

watch(
  rootChains,
  (chains) => {
    console.log('[if-chain][root] detected chains:', chains)
    console.log('[if-chain][root] roles:', rootChainRoles.value)
  },
  { immediate: true, deep: true },
)

function isChainBridge(index: number): boolean {
  const prev = rootChainRoles.value[index - 1]
  const next = rootChainRoles.value[index]
  if (!prev || !next) {
    return false
  }
  return (prev === 'start' || prev === 'middle') && (next === 'middle' || next === 'end')
}

function onRootDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  event.stopPropagation()
  activeRootInsertIndex.value = index
}

function onRootDrop(event: DragEvent, index: number) {
  event.preventDefault()
  event.stopPropagation()
  activeRootInsertIndex.value = null
  if (!event.dataTransfer) return

  const draggedBlockId = event.dataTransfer.getData('application/x-pyzzle-block-id')
  if (draggedBlockId) {
    emit('moveRoot', { blockId: draggedBlockId, index })
    return
  }

  const type = event.dataTransfer.getData('text/plain') as BlockType
  if (!type) return
  emit('insertRoot', { type, index })
}

function clearRootInsertState() {
  activeRootInsertIndex.value = null
}

async function copyCode() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.codeText)
    } else {
      const temp = document.createElement('textarea')
      temp.value = props.codeText
      temp.setAttribute('readonly', 'true')
      temp.style.position = 'fixed'
      temp.style.opacity = '0'
      document.body.appendChild(temp)
      temp.select()
      document.execCommand('copy')
      document.body.removeChild(temp)
    }

    copied.value = true
    if (copyTimer !== null) {
      window.clearTimeout(copyTimer)
    }
    copyTimer = window.setTimeout(() => {
      copied.value = false
      copyTimer = null
    }, 1500)
  } catch {
    copied.value = false
  }
}

function createEditor() {
  if (!editorHost.value) {
    return
  }

  editorView.value = new EditorView({
    state: EditorState.create({
      doc: props.codeText,
      extensions: [
        basicSetup,
        lineNumbers(),
        python(),
        oneDark,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': {
            minHeight: '240px',
            fontSize: '14px',
          },
          '.cm-scroller': {
            fontFamily: '"Cascadia Code", Consolas, monospace',
            lineHeight: '1.5',
          },
        }),
      ],
    }),
    parent: editorHost.value,
  })
}

onMounted(() => {
  createEditor()
})

onUnmounted(() => {
  if (copyTimer !== null) {
    window.clearTimeout(copyTimer)
    copyTimer = null
  }
  editorView.value?.destroy()
  editorView.value = null
})

watch(
  () => props.codeText,
  (nextCode) => {
    const view = editorView.value
    if (!view) {
      return
    }
    const currentCode = view.state.doc.toString()
    if (currentCode === nextCode) {
      return
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentCode.length,
        insert: nextCode,
      },
    })
  },
)
</script>

<template>
  <section class="canvas-wrap">
    <div class="canvas" @dragleave="clearRootInsertState">
      <div class="canvas-title">结构化代码区</div>
      <div
        class="insert-zone"
        :class="{ active: activeRootInsertIndex === 0 }"
        @dragover="onRootDragOver($event, 0)"
        @drop="onRootDrop($event, 0)"
      >
        <span>+</span>
      </div>
      <template v-for="(block, index) in blocks" :key="block.blockId">
        <BlockNode
          :block="block"
          :chain-role="rootChainRoles[index]"
          @drop-inline="emit('dropInline', $event)"
          @input-inline="emit('inputInline', $event)"
          @insert-child="emit('insertChild', $event)"
          @move-child="emit('moveChild', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <div
          class="insert-zone"
          :class="{ active: activeRootInsertIndex === index + 1, 'chain-bridge': isChainBridge(index + 1) }"
          @dragover="onRootDragOver($event, index + 1)"
          @drop="onRootDrop($event, index + 1)"
        >
          <span>+</span>
        </div>
      </template>
      <div
        v-if="blocks.length === 0"
        class="empty-tip missing-root"
        @dragover="onRootDragOver($event, 0)"
        @drop="onRootDrop($event, 0)"
      >
        把左侧模块拖拽到这里开始搭建程序
      </div>
    </div>

    <div class="preview">
      <div class="preview-head">
        <h3>Python 代码预览</h3>
        <button type="button" class="copy-btn" @click="copyCode">{{ copied ? '已复制' : '复制' }}</button>
      </div>
      <div ref="editorHost" class="preview-area" />
    </div>
  </section>
</template>

<style scoped>
.canvas-wrap {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.canvas,
.preview {
  border: 2px solid var(--stroke);
  border-radius: 18px;
  background: var(--panel);
  padding: 14px;
  min-height: 220px;
}

.canvas {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.canvas-title {
  font-weight: 800;
  color: #26547c;
}

.empty-tip {
  min-height: 56px;
  border: 2px dashed #9ed2f3;
  border-radius: 12px;
  color: var(--muted-text);
  display: grid;
  place-items: center;
  padding: 10px;
}

.empty-tip.missing-root {
  border-color: #e03131;
  background: #ffe3e3;
  color: #8b0000;
}

.insert-zone {
  height: 14px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: transparent;
}

.insert-zone span {
  font-size: 16px;
  font-weight: 800;
}

.insert-zone.active {
  background: #e8f4ff;
  color: #2b6cb0;
  border: 1px dashed #63b3ed;
}

.insert-zone.chain-bridge {
  background: #ffefcc;
  border-radius: 0;
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

h3 {
  margin: 0;
}

.copy-btn {
  min-height: 34px;
  border: 1px solid #4c6ef5;
  border-radius: 999px;
  background: #eef2ff;
  color: #3046c9;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.preview-area {
  margin-top: 10px;
  border: 2px solid #abd8f2;
  border-radius: 12px;
  overflow: hidden;
}

.preview-area:deep(.cm-editor) {
  min-height: 240px;
}

.preview-area:deep(.cm-focused) {
  outline: none;
}

.preview-area:deep(.cm-content) {
  cursor: text;
}

.preview-area:deep(.cm-gutters) {
  border-right: 1px solid #1f2a37;
}
</style>
