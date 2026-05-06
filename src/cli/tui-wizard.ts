/**
 * TUI 交互式向导
 *
 * 设计要点：
 * - 与 web 端共用同一份 ConfigStore（SQLite 的 settings 表 id=1）
 * - 语言偏好存于 admin_meta.cli_lang
 * - 离线场景：不依赖 admin server / opencode 是否在跑，纯本地 DB 操作
 * - 退出方式：用户选择"启动服务"返回 { startService: true }，否则 { startService: false }
 *   外层 CLI 入口据此决定是否调用 startBridge()
 */

import {
  select,
  input,
  confirm,
  password,
} from '@inquirer/prompts';
import { configStore, type BridgeSettings } from '../store/config-store.js';
import { VERSION } from '../utils/version.js';
import { getMessages, detectDefaultLang, type CliLang, type CliMessages } from './messages.js';

// ──────────────────────────────────────────────
// 平台元数据（与 web 端 onboarding-platforms.ts 保持一致）
// ──────────────────────────────────────────────

interface PlatformMeta {
  id: string;
  label: { zh: string; en: string };
  enabledKey: keyof BridgeSettings;
  /** 启用该平台必须填的凭据字段（多账号平台 weixin/dingtalk 留空，引导提示去 web 端配账号） */
  fields: Array<{
    key: keyof BridgeSettings;
    label: { zh: string; en: string };
    required: boolean;
    secret?: boolean;
    type?: 'text' | 'select';
    choices?: Array<{ value: string; label: { zh: string; en: string } }>;
  }>;
  /** 多账号平台（无法在 TUI 内一次性配置） */
  multiAccount?: boolean;
  multiAccountTip?: { zh: string; en: string };
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: 'feishu',
    label: { zh: '飞书', en: 'Feishu' },
    enabledKey: 'FEISHU_ENABLED',
    fields: [
      { key: 'FEISHU_APP_ID', label: { zh: 'App ID', en: 'App ID' }, required: true },
      { key: 'FEISHU_APP_SECRET', label: { zh: 'App Secret', en: 'App Secret' }, required: true, secret: true },
      { key: 'FEISHU_ENCRYPT_KEY', label: { zh: 'Encrypt Key', en: 'Encrypt Key' }, required: false, secret: true },
      { key: 'FEISHU_VERIFICATION_TOKEN', label: { zh: 'Verification Token', en: 'Verification Token' }, required: false, secret: true },
    ],
  },
  {
    id: 'discord',
    label: { zh: 'Discord', en: 'Discord' },
    enabledKey: 'DISCORD_ENABLED',
    fields: [
      { key: 'DISCORD_TOKEN', label: { zh: 'Bot Token', en: 'Bot Token' }, required: true, secret: true },
      { key: 'DISCORD_CLIENT_ID', label: { zh: 'Client ID', en: 'Client ID' }, required: true },
    ],
  },
  {
    id: 'wecom',
    label: { zh: '企业微信', en: 'WeCom' },
    enabledKey: 'WECOM_ENABLED',
    fields: [
      { key: 'WECOM_BOT_ID', label: { zh: 'Bot ID', en: 'Bot ID' }, required: true },
      { key: 'WECOM_SECRET', label: { zh: 'Secret', en: 'Secret' }, required: true, secret: true },
    ],
  },
  {
    id: 'telegram',
    label: { zh: 'Telegram', en: 'Telegram' },
    enabledKey: 'TELEGRAM_ENABLED',
    fields: [
      { key: 'TELEGRAM_BOT_TOKEN', label: { zh: 'Bot Token', en: 'Bot Token' }, required: true, secret: true },
    ],
  },
  {
    id: 'qq',
    label: { zh: 'QQ', en: 'QQ' },
    enabledKey: 'QQ_ENABLED',
    fields: [
      {
        key: 'QQ_PROTOCOL',
        label: { zh: '协议', en: 'Protocol' },
        required: true,
        type: 'select',
        choices: [
          { value: 'official', label: { zh: '官方 API', en: 'Official API' } },
          { value: 'onebot', label: { zh: 'OneBot 协议', en: 'OneBot' } },
        ],
      },
      { key: 'QQ_APP_ID', label: { zh: 'App ID（官方）', en: 'App ID (official)' }, required: false },
      { key: 'QQ_SECRET', label: { zh: 'Secret（官方）', en: 'Secret (official)' }, required: false, secret: true },
      { key: 'QQ_ONEBOT_HTTP_URL', label: { zh: 'OneBot HTTP URL', en: 'OneBot HTTP URL' }, required: false },
      { key: 'QQ_ONEBOT_WS_URL', label: { zh: 'OneBot WS URL', en: 'OneBot WS URL' }, required: false },
    ],
  },
  {
    id: 'whatsapp',
    label: { zh: 'WhatsApp', en: 'WhatsApp' },
    enabledKey: 'WHATSAPP_ENABLED',
    fields: [
      {
        key: 'WHATSAPP_MODE',
        label: { zh: '模式', en: 'Mode' },
        required: true,
        type: 'select',
        choices: [
          { value: 'personal', label: { zh: '个人版（扫码）', en: 'Personal (QR login)' } },
          { value: 'business', label: { zh: '商业版（API）', en: 'Business (API)' } },
        ],
      },
      { key: 'WHATSAPP_BUSINESS_PHONE_ID', label: { zh: 'Business Phone ID', en: 'Business Phone ID' }, required: false },
      { key: 'WHATSAPP_BUSINESS_ACCESS_TOKEN', label: { zh: 'Business Access Token', en: 'Business Access Token' }, required: false, secret: true },
    ],
  },
  {
    id: 'weixin',
    label: { zh: '个人微信', en: 'WeChat (personal)' },
    enabledKey: 'WEIXIN_ENABLED',
    fields: [],
    multiAccount: true,
    multiAccountTip: {
      zh: '个人微信为多账号平台，账号 / 网关 / 二维码登录请前往 Web 管理面板配置；TUI 仅控制总开关',
      en: 'WeChat personal is multi-account; use the web admin to add accounts and scan QR. TUI only toggles the master switch',
    },
  },
  {
    id: 'dingtalk',
    label: { zh: '钉钉', en: 'DingTalk' },
    enabledKey: 'DINGTALK_ENABLED',
    fields: [],
    multiAccount: true,
    multiAccountTip: {
      zh: '钉钉为多账号平台，client_id / client_secret 请前往 Web 管理面板配置；TUI 仅控制总开关',
      en: 'DingTalk is multi-account; use the web admin to add accounts. TUI only toggles the master switch',
    },
  },
];

