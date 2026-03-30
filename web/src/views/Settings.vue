<template>
  <div class="settings-page">
    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <el-icon size="20"><Setting /></el-icon>
          <span>系统设置</span>
        </div>
      </template>

      <!-- Bridge 服务控制 -->
      <div class="section">
        <h3>Bridge 服务</h3>
        <div class="status-row">
          <span>状态：</span>
          <el-tag :type="bridgeStatus?.running ? 'success' : 'danger'">
            {{ bridgeStatus?.running ? '运行中' : '已停止' }}
          </el-tag>
          <span v-if="bridgeStatus?.running" class="pid-info">PID: {{ bridgeStatus.pid }}</span>
        </div>
        <div class="button-row">
          <el-button type="primary" :loading="restarting" @click="handleRestartBridge">
            重启 Bridge
          </el-button>
          <el-button type="danger" :loading="shuttingDown" @click="handleShutdown">
            终止服务
          </el-button>
        </div>
      </div>

      <el-divider />

      <!-- OpenCode 管理 -->
      <div class="section">
        <h3>OpenCode 管理</h3>
        <div class="status-row">
          <span>安装状态：</span>
          <el-tag :type="opencodeStatus?.installed ? 'success' : 'warning'">
            {{ opencodeStatus?.installed ? '已安装' : '未安装' }}
          </el-tag>
          <span v-if="opencodeStatus?.version" class="version-info">v{{ opencodeStatus.version }}</span>
        </div>
        <div class="status-row">
          <span>服务端口：</span>
          <el-tag :type="opencodeStatus?.portOpen ? 'success' : 'danger'">
            {{ opencodeStatus?.portOpen ? '已启动 (4096)' : '未响应' }}
          </el-tag>
        </div>
        <div class="status-row">
          <span>版本检查：</span>
          <template v-if="checkingOpenCodeUpdate">
            <el-text type="info">检查中...</el-text>
          </template>
          <template v-else-if="opencodeUpdateCheck">
            <template v-if="!opencodeStatus?.installed">
              <el-tag type="info">
                最新版本: {{ opencodeUpdateCheck.latestVersion || '获取失败' }}
              </el-tag>
            </template>
            <template v-else-if="opencodeUpdateCheck.githubError">
              <el-tag type="danger">检查失败</el-tag>
            </template>
            <template v-else>
              <el-tag v-if="hasOpenCodeUpdate" type="warning">
                有新版本 ({{ opencodeUpdateCheck.latestVersion }})
              </el-tag>
              <el-tag v-else type="success">已是最新</el-tag>
            </template>
          </template>
          <el-button
            size="small"
            :loading="checkingOpenCodeUpdate"
            @click="checkOpenCodeUpdate"
            link
          >
            刷新
          </el-button>
        </div>
        <div class="button-row">
          <el-button
            :loading="installingOpenCode"
            :disabled="opencodeStatus?.installed"
            @click="handleInstallOpenCode"
          >
            安装 OpenCode
          </el-button>
          <el-button
            :loading="upgradingOpenCode"
            :disabled="!opencodeStatus?.installed || !hasOpenCodeUpdate"
            @click="handleUpgradeOpenCode"
          >
            升级 OpenCode
          </el-button>
          <template v-if="!opencodeStatus?.portOpen">
            <el-select v-model="startMode" style="width: 140px" placeholder="启动方式">
              <el-option label="可视化启动" value="visual" />
              <el-option label="后台启动" value="headless" />
            </el-select>
            <el-button
              type="success"
              :loading="startingOpenCode"
              @click="handleStartOpenCode"
            >
              启动 OpenCode
            </el-button>
          </template>
          <el-button
            v-else
            type="danger"
            :loading="stoppingOpenCode"
            @click="handleStopOpenCode"
          >
            终止 OpenCode
          </el-button>
        </div>
      </div>

      <el-divider />

      <!-- 登录设置 -->
      <div class="section">
        <h3>登录设置</h3>
        <div class="status-row">
          <span>登录超时：</span>
          <el-input-number
            v-model="loginTimeout"
            :min="0"
            :max="1440"
            :step="10"
            :disabled="savingTimeout"
            style="width: 150px"
          />
          <span class="timeout-unit">分钟（0 表示不限制）</span>
        </div>
        <div class="button-row">
          <el-button type="primary" :loading="savingTimeout" @click="handleSaveTimeout">
            保存设置
          </el-button>
        </div>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="timeout-tip"
        >
          设置登录后无操作自动退出时间，0 表示永不超时。
        </el-alert>
      </div>

      <el-divider />

      <!-- 版本升级 -->
      <div class="section">
        <h3>版本升级</h3>
        <div class="status-row">
          <span>当前版本：</span>
          <el-tag>{{ status?.version || '未知' }}</el-tag>
        </div>
        <div class="status-row">
          <span>版本检查：</span>
          <template v-if="checkingBridgeUpdate">
            <el-text type="info">检查中...</el-text>
          </template>
          <template v-else-if="bridgeUpdateCheck">
            <el-tag v-if="bridgeUpdateCheck.hasUpdate" type="warning">
              有新版本 ({{ bridgeUpdateCheck.latestVersion }})
            </el-tag>
            <el-tag v-else type="success">已是最新</el-tag>
          </template>
          <el-button
            size="small"
            :loading="checkingBridgeUpdate"
            @click="checkBridgeUpdate"
            link
          >
            刷新
          </el-button>
        </div>
        <div class="button-row">
          <el-button
            type="warning"
            :loading="upgrading"
            :disabled="bridgeUpdateCheck && !bridgeUpdateCheck.hasUpdate"
            @click="handleUpgrade"
          >
            一键升级
          </el-button>
        </div>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="upgrade-tip"
        >
          升级将从 Git 拉取最新代码并重新构建，完成后需重启服务。
        </el-alert>
      </div>
    </el-card>

    <!-- 终止服务确认对话框 -->
    <el-dialog
      v-model="showShutdownDialog"
      title="警告"
      width="420px"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      >
        终止服务将停止 Bridge 和 OpenCode 所有进程，Web 面板也将无法访问。
      </el-alert>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showShutdownDialog = false">取消</el-button>
          <el-button type="warning" @click="handleStopBridgeOnly">
            仅关闭 Bridge
          </el-button>
          <el-button type="danger" @click="handleShutdownAll">
            终止所有服务
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'
import { configApi } from '../api/index'
import type { ServiceStatus, BridgeStatus, OpenCodeStatus, OpenCodeUpdateCheck } from '../api/index'
import { useConfigStore } from '../stores/config'

