import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { feishuClient } from '../feishu/client.js';
import { DirectoryPolicy } from '../utils/directory-policy.js';
import { COMMAND_DOC_PATH } from '../commands/command-doc.js';

// 系统生成文件豁免列表（绕过 ALLOWED_DIRECTORIES 校验）
const SYSTEM_GENERATED_PATHS: Set<string> = new Set([
  path.resolve(COMMAND_DOC_PATH),
]);

// 敏感文件名黑名单（基于文件名模式匹配）
const SENSITIVE_NAME_PATTERNS = [
  /\.env$/i,
  /\.env\..+$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /credentials/i,
  /\.key$/i,
  /secrets?\./i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /authorized_keys/i,
  /known_hosts/i,
];

// 敏感文件名精确匹配集合（无扩展名的系统文件）
const SENSITIVE_EXACT_NAMES = new Set([
  'shadow', 'passwd', 'sudoers', 'gshadow', 'master.passwd',
  'group', 'hosts', 'fstab', 'crontab', 'environ', 'cmdline',
  'SAM', 'SYSTEM', 'SECURITY', 'NTDS.dit',
  '.bash_history', '.zsh_history', '.fish_history',
  '.bashrc', '.zshrc', '.profile',
]);

// 敏感目录路径黑名单（拦截 /etc/shadow、/proc/self/environ 等系统文件）
const SENSITIVE_PATH_PREFIXES = [
  '/etc/', '/proc/', '/sys/', '/dev/', '/boot/', '/root/',
  '/.ssh/', '/.aws/', '/.gnupg/', '/.config/gcloud',
];

/**
 * 路径安全校验。
 * 注意：resolvedPath 必须已经经过 path.resolve() 处理（绝对路径）。
 */
export function validateFilePath(resolvedPath: string): { safe: boolean; reason?: string } {
  // 0. 系统生成文件豁免（绕过白名单校验）
  if (SYSTEM_GENERATED_PATHS.has(resolvedPath)) {
    // 仍需检查敏感文件名
    const basename = path.basename(resolvedPath);
    for (const pattern of SENSITIVE_NAME_PATTERNS) {
      if (pattern.test(basename)) {
        return { safe: false, reason: `拒绝发送敏感文件: ${basename}` };
      }
    }
    return { safe: true };
  }

  // 1. 允许目录白名单校验（未配置时直接拒绝）
  if (!DirectoryPolicy.isAllowedPath(resolvedPath)) {
    return { safe: false, reason: '路径不在允许的工作目录范围内' };
  }

  const basename = path.basename(resolvedPath);

  // 2. 精确文件名匹配
  if (SENSITIVE_EXACT_NAMES.has(basename)) {
    return { safe: false, reason: `拒绝发送敏感文件: ${basename}` };
  }

  // 3. 文件名模式匹配
  for (const pattern of SENSITIVE_NAME_PATTERNS) {
    if (pattern.test(basename)) {
      return { safe: false, reason: `拒绝发送敏感文件: ${basename}` };
    }
  }

  // 4. 路径目录黑名单（统一转为正斜杠以兼容 Windows 路径格式）
  const normalizedPath = resolvedPath.replace(/\\/g, '/');
  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (normalizedPath.includes(prefix)) {
      return { safe: false, reason: `拒绝发送系统敏感目录下的文件: ${basename}` };
    }
  }

  return { safe: true };
}

// 飞书官方上传限制
const FEISHU_IMAGE_MAX_SIZE = 10 * 1024 * 1024;  // 10MB
const FEISHU_FILE_MAX_SIZE = 30 * 1024 * 1024;    // 30MB

// 图片扩展名集合
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.ico',
]);

// 飞书文件类型映射
type FeishuFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';

const FILE_TYPE_MAP: Record<string, FeishuFileType> = {
  '.pdf': 'pdf',
  '.mp4': 'mp4',
  '.opus': 'opus',
  '.ogg': 'opus',
  '.doc': 'doc',
  '.docx': 'doc',
  '.xls': 'xls',
  '.xlsx': 'xls',
  '.ppt': 'ppt',
  '.pptx': 'ppt',
};

