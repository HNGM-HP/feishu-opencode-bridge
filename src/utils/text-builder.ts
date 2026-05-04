/**
 * 文本构建工具
 *
 * 用于各平台的文本格式化
 */

import type { StreamCardData } from '../feishu/cards-stream.js';
import { outputConfig } from '../config.js';

/**
 * 构建 Telegram 纯文本格式（不含 MarkdownV2 特殊字符）
 */
export function buildTelegramText(data: StreamCardData, showThinking: boolean = true): string {
  const mainText = data.text.trim();
  const thinkingText = showThinking ? data.thinking.trim() : '';

  if (mainText && thinkingText) {
    const clippedThinking = thinkingText.length > 1400
      ? `${thinkingText.slice(0, 1400)}\n...(思考内容已截断)`
      : thinkingText;
    return [
      '💭 思考过程：',
      clippedThinking,
      '',
      '📝 回复：',
      mainText,
    ].join('\n');
  }

  if (mainText) {
    return mainText;
  }

  if (thinkingText) {
    const clippedThinking = thinkingText.length > 1400
      ? `${thinkingText.slice(0, 1400)}\n...(思考内容已截断)`
      : thinkingText;
    return [
      '💭 思考过程：',
      clippedThinking,
      '',
      '⏳ 正在生成回复...',
    ].join('\n');
  }

  if (data.status === 'failed') {
    return '❌ 执行失败';
  }

  if (data.status === 'completed') {
    return '✅ 已完成';
  }

  return '⏳ 正在处理...';
}

/**
 * 构建可移植更新文本（Discord/Wecom 等平台）
 */
