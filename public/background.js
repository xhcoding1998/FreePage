import { deleteStoredRecords, getAllStoredRecords, getRecordCacheStats, getStoredRecord, pruneStoredRecords, putStoredRecord, putStoredRecords, recordStorageKey } from './record-store.js'
import { runQrPagePicker } from './qr-page-picker.js'

const records = new Map()
const attachedTabs = new Set()
const attachingTabs = new Map()
const tabCaptureStates = new Map()
const iframeFrames = new Set()
const relatedTargetSessions = new Map()
const tabContexts = new Map()
const tabNavigationStates = new Map()
const hiddenInvalidTabs = new Set()
const captureSessionTabs = new Set()
let captureSessionPersistTask = Promise.resolve()
let recording = false
let currentSessionId = crypto.randomUUID()
const MAIN_TABS = ['requests', 'rules', 'flow', 'autofill', 'mfa', 'tools']
const DEFAULT_IGNORED_DOMAINS = ['arms-retcode.aliyuncs.com', 'analytics.google.com', 'www.google-analytics.com', 'region1.google-analytics.com', 'stats.g.doubleclick.net', 'hm.baidu.com']
const NETWORK_ENABLE_OPTIONS = { maxTotalBufferSize: 100000000, maxResourceBufferSize: 50000000 }
const RELATED_TARGET_FILTER = [
  { type: 'iframe', exclude: false },
  { type: 'worker', exclude: false },
  { type: 'shared_worker', exclude: false },
  { type: 'service_worker', exclude: false },
  { exclude: true },
]
let settings = { maxRecords: 500, maxBodyMB: 1, maxCacheMB: 50, retentionMinutes: 60, xhrOnly: true, ignoredDomains: [...DEFAULT_IGNORED_DOMAINS], navigationSchemaVersion: 3, navigationMode: 'scroll', requestSort: 'newest', visibleTabs: [...MAIN_TABS], tabOrder: [...MAIN_TABS] }
let overrideRules = []
const CACHE_MAINTENANCE_ALARM = 'suiye-cache-maintenance'
let maintenanceTimer = null
let lastCacheStats = { bytes: 0, bodyBytes: 0, recordCount: 0, lastCleanupAt: 0 }
function normalizeSettings(value = {}) {
  const schemaVersion = Number(value.navigationSchemaVersion || 0)
  const requestedTabs = Array.isArray(value.visibleTabs)
    ? value.visibleTabs.filter((tab, index, tabs) => MAIN_TABS.includes(tab) && tabs.indexOf(tab) === index)
    : [...MAIN_TABS]
  if (schemaVersion < 2 && !requestedTabs.includes('flow')) {
    const insertAt = Math.max(0, requestedTabs.indexOf('rules') + 1)
    requestedTabs.splice(insertAt, 0, 'flow')
  }
  const requestedOrder = Array.isArray(value.tabOrder)
    ? value.tabOrder.filter((tab, index, tabs) => MAIN_TABS.includes(tab) && tabs.indexOf(tab) === index)
    : [...MAIN_TABS]
  if (schemaVersion < 2 && !requestedOrder.includes('flow')) {
    const insertAt = Math.max(0, requestedOrder.indexOf('rules') + 1)
    requestedOrder.splice(insertAt, 0, 'flow')
  }
  const tabOrder = [...requestedOrder, ...MAIN_TABS.filter(tab => !requestedOrder.includes(tab))]
  const visibleSet = new Set(requestedTabs.length ? requestedTabs : ['requests'])
  const ignoredDomains = Array.isArray(value.ignoredDomains)
    ? [...new Set(value.ignoredDomains.flatMap(item => String(item || '').split(/[\s,，;；]+/)).map(item => item.trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').split('/')[0]).filter(item => item && item.includes('.')))]
    : [...DEFAULT_IGNORED_DOMAINS]
  return {
    maxRecords: Math.min(1000, Math.max(50, Number(value.maxRecords || 500))),
    maxBodyMB: Math.min(5, Math.max(0.256, Number(value.maxBodyMB || 1))),
    maxCacheMB: Math.min(200, Math.max(10, Number(value.maxCacheMB || 50))),
    retentionMinutes: Math.max(0, Number(value.retentionMinutes ?? 60)),
    xhrOnly: schemaVersion < 2 ? true : !!value.xhrOnly,
    ignoredDomains,
    navigationSchemaVersion: 3,
    navigationMode: value.navigationMode === 'compact' ? 'compact' : 'scroll',
    requestSort: value.requestSort === 'oldest' ? 'oldest' : 'newest',
    visibleTabs: tabOrder.filter(tab => visibleSet.has(tab)),
    tabOrder,
  }
}

function isIgnoredRequestUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return settings.ignoredDomains.some(domain => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}
const ready = chrome.storage.local.get(['recording', 'currentSessionId', 'captureTabIds', 'settings', 'overrideRules', 'networkRecords']).then(async (state) => {
  recording = !!state.recording
  currentSessionId = state.currentSessionId || currentSessionId
  if (recording && Array.isArray(state.captureTabIds)) {
    for (const tabId of state.captureTabIds) if (Number.isInteger(tabId)) captureSessionTabs.add(tabId)
  }
  settings = normalizeSettings(state.settings || {})
  await chrome.storage.local.set({ settings })
  overrideRules = Array.isArray(state.overrideRules) ? state.overrideRules : []
  if (Array.isArray(state.networkRecords) && state.networkRecords.length) {
    await putStoredRecords(state.networkRecords.map(prepareRecordForStorage))
    await chrome.storage.local.remove('networkRecords')
  }
  lastCacheStats = await runStorageMaintenance(false)
})

ready.then(async () => {
  chrome.alarms.create(CACHE_MAINTENANCE_ALARM, { periodInMinutes: 15 })
  await updateActionIndicator()
  if (!recording) return
  await restoreCaptureSessionTabs()
}).catch(() => {})

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id })
})

