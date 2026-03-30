<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BlockModel, BlockType, IfChainRole } from '../../types/blocks'
import { getIfChainRoles, getIfChains, isStructuredBlock } from '../../types/blocks'
import InlineSlot from './InlineSlot.vue'

const props = withDefaults(
  defineProps<{
    block: BlockModel
    compact?: boolean
    chainRole?: IfChainRole
  }>(),
  {
    compact: false,
    chainRole: 'none',
  },
)

const emit = defineEmits<{
  dropInline: [payload: { slotId: string; type?: BlockType; draggedBlockId?: string }]
  inputInline: [payload: { slotId: string; value: string }]
  insertChild: [payload: { blockId: string; type: BlockType; index: number }]
  moveChild: [payload: { blockId: string; draggedBlockId: string; index: number }]
  rangeArityChange: [payload: { blockId: string; arity: number }]
}>()

const structured = isStructuredBlock(props.block.type)
const activeChildInsertIndex = ref<number | null>(null)
const childChainRoles = computed(() => getIfChainRoles(props.block.children))
const childChains = computed(() => getIfChains(props.block.children))
const unmatchedBranch = computed(
  () => (props.block.type === 'elif' || props.block.type === 'else') && props.chainRole === 'none',
)
const isRangeBlock = computed(
  () => props.block.type === 'range' || props.block.type === 'range1' || props.block.type === 'range2' || props.block.type === 'range3',
)
const rangeArity = computed(() => props.block.inlineSlots.length)

watch(
  childChains,
  (chains) => {
    if (!structured || props.compact) {
      return
    }
    console.log(
      `[if-chain][children][parent=${props.block.blockId}][type=${props.block.type}][role=${props.chainRole}] detected chains:`,
      chains,
    )
    console.log(
      `[if-chain][children][parent=${props.block.blockId}][type=${props.block.type}][role=${props.chainRole}] roles:`,
      childChainRoles.value,
    )
  },
  { immediate: true, deep: true },
)

function isChainBridge(index: number): boolean {
  const prev = childChainRoles.value[index - 1]
  const next = childChainRoles.value[index]
  if (!prev || !next) {
    return false
  }
  return (prev === 'start' || prev === 'middle') && (next === 'middle' || next === 'end')
}

function onDragStart(event: DragEvent) {
  const targetEl = event.target as HTMLElement | null
  const currentEl = event.currentTarget as HTMLElement | null
  const closestBlockEl = targetEl?.closest('[data-block-id]') as HTMLElement | null
  if (!currentEl || !closestBlockEl || closestBlockEl !== currentEl) {
    event.preventDefault()
    return
  }
  event.stopPropagation()
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/x-pyzzle-block-id', props.block.blockId)
  event.dataTransfer.effectAllowed = 'move'
}

function onChildDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  event.stopPropagation()
  activeChildInsertIndex.value = index
}

function onChildDrop(event: DragEvent, index: number) {
  event.preventDefault()
  event.stopPropagation()
  activeChildInsertIndex.value = null
  if (!event.dataTransfer) return
  const draggedBlockId = event.dataTransfer.getData('application/x-pyzzle-block-id')
  if (draggedBlockId) {
    emit('moveChild', { blockId: props.block.blockId, draggedBlockId, index })
    return
  }

  const type = event.dataTransfer.getData('text/plain') as BlockType
  if (!type) return
  emit('insertChild', { blockId: props.block.blockId, type, index })
}

function clearChildInsertState() {
  activeChildInsertIndex.value = null
}

function increaseRangeArity() {
  if (!isRangeBlock.value || rangeArity.value >= 3) {
    return
  }
  emit('rangeArityChange', { blockId: props.block.blockId, arity: rangeArity.value + 1 })
}

function decreaseRangeArity() {
  if (!isRangeBlock.value || rangeArity.value <= 1) {
    return
  }
  emit('rangeArityChange', { blockId: props.block.blockId, arity: rangeArity.value - 1 })
}

