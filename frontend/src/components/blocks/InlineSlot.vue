<script setup lang="ts">
import { computed } from 'vue'
import type { BlockType, InlineSlotModel } from '../../types/blocks'
import BlockNode from './BlockNode.vue'

const props = defineProps<{
  slotData: InlineSlotModel
  narrow?: boolean
  narrowChars?: number
  required?: boolean
}>()

const emit = defineEmits<{
  textChange: [payload: { slotId: string; value: string }]
  dropBlock: [payload: { slotId: string; type?: BlockType; draggedBlockId?: string }]
  rangeArityChange: [payload: { blockId: string; arity: number }]
}>()

const hasNested = computed(() => !!props.slotData.blockValue)
const canDropBlock = computed(() => props.slotData.allowBlockDrop !== false)
const inputTrimmed = computed(() => props.slotData.textValue.trim())
const narrowChars = computed(() => props.narrowChars ?? 6)
const slotStyle = computed(() => ({ '--slot-ch': `${narrowChars.value}ch` }))
const required = computed(() => props.required ?? true)
const missingRequired = computed(() => required.value && !hasNested.value && inputTrimmed.value.length === 0)
const validationState = computed<'none' | 'valid' | 'invalid'>(() => {
  if (props.slotData.validationType !== 'python_identifier') {
    return 'none'
  }
  if (!inputTrimmed.value) {
    return 'none'
  }
  return isPythonIdentifier(inputTrimmed.value) ? 'valid' : 'invalid'
})

function onDrop(event: DragEvent) {
  if (!canDropBlock.value) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (!event.dataTransfer) return

  const draggedBlockId = event.dataTransfer.getData('application/x-pyzzle-block-id')
  if (draggedBlockId) {
    emit('dropBlock', { slotId: props.slotData.id, draggedBlockId })
    return
  }

  const type = event.dataTransfer.getData('text/plain') as BlockType
  if (!type) return
  emit('dropBlock', { slotId: props.slotData.id, type })
}

function onDragOver(event: DragEvent) {
  if (!canDropBlock.value) {
    return
  }
  event.preventDefault()
}

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'match', 'case',
])

function isPythonIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !PYTHON_KEYWORDS.has(value)
}
</script>

<template>
  <span
    class="slot"
    :class="[
      {
        'drop-disabled': !canDropBlock,
        valid: validationState === 'valid',
        invalid: validationState === 'invalid',
        missing: missingRequired,
        'has-nested': hasNested,
        narrow: narrow,
      },
    ]"
    :style="slotStyle"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <BlockNode
      v-if="hasNested && slotData.blockValue"
      :block="slotData.blockValue"
      compact
      @drop-inline="emit('dropBlock', $event)"
      @input-inline="emit('textChange', $event)"
      @range-arity-change="emit('rangeArityChange', $event)"
    />
    <template v-else>
      <input
        :value="slotData.textValue"
        class="slot-input"
        :placeholder="slotData.placeholder"
        @input="emit('textChange', { slotId: slotData.id, value: ($event.target as HTMLInputElement).value })"
      />
      <span v-if="validationState === 'invalid'" class="validate-tip">变量名有错误</span>
    </template>
  </span>
</template>

<style scoped>
.slot {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  min-width: 70px;
  min-height: 34px;
  border: 2px dashed #5fa8d3;
  border-radius: 10px;
  background: #f4fbff;
  padding: 2px 6px;
}

.slot.drop-disabled {
  border-style: solid;
}

.slot.valid {
  border-color: #2f9e44;
  background: #ebfbee;
}

.slot.invalid {
  border-color: #e03131;
  background: #fff5f5;
}

.slot.missing {
  border-color: #e03131 !important;
  background: #ffe3e3 !important;
  box-shadow: inset 0 0 0 1px #ffb8b8;
}

.slot.has-nested {
  border: 0;
  background: transparent;
  padding: 0;
  min-width: 0;
}

.slot-input {
  width: 100%;
  min-width: 64px;
  border: 0;
  background: transparent;
  outline: none;
  font-size: 13px;
}

.slot.narrow {
  min-width: 0;
  width: auto;
  padding: 2px 4px;
}

.slot.narrow .slot-input {
  min-width: var(--slot-ch);
  width: var(--slot-ch);
  text-align: center;
}

.validate-tip {
  margin-top: 2px;
  font-size: 10px;
  color: #c92a2a;
  line-height: 1.2;
}
</style>