chrome.runtime.onStartup.addListener(() => {
  ready.then(updateActionIndicator).catch(() => {})
})

chrome.runtime.onInstalled.addListener(() => {
  ready.then(updateActionIndicator).catch(() => {})
})

function activeOverrideRuleCount() {
  return overrideRules.filter(rule => {
    if (!rule?.enabled) return false
    const hasHeader = rule.headers?.some(header => header.name?.trim())
    const hasQuery = rule.query?.some(query => query.name?.trim())
    return hasHeader || hasQuery
  }).length
}

async function updateActionIndicator() {
  const ruleCount = activeOverrideRuleCount()
  const ruleBadge = ruleCount > 99 ? '99+' : String(ruleCount)
  const badgeText = recording ? (ruleCount ? ruleBadge : 'REC') : (ruleCount ? ruleBadge : '')
  const badgeColor = recording ? '#dc3545' : '#2563eb'
  const captureLabel = recording ? '正在捕获流量' : '捕获已暂停'
  const ruleLabel = ruleCount ? `${ruleCount} 条覆写规则生效` : '无生效规则'
  await Promise.all([
    chrome.action.setBadgeText({ text: badgeText }),
    chrome.action.setBadgeBackgroundColor({ color: badgeColor }),
    chrome.action.setTitle({ title: `随页 · ${captureLabel} · ${ruleLabel}` }),
  ])
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('没有可用的活动标签页')
  return tab
}

async function pickQrOnCurrentPage() {
  const tab = await activeTab()
  if (!tab.id || !tab.windowId || !/^https?:|^file:/.test(tab.url || '')) {
    throw new Error('当前页面不支持框选，请在普通网页中使用')
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    func: runQrPagePicker,
  })

  const selection = results[0]?.result
  if (!selection || selection.cancelled) return { ok: true, cancelled: true }
  const currentTab = await activeTab()
  if (currentTab.id !== tab.id) throw new Error('框选期间切换了网页标签，请在目标网页重新框选')
  const scale = Number(selection.devicePixelRatio || 1)
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  return {
    ok: true,
    dataUrl,
    crop: {
      x: Math.round(selection.x * scale),
      y: Math.round(selection.y * scale),
      width: Math.round(selection.width * scale),
      height: Math.round(selection.height * scale),
    },
  }
}

function domainFromUrl(url = '') {
  try { return new URL(url).hostname } catch { return '未知页面' }
}

function normalizedNavigationUrl(url = '') {
  try {
    const value = new URL(url)
    value.hash = ''
    return value.href
  } catch {
    return url
  }
}

function beginTabNavigation(tabId, url, { title = '', force = false, startedAt = Date.now() } = {}) {
  if (!Number.isInteger(tabId) || !url) return tabNavigationStates.get(tabId) || null
  const normalizedUrl = normalizedNavigationUrl(url)
  const previous = tabNavigationStates.get(tabId)
  if (!force && previous?.normalizedUrl === normalizedUrl) {
    if (title && title !== previous.title) previous.title = title
    return previous
  }
  const navigation = {
    id: `${tabId}:${startedAt}:${crypto.randomUUID()}`,
    url,
    normalizedUrl,
    domain: domainFromUrl(url),
    title: title || domainFromUrl(url),
    startedAt,
  }
  tabNavigationStates.set(tabId, navigation)
  return navigation
}

function isInspectableUrl(url = '') {
  if (!url || url === 'about:blank') return true
  try { return ['http:', 'https:', 'file:'].includes(new URL(url).protocol) } catch { return false }
}

function isCaptureReadyUrl(url = '') {
  return !!url && url !== 'about:blank' && isInspectableUrl(url)
}

async function persistCaptureSessionTabs() {
  captureSessionPersistTask = captureSessionPersistTask
    .catch(() => {})
    .then(() => chrome.storage.local.set({ captureTabIds: [...captureSessionTabs] }))
  await captureSessionPersistTask
}

async function rememberCaptureSessionTab(tabId) {
  if (!Number.isInteger(tabId) || captureSessionTabs.has(tabId)) return false
  captureSessionTabs.add(tabId)
  await persistCaptureSessionTabs()
  return true
}

async function forgetCaptureSessionTab(tabId) {
  if (!captureSessionTabs.delete(tabId)) return false
  await persistCaptureSessionTabs()
  return true
}

function captureStatesSnapshot() {
  return Object.fromEntries([...tabCaptureStates].filter(([tabId]) => !hiddenInvalidTabs.has(tabId)))
}

function captureTabContextsSnapshot() {
  return Object.fromEntries([...tabCaptureStates.keys()].filter(tabId => !hiddenInvalidTabs.has(tabId)).map(tabId => [tabId, tabContexts.get(tabId) || { tabUrl: '', tabDomain: '未知页面', tabTitle: '未命名页面' }]))
}

function textByteLength(value = '') {
  return new TextEncoder().encode(value).byteLength
}

function shouldCacheResponseBody(record) {
  const mimeType = String(record.mimeType || '').toLowerCase()
  if (!mimeType) return ['Document', 'Script', 'Stylesheet', 'Fetch', 'XHR'].includes(record.type)
  return mimeType.startsWith('text/') || /(json|javascript|xml|graphql|x-www-form-urlencoded|svg)/.test(mimeType)
}

