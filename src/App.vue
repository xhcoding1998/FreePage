<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AlertTriangle, ArrowRight, BookOpen, Braces, Check, CheckCircle2, CircleAlert, Copy, Database, Download, FileJson, Frame, GitCompareArrows, Layers3, Monitor, MoreHorizontal, Moon, Play, Plus, QrCode, Radio, Search, Settings2, ShieldCheck, SlidersHorizontal, Square, Sun, Trash2, Wrench, X } from 'lucide-vue-next'
import type { NetworkRecord, OverrideRule } from './types'
import { demoRecords, demoRules } from './demo'
import ActionMenu from './components/ActionMenu.vue'
import DeveloperConverter from './components/DeveloperConverter.vue'
import DiffTool from './components/DiffTool.vue'
import QrCodeTool from './components/QrCodeTool.vue'
import SelectMenu from './components/SelectMenu.vue'

type MainTab = 'requests' | 'rules' | 'tools'
type SettingsView = 'preferences' | 'guide'
type ResizableSheet = 'detail' | 'settings' | 'rule' | 'converter' | 'qr' | 'diff'
type DetailTab = 'overview' | 'headers' | 'request' | 'response'
type OverrideEditorKind = 'headers' | 'query'
type OverrideEditorMode = 'fields' | 'json'
type ToastTone = 'success' | 'error' | 'info'
type TabCaptureState = { state: 'connecting' | 'attached' | 'failed' | 'closed'; error?: string; updatedAt?: number }
type TabContext = { tabUrl: string; tabDomain: string; tabTitle: string }
const activeTab = ref<MainTab>('requests')
const detailTab = ref<DetailTab>('overview')
const recording = ref(false)
const records = ref<NetworkRecord[]>([])
const rules = ref<OverrideRule[]>([])
const selected = ref<NetworkRecord | null>(null)
const search = ref('')
const typeFilter = ref('all')
const methodFilter = ref('all')
const errorOnly = ref(false)
const selectedBrowserTab = ref<number | 'all'>('all')
const tabCaptureStates = ref<Record<number, TabCaptureState>>({})
const captureTabContexts = ref<Record<number, TabContext>>({})
const browserTabOrder = ref<number[]>([])
const browserTabsViewport = ref<HTMLElement | null>(null)
const toast = ref<{ message: string; tone: ToastTone } | null>(null)
let toastTimer: number | undefined
const editingRule = ref<OverrideRule | null>(null)
const editingRuleSourceId = ref<number | null>(null)
const headerEditorMode = ref<OverrideEditorMode>('fields')
const queryEditorMode = ref<OverrideEditorMode>('fields')
const headerJsonDraft = ref('{}')
const queryJsonDraft = ref('{}')
const headerJsonError = ref('')
const queryJsonError = ref('')
const headerJsonHighlight = ref<HTMLElement | null>(null)
const queryJsonHighlight = ref<HTMLElement | null>(null)
const theme = ref<'light' | 'dark' | 'system'>((localStorage.getItem('suiye-theme') as any) || (localStorage.getItem('yezhan-theme') as any) || (localStorage.getItem('liantan-theme') as any) || (localStorage.getItem('tracedeck-theme') as any) || 'light')
const themeOptions = [{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }]
const showSettings = ref(false)
const showConverter = ref(false)
const showQrTool = ref(false)
const showDiffTool = ref(false)
const settingsView = ref<SettingsView>('preferences')
const settings = ref({ maxRecords: 500, maxBodyMB: 5, xhrOnly: false, autoClear: false })
const detailHeight = ref(342)
const settingsHeight = ref(560)
const ruleEditorHeight = ref(680)
const converterHeight = ref(650)
const qrToolHeight = ref(700)
const diffToolHeight = ref(700)
const draggingSheet = ref<ResizableSheet | null>(null)
const operationOptions = [
  { label: '设置/替换', value: 'set', description: '添加字段，已有值则替换' },
  { label: '删除', value: 'remove', description: '请求发出前移除该字段' },
]
const resourceTypeOptions = [
  { label: 'Fetch/XHR', value: 'xmlhttprequest' },
  { label: '文档', value: 'main_frame' },
  { label: 'iframe', value: 'sub_frame' },
  { label: '脚本', value: 'script' },
  { label: '样式', value: 'stylesheet' },
  { label: '图片', value: 'image' },
]
const recordLimitOptions = [{ label: '200 条', value: 200 }, { label: '500 条', value: 500 }, { label: '1000 条', value: 1000 }]
const bodyLimitOptions = [{ label: '1 MB', value: 1 }, { label: '5 MB', value: 5 }, { label: '10 MB', value: 10 }, { label: '20 MB', value: 20 }]
const typeFilterOptions = [
  { label: '全部类型', value: 'all' },
  { label: 'Fetch/XHR', value: 'api' },
  { label: 'HTML', value: 'document' },
  { label: 'JS', value: 'script' },
  { label: 'CSS', value: 'stylesheet' },
  { label: '图片', value: 'image' },
  { label: '字体', value: 'font' },
  { label: '媒体', value: 'media' },
  { label: 'WebSocket', value: 'websocket' },
  { label: '其他', value: 'other' },
]
const methodFilterOptions = ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map(value => ({ label: value === 'all' ? '全部方法' : value, value }))
const isExtension = location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && !!chrome.runtime?.id

function applyTheme(value: string) {
  const resolved = value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value
  document.documentElement.dataset.theme = resolved
  localStorage.setItem('suiye-theme', value)
}
watch(theme, applyTheme, { immediate: true })
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => theme.value === 'system' && applyTheme('system'))

const groupedResourceTypes = new Set(['Fetch', 'XHR', 'Document', 'Script', 'Stylesheet', 'Image', 'Font', 'Media', 'WebSocket'])

function matchesTypeFilter(record: NetworkRecord) {
  if (typeFilter.value === 'api') return ['Fetch', 'XHR'].includes(record.type)
  if (typeFilter.value === 'document') return record.type === 'Document'
  if (typeFilter.value === 'script') return record.type === 'Script'
  if (typeFilter.value === 'stylesheet') return record.type === 'Stylesheet'
  if (typeFilter.value === 'image') return record.type === 'Image'
  if (typeFilter.value === 'font') return record.type === 'Font'
  if (typeFilter.value === 'media') return record.type === 'Media'
  if (typeFilter.value === 'websocket') return record.type === 'WebSocket'
  if (typeFilter.value === 'other') return !groupedResourceTypes.has(record.type)
  return true
}

