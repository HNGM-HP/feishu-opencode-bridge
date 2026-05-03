import { modelConfig } from '../config.js';

function normalizePart(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function buildChatModelWhitelistKey(providerId: string, modelId: string): string {
  return `${normalizePart(providerId)}/${normalizePart(modelId)}`;
}

export function getChatModelWhitelistSet(): Set<string> {
  return new Set(
    modelConfig.chatModelWhitelist
      .map(item => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function hasChatModelWhitelist(): boolean {
  return getChatModelWhitelistSet().size > 0;
}

export function isChatModelAllowed(
  providerId: string,
  modelId: string,
  whitelist: Set<string> = getChatModelWhitelistSet()
): boolean {
  if (whitelist.size === 0) {
    return true;
  }
  return whitelist.has(buildChatModelWhitelistKey(providerId, modelId));
}

export function parseChatModelReference(raw: string | undefined): { providerId: string; modelId: string } | null {
  const normalized = typeof raw === 'string' ? raw.trim() : '';
  if (!normalized) {
    return null;
  }

  const separator = normalized.includes(':') ? ':' : normalized.includes('/') ? '/' : '';
  if (!separator) {
    return null;
  }

  const index = normalized.indexOf(separator);
  if (index <= 0 || index === normalized.length - 1) {
    return null;
  }

  const providerId = normalized.slice(0, index).trim();
  const modelId = normalized.slice(index + 1).trim();
  if (!providerId || !modelId) {
    return null;
  }

  return { providerId, modelId };
}
