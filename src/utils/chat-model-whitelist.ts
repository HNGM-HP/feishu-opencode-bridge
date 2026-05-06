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

export interface ChatModelCatalogItem {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
}

export function collectAllowedChatModels(providers: unknown[]): ChatModelCatalogItem[] {
  const items: ChatModelCatalogItem[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    if (!provider || typeof provider !== 'object') {
      continue;
    }

    const providerRecord = provider as Record<string, unknown>;
    const providerId = typeof providerRecord.id === 'string' ? providerRecord.id.trim() : '';
    if (!providerId) {
      continue;
    }

    const providerName = typeof providerRecord.name === 'string' && providerRecord.name.trim()
      ? providerRecord.name.trim()
      : providerId;

    const rawModels = providerRecord.models;
    if (Array.isArray(rawModels)) {
      for (const rawModel of rawModels) {
        if (!rawModel || typeof rawModel !== 'object') {
          continue;
        }

        const modelRecord = rawModel as Record<string, unknown>;
        const modelId = typeof modelRecord.id === 'string' ? modelRecord.id.trim() : '';
        if (!modelId || !isChatModelAllowed(providerId, modelId)) {
          continue;
        }

        const key = buildChatModelWhitelistKey(providerId, modelId);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        items.push({
          providerId,
          providerName,
          modelId,
          modelName: typeof modelRecord.name === 'string' && modelRecord.name.trim()
            ? modelRecord.name.trim()
            : modelId,
        });
      }
      continue;
    }

    if (!rawModels || typeof rawModels !== 'object') {
      continue;
    }

    const modelMap = rawModels as Record<string, unknown>;
    for (const [modelKey, rawModel] of Object.entries(modelMap)) {
      const modelRecord = rawModel && typeof rawModel === 'object'
        ? rawModel as Record<string, unknown>
        : undefined;
      const modelId = typeof modelRecord?.id === 'string' && modelRecord.id.trim()
        ? modelRecord.id.trim()
        : modelKey.trim();
      if (!modelId || !isChatModelAllowed(providerId, modelId)) {
        continue;
      }

      const key = buildChatModelWhitelistKey(providerId, modelId);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      items.push({
        providerId,
        providerName,
        modelId,
        modelName: typeof modelRecord?.name === 'string' && modelRecord.name.trim()
          ? modelRecord.name.trim()
          : modelId,
      });
    }
  }

  return items;
}

export function findAllowedChatModel(
  providers: unknown[],
  rawInput: string | undefined
): ChatModelCatalogItem | null {
  const normalized = typeof rawInput === 'string' ? rawInput.trim().toLowerCase() : '';
  if (!normalized) {
    return null;
  }

  const models = collectAllowedChatModels(providers);
  return models.find(model => {
    const candidates = [
      `${model.providerId}:${model.modelId}`,
      `${model.providerId}/${model.modelId}`,
      model.modelId,
      model.modelName,
    ];

    return candidates.some(candidate => candidate.trim().toLowerCase() === normalized);
  }) || null;
}