// ──────────────────────────────────────────────
// 语言持久化（admin_meta.cli_lang）
// ──────────────────────────────────────────────

function readSavedLang(): CliLang | null {
  // configStore 暴露的语言读写接口；若尚未实现则回落到 BridgeSettings 字段
  const cur = configStore.get() as BridgeSettings & { CLI_LANG?: string };
  if (cur.CLI_LANG === 'zh' || cur.CLI_LANG === 'en') return cur.CLI_LANG;
  return null;
}

function saveLang(lang: CliLang): void {
  configStore.merge({ CLI_LANG: lang } as Partial<BridgeSettings>);
}

// ──────────────────────────────────────────────
// 平台启用状态判断
// ──────────────────────────────────────────────

function isTrueFlag(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}

export function hasAnyPlatformConfigured(): boolean {
  const s = configStore.get();
  return PLATFORMS.some(p => isTrueFlag(s[p.enabledKey] as string | undefined));
}

// ──────────────────────────────────────────────
// 通用工具：处理 inquirer 的 Ctrl+C / ESC 抛错
// ──────────────────────────────────────────────

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    if (err && (err.name === 'ExitPromptError' || err.code === 'ERR_USE_AFTER_CLOSE')) {
      return null;
    }
    throw err;
  }
}

function pause(msg: string): Promise<unknown> {
  return safe(() => input({ message: msg }));
}

// ──────────────────────────────────────────────
// 子流程
// ──────────────────────────────────────────────