const store = useConfigStore()
const status = ref<ServiceStatus | null>(null)
const bridgeStatus = ref<BridgeStatus | null>(null)
const opencodeStatus = ref<OpenCodeStatus | null>(null)
const opencodeUpdateCheck = ref<OpenCodeUpdateCheck | null>(null)
const bridgeUpdateCheck = ref<{ hasUpdate: boolean; currentVersion: string; latestVersion: string | null } | null>(null)
const loginTimeout = ref(0)

const restarting = ref(false)
const shuttingDown = ref(false)
const showShutdownDialog = ref(false)
const installingOpenCode = ref(false)
const upgradingOpenCode = ref(false)
const startingOpenCode = ref(false)
const stoppingOpenCode = ref(false)
const upgrading = ref(false)
const checkingOpenCodeUpdate = ref(false)
const checkingBridgeUpdate = ref(false)
const savingTimeout = ref(false)
const startMode = ref<'visual' | 'headless'>('headless')

// 判断是否有 OpenCode 更新
const hasOpenCodeUpdate = computed(() => {
  if (!opencodeStatus.value?.installed || !opencodeUpdateCheck.value?.latestVersion) {
    return false
  }
  const current = opencodeStatus.value.version?.replace(/^v/, '') || ''
  const latest = opencodeUpdateCheck.value.latestVersion
  return current !== latest
})

async function loadStatus() {
  try {
    status.value = store.status
    bridgeStatus.value = await configApi.getBridgeStatus()
    opencodeStatus.value = await configApi.getOpenCodeStatus()
    const timeoutRes = await configApi.getLoginTimeout()
    loginTimeout.value = timeoutRes.timeoutMinutes
  } catch (e: any) {
    console.error('加载状态失败:', e)
  }
}

async function checkOpenCodeUpdate() {
  checkingOpenCodeUpdate.value = true
  try {
    opencodeUpdateCheck.value = await configApi.checkOpenCodeUpdate()
  } catch (e: any) {
    console.error('检查 OpenCode 更新失败:', e)
    ElMessage.error('检查更新失败: ' + (e.response?.data?.error || e.message))
  } finally {
    checkingOpenCodeUpdate.value = false
  }
}

async function checkBridgeUpdate() {
  checkingBridgeUpdate.value = true
  try {
    bridgeUpdateCheck.value = await configApi.checkBridgeUpdate()
  } catch (e: any) {
    console.error('检查 Bridge 更新失败:', e)
    ElMessage.error('检查更新失败: ' + (e.response?.data?.error || e.message))
  } finally {
    checkingBridgeUpdate.value = false
  }
}

