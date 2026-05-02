/**
 * Resources Management API Routes
 *
 * REST API endpoints for managing Skills, MCP Servers, Agents, and Providers.
 * Provides CRUD operations, enable/disable toggles, and SSE event streaming.
 *
 * Routes:
 *   Skills:  /api/resources/skills
 *   MCP:     /api/resources/mcp
 *   Agents:  /api/resources/agents
 *   Providers: /api/resources/providers
 *   Events:  /api/resources/events (SSE)
 */

import express from 'express';
import { skillRegistry } from '../../services/resources/skills/registry.js';
import { getMCPRegistry } from '../../services/resources/mcp/manager.js';
import { getAgentRegistry } from '../../services/resources/agents/manager.js';
import { getProviderRegistry } from '../../services/resources/providers/manager.js';
import { onResourceChange } from '../../services/resources/events.js';
import type { ResourceScope } from '../../services/resources/types.js';
import type { SkillSlashCommand } from '../../services/resources/skills/registry.js';
import type { MCPServerConfig, MCPInput } from '../../services/resources/mcp/types.js';
import type { AgentConfig, AgentInput } from '../../services/resources/agents/types.js';
import type { ProviderConfig } from '../../services/resources/providers/types.js';

export function createResourcesRoutes(): express.Router {
  const router = express.Router();

  // ============================================================================
  // STATS ROUTE
  // ============================================================================

  // GET /api/resources/stats - Get resource statistics
  router.get('/stats', (_req, res) => {
    try {
      const skills = skillRegistry.list();
      const mcpRegistry = getMCPRegistry();
      const agentRegistry = getAgentRegistry();
      const providerRegistry = getProviderRegistry();

      const servers = mcpRegistry.list();
      const agents = agentRegistry.list();
      const providers = providerRegistry.list();

      res.json({
        skills: skills.length,
        mcp: servers.length,
        agents: agents.length,
        providers: providers.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get stats:', message);
      res.status(500).json({ error: `Failed to retrieve resource statistics: ${message}` });
    }
  });

  // ============================================================================
  // SKILLS ROUTES
  // ============================================================================

  // GET /api/resources/skills - List all skills
  router.get('/skills', (req, res) => {
    try {
      const scope = req.query.scope as ResourceScope | undefined;
      let skills = skillRegistry.list();

      // Filter by scope if provided
      if (scope === 'project' || scope === 'user') {
        skills = skills.filter((s) => s.scope === scope);
      }

      res.json({ resources: skills });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to list skills:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/skills/:name - Get skill details
  router.get('/skills/:name', (req, res) => {
    try {
      const { name } = req.params;
      const scope = req.query.scope as ResourceScope | undefined;
      const skill = skillRegistry.get(name, scope);

      if (!skill) {
        res.status(404).json({ error: `Skill not found: ${name}` });
        return;
      }

      res.json({ skill });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get skill:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resources/skills - Create new skill
  router.post('/skills', (req, res) => {
    try {
      const { name, markdown, scope } = req.body;

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: name (string required)' });
        return;
      }

      if (!markdown || typeof markdown !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: markdown (string required)' });
        return;
      }

      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      // Parse markdown to extract frontmatter
      const frontmatterMatch = markdown.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
      let frontmatter: Record<string, string | string[] | boolean> = {};
      let body = markdown;

      if (frontmatterMatch) {
        try {
          // Parse YAML frontmatter (simple key-value pairs)
          const fmLines = frontmatterMatch[1].split('\n');
          for (const line of fmLines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
              const key = line.slice(0, colonIndex).trim();
              let value: string = line.slice(colonIndex + 1).trim();

              // Parse boolean values
              if (value === 'true') {
                frontmatter[key] = true;
                continue;
              } else if (value === 'false') {
                frontmatter[key] = false;
                continue;
              }
              // Parse array values
              if (value.startsWith('[') && value.endsWith(']')) {
                const arrValue = value.slice(1, -1).split(',').map((v: string) => v.trim());
                frontmatter[key] = arrValue;
                continue;
              }

              frontmatter[key] = value;
            }
          }
        } catch (e) {
          console.warn('[Resources API] Failed to parse frontmatter, using defaults');
        }
        body = frontmatterMatch[2];
      }

      const skill = skillRegistry.create({
        name,
        scope: resourceScope,
        frontmatter: {
          description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
          version: typeof frontmatter.version === 'string' ? frontmatter.version : undefined,
          allowedTools: Array.isArray(frontmatter.allowedTools) ? frontmatter.allowedTools : undefined,
          enabled: typeof frontmatter.enabled === 'boolean' ? frontmatter.enabled : true,
          extra: frontmatter,
        },
        body,
      });

      res.status(201).json({ skill });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to create skill:', message);
      const skillName = req.body.name as string | undefined;
      if (message.includes('already exists') || message.includes('duplicate')) {
        res.status(409).json({ error: `Skill "${skillName || 'unknown'}" already exists` });
      } else {
        res.status(500).json({ error: `Failed to create skill: ${message}` });
      }
    }
  });

  // PUT /api/resources/skills/:name - Update skill
  router.put('/skills/:name', (req, res) => {
    try {
      const { name } = req.params;
      const { markdown, scope } = req.body;

      if (!markdown || typeof markdown !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: markdown (string required)' });
        return;
      }

      const resourceScope: ResourceScope | undefined = scope === 'user' || scope === 'project' ? scope : undefined;

      // Parse markdown to extract frontmatter
      const frontmatterMatch = markdown.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
      let frontmatter: Record<string, string | string[] | boolean> = {};
      let body = markdown;

      if (frontmatterMatch) {
        try {
          const fmLines = frontmatterMatch[1].split('\n');
          for (const line of fmLines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
              const key = line.slice(0, colonIndex).trim();
              let value: string = line.slice(colonIndex + 1).trim();

              if (value === 'true') {
                frontmatter[key] = true;
                continue;
              } else if (value === 'false') {
                frontmatter[key] = false;
                continue;
              }
              if (value.startsWith('[') && value.endsWith(']')) {
                const arrValue = value.slice(1, -1).split(',').map((v: string) => v.trim());
                frontmatter[key] = arrValue;
                continue;
              }

              frontmatter[key] = value;
            }
          }
        } catch (e) {
          console.warn('[Resources API] Failed to parse frontmatter');
        }
        body = frontmatterMatch[2];
      }

      const skill = skillRegistry.update({
        name,
        scope: resourceScope,
        frontmatter: {
          description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
          version: typeof frontmatter.version === 'string' ? frontmatter.version : undefined,
          allowedTools: Array.isArray(frontmatter.allowedTools) ? frontmatter.allowedTools : undefined,
          enabled: typeof frontmatter.enabled === 'boolean' ? frontmatter.enabled : undefined,
          extra: frontmatter,
        },
        body,
      });

      res.json({ skill });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to update skill:', message);
      const skillName = req.params.name;
      if (message.includes('not found')) {
        res.status(404).json({ error: `Skill "${skillName}" not found` });
      } else {
        res.status(500).json({ error: `Failed to update skill: ${message}` });
      }
    }
  });

  // DELETE /api/resources/skills/:name - Delete skill
  router.delete('/skills/:name', (req, res) => {
    try {
      const { name } = req.params;
      const scope = req.query.scope as ResourceScope | undefined;

      skillRegistry.delete(name, scope);

      res.json({ ok: true, message: `Skill "${name}" deleted` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to delete skill:', message);
      const skillName = req.params.name;
      if (message.includes('not found')) {
        res.status(404).json({ error: `Skill "${skillName}" not found` });
      } else if (message.includes('built-in') || message.includes('system')) {
        res.status(403).json({ error: `Cannot delete built-in skill "${skillName}"` });
      } else {
        res.status(500).json({ error: `Failed to delete skill: ${message}` });
      }
    }
  });

  // POST /api/resources/skills/:name/toggle - Enable/disable skill
  router.post('/skills/:name/toggle', (req, res) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;
      const scope = req.query.scope as ResourceScope | undefined;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Missing or invalid field: enabled (boolean required)' });
        return;
      }

      const skill = skillRegistry.toggle(name, enabled, scope);

      res.json({ skill, message: `Skill "${name}" ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to toggle skill:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/skills/slash - List all slash commands
  router.get('/skills/slash', (_req, res) => {
    try {
      const commands: SkillSlashCommand[] = skillRegistry.listSlashCommands();
      res.json({ commands });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to list slash commands:', message);
      res.status(500).json({ error: message });
    }
  });

  // ============================================================================
  // MCP ROUTES
  // ============================================================================

  // GET /api/resources/mcp - List all MCP servers
  router.get('/mcp', (req, res) => {
    try {
      const scope = req.query.scope as ResourceScope | undefined;
      const mcpRegistry = getMCPRegistry();
      let servers = mcpRegistry.list();

      // Filter by scope if provided
      if (scope === 'project' || scope === 'user') {
        servers = servers.filter((s) => s.scope === scope);
      }

      res.json({ resources: servers });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to list MCP servers:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/mcp/:name - Get MCP server details
  router.get('/mcp/:name', (req, res) => {
    try {
      const { name } = req.params;
      const scope = req.query.scope as ResourceScope | undefined;

      const mcpRegistry = getMCPRegistry();
      const server = mcpRegistry.get(name, scope);

      if (!server) {
        res.status(404).json({ error: `MCP server not found: ${name}` });
        return;
      }

      res.json({ server });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get MCP server:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resources/mcp - Create MCP server
  router.post('/mcp', async (req, res) => {
    try {
      const { name, transport, description, enabled, scope } = req.body;

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: name (string required)' });
        return;
      }

      if (!transport || !['stdio', 'sse', 'http'].includes(transport)) {
        res.status(400).json({ error: 'Missing or invalid field: transport (must be stdio, sse, or http)' });
        return;
      }

      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      const mcpRegistry = getMCPRegistry();

      // Add transport-specific fields
      let input: MCPInput;

      if (transport === 'stdio') {
        if (!req.body.command || typeof req.body.command !== 'string') {
          res.status(400).json({ error: 'Missing or invalid field: command (required for stdio transport)' });
          return;
        }
        input = {
          transport,
          command: req.body.command,
          args: req.body.args,
          cwd: req.body.cwd,
          env: req.body.env,
          description,
          enabled: enabled !== undefined ? enabled : true,
        } as MCPInput;
      } else if (transport === 'sse') {
        if (!req.body.url || typeof req.body.url !== 'string') {
          res.status(400).json({ error: 'Missing or invalid field: url (required for sse transport)' });
          return;
        }
        input = {
          transport,
          url: req.body.url,
          headers: req.body.headers,
          description,
          enabled: enabled !== undefined ? enabled : true,
        } as MCPInput;
      } else {
        if (!req.body.url || typeof req.body.url !== 'string') {
          res.status(400).json({ error: 'Missing or invalid field: url (required for http transport)' });
          return;
        }
        input = {
          transport,
          url: req.body.url,
          headers: req.body.headers,
          description,
          enabled: enabled !== undefined ? enabled : true,
        } as MCPInput;
      }

      const server = await mcpRegistry.create(name, input, resourceScope);

      res.status(201).json({ server });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to create MCP server:', message);
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/resources/mcp/:name - Update MCP server
  router.put('/mcp/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const { transport, description, enabled, scope } = req.body;
      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      const mcpRegistry = getMCPRegistry();

      // Build input based on transport type
      let input: Partial<MCPInput>;

      if (transport === 'stdio') {
        input = {
          transport,
          command: req.body.command,
          args: req.body.args,
          cwd: req.body.cwd,
          env: req.body.env,
          description,
          enabled,
        } as Partial<MCPInput>;
      } else if (transport === 'sse') {
        input = {
          transport,
          url: req.body.url,
          headers: req.body.headers,
          description,
          enabled,
        } as Partial<MCPInput>;
      } else if (transport === 'http') {
        input = {
          transport,
          url: req.body.url,
          headers: req.body.headers,
          description,
          enabled,
        } as Partial<MCPInput>;
      } else {
        input = {
          description,
          enabled,
        };
      }

      const server = await mcpRegistry.update(name, input, resourceScope);

      res.json({ server });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to update MCP server:', message);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/resources/mcp/:name - Delete MCP server
  router.delete('/mcp/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const scope = req.query.scope as ResourceScope | undefined;
      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      const mcpRegistry = getMCPRegistry();
      await mcpRegistry.delete(name, resourceScope);

      res.json({ ok: true, message: `MCP server "${name}" deleted` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to delete MCP server:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resources/mcp/:name/toggle - Enable/disable MCP server
  router.post('/mcp/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;
      const scope = req.query.scope as ResourceScope | undefined;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Missing or invalid field: enabled (boolean required)' });
        return;
      }

      const mcpRegistry = getMCPRegistry();
      const server = await mcpRegistry.toggle(name, enabled, scope);

      res.json({ server, message: `MCP server "${name}" ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to toggle MCP server:', message);
      res.status(500).json({ error: message });
    }
  });

  // ============================================================================
  // AGENTS ROUTES
  // ============================================================================

  // GET /api/resources/agents - List all agents
  router.get('/agents', (req, res) => {
    try {
      const scope = req.query.scope as ResourceScope | undefined;
      const agentRegistry = getAgentRegistry();
      let agents = agentRegistry.list();

      // Filter by scope if provided
      if (scope === 'project' || scope === 'user') {
        agents = agents.filter((a) => a.scope === scope);
      }

      res.json({ resources: agents });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to list agents:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/agents/:name - Get agent details
  router.get('/agents/:name', (req, res) => {
    try {
      const { name } = req.params;
      const scope = req.query.scope as ResourceScope | undefined;

      const agentRegistry = getAgentRegistry();
      const agent = agentRegistry.get(name, scope);

      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${name}` });
        return;
      }

      res.json({ agent });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get agent:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resources/agents - Create agent
  router.post('/agents', async (req, res) => {
    try {
      const { name, description, mode, prompt, tools, model, enabled, scope } = req.body;

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: name (string required)' });
        return;
      }

      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      const agentRegistry = getAgentRegistry();
      const input: AgentInput = {
        description,
        mode,
        prompt,
        tools,
        model,
        enabled: enabled !== undefined ? enabled : true,
      };

      const agent = await agentRegistry.create(name, input, resourceScope);

      res.status(201).json({ agent });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to create agent:', message);
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/resources/agents/:name - Update agent
  router.put('/agents/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const { description, mode, prompt, tools, model, enabled, scope } = req.body;
      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      const agentRegistry = getAgentRegistry();
      const input: Partial<AgentInput> = {
        description,
        mode,
        prompt,
        tools,
        model,
        enabled,
      };

      const agent = await agentRegistry.update(name, input, resourceScope);

      res.json({ agent });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to update agent:', message);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/resources/agents/:name - Delete agent
  router.delete('/agents/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const scope = req.query.scope as ResourceScope | undefined;
      const resourceScope: ResourceScope = scope === 'user' ? 'user' : 'project';

      const agentRegistry = getAgentRegistry();
      await agentRegistry.delete(name, resourceScope);

      res.json({ ok: true, message: `Agent "${name}" deleted` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to delete agent:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resources/agents/:name/toggle - Enable/disable agent
  router.post('/agents/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;
      const scope = req.query.scope as ResourceScope | undefined;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Missing or invalid field: enabled (boolean required)' });
        return;
      }

      const agentRegistry = getAgentRegistry();
      const agent = await agentRegistry.toggle(name, enabled, scope);

      res.json({ agent, message: `Agent "${name}" ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to toggle agent:', message);
      res.status(500).json({ error: message });
    }
  });

  // ============================================================================
  // PROVIDERS ROUTES
  // ============================================================================

  // GET /api/resources/providers - List all providers
  router.get('/providers', (_req, res) => {
    try {
      const providerRegistry = getProviderRegistry();
      const providers = providerRegistry.list();
      res.json({ resources: providers });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to list providers:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/providers/:id - Get provider config
  router.get('/providers/:id', (req, res) => {
    try {
      const { id } = req.params;

      const providerRegistry = getProviderRegistry();
      const provider = providerRegistry.get(id);

      if (!provider) {
        res.status(404).json({ error: `Provider not found: ${id}` });
        return;
      }

      // Don't expose the actual API key
      const sanitized = provider.type === 'api'
        ? { type: 'api', key: provider.key ? '••••••••' : '' }
        : provider;

      res.json({ provider: sanitized });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get provider:', message);
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/resources/providers/:id - Set API key
  router.put('/providers/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { key } = req.body;

      if (!key || typeof key !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: key (string required)' });
        return;
      }

      const providerRegistry = getProviderRegistry();
      await providerRegistry.setKey(id, key);

      res.json({ ok: true, message: `Provider "${id}" API key updated` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to set provider key:', message);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/resources/providers/:id - Remove provider
  router.delete('/providers/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const providerRegistry = getProviderRegistry();
      await providerRegistry.removeKey(id);

      res.json({ ok: true, message: `Provider "${id}" removed` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to remove provider:', message);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/resources/providers/refresh - Refresh models cache
  router.post('/providers/refresh', async (req, res) => {
    try {
      const providerRegistry = getProviderRegistry();
      await providerRegistry.refreshModels();

      res.json({ ok: true, message: 'Provider models cache refreshed' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to refresh provider models:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/providers/:id/models - Get models for provider
  router.get('/providers/:id/models', (req, res) => {
    try {
      const { id } = req.params;

      const providerRegistry = getProviderRegistry();
      const models = providerRegistry.getModels(id);

      res.json({ providerId: id, models });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get provider models:', message);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/resources/providers/models - Get all models
  router.get('/providers/models', (_req, res) => {
    try {
      const providerRegistry = getProviderRegistry();
      const models = providerRegistry.getAllModels();

      res.json({ models });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to get all models:', message);
      res.status(500).json({ error: message });
    }
  });

  // ============================================================================
  // EVENTS ROUTE (SSE)
  // ============================================================================

  // GET /api/resources/events - SSE endpoint for resource change notifications
  router.get('/events', (req, res) => {
    try {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Send initial connection event
      res.write(`data: ${JSON.stringify({ type: 'connected', at: Date.now() })}\n\n`);

      let keepalive: ReturnType<typeof setInterval> | null = null;

      // Unified cleanup function
      const cleanup = () => {
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
        res.end();
      };

      // Subscribe to resource changes
      const unsubscribe = onResourceChange((event) => {
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (err) {
          // Client disconnected
          console.error('[Resources API] SSE write error:', err);
          unsubscribe();
          cleanup();
        }
      });

      // Handle client disconnect (single event handler)
      req.on('close', () => {
        unsubscribe();
        cleanup();
      });

      // Send keepalive comments every 30 seconds
      keepalive = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch (err) {
          console.error('[Resources API] SSE keepalive error:', err);
          unsubscribe();
          cleanup();
        }
      }, 30000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Resources API] Failed to setup SSE:', message);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
