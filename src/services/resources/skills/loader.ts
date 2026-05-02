/**
 * Skill 文件加载器（无状态、纯函数）
 *
 * 负责把磁盘上单个 skill 目录解析成内存对象；不持有任何缓存或监听器。
 * 缓存与热载由 registry.ts 负责。
 *
 * Skill 目录结构：
 *   data/skills/<name>/
 *     SKILL.md          (必需，YAML frontmatter + Markdown 正文)
 *     scripts/          (可选，附属脚本)
 *     assets/           (可选，附属资源)
 *
 * SKILL.md frontmatter 字段：
 *   name          string   必需，必须与目录名一致（防止重命名后引用失效）
 *   description   string   必需，slash 命令补全/列表用文案
 *   version       string   可选
 *   allowed-tools string[] 可选，注入时传给模型作为工具白名单
 *   enabled       boolean  可选，缺省 true；false 时不参与 slash 注入
 */

import path from 'node:path';
import fs from 'node:fs';
import matter from 'gray-matter';

import { isValidResourceName } from '../paths.js';
import type { ResourceScope } from '../types.js';

/** 解析后的 skill frontmatter（已校验必需字段）。 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  /** YAML 中可能写作 allowed-tools 或 allowedTools，统一在解析时归一化。 */
  allowedTools?: string[];
  enabled: boolean;
  /** 其它未识别字段原样保留，便于将来扩展。 */
  extra: Record<string, unknown>;
}

/** 一个 skill 的完整内存表示。 */
export interface ParsedSkill {
  /** 资源名（= 目录名 = frontmatter.name）。 */
  name: string;
  /** 项目级 / 用户级。 */
  scope: ResourceScope;
  /** skill 目录绝对路径。 */
  dir: string;
  /** SKILL.md 绝对路径。 */
  filePath: string;
  /** SKILL.md 原始内容（含 frontmatter，便于编辑器回填）。 */
  raw: string;
  /** 解析后的 frontmatter。 */
  frontmatter: SkillFrontmatter;
  /** Markdown 正文（去掉 frontmatter 后）。 */
  body: string;
  /** 同目录下的脚本相对路径列表（相对 dir）。 */
  scripts: string[];
  /** 同目录下的附件相对路径列表（相对 dir）。 */
  assets: string[];
  /** 文件 mtime（毫秒），用于热载去抖与状态展示。 */
  mtimeMs: number;
}

/** 加载失败时的错误对象。 */
export interface SkillLoadError {
  name: string;
  scope: ResourceScope;
  dir: string;
  message: string;
}

/** parseSkillDir 的返回类型：成功或失败。 */
export type SkillLoadResult =
  | { ok: true; skill: ParsedSkill }
  | { ok: false; error: SkillLoadError };

/** 列举目录下文件（一层），过滤掉点文件；目录不存在时返回空数组。 */
function listDirShallow(absDir: string): string[] {
  if (!fs.existsSync(absDir)) return [];
  try {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** 把 frontmatter 原始数据归一化为 SkillFrontmatter；缺失或类型错误时抛错。 */
function normalizeFrontmatter(
  raw: Record<string, unknown>,
  expectedName: string,
): SkillFrontmatter {
  const name = raw.name;
  if (typeof name !== 'string' || !isValidResourceName(name)) {
    throw new Error(
      `frontmatter.name 必须为合法资源名（a-zA-Z0-9_-, 1-64）, 实际: ${JSON.stringify(name)}`,
    );
  }
  if (name !== expectedName) {
    throw new Error(
      `frontmatter.name (${name}) 与目录名 (${expectedName}) 不一致；请保持一致以避免引用错位`,
    );
  }
  const description = raw.description;
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('frontmatter.description 必需且不能为空');
  }

  const version = typeof raw.version === 'string' ? raw.version : undefined;

  // allowed-tools 与 allowedTools 二者皆可
  const allowedRaw = raw['allowed-tools'] ?? raw['allowedTools'];
  let allowedTools: string[] | undefined;
  if (allowedRaw !== undefined) {
    if (!Array.isArray(allowedRaw) || allowedRaw.some((v) => typeof v !== 'string')) {
      throw new Error('frontmatter.allowed-tools 必须为字符串数组');
    }
    allowedTools = allowedRaw as string[];
  }

  const enabled = raw.enabled === undefined ? true : raw.enabled === true;

  // 收集未识别字段
  const known = new Set(['name', 'description', 'version', 'allowed-tools', 'allowedTools', 'enabled']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) extra[k] = v;
  }

  return { name, description, version, allowedTools, enabled, extra };
}

/**
 * 解析单个 skill 目录。
 * 失败返回 ok:false 而非抛错——批量扫描时上层需要继续处理其它 skill。
 */
export function parseSkillDir(
  dir: string,
  scope: ResourceScope,
  expectedName?: string,
): SkillLoadResult {
  const name = expectedName ?? path.basename(dir);
  const filePath = path.join(dir, 'SKILL.md');
  try {
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        error: { name, scope, dir, message: '缺少 SKILL.md' },
      };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);

    const parsed = matter(raw);
    const frontmatter = normalizeFrontmatter(
      (parsed.data ?? {}) as Record<string, unknown>,
      name,
    );

    const scriptsDir = path.join(dir, 'scripts');
    const assetsDir = path.join(dir, 'assets');

    return {
      ok: true,
      skill: {
        name,
        scope,
        dir,
        filePath,
        raw,
        frontmatter,
        body: parsed.content ?? '',
        scripts: listDirShallow(scriptsDir),
        assets: listDirShallow(assetsDir),
        mtimeMs: stat.mtimeMs,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        name,
        scope,
        dir,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/**
 * 扫描指定 scope 下的所有 skill 目录。
 * 返回成功项与错误项的并集，由 registry 决定如何呈现给用户。
 */
export function scanSkillsInScope(
  rootDir: string,
  scope: ResourceScope,
): { skills: ParsedSkill[]; errors: SkillLoadError[] } {
  const skills: ParsedSkill[] = [];
  const errors: SkillLoadError[] = [];

  if (!fs.existsSync(rootDir)) return { skills, errors };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (e) {
    errors.push({
      name: '<scan>',
      scope,
      dir: rootDir,
      message: `扫描 skills 根目录失败: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { skills, errors };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (!isValidResourceName(entry.name)) {
      errors.push({
        name: entry.name,
        scope,
        dir: path.join(rootDir, entry.name),
        message: `目录名不合法（仅允许 a-zA-Z0-9_-, 1-64 长度）`,
      });
      continue;
    }

    const result = parseSkillDir(path.join(rootDir, entry.name), scope, entry.name);
    if (result.ok) skills.push(result.skill);
    else errors.push(result.error);
  }

  return { skills, errors };
}

/**
 * 序列化 SkillFrontmatter 回写到 SKILL.md。
 * 保留 body 不变；frontmatter 字段以稳定顺序输出，便于 diff。
 */
export function serializeSkillMarkdown(
  frontmatter: SkillFrontmatter,
  body: string,
): string {
  const ordered: Record<string, unknown> = {
    name: frontmatter.name,
    description: frontmatter.description,
  };
  if (frontmatter.version !== undefined) ordered.version = frontmatter.version;
  if (frontmatter.allowedTools !== undefined) ordered['allowed-tools'] = frontmatter.allowedTools;
  // enabled 仅在显式 false 时写入，保持默认文件干净
  if (frontmatter.enabled === false) ordered.enabled = false;
  for (const [k, v] of Object.entries(frontmatter.extra)) ordered[k] = v;

  return matter.stringify(body, ordered);
}
