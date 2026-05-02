import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  assertValidResourceName,
  ensureAllProjectDirs,
  ensureResourceDir,
  getProjectDataRoot,
  getResourceDir,
  getResourceDirs,
  getUserDataRoot,
  isValidResourceName,
  locateResource,
} from '../../../src/services/resources/paths.js';

const TMP_PREFIX = path.join(os.tmpdir(), 'opencode-bridge-paths-test-');

describe('resources/paths', () => {
  let projectRoot: string;
  let userRoot: string;
  let originalProj: string | undefined;
  let originalUser: string | undefined;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(TMP_PREFIX + 'proj-');
    userRoot = fs.mkdtempSync(TMP_PREFIX + 'user-');
    originalProj = process.env.OPENCODE_BRIDGE_DATA_ROOT;
    originalUser = process.env.OPENCODE_BRIDGE_USER_DATA_ROOT;
    process.env.OPENCODE_BRIDGE_DATA_ROOT = projectRoot;
    process.env.OPENCODE_BRIDGE_USER_DATA_ROOT = userRoot;
  });

  afterEach(() => {
    if (originalProj === undefined) delete process.env.OPENCODE_BRIDGE_DATA_ROOT;
    else process.env.OPENCODE_BRIDGE_DATA_ROOT = originalProj;
    if (originalUser === undefined) delete process.env.OPENCODE_BRIDGE_USER_DATA_ROOT;
    else process.env.OPENCODE_BRIDGE_USER_DATA_ROOT = originalUser;
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(userRoot, { recursive: true, force: true });
  });

  it('resolves project & user roots from env', () => {
    expect(getProjectDataRoot()).toBe(path.resolve(projectRoot));
    expect(getUserDataRoot()).toBe(path.resolve(userRoot));
  });

  it('maps each kind to the correct subdirectory', () => {
    expect(getResourceDir('skill', 'project')).toBe(path.join(projectRoot, 'skills'));
    expect(getResourceDir('mcp', 'user')).toBe(path.join(userRoot, 'mcp'));
    expect(getResourceDir('agents', 'project')).toBe(path.join(projectRoot, 'agents'));
    expect(getResourceDir('provider', 'user')).toBe(path.join(userRoot, 'providers'));

    const both = getResourceDirs('skill');
    expect(both.project).toBe(path.join(projectRoot, 'skills'));
    expect(both.user).toBe(path.join(userRoot, 'skills'));
  });

  it('creates project dirs idempotently', () => {
    const skillsDir = getResourceDir('skill', 'project');
    expect(fs.existsSync(skillsDir)).toBe(false);
    expect(ensureResourceDir('skill', 'project')).toBe(true);
    expect(fs.existsSync(skillsDir)).toBe(true);
    expect(ensureResourceDir('skill', 'project')).toBe(false); // already exists

    ensureAllProjectDirs();
    for (const sub of ['skills', 'mcp', 'agents', 'providers']) {
      expect(fs.existsSync(path.join(projectRoot, sub))).toBe(true);
    }
  });

  it('locateResource prefers project scope over user scope', () => {
    const projDir = getResourceDir('mcp', 'project');
    const userDir = getResourceDir('mcp', 'user');
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(userDir, { recursive: true });

    fs.writeFileSync(path.join(userDir, 'github.json'), '{}');
    expect(locateResource('mcp', 'github.json')).toEqual({
      scope: 'user',
      absPath: path.join(userDir, 'github.json'),
    });

    fs.writeFileSync(path.join(projDir, 'github.json'), '{}');
    expect(locateResource('mcp', 'github.json')).toEqual({
      scope: 'project',
      absPath: path.join(projDir, 'github.json'),
    });

    expect(locateResource('mcp', 'missing.json')).toBeNull();
  });

  it('validates resource names', () => {
    expect(isValidResourceName('my-skill_1')).toBe(true);
    expect(isValidResourceName('a')).toBe(true);
    expect(isValidResourceName('')).toBe(false);
    expect(isValidResourceName('has space')).toBe(false);
    expect(isValidResourceName('../escape')).toBe(false);
    expect(isValidResourceName('a'.repeat(65))).toBe(false);

    expect(() => assertValidResourceName('ok-1')).not.toThrow();
    expect(() => assertValidResourceName('../bad')).toThrow(/Invalid resource name/);
  });
});