function isRequiredInlineSlot(blockType: BlockType, slotIndex: number): boolean {
  if (blockType === 'input') {
    return false
  }

  if (blockType === 'minecraftConnect' || blockType === 'minecraftSetTilePos' || blockType === 'minecraftGetBlock' || blockType === 'minecraftGetTilePos') {
    return false
  }

  if (blockType === 'minecraftSetBlock') {
    return slotIndex === 3
  }

  if (blockType === 'if' || blockType === 'elif' || blockType === 'while') {
    return slotIndex === 0
  }

  if (blockType === 'for' || blockType === 'assign' || blockType === 'condAnd' || blockType === 'condOr') {
    return slotIndex === 0 || slotIndex === 1
  }

  if (blockType === 'condNot' || blockType === 'int') {
    return slotIndex === 0
  }

  if (blockType === 'range' || blockType === 'range1' || blockType === 'range2' || blockType === 'range3') {
    return true
  }

  return true
}

function isTurtleArgBlock(blockType: BlockType): boolean {
  return (
    blockType === 'turtleForward' ||
    blockType === 'turtleBackward' ||
    blockType === 'turtleLeft' ||
    blockType === 'turtleRight'
  )
}

function getTurtleLabel(blockType: BlockType): string {
  if (blockType === 'turtleForward') {
    return 'turtle.forward('
  }
  if (blockType === 'turtleBackward') {
    return 'turtle.backward('
  }
  if (blockType === 'turtleLeft') {
    return 'turtle.left('
  }
  if (blockType === 'turtleRight') {
    return 'turtle.right('
  }
  return 'turtle.done()'
}

function isMinecraftBlock(blockType: BlockType): boolean {
  return (
    blockType === 'minecraftConnect' ||
    blockType === 'minecraftPlayer' ||
    blockType === 'minecraftGetTilePos' ||
    blockType === 'minecraftSetTilePos' ||
    blockType === 'minecraftSetBlock' ||
    blockType === 'minecraftGetBlock'
  )
}
</script>

