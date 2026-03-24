import { defineStore } from 'pinia'
import type { BlockModel, BlockType, InlineSlotModel } from '../types/blocks'
import { applyVariableSlotRules, createBlock } from '../types/blocks'

interface EditorState {
  blocks: BlockModel[]
  codeText: string
  hasManualEdit: boolean
}

const STORAGE_KEY = 'pyzzle-student-editor-v1'

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    blocks: [],
    codeText: '',
    hasManualEdit: false,
  }),
  actions: {
    initFromStorage() {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return
      }

      try {
        const parsed = JSON.parse(raw) as Partial<EditorState>
        this.blocks = parsed.blocks ?? []
        this.blocks.forEach((block) => normalizeBlockTree(block))
        this.codeText = parsed.codeText ?? ''
        this.hasManualEdit = parsed.hasManualEdit ?? false
      } catch {
        this.resetEditor()
      }
    },
    persist() {
      const payload: EditorState = {
        blocks: this.blocks,
        codeText: this.codeText,
        hasManualEdit: this.hasManualEdit,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    },
    addBlockToRoot(type: BlockType, index?: number) {
      if (isInlineOnlyBlockType(type) || isLoopControlBlockType(type)) {
        return
      }
      const insertIndex = clampIndex(index, this.blocks.length)
      this.blocks.splice(insertIndex, 0, createBlock(type))
      this.rebuildCodeFromBlocks()
    },
    addBlockToChildren(targetBlockId: string, type: BlockType, index?: number) {
      if (isInlineOnlyBlockType(type)) {
        return
      }
      const target = findBlock(this.blocks, targetBlockId)
      if (!target) {
        return
      }

      if (isLoopControlBlockType(type) && !hasLoopPlacementContext(this.blocks, targetBlockId)) {
        return
      }

      if ((type === 'elif' || type === 'else') && (target.type === 'if' || target.type === 'elif')) {
        const insertionPoint = findContainerAndIndex(this.blocks, targetBlockId)
        if (!insertionPoint) {
          return
        }
        insertionPoint.container.splice(insertionPoint.index + 1, 0, createBlock(type))
        this.rebuildCodeFromBlocks()
        return
      }

      const insertIndex = clampIndex(index, target.children.length)
      target.children.splice(insertIndex, 0, createBlock(type))
      this.rebuildCodeFromBlocks()
    },
    moveBlockToRoot(blockId: string, index: number) {
      const source = findStatementContainerAndIndex(this.blocks, blockId)
      if (!source) {
        return
      }

      const movingBlock = source.container[source.index]
      if (isLoopControlBlockType(movingBlock.type)) {
        return
      }
      source.container.splice(source.index, 1)

      const targetContainer = this.blocks
      let insertIndex = clampIndex(index, targetContainer.length)
      if (source.container === targetContainer && source.index < insertIndex) {
        insertIndex -= 1
      }

      targetContainer.splice(insertIndex, 0, movingBlock)
      this.rebuildCodeFromBlocks()
    },
    moveBlockToChildren(parentBlockId: string, blockId: string, index: number) {
      if (parentBlockId === blockId) {
        return
      }

      const source = findStatementContainerAndIndex(this.blocks, blockId)
      const parentBlock = findBlock(this.blocks, parentBlockId)
      if (!source || !parentBlock) {
        return
      }

      const movingBlock = source.container[source.index]
      if (containsChildBlock(movingBlock, parentBlockId)) {
        return
      }
      if (isLoopControlBlockType(movingBlock.type) && !hasLoopPlacementContext(this.blocks, parentBlockId)) {
        return
      }

      source.container.splice(source.index, 1)
      const targetContainer = parentBlock.children
      let insertIndex = clampIndex(index, targetContainer.length)
      if (source.container === targetContainer && source.index < insertIndex) {
        insertIndex -= 1
      }

      targetContainer.splice(insertIndex, 0, movingBlock)
      this.rebuildCodeFromBlocks()
    },
    addBlockToInlineSlot(targetSlotId: string, type?: BlockType, draggedBlockId?: string) {
      const slot = findSlot(this.blocks, targetSlotId)
      if (!slot) {
        return
      }

      if (draggedBlockId) {
        if (slot.blockValue?.blockId === draggedBlockId) {
          return
        }

        const movingBlock = findBlock(this.blocks, draggedBlockId)
        if (!movingBlock) {
          return
        }

        if (isLoopControlBlockType(movingBlock.type)) {
          return
        }

        if (isConditionLogicBlockType(movingBlock.type) && !slot.acceptsConditionBlocks) {
          return
        }

        if (containsSlotId(movingBlock, targetSlotId)) {
          return
        }

        const extracted = extractBlockInTree(this.blocks, draggedBlockId)
        if (!extracted) {
          return
        }

        slot.textValue = ''
        slot.blockValue = extracted
        this.rebuildCodeFromBlocks()
        return
      }

      if (!type) {
        return
      }

      if (isLoopControlBlockType(type)) {
        return
      }

      if (isConditionLogicBlockType(type) && !slot.acceptsConditionBlocks) {
        return
      }

      slot.blockValue = createBlock(type)
      this.rebuildCodeFromBlocks()
    },
    setRangeArity(blockId: string, arity: number) {
      const target = findBlock(this.blocks, blockId)
      if (!target) {
        return
      }
      if (target.type !== 'range' && target.type !== 'range1' && target.type !== 'range2' && target.type !== 'range3') {
        return
      }

      const nextArity = Math.max(1, Math.min(3, arity))
      target.type = 'range'
      target.label = ''
      target.inlineSlots = adjustRangeSlots(target.inlineSlots, nextArity)
      this.rebuildCodeFromBlocks()
    },
    updateInlineText(targetSlotId: string, value: string) {
      const slot = findSlot(this.blocks, targetSlotId)
      if (!slot) {
        return
      }
      slot.textValue = value
      slot.blockValue = null
      this.rebuildCodeFromBlocks()
    },
    removeRootBlock(blockId: string) {
      this.blocks = this.blocks.filter((item) => item.blockId !== blockId)
      this.rebuildCodeFromBlocks()
    },
    removeBlockById(blockId: string) {
      const removed = removeBlockInTree(this.blocks, blockId)
      if (!removed) {
        return
      }
      this.rebuildCodeFromBlocks()
    },
    updateManualCode(code: string) {
      this.codeText = code
      this.hasManualEdit = true
      this.persist()
    },
    rebuildCodeFromBlocks() {
      this.codeText = renderProgram(this.blocks)
      this.hasManualEdit = false
      this.persist()
    },
    clearWorkspace() {
      this.blocks = []
      this.codeText = ''
      this.hasManualEdit = false
      this.persist()
    },
    resetEditor() {
      this.blocks = []
      this.codeText = ''
      this.hasManualEdit = false
      this.persist()
    },
  },
})

