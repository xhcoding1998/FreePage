export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'

export interface NetworkRecord {
  id: string
  tabId: number
  sessionId: string
  protocolSessionId?: string
  targetType?: string
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
  storageKey?: string
  requestBody?: string
  responseBody?: string
  requestBodyBytes?: number
  responseBodyBytes?: number
  hasRequestBody?: boolean
  hasResponseBody?: boolean
  requestBodyOmittedReason?: 'size' | 'storage'
  responseBodyOmittedReason?: 'size' | 'binary' | 'storage' | 'unavailable'
  encoded?: boolean
  error?: string
  redirectFrom?: string
  frameId?: string
  isIframe?: boolean
  pageUrl?: string
  pageDomain?: string
  pageTitle?: string
  navigationId?: string
  navigationUrl?: string
  navigationDomain?: string
  navigationTitle?: string
  navigationStartedAt?: number
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

export interface ApiFlowVariable {
  id: string
  name: string
  value: string | number | boolean
  secret?: boolean
}

export interface ApiFlowExtractor {
  id: string
  name: string
  path: string
  output?: boolean
  required?: boolean
}

export interface ApiFlowSelection {
  sourcePath: string
  valueField: string
  variableName: string
  labelFields: string[]
  mode: 'manual' | 'first'
}

export interface ApiFlowStep {
  id: string
  name: string
  method: Method
  url: string
  headers: Record<string, string>
  body: string
  extractors: ApiFlowExtractor[]
  selection?: ApiFlowSelection
  sampleResponse?: string
}

export interface ApiFlow {
  id: string
  name: string
  variables: ApiFlowVariable[]
  steps: ApiFlowStep[]
  createdAt: number
  updatedAt: number
  sourceTabId?: number
}

export interface ApiFlowRequest {
  method: Method
  url: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}

export interface ApiFlowRequestResult {
  ok: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  duration?: number
  truncated?: boolean
  error?: string
}
