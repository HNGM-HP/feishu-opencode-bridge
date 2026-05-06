/**
 * CLI Resource Management Commands
 *
 * Implements `bridge resource` subcommands for managing:
 *   - Skills (list, create, edit, delete, enable, disable)
 *   - MCP Servers (list, add, edit, delete, enable, disable)
 *   - Agents (list, create, edit, delete)
 *   - Model Providers (list, set-key, remove-key, models, refresh)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

import { skillRegistry } from '../../services/resources/skills/registry.js';
import { getMCPRegistry } from '../../services/resources/mcp/manager.js';
import { getAgentRegistry } from '../../services/resources/agents/manager.js';
import { getProviderRegistry } from '../../services/resources/providers/manager.js';
import { initResourceSystem } from '../../services/resources/index.js';
import type { ResourceScope } from '../../services/resources/types.js';

/**
 * Parse scope from string or default to 'project'
 */
function parseScope(scope?: string): ResourceScope {
  if (scope === 'user' || scope === 'project') {
    return scope;
  }
  return 'project';
}

/**
 * Launch editor for file
 */
async function launchEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
  const editorArgs = editor.split(' ');
  const editorCmd = editorArgs[0];
  const editorParams = [...editorArgs.slice(1), filePath];

  console.log(`Launching editor: ${editor} ${filePath}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(editorCmd, editorParams, {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Ensure resource system is initialized
 */
async function ensureInitialized(): Promise<void> {
  const { isResourceSystemInitialized } = await import('../../services/resources/index.js');
  if (!isResourceSystemInitialized()) {
    await initResourceSystem();
  }
}

// ============================================================================
// Skills Commands
// ============================================================================

/**
 * List all skills
 */
export async function skillList(): Promise<void> {
  await ensureInitialized();
  const skills = skillRegistry.list();

  if (skills.length === 0) {
    console.log('No skills found.');
    return;
  }

  console.log('\nSkills:\n');
  console.table(
    skills.map((s) => ({
      Name: s.name,
      Scope: s.scope,
      Status: s.status,
      Enabled: s.enabled ? '✓' : '✗',
      Shadowed: s.shadowed ? '(shadowed)' : '',
      Description: s.description || '',
    }))
  );
}

/**
 * Create a new skill
 */
export async function skillCreate(
  name: string,
  options: {
    markdown?: string;
    scope?: string;
    description?: string;
    enabled?: boolean;
  }
): Promise<void> {
  await ensureInitialized();

  const scope = parseScope(options.scope);

  // Read markdown from file if provided
  let body = '';
  if (options.markdown) {
    body = await fs.readFile(options.markdown, 'utf-8');
  }

  const skill = skillRegistry.create({
    name,
    scope,
    frontmatter: {
      description: options.description || '',
      version: '1.0.0',
      enabled: options.enabled ?? true,
    },
    body,
  });

  console.log(`✓ Skill "${name}" created at ${skill.dir}`);
}

/**
 * Edit a skill (opens in editor)
 */
export async function skillEdit(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const skill = skillRegistry.get(name, scope);

  if (!skill) {
    console.error(`Skill "${name}" not found${scope ? ` in ${scope} scope` : ''}`);
    process.exit(1);
  }

  await launchEditor(skill.filePath);
  console.log(`✓ Skill "${name}" edited. Changes will be hot-reloaded.`);
}

/**
 * Delete a skill
 */
export async function skillDelete(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  skillRegistry.delete(name, scope);

  console.log(`✓ Skill "${name}" deleted.`);
}

/**
 * Enable a skill
 */
export async function skillEnable(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  skillRegistry.toggle(name, true, scope);

  console.log(`✓ Skill "${name}" enabled.`);
}

/**
 * Disable a skill
 */
export async function skillDisable(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  skillRegistry.toggle(name, false, scope);

  console.log(`✓ Skill "${name}" disabled.`);
}

// ============================================================================
// MCP Commands
// ============================================================================

/**
 * List all MCP servers
 */
export async function mcpList(): Promise<void> {
  await ensureInitialized();
  const registry = getMCPRegistry();
  const servers = registry.list();

  if (servers.length === 0) {
    console.log('No MCP servers found.');
    return;
  }

  console.log('\nMCP Servers:\n');
  console.table(
    servers.map((s) => ({
      Name: s.name,
      Scope: s.scope,
      Transport: s.transport,
      Enabled: s.enabled ? '✓' : '✗',
      Valid: s.valid ? '✓' : '✗',
      Shadowed: s.shadowed ? '(shadowed)' : '',
      Description: s.description || '',
      Error: s.error || '',
    }))
  );
}

/**
 * Add a new MCP server
 */
export async function mcpAdd(
  name: string,
  options: {
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    url?: string;
    scope?: string;
    description?: string;
    enabled?: boolean;
  }
): Promise<void> {
  await ensureInitialized();

  const scope = parseScope(options.scope);
  const registry = getMCPRegistry();

  let input: any = {
    description: options.description,
    enabled: options.enabled ?? true,
    transport: options.transport,
  };

  if (options.transport === 'stdio') {
    if (!options.command) {
      console.error('stdio transport requires --command');
      process.exit(1);
    }
    input.command = options.command;
  } else {
    if (!options.url) {
      console.error(`${options.transport} transport requires --url`);
      process.exit(1);
    }
    input.url = options.url;
  }

  const config = await registry.create(name, input, scope);
  console.log(`✓ MCP server "${name}" created at ${scope} layer`);
  console.log(`  Transport: ${config.transport}`);
}

/**
 * Edit an MCP server (opens in editor)
 */
export async function mcpEdit(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const registry = getMCPRegistry();
  const config = registry.get(name, scope);

  if (!config) {
    console.error(`MCP server "${name}" not found${scope ? ` in ${scope} scope` : ''}`);
    process.exit(1);
  }

  const dir = (await import('../../services/resources/paths.js')).getResourceDir('mcp', scope || 'project');
  const filePath = path.join(dir, `${name}.json`);

  await launchEditor(filePath);
  console.log(`✓ MCP server "${name}" edited. Changes will be hot-reloaded.`);
}

/**
 * Delete an MCP server
 */
export async function mcpDelete(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const registry = getMCPRegistry();
  await registry.delete(name, scope || 'project');

  console.log(`✓ MCP server "${name}" deleted.`);
}

/**
 * Enable an MCP server
 */
export async function mcpEnable(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const registry = getMCPRegistry();
  await registry.toggle(name, true, scope);

  console.log(`✓ MCP server "${name}" enabled.`);
}

/**
 * Disable an MCP server
 */
export async function mcpDisable(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const registry = getMCPRegistry();
  await registry.toggle(name, false, scope);

  console.log(`✓ MCP server "${name}" disabled.`);
}

// ============================================================================
// Agent Commands
// ============================================================================

/**
 * List all agents
 */
export async function agentList(): Promise<void> {
  await ensureInitialized();
  const registry = getAgentRegistry();
  const agents = registry.list();

  if (agents.length === 0) {
    console.log('No agents found.');
    return;
  }

  console.log('\nAgents:\n');
  console.table(
    agents.map((a) => ({
      Name: a.name,
      Scope: a.scope,
      Mode: a.mode || '-',
      Enabled: a.enabled ? '✓' : '✗',
      Valid: a.valid ? '✓' : '✗',
      Shadowed: a.shadowed ? '(shadowed)' : '',
      Description: a.description || '',
      Error: a.error || '',
    }))
  );
}

/**
 * Create a new agent
 */
export async function agentCreate(
  name: string,
  options: {
    mode?: 'primary' | 'subagent' | 'all';
    prompt?: string;
    scope?: string;
    description?: string;
    enabled?: boolean;
  }
): Promise<void> {
  await ensureInitialized();

  const scope = parseScope(options.scope);
  const registry = getAgentRegistry();

  const config = await registry.create(name, {
    description: options.description,
    mode: options.mode,
    prompt: options.prompt,
    enabled: options.enabled ?? true,
  }, scope);

  console.log(`✓ Agent "${name}" created at ${scope} layer`);
  if (config.mode) {
    console.log(`  Mode: ${config.mode}`);
  }
}

/**
 * Edit an agent (opens in editor)
 */
export async function agentEdit(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const registry = getAgentRegistry();
  const config = registry.get(name, scope);

  if (!config) {
    console.error(`Agent "${name}" not found${scope ? ` in ${scope} scope` : ''}`);
    process.exit(1);
  }

  const dir = (await import('../../services/resources/paths.js')).getResourceDir('agents', scope || 'project');
  const filePath = path.join(dir, `${name}.json`);

  await launchEditor(filePath);
  console.log(`✓ Agent "${name}" edited. Changes will be hot-reloaded.`);
}

/**
 * Delete an agent
 */
export async function agentDelete(name: string, options: { scope?: string }): Promise<void> {
  await ensureInitialized();

  const scope = options.scope ? parseScope(options.scope) : undefined;
  const registry = getAgentRegistry();
  await registry.delete(name, scope || 'project');

  console.log(`✓ Agent "${name}" deleted.`);
}

// ============================================================================
// Model/Provider Commands
// ============================================================================

/**
 * List all providers
 */
export async function modelProviders(): Promise<void> {
  await ensureInitialized();
  const registry = getProviderRegistry();
  const providers = registry.list();

  if (providers.length === 0) {
    console.log('No providers found.');
    return;
  }

  console.log('\nProviders:\n');
  console.table(
    providers.map((p) => ({
      ID: p.providerId,
      Name: p.displayName || p.providerId,
      Type: p.type,
      Configured: p.configured ? '✓' : '✗',
      Editable: p.editable ? '✓' : '✗',
    }))
  );
}

/**
 * Set API key for a provider
 */
export async function modelSetKey(providerId: string, apiKey: string): Promise<void> {
  await ensureInitialized();
  const registry = getProviderRegistry();

  await registry.setKey(providerId, apiKey);
  console.log(`✓ API key set for provider "${providerId}"`);
}

/**
 * Remove API key for a provider
 */
export async function modelRemoveKey(providerId: string): Promise<void> {
  await ensureInitialized();
  const registry = getProviderRegistry();

  await registry.removeKey(providerId);
  console.log(`✓ API key removed for provider "${providerId}"`);
}

/**
 * Show models for a provider or all models
 */
export async function modelModels(providerId?: string): Promise<void> {
  await ensureInitialized();
  const registry = getProviderRegistry();

  if (providerId) {
    const models = registry.getModels(providerId);
    if (models.length === 0) {
      console.log(`No models found for provider "${providerId}"`);
      return;
    }

    console.log(`\nModels for ${providerId}:\n`);
    models.forEach((m) => console.log(`  ${m}`));
  } else {
    const allModels = registry.getAllModels();
    if (allModels.length === 0) {
      console.log('No models found. Run "opencode-bridge resource model refresh" to fetch models.');
      return;
    }

    console.log('\nAll Models:\n');
    console.table(
      allModels.map((m) => ({
        Provider: m.providerId,
        Model: m.modelId,
        Full: m.fullName,
      }))
    );
  }
}

/**
 * Refresh models cache from OpenCode
 */
export async function modelRefresh(): Promise<void> {
  await ensureInitialized();
  const registry = getProviderRegistry();

  console.log('Refreshing models cache from OpenCode...');
  await registry.refreshModels();
  console.log('✓ Models cache refreshed');

  const allModels = registry.getAllModels();
  const totalProviders = new Set(allModels.map((m) => m.providerId)).size;
  console.log(`  Total: ${allModels.length} models from ${totalProviders} providers`);
}

/**
 * Login to a provider via OAuth using opencode providers login
 */
export async function modelLogin(providerId: string): Promise<void> {
  console.log(`Starting OAuth login flow for provider: ${providerId}`);
  console.log('This will open a browser window for authentication...');

  await new Promise<void>((resolve, reject) => {
    const child = spawn('opencode', ['providers', 'login', providerId], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`✓ Successfully logged in to provider "${providerId}"`);
        resolve();
      } else {
        reject(new Error(`Login failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start login process: ${err.message}`));
    });
  });
}

/**
 * Logout from a provider via OAuth using opencode providers logout
 */
export async function modelLogout(providerId: string): Promise<void> {
  console.log(`Logging out from provider: ${providerId}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('opencode', ['providers', 'logout', providerId], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`✓ Successfully logged out from provider "${providerId}"`);
        resolve();
      } else {
        reject(new Error(`Logout failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start logout process: ${err.message}`));
    });
  });
}