function findBlock(nodes: BlockModel[], blockId: string): BlockModel | null {
  for (const node of nodes) {
    if (node.blockId === blockId) {
      return node
    }
    const childResult = findBlock(node.children, blockId)
    if (childResult) {
      return childResult
    }
    for (const slot of node.inlineSlots) {
      if (slot.blockValue) {
        const slotResult = findBlock([slot.blockValue], blockId)
        if (slotResult) {
          return slotResult
        }
      }
    }
  }
  return null
}

function clampIndex(index: number | undefined, max: number): number {
  if (index === undefined) {
    return max
  }
  if (index < 0) {
    return 0
  }
  if (index > max) {
    return max
  }
  return index
}

function findSlot(nodes: BlockModel[], slotId: string): InlineSlotModel | null {
  for (const node of nodes) {
    for (const slot of node.inlineSlots) {
      if (slot.id === slotId) {
        return slot
      }
      if (slot.blockValue) {
        const nested = findSlot([slot.blockValue], slotId)
        if (nested) {
          return nested
        }
      }
    }

    const nestedInChildren = findSlot(node.children, slotId)
    if (nestedInChildren) {
      return nestedInChildren
    }
  }
  return null
}

function findContainerAndIndex(
  container: BlockModel[],
  targetBlockId: string,
): { container: BlockModel[]; index: number } | null {
  for (let index = 0; index < container.length; index += 1) {
    const node = container[index]
    if (node.blockId === targetBlockId) {
      return { container, index }
    }

    const inChildren = findContainerAndIndex(node.children, targetBlockId)
    if (inChildren) {
      return inChildren
    }

    for (const slot of node.inlineSlots) {
      if (slot.blockValue) {
        const inInline = findContainerAndIndex([slot.blockValue], targetBlockId)
        if (inInline) {
          return inInline
        }
      }
    }
  }

  return null
}

