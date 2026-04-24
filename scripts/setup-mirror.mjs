#!/usr/bin/env node

/**
 * 自动检测并配置最快的镜像源
 * 支持: npm registry, sharp, better-sqlite3, puppeteer
 *
 * 用法: node scripts/setup-mirror.mjs
 */

import { writeFileSync, existsSync, appendFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

// 镜像源配置 (主1备2兜底1)
const MIRRORS = {
  registry: [
    { name: 'npmmirror', url: 'https://registry.npmmirror.com', test: 'https://registry.npmmirror.com' },
    { name: 'huawei', url: 'https://mirrors.huaweicloud.com/repository/npm/', test: 'https://mirrors.huaweicloud.com/repository/npm/' },
    { name: 'npmjs', url: 'https://registry.npmjs.org', test: 'https://registry.npmjs.org' }
  ],
  sharp: [
    { name: 'npmmirror', url: 'https://registry.npmmirror.com/-/binary/sharp', test: 'https://registry.npmmirror.com/-/binary/sharp' },
    { name: 'github', url: 'https://github.com/lovell/sharp/releases/download', test: 'https://github.com/lovell/sharp/releases' }
  ],
  sharpLibvips: [
    { name: 'npmmirror', url: 'https://registry.npmmirror.com/-/binary/sharp-libvips', test: 'https://registry.npmmirror.com/-/binary/sharp-libvips' },
    { name: 'github', url: 'https://github.com/lovell/sharp-libvips/releases/download', test: 'https://github.com/lovell/sharp-libvips/releases' }
  ],
  betterSqlite3: [
    { name: 'npmmirror', url: 'https://registry.npmmirror.com/-/binary/better-sqlite3', test: 'https://registry.npmmirror.com/-/binary/better-sqlite3' },
    { name: 'github', url: 'https://github.com/WiseLibs/better-sqlite3/releases/download', test: 'https://github.com/WiseLibs/better-sqlite3/releases' }
  ],
  puppeteer: [
    { name: 'npmmirror', url: 'https://registry.npmmirror.com/-/binary/chromium-browser-snapshots', test: 'https://registry.npmmirror.com/-/binary/chromium-browser-snapshots' },
    { name: 'google', url: 'https://storage.googleapis.com/chromium-browser-snapshots', test: 'https://storage.googleapis.com/chromium-browser-snapshots' }
  ]
};

const TIMEOUT = 3000; // 3秒超时

/**
 * 测试镜像源响应时间
 */
async function testMirror(mirror) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

    const response = await fetch(mirror.test, {
      method: 'HEAD',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok || response.status === 200 || response.status === 302 || response.status === 301) {
      return { ...mirror, latency: Date.now() - start, available: true };
    }
    return { ...mirror, latency: Infinity, available: false };
  } catch (error) {
    return { ...mirror, latency: Infinity, available: false };
  }
}

/**
 * 选择最快的可用镜像
 */
async function selectBestMirror(mirrors) {
  const results = await Promise.all(mirrors.map(testMirror));
  const available = results.filter(r => r.available);

  if (available.length === 0) {
    // 全部不可用时使用第一个（兜底）
    return mirrors[0];
  }

  // 按延迟排序，选择最快的
  available.sort((a, b) => a.latency - b.latency);
  return available[0];
}

/**
 * 生成 .npmrc 内容
 */
function generateNpmrc(selected) {
  const lines = [
    '# 自动生成的镜像配置 (by setup-mirror.mjs)',
    `# 生成时间: ${new Date().toISOString()}`,
    '',
    '# npm registry',
    `registry=${selected.registry.url}`,
    '',
    '# sharp 二进制镜像',
    `sharp_binary_host=${selected.sharp.url}`,
    `sharp_libvips_binary_host=${selected.sharpLibvips.url}`,
    '',
    '# better-sqlite3 二进制镜像',
    `better_sqlite3_binary_host=${selected.betterSqlite3.url}`,
    '',
    '# puppeteer chromium 镜像',
    `puppeteer_download_host=${selected.puppeteer.url}`
  ];

  return lines.join('\n');
}

/**
 * 配置 git 协议替换
 */
function setupGitProtocol() {
  try {
    // 将 git@github.com: 替换为 https://github.com/
    execSync('git config --global url."https://github.com/".insteadOf "git@github.com:"', { stdio: 'pipe' });
    execSync('git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"', { stdio: 'pipe' });
    console.log('✅ Git 协议替换已配置 (git@github.com → https://github.com)');
  } catch (error) {
    console.warn('⚠️  Git 协议配置失败:', error.message);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 检测镜像源可用性...\n');

  const selected = {};

  // 并行测试所有类型
  const types = Object.keys(MIRRORS);
  const results = await Promise.all(
    types.map(async (type) => {
      const best = await selectBestMirror(MIRRORS[type]);
      console.log(`  ${type.padEnd(15)} → ${best.name} (${best.latency === Infinity ? '兜底' : `${best.latency}ms`})`);
      return [type, best];
    })
  );

  results.forEach(([type, mirror]) => {
    selected[type] = mirror;
  });

  console.log('\n📝 生成 .npmrc...');
  const npmrcContent = generateNpmrc(selected);

  // 保留用户自定义配置
  const npmrcPath = '.npmrc';
  if (existsSync(npmrcPath)) {
    // 读取现有配置，移除自动生成的部分
    const existing = readFileSync(npmrcPath, 'utf-8');
    const lines = existing.split('\n').filter(line =>
      !line.includes('# 自动生成的镜像配置') &&
      !line.includes('# 生成时间:') &&
      !line.includes('registry=') &&
      !line.includes('sharp_binary_host=') &&
      !line.includes('sharp_libvips_binary_host=') &&
      !line.includes('better_sqlite3_binary_host=') &&
      !line.includes('puppeteer_download_host=')
    );

    const customConfig = lines.join('\n').trim();
    if (customConfig) {
      writeFileSync(npmrcPath, npmrcContent + '\n\n# 用户自定义配置\n' + customConfig + '\n');
    } else {
      writeFileSync(npmrcPath, npmrcContent + '\n');
    }
  } else {
    writeFileSync(npmrcPath, npmrcContent + '\n');
  }

  console.log('✅ .npmrc 已更新\n');

  // 配置 git 协议替换
  setupGitProtocol();

  console.log('\n✨ 镜像配置完成，开始安装依赖...\n');
}

main().catch((error) => {
  console.error('❌ 镜像配置失败:', error.message);
  process.exit(0); // 不阻止安装流程
});