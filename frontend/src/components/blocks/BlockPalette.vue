<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BlockType } from '../../types/blocks'
import { paletteBlocks } from '../../types/blocks'

const emit = defineEmits<{
  add: [type: BlockType]
}>()

const turtleOpen = ref(false)
const minecraftOpen = ref(false)

const turtleBlockTypes: BlockType[] = [
  'turtleForward',
  'turtleBackward',
  'turtleLeft',
  'turtleRight',
  'turtleDone',
]

const minecraftBlockTypes: BlockType[] = [
  'minecraftConnect',
  'minecraftPlayer',
  'minecraftGetTilePos',
  'minecraftSetTilePos',
  'minecraftSetBlock',
  'minecraftGetBlock',
]

const commonBlocks = computed(
  () => paletteBlocks.filter((item) => !turtleBlockTypes.includes(item.type) && !minecraftBlockTypes.includes(item.type)),
)
const turtleBlocks = computed(() => paletteBlocks.filter((item) => turtleBlockTypes.includes(item.type)))
const minecraftBlocks = computed(() => paletteBlocks.filter((item) => minecraftBlockTypes.includes(item.type)))

function getPaletteTone(type: BlockType): 'base' | 'logic' | 'default' {
  if (type === 'condAnd' || type === 'condOr' || type === 'condNot') {
    return 'logic'
  }

  if (
    type === 'assign' ||
    type === 'if' ||
    type === 'elif' ||
    type === 'else' ||
    type === 'while' ||
    type === 'for' ||
    type === 'break' ||
    type === 'continue'
  ) {
    return 'base'
  }

  return 'default'
}

function onDragStart(event: DragEvent, type: BlockType) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', type)
  event.dataTransfer.effectAllowed = 'copy'
}

function toggleTurtleGroup() {
  turtleOpen.value = !turtleOpen.value
}

function toggleMinecraftGroup() {
  minecraftOpen.value = !minecraftOpen.value
}
</script>

<template>
  <aside class="palette">
    <h2>模块库</h2>
    <p class="hint">拖拽到中间代码区，或点击快速插入</p>

    <div class="items common-items">
      <div class="group">
        <button
          v-for="item in commonBlocks"
          :key="item.type"
          class="palette-item"
          :class="`tone-${getPaletteTone(item.type)}`"
          type="button"
          draggable="true"
          @dragstart="onDragStart($event, item.type)"
          @click="emit('add', item.type)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <section class="turtle-section" :class="{ open: turtleOpen }">
      <button type="button" class="group-toggle" @click="toggleTurtleGroup">
        <span class="toggle-label">Turtle</span>
        <span class="toggle-mark">{{ turtleOpen ? '-' : '+' }}</span>
      </button>
      <div v-if="turtleOpen" class="group turtle-group">
        <button
          v-for="item in turtleBlocks"
          :key="item.type"
          class="palette-item turtle-item"
          type="button"
          draggable="true"
          @dragstart="onDragStart($event, item.type)"
          @click="emit('add', item.type)"
        >
          {{ item.label }}
        </button>
      </div>
    </section>

    <section class="minecraft-section" :class="{ open: minecraftOpen }">
      <button type="button" class="group-toggle minecraft-toggle" @click="toggleMinecraftGroup">
        <span class="toggle-label">Minecraft</span>
        <span class="toggle-mark">{{ minecraftOpen ? '-' : '+' }}</span>
      </button>
      <div v-if="minecraftOpen" class="group minecraft-group">
        <button
          v-for="item in minecraftBlocks"
          :key="item.type"
          class="palette-item minecraft-item"
          type="button"
          draggable="true"
          @dragstart="onDragStart($event, item.type)"
          @click="emit('add', item.type)"
        >
          {{ item.label }}
        </button>
      </div>
    </section>
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
  overflow: hidden;
  min-height: 0;
}

.group {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.common-items {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.turtle-section,
.minecraft-section {
  margin-top: 8px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55);
  overflow: hidden;
  flex-shrink: 0;
}

.turtle-section {
  border: 2px solid #96c7dd;
}

.minecraft-section {
  border: 2px solid #8cc6a5;
}

.turtle-section.open {
  background: rgba(226, 247, 255, 0.85);
}

.minecraft-section.open {
  background: rgba(232, 255, 237, 0.85);
}

.group-toggle {
  width: 100%;
  min-height: 42px;
  border: 0;
  background: linear-gradient(180deg, #d9f4ff 0%, #b7e9ff 100%);
  color: #1f4b63;
  padding: 0 14px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.minecraft-toggle {
  background: linear-gradient(180deg, #dcffea 0%, #b9f0cc 100%);
  color: #175034;
}

.toggle-label {
  font-size: 14px;
}

.toggle-mark {
  min-width: 18px;
  text-align: center;
  font-size: 20px;
  line-height: 1;
}

.turtle-group,
.minecraft-group {
  padding: 10px;
}

.palette-item {
  min-height: 42px;
  border-radius: 14px;
  border: 2px solid var(--stroke);
  background: linear-gradient(180deg, #fff3b0 0%, #ffd97d 100%);
  font-weight: 700;
  cursor: grab;
}

.palette-item.tone-base {
  color: #b45309;
}

.palette-item.tone-logic {
  color: #15803d;
}

.palette-item.tone-default {
  color: #264653;
}

.turtle-item {
  background: linear-gradient(180deg, #d8fff3 0%, #a8f0d3 100%);
}

.minecraft-item {
  background: linear-gradient(180deg, #e3ffe3 0%, #bdf0bf 100%);
}

.palette-item:hover {
  transform: translateY(-1px);
}

@media (max-width: 980px) {
  .palette {
    position: static;
    max-height: none;
  }

  .common-items {
    overflow-y: visible;
    padding-right: 0;
  }
}
</style>