function findStatementContainerAndIndex(
  container: BlockModel[],
  targetBlockId: string,
): { container: BlockModel[]; index: number } | null {
  for (let index = 0; index < container.length; index += 1) {
    const node = container[index]
    if (node.blockId === targetBlockId) {
      return { container, index }
    }

    const foundInChildren = findStatementContainerAndIndex(node.children, targetBlockId)
    if (foundInChildren) {
      return foundInChildren
    }
  }

  return null
}

function containsChildBlock(node: BlockModel, targetBlockId: string): boolean {
  for (const child of node.children) {
    if (child.blockId === targetBlockId || containsChildBlock(child, targetBlockId)) {
      return true
    }
  }
  return false
}

function removeBlockInTree(container: BlockModel[], targetBlockId: string): boolean {
  for (let index = 0; index < container.length; index += 1) {
    const node = container[index]
    if (node.blockId === targetBlockId) {
      container.splice(index, 1)
      return true
    }

    if (removeBlockInTree(node.children, targetBlockId)) {
      return true
    }

    for (const slot of node.inlineSlots) {
      if (!slot.blockValue) {
        continue
      }

      if (slot.blockValue.blockId === targetBlockId) {
        slot.blockValue = null
        return true
      }

      if (removeBlockInTree([slot.blockValue], targetBlockId)) {
        return true
      }
    }
  }

  return false
}

function extractBlockInTree(container: BlockModel[], targetBlockId: string): BlockModel | null {
  for (let index = 0; index < container.length; index += 1) {
    const node = container[index]
    if (node.blockId === targetBlockId) {
      container.splice(index, 1)
      return node
    }

    const fromChildren = extractBlockInTree(node.children, targetBlockId)
    if (fromChildren) {
      return fromChildren
    }

    for (const slot of node.inlineSlots) {
      if (!slot.blockValue) {
        continue
      }

      if (slot.blockValue.blockId === targetBlockId) {
        const extracted = slot.blockValue
        slot.blockValue = null
        return extracted
      }

      const fromInlineSubtree = extractBlockInTree([slot.blockValue], targetBlockId)
      if (fromInlineSubtree) {
        return fromInlineSubtree
      }
    }
  }

  return null
}

function containsSlotId(node: BlockModel, targetSlotId: string): boolean {
  for (const slot of node.inlineSlots) {
    if (slot.id === targetSlotId) {
      return true
    }
    if (slot.blockValue && containsSlotId(slot.blockValue, targetSlotId)) {
      return true
    }
  }

  for (const child of node.children) {
    if (containsSlotId(child, targetSlotId)) {
      return true
    }
  }

  return false
}

function hasLoopPlacementContext(nodes: BlockModel[], targetBlockId: string): boolean {
  const path = findBlockPath(nodes, targetBlockId)
  if (!path) {
    return false
  }

  return path.some((node) => node.type === 'for' || node.type === 'while')
}

