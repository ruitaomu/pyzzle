export type BlockType =
  | 'if'
  | 'elif'
  | 'else'
  | 'for'
  | 'while'
  | 'break'
  | 'continue'
  | 'condAnd'
  | 'condOr'
  | 'condNot'
  | 'print'
  | 'input'
  | 'int'
  | 'randomRandInt'
  | 'assign'
  | 'range'
  // legacy persisted block types (no longer shown in palette)
  | 'range1'
  | 'range2'
  | 'range3'

export type SlotValidationType = 'python_identifier'

export interface InlineSlotModel {
  id: string
  placeholder: string
  textValue: string
  blockValue: BlockModel | null
  allowBlockDrop?: boolean
  validationType?: SlotValidationType
  acceptsConditionBlocks?: boolean
}

export interface BlockModel {
  blockId: string
  type: BlockType
  label: string
  inlineSlots: InlineSlotModel[]
  children: BlockModel[]
}

export type IfChainRole = 'none' | 'start' | 'middle' | 'end' | 'single'

export interface IfChainInfo {
  startIndex: number
  endIndex: number
  types: BlockType[]
  blockIds: string[]
}

const blockPalette: Array<{ type: BlockType; label: string; inlinePlaceholders: string[]; hasChildren: boolean }> = [
  { type: 'if', label: 'if', inlinePlaceholders: ['condition'], hasChildren: true },
  { type: 'elif', label: 'elif', inlinePlaceholders: ['condition'], hasChildren: true },
  { type: 'else', label: 'else', inlinePlaceholders: [], hasChildren: true },
  { type: 'for', label: 'for', inlinePlaceholders: ['item', 'iterable'], hasChildren: true },
  { type: 'while', label: 'while', inlinePlaceholders: ['condition'], hasChildren: true },
  { type: 'break', label: 'break', inlinePlaceholders: [], hasChildren: false },
  { type: 'continue', label: 'continue', inlinePlaceholders: [], hasChildren: false },
  { type: 'condAnd', label: 'and', inlinePlaceholders: ['left', 'right'], hasChildren: false },
  { type: 'condOr', label: 'or', inlinePlaceholders: ['left', 'right'], hasChildren: false },
  { type: 'condNot', label: 'not', inlinePlaceholders: ['value'], hasChildren: false },
  { type: 'assign', label: '赋值', inlinePlaceholders: ['变量', '值'], hasChildren: false },
  { type: 'range', label: 'range()', inlinePlaceholders: ['stop'], hasChildren: false },
  { type: 'int', label: 'int()', inlinePlaceholders: ['arg'], hasChildren: false },
  { type: 'randomRandInt', label: 'random.randInt()', inlinePlaceholders: ['arg1', 'arg2'], hasChildren: false },
  { type: 'print', label: 'print()', inlinePlaceholders: ['arg'], hasChildren: false },
  { type: 'input', label: 'input()', inlinePlaceholders: ['prompt'], hasChildren: false },
]

const nextId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

export const paletteBlocks = blockPalette

export function createBlock(type: BlockType): BlockModel {
  const config = blockPalette.find((item) => item.type === type)
  if (!config) {
    throw new Error(`Unsupported block type: ${type}`)
  }

  const block: BlockModel = {
    blockId: nextId(),
    type,
    label: config.label,
    inlineSlots: config.inlinePlaceholders.map((placeholder) => ({
      id: nextId(),
      placeholder,
      textValue: '',
      blockValue: null,
      allowBlockDrop: true,
    })),
    children: [],
  }

  applyVariableSlotRules(block)

  return block
}

export function applyVariableSlotRules(block: BlockModel): void {
  if ((block.type === 'assign' || block.type === 'for') && block.inlineSlots[0]) {
    block.inlineSlots[0].allowBlockDrop = false
    block.inlineSlots[0].validationType = 'python_identifier'
  }

  if ((block.type === 'if' || block.type === 'while') && block.inlineSlots[0]) {
    block.inlineSlots[0].acceptsConditionBlocks = true
  }

  if (block.type === 'assign' && block.inlineSlots[1]) {
    block.inlineSlots[1].acceptsConditionBlocks = true
  }
}

export function isStructuredBlock(type: BlockType): boolean {
  return type === 'if' || type === 'elif' || type === 'else' || type === 'for' || type === 'while'
}

export function getIfChains(blocks: BlockModel[]): IfChainInfo[] {
  const chains: IfChainInfo[] = []

  let cursor = 0
  while (cursor < blocks.length) {
    if (blocks[cursor].type !== 'if') {
      cursor += 1
      continue
    }

    let end = cursor
    let probe = cursor + 1
    while (probe < blocks.length && blocks[probe].type === 'elif') {
      end = probe
      probe += 1
    }

    if (probe < blocks.length && blocks[probe].type === 'else') {
      end = probe
    }

    if (end > cursor) {
      const segment = blocks.slice(cursor, end + 1)
      chains.push({
        startIndex: cursor,
        endIndex: end,
        types: segment.map((item) => item.type),
        blockIds: segment.map((item) => item.blockId),
      })
      cursor = end + 1
      continue
    }

    cursor += 1
  }

  return chains
}

export function getIfChainRoles(blocks: BlockModel[]): IfChainRole[] {
  const roles: IfChainRole[] = blocks.map(() => 'none')

  const chains = getIfChains(blocks)
  for (const chain of chains) {
    const length = chain.endIndex - chain.startIndex + 1
    for (let index = chain.startIndex; index <= chain.endIndex; index += 1) {
      if (length === 1) {
        roles[index] = 'single'
      } else if (index === chain.startIndex) {
        roles[index] = 'start'
      } else if (index === chain.endIndex) {
        roles[index] = 'end'
      } else {
        roles[index] = 'middle'
      }
    }
  }

  return roles
}