async function pickLanguage(currentLang: CliLang): Promise<CliLang> {
  const m = getMessages(currentLang);
  const ans = await safe(() =>
    select<CliLang>({
      message: m.pickLanguageTitle,
      choices: [
        { value: 'zh', name: m.langZh },
        { value: 'en', name: m.langEn },
      ],
      default: currentLang,
    }),
  );
  if (!ans) return currentLang;
  saveLang(ans);
  return ans;
}

async function configurePlatformFields(meta: PlatformMeta, lang: CliLang, m: CliMessages): Promise<void> {
  if (meta.multiAccount) {
    const tip = meta.multiAccountTip ? meta.multiAccountTip[lang] : '';
    console.log(`\n${tip}\n`);
    await pause(m.pressEnter);
    return;
  }

  const cur = configStore.get();
  const patch: Partial<BridgeSettings> = {};
  for (const f of meta.fields) {
    const label = f.label[lang];
    const tag = f.required ? m.inputRequired : m.inputOptional;
    const message = `${label} ${tag}`;

    if (f.type === 'select' && f.choices) {
      const ans = await safe(() =>
        select<string>({
          message,
          choices: f.choices!.map(c => ({ value: c.value, name: c.label[lang] })),
          default: (cur[f.key] as string | undefined) || f.choices![0].value,
        }),
      );
      if (ans !== null) (patch as any)[f.key] = ans;
      continue;
    }

    if (f.secret) {
      const ans = await safe(() =>
        password({
          message,
          mask: '*',
          validate: v => (f.required && !v ? (lang === 'zh' ? '该字段必填' : 'Required') : true),
        }),
      );
      if (ans !== null && ans !== '') (patch as any)[f.key] = ans;
      continue;
    }

    const ans = await safe(() =>
      input({
        message,
        default: (cur[f.key] as string | undefined) || '',
        validate: v => (f.required && !v ? (lang === 'zh' ? '该字段必填' : 'Required') : true),
      }),
    );
    if (ans !== null && ans !== '') (patch as any)[f.key] = ans;
  }

  if (Object.keys(patch).length > 0) {
    configStore.merge(patch);
    console.log(m.saved);
  }
}

async function togglePlatformEnabled(meta: PlatformMeta, enabled: boolean, m: CliMessages): Promise<void> {
  configStore.merge({ [meta.enabledKey]: enabled ? 'true' : 'false' } as Partial<BridgeSettings>);
  console.log(m.saved);
}

async function platformsMenu(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  // 循环菜单
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cur = configStore.get();
    const choices = PLATFORMS.map(p => {
      const on = isTrueFlag(cur[p.enabledKey] as string | undefined);
      const status = on ? '✅' : '⚪';
      return { value: p.id, name: `${status} ${p.label[lang]}` };
    });
    choices.push({ value: '__back__', name: `← ${m.back}` });

    const pick = await safe(() =>
      select<string>({ message: m.platformsMenuTitle, choices, pageSize: 12 }),
    );
    if (!pick || pick === '__back__') return;
    const meta = PLATFORMS.find(p => p.id === pick)!;
    const on = isTrueFlag(configStore.get()[meta.enabledKey] as string | undefined);

    const action = await safe(() =>
      select<string>({
        message: meta.label[lang],
        choices: [
          { value: 'configure', name: m.platformConfigure(meta.label[lang]) },
          {
            value: 'toggle',
            name: on ? m.platformDisable(meta.label[lang]) : m.platformEnable(meta.label[lang]),
          },
          { value: '__back__', name: `← ${m.back}` },
        ],
      }),
    );
    if (!action || action === '__back__') continue;
    if (action === 'configure') {
      await configurePlatformFields(meta, lang, m);
      // 配置完成后，如果存在凭据但未启用，提示用户启用
      const fresh = configStore.get();
      if (!isTrueFlag(fresh[meta.enabledKey] as string | undefined) && !meta.multiAccount) {
        const enable = await safe(() =>
          confirm({
            message: lang === 'zh' ? `是否同时启用「${meta.label.zh}」？` : `Enable "${meta.label.en}" now?`,
            default: true,
          }),
        );
        if (enable) await togglePlatformEnabled(meta, true, m);
      }
    } else if (action === 'toggle') {
      await togglePlatformEnabled(meta, !on, m);
    }
  }
}

