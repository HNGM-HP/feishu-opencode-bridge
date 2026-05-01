/**
 * 首次安装引导用到的平台元数据
 *
 * 仅做"挑一个先接入"的展示用途，不与 Platforms.vue 强耦合：
 * - id     用于路由跳转后的 query / hash（platforms?focus=feishu）
 * - icon   单字符 emoji，避免引入额外图标包
 * - label  中文标签（i18n 通过运行时覆盖层翻译为英文）
 * - desc   一句话功能描述
 */
export interface OnboardingPlatform {
  id: 'feishu' | 'discord' | 'wecom' | 'weixin' | 'dingtalk' | 'telegram' | 'qq' | 'whatsapp'
  icon: string
  label: string
  desc: string
}

export const ONBOARDING_PLATFORMS: readonly OnboardingPlatform[] = [
  { id: 'feishu',   icon: '🪶', label: '飞书',     desc: '企业 IM，支持机器人回调与流式回复' },
  { id: 'discord',  icon: '🎮', label: 'Discord',  desc: '社区聊天平台，原生 Bot Token 接入' },
  { id: 'wecom',    icon: '💼', label: '企业微信', desc: '企业群机器人 Webhook 双向消息' },
  { id: 'weixin',   icon: '💬', label: '个人微信', desc: '基于网关的扫码登录与消息桥接' },
  { id: 'dingtalk', icon: '📌', label: '钉钉',     desc: '企业 IM，机器人 / Stream 模式接入' },
  { id: 'telegram', icon: '✈️', label: 'Telegram', desc: '官方 Bot API，全球可用' },
  { id: 'qq',       icon: '🐧', label: 'QQ',       desc: '官方 API + OneBot 双协议' },
  { id: 'whatsapp', icon: '🟢', label: 'WhatsApp', desc: 'Personal / Business 双模式' },
] as const
