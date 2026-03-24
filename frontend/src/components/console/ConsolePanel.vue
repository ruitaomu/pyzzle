<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ConsoleLine } from '../../stores/runSessionStore'

const props = defineProps<{
  lines: ConsoleLine[]
  runState: string
  connectionState: string
}>()

const containerRef = ref<HTMLElement | null>(null)

const stateText = computed(() => {
  if (props.runState === 'waiting_input') return '等待输入'
  if (props.runState === 'running') return '运行中'
  if (props.runState === 'submitting_input') return '提交输入中'
  if (props.runState === 'finished') return '已完成'
  if (props.runState === 'failed') return '失败'
  if (props.runState === 'interrupted') return '已中断'
  return '空闲'
})

const connectionText = computed(() => {
  if (props.connectionState === 'connected') return '已连接'
  if (props.connectionState === 'reconnecting') return '重连中'
  if (props.connectionState === 'blocked') return '已屏蔽'
  return '已终止'
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
      <div class="states">
        <span class="state">执行: {{ stateText }}</span>
        <span class="state">连接: {{ connectionText }}</span>
      </div>
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
  min-height: 220px;
  height: clamp(220px, 44vh, calc(100vh - 210px));
  max-height: calc(100vh - 130px);
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

.states {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lines {
  flex: 1;
  min-height: 0;
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

@media (max-width: 980px) {
  .console-panel {
    height: clamp(200px, 36vh, 420px);
    max-height: 60vh;
  }
}
</style>