function prepareRecordForStorage(record) {
  const prepared = { ...record, storageKey: recordStorageKey(record) }
  const bodyLimitBytes = Math.max(256_000, Number(settings.maxBodyMB || 1) * 1_000_000)

  if (typeof prepared.requestBody === 'string' && prepared.requestBody.length) {
    prepared.requestBodyBytes = textByteLength(prepared.requestBody)
    prepared.hasRequestBody = true
    if (prepared.requestBodyBytes > bodyLimitBytes) {
      delete prepared.requestBody
      prepared.hasRequestBody = false
      prepared.requestBodyOmittedReason = 'size'
    }
  }

  if (typeof prepared.responseBody === 'string' && prepared.responseBody.length) {
    prepared.responseBodyBytes = prepared.responseBodyBytes || textByteLength(prepared.responseBody)
    prepared.hasResponseBody = true
    if (prepared.responseBodyBytes > bodyLimitBytes) {
      delete prepared.responseBody
      prepared.hasResponseBody = false
      prepared.responseBodyOmittedReason = 'size'
    }
  }
  return prepared
}

function recordMetadata(record) {
  const { requestBody, responseBody, _cacheBytes, ...metadata } = record
  return {
    ...metadata,
    storageKey: recordStorageKey(record),
    hasRequestBody: !!record.hasRequestBody || (typeof requestBody === 'string' && requestBody.length > 0),
    hasResponseBody: !!record.hasResponseBody || (typeof responseBody === 'string' && responseBody.length > 0),
  }
}

async function runStorageMaintenance(shouldBroadcast = true, maxBytesOverride = null) {
  const stats = await pruneStoredRecords({
    maxRecords: Math.max(50, Number(settings.maxRecords || 500)),
    maxBytes: maxBytesOverride || Math.max(10, Number(settings.maxCacheMB || 50)) * 1_000_000,
    retentionMinutes: Math.max(0, Number(settings.retentionMinutes || 0)),
  })
  lastCacheStats = { bytes: stats.bytes, bodyBytes: stats.bodyBytes, recordCount: stats.recordCount, lastCleanupAt: stats.lastCleanupAt }
  if (shouldBroadcast) {
    if (stats.removedKeys.length) broadcast({ type: 'RECORDS_PRUNED', storageKeys: stats.removedKeys })
    broadcast({ type: 'CACHE_STATS_UPDATED', cacheStats: lastCacheStats })
  }
  return lastCacheStats
}

function scheduleStorageMaintenance() {
  if (maintenanceTimer) return
  maintenanceTimer = setTimeout(() => {
    maintenanceTimer = null
    runStorageMaintenance().catch(error => broadcast({ type: 'CACHE_STORAGE_WARNING', error: String(error?.message || error) }))
  }, 800)
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CACHE_MAINTENANCE_ALARM) return
  ready.then(() => runStorageMaintenance()).catch(() => {})
})

function setTabCaptureState(tabId, state, error = '') {
  const value = { state, error, updatedAt: Date.now() }
  tabCaptureStates.set(tabId, value)
  if (!hiddenInvalidTabs.has(tabId)) broadcast({ type: 'TAB_CAPTURE_STATE_CHANGED', tabId, captureState: value, context: tabContexts.get(tabId) })
}

function revealHiddenTab(tabId) {
  if (!hiddenInvalidTabs.delete(tabId)) return
  const captureState = tabCaptureStates.get(tabId)
  if (captureState) broadcast({ type: 'TAB_CAPTURE_STATE_CHANGED', tabId, captureState, context: tabContexts.get(tabId) })
}

function markTabClosed(tabId, fallbackRecord = null, shouldBroadcast = true) {
  const previous = tabContexts.get(tabId)
  const context = previous || {
    tabUrl: fallbackRecord?.pageUrl || fallbackRecord?.url || '',
    tabDomain: fallbackRecord?.pageDomain || domainFromUrl(fallbackRecord?.pageUrl || fallbackRecord?.url || ''),
    tabTitle: fallbackRecord?.pageTitle || fallbackRecord?.pageDomain || '已关闭的标签页',
  }
  const captureState = { state: 'closed', error: '浏览器标签页已关闭，历史请求仍保留', updatedAt: Date.now() }
  tabContexts.set(tabId, context)
  tabCaptureStates.set(tabId, captureState)
  if (shouldBroadcast && !hiddenInvalidTabs.has(tabId)) broadcast({ type: 'TAB_CAPTURE_REMOVED', tabId, captureState, context })
}

async function reconcileHistoricalTabs(storedRecords = []) {
  const openTabs = await chrome.tabs.query({})
  const openTabIds = new Set(openTabs.map(tab => tab.id).filter(tabId => tabId != null))
  const historicalTabIds = [...new Set(storedRecords.map(record => record.tabId).filter(Number.isFinite))]
  for (const tabId of historicalTabIds) {
    if (openTabIds.has(tabId)) continue
    markTabClosed(tabId, storedRecords.find(record => record.tabId === tabId), false)
  }
  return { openTabs, historicalTabIds }
}

const debuggerSessionKey = (source) => `${source.tabId}:${source.sessionId || 'root'}`
const requestKey = (source, requestId) => `${debuggerSessionKey(source)}:${requestId}`

async function enableRelatedTargetCapture(session) {
  await chrome.debugger.sendCommand(session, 'Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: RELATED_TARGET_FILTER,
  })
}

async function enableDebuggerSession(session, targetType = 'page') {
  await chrome.debugger.sendCommand(session, 'Network.enable', NETWORK_ENABLE_OPTIONS)
  if (targetType === 'page' || targetType === 'iframe') {
    await chrome.debugger.sendCommand(session, 'Page.enable').catch(() => {})
  }
  await enableRelatedTargetCapture(session).catch(() => {})
}

async function finalizeInFlightRecords(predicate, errorText) {
  const tasks = []
  for (const [key, record] of records) {
    if (!predicate(record)) continue
    records.delete(key)
    record.finishedAt ||= Date.now()
    record.duration ??= Math.max(0, record.finishedAt - record.startedAt)
    if (!record.status && !record.error) record.error = errorText
    tasks.push(persist(record))
  }
  await Promise.allSettled(tasks)
}