const filteredRecords = computed(() => records.value.filter(record => {
  const typeMatches = matchesTypeFilter(record)
  const methodMatches = methodFilter.value === 'all' || record.method === methodFilter.value
  const textMatches = !search.value || record.url.toLowerCase().includes(search.value.toLowerCase()) || record.method.includes(search.value.toUpperCase())
  const tabMatches = selectedBrowserTab.value === 'all' || record.tabId === selectedBrowserTab.value
  const errorMatches = !errorOnly.value || (record.status || 0) >= 400 || !!record.error
  return typeMatches && methodMatches && textMatches && tabMatches && errorMatches
}))
const enabledRuleCount = computed(() => rules.value.filter(rule => rule.enabled).length)
const browserTabs = computed(() => {
  const tabs = new Map<number, { id: number; domain: string; title: string; url: string; count: number }>()
  Object.entries(captureTabContexts.value).forEach(([tabId, context]) => {
    tabs.set(Number(tabId), { id: Number(tabId), domain: context.tabDomain || '页面域名未知', title: context.tabTitle || '未命名页面', url: context.tabUrl || '', count: 0 })
  })
  records.value.forEach(record => {
    const current = tabs.get(record.tabId)
    if (!current) {
      tabs.set(record.tabId, { id: record.tabId, domain: record.pageDomain || '页面域名未知', title: record.pageTitle || '未命名页面', url: record.pageUrl || '', count: 1 })
    } else {
      current.count += 1
      if (record.pageDomain && current.domain === '页面域名未知') current.domain = record.pageDomain
      if (record.pageTitle && current.title === '未命名页面') current.title = record.pageTitle
    }
  })
  return [...tabs.values()].sort((left, right) => {
    const leftIndex = browserTabOrder.value.indexOf(left.id)
    const rightIndex = browserTabOrder.value.indexOf(right.id)
    if (leftIndex === -1 && rightIndex === -1) return 0
    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1
    return leftIndex - rightIndex
  })
})

function rememberBrowserTabs(tabIds: number[]) {
  const known = new Set(browserTabOrder.value)
  const additions = tabIds.filter(tabId => Number.isFinite(tabId) && !known.has(tabId))
  if (additions.length) browserTabOrder.value = [...browserTabOrder.value, ...additions]
}

watch(browserTabs, (tabs) => {
  if (!tabs.length) { selectedBrowserTab.value = 'all'; return }
  if (selectedBrowserTab.value === 'all' || !tabs.some(tab => tab.id === selectedBrowserTab.value)) selectedBrowserTab.value = tabs[0].id
})

let browserTabRevealFrame = 0
async function revealSelectedBrowserTab(tabId: number | 'all') {
  if (typeof tabId !== 'number') return
  await nextTick()
  cancelAnimationFrame(browserTabRevealFrame)
  browserTabRevealFrame = requestAnimationFrame(() => {
    const viewport = browserTabsViewport.value
    const item = viewport?.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)
    if (!viewport || !item) return
    const viewportRect = viewport.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const safeLeft = viewportRect.left + 6
    const safeRight = viewportRect.right - 6
    let targetLeft = viewport.scrollLeft
    if (itemRect.left < safeLeft) targetLeft -= safeLeft - itemRect.left
    else if (itemRect.right > safeRight) targetLeft += itemRect.right - safeRight
    if (Math.abs(targetLeft - viewport.scrollLeft) < 1) return
    viewport.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
  })
}

watch(
  [selectedBrowserTab, () => browserTabs.value.map(tab => tab.id).join(',')],
  ([tabId]) => { void revealSelectedBrowserTab(tabId) },
  { flush: 'post' },
)

const compactDomain = (domain: string) => {
  const parts = domain.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (!parts.length) return '未知'
  const genericPrefixes = new Set(['app', 'admin', 'api', 'dev', 'test', 'stage', 'staging'])
  const label = genericPrefixes.has(parts[0]) && parts[1] ? `${parts[0]}.${parts[1]}` : parts[0]
  return label.length > 12 ? `${label.slice(0, 11)}…` : label
}
const tabCaptureLabel = (tabId: number) => {
  const state = tabCaptureStates.value[tabId]
  if (state?.state === 'closed') return '网页已关闭，正在显示历史请求'
  if (!recording.value) return '捕获已暂停'
  if (!state) return '等待连接'
  if (state.state === 'attached') return '已连接'
  if (state.state === 'connecting') return '连接中'
  return `连接失败${state.error ? `：${state.error}` : ''}`
}
const browserTabTitle = (tab: { id: number; domain: string; title: string; count: number }) => `${tab.domain}\n${tab.title}\n${tab.count} 个请求 · ${tabCaptureLabel(tab.id)}`
const currentBrowserTab = computed(() => browserTabs.value.find(tab => tab.id === selectedBrowserTab.value))
const invalidBrowserTabs = computed(() => browserTabs.value.filter(tab => tab.count === 0 || tabCaptureStates.value[tab.id]?.state === 'closed'))
const clearMenuItems = computed(() => [
  {
    label: '清空当前网页',
    value: 'current',
    description: currentBrowserTab.value ? `${currentBrowserTab.value.count} 条` : '不可用',
    disabled: !currentBrowserTab.value || currentBrowserTab.value.count === 0,
  },
  {
    label: '清理无效网页',
    value: 'invalid',
    description: `${invalidBrowserTabs.value.length} 个`,
    disabled: invalidBrowserTabs.value.length === 0,
  },
  {
    label: '清空全部请求',
    value: 'all',
    description: `${records.value.length} 条`,
    danger: true,
    disabled: records.value.length === 0,
  },
])

const scopedRecords = computed(() => selectedBrowserTab.value === 'all' ? records.value : records.value.filter(record => record.tabId === selectedBrowserTab.value))
const stats = computed(() => ({
  total: scopedRecords.value.length,
  errors: scopedRecords.value.filter(r => (r.status || 0) >= 400 || r.error).length,
  bodyBytes: scopedRecords.value.filter(r => r.responseBody).reduce((n, r) => n + (r.responseBodyBytes ?? new TextEncoder().encode(r.responseBody || '').byteLength), 0),
}))
const hasActiveRequestFilters = computed(() => typeFilter.value !== 'all' || methodFilter.value !== 'all' || errorOnly.value || !!search.value)
const requestFilterSummary = computed(() => filteredRecords.value.length === stats.value.total ? `${stats.value.total} 条` : `${filteredRecords.value.length}/${stats.value.total} 条`)

function resetRequestFilters() {
  typeFilter.value = 'all'
  methodFilter.value = 'all'
  errorOnly.value = false
  search.value = ''
}

function removeBrowserTabLocally(tabId: number) {
  records.value = records.value.filter(record => record.tabId !== tabId)
  const { [tabId]: _removedState, ...remainingStates } = tabCaptureStates.value
  const { [tabId]: _removedContext, ...remainingContexts } = captureTabContexts.value
  tabCaptureStates.value = remainingStates
  captureTabContexts.value = remainingContexts
  browserTabOrder.value = browserTabOrder.value.filter(id => id !== tabId)
  if (selected.value?.tabId === tabId) selected.value = null
  if (selectedBrowserTab.value === tabId) selectedBrowserTab.value = browserTabs.value.find(tab => tab.id !== tabId)?.id || 'all'
}

async function dismissClosedTab(tabId: number) {
  if (tabCaptureStates.value[tabId]?.state !== 'closed') return
  if (isExtension) {
    const result = await send({ type: 'DISMISS_CLOSED_TAB', tabId })
    if (result?.ok === false) return notify(result.error)
  }
  removeBrowserTabLocally(tabId)
  notify('已删除断联网页及其历史请求')
}

