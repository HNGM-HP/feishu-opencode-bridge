export const KNOWN_EFFORT_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;

export type EffortLevel = typeof KNOWN_EFFORT_LEVELS[number];

const EFFORT_ALIAS_MAP: Record<string, EffortLevel> = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
  xhigh: 'xhigh',
  fast: 'low',
  balanced: 'high',
  deep: 'xhigh',
};

const KNOWN_EFFORT_LEVEL_SET = new Set<string>(KNOWN_EFFORT_LEVELS);

function normalizeToken(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function normalizeEffortLevel(value: string): EffortLevel | undefined {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return undefined;
  }

  const mapped = EFFORT_ALIAS_MAP[normalized];
  if (mapped) {
    return mapped;
  }

  if (KNOWN_EFFORT_LEVEL_SET.has(normalized)) {
    return normalized as EffortLevel;
  }

  return undefined;
}

export interface PromptEffortPrefixResult {
  text: string;
  effort?: EffortLevel;
}

export function stripPromptEffortPrefix(text: string): PromptEffortPrefixResult {
  const trimmed = text.trim();
  const matched = trimmed.match(/^#([^\s#]+)(?:\s+|$)/u);
  if (!matched) {
    return { text: trimmed };
  }

  const effort = normalizeEffortLevel(matched[1]);
  if (!effort) {
    return { text: trimmed };
  }

  const stripped = trimmed.slice(matched[0].length).trimStart();
  return {
    text: stripped,
    effort,
  };
}
