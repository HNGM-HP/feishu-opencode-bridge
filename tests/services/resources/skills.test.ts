import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  parseSkillDir,
  scanSkillsInScope,
  serializeSkillMarkdown,
} from '../../../src/services/resources/skills/loader.js';
import { skillRegistry } from '../../../src/services/resources/skills/registry.js';
import { onResourceChange, clearResourceListeners } from '../../../src/services/resources/events.js';

const TMP_PREFIX = path.join(os.tmpdir(), 'opencode-bridge-skills-test-');

/** 写一个最小可解析的 SKILL.md。 */
function writeSkill(
  dir: string,
  name: string,
  opts: {
    description?: string;
    enabled?: boolean;
    version?: string;
    allowedTools?: string[];
    body?: string;
  } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  const fmLines = [
    '---',
    `name: ${name}`,
    `description: ${opts.description ?? `desc for ${name}`}`,
  ];
  if (opts.version) fmLines.push(`version: ${opts.version}`);
  if (opts.allowedTools) {
    fmLines.push('allowed-tools:');
    for (const t of opts.allowedTools) fmLines.push(`  - ${t}`);
  }
  if (opts.enabled === false) fmLines.push('enabled: false');
  fmLines.push('---', '', opts.body ?? `# ${name}\n\nbody`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), fmLines.join('\n'), 'utf-8');
}

describe('resources/skills/loader', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(TMP_PREFIX + 'load-');
  });
  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('parseSkillDir parses a valid skill', () => {
    const dir = path.join(projectRoot, 'skills', 'hello');
    writeSkill(dir, 'hello', {
      description: 'Greets the user',
      version: '1.0.0',
      allowedTools: ['bash', 'read'],
    });
    const r = parseSkillDir(dir, 'project');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skill.name).toBe('hello');
      expect(r.skill.frontmatter.description).toBe('Greets the user');
      expect(r.skill.frontmatter.version).toBe('1.0.0');
      expect(r.skill.frontmatter.allowedTools).toEqual(['bash', 'read']);
      expect(r.skill.frontmatter.enabled).toBe(true);
      expect(r.skill.body).toContain('# hello');
      expect(r.skill.scope).toBe('project');
    }
  });

  it('parseSkillDir reports missing SKILL.md', () => {
    const dir = path.join(projectRoot, 'skills', 'broken');
    fs.mkdirSync(dir, { recursive: true });
    const r = parseSkillDir(dir, 'project');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/缺少 SKILL.md/);
  });

  it('parseSkillDir rejects mismatched name', () => {
    const dir = path.join(projectRoot, 'skills', 'dirname');
    writeSkill(dir, 'different');
    const r = parseSkillDir(dir, 'project');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/与目录名/);
  });

  it('parseSkillDir requires non-empty description', () => {
    const dir = path.join(projectRoot, 'skills', 'nodescr');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: nodescr\ndescription: ""\n---\nbody',
      'utf-8',
    );
    const r = parseSkillDir(dir, 'project');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/description/);
  });

  it('scanSkillsInScope collects valid + invalid entries', () => {
    const root = path.join(projectRoot, 'skills');
    writeSkill(path.join(root, 'a'), 'a');
    writeSkill(path.join(root, 'b'), 'b', { enabled: false });
    fs.mkdirSync(path.join(root, 'c-broken'), { recursive: true }); // 缺 SKILL.md
    const { skills, errors } = scanSkillsInScope(root, 'project');
    expect(skills.map((s) => s.name).sort()).toEqual(['a', 'b']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.name).toBe('c-broken');
  });

  it('serializeSkillMarkdown round-trips', () => {
    const dir = path.join(projectRoot, 'skills', 'rt');
    writeSkill(dir, 'rt', { description: 'd', allowedTools: ['x'] });
    const r = parseSkillDir(dir, 'project');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const md = serializeSkillMarkdown(r.skill.frontmatter, r.skill.body);
      expect(md).toMatch(/name: rt/);
      expect(md).toMatch(/description: d/);
      expect(md).toMatch(/allowed-tools:/);
    }
  });
});