const hostname = (url: string) => { try { return new URL(url).hostname } catch { return url } }
const endpoint = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}` } catch { return url } }
const formatTime = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 2 : 1)} MB`
}
const statusClass = (status?: number) => !status ? 'muted' : status >= 500 ? 'danger' : status >= 400 ? 'warning' : status >= 300 ? 'redirect' : 'success'
const requestErrorLabel = (record: NetworkRecord) => record.error || ((record.status || 0) >= 400 ? `HTTP ${record.status}` : '')
const pretty = (text?: string) => { if (!text) return '暂无内容'; try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text } }
const parseBody = (text?: string) => { if (!text) return null; try { return JSON.parse(text) } catch { return text } }
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function highlightCode(text?: string) {
  const escaped = escapeHtml(pretty(text))
  return escaped.replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+\-]?\d+)?\b/gi, (match, quoted, colon) => {
    if (quoted) return `<span class="${colon ? 'json-key' : 'json-string'}">${quoted}</span>${colon || ''}`
    if (/true|false/i.test(match)) return `<span class="json-boolean">${match}</span>`
    if (/null/i.test(match)) return `<span class="json-null">${match}</span>`
    return `<span class="json-number">${match}</span>`
  })
}
const notify = (message: string, tone: ToastTone = 'success') => {
  toast.value = { message, tone }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = null }, 2400)
}

async function send<T = any>(message: any): Promise<T> {
  if (!isExtension) throw new Error('请在扩展环境中使用此功能')
  return chrome.runtime.sendMessage(message)
}

async function toggleRecording() {
  if (!isExtension) {
    recording.value = !recording.value
    tabCaptureStates.value = recording.value
      ? Object.fromEntries([...new Set(records.value.map(record => record.tabId))].map(tabId => [tabId, { state: 'attached' }]))
      : {}
    notify(recording.value ? '演示记录已开始' : '演示记录已暂停')
    return
  }
  const shouldRecord = !recording.value
  const result = await send({ type: shouldRecord ? 'START_RECORDING' : 'STOP_RECORDING' })
  if (result?.ok === false) return notify(result.error)
  recording.value = result?.recording ?? shouldRecord
  tabCaptureStates.value = result?.tabCaptureStates || {}
  captureTabContexts.value = result?.captureTabContexts || {}
  notify(shouldRecord ? '已开始捕获流量' : '已暂停捕获')
}

async function clearRecords(scope: string) {
  if (scope === 'invalid') {
    const requestedTabIds = invalidBrowserTabs.value.map(tab => tab.id)
    if (!requestedTabIds.length) return notify('当前没有无效网页标签')
    let removedTabIds = requestedTabIds
    if (isExtension) {
      const result = await send<{ ok: boolean; error?: string; tabIds?: number[] }>({ type: 'CLEAN_INVALID_TABS', tabIds: requestedTabIds })
      if (result?.ok === false) return notify(result.error || '清理失败')
      removedTabIds = result?.tabIds || []
    }
    removedTabIds.forEach(removeBrowserTabLocally)
    notify(removedTabIds.length ? `已清理 ${removedTabIds.length} 个无效网页标签` : '没有可清理的无效网页标签')
    return
  }
  const tabId = scope === 'current' && typeof selectedBrowserTab.value === 'number' ? selectedBrowserTab.value : undefined
  if (scope === 'current' && tabId == null) return notify('当前没有可清理的网页')
  if (isExtension) {
    const result = await send({ type: 'CLEAR_RECORDS', tabId })
    if (result?.ok === false) return notify(result.error)
  }
  records.value = tabId == null ? [] : records.value.filter(record => record.tabId !== tabId)
  selected.value = null
  notify(tabId == null ? '全部请求记录已清空' : '当前网页请求已清空')
}

function updateRecord(record: NetworkRecord) {
  rememberBrowserTabs([record.tabId])
  const index = records.value.findIndex(r => r.tabId === record.tabId && r.id === record.id && r.startedAt === record.startedAt)
  if (index >= 0) records.value[index] = record
  else records.value.unshift(record)
  if (selected.value?.tabId === record.tabId && selected.value?.id === record.id) selected.value = record
}

async function saveRules() {
  if (isExtension) {
    const result = await send({ type: 'APPLY_RULES', rules: rules.value })
    if (result?.ok === false) { notify(result.error); return false }
  }
  notify('覆写规则已应用')
  return true
}

async function saveSettings() {
  if (isExtension) {
    const result = await send({ type: 'SAVE_SETTINGS', settings: settings.value })
    if (result?.ok === false) return notify(result.error)
  }
  showSettings.value = false
  notify('设置已保存')
}

function openSettings(view: SettingsView = 'preferences') {
  settingsView.value = view
  showSettings.value = true
}

function openUtilityTool(tool: 'converter' | 'qr' | 'diff') {
  showConverter.value = tool === 'converter'
  showQrTool.value = tool === 'qr'
  showDiffTool.value = tool === 'diff'
}

function startSheetResize(kind: ResizableSheet, event: PointerEvent) {
  event.preventDefault()
  const heightRef = kind === 'detail' ? detailHeight : kind === 'settings' ? settingsHeight : kind === 'rule' ? ruleEditorHeight : kind === 'converter' ? converterHeight : kind === 'qr' ? qrToolHeight : diffToolHeight
  const minimumHeight = kind === 'detail' ? 260 : kind === 'settings' ? 360 : kind === 'rule' ? 420 : kind === 'converter' ? 430 : 480
  const sheet = (event.currentTarget as HTMLElement).closest<HTMLElement>('.resizable-sheet')
  draggingSheet.value = kind
  const startY = event.clientY
  const startHeight = sheet?.getBoundingClientRect().height || heightRef.value
  const move = (moveEvent: PointerEvent) => {
    const maximumHeight = Math.max(minimumHeight, window.innerHeight - 78)
    heightRef.value = Math.max(minimumHeight, Math.min(maximumHeight, startHeight + startY - moveEvent.clientY))
  }
  const end = () => {
    draggingSheet.value = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end, { once: true })
  window.addEventListener('pointercancel', end, { once: true })
}

function addRule() {
  const rule: OverrideRule = { id: Date.now() % 90000 + 1000, name: '新建覆写规则', enabled: true, domain: '', resourceTypes: ['xmlhttprequest'], headers: [{ operation: 'set', name: 'x-forwarded-for', value: '' }], query: [], hits: 0 }
  editingRule.value = rule
  editingRuleSourceId.value = null
  resetOverrideEditors(rule)
}

function cloneRuleDraft(rule: OverrideRule): OverrideRule {
  return {
    ...rule,
    resourceTypes: [...rule.resourceTypes],
    headers: rule.headers.map(header => ({ ...header })),
    query: rule.query.map(query => ({ ...query })),
  }
}

function openRuleEditor(rule: OverrideRule) {
  editingRuleSourceId.value = rule.id
  editingRule.value = cloneRuleDraft(rule)
  resetOverrideEditors(editingRule.value)
}

function closeRuleEditor() {
  editingRule.value = null
  editingRuleSourceId.value = null
}

const isCreatingRule = computed(() => !!editingRule.value && editingRuleSourceId.value === null)

function entriesToJson(entries: OverrideRule['headers']) {
  return JSON.stringify(Object.fromEntries(entries.filter(entry => entry.name).map(entry => [entry.name, entry.operation === 'remove' ? null : (entry.value || '')])), null, 2)
}

function resetOverrideEditors(rule: OverrideRule) {
  headerEditorMode.value = 'fields'
  queryEditorMode.value = 'fields'
  headerJsonDraft.value = entriesToJson(rule.headers)
  queryJsonDraft.value = entriesToJson(rule.query)
  headerJsonError.value = ''
  queryJsonError.value = ''
}

