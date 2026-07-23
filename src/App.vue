<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, ArrowRight, BookOpen, Braces, Check, CheckCircle2, CircleAlert, Clock3, Copy, Database, Download, FileJson, Frame, GitBranch, GitCompareArrows, GripVertical, KeyRound, Layers3, ListChecks, Monitor, MoreHorizontal, Moon, Play, Plus, QrCode, Radio, Search, Settings2, ShieldCheck, SlidersHorizontal, Square, Sun, Trash2, WandSparkles, Wrench, X } from 'lucide-vue-next'
import type { ApiFlow, NetworkRecord, OverrideRule } from './types'
import { demoRecords, demoRules } from './demo'
import ActionMenu from './components/ActionMenu.vue'
import ApiFlowTool from './components/ApiFlowTool.vue'
import AutofillTool from './components/AutofillTool.vue'
import DeveloperConverter from './components/DeveloperConverter.vue'
import DiffTool from './components/DiffTool.vue'
import MfaTool from './components/MfaTool.vue'
import QrCodeTool from './components/QrCodeTool.vue'
import SelectMenu from './components/SelectMenu.vue'
import { createApiFlowFromRecords } from './utils/api-flow'
import { API_FLOW_STORAGE_KEY, countStoredApiFlows } from './utils/api-flow-store'

type MainTab = 'requests' | 'rules' | 'flow' | 'autofill' | 'mfa' | 'tools'
type NavigationMode = 'scroll' | 'compact'
type RequestSort = 'newest' | 'oldest'
type RequestListItem =
  | { kind: 'request'; key: string; record: NetworkRecord }
  | { kind: 'navigation'; key: string; fromLabel: string; toLabel: string; fromUrl: string; toUrl: string; startedAt: number; reload: boolean }
type SettingsView = 'preferences' | 'guide'
type ResizableSheet = 'detail' | 'settings' | 'rule' | 'flow' | 'converter' | 'mfa' | 'qr' | 'diff'
type DetailTab = 'overview' | 'headers' | 'request' | 'response'
type OverrideEditorKind = 'headers' | 'query'
type OverrideEditorMode = 'fields' | 'json'
type ToastTone = 'success' | 'error' | 'info'
type SettingsSaveState = 'saved' | 'saving' | 'error'
type TabCaptureState = { state: 'connecting' | 'attached' | 'failed' | 'closed'; error?: string; updatedAt?: number }
type TabContext = { tabUrl: string; tabDomain: string; tabTitle: string }
type CacheStats = { bytes: number; bodyBytes: number; recordCount: number; lastCleanupAt: number }
const DEFAULT_IGNORED_DOMAINS = [
  'arms-retcode.aliyuncs.com',
  'analytics.google.com',
  'www.google-analytics.com',
  'region1.google-analytics.com',
  'stats.g.doubleclick.net',
  'hm.baidu.com',
]
const activeTab = ref<MainTab>('requests')
const detailTab = ref<DetailTab>('overview')
const recording = ref(false)
const records = ref<NetworkRecord[]>([])
const rules = ref<OverrideRule[]>([])
const apiFlowCount = ref(0)
const pendingApiFlow = ref<ApiFlow | null>(null)
const mfaAccountCount = ref(0)
const selected = ref<NetworkRecord | null>(null)
const search = ref('')
const typeFilter = ref('all')
const methodFilter = ref('all')
const requestSort = ref<RequestSort>('newest')
const updatingCaptureScope = ref(false)
const errorOnly = ref(false)
const composingApiFlow = ref(false)
const selectedFlowRequestKeys = ref<Set<string>>(new Set())
const creatingApiFlow = ref(false)
const selectedBrowserTab = ref<number | 'all'>('all')
const tabCaptureStates = ref<Record<number, TabCaptureState>>({})
const captureTabContexts = ref<Record<number, TabContext>>({})
const browserTabOrder = ref<number[]>([])
const browserTabsViewport = ref<HTMLElement | null>(null)
const primaryNavViewport = ref<HTMLElement | null>(null)
const primaryMoreTrigger = ref<HTMLElement | null>(null)
const primaryMoreMenu = ref<HTMLElement | null>(null)
const showPrimaryMore = ref(false)
const primaryMoreStyle = ref<Record<string, string>>({})
const toast = ref<{ message: string; tone: ToastTone } | null>(null)
let toastTimer: number | undefined
let cacheClearTimer: number | undefined
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
const settingsSaveState = ref<SettingsSaveState>('saved')
const settings = ref({
  maxRecords: 500,
  maxBodyMB: 1,
  maxCacheMB: 50,
  retentionMinutes: 60,
  xhrOnly: true,
  ignoredDomains: [...DEFAULT_IGNORED_DOMAINS],
  navigationSchemaVersion: 3,
  navigationMode: 'scroll' as NavigationMode,
  requestSort: 'newest' as RequestSort,
  visibleTabs: ['requests', 'rules', 'flow', 'autofill', 'mfa', 'tools'] as MainTab[],
  tabOrder: ['requests', 'rules', 'flow', 'autofill', 'mfa', 'tools'] as MainTab[],
})
const ignoredDomainDraft = ref('')
const draggingMainTab = ref<MainTab | null>(null)
const dragOverMainTab = ref<MainTab | null>(null)
const dragInsertPosition = ref<'before' | 'after' | null>(null)
const cacheStats = ref<CacheStats>({ bytes: 0, bodyBytes: 0, recordCount: 0, lastCleanupAt: 0 })
const cacheClearConfirm = ref(false)
const detailLoading = ref(false)
let settingsAutoSaveReady = false
let settingsSaveVersion = 0
let settingsSaveQueue: Promise<void> = Promise.resolve()
const sheetMinimumHeights: Record<ResizableSheet, number> = {
  detail: 300,
  settings: 360,
  rule: 400,
  flow: 400,
  converter: 380,
  mfa: 400,
  qr: 360,
  diff: 380,
}
const SHEET_HEIGHTS_STORAGE_KEY = 'suiye-sheet-heights-v1'

function defaultSheetHeight(kind: ResizableSheet) {
  const maximumHeight = Math.max(220, window.innerHeight - 20)
  const minimumHeight = Math.min(sheetMinimumHeights[kind], maximumHeight)
  return Math.min(maximumHeight, Math.max(minimumHeight, Math.round(window.innerHeight * .5)))
}

function clampSheetHeight(kind: ResizableSheet, height: number) {
  const maximumHeight = Math.max(220, window.innerHeight - 20)
  const minimumHeight = Math.min(sheetMinimumHeights[kind], maximumHeight)
  return Math.max(minimumHeight, Math.min(maximumHeight, height))
}

function readStoredSheetHeights() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHEET_HEIGHTS_STORAGE_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {} as Partial<Record<ResizableSheet, number>>
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0),
    ) as Partial<Record<ResizableSheet, number>>
  } catch {
    return {} as Partial<Record<ResizableSheet, number>>
  }
}

const storedSheetHeights = readStoredSheetHeights()
function rememberedSheetHeight(kind: ResizableSheet) {
  const storedHeight = storedSheetHeights[kind]
  return storedHeight == null ? defaultSheetHeight(kind) : clampSheetHeight(kind, storedHeight)
}

const detailHeight = ref(rememberedSheetHeight('detail'))
const settingsHeight = ref(rememberedSheetHeight('settings'))
const ruleEditorHeight = ref(rememberedSheetHeight('rule'))
const flowEditorHeight = ref(rememberedSheetHeight('flow'))
const converterHeight = ref(rememberedSheetHeight('converter'))
const mfaToolHeight = ref(rememberedSheetHeight('mfa'))
const qrToolHeight = ref(rememberedSheetHeight('qr'))
const diffToolHeight = ref(rememberedSheetHeight('diff'))
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
const bodyLimitOptions = [{ label: '256 KB', value: 0.256 }, { label: '1 MB', value: 1 }, { label: '2 MB', value: 2 }, { label: '5 MB', value: 5 }]
const cacheLimitOptions = [{ label: '25 MB', value: 25 }, { label: '50 MB', value: 50 }, { label: '100 MB', value: 100 }, { label: '200 MB', value: 200 }]
const retentionOptions = [{ label: '1 小时', value: 60 }, { label: '6 小时', value: 360 }, { label: '24 小时', value: 1440 }, { label: '7 天', value: 10080 }, { label: '不按时间', value: 0 }]
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
const requestSortOptions = [
  { label: '最新优先', value: 'newest', description: '最近发出的请求排在最前' },
  { label: '最早优先', value: 'oldest', description: '按请求发起顺序查看' },
]
const navigationModeOptions = [
  { label: '全部展示', value: 'scroll', description: '所有已启用标签横向滚动展示' },
  { label: '精简模式', value: 'compact', description: '前 4 个常用标签固定，其余收进更多' },
]
const mainTabDefinitions = [
  { value: 'requests' as MainTab, label: '请求', description: '网络请求捕获与历史记录', icon: Radio },
  { value: 'rules' as MainTab, label: '规则', description: 'Header 与 Query 覆写', icon: SlidersHorizontal },
  { value: 'flow' as MainTab, label: '流程', description: '捕获请求的接口编排与执行', icon: GitBranch },
  { value: 'autofill' as MainTab, label: '填充', description: '测试身份与支付测试卡', icon: WandSparkles },
  { value: 'mfa' as MainTab, label: 'MFA', description: '本机动态验证码', icon: KeyRound },
  { value: 'tools' as MainTab, label: '工具', description: '转换、二维码与内容对比', icon: Wrench },
]
const isExtension = location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && !!chrome.runtime?.id
const MFA_STORAGE_KEY = 'suiye-mfa-accounts-v1'

function readMfaAccountCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function normalizeVisibleTabs(value: unknown): MainTab[] {
  if (!Array.isArray(value)) return mainTabDefinitions.map(tab => tab.value)
  const known = new Set(mainTabDefinitions.map(tab => tab.value))
  const normalized = value.filter((tab, index, tabs): tab is MainTab => typeof tab === 'string' && known.has(tab as MainTab) && tabs.indexOf(tab) === index)
  return normalized.length ? normalized : ['requests']
}

function normalizeTabOrder(value: unknown): MainTab[] {
  const defaults = mainTabDefinitions.map(tab => tab.value)
  if (!Array.isArray(value)) return defaults
  const known = new Set(defaults)
  const normalized = value.filter((tab, index, tabs): tab is MainTab => typeof tab === 'string' && known.has(tab as MainTab) && tabs.indexOf(tab) === index)
  return [...normalized, ...defaults.filter(tab => !normalized.includes(tab))]
}

const visibleMainTabs = computed(() => normalizeVisibleTabs(settings.value.visibleTabs))
const orderedMainTabDefinitions = computed(() => {
  const definitions = new Map(mainTabDefinitions.map(tab => [tab.value, tab]))
  return normalizeTabOrder(settings.value.tabOrder).map(tab => definitions.get(tab)!)
})
const visibleOrderedMainTabs = computed(() => orderedMainTabDefinitions.value.filter(tab => visibleMainTabs.value.includes(tab.value)))
const primaryMainTabs = computed(() =>
  settings.value.navigationMode === 'compact'
    ? visibleOrderedMainTabs.value.slice(0, 4)
    : visibleOrderedMainTabs.value
)
const overflowMainTabs = computed(() =>
  settings.value.navigationMode === 'compact'
    ? visibleOrderedMainTabs.value.slice(4)
    : []
)
const isOverflowMainTabActive = computed(() =>
  overflowMainTabs.value.some(tab => tab.value === activeTab.value)
)
const isMainTabVisible = (tab: MainTab) => visibleMainTabs.value.includes(tab)

function toggleMainTabVisibility(tab: MainTab) {
  const current = visibleMainTabs.value
  if (current.includes(tab)) {
    if (current.length === 1) {
      notify('至少需要保留一个导航标签', 'error')
      return
    }
    settings.value.visibleTabs = current.filter(value => value !== tab)
    if (activeTab.value === tab) activeTab.value = settings.value.visibleTabs[0]
  } else {
    const visible = new Set([...current, tab])
    settings.value.visibleTabs = normalizeTabOrder(settings.value.tabOrder).filter(value => visible.has(value))
  }
}

let mainTabDragPointerId: number | null = null

function startMainTabDrag(tab: MainTab, event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  draggingMainTab.value = tab
  dragOverMainTab.value = null
  dragInsertPosition.value = null
  mainTabDragPointerId = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', moveMainTabDrag)
  window.addEventListener('pointerup', finishMainTabDrag)
  window.addEventListener('pointercancel', cancelMainTabDrag)
}

function moveMainTabDrag(event: PointerEvent) {
  if (!draggingMainTab.value || event.pointerId !== mainTabDragPointerId) return
  event.preventDefault()
  const source = draggingMainTab.value
  const targetRow = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.nav-order-row')
  if (!targetRow) {
    dragOverMainTab.value = null
    dragInsertPosition.value = null
    return
  }
  const target = targetRow.dataset.navTab as MainTab | undefined
  if (!target || source === target) {
    dragOverMainTab.value = null
    dragInsertPosition.value = null
    return
  }
  dragOverMainTab.value = target
  const targetRect = targetRow.getBoundingClientRect()
  dragInsertPosition.value = event.clientY > targetRect.top + targetRect.height / 2 ? 'after' : 'before'
  const settingsBody = targetRow.closest<HTMLElement>('.settings-body')
  if (settingsBody) {
    const bodyRect = settingsBody.getBoundingClientRect()
    if (event.clientY < bodyRect.top + 42) settingsBody.scrollBy({ top: -24 })
    else if (event.clientY > bodyRect.bottom - 42) settingsBody.scrollBy({ top: 24 })
  }
}

function finishMainTabDrag(event?: PointerEvent) {
  if (event && mainTabDragPointerId != null && event.pointerId !== mainTabDragPointerId) return
  const source = draggingMainTab.value
  const target = dragOverMainTab.value
  const position = dragInsertPosition.value
  if (source && target && position) {
    const order = normalizeTabOrder(settings.value.tabOrder).filter(value => value !== source)
    const targetIndex = order.indexOf(target)
    if (targetIndex >= 0) {
      order.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
      settings.value.tabOrder = order
      const visible = new Set(settings.value.visibleTabs)
      settings.value.visibleTabs = order.filter(value => visible.has(value))
    }
  }
  resetMainTabDrag()
}

function cancelMainTabDrag(event?: PointerEvent) {
  if (event && mainTabDragPointerId != null && event.pointerId !== mainTabDragPointerId) return
  resetMainTabDrag()
}

function resetMainTabDrag() {
  window.removeEventListener('pointermove', moveMainTabDrag)
  window.removeEventListener('pointerup', finishMainTabDrag)
  window.removeEventListener('pointercancel', cancelMainTabDrag)
  mainTabDragPointerId = null
  draggingMainTab.value = null
  dragOverMainTab.value = null
  dragInsertPosition.value = null
}

async function revealActiveMainTab(tab: MainTab) {
  await nextTick()
  const viewport = primaryNavViewport.value
  const item = viewport?.querySelector<HTMLElement>(`[data-main-tab="${tab}"]`)
  if (!viewport || !item) return
  const viewportRect = viewport.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  let left = viewport.scrollLeft
  if (itemRect.left < viewportRect.left + 4) left -= viewportRect.left + 4 - itemRect.left
  else if (itemRect.right > viewportRect.right - 4) left += itemRect.right - (viewportRect.right - 4)
  if (Math.abs(left - viewport.scrollLeft) > 1) viewport.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
}

watch(activeTab, tab => { void revealActiveMainTab(tab) }, { flush: 'post' })
watch(() => settings.value.navigationMode, () => closePrimaryMore())

function positionPrimaryMore() {
  const trigger = primaryMoreTrigger.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(208, window.innerWidth - 20)
  const estimatedHeight = Math.max(52, overflowMainTabs.value.length * 46 + 10)
  const openAbove = rect.bottom + 8 + estimatedHeight > window.innerHeight
  primaryMoreStyle.value = {
    width: `${width}px`,
    left: `${Math.max(10, Math.min(window.innerWidth - width - 10, rect.right - width))}px`,
    top: openAbove ? 'auto' : `${rect.bottom + 7}px`,
    bottom: openAbove ? `${window.innerHeight - rect.top + 7}px` : 'auto',
  }
}

async function togglePrimaryMore() {
  showPrimaryMore.value = !showPrimaryMore.value
  if (!showPrimaryMore.value) return
  await nextTick()
  positionPrimaryMore()
}

function closePrimaryMore() {
  showPrimaryMore.value = false
}

function handlePrimaryMoreOutside(event: PointerEvent) {
  const target = event.target as Node
  if (primaryMoreTrigger.value?.contains(target) || primaryMoreMenu.value?.contains(target)) return
  closePrimaryMore()
}

function selectPrimaryTab(tab: MainTab) {
  activeTab.value = tab
  closePrimaryMore()
}

async function loadMfaAccountCount() {
  try {
    const stored = isExtension
      ? (await chrome.storage.local.get(MFA_STORAGE_KEY))[MFA_STORAGE_KEY]
      : JSON.parse(localStorage.getItem(MFA_STORAGE_KEY) || '[]')
    mfaAccountCount.value = readMfaAccountCount(stored)
  } catch {
    mfaAccountCount.value = 0
  }
}

async function loadApiFlowCount() {
  try {
    if (isExtension) {
      apiFlowCount.value = await countStoredApiFlows()
      return
    }
    const stored = localStorage.getItem(API_FLOW_STORAGE_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    apiFlowCount.value = Array.isArray(parsed) ? parsed.length : 0
  } catch {
    apiFlowCount.value = 0
  }
}

function applyTheme(value: string) {
  const resolved = value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value
  document.documentElement.dataset.theme = resolved
  localStorage.setItem('suiye-theme', value)
}
watch(theme, applyTheme, { immediate: true })
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => theme.value === 'system' && applyTheme('system'))

const groupedResourceTypes = new Set(['Fetch', 'XHR', 'Document', 'Script', 'Stylesheet', 'Image', 'Font', 'Media', 'WebSocket'])

function normalizeIgnoredDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_IGNORED_DOMAINS]
  const domains = value
    .flatMap(item => String(item || '').split(/[\s,，;；]+/))
    .map(item => item.trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').split('/')[0])
    .filter(item => !!item && item.includes('.'))
  return [...new Set(domains)]
}

function addIgnoredDomain() {
  const additions = normalizeIgnoredDomains([ignoredDomainDraft.value])
  if (!additions.length) return notify('请输入有效域名，例如 analytics.google.com', 'error')
  settings.value.ignoredDomains = [...new Set([...settings.value.ignoredDomains, ...additions])]
  ignoredDomainDraft.value = ''
}

function removeIgnoredDomain(domain: string) {
  settings.value.ignoredDomains = settings.value.ignoredDomains.filter(item => item !== domain)
}

function restoreIgnoredDomains() {
  settings.value.ignoredDomains = [...DEFAULT_IGNORED_DOMAINS]
}