async function opencodeMenu(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  const cur = configStore.get();
  const patch: Partial<BridgeSettings> = {};

  const host = await safe(() => input({ message: m.opencodeHost, default: cur.OPENCODE_HOST || 'localhost' }));
  if (host !== null) patch.OPENCODE_HOST = host;

  const port = await safe(() => input({ message: m.opencodePort, default: cur.OPENCODE_PORT || '4096' }));
  if (port !== null) patch.OPENCODE_PORT = port;

  const auto = await safe(() =>
    confirm({ message: m.opencodeAutoStart, default: isTrueFlag(cur.OPENCODE_AUTO_START) }),
  );
  if (auto !== null) patch.OPENCODE_AUTO_START = auto ? 'true' : 'false';

  if (auto) {
    const fg = await safe(() =>
      confirm({ message: m.opencodeAutoStartFg, default: isTrueFlag(cur.OPENCODE_AUTO_START_FOREGROUND) }),
    );
    if (fg !== null) patch.OPENCODE_AUTO_START_FOREGROUND = fg ? 'true' : 'false';
  }

  if (Object.keys(patch).length > 0) {
    configStore.merge(patch);
    console.log(m.saved);
  }
}

async function routerMenu(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  const cur = configStore.get();
  const patch: Partial<BridgeSettings> = {};

  const requireAt = await safe(() =>
    confirm({ message: m.groupRequireMention, default: isTrueFlag(cur.GROUP_REQUIRE_MENTION ?? 'true') }),
  );
  if (requireAt !== null) patch.GROUP_REQUIRE_MENTION = requireAt ? 'true' : 'false';

  const replyAt = await safe(() =>
    confirm({ message: m.groupReplyRequireMention, default: isTrueFlag(cur.GROUP_REPLY_REQUIRE_MENTION ?? 'false') }),
  );
  if (replyAt !== null) patch.GROUP_REPLY_REQUIRE_MENTION = replyAt ? 'true' : 'false';

  const allow = await safe(() =>
    input({ message: m.allowedUsers, default: cur.ALLOWED_USERS || '' }),
  );
  if (allow !== null) patch.ALLOWED_USERS = allow;

  if (Object.keys(patch).length > 0) {
    configStore.merge(patch);
    console.log(m.saved);
  }
}

async function reliabilityMenu(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  const cur = configStore.get();
  const patch: Partial<BridgeSettings> = {};

  const cron = await safe(() =>
    confirm({ message: m.reliabilityCronEnabled, default: isTrueFlag(cur.RELIABILITY_CRON_ENABLED ?? 'true') }),
  );
  if (cron !== null) patch.RELIABILITY_CRON_ENABLED = cron ? 'true' : 'false';

  const hb = await safe(() =>
    confirm({
      message: m.reliabilityHeartbeatEnabled,
      default: isTrueFlag(cur.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED ?? 'false'),
    }),
  );
  if (hb !== null) patch.RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED = hb ? 'true' : 'false';

  if (Object.keys(patch).length > 0) {
    configStore.merge(patch);
    console.log(m.saved);
  }
}

async function outputMenu(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  const cur = configStore.get();
  const patch: Partial<BridgeSettings> = {};

  const think = await safe(() =>
    confirm({ message: m.showThinking, default: isTrueFlag(cur.SHOW_THINKING_CHAIN ?? 'true') }),
  );
  if (think !== null) patch.SHOW_THINKING_CHAIN = think ? 'true' : 'false';

  const tool = await safe(() =>
    confirm({ message: m.showTool, default: isTrueFlag(cur.SHOW_TOOL_CHAIN ?? 'true') }),
  );
  if (tool !== null) patch.SHOW_TOOL_CHAIN = tool ? 'true' : 'false';

  if (Object.keys(patch).length > 0) {
    configStore.merge(patch);
    console.log(m.saved);
  }
}

