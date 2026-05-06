/**
 * TUI 向导多语言文案
 *
 * 仅覆盖 CLI 交互所需文本，与 web 端 i18n 互不依赖：
 * - web 端语言偏好存于 localStorage（浏览器内）
 * - CLI 端语言偏好存于 admin_meta.cli_lang，由 configStore 持久化
 */

export type CliLang = 'zh' | 'en';

export interface CliMessages {
  // 通用
  yes: string;
  no: string;
  back: string;
  cancel: string;
  saved: string;
  saveFailed: string;
  pressEnter: string;

  // banner
  banner: (version: string) => string;
  bannerForcedInit: string;
  bannerFirstRun: string;

  // 语言选择
  pickLanguageTitle: string;
  langZh: string;
  langEn: string;

  // 入口选择
  entryTitle: string;
  entryConfigViaTui: string;
  entryConfigViaWeb: string;
  entryStartService: string;
  entryHelp: string;
  entryExit: string;

  // 平台选择（首次接入）
  initialPlatformTitle: string;
  initialPlatformSkip: string;

  // 主菜单（轮询菜单）
  mainMenuTitle: string;
  mainMenuLanguage: string;
  mainMenuInitialPlatform: string;
  mainMenuPlatforms: string;
  mainMenuOpencode: string;
  mainMenuRouter: string;
  mainMenuReliability: string;
  mainMenuOutput: string;
  mainMenuWeb: string;
  mainMenuHelp: string;
  mainMenuStartService: string;
  mainMenuExit: string;

  // 平台子菜单
  platformsMenuTitle: string;
  platformEnable: (label: string) => string;
  platformDisable: (label: string) => string;
  platformConfigure: (label: string) => string;

  // 字段输入提示
  inputRequired: string;
  inputOptional: string;

  // OpenCode
  opencodeHost: string;
  opencodePort: string;
  opencodeAutoStart: string;
  opencodeAutoStartFg: string;

  // 群聊行为
  groupRequireMention: string;
  groupReplyRequireMention: string;
  allowedUsers: string;

  // 输出
  showThinking: string;
  showTool: string;

  // 可靠性
  reliabilityCronEnabled: string;
  reliabilityHeartbeatEnabled: string;

  // Web 服务器
  webEnabled: string;
  webPort: string;
  webStarted: (url: string) => string;
  webStopped: string;

  // 启动/退出
  startingService: string;
  serviceStarted: string;
  bye: string;

  // 帮助
  helpTitle: string;
  helpReadme: string;
  helpEnglish: string;
  helpIssues: string;
  helpReleases: string;
  helpDocs: string;

  // 错误
  errAdminBusy: string;
}

const zh: CliMessages = {
  yes: '是',
  no: '否',
  back: '返回',
  cancel: '取消',
  saved: '✅ 已保存到本地配置',
  saveFailed: '❌ 保存失败',
  pressEnter: '按回车继续...',

  banner: v =>
    [
      '╔════════════════════════════════════════════════╗',
      `║   OpenCode Bridge 终端配置向导 v${v.padEnd(10)}    ║`,
      '╚════════════════════════════════════════════════╝',
    ].join('\n'),
  bannerForcedInit: '当前为 init 模式，将进入完整配置流程',
  bannerFirstRun: '检测到尚未配置任何接入平台，进入首次安装向导',

  pickLanguageTitle: '请选择语言 / Please choose language',
  langZh: '中文',
  langEn: 'English',

  entryTitle: '请选择配置方式',
  entryConfigViaTui: '在终端中通过 TUI 完成配置（推荐用于无桌面环境）',
  entryConfigViaWeb: '启动 Web 管理面板，在浏览器中配置',
  entryStartService: '跳过配置，直接启动服务',
  entryHelp: '查看帮助 / 使用文档',
  entryExit: '退出（不启动服务）',

  initialPlatformTitle: '请选择一个先接入的平台（可稍后再加）',
  initialPlatformSkip: '跳过 / 暂不配置',

  mainMenuTitle: '主菜单 — 选择要修改的项',
  mainMenuLanguage: '🌐 切换语言',
  mainMenuInitialPlatform: '📌 选择/切换主接入平台',
  mainMenuPlatforms: '🔌 平台配置（增删与凭据）',
  mainMenuOpencode: '🧠 OpenCode 连接',
  mainMenuRouter: '👥 群聊行为 / 白名单',
  mainMenuReliability: '🩺 可靠性 / Cron / 心跳',
  mainMenuOutput: '📤 输出显示（思维链 / 工具链）',
  mainMenuWeb: '🌐 Web 管理面板',
  mainMenuHelp: '❓ 帮助 / 使用文档',
  mainMenuStartService: '🚀 保存并启动桥接服务',
  mainMenuExit: '🚪 退出（保存配置但不启动服务）',

  platformsMenuTitle: '平台配置 — 启用 / 关闭 / 修改凭据',
  platformEnable: l => `启用「${l}」`,
  platformDisable: l => `关闭「${l}」`,
  platformConfigure: l => `配置「${l}」凭据`,

  inputRequired: '（必填）',
  inputOptional: '（可选）',

  opencodeHost: 'OpenCode 服务地址 (host)',
  opencodePort: 'OpenCode 服务端口 (port)',
  opencodeAutoStart: '是否自动启动 opencode serve？',
  opencodeAutoStartFg: '前台模式（Windows 弹出 attach 控制台）？',

  groupRequireMention: '群聊是否要求 @ 机器人才会响应？',
  groupReplyRequireMention: '群聊回复是否也要求 @？',
  allowedUsers: '白名单用户（逗号分隔，留空表示不限制）',

  showThinking: '是否显示思维链 (thinking chain)？',
  showTool: '是否显示工具调用链 (tool chain)？',

  reliabilityCronEnabled: '启用 Cron 调度？',
  reliabilityHeartbeatEnabled: '启用主动心跳？',

  webEnabled: '启用 Web 管理面板？',
  webPort: 'Web 管理面板端口',
  webStarted: u => `Web 管理面板已启动：${u}`,
  webStopped: 'Web 管理面板已关闭（接入平台仍在运行）',

  startingService: '正在启动桥接服务...',
  serviceStarted: '✅ 服务已启动，按 Ctrl+C 停止',
  bye: '再见 👋',

  helpTitle: '帮助 / 使用文档',
  helpReadme: '中文 README',
  helpEnglish: 'English README',
  helpIssues: 'GitHub Issues（提问与反馈）',
  helpReleases: 'GitHub Releases（下载安装包）',
  helpDocs: '项目主页',

  errAdminBusy: '⚠️ Web 管理面板已在运行中，请先关闭再启动',
};

