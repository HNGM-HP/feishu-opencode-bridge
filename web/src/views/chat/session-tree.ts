import type { ChatSessionSummary } from '../../api'

export interface SessionTreeNodeData {
  id: string
  type: 'folder' | 'session'
  label: string
  directory?: string
  directoryLabel?: string
  updatedAt?: number
  count: number
  session?: ChatSessionSummary
  children: SessionTreeNodeData[]
}
