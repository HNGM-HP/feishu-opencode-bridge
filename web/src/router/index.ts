import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '系统状态' } },
  { path: '/chat', component: () => import('../views/chat/ChatWorkspace.vue'), meta: { title: 'AI 工作区' } },
  { path: '/chat/:sessionId', component: () => import('../views/chat/ChatWorkspace.vue'), meta: { title: 'AI 工作区' } },
  { path: '/platforms', component: () => import('../views/Platforms.vue'), meta: { title: '平台接入' } },
  { path: '/sessions', component: () => import('../views/Sessions.vue'), meta: { title: 'Session 管理' } },
  { path: '/opencode', component: () => import('../views/OpenCode.vue'), meta: { title: 'OpenCode 对接' } },
  { path: '/reliability', component: () => import('../views/Reliability.vue'), meta: { title: '高可用配置' } },
  { path: '/routing', component: () => import('../views/CoreRouting.vue'), meta: { title: '核心行为' } },
  { path: '/cron', component: () => import('../views/CronJobs.vue'), meta: { title: 'Cron 任务管理' } },
  { path: '/logs', component: () => import('../views/Logs.vue'), meta: { title: '日志管理' } },
  { path: '/settings', component: () => import('../views/Settings.vue'), meta: { title: '系统设置' } },
  // 兼容旧书签：登录 / 修改密码相关路由已移除，统一重定向至 dashboard
  { path: '/login', redirect: '/dashboard' },
  { path: '/change-password', redirect: '/dashboard' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