function findBlockPath(
  nodes: BlockModel[],
  targetBlockId: string,
  path: BlockModel[] = [],
): BlockModel[] | null {
  for (const node of nodes) {
    const nextPath = [...path, node]
    if (node.blockId === targetBlockId) {
      return nextPath
    }

    const childPath = findBlockPath(node.children, targetBlockId, nextPath)
    if (childPath) {
      return childPath
    }

    for (const slot of node.inlineSlots) {
      if (!slot.blockValue) {
        continue
      }

      const inlinePath = findBlockPath([slot.blockValue], targetBlockId, nextPath)
      if (inlinePath) {
        return inlinePath
      }
    }
  }

  return null
}

function renderProgram(nodes: BlockModel[]): string {
  const body = nodes.map((node) => renderBlock(node, 0)).join('\n').trimEnd()
  const needsRandomImport = nodes.some((node) => containsBlockType(node, 'randomRandInt'))
  const needsTurtleImport = nodes.some((node) => containsAnyBlockType(node, [
    'turtleForward',
    'turtleBackward',
    'turtleLeft',
    'turtleRight',
    'turtleDone',
  ]))
  const needsMinecraftImport = nodes.some((node) => containsAnyBlockType(node, [
    'minecraftConnect',
    'minecraftPlayer',
    'minecraftGetTilePos',
    'minecraftSetTilePos',
    'minecraftSetBlock',
    'minecraftGetBlock',
  ]))
  const imports: string[] = []

  if (needsRandomImport) {
    imports.push('import random')
  }
  if (needsTurtleImport) {
    imports.push('import turtle')
  }
  if (needsMinecraftImport) {
    imports.push('import mcpi.minecraft as minecraft')
    imports.push('from mcpi import block')
  }

  if (imports.length === 0) {
    return body
  }

  if (!body) {
    return imports.join('\n')
  }

  return `${imports.join('\n')}\n\n${body}`
}

function renderBlock(node: BlockModel, depth: number): string {
  const indent = '  '.repeat(depth)
  const slotValues = node.inlineSlots.map((slot) => renderSlotValue(slot, true))
  const functionArgValues = node.inlineSlots.map((slot) => renderSlotValue(slot, false))

  if (node.type === 'if') {
    return renderStructured(indent, `if ${slotValues[0]}:`, node.children, depth)
  }
  if (node.type === 'elif') {
    return renderStructured(indent, `elif ${slotValues[0]}:`, node.children, depth)
  }
  if (node.type === 'else') {
    return renderStructured(indent, 'else:', node.children, depth)
  }
  if (node.type === 'for') {
    return renderStructured(indent, `for ${slotValues[0]} in ${slotValues[1]}:`, node.children, depth)
  }
  if (node.type === 'while') {
    return renderStructured(indent, `while ${slotValues[0]}:`, node.children, depth)
  }
  if (node.type === 'break') {
    return `${indent}break`
  }
  if (node.type === 'continue') {
    return `${indent}continue`
  }
  if (node.type === 'minecraftConnect') {
    const arg = renderSlotValue(node.inlineSlots[0], false)
    return arg ? `${indent}mc = minecraft.Minecraft.create(${arg})` : `${indent}mc = minecraft.Minecraft.create()`
  }
  if (node.type === 'minecraftPlayer') {
    return `${indent}player = mc.player`
  }
  if (node.type === 'minecraftGetTilePos') {
    return `${indent}${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]} = player.getTilePos()`
  }
  if (node.type === 'minecraftSetTilePos') {
    return `${indent}player.setTilePos(${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]})`
  }
  if (node.type === 'minecraftSetBlock') {
    return `${indent}mc.setBlock(${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]}, ${slotValues[3]})`
  }
  if (node.type === 'minecraftGetBlock') {
    return `${indent}mc.getBlock(${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]})`
  }
  if (node.type === 'turtleForward') {
    return `${indent}turtle.forward(${functionArgValues[0]})`
  }
  if (node.type === 'turtleBackward') {
    return `${indent}turtle.backward(${functionArgValues[0]})`
  }
  if (node.type === 'turtleLeft') {
    return `${indent}turtle.left(${functionArgValues[0]})`
  }
  if (node.type === 'turtleRight') {
    return `${indent}turtle.right(${functionArgValues[0]})`
  }
  if (node.type === 'turtleDone') {
    return `${indent}turtle.done()`
  }
  if (node.type === 'condAnd') {
    return `${indent}${functionArgValues[0]} and ${functionArgValues[1]}`
  }
  if (node.type === 'condOr') {
    return `${indent}${functionArgValues[0]} or ${functionArgValues[1]}`
  }
  if (node.type === 'condNot') {
    return `${indent}not ${functionArgValues[0]}`
  }
  if (node.type === 'assign') {
    return `${indent}${functionArgValues[0]} = ${functionArgValues[1]}`
  }
  if (node.type === 'range' || node.type === 'range1' || node.type === 'range2' || node.type === 'range3') {
    return `${indent}range(${functionArgValues.join(', ')})`
  }
  if (node.type === 'int') {
    return `${indent}int(${functionArgValues[0]})`
  }
  if (node.type === 'randomRandInt') {
    return `${indent}random.randint(${functionArgValues[0]}, ${functionArgValues[1]})`
  }
  if (node.type === 'print') {
    return `${indent}print(${functionArgValues[0]})`
  }
  return `${indent}input(${functionArgValues[0]})`
}

