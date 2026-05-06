<template>
  <div class="file-tree">
    <div
      v-for="entry in entries"
      :key="entry.id"
      class="file-tree-item"
      :style="{ paddingLeft: `${14 + entry.depth * 14}px` }"
    >
      <span class="icon">{{ entry.isDirectory ? '▸' : '•' }}</span>
      <span class="label">{{ entry.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  output: string | string[]
}>()

const entries = computed(() => {
  const rawEntries = Array.isArray(props.output)
    ? props.output
    : props.output.split('\n')

  return rawEntries
    .map((line, index) => {
      const normalized = line.replace(/\\/g, '/').trim()
      const depth = normalized.split('/').filter(Boolean).length - 1
      const isDirectory = normalized.endsWith('/')
      return {
        id: `${index}-${normalized}`,
        label: normalized,
        depth: Math.max(0, depth),
        isDirectory,
      }
    })
    .filter(entry => entry.label.length > 0)
})
</script>

<style scoped>
.file-tree {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.96);
  border: 1px solid rgba(203, 213, 225, 0.82);
}

.file-tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  color: #334155;
}

.icon {
  color: #0f766e;
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
