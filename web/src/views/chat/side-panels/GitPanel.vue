<template>
  <div class="git-panel">
    <!-- No directory -->
    <div v-if="!directory" class="empty-state">
      <div class="empty-state__icon">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M12 8v4m0 4h.01" stroke-linecap="round" />
        </svg>
      </div>
      <p class="empty-state__text">当前没有工作目录</p>
      <p class="empty-state__hint">先绑定会话目录，或在配置里设置 <code>DEFAULT_WORK_DIRECTORY</code></p>
    </div>

    <!-- Error / Init prompt -->
    <div v-else-if="error" class="empty-state">
      <template v-if="error.includes('当前没有建立git仓库') || error.includes('当前目录不是 Git 仓库')">
        <div class="empty-state__icon empty-state__icon--brand">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="3" />
            <circle cx="6" cy="18" r="2" />
            <circle cx="18" cy="6" r="2" />
            <path d="M12 15v1a2 2 0 0 1-2 2H8m8-12h-2a2 2 0 0 0-2 2v2" />
          </svg>
        </div>
        <p class="empty-state__text">尚未初始化 Git 仓库</p>
        <p class="empty-state__hint">创建 Git 仓库以开始版本控制</p>
        <el-button
          type="primary"
          round
          :loading="busyAction === 'init'"
          @click="handleInitRepo"
        >
          初始化仓库
        </el-button>
      </template>
      <template v-else>
        <div class="empty-state__icon empty-state__icon--error">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <p class="empty-state__text">{{ error }}</p>
      </template>
    </div>

    <!-- Loading -->
    <div v-else-if="loading && !status" class="empty-state">
      <div class="empty-state__spinner" />
      <p class="empty-state__text">正在读取 Git 状态...</p>
    </div>

    <!-- Main content -->
    <template v-else-if="status">
      <!-- Header bar -->
      <header class="git-header">
        <div class="git-header__branch">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="icon-branch">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
          </svg>
          <span class="branch-name">{{ status.branch }}</span>
          <span v-if="status.detached" class="detached-badge">DETACHED</span>
        </div>
        <div class="git-header__actions">
          <span v-if="status.tracking" class="sync-indicator">
            <template v-if="status.ahead > 0">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M3.5 10a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 3.5 10zm2.25-4.5L8 3.25l2.25 2.25" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
              {{ status.ahead }}
            </template>
            <template v-if="status.behind > 0">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M3.5 6a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 3.5 6zm2.25 4.5L8 12.75l2.25-2.25" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
              {{ status.behind }}
            </template>
          </span>
          <button class="icon-btn" title="刷新" :disabled="loading" @click="refreshStatus(true)">
            <svg :class="['spin-icon', { 'spin-icon--spinning': loading }]" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.418A6 6 0 1 1 8 2v1z" />
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
            </svg>
          </button>
        </div>
      </header>

      <!-- Status pills -->
      <div class="status-bar">
        <span :class="['status-chip', status.clean ? 'status-chip--clean' : 'status-chip--dirty']">
          <span class="status-dot" />
          {{ status.clean ? '干净' : '有变更' }}
        </span>
        <span v-if="status.counts.staged" class="status-chip status-chip--staged">
          暂存 {{ status.counts.staged }}
        </span>
        <span v-if="status.counts.modified" class="status-chip status-chip--modified">
          修改 {{ status.counts.modified }}
        </span>
        <span v-if="status.counts.untracked" class="status-chip status-chip--untracked">
          未跟踪 {{ status.counts.untracked }}
        </span>
        <span v-if="status.counts.conflicted" class="status-chip status-chip--conflict">
          冲突 {{ status.counts.conflicted }}
        </span>
      </div>

      <!-- Scrollable body -->
      <div class="git-body">
        <!-- ==================== Commit Section ==================== -->
        <section class="git-section">
          <button type="button" class="section-toggle" @click="toggleSection('commit')">
            <svg :class="['chevron', { 'chevron--open': openSections.commit }]" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
            </svg>
            <span class="section-title">提交 & 同步</span>
          </button>

          <div v-show="openSections.commit" class="section-body">
            <div class="commit-form">
              <el-input
                v-model="commitMessage"
                type="textarea"
                :rows="2"
                resize="none"
                placeholder="输入提交说明..."
                class="commit-textarea"
              />
              <div class="commit-toolbar">
                <el-button
                  type="primary"
                  size="small"
                  :disabled="!commitMessage.trim()"
                  :loading="busyAction === 'commit'"
                  @click="handleCommit"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" style="margin-right:4px">
                    <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5h-3.32zM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
                  </svg>
                  提交全部
                </el-button>
                <div class="sync-buttons">
                  <el-button
                    size="small"
                    :loading="busyAction === 'pull'"
                    @click="handlePull"
                    title="Pull"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                      <path d="M8 12.25l-3.5-3.5h2.75V2.5h1.5v6.25h2.75L8 12.25z" />
                      <path d="M3 13.5h10" stroke="currentColor" stroke-width="1.2" />
                    </svg>
                  </el-button>
                  <el-button
                    size="small"
                    :loading="busyAction === 'push'"
                    @click="handlePush"
                    title="Push"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                      <path d="M8 3.75l3.5 3.5H8.75v6.25h-1.5V7.25H4.5L8 3.75z" />
                      <path d="M3 2.5h10" stroke="currentColor" stroke-width="1.2" />
                    </svg>
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ==================== Changes Section ==================== -->
        <section class="git-section">
          <button type="button" class="section-toggle" @click="toggleSection('changes')">
            <svg :class="['chevron', { 'chevron--open': openSections.changes }]" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
            </svg>
            <span class="section-title">变更文件</span>
            <span v-if="status.files.length" class="section-count">{{ status.files.length }}</span>
          </button>

          <div v-show="openSections.changes" class="section-body">
            <div v-if="status.clean" class="section-empty">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="section-empty__icon">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
              </svg>
              工作区干净
            </div>

            <div v-else class="file-tree">
              <button
                v-for="file in status.files"
                :key="file.path"
                type="button"
                :class="['tree-item', { 'tree-item--active': file.path === selectedPath }]"
                @click="selectFile(file.path)"
              >
                <span :class="['file-indicator', indicatorClass(file)]" />
                <span class="tree-item__path">{{ file.path }}</span>
                <span class="tree-item__letter">{{ statusLetter(file) }}</span>
              </button>
            </div>

            <!-- Diff viewer -->
            <template v-if="selectedPath">
              <div class="diff-header">
                <span class="diff-header__title">Diff</span>
                <div v-if="showDiffToggle" class="tab-switch">
                  <button
                    type="button"
                    :class="['tab-switch__btn', { 'tab-switch__btn--active': diffMode === 'working' }]"
                    @click="diffMode = 'working'"
                  >工作区</button>
                  <button
                    type="button"
                    :class="['tab-switch__btn', { 'tab-switch__btn--active': diffMode === 'staged' }]"
                    @click="diffMode = 'staged'"
                  >已暂存</button>
                </div>
              </div>

              <div v-if="diffLoading" class="section-empty">
                <div class="mini-spinner" /> 加载中...
              </div>
              <div v-else-if="diffNotice" class="section-empty">{{ diffNotice }}</div>
              <CodeBlock
                v-else-if="diffText"
                :code="diffText"
                language="diff"
                :title="selectedPath"
              />
            </template>
          </div>
        </section>

        <!-- ==================== Branch Section ==================== -->
        <section class="git-section">
          <button type="button" class="section-toggle" @click="toggleSection('branches')">
            <svg :class="['chevron', { 'chevron--open': openSections.branches }]" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
            </svg>
            <span class="section-title">分支</span>
            <span class="section-count">{{ status.branches.length }}</span>
          </button>

          <div v-show="openSections.branches" class="section-body">
            <div class="branch-control">
              <el-select
                v-model="selectedBranch"
                size="small"
                filterable
                placeholder="选择分支"
                :disabled="status.branches.length === 0 || busyAction === 'checkout' || busyAction === 'delete-branch' || busyAction === 'create-branch'"
                class="branch-select"
              >
                <el-option
                  v-for="branch in status.branches"
                  :key="branch"
                  :label="branch"
                  :value="branch"
                >
                  <span class="branch-option">
                    <svg v-if="branch === status.branch" viewBox="0 0 16 16" width="12" height="12" fill="var(--el-color-success)">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                    {{ branch }}
                  </span>
                </el-option>
              </el-select>

              <div class="branch-btn-group">
                <el-button
                  size="small"
                  :disabled="!selectedBranch || selectedBranch === status.branch"
                  :loading="busyAction === 'checkout'"
                  @click="handleCheckout"
                  title="切换分支"
                >切换</el-button>
                <el-button
                  size="small"
                  :loading="busyAction === 'create-branch'"
                  @click="handleCreateBranch"
                  title="新建分支"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                    <path d="M8 2.75a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2.75z" />
                  </svg>
                </el-button>
                <el-button
                  size="small"
                  type="danger"
                  :disabled="!selectedBranch || selectedBranch === status.branch"
                  :loading="busyAction === 'delete-branch'"
                  @click="handleDeleteBranch"
                  title="删除分支"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                    <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75zm4 0V3h2.25a.75.75 0 0 1 0 1.5H14v8.75A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V4.5h-.25a.75.75 0 0 1 0-1.5H4V1.75C4 .784 4.784 0 5.75 0h4.5C11.216 0 12 .784 12 1.75h-1.5zM3.5 4.5v8.75c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V4.5h-9z" />
                  </svg>
                </el-button>
              </div>
            </div>
          </div>
        </section>

        <!-- ==================== History Section ==================== -->
        <section class="git-section">
          <button type="button" class="section-toggle" @click="toggleSection('history')">
            <svg :class="['chevron', { 'chevron--open': openSections.history }]" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
            </svg>
            <span class="section-title">历史记录</span>
            <span v-if="historyEntries.length" class="section-count">{{ historyEntries.length }}</span>
            <button
              class="icon-btn icon-btn--inline"
              title="刷新历史"
              :disabled="historyLoading"
              @click.stop="loadHistory(true)"
            >
              <svg :class="['spin-icon', { 'spin-icon--spinning': historyLoading }]" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 1 .908-.418A6 6 0 1 1 8 2v1z" />
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
              </svg>
            </button>
          </button>

          <div v-show="openSections.history" class="section-body">
            <div v-if="historyLoading && historyEntries.length === 0" class="section-empty">
              <div class="mini-spinner" /> 正在加载...
            </div>
            <div v-else-if="historyError" class="section-empty section-empty--error">{{ historyError }}</div>
            <div v-else-if="historyEntries.length === 0" class="section-empty">暂无历史记录</div>

            <div v-else class="timeline">
              <div
                v-for="(entry, index) in historyEntries"
                :key="entry.sha"
                :class="['timeline-node', { 'timeline-node--active': entry.sha === selectedCommitSha }]"
                @click="selectCommit(entry.sha)"
              >
                <div class="timeline-node__line">
                  <span class="timeline-dot" />
                  <span v-if="index < historyEntries.length - 1" class="timeline-connector" />
                </div>
                <div class="timeline-node__body">
                  <div class="timeline-node__msg">{{ entry.message }}</div>
                  <div class="timeline-node__meta">
                    <code>{{ entry.sha.slice(0, 7) }}</code>
                    <span>{{ entry.authorName }}</span>
                    <span>{{ formatRelativeTime(entry.date) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Commit detail -->
            <template v-if="selectedCommitSha">
              <div class="detail-card">
                <div v-if="commitDetailLoading" class="section-empty">
                  <div class="mini-spinner" /> 加载详情...
                </div>
                <div v-else-if="commitDetailError" class="section-empty section-empty--error">{{ commitDetailError }}</div>

                <template v-else-if="selectedCommitDetail">
                  <div class="detail-card__head">
                    <div class="detail-card__title">{{ selectedCommitDetail.message }}</div>
                    <div class="detail-card__meta">
                      <code>{{ selectedCommitDetail.sha.slice(0, 7) }}</code>
                      <span>{{ selectedCommitDetail.authorName }}</span>
                      <span>{{ formatCommitDate(selectedCommitDetail.date) }}</span>
                    </div>
                  </div>

                  <div class="detail-card__actions">
                    <el-button
                      size="small"
                      :disabled="!status.clean || busyAction === 'checkout-history'"
                      :loading="busyAction === 'checkout-history'"
                      @click="handleCheckoutHistory"
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="margin-right:3px">
                        <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834z" />
                        <path d="M14.295 7.995a.75.75 0 0 1-.834-.656 5.5 5.5 0 0 0-9.592-2.97l1.204 1.204a.25.25 0 0 1-.177.427H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-.656.834z" />
                      </svg>
                      检出此版本
                    </el-button>
                    <span v-if="!status.clean" class="detail-card__warn">工作区有未提交变更，请先提交或暂存</span>
                  </div>

                  <div v-if="selectedCommitDetail.stats" class="detail-card__stats">
                    <pre>{{ selectedCommitDetail.stats }}</pre>
                  </div>

                  <CodeBlock
                    v-if="selectedCommitDetail.diff"
                    :code="selectedCommitDetail.diff"
                    language="diff"
                    :title="`${selectedCommitDetail.sha.slice(0, 7)}.diff`"
                  />
                  <div v-else class="section-empty">无 diff 输出</div>
                </template>
              </div>
            </template>
          </div>
        </section>

        <!-- ==================== Repo Info Section ==================== -->
        <section class="git-section">
          <button type="button" class="section-toggle" @click="toggleSection('info')">
            <svg :class="['chevron', { 'chevron--open': openSections.info }]" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z" />
            </svg>
            <span class="section-title">仓库信息</span>
          </button>

          <div v-show="openSections.info" class="section-body">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">仓库根目录</span>
                <span class="info-value info-value--mono">{{ status.repositoryRoot }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">上游追踪</span>
                <span class="info-value">{{ status.tracking || '未绑定' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">HEAD 状态</span>
                <span class="info-value">{{ status.detached ? 'Detached HEAD' : '正常' }}</span>
              </div>
            </div>
            <div v-if="status.lastCommit" class="last-commit-card">
              <div class="last-commit-card__label">最近提交</div>
              <div class="last-commit-card__msg">{{ status.lastCommit.message }}</div>
              <div class="last-commit-card__meta">
                {{ status.lastCommit.authorName }} · {{ formatCommitDate(status.lastCommit.date) }}
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import CodeBlock from '../../../components/ai-elements/CodeBlock.vue'
import { getActiveDateLocale, isEnglishLocale } from '../../../i18n/runtime'
import {
  workspaceApi,
  type WorkspaceGitCommitDetail,
  type WorkspaceGitFileStatus,
  type WorkspaceGitLogEntry,
  type WorkspaceGitStatus,
} from '../../../api'

const props = defineProps<{
  directory?: string
}>()

type BusyAction =
  | 'refresh'
  | 'pull'
  | 'push'
  | 'commit'
  | 'checkout'
  | 'checkout-history'
  | 'create-branch'
  | 'delete-branch'
  | 'init'
  | null
type DiffMode = 'working' | 'staged'

const status = ref<WorkspaceGitStatus | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const busyAction = ref<BusyAction>(null)
const commitMessage = ref('')
const selectedBranch = ref('')
const selectedPath = ref('')
const diffMode = ref<DiffMode>('working')
const diffLoading = ref(false)
const diffText = ref('')
const diffNotice = ref('选择一个变更文件查看 diff。')
const historyEntries = ref<WorkspaceGitLogEntry[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const selectedCommitSha = ref('')
const selectedCommitDetail = ref<WorkspaceGitCommitDetail | null>(null)
const commitDetailLoading = ref(false)
const commitDetailError = ref('')

const openSections = reactive({
  commit: false,
  changes: false,
  branches: false,
  history: false,
  info: false,
})

let statusVersion = 0
let diffVersion = 0
let historyVersion = 0
let commitDetailVersion = 0

const selectedFile = computed(() => status.value?.files.find(file => file.path === selectedPath.value) || null)
const showDiffToggle = computed(() => Boolean(selectedFile.value?.staged && selectedFile.value?.modified))

function toggleSection(key: keyof typeof openSections) {
  openSections[key] = !openSections[key]
}

watch(
  () => props.directory,
  async directory => {
    statusVersion += 1
    diffVersion += 1
    historyVersion += 1
    commitDetailVersion += 1
    status.value = null
    error.value = null
    selectedPath.value = ''
    selectedBranch.value = ''
    diffText.value = ''
    historyEntries.value = []
    historyLoading.value = false
    historyError.value = ''
    selectedCommitSha.value = ''
    selectedCommitDetail.value = null
    commitDetailLoading.value = false
    commitDetailError.value = ''
    diffNotice.value = directory
      ? '选择一个变更文件查看 diff。'
      : '当前没有工作目录。'

    if (!directory) return
    await refreshStatus(false)
  },
  { immediate: true }
)

watch(
  () => [selectedPath.value, diffMode.value, props.directory] as const,
  async () => {
    await loadDiff()
  }
)

watch(
  () => [selectedCommitSha.value, props.directory] as const,
  async () => {
    await loadCommitDetail()
  }
)

async function refreshStatus(announce = false): Promise<void> {
  if (!props.directory) return
  const currentVersion = ++statusVersion
  loading.value = true
  error.value = null
  busyAction.value = busyAction.value ?? 'refresh'

  try {
    const nextStatus = await workspaceApi.getGitStatus(props.directory)
    if (currentVersion !== statusVersion) return

    status.value = nextStatus
    const currentFile = nextStatus.files.find(file => file.path === selectedPath.value)
    if (!currentFile) {
      selectedPath.value = nextStatus.files[0]?.path || ''
    }

    const activeBranch = nextStatus.branches.includes(nextStatus.branch)
      ? nextStatus.branch
      : nextStatus.branches[0] || ''
    selectedBranch.value = nextStatus.branches.includes(selectedBranch.value)
      ? selectedBranch.value
      : activeBranch

    const defaultDiffMode = pickDefaultDiffMode(nextStatus.files.find(file => file.path === selectedPath.value) || null)
    if (defaultDiffMode) {
      diffMode.value = defaultDiffMode
    }

    void loadHistory(false)

    if (announce) {
      ElMessage.success('Git 状态已刷新')
    }
  } catch (err: unknown) {
    if (currentVersion !== statusVersion) {
      return
    }

    let errorMessage = '读取 Git 状态失败'

    // 从 axios 响应中提取后端返回的错误信息和状态码
    const axiosError = err as { response?: { status?: number; data?: { error?: string } }; message?: string }
    const httpStatus = axiosError.response?.status
    const backendMessage = axiosError.response?.data?.error ?? ''

    if (httpStatus === 409 || backendMessage.includes('不是 Git 仓库') || backendMessage.includes('not a git repository')) {
      // 409 = ensureGitRepo 检测到当前目录不是 git 仓库
      errorMessage = '当前目录不是 Git 仓库'
    } else if (httpStatus === 403 || backendMessage.includes('forbidden')) {
      errorMessage = '当前没有建立git仓库'
    } else if (backendMessage) {
      errorMessage = backendMessage
    } else if (err instanceof Error) {
      errorMessage = err.message
    }

    error.value = errorMessage
  } finally {
    if (currentVersion === statusVersion) {
      loading.value = false
      if (busyAction.value === 'refresh') {
        busyAction.value = null
      }
    }
  }
}

async function loadDiff(): Promise<void> {
  if (!props.directory || !selectedFile.value) {
    diffText.value = ''
    diffNotice.value = props.directory ? '选择一个变更文件查看 diff。' : '当前没有工作目录。'
    return
  }

  const file = selectedFile.value
  const staged = diffMode.value === 'staged'

  if (file.untracked) {
    diffText.value = ''
    diffNotice.value = '未跟踪文件暂不支持 Git diff，可切到文件面板查看内容。'
    return
  }

  if (staged && !file.staged) {
    diffText.value = ''
    diffNotice.value = '当前文件没有已暂存的 diff。'
    return
  }

  if (!staged && !file.modified && file.staged) {
    diffText.value = ''
    diffNotice.value = '当前文件只有已暂存 diff，请切换到"已暂存"查看。'
    return
  }

  const currentVersion = ++diffVersion
  diffLoading.value = true

  try {
    const result = await workspaceApi.getGitDiff({
      directory: props.directory,
      filePath: file.path,
      staged,
    })
    if (currentVersion !== diffVersion) return

    diffText.value = result.diff
    diffNotice.value = result.diff ? '' : '当前选择没有 diff 输出。'
  } catch (err) {
    if (currentVersion !== diffVersion) return
    diffText.value = ''
    diffNotice.value = err instanceof Error ? err.message : '加载 diff 失败'
  } finally {
    if (currentVersion === diffVersion) {
      diffLoading.value = false
    }
  }
}

async function loadHistory(announce = false): Promise<void> {
  if (!props.directory) {
    historyEntries.value = []
    historyLoading.value = false
    historyError.value = ''
    return
  }

  const currentVersion = ++historyVersion
  historyLoading.value = true
  historyError.value = ''

  try {
    const entries = await workspaceApi.getGitHistory(props.directory, 30)
    if (currentVersion !== historyVersion) return

    historyEntries.value = entries
    if (!entries.some(entry => entry.sha === selectedCommitSha.value)) {
      selectedCommitSha.value = entries[0]?.sha || ''
    }

    if (announce) {
      ElMessage.success('历史版本已刷新')
    }
  } catch (err) {
    if (currentVersion !== historyVersion) return
    historyEntries.value = []
    historyError.value = err instanceof Error ? err.message : '读取历史版本失败'
  } finally {
    if (currentVersion === historyVersion) {
      historyLoading.value = false
    }
  }
}

async function loadCommitDetail(): Promise<void> {
  if (!props.directory || !selectedCommitSha.value) {
    selectedCommitDetail.value = null
    commitDetailLoading.value = false
    commitDetailError.value = ''
    return
  }

  const currentVersion = ++commitDetailVersion
  commitDetailLoading.value = true
  commitDetailError.value = ''

  try {
    const detail = await workspaceApi.getGitCommitDetail(props.directory, selectedCommitSha.value)
    if (currentVersion !== commitDetailVersion) return
    selectedCommitDetail.value = detail
  } catch (err) {
    if (currentVersion !== commitDetailVersion) return
    selectedCommitDetail.value = null
    commitDetailError.value = err instanceof Error ? err.message : '读取历史版本详情失败'
  } finally {
    if (currentVersion === commitDetailVersion) {
      commitDetailLoading.value = false
    }
  }
}

function selectFile(path: string): void {
  selectedPath.value = path
  const nextFile = status.value?.files.find(file => file.path === path) || null
  const nextMode = pickDefaultDiffMode(nextFile)
  if (nextMode) {
    diffMode.value = nextMode
  }
}

function pickDefaultDiffMode(file: WorkspaceGitFileStatus | null): DiffMode | null {
  if (!file) return null
  if (file.modified) return 'working'
  if (file.staged) return 'staged'
  return 'working'
}

function indicatorClass(file: WorkspaceGitFileStatus): string {
  if (file.conflicted) return 'file-indicator--conflict'
  if (file.untracked) return 'file-indicator--untracked'
  if (file.staged && file.modified) return 'file-indicator--both'
  if (file.staged) return 'file-indicator--staged'
  if (file.modified) return 'file-indicator--modified'
  return ''
}

function statusLetter(file: WorkspaceGitFileStatus): string {
  if (file.conflicted) return 'C'
  if (file.untracked) return 'U'
  return `${file.index}${file.workingTree}`.trim()
}

function selectCommit(sha: string): void {
  selectedCommitSha.value = sha
}

async function runAction(action: Exclude<BusyAction, 'refresh' | null>, successMessage: string, task: () => Promise<void>): Promise<void> {
  if (!props.directory) return
  busyAction.value = action
  try {
    await task()
    ElMessage.success(successMessage)
    await refreshStatus(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : 'Git 操作失败')
  } finally {
    busyAction.value = null
  }
}

async function handleCommit(): Promise<void> {
  const message = commitMessage.value.trim()
  if (!props.directory || !message) return

  await runAction('commit', '提交完成', async () => {
    await workspaceApi.commitAll(props.directory!, message)
    commitMessage.value = ''
  })
}

async function handlePull(): Promise<void> {
  if (!props.directory) return
  await runAction('pull', '已完成 pull', () => workspaceApi.pull(props.directory!))
}

async function handlePush(): Promise<void> {
  if (!props.directory) return
  await runAction('push', '已完成 push', () => workspaceApi.push(props.directory!))
}

async function handleCheckout(): Promise<void> {
  if (!props.directory || !status.value || !selectedBranch.value || selectedBranch.value === status.value.branch) {
    return
  }

  await runAction('checkout', `已切换到 ${selectedBranch.value}`, async () => {
    await workspaceApi.checkout(props.directory!, selectedBranch.value)
  })
}

async function handleCreateBranch(): Promise<void> {
  if (!props.directory) return

  try {
    const { value } = await ElMessageBox.prompt(
      '请输入新分支名称。将基于当前版本创建，并在创建后自动切换到该分支。',
      '新增分支',
      {
        confirmButtonText: '创建并切换',
        cancelButtonText: '取消',
        inputPlaceholder: '例如 feature/chat-history',
        inputPattern: /^[A-Za-z0-9._/-]+$/,
        inputErrorMessage: '分支名称只能包含字母、数字、点、下划线、中划线和斜杠',
      }
    )

    const branchName = value.trim()
    if (!branchName) return

    await runAction('create-branch', `已创建并切换到 ${branchName}`, async () => {
      await workspaceApi.createBranch(props.directory!, branchName, true)
    })
  } catch {
    // prompt cancel
  }
}

async function handleDeleteBranch(): Promise<void> {
  if (!props.directory || !status.value || !selectedBranch.value || selectedBranch.value === status.value.branch) {
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定要删除本地分支 ${selectedBranch.value} 吗？此操作不会自动恢复。`,
      '删除分支确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        distinguishCancelAndClose: true,
      }
    )
  } catch {
    return
  }

  const branchToDelete = selectedBranch.value
  await runAction('delete-branch', `已删除分支 ${branchToDelete}`, async () => {
    await workspaceApi.deleteBranch(props.directory!, branchToDelete)
  })
}

async function handleCheckoutHistory(): Promise<void> {
  if (!props.directory || !selectedCommitDetail.value) return

  try {
    await ElMessageBox.confirm(
      `确定要切换到历史版本 ${selectedCommitDetail.value.sha.slice(0, 7)} 吗？这会进入 Detached HEAD 状态，可稍后在"分支"中切回任意分支。`,
      '切换历史版本确认',
      {
        type: 'warning',
        confirmButtonText: '切换',
        cancelButtonText: '取消',
        distinguishCancelAndClose: true,
      }
    )
  } catch {
    return
  }

  const targetSha = selectedCommitDetail.value.sha
  await runAction('checkout-history', `已切换到历史版本 ${targetSha.slice(0, 7)}`, async () => {
    await workspaceApi.checkoutCommit(props.directory!, targetSha)
  })
}

async function handleInitRepo(): Promise<void> {
  if (!props.directory) return

  await runAction('init', 'Git 仓库初始化完成', async () => {
    try {
      await workspaceApi.initRepo(props.directory!)
    } catch (err: unknown) {
      let errorMessage = '初始化Git仓库失败'

      // 从 axios 响应中提取后端返回的错误信息和状态码
      const axiosError = err as { response?: { status?: number; data?: { error?: string } }; message?: string }
      const httpStatus = axiosError.response?.status
      const backendMessage = axiosError.response?.data?.error ?? ''

      if (httpStatus === 403 || backendMessage.toLowerCase().includes('forbidden')) {
        errorMessage = '权限不足：无法在当前目录创建Git仓库，请检查目录权限'
      } else if (backendMessage.toLowerCase().includes('no such file') || backendMessage.toLowerCase().includes('directory')) {
        errorMessage = '目录不存在：请先创建目标目录'
      } else if (backendMessage) {
        errorMessage = backendMessage
      } else if (err instanceof Error) {
        errorMessage = err.message
      }

      throw new Error(errorMessage)
    }
  })
}

function formatCommitDate(raw: string): string {
  const value = new Date(raw)
  return Number.isNaN(value.getTime())
    ? raw
    : value.toLocaleString(getActiveDateLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatRelativeTime(raw: string): string {
  const value = new Date(raw)
  if (Number.isNaN(value.getTime())) return raw

  const diff = Date.now() - value.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return isEnglishLocale() ? 'just now' : '刚刚'
  if (diff < hour) {
    const minutes = Math.floor(diff / minute)
    return isEnglishLocale() ? `${minutes} min ago` : `${minutes} 分钟前`
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour)
    return isEnglishLocale() ? `${hours} hr ago` : `${hours} 小时前`
  }
  if (diff < 30 * day) {
    const days = Math.floor(diff / day)
    return isEnglishLocale() ? `${days} d ago` : `${days} 天前`
  }
  return value.toLocaleDateString(getActiveDateLocale(), { month: '2-digit', day: '2-digit' })
}
</script>

<style scoped>
/* ========== Panel Root ========== */
.git-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 13px;
  color: #111827;
  background: #ffffff;
}

/* ========== Empty States ========== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
}

.empty-state__icon {
  color: #d1d5db;
}

.empty-state__icon--brand { color: #6366f1; }
.empty-state__icon--error { color: #ef4444; }

.empty-state__spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid #e5e7eb;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-state__text {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.empty-state__hint {
  margin: 0;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.6;
}

.empty-state__hint code {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f3f4f6;
  font-size: 11px;
  color: #6366f1;
}

/* ========== Header ========== */
.git-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.git-header__branch {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.icon-branch {
  flex-shrink: 0;
  color: #9ca3af;
}

.branch-name {
  font-weight: 600;
  font-size: 13px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detached-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 10px;
  background: #fee2e2;
  color: #dc2626;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.git-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sync-indicator {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: #9ca3af;
  font-weight: 600;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.15s;
}

.icon-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.icon-btn--inline {
  width: 22px;
  height: 22px;
  margin-left: auto;
}

.spin-icon {
  transition: transform 0.2s;
}

.spin-icon--spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ========== Status Bar ========== */
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px 14px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  background: #ffffff;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: #f3f4f6;
  color: #6b7280;
  border: 1px solid #e5e7eb;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ca3af;
}

.status-chip--clean { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
.status-chip--clean .status-dot { background: #22c55e; }
.status-chip--dirty { background: #fffbeb; color: #d97706; border-color: #fde68a; }
.status-chip--dirty .status-dot { background: #f59e0b; }
.status-chip--staged { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.status-chip--modified { background: #fffbeb; color: #b45309; border-color: #fde68a; }
.status-chip--untracked { background: #eff6ff; color: #2563eb; border-color: #bfdbfe; }
.status-chip--conflict { background: #fef2f2; color: #dc2626; border-color: #fecaca; }

/* ========== Scrollable Body ========== */
.git-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  background: #ffffff;
}

/* ========== Sections ========== */
.git-section {
  border-bottom: 1px solid #f3f4f6;
}

.git-section:last-child {
  border-bottom: none;
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: #374151;
  transition: background 0.12s;
  user-select: none;
}

.section-toggle:hover {
  background: #f9fafb;
}

.chevron {
  flex-shrink: 0;
  color: #d1d5db;
  transition: transform 0.2s;
}

.chevron--open {
  transform: rotate(90deg);
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #6b7280;
}

.section-count {
  margin-left: auto;
  padding: 0 7px;
  border-radius: 10px;
  background: #f3f4f6;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  border: 1px solid #e5e7eb;
}

.section-body {
  padding: 0 14px 12px;
}

.section-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  border-radius: 6px;
  background: #f9fafb;
  color: #9ca3af;
  font-size: 12px;
  border: 1px solid #f3f4f6;
}

.section-empty--error {
  background: #fef2f2;
  color: #ef4444;
  border-color: #fecaca;
}

.section-empty__icon {
  color: #22c55e;
}

.mini-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #e5e7eb;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* ========== Commit Form ========== */
.commit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.commit-textarea :deep(.el-textarea__inner) {
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #111827;
  border-radius: 6px;
  font-size: 13px;
  box-shadow: none;
}

.commit-textarea :deep(.el-textarea__inner:focus) {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
}

.commit-textarea :deep(.el-textarea__inner::placeholder) {
  color: #d1d5db;
}

.commit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sync-buttons {
  display: flex;
  gap: 4px;
}

/* ========== File Tree ========== */
.file-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 10px;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: #374151;
  transition: background 0.12s;
}

.tree-item:hover {
  background: #f9fafb;
}

.tree-item--active {
  background: #eff6ff;
}

.file-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #d1d5db;
}

.file-indicator--staged { background: #22c55e; }
.file-indicator--modified { background: #f59e0b; }
.file-indicator--both { background: #f59e0b; box-shadow: 0 0 0 2px #ffffff, 0 0 0 3.5px #22c55e; }
.file-indicator--untracked { background: #60a5fa; }
.file-indicator--conflict { background: #ef4444; }

.tree-item__path {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #374151;
}

.tree-item__letter {
  flex-shrink: 0;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  min-width: 18px;
  text-align: right;
}

/* ========== Diff Area ========== */
.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.diff-header__title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #9ca3af;
}

.tab-switch {
  display: inline-flex;
  border-radius: 6px;
  background: #f3f4f6;
  padding: 2px;
  border: 1px solid #e5e7eb;
}

.tab-switch__btn {
  border: none;
  background: transparent;
  padding: 3px 10px;
  border-radius: 4px;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-switch__btn:hover {
  color: #374151;
}

.tab-switch__btn--active {
  background: #ffffff;
  color: #111827;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

/* ========== Branch Control ========== */
.branch-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-select {
  width: 100%;
}

.branch-option {
  display: flex;
  align-items: center;
  gap: 6px;
}

.branch-btn-group {
  display: flex;
  gap: 6px;
}

/* ========== Timeline (History) ========== */
.timeline {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.timeline-node {
  display: flex;
  gap: 10px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background 0.12s;
}

.timeline-node:hover {
  background: #f9fafb;
}

.timeline-node--active {
  background: #eff6ff;
}

.timeline-node__line {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 14px;
  flex-shrink: 0;
  padding-top: 6px;
}

.timeline-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #d1d5db;
  flex-shrink: 0;
  z-index: 1;
}

.timeline-node--active .timeline-dot {
  background: #3b82f6;
  border-color: #3b82f6;
}

.timeline-connector {
  width: 2px;
  flex: 1;
  background: #e5e7eb;
  margin: 2px 0;
}

.timeline-node__body {
  flex: 1;
  min-width: 0;
  padding: 4px 0 10px;
}

.timeline-node__msg {
  font-size: 12px;
  color: #374151;
  line-height: 1.4;
  word-break: break-word;
}

.timeline-node__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 3px;
  font-size: 11px;
  color: #d1d5db;
}

.timeline-node__meta code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  color: #9ca3af;
}

/* ========== Detail Card ========== */
.detail-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
}

.detail-card__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-card__title {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  line-height: 1.4;
}

.detail-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #d1d5db;
}

.detail-card__meta code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  color: #9ca3af;
}

.detail-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-card__warn {
  font-size: 11px;
  color: #d97706;
}

.detail-card__stats pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  white-space: pre-wrap;
  word-break: break-word;
  color: #6b7280;
  font-size: 11px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

/* ========== Info Grid ========== */
.info-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.info-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  background: #f9fafb;
}

.info-label {
  flex-shrink: 0;
  font-size: 11px;
  color: #9ca3af;
  min-width: 70px;
}

.info-value {
  font-size: 12px;
  color: #374151;
  word-break: break-word;
}

.info-value--mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 11px;
}

.last-commit-card {
  padding: 10px 12px;
  border-radius: 6px;
  background: #f9fafb;
  border-left: 3px solid #e5e7eb;
}

.last-commit-card__label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #d1d5db;
  margin-bottom: 4px;
}

.last-commit-card__msg {
  font-size: 13px;
  color: #111827;
  font-weight: 500;
  line-height: 1.4;
}

.last-commit-card__meta {
  margin-top: 4px;
  font-size: 11px;
  color: #9ca3af;
}

/* ========== Responsive ========== */
@media (max-width: 960px) {
  .branch-btn-group {
    flex-wrap: wrap;
  }
}
</style>