async function syncActiveCaptureTab() {
  if (!recording) return
  const tab = await activeTab().catch(() => null)
  if (!tab?.id || !isCaptureReadyUrl(tab.url)) return
  await rememberCaptureSessionTab(tab.id)
  await attach(tab.id).catch(() => {})
  const context = await refreshTabContext(tab.id)
  if (!hiddenInvalidTabs.has(tab.id)) broadcast({ type: 'ACTIVE_BROWSER_TAB_CHANGED', tabId: tab.id, context })
}

async function refreshTabContext(tabId, updates = {}) {
  try {
    const tab = await chrome.tabs.get(tabId)
    const previous = tabContexts.get(tabId) || {}
    const tabUrl = updates.url || tab.url || previous.tabUrl || ''
    const context = {
      tabUrl,
      tabDomain: domainFromUrl(tabUrl),
      tabTitle: updates.title || tab.title || previous.tabTitle || domainFromUrl(tabUrl),
    }
    tabContexts.set(tabId, context)
    beginTabNavigation(tabId, context.tabUrl, { title: context.tabTitle })
    return context
  } catch {
    return tabContexts.get(tabId) || { tabUrl: '', tabDomain: '未知页面', tabTitle: '已关闭的标签页' }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const belongsToCapture = captureSessionTabs.has(tabId) || tabCaptureStates.has(tabId) || attachedTabs.has(tabId) || attachingTabs.has(tabId)
  const captureUrl = changeInfo.url || tab.pendingUrl || tab.url || ''
  const canPublishContext = isCaptureReadyUrl(captureUrl) || tabCaptureStates.has(tabId) || attachedTabs.has(tabId)
  if (belongsToCapture && canPublishContext && (changeInfo.url || changeInfo.title)) {
    refreshTabContext(tabId, changeInfo)
      .then(context => { if (!hiddenInvalidTabs.has(tabId)) broadcast({ type: 'TAB_CONTEXT_UPDATED', tabId, context }) })
      .catch(() => {})
  }
  if (recording && captureSessionTabs.has(tabId) && isCaptureReadyUrl(captureUrl) && !attachedTabs.has(tabId)) attach(tabId).catch(() => {})
})
chrome.tabs.onRemoved.addListener((tabId) => {
  const context = tabContexts.get(tabId)
  const wasTracked = !!context || tabCaptureStates.has(tabId) || attachedTabs.has(tabId) || attachingTabs.has(tabId)
  forgetCaptureSessionTab(tabId).catch(() => {})
  attachedTabs.delete(tabId)
  attachingTabs.delete(tabId)
  for (const key of relatedTargetSessions.keys()) if (key.startsWith(`${tabId}:`)) relatedTargetSessions.delete(key)
  tabNavigationStates.delete(tabId)
  finalizeInFlightRecords(record => record.tabId === tabId, '页面在请求完成前关闭').catch(() => {})
  for (const frameKey of iframeFrames) if (frameKey.startsWith(`${tabId}:`)) iframeFrames.delete(frameKey)
  setTimeout(() => { syncActiveCaptureTab().catch(() => {}) }, 0)
  if (wasTracked) {
    markTabClosed(tabId, context ? { pageUrl: context.tabUrl, pageDomain: context.tabDomain, pageTitle: context.tabTitle } : null)
    return
  }
  getAllStoredRecords().then(storedRecords => {
    const fallbackRecord = storedRecords.find(record => record.tabId === tabId)
    if (fallbackRecord) markTabClosed(tabId, fallbackRecord)
  }).catch(() => {})
})
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ready
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const shouldJoinCapture = recording && tab && isCaptureReadyUrl(tab.url)
  if (shouldJoinCapture) await rememberCaptureSessionTab(tabId)
  const isKnownTab = shouldJoinCapture || tabCaptureStates.has(tabId)
  const context = tab && isKnownTab ? await refreshTabContext(tabId) : null
  broadcast({ type: 'ACTIVE_BROWSER_TAB_CHANGED', tabId, context: hiddenInvalidTabs.has(tabId) ? undefined : context })
  if (!shouldJoinCapture) return
  await attach(tabId).catch(() => {})
})
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await ready
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  const [activeWindowTab] = await chrome.tabs.query({ windowId, active: true })
  if (activeWindowTab?.id != null) {
    const shouldJoinCapture = recording && isCaptureReadyUrl(activeWindowTab.url)
    if (shouldJoinCapture) await rememberCaptureSessionTab(activeWindowTab.id)
    const isKnownTab = shouldJoinCapture || tabCaptureStates.has(activeWindowTab.id)
    const context = isKnownTab ? await refreshTabContext(activeWindowTab.id) : null
    broadcast({ type: 'ACTIVE_BROWSER_TAB_CHANGED', tabId: activeWindowTab.id, context: hiddenInvalidTabs.has(activeWindowTab.id) ? undefined : context })
    if (shouldJoinCapture) await attach(activeWindowTab.id).catch(() => {})
  }
})
chrome.tabs.onCreated.addListener(async (tab) => {
  await ready
  if (!recording || tab.id == null) return
  await rememberCaptureSessionTab(tab.id)
  const initialUrl = tab.pendingUrl || tab.url || 'about:blank'
  if (isInspectableUrl(initialUrl)) await attach(tab.id).catch(() => {})
})

async function attach(tabId) {
  if (recording) await rememberCaptureSessionTab(tabId)
  if (attachedTabs.has(tabId)) {
    setTabCaptureState(tabId, 'attached')
    return
  }
  const pending = attachingTabs.get(tabId)
  if (pending) return pending
  const task = (async () => {
    setTabCaptureState(tabId, 'connecting')
    try {
      await refreshTabContext(tabId)
      await chrome.debugger.attach({ tabId }, '1.3')
      attachedTabs.add(tabId)
      await enableDebuggerSession({ tabId })
      setTabCaptureState(tabId, 'attached')
    } catch (error) {
      if (attachedTabs.has(tabId)) {
        await chrome.debugger.detach({ tabId }).catch(() => {})
        attachedTabs.delete(tabId)
      }
      const tabStillExists = await chrome.tabs.get(tabId).then(() => true).catch(() => false)
      if (tabStillExists) setTabCaptureState(tabId, 'failed', String(error?.message || error || '连接失败'))
      else markTabClosed(tabId)
      throw error
    }
  })()
  attachingTabs.set(tabId, task)
  try { return await task } finally {
    if (attachingTabs.get(tabId) === task) attachingTabs.delete(tabId)
  }
}

