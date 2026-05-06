export function parseEventSeq(lastEventId: string | undefined): number | null {
  const seq = Number.parseInt(lastEventId || '', 10)
  return Number.isFinite(seq) && seq > 0 ? seq : null
}

export function resolveReplaySince(
  currentSessionId: string | null,
  nextSessionId: string,
  lastEventSeq: number | null
): number | null {
  if (currentSessionId !== nextSessionId) {
    return null
  }

  return typeof lastEventSeq === 'number' && lastEventSeq > 0 ? lastEventSeq : null
}