function isIgnoredRequestDomain(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return settings.value.ignoredDomains.some(domain => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

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

function normalizePageUrl(url = '') {
  try {
    const value = new URL(url)
    value.hash = ''
    return value.href
  } catch {
    return url
  }
}

function navigationUrl(record: NetworkRecord) {
  if (record.navigationUrl) return record.navigationUrl
  if (record.pageUrl) return record.pageUrl
  if (record.type === 'Document' && !record.isIframe) return record.url
  return ''
}

function navigationIdentity(record: NetworkRecord) {
  return record.navigationId || `${record.tabId}:${normalizePageUrl(navigationUrl(record)) || 'unknown'}`
}

function navigationLabel(record: NetworkRecord) {
  const url = navigationUrl(record)
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
    return `${parsed.hostname}${path}`
  } catch {
    return record.navigationDomain || record.pageDomain || '未知页面'
  }
}

const displayRecords = computed(() => records.value.filter(record => !isIgnoredRequestDomain(record.url)))
const filteredRecords = computed(() => displayRecords.value
  .filter(record => {
    const typeMatches = matchesTypeFilter(record)
    const methodMatches = methodFilter.value === 'all' || record.method === methodFilter.value
    const textMatches = !search.value || record.url.toLowerCase().includes(search.value.toLowerCase()) || record.method.includes(search.value.toUpperCase())
    const tabMatches = selectedBrowserTab.value === 'all' || record.tabId === selectedBrowserTab.value
    const errorMatches = !errorOnly.value || (record.status || 0) >= 400 || !!record.error
    return typeMatches && methodMatches && textMatches && tabMatches && errorMatches
  })
  .sort((left, right) => requestSort.value === 'newest'
    ? right.startedAt - left.startedAt
    : left.startedAt - right.startedAt))
const requestListRecords = computed(() => composingApiFlow.value
  ? filteredRecords.value.filter(record => ['Fetch', 'XHR'].includes(record.type))
  : filteredRecords.value)
const requestListItems = computed<RequestListItem[]>(() => {
  const source = requestListRecords.value
  if (composingApiFlow.value || selectedBrowserTab.value === 'all' || source.length < 2) {
    return source.map(record => ({ kind: 'request', key: `request:${record.tabId}:${record.id}:${record.startedAt}`, record }))
  }

  const items: RequestListItem[] = []
  let previous: NetworkRecord | null = null
  source.forEach((record, index) => {
    if (previous && navigationIdentity(previous) !== navigationIdentity(record)) {
      const fromRecord = requestSort.value === 'newest' ? record : previous
      const toRecord = requestSort.value === 'newest' ? previous : record
      const fromUrl = navigationUrl(fromRecord)
      const toUrl = navigationUrl(toRecord)
      items.push({
        kind: 'navigation',
        key: `navigation:${navigationIdentity(fromRecord)}:${navigationIdentity(toRecord)}:${index}`,
        fromLabel: navigationLabel(fromRecord),
        toLabel: navigationLabel(toRecord),
        fromUrl,
        toUrl,
        startedAt: toRecord.navigationStartedAt || toRecord.startedAt,
        reload: normalizePageUrl(fromUrl) === normalizePageUrl(toUrl),
      })
    }
    items.push({ kind: 'request', key: `request:${record.tabId}:${record.id}:${record.startedAt}`, record })
    previous = record
  })
  return items
})
const selectedFlowRequestCount = computed(() => selectedFlowRequestKeys.value.size)
const enabledRuleCount = computed(() => rules.value.filter(rule => rule.enabled).length)
const browserTabs = computed(() => {
  const tabs = new Map<number, { id: number; domain: string; title: string; url: string; count: number }>()
  Object.entries(captureTabContexts.value).forEach(([tabId, context]) => {
    tabs.set(Number(tabId), { id: Number(tabId), domain: context.tabDomain || '页面域名未知', title: context.tabTitle || '未命名页面', url: context.tabUrl || '', count: 0 })
  })
  displayRecords.value.forEach(record => {
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

const scopedRecords = computed(() => selectedBrowserTab.value === 'all' ? displayRecords.value : displayRecords.value.filter(record => record.tabId === selectedBrowserTab.value))
const stats = computed(() => ({
  total: scopedRecords.value.length,
  errors: scopedRecords.value.filter(r => (r.status || 0) >= 400 || r.error).length,
  bodyBytes: scopedRecords.value.reduce((n, r) => n + (r.hasResponseBody || r.responseBody ? (r.responseBodyBytes || new TextEncoder().encode(r.responseBody || '').byteLength) : 0), 0),
}))
const cacheUsagePercent = computed(() => Math.min(100, cacheStats.value.bytes / Math.max(1, settings.value.maxCacheMB * 1_000_000) * 100))
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
    if (result?.ok === false) return notify(result.error, 'error')
  }
  removeBrowserTabLocally(tabId)
  notify('已删除断联网页及其历史请求')
}

const hostname = (url: string) => { try { return new URL(url).hostname } catch { return url } }
const endpoint = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}` } catch { return url } }
const localClockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const localShortDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const localFullDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
})
const isToday = (date: Date) => {
  const now = new Date()
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
}
const formatTime = (time: number) => {
  const date = new Date(time)
  return isToday(date) ? localClockFormatter.format(date) : localShortDateTimeFormatter.format(date)
}
const formatTimeTitle = (time: number) => localFullDateTimeFormatter.format(new Date(time))
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 2 : 1)} MB`
}
const statusClass = (status?: number) => !status ? 'muted' : status >= 500 ? 'danger' : status >= 400 ? 'warning' : status >= 300 ? 'redirect' : 'success'
const requestErrorLabel = (record: NetworkRecord) => record.error || ((record.status || 0) >= 400 ? `HTTP ${record.status}` : '')
const omittedBodyMessage = (record: NetworkRecord, kind: 'request' | 'response') => {
  const reason = kind === 'request' ? record.requestBodyOmittedReason : record.responseBodyOmittedReason
  if (reason === 'size') return `正文超过 ${settings.value.maxBodyMB < 1 ? `${Math.round(settings.value.maxBodyMB * 1000)} KB` : `${settings.value.maxBodyMB} MB`} 保存上限`
  if (reason === 'binary') return '图片、媒体等二进制正文默认不缓存'
  if (reason === 'storage') return '该正文已被容量管理或定时清理'
  if (reason === 'unavailable') return '浏览器未能返回该响应正文'
  return kind === 'request' ? '该请求没有 Request Body' : '该响应没有可显示的正文'
}
const queryParamsText = (url: string) => {
  try {
    const values: Record<string, string | string[]> = {}
    for (const [key, value] of new URL(url).searchParams) {
      const current = values[key]
      if (current === undefined) values[key] = value
      else if (Array.isArray(current)) current.push(value)
      else values[key] = [current, value]
    }
    return Object.keys(values).length ? JSON.stringify(values, null, 2) : ''
  } catch {
    return ''
  }
}
const pretty = (text?: string) => { if (!text) return '暂无内容'; try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text } }
const parseBody = (text?: string) => { if (!text) return null; try { return JSON.parse(text) } catch { return text } }
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function highlightJsonTokens(text: string) {
  const escaped = escapeHtml(text)
  return escaped.replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+\-]?\d+)?\b/gi, (match, quoted, colon) => {
    if (quoted) return `<span class="${colon ? 'json-key' : 'json-string'}">${quoted}</span>${colon || ''}`
    if (/true|false/i.test(match)) return `<span class="json-boolean">${match}</span>`
    if (/null/i.test(match)) return `<span class="json-null">${match}</span>`
    return `<span class="json-number">${match}</span>`
  })
}
function highlightCode(text?: string) { return highlightJsonTokens(pretty(text)) }
function highlightJsonDraft(text: string) { return highlightJsonTokens(text) }
const notify = (message: string, tone: ToastTone = 'success') => {
  toast.value = { message, tone }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toast.value = null }, 2400)
}

async function send<T = any>(message: any): Promise<T> {
  if (!isExtension) throw new Error('请在扩展环境中使用此功能')
  return chrome.runtime.sendMessage(message)
}

async function updateRequestSort(value: string | number) {
  const nextSort: RequestSort = value === 'oldest' ? 'oldest' : 'newest'
  requestSort.value = nextSort
  settings.value.requestSort = nextSort
  if (!isExtension) {
    localStorage.setItem('suiye-request-sort', nextSort)
    return
  }
  const result = await send({ type: 'SAVE_REQUEST_SORT', requestSort: nextSort })
  if (result?.ok === false) notify(result.error || '排序偏好保存失败', 'error')
}

async function toggleXhrOnly() {
  if (updatingCaptureScope.value) return
  const previousValue = settings.value.xhrOnly
  const previousTypeFilter = typeFilter.value
  const nextValue = !previousValue
  settings.value.xhrOnly = nextValue
  if (!nextValue) typeFilter.value = 'all'

  if (!isExtension) {
    localStorage.setItem('suiye-xhr-only', String(nextValue))
    return
  }

  updatingCaptureScope.value = true
  try {
    const result = await send({ type: 'SAVE_CAPTURE_SCOPE', xhrOnly: nextValue })
    if (result?.ok === false) throw new Error(result.error || '捕获范围保存失败')
    notify(nextValue ? '已切换为仅记录 Fetch / XHR' : '已切换为全部资源，刷新网页后即可记录', 'info')
  } catch (error) {
    settings.value.xhrOnly = previousValue
    typeFilter.value = previousTypeFilter
    notify(error instanceof Error ? error.message : '捕获范围保存失败', 'error')
  } finally {
    updatingCaptureScope.value = false
  }
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
  if (result?.ok === false) return notify(result.error, 'error')
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
      if (result?.ok === false) return notify(result.error || '清理失败', 'error')
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
    if (result?.ok === false) return notify(result.error, 'error')
    if (result?.cacheStats) cacheStats.value = result.cacheStats
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
  if (records.value.length > settings.value.maxRecords) records.value = records.value.slice(0, settings.value.maxRecords)
  if (selected.value?.tabId === record.tabId && selected.value?.id === record.id && selected.value.startedAt === record.startedAt) {
    const requestBody = selected.value.requestBody
    const responseBody = selected.value.responseBody
    selected.value = { ...selected.value, ...record, ...(requestBody !== undefined ? { requestBody } : {}), ...(responseBody !== undefined ? { responseBody } : {}) }
    if (record.storageKey && record.finishedAt && requestBody === undefined && responseBody === undefined) void loadRequestDetail(record.storageKey, record)
  }
}

