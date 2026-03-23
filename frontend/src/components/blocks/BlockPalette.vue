<script setup lang="ts">
import type { BlockType } from '../../types/blocks'
import { paletteBlocks } from '../../types/blocks'

const emit = defineEmits<{
  add: [type: BlockType]
}>()

function onDragStart(event: DragEvent, type: BlockType) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', type)
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="palette">
    <h2>模块库</h2>
    <p class="hint">拖拽到中间代码区，或点击快速插入</p>
    <div class="items">
      <button
        v-for="item in paletteBlocks"
        :key="item.type"
        class="palette-item"
        type="button"
        draggable="true"
        @dragstart="onDragStart($event, item.type)"
        @click="emit('add', item.type)"
      >
        {{ item.label }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.palette {
  background: var(--panel-2);
  border-radius: 20px;
  padding: 16px;
  border: 2px solid var(--stroke);
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 14px;
  max-height: calc(100vh - 28px);
  overflow: hidden;
}

h2 {
  margin: 0;
  font-size: 20px;
}

.hint {
  margin: 0;
  color: var(--muted-text);
  font-size: 13px;
}

.items {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
}

.palette-item {
  min-height: 42px;
  border-radius: 14px;
  border: 2px solid var(--stroke);
  background: linear-gradient(180deg, #fff3b0 0%, #ffd97d 100%);
  font-weight: 700;
  cursor: grab;
}

.palette-item:hover {
  transform: translateY(-1px);
}

@media (max-width: 980px) {
  .palette {
    position: static;
    max-height: none;
  }

  .items {
    overflow-y: visible;
    padding-right: 0;
  }
}
</style>