async function restoreCaptureSessionTabs({ includeCurrentTab = true } = {}) {
  const tabs = await chrome.tabs.query({})
  const openTabIds = new Set(tabs.map(tab => tab.id).filter(Number.isInteger))
  let captureSetChanged = false
  for (const tabId of [...captureSessionTabs]) {
    if (openTabIds.has(tabId)) continue
    captureSessionTabs.delete(tabId)
    captureSetChanged = true
  }
  if (includeCurrentTab) {
    const currentTab = await activeTab().catch(() => null)
    if (currentTab?.id != null && isCaptureReadyUrl(currentTab.url) && !captureSessionTabs.has(currentTab.id)) {
      captureSessionTabs.add(currentTab.id)
      captureSetChanged = true
    }
  }
  if (captureSetChanged) await persistCaptureSessionTabs()
  const tasks = []
  const captureTabOrder = [...captureSessionTabs].filter(tabId => {
    const tab = tabs.find(item => item.id === tabId)
    if (!tab || !isCaptureReadyUrl(tab.url)) return false
    tasks.push(attach(tabId))
    return true
  })
  await Promise.allSettled(tasks)
  return { tabCaptureStates: captureStatesSnapshot(), captureTabContexts: captureTabContextsSnapshot(), captureTabOrder }
}

async function startRecording() {
  await ready
  recording = true
  currentSessionId = crypto.randomUUID()
  captureSessionTabs.clear()
  tabNavigationStates.clear()
  await chrome.storage.local.set({ recording, currentSessionId })
  await persistCaptureSessionTabs()
  await updateActionIndicator()
  broadcast({ type: 'STATE_CHANGED', recording })
  const capture = await restoreCaptureSessionTabs()
  const storedRecords = (await getAllStoredRecords()).map(recordMetadata)
  const { historicalTabIds } = await reconcileHistoricalTabs(storedRecords)
  const captureTabOrder = [...new Set([...capture.captureTabOrder, ...historicalTabIds])]
  return { ok: true, recording, ...capture, captureTabOrder, tabCaptureStates: captureStatesSnapshot(), captureTabContexts: captureTabContextsSnapshot() }
}

