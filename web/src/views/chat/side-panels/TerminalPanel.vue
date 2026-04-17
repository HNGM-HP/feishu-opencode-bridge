<template>
  <div class="workspace-tool">
    <div class="tool-header">
      <div>
        <h4>终端</h4>
        <p>当前阶段先保留明确占位，不接半成品 PTY。</p>
      </div>
    </div>

    <div class="placeholder">
      <strong>Phase E 说明</strong>
      <p>
        OpenCode PTY / WebSocket 终端还没有并入这套新工作区，因此这里先不伪造一个不可交互的终端。
        当前建议直接使用上面的 Git 与文件面板；等 PTY 路由稳定后，再把这里接成真实终端。
      </p>
      <p>
        当前工作目录：{{ directory || '未绑定目录' }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  directory?: string
}>()
</script>

<style scoped>
.workspace-tool {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 16px;
  min-height: 0;
}

.tool-header {
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 12px;
}

.tool-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1a1a2e;
}

.tool-header p {
  margin: 4px 0 0;
  color: #8b8fa3;
  line-height: 1.5;
  font-size: 12px;
}

.placeholder {
  padding: 16px;
  border-radius: 8px;
  background: #f8f9fb;
  color: #4a4e69;
  font-size: 13px;
  line-height: 1.6;
}

.placeholder strong {
  display: block;
  margin-bottom: 8px;
  color: #1a1a2e;
}

.placeholder p + p {
  margin-top: 8px;
}
</style>
