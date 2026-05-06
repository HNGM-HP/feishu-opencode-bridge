/**
 * 读取本项目 package.json 中的 version 字段。
 *
 * 取值优先级：
 * 1. `process.env.APP_VERSION`
 *    - Electron 打包后，Admin / Bridge 以 ELECTRON_RUN_AS_NODE=1 启动，无法读 asar 内的
 *      package.json；因此由 Electron 主进程在 spawn 时通过环境变量传入（见 electron/main.ts）。
 * 2. fs.readFileSync 多路径试探
 *    - dist/utils/ → ../../package.json（开发 / 源码部署）
 *    - dist-electron/utils/ → ../../package.json（兜底）
 *    - resourcesPath/app/package.json、resourcesPath/package.json（Electron 打包场景的兜底）
 * 3. 全部失败 → 'unknown'，不崩溃
 *
 * 绝不要改回 `import pkg from '../../package.json' with { type: 'json' }` —— ESM JSON 导入
 * 要求文件在解析路径上真实存在，这与 Electron asar 打包策略冲突。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // 1) 环境变量（Electron 主进程注入）
  const envVersion = process.env.APP_VERSION;
  if (envVersion && envVersion.trim()) {
    return envVersion.trim();
  }

  // 2) 磁盘多路径试探
  const candidates: string[] = [
    path.resolve(__dirname, '../../package.json'),
    path.resolve(__dirname, '../../../package.json'),
  ];
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'app', 'package.json'));
    candidates.push(path.join(resourcesPath, 'package.json'));
  }

  for (const p of candidates) {
    try {
      const text = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.version === 'string') {
        return parsed.version;
      }
    } catch {
      // 尝试下一个路径
    }
  }
  return 'unknown';
}

export const VERSION = readVersion();