function normalizeJsonValue(value: unknown) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function parseOverrideJson(text: string) {
  let parsed: any
  try { parsed = JSON.parse(text) }
  catch { throw new Error('JSON 语法不正确，请检查括号、引号和逗号') }
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Object.entries(parsed).map(([name, value]) => ({ name, operation: value === null ? 'remove' : 'set', value }))
      : null
  if (!source) throw new Error('JSON 必须是对象或数组')
  return source.map((item: any, index: number) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 项不是有效对象`)
    const name = String(item.name || '').trim()
    if (!name) throw new Error(`第 ${index + 1} 项缺少名称`)
    const operation = item.operation === 'remove' ? 'remove' : 'set'
    return { operation, name, ...(operation === 'set' ? { value: normalizeJsonValue(item.value) } : {}) } as OverrideRule['headers'][number]
  })
}

function applyOverrideJson(kind: OverrideEditorKind) {
  if (!editingRule.value) return false
  const draft = kind === 'headers' ? headerJsonDraft : queryJsonDraft
  const error = kind === 'headers' ? headerJsonError : queryJsonError
  try {
    editingRule.value[kind] = parseOverrideJson(draft.value)
    error.value = ''
    return true
  } catch (reason: any) {
    error.value = reason?.message || 'JSON 格式不正确'
    return false
  }
}

function switchOverrideEditorMode(kind: OverrideEditorKind, mode: OverrideEditorMode) {
  if (!editingRule.value) return
  const currentMode = kind === 'headers' ? headerEditorMode : queryEditorMode
  const draft = kind === 'headers' ? headerJsonDraft : queryJsonDraft
  if (currentMode.value === mode) return
  if (mode === 'json') {
    draft.value = entriesToJson(editingRule.value[kind])
    ;(kind === 'headers' ? headerJsonError : queryJsonError).value = ''
    currentMode.value = mode
    return
  }
  if (applyOverrideJson(kind)) currentMode.value = mode
}

function syncJsonEditorScroll(kind: OverrideEditorKind, event: Event) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  const highlight = kind === 'headers' ? headerJsonHighlight.value : queryJsonHighlight.value
  if (!highlight) return
  highlight.scrollTop = textarea.scrollTop
  highlight.scrollLeft = textarea.scrollLeft
}

async function commitRuleEditor() {
  if (!editingRule.value) return
  if (headerEditorMode.value === 'json' && !applyOverrideJson('headers')) return notify('Header JSON 格式不正确')
  if (queryEditorMode.value === 'json' && !applyOverrideJson('query')) return notify('Query JSON 格式不正确')
  const draft = cloneRuleDraft(editingRule.value)
  const sourceId = editingRuleSourceId.value
  if (sourceId == null) rules.value.unshift(draft)
  else {
    const index = rules.value.findIndex(rule => rule.id === sourceId)
    if (index >= 0) rules.value[index] = draft
  }
  if (await saveRules()) closeRuleEditor()
}

async function removeRule(rule: OverrideRule) {
  const sourceId = editingRuleSourceId.value ?? rule.id
  rules.value = rules.value.filter(item => item.id !== sourceId)
  closeRuleEditor()
  await saveRules()
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify('已复制到剪贴板')
  } catch {
    notify('复制失败，请检查剪贴板权限', 'error')
  }
}
function copyCurl(record: NetworkRecord) {
  const headers = Object.entries(record.requestHeaders || {}).map(([key, value]) => `-H '${key}: ${String(value).replace(/'/g, "'\\''")}'`).join(' ')
  const body = record.requestBody ? ` --data-raw '${record.requestBody.replace(/'/g, "'\\''")}'` : ''
  copyText(`curl '${record.url}' -X ${record.method} ${headers}${body}`)
}
function copyCompleteRequest(record: NetworkRecord) {
  copyText(JSON.stringify({
    meta: { url: record.url, method: record.method, status: record.status, statusText: record.statusText, type: record.type, tabId: record.tabId, iframe: !!record.isIframe, durationMs: record.duration, startedAt: new Date(record.startedAt).toISOString() },
    request: { headers: record.requestHeaders, body: parseBody(record.requestBody) },
    response: { headers: record.responseHeaders, body: parseBody(record.responseBody), mimeType: record.mimeType, encoded: !!record.encoded, error: record.error || null },
  }, null, 2))
}
function exportHar() {
  const har = { log: { version: '1.2', creator: { name: '随页', version: '0.1.0' }, entries: records.value.map(r => ({ startedDateTime: new Date(r.startedAt).toISOString(), time: r.duration || 0, request: { method: r.method, url: r.url, headers: Object.entries(r.requestHeaders).map(([name, value]) => ({ name, value: String(value) })) }, response: { status: r.status || 0, statusText: r.statusText || '', headers: Object.entries(r.responseHeaders).map(([name, value]) => ({ name, value: String(value) })), content: { mimeType: r.mimeType || '', text: r.responseBody || '' } } })) } }
  const url = URL.createObjectURL(new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `suiye-${Date.now()}.har`; a.click(); URL.revokeObjectURL(url)
  notify('HAR 已导出')
}

onMounted(async () => {
  if (isExtension) {
    const state = await send({ type: 'GET_STATE' })
    recording.value = !!state.recording
    tabCaptureStates.value = state.tabCaptureStates || {}
    captureTabContexts.value = state.captureTabContexts || {}
    rememberBrowserTabs(state.captureTabOrder || [...Object.keys(captureTabContexts.value).map(Number), ...records.value.map(record => record.tabId)])
    if (typeof state.activeBrowserTabId === 'number') selectedBrowserTab.value = state.activeBrowserTabId
    records.value = state.networkRecords?.length ? state.networkRecords : []
    rules.value = Array.isArray(state.overrideRules) ? state.overrideRules : []
    settings.value = state.settings || settings.value
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'RECORD_UPDATED') updateRecord(message.record)
      if (message.type === 'RECORDS_CLEARED') {
        records.value = message.tabId == null ? [] : records.value.filter(record => record.tabId !== message.tabId)
        if (selected.value && (message.tabId == null || selected.value.tabId === message.tabId)) selected.value = null
      }
      if (message.type === 'STATE_CHANGED') recording.value = message.recording
      if (message.type === 'ACTIVE_BROWSER_TAB_CHANGED') {
        rememberBrowserTabs([message.tabId])
        if (message.context) captureTabContexts.value = { ...captureTabContexts.value, [message.tabId]: message.context }
        selectedBrowserTab.value = message.tabId
        selected.value = null
      }
      if (message.type === 'TAB_CAPTURE_STATE_CHANGED') {
        rememberBrowserTabs([message.tabId])
        tabCaptureStates.value = { ...tabCaptureStates.value, [message.tabId]: message.captureState }
        if (message.context) captureTabContexts.value = { ...captureTabContexts.value, [message.tabId]: message.context }
      }
      if (message.type === 'TAB_CAPTURE_STATES_RESET') { tabCaptureStates.value = {}; captureTabContexts.value = {} }
      if (message.type === 'TAB_CAPTURE_REMOVED') {
        rememberBrowserTabs([message.tabId])
        tabCaptureStates.value = { ...tabCaptureStates.value, [message.tabId]: message.captureState || { state: 'closed', error: '浏览器标签页已关闭' } }
        if (message.context) captureTabContexts.value = { ...captureTabContexts.value, [message.tabId]: message.context }
      }
      if (message.type === 'TAB_CAPTURE_DISMISSED') removeBrowserTabLocally(message.tabId)
      if (message.type === 'TAB_CONTEXT_UPDATED') {
        rememberBrowserTabs([message.tabId])
        captureTabContexts.value = { ...captureTabContexts.value, [message.tabId]: message.context }
        records.value = records.value.map(record => record.tabId === message.tabId
          ? { ...record, pageUrl: message.context.tabUrl, pageDomain: message.context.tabDomain, pageTitle: message.context.tabTitle }
          : record)
      }
    })
  } else {
    records.value = demoRecords
    rules.value = demoRules
    recording.value = true
    tabCaptureStates.value = Object.fromEntries([...new Set(demoRecords.map(record => record.tabId))].map(tabId => [tabId, { state: 'attached' }]))
    rememberBrowserTabs([...new Set(demoRecords.map(record => record.tabId))])
    selectedBrowserTab.value = browserTabs.value[0]?.id || 'all'
  }
  selected.value = null
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-mark"><img src="/icons/suiye.svg" alt="" /></div>
      <div class="brand-copy"><strong>随页</strong><span>BROWSER TOOLKIT</span></div>
      <div class="top-spacer" />
      <SelectMenu v-model="theme" :options="themeOptions" compact align="right">
        <template #icon><Sun v-if="theme === 'light'" :size="15" /><Moon v-else-if="theme === 'dark'" :size="15" /><Monitor v-else :size="15" /></template>
      </SelectMenu>
      <button class="icon-button" title="设置" aria-label="设置" @click="openSettings()"><Settings2 :size="17" /></button>
    </header>

    <nav class="primary-nav" aria-label="功能导航">
      <button :class="{ active: activeTab === 'requests', 'capture-live': recording }" @click="activeTab = 'requests'"><span class="nav-icon"><Radio :size="17" /></span><span>请求</span><b>{{ records.length }}</b></button>
      <button :class="{ active: activeTab === 'rules', 'rules-live': enabledRuleCount > 0 }" @click="activeTab = 'rules'"><span class="nav-icon"><SlidersHorizontal :size="17" /></span><span>规则</span><b>{{ enabledRuleCount }}</b></button>
      <button :class="{ active: activeTab === 'tools' }" @click="activeTab = 'tools'"><span class="nav-icon"><Wrench :size="17" /></span><span>工具</span></button>
    </nav>

    <Transition name="page" mode="out-in">
    <section v-if="activeTab === 'requests'" class="page requests-page">
      <header class="page-toolbar requests-toolbar">
        <div><b>请求记录</b><span>{{ recording ? '正在记录浏览器网页产生的网络流量' : '捕获已暂停，历史请求仍可查看' }}</span></div>
        <button class="capture-toggle" :class="{ recording }" :aria-pressed="recording" :aria-label="recording ? '停止捕获流量' : '开始捕获流量'" @click="toggleRecording">
          <Square v-if="recording" :size="11" fill="currentColor" />
          <Play v-else :size="12" fill="currentColor" />
          <span>{{ recording ? '停止捕获' : '开始捕获' }}</span>
        </button>
      </header>
      <div ref="browserTabsViewport" class="browser-tabs" role="tablist" aria-label="浏览器标签页">
        <span class="browser-tabs-label" aria-hidden="true">网页</span>
        <div v-for="tab in browserTabs" :key="tab.id" class="browser-tab-wrap" :data-tab-id="tab.id" :class="{ closed: tabCaptureStates[tab.id]?.state === 'closed' }">
          <button class="browser-tab-item" role="tab" :aria-selected="selectedBrowserTab === tab.id" :class="{ active: selectedBrowserTab === tab.id, closed: tabCaptureStates[tab.id]?.state === 'closed' }" :title="browserTabTitle(tab)" @click="selectedBrowserTab = tab.id; selected = null"><i class="tab-capture-indicator" :class="tabCaptureStates[tab.id]?.state || 'idle'" /><span class="tab-label"><strong>{{ compactDomain(tab.domain) }}</strong></span><span v-if="tabCaptureStates[tab.id]?.state === 'closed'" class="tab-offline-badge">已断开</span><b class="tab-request-count">{{ tab.count }}</b></button>
          <button v-if="tabCaptureStates[tab.id]?.state === 'closed'" type="button" class="tab-dismiss-button" title="删除断联网页及其历史请求" :aria-label="`删除断联网页 ${tab.domain}`" @click.stop="dismissClosedTab(tab.id)"><X :size="11" /></button>
        </div>
      </div>

      <div class="request-tools" aria-label="当前网页的请求筛选">
        <label class="search"><Search :size="14" /><input v-model="search" placeholder="搜索当前网页请求" /></label>
        <div class="compact-filter-bar">
          <SelectMenu v-model="typeFilter" :options="typeFilterOptions" compact class="request-filter-select type-select" />
          <SelectMenu v-model="methodFilter" :options="methodFilterOptions" compact class="request-filter-select method-select" />
          <button type="button" class="error-filter-toggle" :class="{ active: errorOnly }" :aria-pressed="errorOnly" @click="errorOnly = !errorOnly"><AlertTriangle :size="12" /><span>错误</span><b>{{ stats.errors }}</b></button>
          <Transition name="filter-reset">
            <button v-if="hasActiveRequestFilters" type="button" class="reset-filters" title="重置筛选" aria-label="重置筛选" @click="resetRequestFilters"><X :size="13" /></button>
          </Transition>
          <span class="filter-result" title="筛选结果与已保存响应正文大小"><Database :size="11" />{{ requestFilterSummary }}<span class="body-size"> · {{ formatBytes(stats.bodyBytes) }}</span></span>
        </div>
      </div>

      <div class="request-list">
        <button v-for="record in filteredRecords" :key="`${record.tabId}:${record.id}:${record.startedAt}`" class="request-row" :class="{ selected: selected?.tabId === record.tabId && selected?.id === record.id }" @click="selected = record">
          <span class="method" :class="record.method.toLowerCase()">{{ record.method }}</span>
          <span class="request-main"><strong>{{ endpoint(record.url) }}</strong><small><span>{{ hostname(record.url) }} · {{ record.type }}</span><span v-if="selectedBrowserTab === 'all'" class="tab-badge">{{ record.pageTitle || record.pageDomain || '页面未知' }}</span><span v-if="record.isIframe" class="iframe-badge"><Frame :size="10" /> iframe</span></small></span>
          <span class="request-meta"><b :class="statusClass(record.error ? 500 : record.status)">{{ record.error ? 'ERR' : (record.status || '—') }}</b><small v-if="requestErrorLabel(record)" class="request-error" :title="requestErrorLabel(record)">{{ requestErrorLabel(record) }}</small><small v-else>{{ record.duration ?? '…' }} ms</small></span>
        </button>
        <div v-if="!filteredRecords.length" class="empty-state"><Radio :size="28" /><strong>还没有捕获到请求</strong><span>点击请求页“开始捕获”，然后刷新页面</span></div>
      </div>

      <Transition name="sheet">
      <div v-if="selected" class="sheet-backdrop request-detail-backdrop" @click.self="selected = null">
      <aside class="detail-panel resizable-sheet" :class="{ dragging: draggingSheet === 'detail' }" :style="{ height: `${detailHeight}px` }" role="dialog" aria-modal="true" aria-label="请求详情">
        <button class="resize-handle" title="拖动调整详情高度" aria-label="拖动调整请求详情高度" @pointerdown="startSheetResize('detail', $event)"><i /></button>
        <div class="detail-title"><div><span class="method" :class="selected.method.toLowerCase()">{{ selected.method }}</span><strong>{{ endpoint(selected.url) }}</strong></div><button @click="selected = null"><X :size="16" /></button></div>
        <div class="detail-tabs">
          <button v-for="tab in [['overview','概览'],['headers','请求头'],['request','请求体'],['response','响应']]" :key="tab[0]" :class="{ active: detailTab === tab[0] }" @click="detailTab = tab[0] as DetailTab">{{ tab[1] }}</button>
        </div>
        <div class="detail-content">
          <template v-if="detailTab === 'overview'">
            <dl><div><dt>状态</dt><dd :class="statusClass(selected.status)">{{ selected.status }} {{ selected.statusText }}</dd></div><div><dt>耗时</dt><dd>{{ selected.duration }} ms</dd></div><div><dt>类型</dt><dd>{{ selected.mimeType || selected.type }}</dd></div><div><dt>发起时间</dt><dd>{{ formatTime(selected.startedAt) }}</dd></div></dl>
            <div v-if="selected.error || (selected.status || 0) >= 400" class="error-banner"><AlertTriangle :size="14" /><span><b>{{ selected.error ? '网络请求失败' : `HTTP ${selected.status}` }}</b><small>{{ selected.error || selected.statusText || '服务器返回了错误状态' }}</small></span></div>
            <label>完整 URL</label><div class="copy-field"><span>{{ selected.url }}</span><button @click="copyText(selected!.url)"><Copy :size="14" /></button></div>
          </template>
          <template v-else-if="detailTab === 'headers'">
            <div class="kv" v-for="(value, key) in selected.requestHeaders" :key="key"><b>{{ key }}</b><span>{{ value }}</span></div>
          </template>
          <div v-else class="code-viewer"><div class="code-toolbar"><span>{{ detailTab === 'request' ? 'REQUEST BODY' : 'RESPONSE BODY' }}</span><button @click="copyText(pretty(detailTab === 'request' ? selected.requestBody : selected.responseBody))"><Copy :size="13" />复制</button></div><pre v-html="highlightCode(detailTab === 'request' ? selected.requestBody : selected.responseBody)" /></div>
        </div>
        <div class="detail-actions"><button @click="copyCurl(selected)"><Copy :size="14" />复制 cURL</button><button class="primary-action" @click="copyCompleteRequest(selected)"><FileJson :size="14" />复制完整 Request</button></div>
      </aside>
      </div>
      </Transition>
    </section>

    <section v-else-if="activeTab === 'rules'" class="page rules-page">
      <header class="page-toolbar rules-toolbar"><div><b>请求覆写</b><span>修改 Header 与 Query，规则在请求发出前生效</span></div><button class="primary-button" @click="addRule"><Plus :size="15" />新建规则</button></header>
      <div class="rules-summary"><span><Layers3 :size="16" />规则概览</span><b>{{ enabledRuleCount }} 条启用</b><small>共 {{ rules.length }} 条规则</small></div>
      <div class="rule-list">
        <div v-if="!rules.length" class="rules-empty"><SlidersHorizontal :size="26" /><strong>还没有覆写规则</strong><span>新建规则后，可修改请求 Header 或 Query 参数。</span></div>
        <article v-for="rule in rules" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
          <div class="rule-top"><button class="toggle" :class="{ on: rule.enabled }" :aria-label="`${rule.enabled ? '停用' : '启用'}规则 ${rule.name}`" @click="rule.enabled = !rule.enabled; saveRules()"><i /></button><div><input v-model="rule.name" @change="saveRules" /><span>{{ rule.domain || '所有域名' }}</span></div><em>{{ rule.hits }} 次命中</em><button class="icon-button" :aria-label="`编辑规则 ${rule.name}`" @click="openRuleEditor(rule)"><MoreHorizontal :size="17" /></button></div>
          <div class="rule-body">
            <div v-for="header in rule.headers" :key="header.name" class="rule-line"><span class="tag header">HEADER</span><code>{{ header.name }}</code><i>→</i><code>{{ header.operation === 'remove' ? '删除' : header.value }}</code></div>
            <div v-for="query in rule.query" :key="query.name" class="rule-line"><span class="tag query">QUERY</span><code>{{ query.name }}</code><i>→</i><code>{{ query.operation === 'remove' ? '删除' : query.value }}</code></div>
          </div>
        </article>
      </div>
    </section>

    <section v-else class="page tools-page">
      <header class="page-toolbar tools-toolbar">
        <div><b>开发工具</b><span>常用转换与本地处理，内容不会离开浏览器</span></div>
        <span class="page-toolbar-status"><ShieldCheck :size="14" />本地处理</span>
      </header>
      <div class="tool-card-list">
        <button class="tool-card available" type="button" @click="openUtilityTool('converter')">
          <span class="tool-card-icon converter"><Braces :size="21" /></span>
          <span class="tool-card-copy"><b>开发转换</b><small>JSON、编码、JWT 与时间工具</small></span>
          <span class="tool-card-action">打开<ArrowRight :size="15" /></span>
        </button>
        <button class="tool-card available" type="button" @click="openUtilityTool('qr')">
          <span class="tool-card-icon qrcode"><QrCode :size="21" /></span>
          <span class="tool-card-copy"><b>二维码</b><small>生成、复制与下载</small></span>
          <span class="tool-card-action">打开<ArrowRight :size="15" /></span>
        </button>
        <button class="tool-card available" type="button" @click="openUtilityTool('diff')">
          <span class="tool-card-icon diff"><GitCompareArrows :size="21" /></span>
          <span class="tool-card-copy"><b>内容对比</b><small>文本、JSON 与请求差异</small></span>
          <span class="tool-card-action">打开<ArrowRight :size="15" /></span>
        </button>
      </div>
    </section>

    </Transition>

    <footer v-if="activeTab === 'requests'" class="bottom-bar">
      <div class="capture-status" :class="{ active: recording }" role="status" aria-live="polite"><i /><span>{{ recording ? '正在捕获' : '捕获已暂停' }}</span></div>
      <ActionMenu label="清空" title="选择清空范围" :items="clearMenuItems" @select="clearRecords"><template #icon><Trash2 :size="14" /></template></ActionMenu>
      <button class="footer-icon" title="导出 HAR" @click="exportHar"><Download :size="14" /><span>导出</span></button>
    </footer>
    <footer v-else-if="activeTab === 'rules'" class="bottom-bar rules-bottom-bar">
      <div class="rules-footer-state"><b>{{ enabledRuleCount }} 条启用</b><span>共 {{ rules.length }} 条规则</span></div>
      <div class="rules-footer-note"><Check :size="13" /><span>保存后立即生效</span></div>
    </footer>
    <Transition name="sheet">
      <div v-if="showConverter" class="sheet-backdrop converter-backdrop" @click.self="showConverter = false">
        <DeveloperConverter :height="converterHeight" :dragging="draggingSheet === 'converter'" @close="showConverter = false" @resize-start="startSheetResize('converter', $event)" @notify="notify" />
      </div>
    </Transition>
    <Transition name="sheet">
      <div v-if="showQrTool" class="sheet-backdrop utility-tool-backdrop" @click.self="showQrTool = false">
        <QrCodeTool :height="qrToolHeight" :dragging="draggingSheet === 'qr'" @close="showQrTool = false" @resize-start="startSheetResize('qr', $event)" @notify="notify" />
      </div>
    </Transition>
    <Transition name="sheet">
      <div v-if="showDiffTool" class="sheet-backdrop utility-tool-backdrop" @click.self="showDiffTool = false">
        <DiffTool :height="diffToolHeight" :dragging="draggingSheet === 'diff'" @close="showDiffTool = false" @resize-start="startSheetResize('diff', $event)" @notify="notify" />
      </div>
    </Transition>
    <Transition name="sheet">
      <div v-if="showSettings" class="sheet-backdrop" @click.self="showSettings = false">
        <section class="settings-panel resizable-sheet" :class="{ 'guide-open': settingsView === 'guide', dragging: draggingSheet === 'settings' }" :style="{ height: `${settingsHeight}px` }" role="dialog" aria-modal="true" aria-label="随页设置">
          <button class="resize-handle" title="拖动调整设置面板高度" aria-label="拖动调整设置面板高度" @pointerdown="startSheetResize('settings', $event)"><i /></button>
          <header><div><small>随页设置</small><h2>{{ settingsView === 'preferences' ? '偏好设置' : '使用说明' }}</h2></div><button aria-label="关闭设置" @click="showSettings = false"><X :size="18" /></button></header>
          <nav class="settings-tabs" aria-label="设置内容">
            <button :class="{ active: settingsView === 'preferences' }" @click="settingsView = 'preferences'"><Settings2 :size="15" />偏好设置</button>
            <button :class="{ active: settingsView === 'guide' }" @click="settingsView = 'guide'"><BookOpen :size="15" />使用说明</button>
          </nav>
          <div v-if="settingsView === 'preferences'" class="settings-body">
            <div class="settings-group"><h3>外观</h3><div class="setting-row"><span><b>界面主题</b><small>选择浅色、深色或跟随系统</small></span><SelectMenu v-model="theme" :options="themeOptions" align="right" /></div></div>
            <div class="settings-group"><h3>网络记录</h3>
              <div class="setting-row"><span><b>只记录 Fetch / XHR</b><small>隐藏文档、图片和静态资源请求</small></span><button class="toggle" :class="{ on: settings.xhrOnly }" @click="settings.xhrOnly = !settings.xhrOnly"><i /></button></div>
              <div class="setting-row"><span><b>最多保留记录</b><small>超过数量后自动清理较早记录</small></span><SelectMenu v-model="settings.maxRecords" :options="recordLimitOptions" align="right" /></div>
              <div class="setting-row"><span><b>响应正文上限</b><small>单个响应超过此大小时不保存正文</small></span><SelectMenu v-model="settings.maxBodyMB" :options="bodyLimitOptions" align="right" /></div>
            </div>
            <div class="settings-note"><ShieldCheck :size="17" /><span><b>数据仅保存在本机</b><small>请求记录和规则不会上传到任何服务器。</small></span></div>
          </div>
          <div v-else class="settings-guide-body">
            <div class="settings-guide-intro"><BookOpen :size="20" /><div><b>随页功能说明</b><span>网络调试、开发转换与浏览器效率工具的使用方法</span></div></div>
            <div class="guide-content">
              <section class="guide-card"><header><Radio :size="17" /><div><b>请求捕获</b><span>查看当前浏览器网页产生的网络流量</span></div></header><ul><li>点击顶部“开始捕获”，已打开的普通网页会自动连接。</li><li>网页标签按浏览器标签页区分，切换浏览器标签时会自动跟随。</li><li>支持按类型、方法、错误状态和关键词组合筛选。</li><li>请求详情包含请求头、请求体、响应正文和完整 Request 复制。</li></ul></section>
              <section class="guide-card"><header><SlidersHorizontal :size="17" /><div><b>请求覆写</b><span>在请求发送前修改 Header 与 Query</span></div></header><ul><li>规则可限定域名和请求资源类型，并支持随时启停。</li><li>Header 与 Query 同时支持键值模式和 JSON 模式。</li><li>JSON 对象中的 <code>null</code> 表示删除对应字段。</li><li>规则保存后立即应用，无需再次点击全局应用按钮。</li></ul></section>
              <section class="guide-card"><header><Layers3 :size="17" /><div><b>网页与连接状态</b><span>历史请求不会因为网页关闭而丢失</span></div></header><ul><li>蓝色状态点表示捕获连接正常，红色“已断开”表示网页已关闭。</li><li>断联网页仍可查看历史请求，也可以从标签右侧彻底删除。</li><li>底部“清空”菜单可一键清理已断开或 0 请求的无效网页。</li><li>仍在打开的空网页产生新请求后，会自动重新出现在列表中。</li></ul></section>
              <section class="guide-card"><header><Database :size="17" /><div><b>记录与导出</b><span>请求数据仅保存在当前浏览器本机</span></div></header><ul><li>可以清空当前网页或全部网页的请求记录。</li><li>支持导出 HAR，以及复制单个请求的 cURL 或完整信息。</li><li>响应正文大小和最多保留数量可在设置中调整。</li></ul></section>
              <section class="guide-card"><header><Braces :size="17" /><div><b>开发工具</b><span>在本地完成转换、二维码与内容对比</span></div></header><ul><li>开发转换支持 JSON、URL、Base64、JWT、时间戳和内容生成。</li><li>二维码默认使用当前网页地址，设置可折叠，并支持复制或下载 PNG/SVG。</li><li>内容对比支持文本与 JSON，输入和结果均采用 A/B 双栏，JSON 实时高亮。</li><li>所有输入内容仅在当前侧边栏处理，不会上传。</li></ul></section>
              <div class="guide-note"><ShieldCheck :size="18" /><div><b>隐私与浏览器提示</b><span>随页不会上传请求数据。捕获完整响应正文需要浏览器调试接口，Chrome 可能显示正在调试标签页的安全提示。</span></div></div>
            </div>
          </div>
          <footer v-if="settingsView === 'preferences'"><button class="secondary-button" @click="showSettings = false">取消</button><button class="primary-button" @click="saveSettings"><Check :size="15" />保存设置</button></footer>
          <footer v-else class="settings-guide-footer"><button class="secondary-button" @click="showSettings = false">关闭</button></footer>
        </section>
      </div>
    </Transition>
    <Transition name="sheet">
      <div v-if="editingRule" class="sheet-backdrop rule-editor-backdrop" @click.self="closeRuleEditor">
        <section class="rule-editor resizable-sheet" :class="{ dragging: draggingSheet === 'rule' }" :style="{ height: `${ruleEditorHeight}px` }" role="dialog" aria-modal="true" aria-label="请求覆写规则编辑器">
          <button class="resize-handle" title="拖动调整规则编辑器高度" aria-label="拖动调整规则编辑器高度" @pointerdown="startSheetResize('rule', $event)"><i /></button>
          <header><div><small>{{ isCreatingRule ? '新建规则' : '编辑规则' }}</small><h2>{{ isCreatingRule ? '创建请求覆写' : '编辑请求覆写' }}</h2></div><button class="editor-close" aria-label="关闭规则面板" @click="closeRuleEditor"><X :size="18" /></button></header>
          <div class="editor-scroll">
            <section class="editor-card editor-basics">
              <div class="editor-card-heading"><div><b>基本信息</b><small>设置规则名称和生效域名</small></div></div>
              <div class="editor-basic-fields">
                <label class="form-field"><span>规则名称</span><input v-model="editingRule.name" placeholder="例如：模拟指定 IP" /></label>
                <label class="form-field"><span>匹配域名 <small>留空表示全部域名</small></span><input v-model="editingRule.domain" placeholder="api.example.com" /></label>
              </div>
              <div class="resource-picker">
                <div class="resource-picker-title"><b>请求类型</b><small>选择这条规则需要处理的资源</small></div>
                <div class="resource-type-grid">
                  <label v-for="type in resourceTypeOptions" :key="type.value" class="resource-type-option" :class="{ selected: editingRule.resourceTypes.includes(type.value) }"><input v-model="editingRule.resourceTypes" type="checkbox" :value="type.value" /><span class="resource-check"><Check v-if="editingRule.resourceTypes.includes(type.value)" :size="10" /></span>{{ type.label }}</label>
                </div>
              </div>
            </section>
            <div class="editor-section">
              <div class="editor-section-title"><div><b>请求 Header <em>{{ editingRule.headers.length }}</em></b><small>请求发送前设置、替换或删除 Header</small></div><div class="editor-section-tools"><div class="format-switch"><button type="button" :class="{ active: headerEditorMode === 'fields' }" @click="switchOverrideEditorMode('headers', 'fields')">键值</button><button type="button" :class="{ active: headerEditorMode === 'json' }" @click="switchOverrideEditorMode('headers', 'json')">JSON</button></div><button v-if="headerEditorMode === 'fields'" type="button" class="entry-add" @click="editingRule.headers.push({ operation: 'set', name: '', value: '' })"><Plus :size="13" />添加</button></div></div>
              <template v-if="headerEditorMode === 'fields'">
              <div v-for="(header, index) in editingRule.headers" :key="index" class="override-entry">
                <div class="override-entry-head"><span>HEADER {{ index + 1 }}</span><SelectMenu v-model="header.operation" :options="operationOptions" compact class="operation-select" /><button type="button" class="entry-delete" title="删除此 Header" @click="editingRule.headers.splice(index, 1)"><Trash2 :size="14" /></button></div>
                <div class="override-entry-fields">
                  <label><span>名称</span><input v-model="header.name" placeholder="例如：x-forwarded-for" /></label>
                  <label v-if="header.operation === 'set'"><span>值</span><input v-model="header.value" placeholder="输入 Header 值" /></label>
                  <div v-else class="removed-preview"><span>操作</span><b>请求发送前删除</b></div>
                </div>
              </div>
              <div v-if="!editingRule.headers.length" class="editor-empty">尚未添加请求 Header</div>
              </template>
              <div v-else class="json-override-editor">
                <div class="json-editor-hint"><span>对象格式中使用 <code>null</code> 表示删除，也兼容完整规则数组。</span><button type="button" @click="headerJsonDraft = entriesToJson(editingRule.headers); applyOverrideJson('headers')">格式化</button></div>
                <div class="json-code-input" :class="{ invalid: headerJsonError }">
                  <pre ref="headerJsonHighlight" aria-hidden="true" v-html="highlightCode(headerJsonDraft)" />
                  <textarea v-model="headerJsonDraft" spellcheck="false" aria-label="Header JSON" placeholder="{&#10;  &quot;x-forwarded-for&quot;: &quot;203.0.113.42&quot;,&#10;  &quot;authorization&quot;: null&#10;}" @input="applyOverrideJson('headers')" @scroll="syncJsonEditorScroll('headers', $event)" />
                </div>
                <div v-if="headerJsonError" class="json-editor-error"><AlertTriangle :size="12" />{{ headerJsonError }}</div>
              </div>
            </div>
            <div class="editor-section">
              <div class="editor-section-title"><div><b>Query 参数 <em>{{ editingRule.query.length }}</em></b><small>修改 URL 中的查询参数</small></div><div class="editor-section-tools"><div class="format-switch"><button type="button" :class="{ active: queryEditorMode === 'fields' }" @click="switchOverrideEditorMode('query', 'fields')">键值</button><button type="button" :class="{ active: queryEditorMode === 'json' }" @click="switchOverrideEditorMode('query', 'json')">JSON</button></div><button v-if="queryEditorMode === 'fields'" type="button" class="entry-add" @click="editingRule.query.push({ operation: 'set', name: '', value: '' })"><Plus :size="13" />添加</button></div></div>
              <template v-if="queryEditorMode === 'fields'">
              <div v-for="(query, index) in editingRule.query" :key="index" class="override-entry">
                <div class="override-entry-head"><span>QUERY {{ index + 1 }}</span><SelectMenu v-model="query.operation" :options="operationOptions" compact class="operation-select" /><button type="button" class="entry-delete" title="删除此参数" @click="editingRule.query.splice(index, 1)"><Trash2 :size="14" /></button></div>
                <div class="override-entry-fields">
                  <label><span>名称</span><input v-model="query.name" placeholder="例如：debug" /></label>
                  <label v-if="query.operation === 'set'"><span>值</span><input v-model="query.value" placeholder="输入参数值" /></label>
                  <div v-else class="removed-preview"><span>操作</span><b>请求发送前删除</b></div>
                </div>
              </div>
              <div v-if="!editingRule.query.length" class="editor-empty">尚未添加 Query 参数</div>
              </template>
              <div v-else class="json-override-editor">
                <div class="json-editor-hint"><span>对象格式中使用 <code>null</code> 表示删除，也兼容完整规则数组。</span><button type="button" @click="queryJsonDraft = entriesToJson(editingRule.query); applyOverrideJson('query')">格式化</button></div>
                <div class="json-code-input" :class="{ invalid: queryJsonError }">
                  <pre ref="queryJsonHighlight" aria-hidden="true" v-html="highlightCode(queryJsonDraft)" />
                  <textarea v-model="queryJsonDraft" spellcheck="false" aria-label="Query JSON" placeholder="{&#10;  &quot;debug&quot;: &quot;1&quot;,&#10;  &quot;cache&quot;: null&#10;}" @input="applyOverrideJson('query')" @scroll="syncJsonEditorScroll('query', $event)" />
                </div>
                <div v-if="queryJsonError" class="json-editor-error"><AlertTriangle :size="12" />{{ queryJsonError }}</div>
              </div>
            </div>
          </div>
          <footer><button v-if="!isCreatingRule" class="danger-button" @click="removeRule(editingRule!)"><Trash2 :size="15" />删除规则</button><span /><button class="secondary-button" @click="closeRuleEditor">取消</button><button class="primary-button" @click="commitRuleEditor"><Check :size="15" />{{ isCreatingRule ? '创建并应用' : '保存并应用' }}</button></footer>
        </section>
      </div>
    </Transition>
    <Transition name="toast">
      <div v-if="toast" :key="`${toast.tone}-${toast.message}`" class="toast" :class="toast.tone" role="status" aria-live="polite">
        <CircleAlert v-if="toast.tone === 'error'" :size="16" />
        <CheckCircle2 v-else-if="toast.tone === 'success'" :size="16" />
        <ShieldCheck v-else :size="16" />
        {{ toast.message }}
      </div>
    </Transition>
  </main>
</template>
