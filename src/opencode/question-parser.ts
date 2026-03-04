import { type QuestionInfo } from '../feishu/cards.js';

const skipKeywords = new Set(['跳过', 'skip', 'pass', '忽略']);

export function splitAnswerTokens(text: string): string[] {
  return text
    .split(/[\s,，;；、]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

export function resolveOptionByToken(
  token: string,
  labels: string[],
  labelMap: Map<string, string>
): string | null {
  const cleaned = token.replace(/[\.。、]/g, '').trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  const byLabel = labelMap.get(lower);
  if (byLabel) return byLabel;

  if (/^[a-z]$/i.test(cleaned)) {
    const index = cleaned.toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < labels.length) return labels[index];
  }

  if (/^\d+$/.test(cleaned)) {
    const index = Number.parseInt(cleaned, 10) - 1;
    if (index >= 0 && index < labels.length) return labels[index];
  }

  return null;
}

export function parseQuestionAnswerText(
  text: string,
  question: QuestionInfo
): { type: 'skip' | 'custom' | 'selection'; values?: string[]; custom?: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (skipKeywords.has(lower) || lower.startsWith('跳过')) {
    return { type: 'skip' };
  }

  const labels = question.options.map(opt => opt.label);
  const labelMap = new Map(labels.map(label => [label.toLowerCase(), label]));

  const exactMatch = labelMap.get(trimmed.toLowerCase());
  if (exactMatch) {
    return { type: 'selection', values: [exactMatch] };
  }

  const tokens = splitAnswerTokens(trimmed);
  if (tokens.length === 0) {
    return { type: 'custom', custom: trimmed };
  }

  const matched: string[] = [];
  let hasInvalid = false;

  for (const token of tokens) {
    const resolved = resolveOptionByToken(token, labels, labelMap);
    if (resolved) {
      matched.push(resolved);
    } else {
      hasInvalid = true;
    }
  }

  if (hasInvalid || matched.length === 0) {
    return { type: 'custom', custom: trimmed };
  }

  const unique = Array.from(new Set(matched));
  if (!question.multiple) {
    if (unique.length === 1 && tokens.length === 1) {
      return { type: 'selection', values: unique };
    }
    return { type: 'custom', custom: trimmed };
  }

  return { type: 'selection', values: unique };
}
