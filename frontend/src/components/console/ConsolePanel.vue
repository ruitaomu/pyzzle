<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ConsoleLine } from '../../stores/runSessionStore'

const props = defineProps<{
  lines: ConsoleLine[]
  runState: string
}>()

const containerRef = ref<HTMLElement | null>(null)

const stateText = computed(() => {
  if (props.runState === 'waiting_input') return '等待输入'
  if (props.runState === 'running') return '运行中'
  if (props.runState === 'replacing') return '切换会话'
  if (props.runState === 'finished') return '已完成'
  if (props.runState === 'failed') return '失败'
  return '空闲'
})

watch(
  () => props.lines.length,
  async () => {
    await nextTick()
    if (!containerRef.value) return
    containerRef.value.scrollTop = containerRef.value.scrollHeight
  },
)
</script>

<template>
  <section class="console-panel">
    <header>
      <h3>控制台</h3>
      <span class="state">状态: {{ stateText }}</span>
    </header>

    <div ref="containerRef" class="lines">
      <div v-for="line in lines" :key="line.id" class="line" :class="line.stream">
        <span class="ts">{{ new Date(line.ts).toLocaleTimeString() }}</span>
        <span class="text">{{ line.text }}</span>
      </div>
      <div v-if="lines.length === 0" class="empty">暂无输出，点击运行后会显示这里。</div>
    </div>
  </section>
</template>

<style scoped>
.console-panel {
  background: #1f2937;
  color: #ecf2f8;
  border-radius: 16px;
  padding: 10px;
  border: 2px solid #334155;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h3 {
  margin: 0;
  font-size: 15px;
}

.state {
  font-size: 12px;
  color: #9ec6ff;
}

.lines {
  flex: 1;
  overflow: auto;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 13px;
  line-height: 1.4;
}

.line {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 8px;
  padding: 2px 0;
}

.ts {
  color: #9ca3af;
}

.line.stderr .text {
  color: #ff9aa2;
}

.line.system .text {
  color: #f7d488;
}

.empty {
  color: #a8b9cf;
  padding: 8px 0;
}
</style>