const en: CliMessages = {
  yes: 'Yes',
  no: 'No',
  back: 'Back',
  cancel: 'Cancel',
  saved: '✅ Saved to local config',
  saveFailed: '❌ Save failed',
  pressEnter: 'Press Enter to continue...',

  banner: v =>
    [
      '╔════════════════════════════════════════════════╗',
      `║  OpenCode Bridge TUI setup wizard v${v.padEnd(10)} ║`,
      '╚════════════════════════════════════════════════╝',
    ].join('\n'),
  bannerForcedInit: 'Running in init mode — full configuration flow',
  bannerFirstRun: 'No platform configured yet — entering first-run wizard',

  pickLanguageTitle: 'Please choose language / 请选择语言',
  langZh: '中文',
  langEn: 'English',

  entryTitle: 'How would you like to configure?',
  entryConfigViaTui: 'Configure here in the terminal (recommended for headless)',
  entryConfigViaWeb: 'Launch the web admin UI and configure in a browser',
  entryStartService: 'Skip — start the bridge service now',
  entryHelp: 'Show help / documentation',
  entryExit: 'Exit (do not start the service)',

  initialPlatformTitle: 'Pick a platform to connect first (you can add more later)',
  initialPlatformSkip: 'Skip / configure later',

  mainMenuTitle: 'Main menu — pick a section to edit',
  mainMenuLanguage: '🌐 Switch language',
  mainMenuInitialPlatform: '📌 Pick / switch the primary platform',
  mainMenuPlatforms: '🔌 Platforms (enable / disable / credentials)',
  mainMenuOpencode: '🧠 OpenCode connection',
  mainMenuRouter: '👥 Group behaviour / allow-list',
  mainMenuReliability: '🩺 Reliability / cron / heartbeat',
  mainMenuOutput: '📤 Output display (thinking / tool chain)',
  mainMenuWeb: '🌐 Web admin UI',
  mainMenuHelp: '❓ Help / documentation',
  mainMenuStartService: '🚀 Save & start the bridge service',
  mainMenuExit: '🚪 Exit (save config but do not start service)',

  platformsMenuTitle: 'Platforms — enable / disable / set credentials',
  platformEnable: l => `Enable "${l}"`,
  platformDisable: l => `Disable "${l}"`,
  platformConfigure: l => `Configure "${l}" credentials`,

  inputRequired: '(required)',
  inputOptional: '(optional)',

  opencodeHost: 'OpenCode host',
  opencodePort: 'OpenCode port',
  opencodeAutoStart: 'Auto-start opencode serve?',
  opencodeAutoStartFg: 'Foreground mode (pop attach console on Windows)?',

  groupRequireMention: 'Require @bot mention in groups before reply?',
  groupReplyRequireMention: 'Require @bot mention for replies in groups?',
  allowedUsers: 'Allow-listed users (comma-separated, leave empty for no limit)',

  showThinking: 'Show thinking chain?',
  showTool: 'Show tool-call chain?',

  reliabilityCronEnabled: 'Enable cron scheduler?',
  reliabilityHeartbeatEnabled: 'Enable proactive heartbeat?',

  webEnabled: 'Enable web admin UI?',
  webPort: 'Web admin port',
  webStarted: u => `Web admin UI started at ${u}`,
  webStopped: 'Web admin UI stopped (platform adapters keep running)',

  startingService: 'Starting bridge service...',
  serviceStarted: '✅ Service running, press Ctrl+C to stop',
  bye: 'Bye 👋',

  helpTitle: 'Help / documentation',
  helpReadme: 'Chinese README',
  helpEnglish: 'English README',
  helpIssues: 'GitHub Issues (questions & feedback)',
  helpReleases: 'GitHub Releases (download installers)',
  helpDocs: 'Project homepage',

  errAdminBusy: '⚠️ Web admin UI is already running — stop it first',
};

const PACKS: Record<CliLang, CliMessages> = { zh, en };

export function getMessages(lang: CliLang): CliMessages {
  return PACKS[lang] ?? zh;
}

/** 启发式：从环境变量推断默认语言（zh-CN/zh / 其它） */
export function detectDefaultLang(): CliLang {
  const env = (process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
  return env.startsWith('zh') ? 'zh' : 'en';
}