async function stopRecording() {
  recording = false
  captureSessionTabs.clear()
  await chrome.storage.local.set({ recording })
  await persistCaptureSessionTabs()
  await updateActionIndicator()
  await Promise.allSettled([...attachingTabs.values()])
  const targets = [...attachedTabs].map(tabId => chrome.debugger.detach({ tabId }).catch(() => {}))
  await Promise.all(targets)
  attachedTabs.clear()
  relatedTargetSessions.clear()
  tabNavigationStates.clear()
  tabCaptureStates.clear()
  broadcast({ type: 'TAB_CAPTURE_STATES_RESET' })
  broadcast({ type: 'STATE_CHANGED', recording })
  return { ok: true, recording, tabCaptureStates: {}, captureTabContexts: {} }
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

chrome.debugger.onDetach.addListener(async ({ tabId }, reason) => {
  attachedTabs.delete(tabId)
  for (const key of relatedTargetSessions.keys()) if (key.startsWith(`${tabId}:`)) relatedTargetSessions.delete(key)
  if (!recording) return
  if (reason === 'canceled_by_user') {
    await stopRecording()
    broadcast({ type: 'CAPTURE_CANCELLED_BY_BROWSER' })
    return
  }
  const tabStillExists = await chrome.tabs.get(tabId).then(() => true).catch(() => false)
  await finalizeInFlightRecords(record => record.tabId === tabId, '调试连接在请求完成前断开')
  if (tabStillExists) setTabCaptureState(tabId, 'failed', `捕获连接已断开：${reason || '未知原因'}`)
  else markTabClosed(tabId)
})

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!recording || source.tabId == null) return
  if (method === 'Target.attachedToTarget') {
    const childSession = { ...source, sessionId: params.sessionId }
    relatedTargetSessions.set(debuggerSessionKey(childSession), {
      type: params.targetInfo?.type || 'other',
      url: params.targetInfo?.url || '',
      title: params.targetInfo?.title || '',
    })
    await enableDebuggerSession(childSession, params.targetInfo?.type || 'other').catch(() => {})
    return
  }
  if (method === 'Target.detachedFromTarget') {
    const sessionId = params.sessionId
    relatedTargetSessions.delete(`${source.tabId}:${sessionId}`)
    await finalizeInFlightRecords(
      record => record.tabId === source.tabId && record.protocolSessionId === sessionId,
      '嵌入页面或后台任务在请求完成前关闭',
    )
    return
  }
  const frameKey = (frameId) => `${source.tabId}:${frameId}`
  const sourceTargetInfo = relatedTargetSessions.get(debuggerSessionKey(source))
  const sourceIsIframe = sourceTargetInfo?.type === 'iframe'
  if (method === 'Page.frameAttached') iframeFrames.add(frameKey(params.frameId))
  if (method === 'Page.frameNavigated') {
    if (params.frame.parentId || sourceIsIframe) iframeFrames.add(frameKey(params.frame.id))
    else {
      iframeFrames.delete(frameKey(params.frame.id))
      const previous = tabContexts.get(source.tabId) || {}
      const context = { ...previous, tabUrl: params.frame.url, tabDomain: domainFromUrl(params.frame.url) }
      tabContexts.set(source.tabId, context)
      beginTabNavigation(source.tabId, params.frame.url, { title: context.tabTitle })
      if (!hiddenInvalidTabs.has(source.tabId)) broadcast({ type: 'TAB_CONTEXT_UPDATED', tabId: source.tabId, context })
    }
  }
  if (method === 'Page.navigatedWithinDocument' && !sourceIsIframe && !iframeFrames.has(frameKey(params.frameId))) {
    const previous = tabContexts.get(source.tabId) || {}
    const context = { ...previous, tabUrl: params.url, tabDomain: domainFromUrl(params.url) }
    tabContexts.set(source.tabId, context)
    beginTabNavigation(source.tabId, params.url, { title: context.tabTitle })
    if (!hiddenInvalidTabs.has(source.tabId)) broadcast({ type: 'TAB_CONTEXT_UPDATED', tabId: source.tabId, context })
  }
  if (method === 'Page.frameDetached') iframeFrames.delete(frameKey(params.frameId))
  if (method === 'Network.requestWillBeSent') {
    if (settings.xhrOnly && !['Fetch', 'XHR'].includes(params.type)) return
    const key = requestKey(source, params.requestId)
    const old = records.get(key)
    if (isIgnoredRequestUrl(params.request.url)) {
      if (params.redirectResponse && old) {
        old.status = params.redirectResponse.status
        old.statusText = params.redirectResponse.statusText
        old.responseHeaders = params.redirectResponse.headers || {}
        old.finishedAt = Date.now()
        old.duration = old.finishedAt - old.startedAt
        await persist(old)
      }
      records.delete(key)
      return
    }
    revealHiddenTab(source.tabId)
    const targetInfo = sourceTargetInfo
    const isIframeRequest = sourceIsIframe || iframeFrames.has(frameKey(params.frameId))
    let tabContext = tabContexts.get(source.tabId) || await refreshTabContext(source.tabId)
    let navigation
    if (params.type === 'Document' && !isIframeRequest) {
      const nextDomain = domainFromUrl(params.request.url)
      tabContext = { ...tabContext, tabUrl: params.request.url, tabDomain: nextDomain, tabTitle: nextDomain }
      tabContexts.set(source.tabId, tabContext)
      navigation = beginTabNavigation(source.tabId, params.request.url, { title: nextDomain, force: true, startedAt: Date.now() })
      if (!hiddenInvalidTabs.has(source.tabId)) broadcast({ type: 'TAB_CONTEXT_UPDATED', tabId: source.tabId, context: tabContext })
    } else {
      navigation = tabNavigationStates.get(source.tabId)
        || beginTabNavigation(source.tabId, tabContext.tabUrl || params.documentURL || params.request.url, { title: tabContext.tabTitle })
    }
    const record = {
      id: source.sessionId ? `${source.sessionId}:${params.requestId}` : params.requestId,
      tabId: source.tabId,
      sessionId: currentSessionId,
      protocolSessionId: source.sessionId,
      targetType: targetInfo?.type,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      startedAt: Date.now(),
      requestHeaders: params.request.headers || {},
      responseHeaders: {},
      requestBody: params.request.postData,
      requestBodyBytes: params.request.postData ? textByteLength(params.request.postData) : 0,
      redirectFrom: params.redirectResponse ? old?.url : undefined,
      frameId: params.frameId,
      isIframe: isIframeRequest,
      pageUrl: navigation?.url || tabContext.tabUrl,
      pageDomain: navigation?.domain || tabContext.tabDomain,
      pageTitle: navigation?.title || tabContext.tabTitle,
      navigationId: navigation?.id,
      navigationUrl: navigation?.url,
      navigationDomain: navigation?.domain,
      navigationTitle: navigation?.title,
      navigationStartedAt: navigation?.startedAt,
    }
    if (params.redirectResponse && old) {
      old.status = params.redirectResponse.status
      old.statusText = params.redirectResponse.statusText
      old.responseHeaders = params.redirectResponse.headers || {}
      old.finishedAt = Date.now()
      old.duration = old.finishedAt - old.startedAt
      await persist(old)
    }
    records.set(key, record)
    broadcast({ type: 'RECORD_UPDATED', record: recordMetadata(record) })
  }
  if (method === 'Network.responseReceived') {
    const record = records.get(requestKey(source, params.requestId))
    if (!record) return
    Object.assign(record, {
      status: params.response.status,
      statusText: params.response.statusText,
      responseHeaders: params.response.headers || {},
      mimeType: params.response.mimeType,
    })
    broadcast({ type: 'RECORD_UPDATED', record: recordMetadata(record) })
  }
  if (method === 'Network.loadingFinished') {
    const key = requestKey(source, params.requestId)
    const record = records.get(key)
    if (!record) return
    record.finishedAt = Date.now()
    record.duration = record.finishedAt - record.startedAt
    const responseBytes = Math.max(0, params.encodedDataLength || 0)
    record.responseBodyBytes = responseBytes
    if (!shouldCacheResponseBody(record)) {
      record.responseBodyOmittedReason = 'binary'
    } else if (responseBytes > settings.maxBodyMB * 1_000_000) {
      record.responseBodyOmittedReason = 'size'
    } else {
      try {
        const body = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId })
        record.responseBody = body.body
        record.encoded = body.base64Encoded
        record.responseBodyBytes = body.base64Encoded
          ? Math.max(0, Math.floor(body.body.length * 3 / 4) - (body.body.endsWith('==') ? 2 : body.body.endsWith('=') ? 1 : 0))
          : new TextEncoder().encode(body.body).byteLength
      } catch {
        record.responseBodyOmittedReason = 'unavailable'
      }
    }
    await persist(record)
    if (records.get(key) === record) records.delete(key)
  }
  if (method === 'Network.loadingFailed') {
    const key = requestKey(source, params.requestId)
    const record = records.get(key)
    if (!record) return
    record.error = params.errorText
    record.finishedAt = Date.now()
    record.duration = record.finishedAt - record.startedAt
    await persist(record)
    if (records.get(key) === record) records.delete(key)
  }
})

