const records = new Map()
const attachedTabs = new Set()
const attachingTabs = new Map()
const tabCaptureStates = new Map()
const iframeFrames = new Set()
const tabContexts = new Map()
const hiddenInvalidTabs = new Set()
let recording = false
let currentSessionId = crypto.randomUUID()
let settings = { maxRecords: 500, maxBodyMB: 5, xhrOnly: false }
let overrideRules = []
const ready = chrome.storage.local.get(['recording', 'currentSessionId', 'settings', 'overrideRules']).then((state) => {
  recording = !!state.recording
  currentSessionId = state.currentSessionId || currentSessionId
  settings = { ...settings, ...(state.settings || {}) }
  overrideRules = Array.isArray(state.overrideRules) ? state.overrideRules : []
})

ready.then(async () => {
  await updateActionIndicator()
  if (!recording) return
  await attachAllTabs()
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

function domainFromUrl(url = '') {
  try { return new URL(url).hostname } catch { return '未知页面' }
}

function isInspectableUrl(url = '') {
  if (!url || url === 'about:blank') return true
  try { return ['http:', 'https:', 'file:'].includes(new URL(url).protocol) } catch { return false }
}

function captureStatesSnapshot() {
  return Object.fromEntries([...tabCaptureStates].filter(([tabId]) => !hiddenInvalidTabs.has(tabId)))
}

function captureTabContextsSnapshot() {
  return Object.fromEntries([...tabCaptureStates.keys()].filter(tabId => !hiddenInvalidTabs.has(tabId)).map(tabId => [tabId, tabContexts.get(tabId) || { tabUrl: '', tabDomain: '未知页面', tabTitle: '未命名页面' }]))
}

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

const requestKey = (tabId, requestId) => `${tabId}:${requestId}`

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
    return context
  } catch {
    return tabContexts.get(tabId) || { tabUrl: '', tabDomain: '未知页面', tabTitle: '已关闭的标签页' }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title) {
    refreshTabContext(tabId, changeInfo)
      .then(context => { if (!hiddenInvalidTabs.has(tabId)) broadcast({ type: 'TAB_CONTEXT_UPDATED', tabId, context }) })
      .catch(() => {})
  }
  if (recording && isInspectableUrl(tab.url || changeInfo.url) && !attachedTabs.has(tabId)) attach(tabId).catch(() => {})
})
chrome.tabs.onRemoved.addListener((tabId) => {
  const context = tabContexts.get(tabId)
  const wasTracked = !!context || tabCaptureStates.has(tabId) || attachedTabs.has(tabId) || attachingTabs.has(tabId)
  attachedTabs.delete(tabId)
  attachingTabs.delete(tabId)
  for (const frameKey of iframeFrames) if (frameKey.startsWith(`${tabId}:`)) iframeFrames.delete(frameKey)
  if (wasTracked) {
    markTabClosed(tabId, context ? { pageUrl: context.tabUrl, pageDomain: context.tabDomain, pageTitle: context.tabTitle } : null)
    return
  }
  chrome.storage.local.get('networkRecords').then(data => {
    const fallbackRecord = (data.networkRecords || []).find(record => record.tabId === tabId)
    if (fallbackRecord) markTabClosed(tabId, fallbackRecord)
  }).catch(() => {})
})
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ready
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const context = tab ? await refreshTabContext(tabId) : null
  broadcast({ type: 'ACTIVE_BROWSER_TAB_CHANGED', tabId, context: hiddenInvalidTabs.has(tabId) ? undefined : context })
  if (!recording) return
  if (!tab || !isInspectableUrl(tab.url)) {
    setTabCaptureState(tabId, 'failed', '当前页面类型不支持捕获')
    return
  }
  await attach(tabId).catch(() => {})
})
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await ready
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  const [activeWindowTab] = await chrome.tabs.query({ windowId, active: true })
  if (activeWindowTab?.id != null) {
    const context = await refreshTabContext(activeWindowTab.id)
    broadcast({ type: 'ACTIVE_BROWSER_TAB_CHANGED', tabId: activeWindowTab.id, context: hiddenInvalidTabs.has(activeWindowTab.id) ? undefined : context })
  }
  if (!recording) return
  await attachWindowTabs(windowId).catch(() => {})
})
chrome.tabs.onCreated.addListener(async (tab) => {
  await ready
  if (!recording || tab.id == null) return
  if (isInspectableUrl(tab.url)) await attach(tab.id).catch(() => {})
})

async function attach(tabId) {
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
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', { maxTotalBufferSize: 100000000, maxResourceBufferSize: 50000000 })
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable')
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

async function attachWindowTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId })
  const tasks = []
  for (const tab of tabs) {
    if (tab.id == null) continue
    if (isInspectableUrl(tab.url)) tasks.push(attach(tab.id))
    else if (tab.active) setTabCaptureState(tab.id, 'failed', '当前页面类型不支持捕获')
  }
  await Promise.allSettled(tasks)
  return captureStatesSnapshot()
}

