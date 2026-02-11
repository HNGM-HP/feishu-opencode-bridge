#!/usr/bin/env node

import fs from 'node:fs';
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

function isWindows() {
  return process.platform === 'win32';
}

function isLinux() {
  return process.platform === 'linux';
}

function getCommandVariants(command, args) {
  if (command !== 'npm') {
    return [{ command, args }];
  }

  const variants = [];
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    variants.push({
      command: process.execPath,
      args: [npmExecPath, ...args],
    });
  }

  variants.push({ command: 'npm', args });

  if (isWindows()) {
    variants.push({ command: 'npm.cmd', args });
    variants.push({ command: 'npm.exe', args });
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
  if (major < 20) {
    throw new Error(`需要 Node.js >= 20，当前版本: ${process.versions.node}`);
  }
}

function ensureNpm() {
  try {
    run('npm', ['--version'], '', { capture: true });
  } catch {
    throw new Error('未检测到 npm，请先安装 Node.js (包含 npm)');
  }
}

function ensureEnvFile() {
  if (fs.existsSync(envPath)) {
    return;
  }

  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
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

function deployProject() {
  console.log('[deploy] 开始部署');
  ensureNodeVersion();
  ensureNpm();
  ensureEnvFile();
  ensureLogDir();

  run('npm', ['install', '--include=dev'], '安装依赖');
  run('npm', ['run', 'build'], '编译项目');
  syncBridgeAgents();

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

function installSystemdService() {
  requireRootForSystemd();
  deployProject();

  fs.writeFileSync(serviceFilePath, buildServiceContent(), 'utf-8');
  run('systemctl', ['daemon-reload'], '刷新 systemd 配置');
  run('systemctl', ['enable', '--now', serviceName], '启用并启动 systemd 服务');

  console.log(`[deploy] systemd 服务已安装: ${serviceFilePath}`);
}

function disableSystemdService() {
  requireRootForSystemd();
  run('systemctl', ['disable', '--now', serviceName], '停止并禁用 systemd 服务', { allowFailure: true });
  run('systemctl', ['reset-failed', serviceName], '清理失败状态', { allowFailure: true });
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

  try {
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
        console.log('0) 退出');
      } else {
        console.log('1) 一键部署（安装依赖+编译）');
        console.log('2) 启动后台进程');
        console.log('3) 停止后台进程');
        console.log('4) 卸载后台进程（停止并清理日志/PID）');
        console.log('0) 退出');
      }

      const choice = (await rl.question('请选择操作: ')).trim();

      try {
        if (isLinux()) {
          switch (choice) {
            case '1':
              deployProject();
              break;
            case '2':
              startBackgroundProcess();
              break;
            case '3':
              stopBackgroundProcess();
              break;
            case '4':
              installSystemdService();
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
            case '0':
              return;
            default:
              console.log('[deploy] 无效选项');
          }
        } else {
          switch (choice) {
            case '1':
              deployProject();
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
    rl.close();
  }
}

function printUsage() {
  console.log('用法: node scripts/deploy.mjs [action]');
  console.log('可选 action:');
  console.log('  deploy                一键部署（安装依赖+编译）');
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
        deployProject();
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
        installSystemdService();
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
