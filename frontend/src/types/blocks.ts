export type BlockType =
  | 'if'
  | 'elif'
  | 'else'
  | 'for'
  | 'while'
  | 'break'
  | 'continue'
  | 'minecraftConnect'
  | 'minecraftPlayer'
  | 'minecraftGetTilePos'
  | 'minecraftSetTilePos'
  | 'minecraftSetBlock'
  | 'minecraftGetBlock'
  | 'turtleForward'
  | 'turtleBackward'
  | 'turtleLeft'
  | 'turtleRight'
  | 'turtleDone'
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
  usePlaceholderAsDefault?: boolean
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
  { type: 'assign', label: '赋值', inlinePlaceholders: ['变量', '值'], hasChildren: false },
  { type: 'if', label: 'if', inlinePlaceholders: ['condition'], hasChildren: true },
  { type: 'elif', label: 'elif', inlinePlaceholders: ['condition'], hasChildren: true },
  { type: 'else', label: 'else', inlinePlaceholders: [], hasChildren: true },
  { type: 'while', label: 'while', inlinePlaceholders: ['condition'], hasChildren: true },
  { type: 'for', label: 'for', inlinePlaceholders: ['item', 'iterable'], hasChildren: true },
  { type: 'break', label: 'break', inlinePlaceholders: [], hasChildren: false },
  { type: 'continue', label: 'continue', inlinePlaceholders: [], hasChildren: false },
  { type: 'print', label: 'print()', inlinePlaceholders: ['arg'], hasChildren: false },
  { type: 'input', label: 'input()', inlinePlaceholders: ['prompt'], hasChildren: false },
  { type: 'range', label: 'range()', inlinePlaceholders: ['stop'], hasChildren: false },
  { type: 'int', label: 'int()', inlinePlaceholders: ['arg'], hasChildren: false },
  { type: 'condAnd', label: 'and', inlinePlaceholders: ['left', 'right'], hasChildren: false },
  { type: 'condOr', label: 'or', inlinePlaceholders: ['left', 'right'], hasChildren: false },
  { type: 'condNot', label: 'not', inlinePlaceholders: ['value'], hasChildren: false },
  { type: 'randomRandInt', label: 'random.randInt()', inlinePlaceholders: ['arg1', 'arg2'], hasChildren: false },
  { type: 'turtleForward', label: 'turtle.forward()', inlinePlaceholders: ['参数'], hasChildren: false },
  { type: 'turtleBackward', label: 'turtle.backward()', inlinePlaceholders: ['参数'], hasChildren: false },
  { type: 'turtleLeft', label: 'turtle.left()', inlinePlaceholders: ['参数'], hasChildren: false },
  { type: 'turtleRight', label: 'turtle.right()', inlinePlaceholders: ['参数'], hasChildren: false },
  { type: 'turtleDone', label: 'turtle.done()', inlinePlaceholders: [], hasChildren: false },
  { type: 'minecraftConnect', label: '连接Minecraft', inlinePlaceholders: ['可选参数'], hasChildren: false },
  { type: 'minecraftPlayer', label: '得到player', inlinePlaceholders: [], hasChildren: false },
  { type: 'minecraftGetTilePos', label: '获得player的位置坐标', inlinePlaceholders: ['x', 'y', 'z'], hasChildren: false },
  { type: 'minecraftSetTilePos', label: '设置player的位置坐标', inlinePlaceholders: ['x', 'y', 'z'], hasChildren: false },
  { type: 'minecraftSetBlock', label: '放置方块', inlinePlaceholders: ['x', 'y', 'z', 'blockId'], hasChildren: false },
  { type: 'minecraftGetBlock', label: '取得方块Id', inlinePlaceholders: ['x', 'y', 'z'], hasChildren: false },
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
      usePlaceholderAsDefault: true,
      allowBlockDrop: true,
    })),
    children: [],
  }

  applyVariableSlotRules(block)
  applyMinecraftSlotRules(block)

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

  applyMinecraftSlotRules(block)
}

export function isStructuredBlock(type: BlockType): boolean {
  return type === 'if' || type === 'elif' || type === 'else' || type === 'for' || type === 'while'
}

function applyMinecraftSlotRules(block: BlockModel): void {
  if (block.type === 'minecraftConnect' && block.inlineSlots[0]) {
    block.inlineSlots[0].usePlaceholderAsDefault = false
  }

  if (block.type === 'minecraftGetTilePos') {
    for (const slot of block.inlineSlots) {
      slot.usePlaceholderAsDefault = true
      slot.allowBlockDrop = false
      slot.validationType = 'python_identifier'
    }
  }

  if (block.type === 'minecraftSetTilePos') {
    for (const slot of block.inlineSlots) {
      slot.usePlaceholderAsDefault = true
    }
  }

  if (block.type === 'minecraftSetBlock') {
    for (let index = 0; index < block.inlineSlots.length; index += 1) {
      const slot = block.inlineSlots[index]
      slot.usePlaceholderAsDefault = index < 3
      if (index === 3) {
        slot.allowBlockDrop = true
      }
    }
  }

  if (block.type === 'minecraftGetBlock') {
    for (const slot of block.inlineSlots) {
      slot.usePlaceholderAsDefault = true
    }
  }
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