async function attachAllTabs() {
  const tabs = await chrome.tabs.query({})
  const tasks = []
  const captureTabOrder = []
  for (const tab of tabs) {
    if (tab.id == null) continue
    if (isInspectableUrl(tab.url)) {
      captureTabOrder.push(tab.id)
      tasks.push(attach(tab.id))
    }
  }
  await Promise.allSettled(tasks)
  return { tabCaptureStates: captureStatesSnapshot(), captureTabContexts: captureTabContextsSnapshot(), captureTabOrder }
}

async function startRecording() {
  await ready
  recording = true
  currentSessionId = crypto.randomUUID()
  await chrome.storage.local.set({ recording, currentSessionId })
  await updateActionIndicator()
  broadcast({ type: 'STATE_CHANGED', recording })
  const capture = await attachAllTabs()
  const data = await chrome.storage.local.get('networkRecords')
  await reconcileHistoricalTabs(data.networkRecords || [])
  return { ok: true, recording, ...capture, tabCaptureStates: captureStatesSnapshot(), captureTabContexts: captureTabContextsSnapshot() }
}

async function stopRecording() {
  recording = false
  await chrome.storage.local.set({ recording })
  await updateActionIndicator()
  await Promise.allSettled([...attachingTabs.values()])
  const targets = [...attachedTabs].map(tabId => chrome.debugger.detach({ tabId }).catch(() => {}))
  await Promise.all(targets)
  attachedTabs.clear()
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
  if (!recording) return
  const tabStillExists = await chrome.tabs.get(tabId).then(() => true).catch(() => false)
  if (tabStillExists) setTabCaptureState(tabId, 'failed', `捕获连接已断开：${reason || '未知原因'}`)
  else markTabClosed(tabId)
})

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!recording || source.tabId == null) return
  const frameKey = (frameId) => `${source.tabId}:${frameId}`
  if (method === 'Page.frameAttached') iframeFrames.add(frameKey(params.frameId))
  if (method === 'Page.frameNavigated') {
    if (params.frame.parentId) iframeFrames.add(frameKey(params.frame.id))
    else {
      iframeFrames.delete(frameKey(params.frame.id))
      const previous = tabContexts.get(source.tabId) || {}
      const context = { ...previous, tabUrl: params.frame.url, tabDomain: domainFromUrl(params.frame.url) }
      tabContexts.set(source.tabId, context)
      if (!hiddenInvalidTabs.has(source.tabId)) broadcast({ type: 'TAB_CONTEXT_UPDATED', tabId: source.tabId, context })
    }
  }
  if (method === 'Page.frameDetached') iframeFrames.delete(frameKey(params.frameId))
  if (method === 'Network.requestWillBeSent') {
    if (settings.xhrOnly && !['Fetch', 'XHR'].includes(params.type)) return
    revealHiddenTab(source.tabId)
    const key = requestKey(source.tabId, params.requestId)
    const old = records.get(key)
    const tabContext = tabContexts.get(source.tabId) || await refreshTabContext(source.tabId)
    const record = {
      id: params.requestId,
      tabId: source.tabId,
      sessionId: currentSessionId,
      url: params.request.url,
      method: params.request.method,
      type: params.type,
      startedAt: Date.now(),
      requestHeaders: params.request.headers || {},
      responseHeaders: {},
      requestBody: params.request.postData,
      redirectFrom: params.redirectResponse ? old?.url : undefined,
      frameId: params.frameId,
      isIframe: iframeFrames.has(frameKey(params.frameId)),
      pageUrl: tabContext.tabUrl,
      pageDomain: tabContext.tabDomain,
      pageTitle: tabContext.tabTitle,
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
    broadcast({ type: 'RECORD_UPDATED', record })
  }
  if (method === 'Network.responseReceived') {
    const record = records.get(requestKey(source.tabId, params.requestId))
    if (!record) return
    Object.assign(record, {
      status: params.response.status,
      statusText: params.response.statusText,
      responseHeaders: params.response.headers || {},
      mimeType: params.response.mimeType,
    })
    broadcast({ type: 'RECORD_UPDATED', record })
  }
  if (method === 'Network.loadingFinished') {
    const record = records.get(requestKey(source.tabId, params.requestId))
    if (!record) return
    record.finishedAt = Date.now()
    record.duration = record.finishedAt - record.startedAt
    if ((params.encodedDataLength || 0) < settings.maxBodyMB * 1_000_000) {
      try {
        const body = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId })
        record.responseBody = body.body
        record.encoded = body.base64Encoded
        record.responseBodyBytes = body.base64Encoded
          ? Math.max(0, Math.floor(body.body.length * 3 / 4) - (body.body.endsWith('==') ? 2 : body.body.endsWith('=') ? 1 : 0))
          : new TextEncoder().encode(body.body).byteLength
      } catch {}
    }
    await persist(record)
  }
  if (method === 'Network.loadingFailed') {
    const record = records.get(requestKey(source.tabId, params.requestId))
    if (!record) return
    record.error = params.errorText
    record.finishedAt = Date.now()
    record.duration = record.finishedAt - record.startedAt
    await persist(record)
  }
})

