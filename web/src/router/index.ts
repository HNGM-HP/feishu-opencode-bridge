import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', component: () => import('../views/Login.vue'), meta: { title: '登录' } },
  { path: '/change-password', component: () => import('../views/ChangePassword.vue'), meta: { title: '修改密码' } },
  { path: '/dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '系统状态' } },
  { path: '/platforms', component: () => import('../views/Platforms.vue'), meta: { title: '平台接入' } },
  { path: '/sessions', component: () => import('../views/Sessions.vue'), meta: { title: 'Session 管理' } },
  { path: '/opencode', component: () => import('../views/OpenCode.vue'), meta: { title: 'OpenCode 对接' } },
  { path: '/reliability', component: () => import('../views/Reliability.vue'), meta: { title: '高可用配置' } },
  { path: '/routing', component: () => import('../views/CoreRouting.vue'), meta: { title: '核心行为' } },
  { path: '/cron', component: () => import('../views/CronJobs.vue'), meta: { title: 'Cron 任务管理' } },
  { path: '/logs', component: () => import('../views/Logs.vue'), meta: { title: '日志管理' } },
  { path: '/settings', component: () => import('../views/Settings.vue'), meta: { title: '系统设置' } },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 检查密码状态（用于判断是否需要清除旧 token）
async function checkPasswordStatus(): Promise<{ hasPassword: boolean; needsPasswordChange: boolean }> {
  const token = localStorage.getItem('admin_token')
  try {
    const http = axios.create({
      baseURL: '/api',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const { data } = await http.get('/admin/password-status')
    return { hasPassword: data.hasPassword, needsPasswordChange: data.needsPasswordChange }
  } catch {
    return { hasPassword: true, needsPasswordChange: false }
  }
}

// 鉴权守卫
router.beforeEach(async (to, _from, next) => {
  const token = localStorage.getItem('admin_token')

  // 登录页
  if (to.path === '/login') {
    if (token) {
      // 有旧 token，检查密码是否已被重置
      const { hasPassword } = await checkPasswordStatus()
      if (!hasPassword) {
        // 密码已重置，清除旧 token，允许访问登录页
        localStorage.removeItem('admin_token')
        next()
      } else {
        // 密码正常，跳转到 dashboard
        next('/dashboard')
      }
    } else {
      next()
    }
    return
  }

  // 修改密码页
  if (to.path === '/change-password') {
    // 首次设置密码模式（mode=setup）允许无 token 访问
    if (to.query.mode === 'setup') {
      next()
      return
    }
    if (!token) {
      next('/login')
    } else {
      next()
    }
    return
  }

  // 其他页面需要登录
  if (!token) {
    next('/login')
    return
  }

  // 检查是否需要强制修改密码
  try {
    const { needsPasswordChange, hasPassword } = await checkPasswordStatus()
    // 密码已被重置，清除旧 token 并跳转到登录页
    if (!hasPassword) {
      localStorage.removeItem('admin_token')
      next('/login')
      return
    }
    if (needsPasswordChange) {
      next('/change-password')
      return
    }
  } catch {
    // 忽略错误，继续导航
  }

  next()
})