export function buildPortableUpdateText(data: StreamCardData, showThinking: boolean = true): string {
  const mainText = data.text.trim();
  const thinkingText = showThinking ? data.thinking.trim() : '';

  if (mainText && thinkingText) {
    const safeThinking = thinkingText.replace(/```/g, '` ` `');
    const clippedThinking = safeThinking.length > 1400
      ? `${safeThinking.slice(0, 1400)}\n...(思考内容已截断)`
      : safeThinking;
    return [
      '-----------',
      '```md',
      clippedThinking,
      '```',
      '-----------',
      mainText,
    ].join('\n');
  }

  if (mainText) {
    return `-----------\n${mainText}`;
  }

  if (thinkingText) {
    const safeThinking = thinkingText.replace(/```/g, '` ` `');
    const clippedThinking = safeThinking.length > 1400
      ? `${safeThinking.slice(0, 1400)}\n...(思考内容已截断)`
      : safeThinking;
    return [
      '-----------',
      '```md',
      clippedThinking,
      '```',
      '-----------',
      '⏳ 正在处理...',
    ].join('\n');
  }

  if (data.status === 'failed') {
    return '❌ 执行失败';
  }

  if (data.status === 'completed') {
    return '✅ 已完成';
  }

  return '⏳ 正在处理...';
}

function normalizeSegmentText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function uniqueOrderedTexts(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizeSegmentText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildQQSegmentText(
  data: StreamCardData,
  type: 'reasoning' | 'text',
  fallback: string
): string {
  const segmentTexts = uniqueOrderedTexts(
    (data.segments ?? [])
      .filter((segment): segment is Extract<NonNullable<StreamCardData['segments']>[number], { type: 'reasoning' | 'text' }> => segment.type === type)
      .map(segment => segment.text)
  );

  if (segmentTexts.length === 0) {
    return normalizeSegmentText(fallback);
  }

  return segmentTexts.join('\n\n');
}

function stripDuplicatedReasoning(mainText: string, reasoningText: string): string {
  const main = normalizeSegmentText(mainText);
  const reasoning = normalizeSegmentText(reasoningText);

  if (!main || !reasoning) {
    return main;
  }

  if (main === reasoning) {
    return '';
  }

  if (main.startsWith(reasoning)) {
    return main.slice(reasoning.length).trimStart();
  }

  const doubled = `${reasoning}\n\n`;
  if (main.startsWith(doubled)) {
    return main.slice(doubled.length).trimStart();
  }

  const firstIndex = main.indexOf(reasoning);
  if (firstIndex >= 0) {
    const trimmed = `${main.slice(0, firstIndex)}${main.slice(firstIndex + reasoning.length)}`.trim();
    return trimmed;
  }

  return main;
}

function buildQQMarkdownUpdateText(data: StreamCardData, showThinking: boolean = true): string {
  const reasoningText = showThinking ? buildQQSegmentText(data, 'reasoning', data.thinking) : '';
  const mainText = stripDuplicatedReasoning(buildQQSegmentText(data, 'text', data.text), reasoningText);

  if (mainText && reasoningText) {
    const safeThinking = reasoningText.replace(/```/g, '` ` `');
    const clippedThinking = safeThinking.length > 1400
      ? `${safeThinking.slice(0, 1400)}\n...(思考内容已截断)`
      : safeThinking;
    return [
      '**思考过程**',
      clippedThinking,
      '',
      '**回复**',
      mainText,
    ].join('\n');
  }

  if (mainText) {
    return mainText;
  }

  if (reasoningText) {
    const safeThinking = reasoningText.replace(/```/g, '` ` `');
    const clippedThinking = safeThinking.length > 1400
      ? `${safeThinking.slice(0, 1400)}\n...(思考内容已截断)`
      : safeThinking;
    return [
      '**思考过程**',
      clippedThinking,
      '',
      '⏳ 正在处理...',
    ].join('\n');
  }

  if (data.status === 'failed') {
    return '❌ 执行失败';
  }

  if (data.status === 'completed') {
    return '✅ 已完成';
  }

  return '⏳ 正在处理...';
}

function buildQQPlainUpdateText(data: StreamCardData, showThinking: boolean = true): string {
  const reasoningText = showThinking ? buildQQSegmentText(data, 'reasoning', data.thinking) : '';
  const mainText = stripDuplicatedReasoning(buildQQSegmentText(data, 'text', data.text), reasoningText);

  if (mainText && reasoningText) {
    const clippedThinking = reasoningText.length > 1400
      ? `${reasoningText.slice(0, 1400)}\n...(思考内容已截断)`
      : reasoningText;
    return [
      '思考过程：',
      clippedThinking,
      '',
      '回复：',
      mainText,
    ].join('\n');
  }

  if (mainText) {
    return mainText;
  }

  if (reasoningText) {
    const clippedThinking = reasoningText.length > 1400
      ? `${reasoningText.slice(0, 1400)}\n...(思考内容已截断)`
      : reasoningText;
    return [
      '思考过程：',
      clippedThinking,
      '',
      '⏳ 正在处理...',
    ].join('\n');
  }

  if (data.status === 'failed') {
    return '❌ 执行失败';
  }

  if (data.status === 'completed') {
    return '✅ 已完成';
  }

  return '⏳ 正在处理...';
}

/**
 * 可移植更新负载类型
 */
export type PortableUpdatePayload = {
  text: string;
  markdown: string;
  qqText: string;
  telegramText: string;
  discordText: string;
  discordComponents?: Array<{
    type: 'select';
    customId: string;
    placeholder: string;
    options: Array<{ label: string; value: string; description?: string }>;
    minValues?: number;
    maxValues?: number;
  }>;
  buttons?: Array<{ text: string; callback_data: string }>;
};

/**
 * 构建可移植更新负载
 */
export function buildPortableUpdatePayload(
  data: StreamCardData,
  conversationId: string,
  platform: string = 'feishu'
): PortableUpdatePayload {
  const showThinkingChain = platform === 'discord'
    ? outputConfig.discord.showThinkingChain
    : platform === 'feishu'
      ? outputConfig.feishu.showThinkingChain
      : outputConfig.showThinkingChain;
  const showToolChain = platform === 'discord'
    ? outputConfig.discord.showToolChain
    : platform === 'feishu'
      ? outputConfig.feishu.showToolChain
      : outputConfig.showToolChain;

  const filteredSegments = showToolChain && showThinkingChain
    ? data.segments
    : (data.segments ?? []).filter(segment => {
        if (!showToolChain && segment.type === 'tool') return false;
        if (!showThinkingChain && segment.type === 'reasoning') return false;
        return true;
      });

  const filteredData: StreamCardData = {
    ...data,
    segments: filteredSegments,
  };

  if (platform === 'qq') {
    const qqMarkdownText = buildQQMarkdownUpdateText(filteredData, showThinkingChain);
    const qqPlainText = buildQQPlainUpdateText(filteredData, showThinkingChain);

    if (!data.pendingQuestion) {
      return {
        text: qqPlainText,
        markdown: qqMarkdownText,
        qqText: qqPlainText,
        telegramText: qqPlainText,
        discordText: qqMarkdownText,
      };
    }

    const questionLine = `❓ ${data.pendingQuestion.question}`;
    const progressLine = `第 ${data.pendingQuestion.questionIndex + 1}/${data.pendingQuestion.totalQuestions} 题`;
    const qqMarkdownWithQuestion = `${qqMarkdownText}\n${questionLine}\n${progressLine}`;
    const qqPlainWithQuestion = `${qqPlainText}\n\n${questionLine}\n${progressLine}`;

    const optionList = data.pendingQuestion.options
      .filter(option => option.label.trim().length > 0)
      .slice(0, 24)
      .map(option => ({
        label: option.label,
        value: option.label,
        ...(option.description ? { description: option.description } : {}),
      }));

    const options = [...optionList, {
      label: '跳过本题',
      value: '__skip__',
      description: '留空并进入下一题',
    }];

    if (options.length === 0) {
      return {
        text: qqPlainWithQuestion,
        markdown: qqMarkdownWithQuestion,
        qqText: qqPlainWithQuestion,
        telegramText: qqPlainWithQuestion,
        discordText: qqMarkdownWithQuestion,
      };
    }

    const maxValues = data.pendingQuestion.multiple
      ? Math.min(Math.max(1, optionList.length), 25)
      : 1;

    const telegramButtons = optionList.slice(0, 8).map((opt, idx) => ({
      text: opt.label,
      callback_data: `oc_question:${idx}`,
    }));
    if (telegramButtons.length < 8) {
      telegramButtons.push({ text: '跳过本题', callback_data: 'oc_question:skip' });
    }

    return {
      text: qqPlainWithQuestion,
      markdown: qqMarkdownWithQuestion,
      qqText: qqPlainWithQuestion,
      telegramText: qqPlainWithQuestion,
      discordText: qqMarkdownWithQuestion,
      discordComponents: [
        {
          type: 'select',
          customId: `oc_question:${conversationId}`,
          placeholder: '选择当前问题答案',
          options,
          minValues: 1,
          maxValues,
        },
      ],
      buttons: telegramButtons,
    };
  }

  const baseText = buildPortableUpdateText(filteredData, showThinkingChain);
  const telegramBaseText = buildTelegramText(filteredData, showThinkingChain);

  if (!data.pendingQuestion) {
    return { text: baseText, markdown: baseText, qqText: baseText, telegramText: telegramBaseText, discordText: baseText };
  }

  const questionLine = `❓ ${data.pendingQuestion.question}`;
  const progressLine = `第 ${data.pendingQuestion.questionIndex + 1}/${data.pendingQuestion.totalQuestions} 题`;
  const discordText = `${baseText}\n${questionLine}\n${progressLine}`;
  const telegramTextWithQuestion = `${telegramBaseText}\n\n${questionLine}\n${progressLine}`;

  const optionList = data.pendingQuestion.options
    .filter(option => option.label.trim().length > 0)
    .slice(0, 24)
    .map(option => ({
      label: option.label,
      value: option.label,
      ...(option.description ? { description: option.description } : {}),
    }));

  const options = [...optionList, {
    label: '跳过本题',
    value: '__skip__',
    description: '留空并进入下一题',
  }];

  if (options.length === 0) {
    return { text: discordText, markdown: discordText, qqText: discordText, telegramText: telegramTextWithQuestion, discordText };
  }

  const maxValues = data.pendingQuestion.multiple
    ? Math.min(Math.max(1, optionList.length), 25)
    : 1;

  const telegramButtons = optionList.slice(0, 8).map((opt, idx) => ({
    text: opt.label,
    callback_data: `oc_question:${idx}`,
  }));
  if (telegramButtons.length < 8) {
    telegramButtons.push({ text: '跳过本题', callback_data: 'oc_question:skip' });
  }

  return {
    text: discordText,
    markdown: discordText,
    qqText: discordText,
    telegramText: telegramTextWithQuestion,
    discordText,
    discordComponents: [
      {
        type: 'select',
        customId: `oc_question:${conversationId}`,
        placeholder: '选择当前问题答案',
        options,
        minValues: 1,
        maxValues,
      },
    ],
    buttons: telegramButtons,
  };
}