export interface SendFileRequest {
  filePath: string;
  chatId: string;
}

export interface SendFileResult {
  success: boolean;
  messageId?: string;
  error?: string;
  fileName?: string;
  fileSize?: number;
  sendType?: 'image' | 'file';
}

// 判断是否为图片类型
function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

// 获取飞书文件类型
function getFeishuFileType(ext: string): FeishuFileType {
  return FILE_TYPE_MAP[ext.toLowerCase()] || 'stream';
}

// 发送文件到飞书群聊
export async function sendFileToFeishu(request: SendFileRequest): Promise<SendFileResult> {
  const { filePath, chatId } = request;

  // 1. 路径标准化（统一 resolve，后续所有操作均基于 resolvedPath）
  const resolvedPath = path.resolve(filePath);
  const fileName = path.basename(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();

  // 2. 安全校验（优先于 IO 操作，避免通过文件不存在报错来探测系统文件）
  const validation = validateFilePath(resolvedPath);
  if (!validation.safe) {
    return { success: false, error: validation.reason, fileName };
  }

  // 3. 存在性检查（错误信息只显示文件名，不暴露服务器完整路径）
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolvedPath);
  } catch {
    return { success: false, error: `文件不存在: ${fileName}` };
  }

  if (!stat.isFile()) {
    return { success: false, error: `路径不是文件: ${fileName}` };
  }

  const fileSize = stat.size;
  if (fileSize === 0) {
    return { success: false, error: '不允许上传空文件' };
  }

  // 4. 读取权限检查（stat 成功不代表进程有读权限）
  try {
    await fsp.access(resolvedPath, fs.constants.R_OK);
  } catch {
    return { success: false, error: `无权限读取文件: ${fileName}` };
  }

  // 5. 判断通道类型并检查大小限制
  const isImage = isImageExtension(ext);
  const maxSize = isImage ? FEISHU_IMAGE_MAX_SIZE : FEISHU_FILE_MAX_SIZE;
  if (fileSize > maxSize) {
    const limitMB = maxSize / (1024 * 1024);
    return {
      success: false,
      error: `文件大小 ${(fileSize / (1024 * 1024)).toFixed(1)}MB 超过飞书${isImage ? '图片' : '文件'}上传限制 ${limitMB}MB`,
    };
  }

  if (isImage) {
    // 6a. 图片通道：上传 → 发送图片消息
    const imageStream = fs.createReadStream(resolvedPath);
    try {
      const imageKey = await feishuClient.uploadImage(imageStream);
      if (!imageKey) {
        return { success: false, error: '图片上传失败', fileName, fileSize };
      }

      const messageId = await feishuClient.sendImageMessage(chatId, imageKey);
      if (!messageId) {
        return { success: false, error: '图片消息发送失败', fileName, fileSize, sendType: 'image' };
      }

      return { success: true, messageId, fileName, fileSize, sendType: 'image' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FileSender] 图片发送异常: ${message}`);
      return { success: false, error: `发送异常: ${message}`, fileName, fileSize };
    } finally {
      imageStream.destroy();
    }
  } else {
    // 6b. 文件通道：上传 → 发送文件消息
    const fileType = getFeishuFileType(ext);
    const fileStream = fs.createReadStream(resolvedPath);
    try {
      const fileKey = await feishuClient.uploadFile(fileStream, fileName, fileType);
      if (!fileKey) {
        return { success: false, error: '文件上传失败', fileName, fileSize };
      }

      const messageId = await feishuClient.sendFileMessage(chatId, fileKey);
      if (!messageId) {
        return { success: false, error: '文件消息发送失败', fileName, fileSize, sendType: 'file' };
      }

      return { success: true, messageId, fileName, fileSize, sendType: 'file' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FileSender] 文件发送异常: ${message}`);
      return { success: false, error: `发送异常: ${message}`, fileName, fileSize };
    } finally {
      fileStream.destroy();
    }
  }
}