describe('resources/skills/registry', () => {
  let projectRoot: string;
  let userRoot: string;
  let originalProj: string | undefined;
  let originalUser: string | undefined;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(TMP_PREFIX + 'reg-proj-');
    userRoot = fs.mkdtempSync(TMP_PREFIX + 'reg-user-');
    originalProj = process.env.OPENCODE_BRIDGE_DATA_ROOT;
    originalUser = process.env.OPENCODE_BRIDGE_USER_DATA_ROOT;
    process.env.OPENCODE_BRIDGE_DATA_ROOT = projectRoot;
    process.env.OPENCODE_BRIDGE_USER_DATA_ROOT = userRoot;
    // 强制重置：dispose 可能清空状态，再 init
    await skillRegistry.dispose();
    clearResourceListeners();
  });

  afterEach(async () => {
    await skillRegistry.dispose();
    clearResourceListeners();
    if (originalProj === undefined) delete process.env.OPENCODE_BRIDGE_DATA_ROOT;
    else process.env.OPENCODE_BRIDGE_DATA_ROOT = originalProj;
    if (originalUser === undefined) delete process.env.OPENCODE_BRIDGE_USER_DATA_ROOT;
    else process.env.OPENCODE_BRIDGE_USER_DATA_ROOT = originalUser;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(userRoot, { recursive: true, force: true });
  });

  it('init scans both scopes and project shadows user with same name', () => {
    writeSkill(path.join(userRoot, 'skills', 'shared'), 'shared', { description: 'user-shared' });
    writeSkill(path.join(userRoot, 'skills', 'only-user'), 'only-user', { description: 'only-u' });
    writeSkill(path.join(projectRoot, 'skills', 'shared'), 'shared', { description: 'proj-shared' });

    skillRegistry.init();

    const list = skillRegistry.list();
    const byKey = new Map(list.map((s) => [`${s.scope}:${s.name}`, s]));
    expect(byKey.get('project:shared')!.shadowed).toBe(false);
    expect(byKey.get('user:shared')!.shadowed).toBe(true);
    expect(byKey.get('user:only-user')!.shadowed).toBe(false);

    // get() 默认返回 winning（project）版本
    const winning = skillRegistry.get('shared');
    expect(winning?.scope).toBe('project');
    expect(winning?.frontmatter.description).toBe('proj-shared');

    // 显式取 user 版本
    const userVer = skillRegistry.get('shared', 'user');
    expect(userVer?.frontmatter.description).toBe('user-shared');
  });

  it('listSlashCommands skips disabled and shadowed entries', () => {
    writeSkill(path.join(projectRoot, 'skills', 'a'), 'a');
    writeSkill(path.join(projectRoot, 'skills', 'b'), 'b', { enabled: false });
    writeSkill(path.join(userRoot, 'skills', 'a'), 'a', { description: 'shadowed' });
    writeSkill(path.join(userRoot, 'skills', 'c'), 'c');

    skillRegistry.init();
    const cmds = skillRegistry.listSlashCommands();
    const commandNames = cmds.map((c) => c.command).sort();
    expect(commandNames).toEqual(['/skill:a', '/skill:c']);
    const a = cmds.find((c) => c.command === '/skill:a')!;
    expect(a.scope).toBe('project'); // shadowed user 版本被跳过
  });

  it('create + update + delete + emit events', () => {
    skillRegistry.init();
    const events: string[] = [];
    onResourceChange((e) => {
      events.push(`${e.action}:${e.name ?? '*'}`);
    });

    const created = skillRegistry.create({
      name: 'new-one',
      frontmatter: { description: 'fresh', enabled: true },
      body: '# body',
    });
    expect(created.scope).toBe('project');
    expect(fs.existsSync(path.join(projectRoot, 'skills', 'new-one', 'SKILL.md'))).toBe(true);

    const updated = skillRegistry.update({
      name: 'new-one',
      frontmatter: { description: 'edited', enabled: false },
    });
    expect(updated.frontmatter.description).toBe('edited');
    expect(updated.frontmatter.enabled).toBe(false);

    skillRegistry.delete('new-one');
    expect(fs.existsSync(path.join(projectRoot, 'skills', 'new-one'))).toBe(false);

    expect(events).toContain('add:new-one');
    expect(events).toContain('update:new-one');
    expect(events).toContain('remove:new-one');
  });

  it('toggle flips enabled flag and rewrites file', () => {
    writeSkill(path.join(projectRoot, 'skills', 'tog'), 'tog');
    skillRegistry.init();
    const before = skillRegistry.get('tog');
    expect(before?.frontmatter.enabled).toBe(true);

    skillRegistry.toggle('tog', false);
    const after = skillRegistry.get('tog');
    expect(after?.frontmatter.enabled).toBe(false);

    // 文件中应已写入 enabled: false
    const md = fs.readFileSync(path.join(projectRoot, 'skills', 'tog', 'SKILL.md'), 'utf-8');
    expect(md).toMatch(/enabled: false/);
  });

  it('rejects creating duplicate skill in same scope', () => {
    writeSkill(path.join(projectRoot, 'skills', 'dup'), 'dup');
    skillRegistry.init();
    expect(() =>
      skillRegistry.create({
        name: 'dup',
        frontmatter: { description: 'x', enabled: true },
        body: '',
      }),
    ).toThrow(/已存在/);
  });

  it('rejects invalid resource name on create', () => {
    skillRegistry.init();
    expect(() =>
      skillRegistry.create({
        name: '../escape',
        frontmatter: { description: 'x', enabled: true },
        body: '',
      }),
    ).toThrow(/Invalid resource name/);
  });
});