async function persist(record) {
  let storedRecord = prepareRecordForStorage(record)
  try {
    await putStoredRecord(storedRecord)
  } catch (error) {
    await runStorageMaintenance(false, Math.max(5, Number(settings.maxCacheMB || 50) / 2) * 1_000_000).catch(() => {})
    storedRecord = { ...storedRecord, hasRequestBody: false, hasResponseBody: false, requestBodyOmittedReason: storedRecord.requestBody ? 'storage' : storedRecord.requestBodyOmittedReason, responseBodyOmittedReason: storedRecord.responseBody ? 'storage' : storedRecord.responseBodyOmittedReason }
    delete storedRecord.requestBody
    delete storedRecord.responseBody
    try {
      await putStoredRecord(storedRecord)
      broadcast({ type: 'CACHE_STORAGE_WARNING', error: '缓存空间不足，本次请求仅保存了元数据' })
    } catch (fallbackError) {
      broadcast({ type: 'CACHE_STORAGE_WARNING', error: `请求缓存写入失败：${String(fallbackError?.message || fallbackError || error)}` })
      return
    }
  }
  broadcast({ type: 'RECORD_UPDATED', record: recordMetadata(storedRecord) })
  scheduleStorageMaintenance()
}

async function applyRules(rules) {
  const current = await chrome.declarativeNetRequest.getDynamicRules()
  const addRules = rules.filter(r => r.enabled && r.headers?.some(h => h.name?.trim())).map((rule) => ({
    id: rule.id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: rule.headers.filter(h => h.name?.trim()).map(h => ({ header: h.name.trim(), operation: h.operation, ...(h.operation === 'set' ? { value: h.value || '' } : {}) }))
    },
    condition: {
      urlFilter: rule.domain ? `||${rule.domain}` : '|http',
      resourceTypes: rule.resourceTypes?.length ? rule.resourceTypes : ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'other']
    }
  }))
  // Query transforms need separate rule IDs so they can coexist with header modifications.
  const queryRules = rules.filter(r => r.enabled && r.query?.some(q => q.name?.trim())).map((rule) => {
    const addOrReplaceParams = rule.query.filter(q => q.operation === 'set' && q.name?.trim()).map(q => ({ key: q.name.trim(), value: q.value || '' }))
    const removeParams = rule.query.filter(q => q.operation === 'remove' && q.name?.trim()).map(q => q.name.trim())
    const queryTransform = {
      ...(addOrReplaceParams.length ? { addOrReplaceParams } : {}),
      ...(removeParams.length ? { removeParams } : {}),
    }
    return {
      id: rule.id + 100000,
      priority: 2,
      action: { type: 'redirect', redirect: { transform: { queryTransform } } },
      condition: { urlFilter: rule.domain ? `||${rule.domain}` : '|http', resourceTypes: rule.resourceTypes?.length ? rule.resourceTypes : ['main_frame', 'sub_frame', 'xmlhttprequest'] }
    }
  })
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: current.map(r => r.id), addRules: [...addRules, ...queryRules] })
  await chrome.storage.local.set({ overrideRules: rules })
  overrideRules = rules
  await updateActionIndicator()
  return { ok: true }
}