/** Web 管理面板控制：在 TUI 内可启停 admin server，且不影响平台适配器 */
async function webAdminMenu(lang: CliLang, ctx: WizardContext): Promise<void> {
  const m = getMessages(lang);
  const cur = configStore.get();
  // 是否启用以及端口
  const enable = await safe(() =>
    confirm({ message: m.webEnabled, default: !isTrueFlag(cur.WEB_ADMIN_DISABLED ?? 'false') }),
  );
  if (enable === null) return;

  const port = await safe(() =>
    input({ message: m.webPort, default: cur.ADMIN_PORT || '4098' }),
  );
  if (port === null) return;

  configStore.merge({
    WEB_ADMIN_DISABLED: enable ? 'false' : 'true',
    ADMIN_PORT: port,
  } as Partial<BridgeSettings>);
  console.log(m.saved);

  if (enable) {
    if (ctx.adminServer) {
      console.log(m.errAdminBusy);
      return;
    }
    try {
      const portNum = parseInt(port, 10) || 4098;
      const { createAdminServer } = await import('../admin/admin-server.js');
      const srv = createAdminServer({ port: portNum, startedAt: ctx.startedAt, version: VERSION });
      srv.start();
      ctx.adminServer = srv;
      console.log(m.webStarted(`http://localhost:${portNum}`));
    } catch (err) {
      console.error(m.saveFailed, err);
    }
  } else if (ctx.adminServer) {
    ctx.adminServer.stop();
    ctx.adminServer = null;
    console.log(m.webStopped);
  }
}

async function helpMenu(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  const links: Array<{ label: string; url: string }> = [
    { label: m.helpReadme, url: 'https://github.com/HNGM-HP/opencode-bridge#readme' },
    { label: m.helpEnglish, url: 'https://github.com/HNGM-HP/opencode-bridge/blob/main/README-en.md' },
    { label: m.helpIssues, url: 'https://github.com/HNGM-HP/opencode-bridge/issues' },
    { label: m.helpReleases, url: 'https://github.com/HNGM-HP/opencode-bridge/releases' },
    { label: m.helpDocs, url: 'https://github.com/HNGM-HP/opencode-bridge' },
  ];
  console.log('\n' + m.helpTitle);
  console.log('─'.repeat(48));
  for (const l of links) {
    console.log(`  • ${l.label}`);
    console.log(`    ${l.url}`);
  }
  console.log('─'.repeat(48) + '\n');
  await pause(m.pressEnter);
}

// ──────────────────────────────────────────────
// 入口点：runWizard
// ──────────────────────────────────────────────

interface WizardContext {
  adminServer: { start: () => void; stop: () => void } | null;
  startedAt: Date;
}

export interface WizardResult {
  /** 是否启动桥接服务 */
  startService: boolean;
  /** 是否在 TUI 中已启动 web 管理面板（启动后由调用方决定保留/复用） */
  webStartedInWizard: boolean;
}

/** 首次接入平台选择（TUI step "选择一个平台作为接入项"） */
async function pickInitialPlatform(lang: CliLang): Promise<void> {
  const m = getMessages(lang);
  const choices = PLATFORMS.map(p => ({ value: p.id, name: p.label[lang] }));
  choices.push({ value: '__skip__', name: m.initialPlatformSkip });
  const pick = await safe(() =>
    select<string>({ message: m.initialPlatformTitle, choices, pageSize: 10 }),
  );
  if (!pick || pick === '__skip__') return;
  const meta = PLATFORMS.find(p => p.id === pick)!;
  await configurePlatformFields(meta, lang, m);
  // 自动启用（多账号平台仍需 web 端添加账号才会真正生效，但开关先打上）
  await togglePlatformEnabled(meta, true, m);
}

