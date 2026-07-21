import type { NetworkRecord, OverrideRule } from './types'

const now = Date.now()

export const demoRecords: NetworkRecord[] = [
  { id: '7', tabId: 1, sessionId: 'current', url: 'https://app.dev.local/api/v2/profile', method: 'GET', type: 'Fetch', status: 200, mimeType: 'application/json', startedAt: now - 2400, finishedAt: now - 2276, duration: 124, requestHeaders: { accept: 'application/json', authorization: 'Bearer ••••••••', 'x-forwarded-for': '203.0.113.42' }, responseHeaders: { 'content-type': 'application/json', 'cache-control': 'no-store' }, responseBody: '{"id":8421,"name":"Alex Chen","role":"developer","environment":"staging"}', responseBodyBytes: 1577352 },
  { id: '6', tabId: 1, sessionId: 'current', url: 'https://app.dev.local/api/v2/experiments', method: 'POST', type: 'Fetch', status: 200, mimeType: 'application/json', startedAt: now - 2710, finishedAt: now - 2498, duration: 212, requestHeaders: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.42' }, responseHeaders: { 'content-type': 'application/json' }, requestBody: '{"keys":["new_dashboard","smart_search"]}', responseBody: '{"new_dashboard":true,"smart_search":false}' },
  { id: '5', tabId: 1, sessionId: 'current', url: 'https://cdn.dev.local/assets/app-C8X2.js', method: 'GET', type: 'Script', status: 200, mimeType: 'application/javascript', startedAt: now - 3200, finishedAt: now - 3162, duration: 38, requestHeaders: { accept: '*/*' }, responseHeaders: { 'content-type': 'application/javascript' } },
  { id: '4', tabId: 1, sessionId: 'current', url: 'https://app.dev.local/dashboard', method: 'GET', type: 'Document', status: 200, mimeType: 'text/html', startedAt: now - 3630, finishedAt: now - 3216, duration: 414, requestHeaders: { accept: 'text/html' }, responseHeaders: { 'content-type': 'text/html' }, redirectFrom: 'https://login.dev.local/sso/callback' },
  { id: '3', tabId: 1, sessionId: 'current', url: 'https://login.dev.local/sso/callback?code=••••••', method: 'GET', type: 'Document', status: 302, startedAt: now - 3810, finishedAt: now - 3704, duration: 106, requestHeaders: { accept: 'text/html' }, responseHeaders: { location: 'https://app.dev.local/dashboard' }, redirectFrom: 'https://login.dev.local/start' },
  { id: '2', tabId: 2, sessionId: 'current', url: 'https://api.dev.local/api/v2/metrics', method: 'GET', type: 'Fetch', status: 500, mimeType: 'application/json', startedAt: now - 4500, finishedAt: now - 3660, duration: 840, requestHeaders: { accept: 'application/json' }, responseHeaders: { 'content-type': 'application/json' }, responseBody: '{"error":"upstream_timeout","requestId":"req_91q2"}' },
  { id: '1', tabId: 1, sessionId: 'current', url: 'https://widgets.partner.dev/embed/session', method: 'POST', type: 'Fetch', status: 200, mimeType: 'application/json', startedAt: now - 4980, finishedAt: now - 4710, duration: 270, requestHeaders: { 'content-type': 'application/json' }, responseHeaders: { 'content-type': 'application/json' }, requestBody: '{"source":"checkout","mode":"embedded"}', responseBody: '{"ready":true,"frame":"payment-widget"}', frameId: 'frame-child-1', isIframe: true },
]

export const demoRules: OverrideRule[] = [
  { id: 101, name: '模拟上海 IP', enabled: true, domain: 'dev.local', resourceTypes: ['main_frame', 'xmlhttprequest'], headers: [{ operation: 'set', name: 'x-forwarded-for', value: '203.0.113.42' }, { operation: 'set', name: 'x-real-ip', value: '203.0.113.42' }], query: [], hits: 18 },
  { id: 102, name: '附加调试参数', enabled: true, domain: 'app.dev.local', resourceTypes: ['xmlhttprequest'], headers: [{ operation: 'set', name: 'x-debug-mode', value: 'enabled' }], query: [{ operation: 'set', name: 'debug', value: '1' }], hits: 7 },
  { id: 103, name: '本地 Mock', enabled: false, domain: 'api.dev.local', resourceTypes: ['xmlhttprequest'], headers: [], query: [{ operation: 'set', name: 'mock', value: 'true' }], hits: 0 },
]

demoRecords.forEach(record => {
  record.pageDomain = record.tabId === 2 ? 'admin.dev.local' : 'app.dev.local'
  record.pageUrl = record.tabId === 2 ? 'https://admin.dev.local/monitoring' : 'https://app.dev.local/dashboard'
  record.pageTitle = record.tabId === 2 ? '监控后台' : '开发控制台'
})
