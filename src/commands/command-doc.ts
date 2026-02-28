import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export interface CommandDocItem {
  name: string;
  description?: string;
  source?: string;
}

export interface CommandDocData {
  updatedAt: string;
  total: number;
  groups: Record<string, CommandDocItem[]>;
}

export const COMMAND_DOC_PATH = path.resolve('docs', 'generated', 'commands.md');

export async function writeCommandDoc(data: CommandDocData): Promise<string> {
  await mkdir(path.dirname(COMMAND_DOC_PATH), { recursive: true });
  const lines: string[] = [];
  lines.push('# OpenCode 命令清单');
  lines.push('');
  lines.push(`更新时间：${data.updatedAt}`);
  lines.push(`命令总数：${data.total}`);
  lines.push('');

  const groupConfig: Array<{ key: string; title: string }> = [
    { key: 'command', title: '内置命令' },
    { key: 'mcp', title: 'MCP 命令' },
    { key: 'skill', title: '技能命令' },
    { key: 'other', title: '其他' },
  ];

  for (const { key, title } of groupConfig) {
    const items = data.groups[key] || [];
    if (items.length === 0) continue;
    lines.push(`## ${title}`);
    lines.push(`共 ${items.length} 条`);
    lines.push('');
    lines.push('| 命令 | 描述 |');
    lines.push('| --- | --- |');
    for (const item of items) {
      const desc = item.description || '-';
      // 表格内换行用 <br>，管道符转义
      const safeDesc = desc.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      lines.push(`| \`/${item.name}\` | ${safeDesc} |`);
    }
    lines.push('');
  }

  const content = `${lines.join('\n').trim()}\n`;
  await writeFile(COMMAND_DOC_PATH, content, 'utf8');
  return COMMAND_DOC_PATH;
}