<template>
  <div
    class="block"
    :class="[{ compact, 'unmatched-branch': unmatchedBranch }, `type-${block.type}`, `chain-${chainRole}`]"
    :data-block-id="block.blockId"
    draggable="true"
    @dragstart="onDragStart"
  >
    <div class="block-head">
      <span v-if="!isRangeBlock && block.type !== 'assign' && block.type !== 'print' && block.type !== 'input' && block.type !== 'int' && block.type !== 'randomRandInt' && block.type !== 'condAnd' && block.type !== 'condOr' && block.type !== 'condNot' && !isTurtleArgBlock(block.type) && block.type !== 'turtleDone' && !isMinecraftBlock(block.type)" class="label">{{ block.label }}</span>
      <span v-if="unmatchedBranch" class="chain-role-badge error">
        没有匹配的if
      </span>
      <template v-if="block.type === 'for'">
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          narrow
          :narrow-chars="8"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="keyword-in">in</span>
        <InlineSlot
          v-if="block.inlineSlots[1]"
          :slot-data="block.inlineSlots[1]"
          :required="isRequiredInlineSlot(block.type, 1)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
      </template>
      <template v-else-if="block.type === 'assign'">
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          narrow
          :narrow-chars="8"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="keyword-in">=</span>
        <InlineSlot
          v-if="block.inlineSlots[1]"
          :slot-data="block.inlineSlots[1]"
          :required="isRequiredInlineSlot(block.type, 1)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
      </template>
      <template v-else-if="isRangeBlock">
        <span class="label">range(</span>
        <button
          v-if="rangeArity > 1"
          type="button"
          class="arity-btn"
          @mousedown.stop
          @click.stop="decreaseRangeArity"
        >
          -
        </button>
        <template v-for="(slot, index) in block.inlineSlots" :key="slot.id">
          <InlineSlot
            :slot-data="slot"
            :required="isRequiredInlineSlot(block.type, index)"
            narrow
            :narrow-chars="6"
            @drop-block="emit('dropInline', $event)"
            @text-change="emit('inputInline', $event)"
            @range-arity-change="emit('rangeArityChange', $event)"
          />
          <span v-if="index < block.inlineSlots.length - 1" class="keyword-in">,</span>
        </template>
        <button
          v-if="rangeArity < 3"
          type="button"
          class="arity-btn"
          @mousedown.stop
          @click.stop="increaseRangeArity"
        >
          +
        </button>
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'print' || block.type === 'input'">
        <span class="label">{{ block.type }}(</span>
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'int'">
        <span class="label">int(</span>
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'randomRandInt'">
        <span class="label">random.randint(</span>
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="keyword-in">,</span>
        <InlineSlot
          v-if="block.inlineSlots[1]"
          :slot-data="block.inlineSlots[1]"
          :required="isRequiredInlineSlot(block.type, 1)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="label">)</span>
      </template>
      <template v-else-if="isTurtleArgBlock(block.type)">
        <span class="label">{{ getTurtleLabel(block.type) }}</span>
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'turtleDone'">
        <span class="label">{{ getTurtleLabel(block.type) }}</span>
      </template>
      <template v-else-if="block.type === 'minecraftConnect'">
        <span class="label">mc = minecraft.Minecraft.create(</span>
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'minecraftPlayer'">
        <span class="label">player = mc.player</span>
      </template>
      <template v-else-if="block.type === 'minecraftGetTilePos'">
        <template v-for="(slot, index) in block.inlineSlots" :key="slot.id">
          <InlineSlot
            :slot-data="slot"
            :required="isRequiredInlineSlot(block.type, index)"
            narrow
            :narrow-chars="4"
            @drop-block="emit('dropInline', $event)"
            @text-change="emit('inputInline', $event)"
            @range-arity-change="emit('rangeArityChange', $event)"
          />
          <span v-if="index < block.inlineSlots.length - 1" class="keyword-in">,</span>
        </template>
        <span class="label">= player.getTilePos()</span>
      </template>
      <template v-else-if="block.type === 'minecraftSetTilePos'">
        <span class="label">player.setTilePos(</span>
        <template v-for="(slot, index) in block.inlineSlots" :key="slot.id">
          <InlineSlot
            :slot-data="slot"
            :required="isRequiredInlineSlot(block.type, index)"
            narrow
            :narrow-chars="4"
            @drop-block="emit('dropInline', $event)"
            @text-change="emit('inputInline', $event)"
            @range-arity-change="emit('rangeArityChange', $event)"
          />
          <span v-if="index < block.inlineSlots.length - 1" class="keyword-in">,</span>
        </template>
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'minecraftSetBlock'">
        <span class="label">mc.setBlock(</span>
        <template v-for="(slot, index) in block.inlineSlots" :key="slot.id">
          <InlineSlot
            :slot-data="slot"
            :required="isRequiredInlineSlot(block.type, index)"
            :narrow="index < 3"
            :narrow-chars="4"
            @drop-block="emit('dropInline', $event)"
            @text-change="emit('inputInline', $event)"
            @range-arity-change="emit('rangeArityChange', $event)"
          />
          <span v-if="index < block.inlineSlots.length - 1" class="keyword-in">,</span>
        </template>
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'minecraftGetBlock'">
        <span class="label">mc.getBlock(</span>
        <template v-for="(slot, index) in block.inlineSlots" :key="slot.id">
          <InlineSlot
            :slot-data="slot"
            :required="isRequiredInlineSlot(block.type, index)"
            narrow
            :narrow-chars="4"
            @drop-block="emit('dropInline', $event)"
            @text-change="emit('inputInline', $event)"
            @range-arity-change="emit('rangeArityChange', $event)"
          />
          <span v-if="index < block.inlineSlots.length - 1" class="keyword-in">,</span>
        </template>
        <span class="label">)</span>
      </template>
      <template v-else-if="block.type === 'condAnd'">
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="keyword-in">and</span>
        <InlineSlot
          v-if="block.inlineSlots[1]"
          :slot-data="block.inlineSlots[1]"
          :required="isRequiredInlineSlot(block.type, 1)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
      </template>
      <template v-else-if="block.type === 'condOr'">
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          :required="isRequiredInlineSlot(block.type, 0)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <span class="keyword-in">or</span>
        <InlineSlot
          v-if="block.inlineSlots[1]"
          :slot-data="block.inlineSlots[1]"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
      </template>
      <template v-else-if="block.type === 'condNot'">
        <span class="keyword-in">not</span>
        <InlineSlot
          v-if="block.inlineSlots[0]"
          :slot-data="block.inlineSlots[0]"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
      </template>
      <template v-else>
        <InlineSlot
          v-for="(slot, index) in block.inlineSlots"
          :key="slot.id"
          :slot-data="slot"
          :required="isRequiredInlineSlot(block.type, index)"
          @drop-block="emit('dropInline', $event)"
          @text-change="emit('inputInline', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
      </template>
      <span v-if="structured" class="colon">:</span>
    </div>

    <div
      v-if="structured && !compact"
      class="children"
      :class="{ 'children-missing': block.children.length === 0 }"
      @dragleave="clearChildInsertState"
    >
      <div class="children-title">语句体</div>
      <div
        class="insert-zone"
        :class="{ active: activeChildInsertIndex === 0 }"
        @dragover="onChildDragOver($event, 0)"
        @drop="onChildDrop($event, 0)"
      >
        <span>+</span>
      </div>
      <template v-for="(child, index) in block.children" :key="child.blockId">
        <BlockNode
          :block="child"
          :chain-role="childChainRoles[index]"
          @drop-inline="emit('dropInline', $event)"
          @input-inline="emit('inputInline', $event)"
          @insert-child="emit('insertChild', $event)"
          @move-child="emit('moveChild', $event)"
          @range-arity-change="emit('rangeArityChange', $event)"
        />
        <div
          class="insert-zone"
          :class="{ active: activeChildInsertIndex === index + 1, 'chain-bridge': isChainBridge(index + 1) }"
          @dragover="onChildDragOver($event, index + 1)"
          @drop="onChildDrop($event, index + 1)"
        >
          <span>+</span>
        </div>
      </template>
      <div
        v-if="block.children.length === 0"
        class="children-empty"
        @dragover="onChildDragOver($event, 0)"
        @drop="onChildDrop($event, 0)"
      >
        拖拽模块到这里
      </div>
    </div>
  </div>
</template>

<style scoped>
.block {
  border: 2px solid var(--stroke);
  border-radius: 14px;
  padding: 10px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block.compact {
  border-style: dashed;
  padding: 6px;
}

.block-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.label {
  font-weight: 700;
  font-size: 14px;
}

.chain-role-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #b27a00;
  background: #fff4de;
  color: #7a4d00;
  font-size: 11px;
  font-weight: 700;
}

.chain-role-badge.error {
  border-color: #b91c1c;
  background: #ffe3e3;
  color: #8b0000;
}

.colon {
  font-weight: 700;
}

.keyword-in {
  font-size: 13px;
  font-weight: 700;
  color: #315e7a;
}

.arity-btn {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid #5a8bb0;
  background: #eaf6ff;
  color: #2b5f83;
  font-weight: 800;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.children {
  border-left: 3px solid #6cb4ee;
  margin-left: 8px;
  padding-left: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.children.children-missing {
  border-left-color: #d62828;
  background: #fff1f1;
  border-radius: 10px;
  padding-top: 8px;
  padding-bottom: 8px;
}

.children-title {
  color: var(--muted-text);
  font-size: 12px;
}

.children-empty {
  min-height: 40px;
  border: 2px dashed #9ed2f3;
  border-radius: 12px;
  padding: 8px;
  color: var(--muted-text);
}

.children.children-missing .children-empty {
  border-color: #e03131;
  background: #ffe3e3;
  color: #8b0000;
}

.insert-zone {
  min-height: 24px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: transparent;
}

.insert-zone span {
  font-size: 14px;
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

.type-if,
.type-elif,
.type-else,
.type-for,
.type-while {
  background: linear-gradient(180deg, #e9f7ff 0%, #d2efff 100%);
}

.type-print,
.type-input {
  background: linear-gradient(180deg, #fff9de 0%, #ffeaa6 100%);
}

.block.unmatched-branch {
  border-color: #d62828 !important;
  background: #ffe5e5 !important;
  box-shadow: inset 0 0 0 2px #ffb8b8;
}

.block.chain-start,
.block.chain-middle,
.block.chain-end {
  border-color: #d18a00 !important;
  background: #fff1d6 !important;
  box-shadow: inset 0 0 0 2px #ffd38b;
}

.block.chain-start {
  border-bottom-left-radius: 10px;
  border-bottom-right-radius: 10px;
}

.block.chain-middle {
  border-radius: 10px;
}

.block.chain-end {
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
}
</style>