async function mainMenuLoop(lang: CliLang, ctx: WizardContext): Promise<WizardResult> {
  let currentLang = lang;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const m = getMessages(currentLang);
    const choice = await safe(() =>
      select<string>({
        message: m.mainMenuTitle,
        pageSize: 14,
        choices: [
          { value: 'lang', name: m.mainMenuLanguage },
          { value: 'initialPlatform', name: m.mainMenuInitialPlatform },
          { value: 'platforms', name: m.mainMenuPlatforms },
          { value: 'opencode', name: m.mainMenuOpencode },
          { value: 'router', name: m.mainMenuRouter },
          { value: 'reliability', name: m.mainMenuReliability },
          { value: 'output', name: m.mainMenuOutput },
          { value: 'web', name: m.mainMenuWeb },
          { value: 'help', name: m.mainMenuHelp },
          { value: 'start', name: m.mainMenuStartService },
          { value: 'exit', name: m.mainMenuExit },
        ],
      }),
    );
    if (!choice || choice === 'exit') {
      return { startService: false, webStartedInWizard: !!ctx.adminServer };
    }
    if (choice === 'start') {
      return { startService: true, webStartedInWizard: !!ctx.adminServer };
    }
    if (choice === 'lang') currentLang = await pickLanguage(currentLang);
    else if (choice === 'initialPlatform') await pickInitialPlatform(currentLang);
    else if (choice === 'platforms') await platformsMenu(currentLang);
    else if (choice === 'opencode') await opencodeMenu(currentLang);
    else if (choice === 'router') await routerMenu(currentLang);
    else if (choice === 'reliability') await reliabilityMenu(currentLang);
    else if (choice === 'output') await outputMenu(currentLang);
    else if (choice === 'web') await webAdminMenu(currentLang, ctx);
    else if (choice === 'help') await helpMenu(currentLang);
  }
}

export interface RunWizardOptions {
  /** init 模式：跳过 first-run 探测、固定进入完整向导 */
  force?: boolean;
}

export async function runWizard(opts: RunWizardOptions = {}): Promise<WizardResult> {
  const ctx: WizardContext = { adminServer: null, startedAt: new Date() };

  // 1. 语言初始化（已保存则直接用，否则首次询问）
  const saved = readSavedLang();
  let lang: CliLang;
  if (saved) {
    lang = saved;
  } else {
    lang = detectDefaultLang();
    lang = await pickLanguage(lang);
  }
  let m = getMessages(lang);

  // 2. Banner
  console.log('\n' + m.banner(VERSION));
  console.log(opts.force ? m.bannerForcedInit : m.bannerFirstRun);
  console.log('');

  // 3. 入口选择
  const entry = await safe(() =>
    select<string>({
      message: m.entryTitle,
      pageSize: 8,
      choices: [
        { value: 'tui', name: m.entryConfigViaTui },
        { value: 'web', name: m.entryConfigViaWeb },
        { value: 'start', name: m.entryStartService },
        { value: 'help', name: m.entryHelp },
        { value: 'exit', name: m.entryExit },
      ],
    }),
  );

  if (!entry || entry === 'exit') {
    console.log(m.bye);
    return { startService: false, webStartedInWizard: false };
  }

  if (entry === 'help') {
    await helpMenu(lang);
    // 帮助看完后回到入口
    return runWizard(opts);
  }

  if (entry === 'start') {
    return { startService: true, webStartedInWizard: false };
  }

  if (entry === 'web') {
    // 启动 admin server，让用户去浏览器配置；进程将由 startBridge() 接管或单独保留
    const cur = configStore.get();
    const portNum = parseInt(cur.ADMIN_PORT || '4098', 10) || 4098;
    const { createAdminServer } = await import('../admin/admin-server.js');
    const srv = createAdminServer({ port: portNum, startedAt: ctx.startedAt, version: VERSION });
    srv.start();
    ctx.adminServer = srv;
    console.log('\n' + m.webStarted(`http://localhost:${portNum}`) + '\n');
    // Web 模式下也启动桥接服务（进程合并），以便平台适配器能立即工作
    return { startService: true, webStartedInWizard: true };
  }

  // entry === 'tui'：先做"首次接入平台"挑选，再进入主菜单
  if (!opts.force && !hasAnyPlatformConfigured()) {
    await pickInitialPlatform(lang);
  }

  m = getMessages(lang);
  return mainMenuLoop(lang, ctx);
}
