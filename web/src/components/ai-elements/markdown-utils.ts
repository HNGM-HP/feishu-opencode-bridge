export interface MarkdownTextSegment {
  id: string
  type: 'markdown'
  content: string
}

export interface MarkdownCodeSegment {
  id: string
  type: 'code'
  code: string
  language?: string
}

export type MarkdownSegment = MarkdownTextSegment | MarkdownCodeSegment

const CODE_FENCE_PATTERN = /```([^\n`]*)\n?([\s\S]*?)```/g

export function escapeHtml(source: string): string {
  return source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function splitMarkdownSegments(source: string): MarkdownSegment[] {
  if (!source) return []

  const segments: MarkdownSegment[] = []
  let match: RegExpExecArray | null
  let lastIndex = 0
  let segmentIndex = 0

  while ((match = CODE_FENCE_PATTERN.exec(source)) !== null) {
    const [fullMatch, info = '', rawCode = ''] = match
    const matchIndex = match.index

    if (matchIndex > lastIndex) {
      segments.push({
        id: `markdown-${segmentIndex++}`,
        type: 'markdown',
        content: source.slice(lastIndex, matchIndex),
      })
    }

    const language = info.trim().split(/\s+/)[0] || undefined
    const code = rawCode.endsWith('\n')
      ? rawCode.slice(0, -1)
      : rawCode

    segments.push({
      id: `code-${segmentIndex++}`,
      type: 'code',
      code,
      language,
    })

    lastIndex = matchIndex + fullMatch.length
  }

  if (lastIndex < source.length) {
    segments.push({
      id: `markdown-${segmentIndex}`,
      type: 'markdown',
      content: source.slice(lastIndex),
    })
  }

  return segments.filter(segment =>
    segment.type === 'code' || segment.content.length > 0
  )
}