async function executeApiFlowRequest(request = {}) {
  const method = String(request.method || 'GET').toUpperCase()
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
  if (!allowedMethods.has(method)) return { ok: false, error: `不支持的请求方法：${method}` }
  let targetUrl
  try {
    targetUrl = new URL(String(request.url || ''))
  } catch {
    return { ok: false, error: '请求地址格式不正确' }
  }
  if (!['http:', 'https:'].includes(targetUrl.protocol)) return { ok: false, error: '接口流程只支持 HTTP/HTTPS 请求' }
  const tab = await activeTab()
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return { ok: false, error: '请先打开需要使用登录状态的普通网页' }
  const normalizedRequest = {
    method,
    url: targetUrl.toString(),
    headers: Object.fromEntries(Object.entries(request.headers || {}).map(([name, value]) => [String(name), String(value)])),
    body: typeof request.body === 'string' ? request.body : undefined,
    timeoutMs: Math.min(60_000, Math.max(1_000, Number(request.timeoutMs || 15_000))),
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'ISOLATED',
    args: [normalizedRequest],
    func: async (flowRequest) => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), flowRequest.timeoutMs)
      const startedAt = performance.now()
      try {
        const response = await fetch(flowRequest.url, {
          method: flowRequest.method,
          headers: flowRequest.headers,
          body: ['GET', 'HEAD'].includes(flowRequest.method) ? undefined : flowRequest.body,
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        })
        const rawBody = await response.text()
        const maxCharacters = 2_000_000
        const truncated = rawBody.length > maxCharacters
        return {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries([...response.headers.entries()]),
          body: truncated ? rawBody.slice(0, maxCharacters) : rawBody,
          truncated,
          duration: Math.round(performance.now() - startedAt),
        }
      } catch (error) {
        return {
          ok: false,
          error: error?.name === 'AbortError' ? `请求超过 ${flowRequest.timeoutMs / 1000} 秒未完成` : String(error?.message || error),
          duration: Math.round(performance.now() - startedAt),
        }
      } finally {
        window.clearTimeout(timeout)
      }
    },
  })
  return results[0]?.result || { ok: false, error: '当前网页没有返回接口执行结果' }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const tasks = {
    GET_STATE: async () => {
      await ready
      const state = await chrome.storage.local.get(['overrideRules'])
      const storedRecords = (await getAllStoredRecords()).map(recordMetadata)
      const { openTabs, historicalTabIds } = await reconcileHistoricalTabs(storedRecords)
      const openTabIds = new Set(openTabs.map(tab => tab.id).filter(tabId => tabId != null))
      await Promise.all(historicalTabIds.filter(tabId => openTabIds.has(tabId)).map(tabId => refreshTabContext(tabId)))
      const currentTab = await activeTab().catch(() => null)
      if (recording && currentTab?.id != null && isCaptureReadyUrl(currentTab.url)) {
        await rememberCaptureSessionTab(currentTab.id)
        await attach(currentTab.id).catch(() => {})
      }
      const currentTabIsKnown = currentTab?.id != null && (captureSessionTabs.has(currentTab.id) || tabCaptureStates.has(currentTab.id) || historicalTabIds.includes(currentTab.id))
      if (currentTabIsKnown) await refreshTabContext(currentTab.id)
      const networkRecords = storedRecords
      const captureTabContexts = captureTabContextsSnapshot()
      if (currentTabIsKnown && !hiddenInvalidTabs.has(currentTab.id) && tabContexts.has(currentTab.id)) captureTabContexts[currentTab.id] = tabContexts.get(currentTab.id)
      const captureTabOrder = [...new Set([
        ...[...captureSessionTabs].filter(tabId => openTabIds.has(tabId)),
        ...historicalTabIds,
      ])]
      lastCacheStats = await getRecordCacheStats()
      return { ...state, networkRecords, recording, settings, cacheStats: lastCacheStats, tabCaptureStates: captureStatesSnapshot(), captureTabContexts, captureTabOrder, activeBrowserTabId: currentTab?.id }
    },
    GET_RECORD_DETAIL: async () => {
      await ready
      const storageKey = String(message.storageKey || '')
      if (!storageKey) return { ok: false, error: '缺少请求缓存标识' }
      const record = await getStoredRecord(storageKey)
      return record ? { ok: true, record } : { ok: false, error: '该请求正文已被自动清理' }
    },
    GET_EXPORT_RECORDS: async () => {
      await ready
      const storedRecords = await getAllStoredRecords()
      return { ok: true, records: storedRecords.map(({ _cacheBytes, ...record }) => record) }
    },
    START_RECORDING: startRecording,
    STOP_RECORDING: stopRecording,
    EXECUTE_API_REQUEST: () => executeApiFlowRequest(message.request),
    START_QR_PAGE_PICKER: pickQrOnCurrentPage,
    CLEAR_RECORDS: async () => {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : null
      if (tabId == null) records.clear()
      else for (const [key, record] of records) if (record.tabId === tabId) records.delete(key)
      const removed = await deleteStoredRecords(tabId)
      lastCacheStats = await getRecordCacheStats()
      broadcast({ type: 'RECORDS_CLEARED', tabId })
      broadcast({ type: 'CACHE_STATS_UPDATED', cacheStats: lastCacheStats })
      return { ok: true, removed, cacheStats: lastCacheStats }
    },
    CLEAN_INVALID_TABS: async () => {
      const requestedTabIds = [...new Set((message.tabIds || []).filter(Number.isInteger))]
      const storedRecords = await getAllStoredRecords()
      const recordedTabIds = new Set([...storedRecords.map(record => record.tabId), ...[...records.values()].map(record => record.tabId)])
      const tabIds = requestedTabIds.filter(tabId => tabCaptureStates.get(tabId)?.state === 'closed' || !recordedTabIds.has(tabId))
      const closedTabIds = new Set(tabIds.filter(tabId => tabCaptureStates.get(tabId)?.state === 'closed'))
      for (const tabId of tabIds) {
        hiddenInvalidTabs.add(tabId)
        if (closedTabIds.has(tabId)) {
          tabCaptureStates.delete(tabId)
          tabContexts.delete(tabId)
          for (const [key, record] of records) if (record.tabId === tabId) records.delete(key)
        }
        broadcast({ type: 'TAB_CAPTURE_DISMISSED', tabId })
      }
      let removedRecords = 0
      for (const tabId of closedTabIds) removedRecords += await deleteStoredRecords(tabId)
      lastCacheStats = await getRecordCacheStats()
      broadcast({ type: 'CACHE_STATS_UPDATED', cacheStats: lastCacheStats })
      return { ok: true, tabIds, removedRecords, cacheStats: lastCacheStats }
    },
    DISMISS_CLOSED_TAB: async () => {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : null
      if (tabId == null) return { ok: false, error: '缺少网页标签 ID' }
      if (tabCaptureStates.get(tabId)?.state !== 'closed') return { ok: false, error: '只能删除已断开的网页标签' }
      for (const [key, record] of records) if (record.tabId === tabId) records.delete(key)
      const removed = await deleteStoredRecords(tabId)
      tabCaptureStates.delete(tabId)
      tabContexts.delete(tabId)
      broadcast({ type: 'TAB_CAPTURE_DISMISSED', tabId })
      lastCacheStats = await getRecordCacheStats()
      broadcast({ type: 'CACHE_STATS_UPDATED', cacheStats: lastCacheStats })
      return { ok: true, removed, cacheStats: lastCacheStats }
    },
    APPLY_RULES: () => applyRules(message.rules),
    SAVE_SETTINGS: async () => {
      settings = normalizeSettings({ ...settings, ...message.settings })
      await chrome.storage.local.set({ settings })
      lastCacheStats = await runStorageMaintenance()
      return { ok: true, cacheStats: lastCacheStats }
    },
    SAVE_REQUEST_SORT: async () => {
      settings = normalizeSettings({ ...settings, requestSort: message.requestSort })
      await chrome.storage.local.set({ settings })
      return { ok: true }
    },
    SAVE_CAPTURE_SCOPE: async () => {
      await ready
      settings = normalizeSettings({ ...settings, xhrOnly: !!message.xhrOnly })
      await chrome.storage.local.set({ settings })
      return { ok: true, xhrOnly: settings.xhrOnly }
    },
  }
  if (!tasks[message.type]) return
  tasks[message.type]().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error.message || error) }))
  return true
})
