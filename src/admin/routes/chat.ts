/**
 * Chat Routes Registry
 *
 * Centralizes all /api/chat/* routes for the new native chat UI.
 *
 * Routes:
 * - GET    /api/chat/sessions          - List all sessions
 * - POST   /api/chat/sessions          - Create new session
 * - GET    /api/chat/sessions/:id      - Get session details
 * - DELETE /api/chat/sessions/:id      - Delete session
 * - PATCH  /api/chat/sessions/:id      - Rename session
 * - GET    /api/chat/sessions/:id/messages - Get session messages
 * - POST   /api/chat/sessions/:id/revert - Revert session to a message
 * - POST   /api/chat/sessions/:id/undo - Undo last interaction
 * - POST   /api/chat/sessions/:id/prompt - Send message
 * - POST   /api/chat/sessions/:id/abort - Abort session
 * - GET    /api/chat/events            - SSE event stream
 * - POST   /api/chat/permissions/:id   - Respond to permission request
 */

import { registerChatSessionsRoutes } from './chat-sessions.js';
import { registerChatPromptRoutes } from './chat-prompt.js';
import { registerChatEventsRoutes } from './chat-events.js';
import { registerChatPermissionRoutes } from './chat-permission.js';
import { registerChatAbortRoutes } from './chat-abort.js';
import { registerChatMetaRoutes } from './chat-meta.js';
import { chatEventNormalizer } from '../chat/event-normalizer.js';

export function registerChatRoutes(app: import('express').Application): void {
  chatEventNormalizer.install();
  // Register all chat-related routes
  registerChatSessionsRoutes(app);
  registerChatMetaRoutes(app);
  registerChatPromptRoutes(app);
  registerChatEventsRoutes(app);
  registerChatPermissionRoutes(app);
  registerChatAbortRoutes(app);
}