function renderStructured(indent: string, head: string, children: BlockModel[], depth: number): string {
  if (children.length === 0) {
    return `${indent}${head}\n${indent}  pass`
  }
  const body = children.map((child) => renderBlock(child, depth + 1)).join('\n')
  return `${indent}${head}\n${body}`
}

function renderInlineBlock(node: BlockModel): string {
  const slotValues = node.inlineSlots.map((slot) => renderSlotValue(slot, true))
  const functionArgValues = node.inlineSlots.map((slot) => renderSlotValue(slot, false))

  if (node.type === 'assign') {
    return `${functionArgValues[0]} = ${functionArgValues[1]}`
  }
  if (node.type === 'range' || node.type === 'range1' || node.type === 'range2' || node.type === 'range3') {
    return `range(${functionArgValues.join(', ')})`
  }
  if (node.type === 'int') {
    return `int(${functionArgValues[0]})`
  }
  if (node.type === 'randomRandInt') {
    return `random.randint(${functionArgValues[0]}, ${functionArgValues[1]})`
  }
  if (node.type === 'print') {
    return `print(${functionArgValues[0]})`
  }
  if (node.type === 'input') {
    return `input(${functionArgValues[0]})`
  }
  if (node.type === 'minecraftConnect') {
    const arg = renderSlotValue(node.inlineSlots[0], false)
    return arg ? `mc = minecraft.Minecraft.create(${arg})` : 'mc = minecraft.Minecraft.create()'
  }
  if (node.type === 'minecraftPlayer') {
    return 'player = mc.player'
  }
  if (node.type === 'minecraftGetTilePos') {
    return `${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]} = player.getTilePos()`
  }
  if (node.type === 'minecraftSetTilePos') {
    return `player.setTilePos(${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]})`
  }
  if (node.type === 'minecraftSetBlock') {
    return `mc.setBlock(${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]}, ${slotValues[3]})`
  }
  if (node.type === 'minecraftGetBlock') {
    return `mc.getBlock(${slotValues[0]}, ${slotValues[1]}, ${slotValues[2]})`
  }
  if (node.type === 'for') {
    return `(${slotValues[0]} in ${slotValues[1]})`
  }
  if (node.type === 'break') {
    return 'break'
  }
  if (node.type === 'continue') {
    return 'continue'
  }
  if (node.type === 'turtleForward') {
    return `turtle.forward(${functionArgValues[0]})`
  }
  if (node.type === 'turtleBackward') {
    return `turtle.backward(${functionArgValues[0]})`
  }
  if (node.type === 'turtleLeft') {
    return `turtle.left(${functionArgValues[0]})`
  }
  if (node.type === 'turtleRight') {
    return `turtle.right(${functionArgValues[0]})`
  }
  if (node.type === 'turtleDone') {
    return 'turtle.done()'
  }
  if (node.type === 'condAnd') {
    return `${functionArgValues[0]} and ${functionArgValues[1]}`
  }
  if (node.type === 'condOr') {
    return `${functionArgValues[0]} or ${functionArgValues[1]}`
  }
  if (node.type === 'condNot') {
    return `not ${functionArgValues[0]}`
  }
  if (node.type === 'if' || node.type === 'elif' || node.type === 'while') {
    return slotValues[0]
  }
  return 'else'
}