async function loadRequestDetail(storageKey: string, fallback: NetworkRecord) {
  if (!isExtension) return
  detailLoading.value = true
  try {
    const result = await send<{ ok: boolean; record?: NetworkRecord; error?: string }>({ type: 'GET_RECORD_DETAIL', storageKey })
    const current = selected.value
    const isCurrent = !!current && (current.storageKey === storageKey || (current.tabId === fallback.tabId && current.id === fallback.id && current.startedAt === fallback.startedAt))
    if (isCurrent) {
      selected.value = result?.ok && result.record
        ? { ...current, ...result.record }
        : { ...current, hasRequestBody: false, hasResponseBody: false, requestBodyOmittedReason: current.hasRequestBody ? 'storage' : current.requestBodyOmittedReason, responseBodyOmittedReason: current.hasResponseBody ? 'storage' : current.responseBodyOmittedReason }
    }
  } catch {
    const current = selected.value
    if (current?.storageKey === storageKey) selected.value = { ...current, requestBodyOmittedReason: current.hasRequestBody ? 'storage' : current.requestBodyOmittedReason, responseBodyOmittedReason: current.hasResponseBody ? 'storage' : current.responseBodyOmittedReason }
  } finally {
    detailLoading.value = false
  }
}

async function openRequestDetails(record: NetworkRecord) {
  restoreSheetHeight('detail')
  selected.value = { ...record }
  detailTab.value = 'overview'
  if (record.storageKey) await loadRequestDetail(record.storageKey, record)
}

function flowRequestKey(record: NetworkRecord) {
  return record.storageKey || `${record.tabId}:${record.id}:${record.startedAt}`
}

function toggleApiFlowCompose() {
  composingApiFlow.value = !composingApiFlow.value
  selectedFlowRequestKeys.value = new Set()
  selected.value = null
  if (composingApiFlow.value) typeFilter.value = 'api'
}

