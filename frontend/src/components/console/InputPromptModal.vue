<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  promptText: string
}>()

const emit = defineEmits<{
  submit: [value: string]
  cancel: []
}>()

const value = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) value.value = ''
  },
)
</script>

<template>
  <div v-if="open" class="mask" @click.self="emit('cancel')">
    <div class="card">
      <h3>程序需要你的输入</h3>
      <p>{{ promptText }}</p>
      <input v-model="value" class="input" placeholder="请输入内容" @keydown.enter="emit('submit', value)" />
      <div class="actions">
        <button type="button" class="ghost" @click="emit('cancel')">取消</button>
        <button type="button" class="solid" @click="emit('submit', value)">提交</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgb(15 23 42 / 45%);
  display: grid;
  place-items: center;
  z-index: 50;
}

.card {
  width: min(420px, 92vw);
  background: #fff;
  border-radius: 16px;
  border: 2px solid var(--stroke);
  padding: 16px;
}

h3 {
  margin-top: 0;
}

.input {
  width: 100%;
  min-height: 42px;
  border-radius: 10px;
  border: 2px solid #a5d8ff;
  padding: 0 10px;
}

.actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  min-height: 40px;
  border-radius: 10px;
  border: 2px solid var(--stroke);
  padding: 0 14px;
  font-weight: 700;
}

.ghost {
  background: #f1f5f9;
}

.solid {
  background: #9bd3f7;
}
</style>