function renderSlotValue(slot: InlineSlotModel, allowPlaceholder: boolean): string {
  if (slot.blockValue) {
    return renderInlineBlock(slot.blockValue)
  }

  const text = slot.textValue.trim()
  if (text) {
    return text
  }

  if (!allowPlaceholder || slot.usePlaceholderAsDefault === false) {
    return ''
  }

  return slot.placeholder
}

function adjustRangeSlots(currentSlots: InlineSlotModel[], arity: number): InlineSlotModel[] {
  const slotWithPlaceholder = (slot: InlineSlotModel | undefined, placeholder: string): InlineSlotModel => {
    if (slot) {
      return { ...slot, placeholder, allowBlockDrop: true }
    }
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      placeholder,
      textValue: '',
      blockValue: null,
      allowBlockDrop: true,
    }
  }

  if (arity === 1) {
    const stop = currentSlots[1] ?? currentSlots[0]
    return [slotWithPlaceholder(stop, 'stop')]
  }

  if (arity === 2) {
    const start = currentSlots.length === 1 ? undefined : currentSlots[0]
    const stop = currentSlots.length === 1 ? currentSlots[0] : currentSlots[1]
    return [slotWithPlaceholder(start, 'start'), slotWithPlaceholder(stop, 'stop')]
  }

  const start = currentSlots.length === 1 ? undefined : currentSlots[0]
  const stop = currentSlots.length === 1 ? currentSlots[0] : currentSlots[1]
  const step = currentSlots.length === 3 ? currentSlots[2] : undefined
  return [slotWithPlaceholder(start, 'start'), slotWithPlaceholder(stop, 'stop'), slotWithPlaceholder(step, 'step')]
}

function normalizeBlockTree(block: BlockModel): void {
  applyVariableSlotRules(block)

  for (const child of block.children) {
    normalizeBlockTree(child)
  }

  for (const slot of block.inlineSlots) {
    if (slot.blockValue) {
      normalizeBlockTree(slot.blockValue)
    }
  }
}

function containsBlockType(node: BlockModel, targetType: BlockType): boolean {
  if (node.type === targetType) {
    return true
  }

  for (const child of node.children) {
    if (containsBlockType(child, targetType)) {
      return true
    }
  }

  for (const slot of node.inlineSlots) {
    if (slot.blockValue && containsBlockType(slot.blockValue, targetType)) {
      return true
    }
  }

  return false
}

function containsAnyBlockType(node: BlockModel, targetTypes: BlockType[]): boolean {
  return targetTypes.some((targetType) => containsBlockType(node, targetType))
}

function isInlineOnlyBlockType(type: BlockType): boolean {
  return (
    type === 'range' ||
    type === 'range1' ||
    type === 'range2' ||
    type === 'range3' ||
    type === 'condAnd' ||
    type === 'condOr' ||
    type === 'condNot'
  )
}

function isConditionLogicBlockType(type: BlockType): boolean {
  return type === 'condAnd' || type === 'condOr' || type === 'condNot'
}

function isLoopControlBlockType(type: BlockType): boolean {
  return type === 'break' || type === 'continue'
}
