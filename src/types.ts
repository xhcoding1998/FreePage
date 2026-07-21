export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'

export interface NetworkRecord {
  id: string
  tabId: number
  sessionId: string
  url: string
  method: Method
  type: string
  status?: number
  statusText?: string
  mimeType?: string
  startedAt: number
  finishedAt?: number
  duration?: number
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  requestBody?: string
  responseBody?: string
  responseBodyBytes?: number
  encoded?: boolean
  error?: string
  redirectFrom?: string
  frameId?: string
  isIframe?: boolean
  pageUrl?: string
  pageDomain?: string
  pageTitle?: string
}

export interface OverrideRule {
  id: number
  name: string
  enabled: boolean
  domain: string
  resourceTypes: string[]
  headers: Array<{ operation: 'set' | 'remove'; name: string; value?: string }>
  query: Array<{ operation: 'set' | 'remove'; name: string; value?: string }>
  hits: number
}