function toggleFlowRequestSelection(record: NetworkRecord) {
  if (!['Fetch', 'XHR'].includes(record.type)) return
  const key = flowRequestKey(record)
  const next = new Set(selectedFlowRequestKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedFlowRequestKeys.value = next
}

function handleRequestRowClick(record: NetworkRecord) {
  if (composingApiFlow.value) {
    toggleFlowRequestSelection(record)
    return
  }
  void openRequestDetails(record)
}

async function fullRecordForFlow(record: NetworkRecord) {
  if (!isExtension || !record.storageKey) return record
  const result = await send<{ ok: boolean; record?: NetworkRecord }>({ type: 'GET_RECORD_DETAIL', storageKey: record.storageKey })
  return result?.ok && result.record ? { ...record, ...result.record } : record
}

async function createApiFlowFromSelection() {
  if (!selectedFlowRequestKeys.value.size || creatingApiFlow.value) return
  const selectedRecords = requestListRecords.value.filter(record => selectedFlowRequestKeys.value.has(flowRequestKey(record)))
  if (!selectedRecords.length) return notify('请先选择至少一个 XHR/FETCH 请求', 'info')
  creatingApiFlow.value = true
  try {
    const detailedRecords = await Promise.all(selectedRecords.map(fullRecordForFlow))
    const flow = createApiFlowFromRecords(detailedRecords)
    const relations = flow.steps.reduce((total, step) => total + step.extractors.length + (step.selection ? 1 : 0), 0)
    pendingApiFlow.value = flow
    composingApiFlow.value = false
    selectedFlowRequestKeys.value = new Set()
    activeTab.value = 'flow'
    notify(relations ? `已创建流程并识别 ${relations} 个变量关联` : '流程已创建，请配置响应变量', relations ? 'success' : 'info')
  } catch (error) {
    notify(error instanceof Error ? error.message : '接口流程创建失败', 'error')
  } finally {
    creatingApiFlow.value = false
  }
}

async function saveRules() {
  if (isExtension) {
    const result = await send({ type: 'APPLY_RULES', rules: rules.value })
    if (result?.ok === false) { notify(result.error, 'error'); return false }
  }
  notify('覆写规则已应用')
  return true
}

function normalizedSettingsSnapshot() {
  const tabOrder = normalizeTabOrder(settings.value.tabOrder)
  const visible = new Set(normalizeVisibleTabs(settings.value.visibleTabs))
  return {
    ...settings.value,
    ignoredDomains: normalizeIgnoredDomains(settings.value.ignoredDomains),
    tabOrder,
    visibleTabs: tabOrder.filter(tab => visible.has(tab)),
  }
}

async function persistSettingsSnapshot(snapshot: ReturnType<typeof normalizedSettingsSnapshot>) {
  try {
    if (selected.value && snapshot.ignoredDomains.some((domain) => {
      try {
        const host = new URL(selected.value!.url).hostname.toLowerCase()
        return host === domain || host.endsWith(`.${domain}`)
      } catch {
        return false
      }
    })) selected.value = null
    if (!snapshot.visibleTabs.includes(activeTab.value)) activeTab.value = snapshot.visibleTabs[0]
    if (!isExtension) {
      localStorage.setItem('suiye-settings-v1', JSON.stringify(snapshot))
      return true
    }
    const result = await send({ type: 'SAVE_SETTINGS', settings: snapshot })
    if (result?.ok === false) throw new Error(result.error || '设置保存失败')
    if (result?.cacheStats) cacheStats.value = result.cacheStats
    return true
  } catch (error) {
    notify(error instanceof Error ? error.message : '设置保存失败', 'error')
    return false
  }
}

function queueSettingsAutoSave() {
  if (!settingsAutoSaveReady) return
  const version = ++settingsSaveVersion
  const snapshot = normalizedSettingsSnapshot()
  settingsSaveState.value = 'saving'
  settingsSaveQueue = settingsSaveQueue
    .catch(() => {})
    .then(async () => {
      if (version !== settingsSaveVersion) return
      const saved = await persistSettingsSnapshot(snapshot)
      if (version === settingsSaveVersion) settingsSaveState.value = saved ? 'saved' : 'error'
    })
}

function closeSettings() {
  showSettings.value = false
}

const settingsSaveLabel = computed(() => {
  if (settingsSaveState.value === 'saving') return '正在自动保存…'
  if (settingsSaveState.value === 'error') return '自动保存失败'
  return '更改已自动保存'
})

watch(
  () => [
    settings.value.navigationMode,
    settings.value.maxRecords,
    settings.value.maxBodyMB,
    settings.value.maxCacheMB,
    settings.value.retentionMinutes,
    settings.value.ignoredDomains.join('\n'),
    settings.value.visibleTabs.join(','),
    settings.value.tabOrder.join(','),
  ],
  queueSettingsAutoSave,
)

async function clearAllCachedRequests() {
  if (!cacheClearConfirm.value) {
    cacheClearConfirm.value = true
    if (cacheClearTimer) window.clearTimeout(cacheClearTimer)
    cacheClearTimer = window.setTimeout(() => { cacheClearConfirm.value = false }, 3200)
    return
  }
  if (cacheClearTimer) window.clearTimeout(cacheClearTimer)
  cacheClearConfirm.value = false
  if (isExtension) {
    const result = await send({ type: 'CLEAR_RECORDS' })
    if (result?.ok === false) return notify(result.error || '缓存清理失败', 'error')
    if (result?.cacheStats) cacheStats.value = result.cacheStats
  } else {
    cacheStats.value = { bytes: 0, bodyBytes: 0, recordCount: 0, lastCleanupAt: Date.now() }
  }
  records.value = []
  selected.value = null
  notify('请求缓存已全部清空')
}

function openSettings(view: SettingsView = 'preferences') {
  restoreSheetHeight('settings')
  settingsView.value = view
  showSettings.value = true
}

function openUtilityTool(tool: 'converter' | 'qr' | 'diff') {
  restoreSheetHeight(tool)
  showConverter.value = tool === 'converter'
  showQrTool.value = tool === 'qr'
  showDiffTool.value = tool === 'diff'
}

function getSheetHeightRef(kind: ResizableSheet) {
  return kind === 'detail' ? detailHeight
    : kind === 'settings' ? settingsHeight
      : kind === 'rule' ? ruleEditorHeight
        : kind === 'flow' ? flowEditorHeight
          : kind === 'converter' ? converterHeight
            : kind === 'mfa' ? mfaToolHeight
              : kind === 'qr' ? qrToolHeight
                : diffToolHeight
}

function restoreSheetHeight(kind: ResizableSheet) {
  getSheetHeightRef(kind).value = rememberedSheetHeight(kind)
}

function persistSheetHeight(kind: ResizableSheet, height: number) {
  storedSheetHeights[kind] = Math.round(height)
  try {
    localStorage.setItem(SHEET_HEIGHTS_STORAGE_KEY, JSON.stringify(storedSheetHeights))
  } catch {
    // UI preferences should never prevent the panel from continuing to work.
  }
}

function constrainSheetHeightsToViewport() {
  (Object.keys(sheetMinimumHeights) as ResizableSheet[]).forEach((kind) => {
    getSheetHeightRef(kind).value = rememberedSheetHeight(kind)
  })
}

function startSheetResize(kind: ResizableSheet, event: PointerEvent) {
  event.preventDefault()
  const heightRef = getSheetHeightRef(kind)
  const maximumHeight = Math.max(220, window.innerHeight - 20)
  const minimumHeight = Math.min(sheetMinimumHeights[kind], maximumHeight)
  const sheet = (event.currentTarget as HTMLElement).closest<HTMLElement>('.resizable-sheet')
  draggingSheet.value = kind
  const startY = event.clientY
  const startHeight = sheet?.getBoundingClientRect().height || heightRef.value
  const move = (moveEvent: PointerEvent) => {
    heightRef.value = Math.max(minimumHeight, Math.min(maximumHeight, startHeight + startY - moveEvent.clientY))
  }
  const end = () => {
    persistSheetHeight(kind, heightRef.value)
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
  restoreSheetHeight('rule')
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
  restoreSheetHeight('rule')
  editingRuleSourceId.value = rule.id
  editingRule.value = cloneRuleDraft(rule)
  resetOverrideEditors(editingRule.value)
}

function closeRuleEditor() {
  editingRule.value = null
  editingRuleSourceId.value = null
}

const isCreatingRule = computed(() => !!editingRule.value && editingRuleSourceId.value === null)
const hasRuleEditorValidationError = computed(() =>
  (headerEditorMode.value === 'json' && !!headerJsonError.value)
  || (queryEditorMode.value === 'json' && !!queryJsonError.value),
)

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

function handleJsonEditorTab(kind: OverrideEditorKind, event: KeyboardEvent) {
  event.preventDefault()
  const textarea = event.currentTarget as HTMLTextAreaElement
  const draft = kind === 'headers' ? headerJsonDraft : queryJsonDraft
  const indent = '  '
  const value = textarea.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd

  if (!event.shiftKey && start === end) {
    draft.value = `${value.slice(0, start)}${indent}${value.slice(end)}`
    applyOverrideJson(kind)
    nextTick(() => {
      textarea.focus()
      textarea.setSelectionRange(start + indent.length, start + indent.length)
    })
    return
  }

  const blockStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const block = value.slice(blockStart, end)
  const lines = block.split('\n')
  const affectedLineCount = block.endsWith('\n') ? Math.max(1, lines.length - 1) : lines.length

  if (!event.shiftKey) {
    const transformed = lines.map((line, index) => index < affectedLineCount ? `${indent}${line}` : line).join('\n')
    const added = indent.length * affectedLineCount
    draft.value = `${value.slice(0, blockStart)}${transformed}${value.slice(end)}`
    applyOverrideJson(kind)
    nextTick(() => {
      textarea.focus()
      textarea.setSelectionRange(start + indent.length, end + added)
    })
    return
  }

  let removed = 0
  let removedFromFirstLine = 0
  const transformed = lines.map((line, index) => {
    if (index >= affectedLineCount) return line
    const match = line.match(/^(?: {1,2}|\t)/)
    const count = match?.[0].length || 0
    if (index === 0) removedFromFirstLine = count
    removed += count
    return line.slice(count)
  }).join('\n')
  draft.value = `${value.slice(0, blockStart)}${transformed}${value.slice(end)}`
  applyOverrideJson(kind)
  nextTick(() => {
    textarea.focus()
    const nextStart = Math.max(blockStart, start - removedFromFirstLine)
    const nextEnd = Math.max(nextStart, end - removed)
    textarea.setSelectionRange(nextStart, nextEnd)
  })
}

async function commitRuleEditor() {
  if (!editingRule.value) return
  if (headerEditorMode.value === 'json' && !applyOverrideJson('headers')) return notify('Header JSON 格式不正确', 'error')
  if (queryEditorMode.value === 'json' && !applyOverrideJson('query')) return notify('Query JSON 格式不正确', 'error')
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
async function exportHar() {
  let exportRecords = records.value
  if (isExtension) {
    const result = await send<{ ok: boolean; records?: NetworkRecord[]; error?: string }>({ type: 'GET_EXPORT_RECORDS' })
    if (!result?.ok) return notify(result?.error || 'HAR 数据读取失败', 'error')
    exportRecords = result.records || []
  }
  const har = { log: { version: '1.2', creator: { name: '随页', version: '0.1.3' }, entries: exportRecords.map(r => ({ startedDateTime: new Date(r.startedAt).toISOString(), time: r.duration || 0, request: { method: r.method, url: r.url, headers: Object.entries(r.requestHeaders).map(([name, value]) => ({ name, value: String(value) })), postData: r.requestBody ? { mimeType: String(r.requestHeaders?.['content-type'] || ''), text: r.requestBody } : undefined }, response: { status: r.status || 0, statusText: r.statusText || '', headers: Object.entries(r.responseHeaders).map(([name, value]) => ({ name, value: String(value) })), content: { mimeType: r.mimeType || '', text: r.responseBody || '' } } })) } }
  const url = URL.createObjectURL(new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `suiye-${Date.now()}.har`; a.click(); URL.revokeObjectURL(url)
  notify('HAR 已导出')
}

onBeforeUnmount(() => {
  cancelMainTabDrag()
  window.removeEventListener('pointerdown', handlePrimaryMoreOutside)
  window.removeEventListener('resize', positionPrimaryMore)
  window.removeEventListener('resize', constrainSheetHeightsToViewport)
})

onMounted(async () => {
  window.addEventListener('pointerdown', handlePrimaryMoreOutside)
  window.addEventListener('resize', positionPrimaryMore)
  window.addEventListener('resize', constrainSheetHeightsToViewport)
  await Promise.all([loadMfaAccountCount(), loadApiFlowCount()])
  if (isExtension) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[MFA_STORAGE_KEY]) {
        mfaAccountCount.value = readMfaAccountCount(changes[MFA_STORAGE_KEY].newValue)
      }
      if (areaName === 'local' && changes[API_FLOW_STORAGE_KEY]) {
        apiFlowCount.value = Array.isArray(changes[API_FLOW_STORAGE_KEY].newValue) ? changes[API_FLOW_STORAGE_KEY].newValue.length : 0
      }
    })
    const state = await send({ type: 'GET_STATE' })
    recording.value = !!state.recording
    tabCaptureStates.value = state.tabCaptureStates || {}
    captureTabContexts.value = state.captureTabContexts || {}
    rememberBrowserTabs(state.captureTabOrder || [...Object.keys(captureTabContexts.value).map(Number), ...records.value.map(record => record.tabId)])
    if (typeof state.activeBrowserTabId === 'number') selectedBrowserTab.value = state.activeBrowserTabId
    records.value = state.networkRecords?.length ? state.networkRecords : []
    rules.value = Array.isArray(state.overrideRules) ? state.overrideRules : []
    settings.value = { ...settings.value, ...(state.settings || {}) }
    settings.value.ignoredDomains = normalizeIgnoredDomains(state.settings?.ignoredDomains)
    settings.value.visibleTabs = normalizeVisibleTabs(state.settings?.visibleTabs)
    settings.value.tabOrder = normalizeTabOrder(state.settings?.tabOrder)
    settings.value.navigationMode = state.settings?.navigationMode === 'compact' ? 'compact' : 'scroll'
    settings.value.requestSort = state.settings?.requestSort === 'oldest' ? 'oldest' : 'newest'
    requestSort.value = settings.value.requestSort
    const visibleTabs = new Set(settings.value.visibleTabs)
    settings.value.visibleTabs = settings.value.tabOrder.filter(tab => visibleTabs.has(tab))
    if (!settings.value.visibleTabs.includes(activeTab.value)) activeTab.value = settings.value.visibleTabs[0]
    cacheStats.value = state.cacheStats || cacheStats.value
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'RECORD_UPDATED') updateRecord(message.record)
      if (message.type === 'RECORDS_CLEARED') {
        records.value = message.tabId == null ? [] : records.value.filter(record => record.tabId !== message.tabId)
        if (selected.value && (message.tabId == null || selected.value.tabId === message.tabId)) selected.value = null
      }
      if (message.type === 'STATE_CHANGED') recording.value = message.recording
      if (message.type === 'CAPTURE_CANCELLED_BY_BROWSER') notify('Chrome 已结束调试连接，捕获已同步暂停', 'info')
      if (message.type === 'CACHE_STATS_UPDATED') cacheStats.value = message.cacheStats || cacheStats.value
      if (message.type === 'CACHE_STORAGE_WARNING') notify(message.error || '请求缓存空间不足', 'error')
      if (message.type === 'RECORDS_PRUNED') {
        const removedKeys = new Set<string>(message.storageKeys || [])
        records.value = records.value.filter(record => !record.storageKey || !removedKeys.has(record.storageKey))
        if (selected.value?.storageKey && removedKeys.has(selected.value.storageKey)) selected.value = null
      }
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
      }
    })
  } else {
    requestSort.value = localStorage.getItem('suiye-request-sort') === 'oldest' ? 'oldest' : 'newest'
    settings.value.requestSort = requestSort.value
    const savedXhrOnly = localStorage.getItem('suiye-xhr-only')
    if (savedXhrOnly != null) settings.value.xhrOnly = savedXhrOnly === 'true'
    records.value = demoRecords
    rules.value = demoRules
    cacheStats.value = { bytes: 1_572_352, bodyBytes: 1_481_216, recordCount: demoRecords.length, lastCleanupAt: Date.now() }
    recording.value = true
    tabCaptureStates.value = Object.fromEntries([...new Set(demoRecords.map(record => record.tabId))].map(tabId => [tabId, { state: 'attached' }]))
    rememberBrowserTabs([...new Set(demoRecords.map(record => record.tabId))])
    selectedBrowserTab.value = browserTabs.value[0]?.id || 'all'
  }
  selected.value = null
  await nextTick()
  settingsAutoSaveReady = true
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-mark"><img src="/icons/suiye.svg" alt="" /></div>
      <div class="brand-copy"><strong>随页</strong></div>
      <div class="top-spacer" />
      <SelectMenu v-model="theme" :options="themeOptions" compact align="right">
        <template #icon><Sun v-if="theme === 'light'" :size="15" /><Moon v-else-if="theme === 'dark'" :size="15" /><Monitor v-else :size="15" /></template>
      </SelectMenu>
      <button class="icon-button" title="设置" aria-label="设置" @click="openSettings()"><Settings2 :size="17" /></button>
    </header>

    <div class="primary-nav-frame">
      <nav
        ref="primaryNavViewport"
        class="primary-nav"
        :class="{ compact: settings.navigationMode === 'compact' }"
        aria-label="功能导航"
      >
      <button
        v-for="tab in primaryMainTabs"
        :key="tab.value"
        :data-main-tab="tab.value"
        :class="{
          active: activeTab === tab.value,
          'capture-live': tab.value === 'requests' && recording,
          'rules-live': tab.value === 'rules' && enabledRuleCount > 0,
        }"
        @click="selectPrimaryTab(tab.value)"
      >
        <span class="nav-icon"><component :is="tab.icon" :size="17" /></span>
        <span>{{ tab.label }}</span>
        <b v-if="tab.value === 'requests'">{{ displayRecords.length }}</b>
        <b v-else-if="tab.value === 'rules'">{{ enabledRuleCount }}</b>
        <b v-else-if="tab.value === 'flow' && apiFlowCount">{{ apiFlowCount > 99 ? '99+' : apiFlowCount }}</b>
        <b v-else-if="tab.value === 'mfa' && mfaAccountCount">{{ mfaAccountCount > 99 ? '99+' : mfaAccountCount }}</b>
      </button>
      <button
        v-if="overflowMainTabs.length"
        ref="primaryMoreTrigger"
        type="button"
        class="primary-nav-more"
        :class="{
          active: isOverflowMainTabActive,
          open: showPrimaryMore,
          'capture-live': overflowMainTabs.some(tab => tab.value === 'requests') && recording,
          'rules-live': overflowMainTabs.some(tab => tab.value === 'rules') && enabledRuleCount > 0,
        }"
        :aria-expanded="showPrimaryMore"
        aria-haspopup="menu"
        @click="togglePrimaryMore"
      >
        <span class="nav-icon"><MoreHorizontal :size="18" /></span>
        <span>更多</span>
      </button>
      </nav>
    </div>

    <Teleport to="body">
      <Transition name="select-pop">
        <div
          v-if="showPrimaryMore"
          ref="primaryMoreMenu"
          class="primary-nav-more-menu"
          :style="primaryMoreStyle"
          role="menu"
          aria-label="更多功能"
        >
          <button
            v-for="tab in overflowMainTabs"
            :key="tab.value"
            type="button"
            role="menuitem"
            :class="{ active: activeTab === tab.value }"
            @click="selectPrimaryTab(tab.value)"
          >
            <span class="more-menu-icon"><component :is="tab.icon" :size="16" /></span>
            <span class="more-menu-copy"><strong>{{ tab.label }}</strong><small>{{ tab.description }}</small></span>
            <b v-if="tab.value === 'requests'">{{ displayRecords.length }}</b>
            <b v-else-if="tab.value === 'rules'">{{ enabledRuleCount }}</b>
            <b v-else-if="tab.value === 'flow' && apiFlowCount">{{ apiFlowCount > 99 ? '99+' : apiFlowCount }}</b>
            <b v-else-if="tab.value === 'mfa' && mfaAccountCount">{{ mfaAccountCount > 99 ? '99+' : mfaAccountCount }}</b>
            <Check v-else-if="activeTab === tab.value" :size="15" />
          </button>
        </div>
      </Transition>
    </Teleport>

    <div class="page-stage">
      <Transition name="page" mode="out-in">
      <section v-if="activeTab === 'requests'" class="page requests-page">
      <header class="page-toolbar requests-toolbar">
        <div><b>请求记录</b><span>{{ recording ? '正在记录浏览器网页产生的网络流量' : '捕获已暂停，历史请求仍可查看' }}</span></div>
        <div class="requests-toolbar-actions">
          <button type="button" class="compose-flow-toggle" :class="{ active: composingApiFlow }" :title="composingApiFlow ? '退出接口编排' : '从请求创建接口流程'" :aria-label="composingApiFlow ? '退出接口编排' : '从请求创建接口流程'" @click="toggleApiFlowCompose"><ListChecks :size="14" />{{ composingApiFlow ? '退出编排' : '编排' }}</button>
          <button class="capture-toggle" :class="{ recording }" :aria-pressed="recording" :title="recording ? '停止捕获流量' : '开始捕获流量'" :aria-label="recording ? '停止捕获流量' : '开始捕获流量'" @click="toggleRecording">
            <Square v-if="recording" :size="11" fill="currentColor" />
            <Play v-else :size="12" fill="currentColor" />
            <span>{{ recording ? '停止捕获' : '开始捕获' }}</span>
          </button>
        </div>
      </header>
      <div ref="browserTabsViewport" class="browser-tabs" role="tablist" aria-label="浏览器标签页">
        <span class="browser-tabs-label" aria-hidden="true">网页</span>
        <div v-for="tab in browserTabs" :key="tab.id" class="browser-tab-wrap" :data-tab-id="tab.id" :class="{ closed: tabCaptureStates[tab.id]?.state === 'closed' }">
          <button class="browser-tab-item" role="tab" :aria-selected="selectedBrowserTab === tab.id" :class="{ active: selectedBrowserTab === tab.id, closed: tabCaptureStates[tab.id]?.state === 'closed' }" :title="browserTabTitle(tab)" @click="selectedBrowserTab = tab.id; selected = null"><i class="tab-capture-indicator" :class="tabCaptureStates[tab.id]?.state || 'idle'" /><span class="tab-label"><strong>{{ compactDomain(tab.domain) }}</strong></span><span v-if="tabCaptureStates[tab.id]?.state === 'closed'" class="tab-offline-badge">已断开</span><b class="tab-request-count">{{ tab.count }}</b></button>
          <button v-if="tabCaptureStates[tab.id]?.state === 'closed'" type="button" class="tab-dismiss-button" title="删除断联网页及其历史请求" :aria-label="`删除断联网页 ${tab.domain}`" @click.stop="dismissClosedTab(tab.id)"><X :size="11" /></button>
        </div>
      </div>

      <div class="request-tools" aria-label="当前网页的请求筛选">
        <div class="request-search-row">
          <label class="search"><Search :size="14" /><input v-model="search" placeholder="搜索当前网页请求" /></label>
          <SelectMenu :model-value="requestSort" :options="requestSortOptions" compact align="right" class="request-sort-select" @update:model-value="updateRequestSort">
            <template #icon><Clock3 :size="13" /></template>
          </SelectMenu>
        </div>
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

      <div class="request-list" :class="{ composing: composingApiFlow }">
        <template v-for="item in requestListItems" :key="item.key">
          <div v-if="item.kind === 'navigation'" class="request-navigation-divider" :title="`${item.fromUrl || item.fromLabel} → ${item.toUrl || item.toLabel}`">
            <i />
            <span class="navigation-divider-copy">
              <small>{{ item.reload ? '页面重新加载' : '页面已切换' }}</small>
              <span><b>{{ item.fromLabel }}</b><ArrowRight :size="12" /><strong>{{ item.toLabel }}</strong></span>
            </span>
            <time :datetime="new Date(item.startedAt).toISOString()" :title="formatTimeTitle(item.startedAt)">{{ formatTime(item.startedAt) }}</time>
            <i />
          </div>
          <button v-else class="request-row" :class="{ selected: composingApiFlow ? selectedFlowRequestKeys.has(flowRequestKey(item.record)) : selected?.tabId === item.record.tabId && selected?.id === item.record.id, composing: composingApiFlow }" @click="handleRequestRowClick(item.record)">
            <span v-if="composingApiFlow" class="flow-request-checkbox"><Check v-if="selectedFlowRequestKeys.has(flowRequestKey(item.record))" :size="12" /></span>
            <span class="method" :class="item.record.method.toLowerCase()">{{ item.record.method }}</span>
            <span class="request-main"><strong>{{ endpoint(item.record.url) }}</strong><small><span>{{ hostname(item.record.url) }} · {{ item.record.type }}</span><span v-if="selectedBrowserTab === 'all'" class="tab-badge">{{ item.record.pageTitle || item.record.pageDomain || '页面未知' }}</span><span v-if="item.record.isIframe" class="iframe-badge"><Frame :size="10" /> iframe</span></small></span>
            <span class="request-meta">
              <time :datetime="new Date(item.record.startedAt).toISOString()" :title="`发起时间：${formatTimeTitle(item.record.startedAt)}`">{{ formatTime(item.record.startedAt) }}</time>
              <span class="request-meta-line"><b :class="statusClass(item.record.error ? 500 : item.record.status)">{{ item.record.error ? 'ERR' : (item.record.status || '—') }}</b><small v-if="requestErrorLabel(item.record)" class="request-error" :title="requestErrorLabel(item.record)">{{ requestErrorLabel(item.record) }}</small><small v-else>{{ item.record.duration ?? '…' }} ms</small></span>
            </span>
          </button>
        </template>
        <div v-if="!requestListRecords.length" class="empty-state"><Radio :size="28" /><strong>{{ composingApiFlow ? '当前没有可编排的 XHR/FETCH' : '还没有捕获到请求' }}</strong><span>{{ composingApiFlow ? '先刷新网页并完成一次真实操作，再选择接口创建流程' : '点击请求页“开始捕获”，然后刷新页面' }}</span></div>
      </div>

      <Transition name="sheet">
      <div v-if="selected" class="sheet-backdrop request-detail-backdrop" @click.self="selected = null">
      <aside class="detail-panel resizable-sheet" :class="{ dragging: draggingSheet === 'detail' }" :style="{ height: `${detailHeight}px` }" role="dialog" aria-modal="true" aria-label="请求详情">
        <button class="resize-handle" title="拖动调整详情高度" aria-label="拖动调整请求详情高度" @pointerdown="startSheetResize('detail', $event)"><i /></button>
        <div class="detail-title"><div><span class="method" :class="selected.method.toLowerCase()">{{ selected.method }}</span><strong>{{ endpoint(selected.url) }}</strong></div><button @click="selected = null"><X :size="16" /></button></div>
        <div class="detail-tabs">
          <button v-for="tab in [['overview','概览'],['headers','请求头'],['request','请求数据'],['response','响应']]" :key="tab[0]" :class="{ active: detailTab === tab[0] }" @click="detailTab = tab[0] as DetailTab">{{ tab[1] }}</button>
        </div>
        <div class="detail-content">
          <template v-if="detailTab === 'overview'">
            <dl><div><dt>状态</dt><dd :class="statusClass(selected.status)">{{ selected.status }} {{ selected.statusText }}</dd></div><div><dt>耗时</dt><dd>{{ selected.duration }} ms</dd></div><div><dt>类型</dt><dd>{{ selected.mimeType || selected.type }}</dd></div><div><dt>发起时间</dt><dd>{{ formatTimeTitle(selected.startedAt) }}</dd></div></dl>
            <div v-if="selected.error || (selected.status || 0) >= 400" class="error-banner"><AlertTriangle :size="14" /><span><b>{{ selected.error ? '网络请求失败' : `HTTP ${selected.status}` }}</b><small>{{ selected.error || selected.statusText || '服务器返回了错误状态' }}</small></span></div>
            <label>完整 URL</label><div class="copy-field url-field"><span>{{ selected.url }}</span><button title="复制完整 URL" aria-label="复制完整 URL" @click="copyText(selected!.url)"><Copy :size="14" /></button></div>
          </template>
          <template v-else-if="detailTab === 'headers'">
            <div class="kv" v-for="(value, key) in selected.requestHeaders" :key="key"><b>{{ key }}</b><span>{{ value }}</span></div>
          </template>
          <div v-else-if="detailTab === 'request'" class="request-payload-view">
            <section v-if="queryParamsText(selected.url)" class="code-viewer query-parameters-block">
              <div class="code-toolbar"><span>QUERY PARAMETERS</span><button @click="copyText(queryParamsText(selected!.url))"><Copy :size="13" />复制</button></div>
              <pre v-html="highlightCode(queryParamsText(selected.url))" />
            </section>
            <section class="code-viewer request-body-block">
              <div class="code-toolbar"><span>REQUEST BODY</span><button v-if="selected.requestBody" @click="copyText(pretty(selected!.requestBody))"><Copy :size="13" />复制</button></div>
              <pre v-if="selected.requestBody" v-html="highlightCode(selected.requestBody)" />
              <div v-else class="payload-empty"><Database :size="20" /><b>{{ detailLoading ? '正在读取缓存正文…' : omittedBodyMessage(selected, 'request') }}</b><span v-if="!detailLoading && queryParamsText(selected.url)">URL 参数已在 Query Parameters 中单独展示</span><span v-else-if="!detailLoading && !selected.requestBodyOmittedReason">GET、HEAD 等请求通常不携带请求体</span></div>
            </section>
          </div>
          <div v-else class="code-viewer"><div class="code-toolbar"><span>RESPONSE BODY</span><button v-if="selected.responseBody" @click="copyText(pretty(selected.responseBody))"><Copy :size="13" />复制</button></div><pre v-if="selected.responseBody" v-html="highlightCode(selected.responseBody)" /><div v-else class="payload-empty"><Database :size="20" /><b>{{ detailLoading ? '正在读取缓存正文…' : omittedBodyMessage(selected, 'response') }}</b><span v-if="!detailLoading && selected.responseBodyBytes">原始大小 {{ formatBytes(selected.responseBodyBytes) }}</span></div></div>
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

    <ApiFlowTool
      v-else-if="activeTab === 'flow'"
      :draft-flow="pendingApiFlow"
      :height="flowEditorHeight"
      :dragging="draggingSheet === 'flow'"
      @draft-consumed="pendingApiFlow = null"
      @count-change="apiFlowCount = $event"
      @editor-open="restoreSheetHeight('flow')"
      @resize-start="startSheetResize('flow', $event)"
      @notify="notify"
    />

    <AutofillTool v-else-if="activeTab === 'autofill'" @notify="notify" />

    <section v-else-if="activeTab === 'tools'" class="page tools-page">
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

      <Transition name="page">
        <MfaTool v-show="activeTab === 'mfa'" :height="mfaToolHeight" :dragging="draggingSheet === 'mfa'" @sheet-open="restoreSheetHeight('mfa')" @resize-start="startSheetResize('mfa', $event)" @notify="notify" @count-change="mfaAccountCount = $event" />
      </Transition>
    </div>

    <footer v-if="activeTab === 'requests' && composingApiFlow" class="bottom-bar api-flow-compose-bar">
      <button type="button" class="compose-cancel" @click="toggleApiFlowCompose">取消</button>
      <span><b>{{ selectedFlowRequestCount }}</b> 个请求已选择</span>
      <button type="button" class="compose-create" :disabled="!selectedFlowRequestCount || creatingApiFlow" @click="createApiFlowFromSelection"><GitBranch :size="14" />{{ creatingApiFlow ? '正在分析…' : '创建接口流程' }}</button>
    </footer>
    <footer v-else-if="activeTab === 'requests'" class="bottom-bar">
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
      <div v-if="showSettings" class="sheet-backdrop" @click.self="closeSettings">
        <section class="settings-panel resizable-sheet" :class="{ 'guide-open': settingsView === 'guide', dragging: draggingSheet === 'settings' }" :style="{ height: `${settingsHeight}px` }" role="dialog" aria-modal="true" aria-label="随页设置">
          <button class="resize-handle" title="拖动调整设置面板高度" aria-label="拖动调整设置面板高度" @pointerdown="startSheetResize('settings', $event)"><i /></button>
          <header><div><h2>{{ settingsView === 'preferences' ? '偏好设置' : '使用说明' }}</h2></div><button aria-label="关闭设置" @click="closeSettings"><X :size="18" /></button></header>
          <nav class="settings-tabs" aria-label="设置内容">
            <button :class="{ active: settingsView === 'preferences' }" @click="settingsView = 'preferences'"><Settings2 :size="15" />偏好设置</button>
            <button :class="{ active: settingsView === 'guide' }" @click="settingsView = 'guide'"><BookOpen :size="15" />使用说明</button>
          </nav>
          <div v-if="settingsView === 'preferences'" class="settings-body">
            <div class="settings-group"><h3>外观</h3><div class="setting-row"><span><b>界面主题</b><small>选择浅色、深色或跟随系统</small></span><SelectMenu v-model="theme" :options="themeOptions" align="right" /></div></div>
            <div class="settings-group navigation-settings-group"><h3>导航标签</h3>
              <div class="setting-row navigation-mode-row">
                <span><b>标签展示方式</b><small>{{ settings.navigationMode === 'compact' ? '固定前 4 个常用标签，其余放进更多菜单' : '完整展示所有标签，超出宽度后可横向滚动' }}</small></span>
                <SelectMenu v-model="settings.navigationMode" :options="navigationModeOptions" align="right" />
              </div>
              <div class="nav-visibility-list">
                <div
                  v-for="tab in orderedMainTabDefinitions"
                  :key="tab.value"
                  class="nav-order-row"
                  :data-nav-tab="tab.value"
                  :class="{
                    enabled: isMainTabVisible(tab.value),
                    dragging: draggingMainTab === tab.value,
                    'insert-before': dragOverMainTab === tab.value && dragInsertPosition === 'before',
                    'insert-after': dragOverMainTab === tab.value && dragInsertPosition === 'after',
                  }"
                >
                  <button type="button" class="nav-drag-handle" :aria-label="`拖拽调整${tab.label}标签顺序`" :title="`拖拽调整${tab.label}标签顺序`" @pointerdown="startMainTabDrag(tab.value, $event)"><GripVertical :size="15" /></button>
                  <span class="nav-setting-icon"><component :is="tab.icon" :size="15" /></span>
                  <span class="nav-setting-copy"><b>{{ tab.label }}</b><small>{{ tab.description }}</small></span>
                  <button type="button" class="nav-visibility-toggle" :aria-pressed="isMainTabVisible(tab.value)" :aria-label="`${isMainTabVisible(tab.value) ? '隐藏' : '显示'}${tab.label}标签`" @click="toggleMainTabVisibility(tab.value)"><span class="toggle" :class="{ on: isMainTabVisible(tab.value) }"><i /></span></button>
                </div>
              </div>
              <p v-if="settings.navigationMode === 'compact'" class="navigation-mode-hint">拖拽调整顺序后，排在前 4 位且已启用的标签会固定显示。</p>
            </div>
            <div class="settings-group"><h3>网络记录</h3>
              <div class="setting-row"><span><b>只记录 Fetch / XHR</b><small>关闭后立即记录新产生的文档、脚本、样式、图片和其他资源</small></span><button class="toggle" :class="{ on: settings.xhrOnly }" :disabled="updatingCaptureScope" :aria-busy="updatingCaptureScope" @click="toggleXhrOnly"><i /></button></div>
              <div class="setting-row"><span><b>最多保留记录</b><small>超过数量后自动清理较早记录</small></span><SelectMenu v-model="settings.maxRecords" :options="recordLimitOptions" align="right" /></div>
              <div class="setting-row"><span><b>响应正文上限</b><small>单个响应超过此大小时不保存正文</small></span><SelectMenu v-model="settings.maxBodyMB" :options="bodyLimitOptions" align="right" /></div>
              <div class="ignored-domain-setting">
                <div class="ignored-domain-heading">
                  <span><b>排除埋点域名</b><small>匹配域名及其子域名的请求不会进入记录列表</small></span>
                  <button type="button" @click="restoreIgnoredDomains">恢复常用</button>
                </div>
                <div class="ignored-domain-tags">
                  <span v-for="domain in settings.ignoredDomains" :key="domain">{{ domain }}<button type="button" :aria-label="`取消过滤 ${domain}`" @click="removeIgnoredDomain(domain)"><X :size="11" /></button></span>
                  <small v-if="!settings.ignoredDomains.length">当前未排除任何域名</small>
                </div>
                <form class="ignored-domain-add" @submit.prevent="addIgnoredDomain">
                  <input v-model="ignoredDomainDraft" spellcheck="false" placeholder="输入域名，例如 analytics.google.com" />
                  <button type="submit"><Plus :size="13" />添加</button>
                </form>
              </div>
            </div>
            <div class="settings-group cache-settings-group"><h3>缓存管理</h3>
              <div class="cache-overview">
                <div class="cache-overview-title"><span><Database :size="17" /><b>当前已缓存</b></span><strong>{{ formatBytes(cacheStats.bytes) }} / {{ settings.maxCacheMB }} MB</strong></div>
                <div class="cache-meter" role="progressbar" :aria-valuenow="Math.round(cacheUsagePercent)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: `${cacheUsagePercent}%` }" /></div>
                <small>{{ cacheStats.recordCount }} 条请求 · 正文约 {{ formatBytes(cacheStats.bodyBytes) }}</small>
              </div>
              <div class="setting-row"><span><b>自动清理</b><small>定期移除超过保留时间的历史请求</small></span><SelectMenu v-model="settings.retentionMinutes" :options="retentionOptions" align="right" /></div>
              <div class="setting-row"><span><b>缓存容量上限</b><small>达到上限后优先清理最早记录</small></span><SelectMenu v-model="settings.maxCacheMB" :options="cacheLimitOptions" align="right" /></div>
              <div class="cache-clear-row"><button type="button" :class="{ confirming: cacheClearConfirm }" @click="clearAllCachedRequests"><Trash2 :size="14" />{{ cacheClearConfirm ? '再次点击，确认清空' : '清空全部请求缓存' }}</button><span>规则和偏好设置不会被删除</span></div>
            </div>
            <div class="settings-note"><ShieldCheck :size="17" /><span><b>正文按需读取，仅保存在本机</b><small>请求列表不会一次性载入全部正文，缓存也不会上传到服务器。</small></span></div>
          </div>
          <div v-else class="settings-guide-body">
            <div class="settings-guide-intro"><BookOpen :size="20" /><div><b>随页功能说明</b><span>网络调试、开发转换与浏览器效率工具的使用方法</span></div></div>
            <div class="guide-content">
              <section class="guide-card"><header><Radio :size="17" /><div><b>请求捕获</b><span>查看当前浏览器网页产生的网络流量</span></div></header><ul><li>点击顶部“开始捕获”，已打开的普通网页会自动连接。</li><li>网页标签按浏览器标签页区分，切换浏览器标签时会自动跟随。</li><li>支持按类型、方法、错误状态和关键词组合筛选。</li><li>请求详情包含请求头、请求体、响应正文和完整 Request 复制。</li></ul></section>
              <section class="guide-card"><header><SlidersHorizontal :size="17" /><div><b>请求覆写</b><span>在请求发送前修改 Header 与 Query</span></div></header><ul><li>规则可限定域名和请求资源类型，并支持随时启停。</li><li>Header 与 Query 同时支持键值模式和 JSON 模式。</li><li>JSON 对象中的 <code>null</code> 表示删除对应字段。</li><li>规则保存后立即应用，无需再次点击全局应用按钮。</li></ul></section>
              <section class="guide-card"><header><GitBranch :size="17" /><div><b>接口流程</b><span>把捕获的 XHR/FETCH 组合成可重复执行的请求链</span></div></header><ul><li>在请求页进入“编排”模式，按实际调用顺序选择接口并创建流程。</li><li>随页会拆分 Base API，并尝试识别前一步响应与后一步请求之间的变量关联。</li><li>响应数组支持运行时选择一项，再把选中字段传入后续请求。</li><li>任何请求、状态码或必需变量失败后都会立即停止，后续步骤不会继续执行。</li></ul></section>
              <section class="guide-card"><header><Layers3 :size="17" /><div><b>网页与连接状态</b><span>历史请求不会因为网页关闭而丢失</span></div></header><ul><li>蓝色状态点表示捕获连接正常，红色“已断开”表示网页已关闭。</li><li>断联网页仍可查看历史请求，也可以从标签右侧彻底删除。</li><li>底部“清空”菜单可一键清理已断开或 0 请求的无效网页。</li><li>仍在打开的空网页产生新请求后，会自动重新出现在列表中。</li></ul></section>
              <section class="guide-card"><header><Database :size="17" /><div><b>记录与导出</b><span>请求数据仅保存在当前浏览器本机</span></div></header><ul><li>请求正文保存在 IndexedDB，打开详情时才读取，避免列表占用过多内存。</li><li>缓存默认保留一小时，并受记录数量和总容量双重限制。</li><li>设置中可以查看当前占用、调整清理周期，或一键清空全部请求缓存。</li><li>支持导出 HAR，以及复制单个请求的 cURL 或完整信息。</li></ul></section>
              <section class="guide-card"><header><KeyRound :size="17" /><div><b>MFA 验证器</b><span>在独立标签中管理本机动态验证码</span></div></header><ul><li>支持导入 otpauth 地址、Base32 密钥或 JSON，并自动识别账户与验证码参数。</li><li>验证码和剩余时间会自动更新，点击整张账户卡片即可复制当前验证码。</li><li>MFA 密钥仅保存在本机扩展存储，不会同步到浏览器账号或上传。</li></ul></section>
              <section class="guide-card"><header><WandSparkles :size="17" /><div><b>智能填充</b><span>生成虚构身份并填写网页测试表单</span></div></header><ul><li>覆盖全球国家和地区，支持按中文、英文、国家代码或国际区号搜索，并内置中国等常用地区的本地化资料。</li><li>整组随机生成姓名、用户名、常用格式邮箱、国际号码、公司和地址，字段可单独复制。</li><li>会自动识别当前网页及普通 iframe 中的表单字段；支付测试支持 Stripe、Adyen、PayPal 与 Airwallex 的多种成功、失败及 3DS 场景。</li><li>随页只填写识别到的字段，不会自动提交表单或保存真实银行卡资料。</li></ul></section>
              <section class="guide-card"><header><Braces :size="17" /><div><b>开发工具</b><span>在本地完成转换与内容处理</span></div></header><ul><li>开发转换支持 JSON、URL、Base64、JWT、时间戳和内容生成。</li><li>二维码默认使用当前网页地址，设置可折叠，并支持复制或下载 PNG/SVG。</li><li>内容对比支持文本与 JSON，输入和结果均采用 A/B 双栏，JSON 实时高亮。</li><li>所有输入内容仅在当前侧边栏处理，不会上传。</li></ul></section>
              <div class="guide-note"><ShieldCheck :size="18" /><div><b>隐私与浏览器提示</b><span>随页不会上传请求数据。捕获完整响应正文需要浏览器调试接口，Chrome 可能显示正在调试标签页的安全提示。</span></div></div>
            </div>
          </div>
          <footer v-if="settingsView === 'preferences'" class="settings-auto-footer">
            <span class="settings-save-state" :class="settingsSaveState" role="status" aria-live="polite">
              <CheckCircle2 v-if="settingsSaveState === 'saved'" :size="15" />
              <Clock3 v-else-if="settingsSaveState === 'saving'" :size="15" />
              <CircleAlert v-else :size="15" />
              {{ settingsSaveLabel }}
            </span>
            <button class="secondary-button" @click="closeSettings">完成</button>
          </footer>
          <footer v-else class="settings-guide-footer"><button class="secondary-button" @click="closeSettings">关闭</button></footer>
        </section>
      </div>
    </Transition>
    <Transition name="sheet">
      <div v-if="editingRule" class="sheet-backdrop rule-editor-backdrop" @click.self="closeRuleEditor">
        <section class="rule-editor resizable-sheet" :class="{ dragging: draggingSheet === 'rule' }" :style="{ height: `${ruleEditorHeight}px` }" role="dialog" aria-modal="true" aria-label="请求覆写规则编辑器">
          <button class="resize-handle" title="拖动调整规则编辑器高度" aria-label="拖动调整规则编辑器高度" @pointerdown="startSheetResize('rule', $event)"><i /></button>
          <header><div><h2>{{ isCreatingRule ? '创建请求覆写' : '编辑请求覆写' }}</h2></div><button class="editor-close" aria-label="关闭规则面板" @click="closeRuleEditor"><X :size="18" /></button></header>
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
                  <pre ref="headerJsonHighlight" aria-hidden="true" v-html="highlightJsonDraft(headerJsonDraft)" />
                  <textarea v-model="headerJsonDraft" spellcheck="false" aria-label="Header JSON" placeholder="{&#10;  &quot;x-forwarded-for&quot;: &quot;203.0.113.42&quot;,&#10;  &quot;authorization&quot;: null&#10;}" @input="applyOverrideJson('headers')" @keydown.tab="handleJsonEditorTab('headers', $event)" @scroll="syncJsonEditorScroll('headers', $event)" />
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
                  <pre ref="queryJsonHighlight" aria-hidden="true" v-html="highlightJsonDraft(queryJsonDraft)" />
                  <textarea v-model="queryJsonDraft" spellcheck="false" aria-label="Query JSON" placeholder="{&#10;  &quot;debug&quot;: &quot;1&quot;,&#10;  &quot;cache&quot;: null&#10;}" @input="applyOverrideJson('query')" @keydown.tab="handleJsonEditorTab('query', $event)" @scroll="syncJsonEditorScroll('query', $event)" />
                </div>
                <div v-if="queryJsonError" class="json-editor-error"><AlertTriangle :size="12" />{{ queryJsonError }}</div>
              </div>
            </div>
          </div>
          <footer><button v-if="!isCreatingRule" class="danger-button" @click="removeRule(editingRule!)"><Trash2 :size="15" />删除规则</button><span /><button class="secondary-button" @click="closeRuleEditor">取消</button><button class="primary-button" :disabled="hasRuleEditorValidationError" :title="hasRuleEditorValidationError ? '请先修正 JSON 格式错误' : undefined" @click="commitRuleEditor"><Check :size="15" />{{ isCreatingRule ? '创建并应用' : '保存并应用' }}</button></footer>
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
