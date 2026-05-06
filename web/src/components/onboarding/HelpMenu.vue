<template>
  <el-dropdown trigger="click" placement="top-end" @command="handleCommand">
    <el-button size="small" :icon="QuestionFilled" class="help-btn">
      帮助
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="readme">
          <el-icon><Document /></el-icon>
          <span>README（项目说明）</span>
        </el-dropdown-item>
        <el-dropdown-item command="readme-en">
          <el-icon><Document /></el-icon>
          <span>README · English</span>
        </el-dropdown-item>
        <el-dropdown-item divided command="docs-platforms">
          <el-icon><ChatDotRound /></el-icon>
          <span>平台接入指南</span>
        </el-dropdown-item>
        <el-dropdown-item command="docs-opencode">
          <el-icon><Connection /></el-icon>
          <span>OpenCode 服务部署</span>
        </el-dropdown-item>
        <el-dropdown-item command="docs-reliability">
          <el-icon><Warning /></el-icon>
          <span>高可用与心跳策略</span>
        </el-dropdown-item>
        <el-dropdown-item divided command="github-issues">
          <el-icon><WarningFilled /></el-icon>
          <span>提交 Issue / 反馈</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem, ElIcon } from 'element-plus'
import { QuestionFilled, Document, ChatDotRound, Connection, Warning, WarningFilled } from '@element-plus/icons-vue'

/**
 * 帮助菜单
 *
 * - 链接均跳转到仓库内的对应 Markdown / README，让文档跟随代码版本
 * - 不再提供"重新查看引导"入口（onboarding 设计为一次性，按用户要求）
 */

const REPO_BASE = 'https://github.com/HNGM-HP/opencode-bridge'

const LINKS: Record<string, string> = {
  'readme':            `${REPO_BASE}#readme`,
  'readme-en':         `${REPO_BASE}/blob/main/README-en.md`,
  'docs-platforms':    `${REPO_BASE}/tree/main/docs#platforms`,
  'docs-opencode':     `${REPO_BASE}/tree/main/docs#opencode`,
  'docs-reliability':  `${REPO_BASE}/tree/main/docs#reliability`,
  'github-issues':     `${REPO_BASE}/issues`,
}

function handleCommand(command: string): void {
  const url = LINKS[command]
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<style scoped>
.help-btn { width: 100%; }
</style>