async function handleRestartBridge() {
  restarting.value = true
  try {
    const result = await configApi.restart()
    if (result.ok) {
      ElMessageBox.alert(
        `Bridge 服务已重启完成${result.pid ? `，新进程 PID: ${result.pid}` : ''}`,
        '重启成功',
        { type: 'success', confirmButtonText: '确定' }
      )
      await loadStatus()
    } else {
      ElMessage.error('重启失败')
    }
  } catch (e: any) {
    ElMessage.error('重启失败: ' + (e.response?.data?.error || e.message))
  } finally {
    restarting.value = false
  }
}

function handleShutdown() {
  showShutdownDialog.value = true
}

async function handleStopBridgeOnly() {
  showShutdownDialog.value = false
  shuttingDown.value = true
  try {
    await configApi.stopBridge()
    ElMessage.success('Bridge 正在终止...')
    setTimeout(loadStatus, 2000)
  } catch (e: any) {
    ElMessage.error('终止 Bridge 失败: ' + (e.response?.data?.error || e.message))
  } finally {
    shuttingDown.value = false
  }
}

async function handleShutdownAll() {
  showShutdownDialog.value = false
  shuttingDown.value = true
  try {
    await configApi.shutdown()
    ElMessage.success('服务正在终止...')
  } catch (e: any) {
    ElMessage.error('终止失败: ' + (e.response?.data?.error || e.message))
  } finally {
    shuttingDown.value = false
  }
}

async function handleSaveTimeout() {
  savingTimeout.value = true
  try {
    await configApi.setLoginTimeout(loginTimeout.value)
    ElMessage.success('登录超时设置已保存')
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e.response?.data?.error || e.message))
  } finally {
    savingTimeout.value = false
  }
}

async function handleInstallOpenCode() {
  installingOpenCode.value = true
  try {
    const result = await configApi.installOpenCode()
    ElMessage.success(result.message)
    setTimeout(() => {
      refreshOpenCodeStatus()
      checkOpenCodeUpdate()
    }, 5000)
  } catch (e: any) {
    ElMessage.error('安装失败: ' + (e.response?.data?.error || e.message))
  } finally {
    installingOpenCode.value = false
  }
}

async function handleUpgradeOpenCode() {
  upgradingOpenCode.value = true
  try {
    const result = await configApi.upgradeOpenCode()
    ElMessage.success(result.message)
    setTimeout(() => {
      refreshOpenCodeStatus()
      checkOpenCodeUpdate()
    }, 5000)
  } catch (e: any) {
    ElMessage.error('升级失败: ' + (e.response?.data?.error || e.message))
  } finally {
    upgradingOpenCode.value = false
  }
}

async function handleStartOpenCode() {
  startingOpenCode.value = true
  try {
    const visual = startMode.value === 'visual'
    const result = await configApi.startOpenCode(visual)
    ElMessage.success(result.message)
    setTimeout(refreshOpenCodeStatus, 2000)
  } catch (e: any) {
    ElMessage.error('启动失败: ' + (e.response?.data?.error || e.message))
  } finally {
    startingOpenCode.value = false
  }
}

async function handleStopOpenCode() {
  try {
    await ElMessageBox.confirm(
      '确定要终止 OpenCode 服务吗？这将断开所有 OpenCode 连接。',
      '警告',
      {
        confirmButtonText: '确定终止',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    stoppingOpenCode.value = true
    const result = await configApi.stopOpenCode()
    ElMessage.success(result.message)
    setTimeout(refreshOpenCodeStatus, 2000)
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error('终止失败: ' + (e.response?.data?.error || e.message))
    }
  } finally {
    stoppingOpenCode.value = false
  }
}

async function refreshOpenCodeStatus() {
  try {
    opencodeStatus.value = await configApi.getOpenCodeStatus()
  } catch (e: any) {
    console.error('刷新状态失败:', e)
  }
}

async function handleUpgrade() {
  upgrading.value = true
  try {
    const result = await configApi.upgrade()
    ElMessage.success(result.message)
  } catch (e: any) {
    ElMessage.error('升级失败: ' + (e.response?.data?.error || e.message))
  } finally {
    upgrading.value = false
  }
}

onMounted(async () => {
  await loadStatus()
  await checkOpenCodeUpdate()
  await checkBridgeUpdate()
})
</script>

<style scoped>
.settings-page {
  max-width: 800px;
}

.settings-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section {
  margin-bottom: 16px;
}

.section h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.pid-info, .version-info, .timeout-unit {
  color: #909399;
  font-size: 13px;
}

.button-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.upgrade-tip, .timeout-tip {
  margin-top: 12px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>