async function persist(record) {
  const data = await chrome.storage.local.get('networkRecords')
  const list = data.networkRecords || []
  const index = list.findIndex((item) => item.tabId === record.tabId && item.id === record.id && item.startedAt === record.startedAt)
  if (index >= 0) list[index] = record
  else list.unshift(record)
  await chrome.storage.local.set({ networkRecords: list.slice(0, settings.maxRecords) })
  broadcast({ type: 'RECORD_UPDATED', record })
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const tasks = {
    GET_STATE: async () => {
      await ready
      const state = await chrome.storage.local.get(['networkRecords', 'overrideRules'])
      const storedRecords = state.networkRecords || []
      const { openTabs, historicalTabIds } = await reconcileHistoricalTabs(storedRecords)
      const openTabIds = new Set(openTabs.map(tab => tab.id).filter(tabId => tabId != null))
      await Promise.all(historicalTabIds.filter(tabId => openTabIds.has(tabId)).map(tabId => refreshTabContext(tabId)))
      const currentTab = await activeTab().catch(() => null)
      if (currentTab?.id != null) await refreshTabContext(currentTab.id)
      const networkRecords = storedRecords.map(record => {
        const context = tabContexts.get(record.tabId)
        return context ? { ...record, pageUrl: context.tabUrl, pageDomain: context.tabDomain, pageTitle: context.tabTitle } : record
      })
      const captureTabContexts = captureTabContextsSnapshot()
      if (currentTab?.id != null && !hiddenInvalidTabs.has(currentTab.id) && tabContexts.has(currentTab.id)) captureTabContexts[currentTab.id] = tabContexts.get(currentTab.id)
      const liveTabOrder = openTabs.filter(tab => tab.id != null && isInspectableUrl(tab.url)).map(tab => tab.id)
      const captureTabOrder = [...liveTabOrder, ...historicalTabIds.filter(tabId => !openTabIds.has(tabId))]
      return { ...state, networkRecords, recording, settings, tabCaptureStates: captureStatesSnapshot(), captureTabContexts, captureTabOrder, activeBrowserTabId: currentTab?.id }
    },
    START_RECORDING: startRecording,
    STOP_RECORDING: stopRecording,
    CLEAR_RECORDS: async () => {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : null
      if (tabId == null) records.clear()
      else for (const [key, record] of records) if (record.tabId === tabId) records.delete(key)
      const data = await chrome.storage.local.get('networkRecords')
      const storedRecords = data.networkRecords || []
      const networkRecords = tabId == null ? [] : storedRecords.filter(record => record.tabId !== tabId)
      await chrome.storage.local.set({ networkRecords })
      broadcast({ type: 'RECORDS_CLEARED', tabId })
      return { ok: true, removed: storedRecords.length - networkRecords.length }
    },
    CLEAN_INVALID_TABS: async () => {
      const requestedTabIds = [...new Set((message.tabIds || []).filter(Number.isInteger))]
      const data = await chrome.storage.local.get('networkRecords')
      const storedRecords = data.networkRecords || []
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
      const networkRecords = storedRecords.filter(record => !closedTabIds.has(record.tabId))
      if (networkRecords.length !== storedRecords.length) await chrome.storage.local.set({ networkRecords })
      return { ok: true, tabIds, removedRecords: storedRecords.length - networkRecords.length }
    },
    DISMISS_CLOSED_TAB: async () => {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : null
      if (tabId == null) return { ok: false, error: '缺少网页标签 ID' }
      if (tabCaptureStates.get(tabId)?.state !== 'closed') return { ok: false, error: '只能删除已断开的网页标签' }
      for (const [key, record] of records) if (record.tabId === tabId) records.delete(key)
      const data = await chrome.storage.local.get('networkRecords')
      const storedRecords = data.networkRecords || []
      const networkRecords = storedRecords.filter(record => record.tabId !== tabId)
      await chrome.storage.local.set({ networkRecords })
      tabCaptureStates.delete(tabId)
      tabContexts.delete(tabId)
      broadcast({ type: 'TAB_CAPTURE_DISMISSED', tabId })
      return { ok: true, removed: storedRecords.length - networkRecords.length }
    },
    APPLY_RULES: () => applyRules(message.rules),
    SAVE_SETTINGS: async () => { settings = { ...settings, ...message.settings }; await chrome.storage.local.set({ settings }); return { ok: true } },
  }
  if (!tasks[message.type]) return
  tasks[message.type]().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error.message || error) }))
  return true
})
