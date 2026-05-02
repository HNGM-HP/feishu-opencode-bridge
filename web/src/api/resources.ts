import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

export type ResourceScope = 'project' | 'user'

export interface ResourceItem {
  name: string
  description?: string
  enabled: boolean
  builtIn: boolean
  status: 'enabled' | 'disabled' | 'error' | 'not_configured'
  error?: string
  scope?: ResourceScope
  [key: string]: any
}

export interface ResourceDetail extends ResourceItem {
  content?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  mode?: string
  model?: string
  apiBase?: string
  apiKey?: string
  defaultModel?: string
  config?: Record<string, any>
  lastModified?: string
  toolCount?: number
  modelCount?: number
}

export interface ResourceStats {
  skills: number
  mcp: number
  agents: number
  providers: number
}

export const resourcesApi = {
  async listResources(type: 'skills' | 'mcp' | 'agents' | 'providers', scope?: ResourceScope): Promise<ResourceItem[]> {
    const params = scope ? { scope } : undefined
    const res = await http.get<{ resources: ResourceItem[] }>(`/resources/${type}`, { params })
    return res.data.resources
  },

  async getResource(type: 'skills' | 'mcp' | 'agents' | 'providers', name: string, scope?: ResourceScope): Promise<ResourceDetail> {
    const params = scope ? { scope } : undefined
    const res = await http.get<ResourceDetail>(`/resources/${type}/${encodeURIComponent(name)}`, { params })
    return res.data
  },

  async createResource(type: 'skills' | 'mcp' | 'agents' | 'providers', data: Record<string, any>): Promise<ResourceDetail> {
    const res = await http.post<{ resource: ResourceDetail }>(`/resources/${type}`, data)
    return res.data.resource
  },

  async updateResource(type: 'skills' | 'mcp' | 'agents' | 'providers', name: string, data: Record<string, any>): Promise<ResourceDetail> {
    const res = await http.put<{ resource: ResourceDetail }>(`/resources/${type}/${encodeURIComponent(name)}`, data)
    return res.data.resource
  },

  async deleteResource(type: 'skills' | 'mcp' | 'agents' | 'providers', name: string, scope?: ResourceScope): Promise<void> {
    const params = scope ? { scope } : undefined
    await http.delete(`/resources/${type}/${encodeURIComponent(name)}`, { params })
  },

  async toggleResource(type: 'skills' | 'mcp' | 'agents' | 'providers', name: string, enabled: boolean, scope?: ResourceScope): Promise<ResourceDetail> {
    const params = scope ? { scope } : undefined
    const res = await http.post<{ resource: ResourceDetail }>(`/resources/${type}/${encodeURIComponent(name)}/toggle`, { enabled }, { params })
    return res.data.resource
  },

  async getStats(): Promise<ResourceStats> {
    const res = await http.get<ResourceStats>('/resources/stats')
    return res.data
  },

  // Provider-specific methods
  async setApiKey(id: string, key: string): Promise<void> {
    await http.put(`/resources/providers/${encodeURIComponent(id)}`, { key })
  },

  async removeProvider(id: string): Promise<void> {
    await http.delete(`/resources/providers/${encodeURIComponent(id)}`)
  },

  async getModels(id: string): Promise<string[]> {
    const res = await http.get<{ providerId: string; models: string[] }>(`/resources/providers/${encodeURIComponent(id)}/models`)
    return res.data.models
  },

  async refreshModels(): Promise<void> {
    await http.post('/resources/providers/refresh')
  },
}
