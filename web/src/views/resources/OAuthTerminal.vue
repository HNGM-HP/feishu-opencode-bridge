<template>
  <el-dialog
    v-model="visible"
    title="OAuth 登录终端"
    width="800px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="terminal-container">
      <div ref="terminalRef" class="terminal" />
    </div>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
      <el-button type="primary" @click="executeLogin" :disabled="!isConnected">
        开始登录
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

interface Props {
  modelValue: boolean
  provider?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
  error: [message: string]
}>()

const visible = ref(false)
const terminalRef = ref<HTMLElement>()
const isConnected = ref(false)
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null

// WebSocket URL
const getWsUrl = () => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.host
  return `${protocol}//${host}/api/resources/terminal/ws`
}

// 初始化终端
const initTerminal = () => {
  if (!terminalRef.value) return

  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#ffffff',
      selection: '#264f78',
    },
    scrollback: 1000,
  })

  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  terminal.open(terminalRef.value)
  fitAddon.fit()

  // 处理终端输入
  terminal.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  })
}

// 连接 WebSocket
const connect = () => {
  if (ws) {
    ws.close()
  }

  const url = getWsUrl()
  ws = new WebSocket(url)

  ws.onopen = () => {
    isConnected.value = true
    terminal?.writeln('\r\n✓ 已连接到终端服务\r\n')
  }

  ws.onmessage = (event) => {
    terminal?.write(event.data)
  }

  ws.onerror = () => {
    terminal?.writeln('\r\n❌ WebSocket 连接错误\r\n')
    isConnected.value = false
  }

  ws.onclose = () => {
    isConnected.value = false
    terminal?.writeln('\r\n⚠️  连接已关闭\r\n')

    // 尝试重连
    if (visible.value) {
      reconnectTimer = setTimeout(() => {
        terminal?.writeln('\r\n🔄 正在重连...\r\n')
        connect()
      }, 3000)
    }
  }
}

// 执行登录命令
const executeLogin = () => {
  if (!isConnected.value || !ws) {
    return
  }

  const command = props.provider
    ? `opencode providers login ${props.provider}`
    : 'opencode providers login'

  ws.send(command + '\r')
}

// 关闭对话框
const handleClose = () => {
  visible.value = false
  emit('update:modelValue', false)

  // 清理连接
  if (ws) {
    ws.close()
    ws = null
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  isConnected.value = false
}

// 监听 modelValue 变化
watch(() => props.modelValue, (val) => {
  visible.value = val

  if (val) {
    nextTick(() => {
      if (!terminal) {
        initTerminal()
      }
      connect()
    })
  } else {
    handleClose()
  }
})

// 窗口大小改变时调整终端大小
const handleResize = () => {
  if (fitAddon) {
    fitAddon.fit()
  }
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  visible.value = props.modelValue
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  handleClose()

  if (terminal) {
    terminal.dispose()
    terminal = null
  }
})
</script>

<style scoped>
.terminal-container {
  width: 100%;
  height: 400px;
  background: #1e1e1e;
  border-radius: 4px;
  overflow: hidden;
}

.terminal {
  width: 100%;
  height: 100%;
  padding: 8px;
}

:deep(.el-dialog__body) {
  padding: 10px 20px;
}
</style>
