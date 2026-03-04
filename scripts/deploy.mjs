#!/usr/bin/env node

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, '..');
const logsDir = path.join(rootDir, 'logs');
const pidFile = path.join(logsDir, 'bridge.pid');
const outLog = path.join(logsDir, 'service.log');
const errLog = path.join(logsDir, 'service.err');
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');
const bridgeAgentTemplateDir = path.join(rootDir, 'assets', 'opencode-agents');
const bridgeAgentManifestName = '.bridge-agents.manifest.json';
const bridgeAgentFilePrefix = 'bridge-';

const serviceName = 'feishu-opencode-bridge';
const serviceFilePath = `/etc/systemd/system/${serviceName}.service`;
const minimumNodeMajor = 18;
const opencodeConfigFileName = 'opencode.json';
const defaultOpencodeHost = 'localhost';
const defaultOpencodePort = 4096;
const fixedOpencodeServerConfig = {
  port: 4096,
  hostname: '0.0.0.0',
  cors: ['*'],
};
let cachedDotEnv = null;
let runtimeReady = false;
let activeReadline = null;

function isWindows() {
  return process.platform === 'win32';
}

function isLinux() {
  return process.platform === 'linux';
}

function isInteractiveShell() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveBundledNpmCliPath() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = isWindows()
    ? [
      path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]
    : [
      path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function getCommandVariants(command, args) {
  const variants = [];

  if (command === 'npm') {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
      variants.push({
        command: process.execPath,
        args: [npmExecPath, ...args],
      });
    }

    const bundledNpmCliPath = resolveBundledNpmCliPath();
    if (bundledNpmCliPath) {
      variants.push({
        command: process.execPath,
        args: [bundledNpmCliPath, ...args],
      });
    }

    variants.push({ command: 'npm', args });

    if (isWindows()) {
      variants.push({ command: 'npm.cmd', args });
      variants.push({ command: 'npm.exe', args });
    }
  } else if (command === 'opencode') {
    variants.push({ command: 'opencode', args });

    if (isWindows()) {
      variants.push({ command: 'opencode.cmd', args });
      variants.push({ command: 'opencode.exe', args });
    }
  } else {
    variants.push({ command, args });
  }

  const seen = new Set();
  const uniqueVariants = [];

  for (const variant of variants) {
    const key = `${variant.command}::${variant.args.join('\u0000')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueVariants.push(variant);
  }

  return uniqueVariants;
}

function run(command, args, title, options = {}) {
  if (title) {
    console.log(`\n[deploy] ${title}`);
  }

  const variants = getCommandVariants(command, args);
  let lastErrorMessage = `${command} ${args.join(' ')} 执行失败`;

  for (const variant of variants) {
    const result = spawnSync(variant.command, variant.args, {
      cwd: rootDir,
      stdio: options.capture ? 'pipe' : 'inherit',
      encoding: options.capture ? 'utf-8' : undefined,
    });

    if (result.error) {
      lastErrorMessage = result.error.message;
      continue;
    }

    if (typeof result.status === 'number' && result.status !== 0 && !options.allowFailure) {
      lastErrorMessage = `${variant.command} ${variant.args.join(' ')} 退出码 ${result.status}`;
      continue;
    }

    return result;
  }

  throw new Error(lastErrorMessage);
}

function ensureNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
  if (major < minimumNodeMajor) {
    throw new Error(`需要 Node.js >= ${minimumNodeMajor}，当前版本: ${process.versions.node}`);
  }
}

function isRuntimePrecheckedByWrapper() {
  return process.env.BRIDGE_RUNTIME_PRECHECKED === '1';
}

function printNodeReady() {
  console.log(`[deploy] Node.js 已就绪: v${process.versions.node}`);
}

function getNpmVersion() {
  try {
    const result = run('npm', ['--version'], '', { capture: true });
    const version = (result.stdout || '').trim();
    return version || null;
  } catch {
    return null;
  }
}

function printNpmInstallGuide() {
  console.log('\n[deploy] npm 安装指引（请按需执行）');

  if (isWindows()) {
    console.log('[deploy] Windows 推荐使用以下任一方式安装 Node.js（包含 npm）：');
    console.log('  - winget install OpenJS.NodeJS.LTS');
    console.log('  - choco install nodejs-lts');
    console.log('  - 官方安装包: https://nodejs.org/');
  } else if (process.platform === 'darwin') {
    console.log('[deploy] macOS 推荐方式：');
    console.log('  - brew install node');
    console.log('  - 官方安装包: https://nodejs.org/');
  } else {
    console.log('[deploy] Linux 推荐方式（按你的发行版选择其一）：');
    const hasApt = commandExists('apt-get');
    const hasDnf = commandExists('dnf');
    const hasYum = commandExists('yum');
    const hasPacman = commandExists('pacman');

    if (hasApt) {
      console.log('  - sudo apt-get update && sudo apt-get install -y nodejs npm');
    }
    if (hasDnf) {
      console.log('  - sudo dnf install -y nodejs npm');
    }
    if (hasYum) {
      console.log('  - sudo yum install -y nodejs npm');
    }
    if (hasPacman) {
      console.log('  - sudo pacman -S --needed nodejs npm');
    }
    if (!hasApt && !hasDnf && !hasYum && !hasPacman) {
      console.log('  - 请前往 https://nodejs.org/ 下载官方安装包');
    }
  }

  console.log('[deploy] 若已安装 npm 但仍未检测到，请重开终端后执行 `npm -v` 验证 PATH。');
}

async function askYesNo(question, defaultYes = true) {
  const shouldCreateReadline = activeReadline === null;
  const rl = activeReadline || readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (!answer) {
      return defaultYes;
    }
    return ['y', 'yes', '1', 'true', '是'].includes(answer);
  } finally {
    if (shouldCreateReadline) {
      rl.close();
    }
  }
}

async function askText(question) {
  const shouldCreateReadline = activeReadline === null;
  const rl = activeReadline || readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    if (shouldCreateReadline) {
      rl.close();
    }
  }
}

async function ensureNpm(options = {}) {
  const { silentReadyLog = false } = options;
  const npmVersion = getNpmVersion();
  if (npmVersion) {
    if (!silentReadyLog) {
      console.log(`[deploy] npm 已就绪: ${npmVersion}`);
    }
    return;
  }

  console.warn('[deploy] 未检测到 npm，可能是 npm 未安装或 PATH 未生效');

  if (!isInteractiveShell()) {
    throw new Error('未检测到 npm，请先安装 Node.js（包含 npm）并确保 PATH 生效');
  }

  const shouldGuideInstall = await askYesNo('[deploy] 是否现在查看 npm 安装引导？[Y/n]: ', true);
  if (shouldGuideInstall) {
    printNpmInstallGuide();
  }

  const shouldRetry = await askYesNo('[deploy] 完成安装或修复 PATH 后，是否立即重试 npm 检测？[Y/n]: ', true);
  if (shouldRetry) {
    const retryVersion = getNpmVersion();
    if (retryVersion) {
      console.log(`[deploy] npm 已就绪: ${retryVersion}`);
      return;
    }
  }

  throw new Error('未检测到 npm，请安装完成后重新执行部署脚本');
}

async function ensureRuntimeReady() {
  if (runtimeReady) {
    return;
  }

  ensureNodeVersion();
  const prechecked = isRuntimePrecheckedByWrapper();
  if (!prechecked) {
    printNodeReady();
  }
  await ensureNpm({ silentReadyLog: prechecked });
  runtimeReady = true;
}

function isSkipInput(input) {
  const normalized = input.trim().toLowerCase();
  return ['skip', '回撤', '回撤跳过', '跳过', 'cancel', 'back'].includes(normalized);
}

function isPlaceholderCredentialValue(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.includes('xxxx')) {
    return true;
  }
  if (normalized.includes('your_')) {
    return true;
  }
  return false;
}

function formatEnvValue(value) {
  if (/^[A-Za-z0-9._:-]+$/.test(value)) {
    return value;
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function upsertEnvEntry(content, key, value) {
  const lines = content.split(/\r?\n/);
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  let replaced = false;

  const nextLines = lines.map(line => {
    if (pattern.test(line) && !replaced) {
      replaced = true;
      return `${key}=${formatEnvValue(value)}`;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== '') {
      nextLines.push('');
    }
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  return `${nextLines.join('\n').replace(/\n*$/, '')}\n`;
}

function needsFeishuCredentialSetup() {
  const envValues = parseDotEnvFile();
  const appId = (envValues.FEISHU_APP_ID || '').trim();
  const appSecret = (envValues.FEISHU_APP_SECRET || '').trim();
  return isPlaceholderCredentialValue(appId) || isPlaceholderCredentialValue(appSecret);
}

function updateEnvEntries(entries) {
  if (!fs.existsSync(envPath)) {
    return false;
  }

  let content = fs.readFileSync(envPath, 'utf-8');
  for (const [key, value] of Object.entries(entries)) {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      continue;
    }
    content = upsertEnvEntry(content, key, normalizedValue);
  }

  fs.writeFileSync(envPath, content, 'utf-8');
  cachedDotEnv = null;
  return true;
}

async function promptFeishuCredentialsSetup() {
  if (!isInteractiveShell()) {
    return;
  }
  if (!fs.existsSync(envPath)) {
    return;
  }
  if (!needsFeishuCredentialSetup()) {
    console.log('[deploy] 检测到 .env 已配置飞书凭据，可直接使用');
    return;
  }

  console.log('\n[deploy] 可选：现在写入飞书凭据（后续仍可手动编辑 .env）');
  const shouldSetup = await askYesNo('[deploy] 是否现在填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET？[Y/n]: ', true);
  if (!shouldSetup) {
    console.log('[deploy] 已跳过飞书凭据写入，可后续手动编辑 .env');
    return;
  }

  const appIdInput = await askText('[deploy] 输入 FEISHU_APP_ID（输入“回撤”或“skip”跳过）: ');
  const appSecretInput = await askText('[deploy] 输入 FEISHU_APP_SECRET（输入“回撤”或“skip”跳过）: ');

  const updates = {};
  if (appIdInput && !isSkipInput(appIdInput)) {
    updates.FEISHU_APP_ID = appIdInput;
  }
  if (appSecretInput && !isSkipInput(appSecretInput)) {
    updates.FEISHU_APP_SECRET = appSecretInput;
  }

  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    console.log('[deploy] 未写入任何飞书凭据（已回撤/跳过）');
    return;
  }

  const updated = updateEnvEntries(updates);
  if (!updated) {
    console.warn('[deploy] 未找到 .env，跳过飞书凭据写入');
    return;
  }

  console.log(`[deploy] 已写入 .env: ${updateKeys.join(', ')}`);
  console.log('[deploy] 提醒：后续可随时手动编辑 .env 更新配置');
}

function parseDotEnvFile() {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const result = {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const exportLessLine = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const separatorIndex = exportLessLine.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = exportLessLine.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    let value = exportLessLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function getRuntimeEnvValue(key) {
  const processValue = process.env[key];
  if (typeof processValue === 'string' && processValue.trim()) {
    return processValue.trim();
  }

  if (cachedDotEnv === null) {
    cachedDotEnv = parseDotEnvFile();
  }

  const fileValue = cachedDotEnv[key];
  return typeof fileValue === 'string' && fileValue.trim() ? fileValue.trim() : undefined;
}

function resolveOpencodeEndpoint() {
  const configuredHost = getRuntimeEnvValue('OPENCODE_HOST');
  const configuredPort = getRuntimeEnvValue('OPENCODE_PORT');

  const host = configuredHost || defaultOpencodeHost;
  const parsedPort = Number.parseInt(configuredPort || String(defaultOpencodePort), 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : defaultOpencodePort;

  return { host, port };
}

function resolveProbeHost(host) {
  if (host === '0.0.0.0') {
    return '127.0.0.1';
  }
  if (host === '::') {
    return '::1';
  }
  return host;
}

function hasSemanticVersion(text) {
  return /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/.test(text);
}

function getOpencodeVersion() {
  const hintedVersion = getRuntimeEnvValue('BRIDGE_OPENCODE_VERSION_HINT');
  if (hintedVersion) {
    return hintedVersion;
  }

  const versionArgsList = [['--version'], ['-v']];
  for (const versionArgs of versionArgsList) {
    try {
      const result = run('opencode', versionArgs, '', {
        capture: true,
        allowFailure: true,
      });
      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      const output = stdout || stderr;

      if (!output) {
        continue;
      }

      if (typeof result.status === 'number' && result.status === 0) {
        return output;
      }

      if (hasSemanticVersion(output)) {
        return output;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function probeTcpPort(host, port, timeoutMs = 1200) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (isOpen, reason) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ isOpen, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', error => {
      const reason = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : error instanceof Error
          ? error.message
          : String(error);
      finish(false, reason);
    });

    socket.connect(port, host);
  });
}

async function checkOpencodeEnvironment({ warnOnly = false } = {}) {
  const version = getOpencodeVersion();
  const { host, port } = resolveOpencodeEndpoint();
  const probeHost = resolveProbeHost(host);
  const probeResult = await probeTcpPort(probeHost, port);
  const hostLabel = probeHost === host ? host : `${host} (探测地址 ${probeHost})`;

  if (version) {
    console.log(`[deploy] OpenCode 已安装: ${version}`);
  } else if (warnOnly) {
    console.warn('[deploy] 强提示: 未检测到 opencode 命令，当前部署会继续');
    console.warn('[deploy] 可在菜单执行「安装/升级 OpenCode」');
  } else {
    console.warn('[deploy] 未检测到 opencode 命令，可在菜单执行「安装/升级 OpenCode」');
  }

  if (probeResult.isOpen) {
    console.log(`[deploy] 端口检查: ${hostLabel}:${port} 已有服务监听（未校验服务类型）`);
  } else if (warnOnly) {
    console.warn(`[deploy] 强提示: 未检测到 ${hostLabel}:${port} 监听，当前部署会继续`);
    console.warn('[deploy] 可在菜单执行「启动 OpenCode CLI（自动写入 server 配置）」');
  } else {
    console.warn(`[deploy] 未检测到 ${hostLabel}:${port} 监听（${probeResult.reason}）`);
  }

  return {
    installed: Boolean(version),
    version,
    host,
    port,
    probeHost,
    portOpen: probeResult.isOpen,
    probeReason: probeResult.reason,
  };
}

async function runOpencodeCheck() {
  console.log('[deploy] 开始检查 OpenCode 环境');
  await ensureRuntimeReady();
  await checkOpencodeEnvironment();
}

async function installOrUpgradeOpencode() {
  await ensureRuntimeReady();

  run('npm', ['i', '-g', 'opencode-ai'], '安装/升级 OpenCode');

  const version = getOpencodeVersion();
  if (version) {
    console.log(`[deploy] OpenCode 已就绪: ${version}`);
    return;
  }

  console.warn('[deploy] 安装命令已执行，但当前终端仍未识别 opencode');
  console.warn('[deploy] 请重开终端后执行 `opencode --version` 进行确认');
}

function ensureEnvFile() {
  cachedDotEnv = null;

  if (fs.existsSync(envPath)) {
    return;
  }

  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    cachedDotEnv = null;
    console.log('[deploy] 已创建 .env（来自 .env.example），请按需修改配置');
    return;
  }

  console.warn('[deploy] 未找到 .env 与 .env.example，请手动创建 .env');
}

function ensureLogDir() {
  fs.mkdirSync(logsDir, { recursive: true });
}

function resolveHomeDirForUser(userName) {
  if (!userName || !isLinux()) {
    return os.homedir();
  }

  const result = spawnSync('getent', ['passwd', userName], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    return os.homedir();
  }

  const parts = result.stdout.trim().split(':');
  if (parts.length >= 6 && parts[5]) {
    return parts[5];
  }

  return os.homedir();
}

function resolveOpencodeConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  if (typeof process.getuid === 'function' && process.getuid() === 0 && process.env.SUDO_USER) {
    const sudoHome = resolveHomeDirForUser(process.env.SUDO_USER);
    return path.join(sudoHome, '.config', 'opencode');
  }

  return path.join(os.homedir(), '.config', 'opencode');
}

function resolveOpencodeAgentsDir() {
  return path.join(resolveOpencodeConfigDir(), 'agents');
}

function resolveOpencodeConfigFilePath() {
  return path.join(resolveOpencodeConfigDir(), opencodeConfigFileName);
}

function writeFixedOpencodeServerConfig() {
  const configDir = resolveOpencodeConfigDir();
  const configPath = resolveOpencodeConfigFilePath();
  fs.mkdirSync(configDir, { recursive: true });

  let existingConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const rawContent = fs.readFileSync(configPath, 'utf-8').trim();
      if (rawContent) {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existingConfig = parsed;
        } else {
          console.warn('[deploy] 当前 opencode.json 不是对象结构，将保留为空配置后写入 server 字段');
        }
      }
    } catch {
      const backupPath = `${configPath}.bak.${Date.now()}`;
      fs.copyFileSync(configPath, backupPath);
      console.warn(`[deploy] 检测到 opencode.json 格式异常，已备份至 ${backupPath}`);
    }
  }

  const nextConfig = {
    ...existingConfig,
    server: {
      ...fixedOpencodeServerConfig,
    },
  };

  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8');
  console.log(`[deploy] 已写入 OpenCode server 配置: ${configPath}`);
  return configPath;
}

async function startOpencodeCliWithManagedConfig() {
  await ensureRuntimeReady();

  const version = getOpencodeVersion();
  if (!version) {
    throw new Error('未检测到 opencode 命令，请先执行「安装/升级 OpenCode」');
  }

  const probe = await probeTcpPort('127.0.0.1', fixedOpencodeServerConfig.port);
  if (probe.isOpen) {
    const shouldContinue = await askYesNo(
      `[deploy] 检测到 127.0.0.1:${fixedOpencodeServerConfig.port} 已有服务监听，是否仍继续启动 OpenCode？[y/N]: `,
      false,
    );
    if (!shouldContinue) {
      console.log('[deploy] 已取消启动 OpenCode');
      return;
    }
  }

  writeFixedOpencodeServerConfig();
  console.log('[deploy] 将以前台模式启动 OpenCode CLI（按 Ctrl+C 退出）');
  const result = run('opencode', [], '启动 OpenCode CLI（前台）', { allowFailure: true });

  if (typeof result.status === 'number' && result.status !== 0) {
    console.warn(`[deploy] OpenCode 已退出（退出码 ${result.status}）`);
  }
}

async function runBeginnerGuide() {
  console.log('[deploy] 开始首次引导（推荐）');
  await ensureRuntimeReady();

  const version = getOpencodeVersion();
  if (version) {
    console.log(`[deploy] OpenCode 已安装: ${version}`);
  } else {
    console.warn('[deploy] 未检测到 OpenCode，可一键安装');
    const shouldInstall = await askYesNo('[deploy] 是否现在安装 OpenCode？[Y/n]: ', true);
    if (shouldInstall) {
      await installOrUpgradeOpencode();
    } else {
      console.warn('[deploy] 已跳过 OpenCode 安装，后续可在菜单中执行「安装/升级 OpenCode」');
    }
  }

  await deployProject();

  console.log('\n[deploy] 首次引导完成，建议按顺序继续：');
  console.log('  1) 菜单执行「启动 OpenCode CLI（自动写入 server 配置）」');
  console.log('  2) 菜单执行「启动后台进程（通用）」');
}

function getBridgeTemplateFiles() {
  if (!fs.existsSync(bridgeAgentTemplateDir)) {
    return [];
  }

  const files = fs.readdirSync(bridgeAgentTemplateDir, { withFileTypes: true });
  return files
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function readBridgeManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }
    if (!Array.isArray(parsed.files)) {
      return [];
    }

    return parsed.files.filter(file => typeof file === 'string' && file.endsWith('.md'));
  } catch {
    return [];
  }
}

function syncBridgeAgents() {
  const templateFiles = getBridgeTemplateFiles();
  if (templateFiles.length === 0) {
    console.log('[deploy] 未发现内置 Agent 模板，跳过同步');
    return;
  }

  const targetAgentsDir = resolveOpencodeAgentsDir();
  fs.mkdirSync(targetAgentsDir, { recursive: true });

  const manifestPath = path.join(targetAgentsDir, bridgeAgentManifestName);
  const previousFiles = readBridgeManifest(manifestPath);

  for (const fileName of templateFiles) {
    const source = path.join(bridgeAgentTemplateDir, fileName);
    const target = path.join(targetAgentsDir, fileName);
    fs.copyFileSync(source, target);
  }

  for (const staleFile of previousFiles) {
    if (!templateFiles.includes(staleFile)) {
      fs.rmSync(path.join(targetAgentsDir, staleFile), { force: true });
    }
  }

  const manifest = {
    version: 1,
    files: templateFiles,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`[deploy] 已同步 ${templateFiles.length} 个内置 Agent 模板到 ${targetAgentsDir}`);
  console.log('[deploy] 如面板未显示新角色，请重启 OpenCode');
}

function unsyncBridgeAgents() {
  const targetAgentsDir = resolveOpencodeAgentsDir();
  if (!fs.existsSync(targetAgentsDir)) {
    console.log('[deploy] OpenCode agents 目录不存在，跳过模板清理');
    return;
  }

  const manifestPath = path.join(targetAgentsDir, bridgeAgentManifestName);
  const manifestFiles = readBridgeManifest(manifestPath);
  const removableFiles = manifestFiles.length > 0
    ? manifestFiles
    : fs.readdirSync(targetAgentsDir)
      .filter(fileName => fileName.startsWith(bridgeAgentFilePrefix) && fileName.endsWith('.md'));

  let removedCount = 0;
  for (const fileName of removableFiles) {
    const fullPath = path.join(targetAgentsDir, fileName);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true });
      removedCount += 1;
    }
  }

  fs.rmSync(manifestPath, { force: true });
  console.log(`[deploy] 已清理 ${removedCount} 个桥接内置 Agent 模板`);
}

async function deployProject() {
  console.log('[deploy] 开始部署');
  await ensureRuntimeReady();
  ensureEnvFile();
  ensureLogDir();

  console.log('\n[deploy] OpenCode 环境预检（仅提示，不阻断部署）');
  await checkOpencodeEnvironment({ warnOnly: true });

  run('npm', ['install', '--include=dev'], '安装依赖');
  run('npm', ['run', 'build'], '编译项目');
  syncBridgeAgents();

  ensureEnvFile();
  await promptFeishuCredentialsSetup();

  console.log('\n[deploy] 部署完成');
}

function startBackgroundProcess() {
  run(process.execPath, [path.join(scriptDir, 'start.mjs')], '启动后台进程');
}

function stopBackgroundProcess() {
  run(process.execPath, [path.join(scriptDir, 'stop.mjs')], '停止后台进程', { allowFailure: true });
}

function uninstallBackgroundProcess() {
  stopBackgroundProcess();
  fs.rmSync(pidFile, { force: true });
  fs.rmSync(outLog, { force: true });
  fs.rmSync(errLog, { force: true });
  unsyncBridgeAgents();
  console.log('[deploy] 已清理后台进程相关文件');
}

function cleanupForUpgrade() {
  uninstallBackgroundProcess();

  const distDir = path.join(rootDir, 'dist');
  const nodeModulesDir = path.join(rootDir, 'node_modules');

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.rmSync(nodeModulesDir, { recursive: true, force: true });

  console.log('[deploy] 已清理 dist 与 node_modules（保留 scripts/ 升级脚本）');
}

function pullLatestCode() {
  const gitDir = path.join(rootDir, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log('[deploy] 当前目录非 Git 仓库，跳过拉取最新代码');
    return;
  }

  const statusResult = run('git', ['status', '--porcelain'], '', {
    allowFailure: true,
    capture: true,
  });

  if (statusResult.error || statusResult.status !== 0) {
    console.warn('[deploy] 无法读取 Git 状态，跳过自动拉取代码');
    return;
  }

  if ((statusResult.stdout || '').trim()) {
    console.warn('[deploy] 检测到本地未提交修改，跳过 git pull，继续使用当前代码升级');
    return;
  }

  const pullResult = run('git', ['pull', '--ff-only'], '拉取最新代码', {
    allowFailure: true,
  });

  if (pullResult.error || pullResult.status !== 0) {
    console.warn('[deploy] git pull 失败，继续使用当前代码升级');
  }
}

async function upgradeProject() {
  console.log('[deploy] 开始更新升级');
  await ensureRuntimeReady();
  cleanupForUpgrade();
  pullLatestCode();
  await deployProject();
  console.log('\n[deploy] 更新升级完成');
}

function canUseSystemd() {
  if (!isLinux()) {
    return false;
  }

  if (!fs.existsSync('/run/systemd/system')) {
    return false;
  }

  const result = spawnSync('systemctl', ['--version'], {
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function requireRootForSystemd() {
  if (!isLinux()) {
    throw new Error('仅 Linux 支持 systemd 服务管理');
  }

  if (!canUseSystemd()) {
    throw new Error('当前系统未检测到 systemd');
  }

  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('systemd 安装/卸载需要 root 权限，请使用 sudo 执行');
  }
}

function isSystemdUnitNotLoadedMessage(text) {
  const normalized = text.toLowerCase();
  return normalized.includes('not loaded')
    || normalized.includes('not-found')
    || normalized.includes('does not exist')
    || normalized.includes('not be found')
    || normalized.includes('no such file');
}

function getServiceRunUser() {
  return process.env.SUDO_USER || process.env.USER || 'root';
}

function buildServiceContent() {
  const serviceUser = getServiceRunUser();
  return [
    '[Unit]',
    'Description=Feishu OpenCode Bridge',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${serviceUser}`,
    `WorkingDirectory=${rootDir}`,
    `ExecStart=${process.execPath} dist/index.js`,
    'Restart=always',
    'RestartSec=3',
    `EnvironmentFile=-${envPath}`,
    `StandardOutput=append:${outLog}`,
    `StandardError=append:${errLog}`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

async function installSystemdService() {
  requireRootForSystemd();
  await deployProject();

  fs.writeFileSync(serviceFilePath, buildServiceContent(), 'utf-8');
  run('systemctl', ['daemon-reload'], '刷新 systemd 配置');
  run('systemctl', ['enable', '--now', serviceName], '启用并启动 systemd 服务');

  console.log(`[deploy] systemd 服务已安装: ${serviceFilePath}`);
}

function disableSystemdService() {
  requireRootForSystemd();
  run('systemctl', ['disable', '--now', serviceName], '停止并禁用 systemd 服务', { allowFailure: true });
  const resetResult = run('systemctl', ['reset-failed', serviceName], '清理失败状态', {
    allowFailure: true,
    capture: true,
  });
  if (typeof resetResult.status === 'number' && resetResult.status !== 0) {
    const stderr = `${resetResult.stderr || ''}`.trim();
    if (stderr && !isSystemdUnitNotLoadedMessage(stderr)) {
      console.warn(`[deploy] 清理失败状态返回异常: ${stderr}`);
    } else {
      console.log(`[deploy] 服务 ${serviceName}.service 未加载，跳过失败状态清理`);
    }
  }
  console.log('[deploy] 已停止并禁用 systemd 服务');
}

function uninstallSystemdService() {
  requireRootForSystemd();
  disableSystemdService();

  if (fs.existsSync(serviceFilePath)) {
    fs.rmSync(serviceFilePath, { force: true });
    run('systemctl', ['daemon-reload'], '刷新 systemd 配置');
  }

  unsyncBridgeAgents();

  console.log('[deploy] 已卸载 systemd 服务');
}

function printLinuxStatus() {
  const hasService = fs.existsSync(serviceFilePath);
  console.log(`[deploy] systemd 服务文件: ${hasService ? serviceFilePath : '未安装'}`);

  if (hasService && canUseSystemd()) {
    const active = run('systemctl', ['is-active', serviceName], '', { allowFailure: true, capture: true });
    const enabled = run('systemctl', ['is-enabled', serviceName], '', { allowFailure: true, capture: true });
    console.log(`[deploy] 服务状态: ${(active.stdout || '').trim() || 'unknown'}`);
    console.log(`[deploy] 开机自启: ${(enabled.stdout || '').trim() || 'unknown'}`);
  }

  if (fs.existsSync(pidFile)) {
    console.log(`[deploy] 后台进程 PID 文件: ${pidFile}`);
  }
}

async function showMenu() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeReadline = rl;

  try {
    await ensureRuntimeReady();
    await checkOpencodeEnvironment();

    while (true) {
      console.log('\n========== Feishu OpenCode Bridge ==========');
      if (isLinux()) {
        console.log('1) 一键部署（安装依赖+编译）');
        console.log('2) 启动后台进程（通用）');
        console.log('3) 停止后台进程（通用）');
        console.log('4) 安装并启动 systemd 服务（常驻）');
        console.log('5) 停止并禁用 systemd 服务');
        console.log('6) 卸载 systemd 服务');
        console.log('7) 查看运行状态');
        console.log('8) 一键更新升级（先拆卸清理再更新）');
        console.log('9) 安装/升级 OpenCode（npm i -g opencode-ai）');
        console.log('10) 检查 OpenCode 环境（安装与端口）');
        console.log('11) 启动 OpenCode CLI（自动写入 server 配置）');
        console.log('12) 首次引导（推荐）');
        console.log('0) 退出');
      } else {
        console.log('1) 一键部署（安装依赖+编译）');
        console.log('2) 启动后台进程');
        console.log('3) 停止后台进程');
        console.log('4) 卸载后台进程（停止并清理日志/PID）');
        console.log('5) 一键更新升级（先拆卸清理再更新）');
        console.log('6) 安装/升级 OpenCode（npm i -g opencode-ai）');
        console.log('7) 检查 OpenCode 环境（安装与端口）');
        console.log('8) 启动 OpenCode CLI（自动写入 server 配置）');
        console.log('9) 首次引导（推荐）');
        console.log('0) 退出');
      }

      const choice = (await rl.question('请选择操作: ')).trim();

      try {
        if (isLinux()) {
          switch (choice) {
            case '1':
              await deployProject();
              break;
            case '2':
              startBackgroundProcess();
              break;
            case '3':
              stopBackgroundProcess();
              break;
            case '4':
              await installSystemdService();
              break;
            case '5':
              disableSystemdService();
              break;
            case '6':
              uninstallSystemdService();
              break;
            case '7':
              printLinuxStatus();
              break;
            case '8':
              await upgradeProject();
              break;
            case '9':
              await installOrUpgradeOpencode();
              break;
            case '10':
              await runOpencodeCheck();
              break;
            case '11':
              await startOpencodeCliWithManagedConfig();
              break;
            case '12':
              await runBeginnerGuide();
              break;
            case '0':
              return;
            default:
              console.log('[deploy] 无效选项');
          }
        } else {
          switch (choice) {
            case '1':
              await deployProject();
              break;
            case '2':
              startBackgroundProcess();
              break;
            case '3':
              stopBackgroundProcess();
              break;
            case '4':
              uninstallBackgroundProcess();
              break;
            case '5':
              await upgradeProject();
              break;
            case '6':
              await installOrUpgradeOpencode();
              break;
            case '7':
              await runOpencodeCheck();
              break;
            case '8':
              await startOpencodeCliWithManagedConfig();
              break;
            case '9':
              await runBeginnerGuide();
              break;
            case '0':
              return;
            default:
              console.log('[deploy] 无效选项');
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[deploy] 操作失败: ${message}`);
      }
    }
  } finally {
    activeReadline = null;
    rl.close();
  }
}

function printUsage() {
  console.log('用法: node scripts/deploy.mjs [action]');
  console.log('可选 action:');
  console.log('  deploy                一键部署（安装依赖+编译）');
  console.log('  upgrade               一键更新升级（先拆卸清理再更新）');
  console.log('  opencode-install      安装/升级 OpenCode（npm i -g opencode-ai）');
  console.log('  opencode-check        检查 OpenCode 安装与端口状态');
  console.log('  opencode-start        启动 OpenCode CLI（自动写入 server 配置）');
  console.log('  guide                 首次引导（推荐）');
  console.log('  start                 启动后台进程');
  console.log('  stop                  停止后台进程');
  console.log('  uninstall             卸载后台进程（停止并清理日志/PID）');
  console.log('  menu                  打开交互菜单（默认）');
  if (isLinux()) {
    console.log('  service-install       安装并启动 systemd 服务');
    console.log('  service-disable       停止并禁用 systemd 服务');
    console.log('  service-uninstall     卸载 systemd 服务');
    console.log('  status                查看 systemd/进程状态');
  }
}

async function main() {
  const action = (process.argv[2] || 'menu').trim();

  try {
    switch (action) {
      case 'menu':
        await showMenu();
        break;
      case 'deploy':
        await deployProject();
        break;
      case 'upgrade':
      case 'update':
        await upgradeProject();
        break;
      case 'opencode-install':
        await installOrUpgradeOpencode();
        break;
      case 'opencode-check':
        await runOpencodeCheck();
        break;
      case 'opencode-start':
        await startOpencodeCliWithManagedConfig();
        break;
      case 'guide':
        await runBeginnerGuide();
        break;
      case 'start':
        startBackgroundProcess();
        break;
      case 'stop':
        stopBackgroundProcess();
        break;
      case 'uninstall':
        uninstallBackgroundProcess();
        break;
      case 'service-install':
        await installSystemdService();
        break;
      case 'service-disable':
        disableSystemdService();
        break;
      case 'service-uninstall':
        uninstallSystemdService();
        break;
      case 'status':
        printLinuxStatus();
        break;
      case 'help':
      case '--help':
      case '-h':
        printUsage();
        break;
      default:
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[deploy] 执行失败: ${message}`);
    process.exit(1);
  }
}

await main();
