<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AlertTriangle, ArrowDown, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, CircleStop, Clipboard, Copy, ExternalLink, FileJson, GitBranch, GripHorizontal, Link2, ListChecks, LoaderCircle, Minus, Play, Plus, Save, Trash2, Variable, X } from 'lucide-vue-next'
import SelectMenu from './SelectMenu.vue'
import type { ApiFlow, ApiFlowExtractor, ApiFlowRequest, ApiFlowRequestResult, ApiFlowSelection, ApiFlowStep, Method } from '../types'
import { getValueAtPath, parseApiFlowResponse, renderApiFlowRequest, resolveValueAtPath, suggestValuePaths } from '../utils/api-flow'
import { loadStoredApiFlows, saveStoredApiFlows } from '../utils/api-flow-store'

const props = defineProps<{
  draftFlow?: ApiFlow | null
  height: number
  dragging: boolean
}>()
const emit = defineEmits<{
  notify: [message: string, tone?: 'success' | 'error' | 'info']
  draftConsumed: []
  countChange: [count: number]
  editorOpen: []
  resizeStart: [event: PointerEvent]
}>()

type StepStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'
type PendingSelection = { stepIndex: number; selection: ApiFlowSelection; items: unknown[] }

const isExtension = location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && !!chrome.runtime?.id
const flows = ref<ApiFlow[]>([])
const editing = ref<ApiFlow | null>(null)
const saving = ref(false)
const deleteTarget = ref<ApiFlow | null>(null)
const activeRunFlow = ref<ApiFlow | null>(null)
const running = ref(false)
const runCompleted = ref(false)
const cancelRequested = ref(false)
const stepStatuses = ref<StepStatus[]>([])
const runError = ref('')
const runtimeVariables = ref<Record<string, unknown>>({})
const runOutputs = ref<Array<{ name: string; value: unknown }>>([])
const lastRunResponses = ref<Record<string, string>>({})
const failedStepId = ref('')
const pendingSelection = ref<PendingSelection | null>(null)
const selectedItemIndex = ref(0)
const bodyEditorHeights = ref<Record<string, number>>({})
const activePathPicker = ref('')
const loaded = ref(false)
let selectionResolver: ((index: number | null) => void) | null = null

const methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(value => ({ label: value, value }))
const selectionModeOptions = [
  { label: '每次运行时选择', value: 'manual', description: '流程运行到这里时暂停，由你从返回列表中选一项' },
  { label: '自动取第一项', value: 'first', description: '列表非空时直接使用第一项' },
]

const flowCount = computed(() => flows.value.length)
const isCreatingFlow = computed(() => !!editing.value && !flows.value.some(flow => flow.id === editing.value?.id))
const outputNames = (flow: ApiFlow) => flow.steps.flatMap(step => step.extractors.filter(item => item.output).map(item => item.name))
const failedStepNumber = computed(() => {
  const index = activeRunFlow.value?.steps.findIndex(step => step.id === failedStepId.value) ?? -1
  return index >= 0 ? index + 1 : 0
})
const failedStepName = computed(() => activeRunFlow.value?.steps[failedStepNumber.value - 1]?.name || '')
const runPanelVisible = computed(() => running.value || runCompleted.value || !!runError.value)
const pendingSelectionStepName = computed(() => {
  if (!pendingSelection.value) return ''
  return activeRunFlow.value?.steps[pendingSelection.value.stepIndex]?.name || `第 ${pendingSelection.value.stepIndex + 1} 步`
})
const selectedPendingValue = computed(() => {
  if (!pendingSelection.value) return undefined
  return selectionValue(pendingSelection.value.items[selectedItemIndex.value], pendingSelection.value.selection.valueField)
})

function cloneFlow<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function createEmptyFlow(): ApiFlow {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: '未命名接口流程',
    variables: [{ id: crypto.randomUUID(), name: 'baseApi', value: 'https://api.example.com' }],
    steps: [createEmptyStep(0)],
    createdAt: now,
    updatedAt: now,
  }
}

function createEmptyStep(index: number): ApiFlowStep {
  return {
    id: crypto.randomUUID(),
    name: `接口步骤 ${index + 1}`,
    method: 'GET',
    url: '{{baseApi}}/api/path',
    headers: { accept: 'application/json' },
    body: '',
    extractors: [],
  }
}

function createDemoFlow(): ApiFlow {
  const now = Date.now()
  return {
    id: 'demo-api-flow',
    name: '套餐下单与支付',
    variables: [
      { id: crypto.randomUUID(), name: 'baseApi', value: 'https://api.example.com' },
      { id: crypto.randomUUID(), name: 'channel', value: 'google_pay' },
    ],
    steps: [
      {
        id: crypto.randomUUID(),
        name: '获取价格套餐',
        method: 'GET',
        url: '{{baseApi}}/price/list?channel={{channel}}',
        headers: { accept: 'application/json' },
        body: '',
        extractors: [],
        selection: { sourcePath: '$.data.list', valueField: 'id', variableName: 'planId', labelFields: ['name', 'price', 'currency'], mode: 'manual' },
        sampleResponse: JSON.stringify({ code: 0, data: { list: [{ id: 801, name: '月套餐', price: '9.99', currency: 'EUR' }, { id: 815, name: '年套餐', price: '69.99', currency: 'EUR' }] } }, null, 2),
      },
      {
        id: crypto.randomUUID(),
        name: '创建订单',
        method: 'POST',
        url: '{{baseApi}}/order/create',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ planId: '{{planId}}' }, null, 2),
        extractors: [{ id: crypto.randomUUID(), name: 'orderId', path: '$.data.orderId', required: true }],
        sampleResponse: JSON.stringify({ code: 0, data: { orderId: 'ORDER-20260723-001' } }, null, 2),
      },
      {
        id: crypto.randomUUID(),
        name: '发起支付',
        method: 'POST',
        url: '{{baseApi}}/order/pay',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: '{{orderId}}', channel: '{{channel}}' }, null, 2),
        extractors: [{ id: crypto.randomUUID(), name: 'payUrl', path: '$.data.payUrl', output: true, required: true }],
        sampleResponse: JSON.stringify({ code: 0, data: { payUrl: 'https://pay.example.com/checkout/ORDER-20260723-001' } }, null, 2),
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

async function loadFlows() {
  if (isExtension) {
    flows.value = await loadStoredApiFlows()
  } else {
    const stored = localStorage.getItem('suiye-api-flows-v1')
    flows.value = stored ? JSON.parse(stored) : [createDemoFlow()]
  }
  emit('countChange', flows.value.length)
}

async function persistFlows() {
  const plainFlows = cloneFlow(flows.value)
  if (isExtension) await saveStoredApiFlows(plainFlows)
  else localStorage.setItem('suiye-api-flows-v1', JSON.stringify(plainFlows))
  emit('countChange', flows.value.length)
}

function validateFlow(flow: ApiFlow) {
  if (!flow.name.trim()) throw new Error('请输入流程名称')
  if (!flow.steps.length) throw new Error('流程至少需要一个请求步骤')
  const names = new Set<string>()
  for (const variable of flow.variables) {
    if (!/^[a-zA-Z_$][\w$]*$/.test(variable.name)) throw new Error(`变量名 ${variable.name || '为空'} 不合法`)
    if (names.has(variable.name)) throw new Error(`变量 ${variable.name} 重复`)
    names.add(variable.name)
  }
  for (const [index, step] of flow.steps.entries()) {
    if (!step.url.trim()) throw new Error(`步骤 ${index + 1} 缺少请求地址`)
    if (step.body.trim() && /^[{[]/.test(step.body.trim())) {
      try { JSON.parse(step.body) } catch { throw new Error(`步骤 ${index + 1} 的请求体 JSON 格式不正确`) }
    }
    for (const extractor of step.extractors) {
      if (!extractor.name.trim() || !extractor.path.trim()) throw new Error(`步骤 ${index + 1} 存在未填写完整的响应变量`)
    }
  }
}

async function saveEditing(showFeedback = true) {
  if (!editing.value) return false
  const previousFlows = cloneFlow(flows.value)
  try {
    validateFlow(editing.value)
    saving.value = true
    editing.value.updatedAt = Date.now()
    const index = flows.value.findIndex(item => item.id === editing.value!.id)
    if (index >= 0) flows.value[index] = cloneFlow(editing.value)
    else flows.value.unshift(cloneFlow(editing.value))
    await persistFlows()
    if (showFeedback) emit('notify', '接口流程已保存')
    return true
  } catch (error) {
    flows.value = previousFlows
    emit('countChange', flows.value.length)
    emit('notify', error instanceof Error ? error.message : '流程保存失败', 'error')
    return false
  } finally {
    saving.value = false
  }
}

async function saveAndClose() {
  if (!(await saveEditing())) return
  editing.value = null
  resetRunState()
}

function editFlow(flow: ApiFlow) {
  emit('editorOpen')
  editing.value = cloneFlow(flow)
  resetRunState()
}

function newFlow() {
  emit('editorOpen')
  editing.value = createEmptyFlow()
  resetRunState()
}

function closeEditor() {
  if (running.value) return
  editing.value = null
  resetRunState()
}

function requestDeleteFlow(flow: ApiFlow) {
  deleteTarget.value = flow
}

async function confirmDeleteFlow() {
  const flow = deleteTarget.value
  if (!flow) return
  const previousFlows = cloneFlow(flows.value)
  try {
    flows.value = flows.value.filter(item => item.id !== flow.id)
    deleteTarget.value = null
    await persistFlows()
    if (activeRunFlow.value?.id === flow.id) resetRunState()
    emit('notify', '接口流程已删除', 'info')
  } catch (error) {
    flows.value = previousFlows
    emit('countChange', flows.value.length)
    emit('notify', error instanceof Error ? error.message : '流程删除失败', 'error')
  }
}

function addVariable() {
  if (!editing.value) return
  const names = new Set(editing.value.variables.map(item => item.name))
  let index = 1
  while (names.has(`variable${index}`)) index += 1
  editing.value.variables.push({ id: crypto.randomUUID(), name: `variable${index}`, value: '' })
}

function removeVariable(index: number) {
  if (!editing.value) return
  if (editing.value.variables[index]?.name === 'baseApi') {
    emit('notify', 'Base API 是流程必需参数', 'info')
    return
  }
  editing.value.variables.splice(index, 1)
}

function addStep() {
  if (!editing.value) return
  editing.value.steps.push(createEmptyStep(editing.value.steps.length))
  void nextTick(() => document.querySelector('.api-flow-step:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

function removeStep(index: number) {
  if (!editing.value || editing.value.steps.length <= 1) return
  editing.value.steps.splice(index, 1)
}

function moveStep(index: number, direction: -1 | 1) {
  if (!editing.value) return
  const target = index + direction
  if (target < 0 || target >= editing.value.steps.length) return
  const [step] = editing.value.steps.splice(index, 1)
  editing.value.steps.splice(target, 0, step)
}

function addHeader(step: ApiFlowStep) {
  let key = 'x-header'
  let index = 2
  while (key in step.headers) key = `x-header-${index++}`
  step.headers = { ...step.headers, [key]: '' }
}

function updateHeader(step: ApiFlowStep, oldName: string, nextName: string) {
  if (oldName === nextName) return
  const entries = Object.entries(step.headers)
  step.headers = Object.fromEntries(entries.map(([name, value]) => [name === oldName ? nextName : name, value]))
}

function removeHeader(step: ApiFlowStep, name: string) {
  step.headers = Object.fromEntries(Object.entries(step.headers).filter(([key]) => key !== name))
}

function addExtractor(step: ApiFlowStep, path = '') {
  const candidatePath = path || responsePathEntries(step)[0]?.path || '$.data'
  const existing = step.extractors.find(extractor => extractor.path === candidatePath)
  if (existing) {
    emit('notify', `${candidatePath} 已保存为变量 ${existing.name}`, 'info')
    return
  }
  const usedNames = new Set([
    ...(editing.value?.variables.map(variable => variable.name) || []),
    ...(editing.value?.steps.flatMap(item => item.extractors.map(extractor => extractor.name)) || []),
  ])
  const rawName = candidatePath.match(/(?:\.([^.[\]]+)|\[['"]?([^'"\]]+)['"]?\])$/)?.slice(1).find(Boolean) || 'result'
  const baseName = rawName
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/[^a-zA-Z0-9_$]+(.)?/g, (_, next = '') => next.toUpperCase()) || 'result'
  let name = baseName
  let suffix = 2
  while (usedNames.has(name)) name = `${baseName}${suffix++}`
  step.extractors.push({ id: crypto.randomUUID(), name, path: candidatePath, required: true })
  activePathPicker.value = ''
  if (path) emit('notify', `已添加变量 ${name}`, 'success')
}

function removeExtractor(step: ApiFlowStep, index: number) {
  step.extractors.splice(index, 1)
}

function formatBody(step: ApiFlowStep) {
  try {
    step.body = JSON.stringify(JSON.parse(step.body), null, 2)
  } catch {
    emit('notify', '请求体不是合法 JSON', 'error')
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlightJson(value: string) {
  return escapeHtml(value || ' ').replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+\-]?\d+)?\b/gi, (match, quoted, colon) => {
    if (quoted) return `<span class="${colon ? 'json-key' : 'json-string'}">${quoted}</span>${colon || ''}`
    if (/true|false/i.test(match)) return `<span class="json-boolean">${match}</span>`
    if (/null/i.test(match)) return `<span class="json-null">${match}</span>`
    return `<span class="json-number">${match}</span>`
  })
}

type ResponsePathEntry = {
  path: string
  key: string
  value: unknown
  kind: 'array' | 'object' | 'value'
}

function responsePathEntries(step: ApiFlowStep): ResponsePathEntry[] {
  if (!step.sampleResponse) return []
  const parsed = parseApiFlowResponse(step.sampleResponse)
  if (typeof parsed === 'string' && parsed === step.sampleResponse) return []
  const entries: ResponsePathEntry[] = []
  const walk = (value: unknown, path: string) => {
    if (entries.length >= 500) return
    if (Array.isArray(value)) {
      if (path !== '$') entries.push({ path, key: path.split('.').at(-1) || path, value, kind: 'array' })
      value.forEach((child, index) => walk(child, `${path}[${index}]`))
      return
    }
    if (value && typeof value === 'object') {
      if (path !== '$') entries.push({ path, key: path.split('.').at(-1) || path, value, kind: 'object' })
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        const childPath = /^[a-zA-Z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
        walk(child, childPath)
      })
      return
    }
    const key = path.match(/(?:\.([^.[\]]+)|\[['"]?([^'"\]]+)['"]?\])$/)?.slice(1).find(Boolean) || path
    entries.push({ path, key, value, kind: 'value' })
  }
  walk(parsed, '$')
  return entries
}

function filteredResponsePaths(step: ApiFlowStep, query = '') {
  const normalized = query.trim().toLowerCase().replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  const lastToken = normalized.match(/([^.[\]]+)$/)?.[1] || ''
  const entries = responsePathEntries(step)
  if (!normalized || normalized === '$' || normalized === '$.') return entries.slice(0, 80)
  return entries
    .filter(entry => entry.path.toLowerCase().includes(normalized) || (!!lastToken && entry.key.toLowerCase().includes(lastToken)))
    .slice(0, 80)
}

function responsePathValue(entry: ResponsePathEntry) {
  if (entry.kind === 'array') return `数组 · ${(entry.value as unknown[]).length} 项`
  if (entry.kind === 'object') return `对象 · ${Object.keys(entry.value as object).length} 个字段`
  return readablePathValue(entry.value)
}

function openPathPicker(step: ApiFlowStep, extractor: ApiFlowExtractor) {
  if (!step.sampleResponse) return
  activePathPicker.value = `${step.id}:${extractor.id}`
}

function closePathPicker(step: ApiFlowStep, extractor: ApiFlowExtractor) {
  const pickerKey = `${step.id}:${extractor.id}`
  window.setTimeout(() => {
    if (activePathPicker.value === pickerKey) activePathPicker.value = ''
  }, 100)
}

function chooseResponsePath(step: ApiFlowStep, extractor: ApiFlowExtractor, path: string) {
  extractor.path = path
  activePathPicker.value = ''
}

function interactiveResponseSampleHtml(step: ApiFlowStep) {
  const parsed = parseApiFlowResponse(step.sampleResponse || '')
  if (typeof parsed === 'string' && parsed === step.sampleResponse) return highlightJson(parsed)
  const extractedPaths = new Set(step.extractors.map(extractor => extractor.path))
  const render = (value: unknown, path: string, depth: number): string => {
    const indent = '  '.repeat(depth)
    const childIndent = '  '.repeat(depth + 1)
    if (Array.isArray(value)) {
      if (!value.length) return '[]'
      return `[\n${value.map((child, index) => `${childIndent}${render(child, `${path}[${index}]`, depth + 1)}`).join(',\n')}\n${indent}]`
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      if (!entries.length) return '{}'
      return `{\n${entries.map(([key, child]) => {
        const childPath = /^[a-zA-Z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
        const encodedPath = encodeURIComponent(childPath)
        const extractedClass = extractedPaths.has(childPath) ? ' extracted' : ''
        const keyHtml = `<span class="sample-json-key${extractedClass}" data-flow-path="${encodedPath}" title="点击保存为变量">${escapeHtml(JSON.stringify(key))}</span>`
        return `${childIndent}${keyHtml}: ${render(child, childPath, depth + 1)}`
      }).join(',\n')}\n${indent}}`
    }
    if (typeof value === 'string') return `<span class="json-string">${escapeHtml(JSON.stringify(value))}</span>`
    if (typeof value === 'number') return `<span class="json-number">${value}</span>`
    if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`
    return '<span class="json-null">null</span>'
  }
  return render(parsed, '$', 0)
}

function handleResponseSampleClick(event: MouseEvent, step: ApiFlowStep) {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-flow-path]')
  if (!target?.dataset.flowPath) return
  try {
    addExtractor(step, decodeURIComponent(target.dataset.flowPath))
  } catch {
    emit('notify', '无法识别该响应字段', 'error')
  }
}

function formattedResponseSample(value = '') {
  const parsed = parseApiFlowResponse(value)
  return typeof parsed === 'string' && parsed === value ? value : JSON.stringify(parsed, null, 2)
}

function isJsonSample(value = '') {
  const parsed = parseApiFlowResponse(value)
  return typeof parsed !== 'string' || parsed !== value
}

function readablePathValue(value: unknown) {
  if (value === '') return '空字符串'
  if (value === null) return 'null'
  if (value === undefined) return '未找到'
  if (typeof value === 'string') return value.length > 90 ? `${value.slice(0, 90)}…` : value
  const text = JSON.stringify(value)
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}

type ExtractorPreview = { found: boolean; label: string; value?: unknown; resolvedPath?: string; suggestedPath?: string }

const extractorPreviews = computed<Record<string, ExtractorPreview>>(() => {
  const previews: Record<string, ExtractorPreview> = {}
  for (const step of editing.value?.steps || []) {
    if (!step.sampleResponse) {
      step.extractors.forEach(extractor => { previews[`${step.id}:${extractor.id}`] = { found: false, label: '暂无响应样本，运行时再检查' } })
      continue
    }
    const response = parseApiFlowResponse(step.sampleResponse)
    for (const extractor of step.extractors) {
      const resolution = resolveValueAtPath(response, extractor.path)
      if (!resolution.found) {
        const suggestions = suggestValuePaths(response, extractor.path, 1)
        previews[`${step.id}:${extractor.id}`] = { found: false, label: suggestions.length ? `未找到，可能是 ${suggestions[0]}` : '样本中没有这个路径', suggestedPath: suggestions[0] }
        continue
      }
      previews[`${step.id}:${extractor.id}`] = {
        found: true,
        label: readablePathValue(resolution.value),
        value: resolution.value,
        resolvedPath: resolution.resolvedPath,
      }
    }
  }
  return previews
})

function extractorPreview(step: ApiFlowStep, extractor: ApiFlowExtractor): ExtractorPreview {
  return extractorPreviews.value[`${step.id}:${extractor.id}`] || { found: false, label: '暂无响应样本，运行时再检查' }
}

function bodyEditorHeight(stepId: string) {
  return bodyEditorHeights.value[stepId] || 220
}

function adjustBodyEditorHeight(stepId: string, change: number) {
  const nextHeight = Math.min(620, Math.max(150, bodyEditorHeight(stepId) + change))
  bodyEditorHeights.value = { ...bodyEditorHeights.value, [stepId]: nextHeight }
}

function startBodyResize(stepId: string, event: MouseEvent) {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = bodyEditorHeight(stepId)
  const onMove = (moveEvent: MouseEvent) => {
    const nextHeight = Math.min(620, Math.max(150, startHeight + moveEvent.clientY - startY))
    bodyEditorHeights.value = { ...bodyEditorHeights.value, [stepId]: nextHeight }
  }
  const onEnd = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onEnd)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onEnd, { once: true })
}

function handleBodyKeydown(event: KeyboardEvent, step: ApiFlowStep) {
  if (event.key !== 'Tab') return
  event.preventDefault()
  const textarea = event.currentTarget as HTMLTextAreaElement
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  step.body = `${step.body.slice(0, start)}  ${step.body.slice(end)}`
  void nextTick(() => {
    textarea.selectionStart = textarea.selectionEnd = start + 2
  })
}

function syncCodeScroll(event: Event) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  const highlight = textarea.previousElementSibling as HTMLElement | null
  if (!highlight) return
  highlight.scrollTop = textarea.scrollTop
  highlight.scrollLeft = textarea.scrollLeft
}

function stepProducedVariables(step: ApiFlowStep) {
  return [...step.extractors.map(item => item.name), ...(step.selection ? [step.selection.variableName] : [])].filter(Boolean)
}

function stepReferencedVariables(step: ApiFlowStep) {
  const source = `${step.url}\n${step.body}\n${JSON.stringify(step.headers)}`
  return [...source.matchAll(/\{\{\s*([\w$]+)\s*\}\}/g)].map(match => match[1])
}

function connectionVariables(step: ApiFlowStep, nextStep: ApiFlowStep) {
  const referenced = new Set(stepReferencedVariables(nextStep))
  return stepProducedVariables(step).filter(name => referenced.has(name))
}

function resetRunState() {
  activeRunFlow.value = null
  running.value = false
  runCompleted.value = false
  cancelRequested.value = false
  stepStatuses.value = []
  runError.value = ''
  runtimeVariables.value = {}
  runOutputs.value = []
  lastRunResponses.value = {}
  failedStepId.value = ''
  pendingSelection.value = null
  selectionResolver = null
}

async function executeRequest(request: ApiFlowRequest, sampleResponse?: string): Promise<ApiFlowRequestResult> {
  if (!isExtension) {
    await new Promise(resolve => window.setTimeout(resolve, 420))
    return { ok: true, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: sampleResponse || '{"code":0,"data":{}}', duration: 420 }
  }
  return chrome.runtime.sendMessage({
    type: 'EXECUTE_API_REQUEST',
    requestId: crypto.randomUUID(),
    request,
  })
}

function waitForSelection(stepIndex: number, selection: ApiFlowSelection, items: unknown[]) {
  selectedItemIndex.value = 0
  pendingSelection.value = { stepIndex, selection, items }
  return new Promise<number | null>(resolve => {
    selectionResolver = resolve
  })
}

function chooseSelection(index: number) {
  pendingSelection.value = null
  selectionResolver?.(index)
  selectionResolver = null
}

function selectionLabel(item: unknown, index: number, fields: string[]) {
  if (!item || typeof item !== 'object') return String(item ?? `第 ${index + 1} 项`)
  const object = item as Record<string, unknown>
  const labels = fields.map(field => object[field]).filter(value => value !== undefined && value !== null && value !== '')
  return labels.length ? labels.join(' · ') : String(object.name || object.title || object.id || `第 ${index + 1} 项`)
}

function selectionValue(item: unknown, valueField: string) {
  if (!valueField) return item
  return valueField.split('.').reduce<any>((current, key) => current == null ? undefined : current[key], item)
}

async function runFlow(sourceFlow?: ApiFlow) {
  if (running.value) return
  if (!sourceFlow && (!editing.value || !(await saveEditing(false)))) return
  const flow = cloneFlow(sourceFlow || editing.value!)
  try {
    validateFlow(flow)
  } catch (error) {
    emit('notify', error instanceof Error ? error.message : '流程配置不完整', 'error')
    return
  }
  activeRunFlow.value = cloneFlow(flow)
  const variables: Record<string, unknown> = Object.fromEntries(flow.variables.map(variable => [variable.name, variable.value]))
  running.value = true
  runCompleted.value = false
  cancelRequested.value = false
  runError.value = ''
  runOutputs.value = []
  lastRunResponses.value = {}
  failedStepId.value = ''
  runtimeVariables.value = { ...variables }
  stepStatuses.value = flow.steps.map(() => 'idle')

  try {
    for (let index = 0; index < flow.steps.length; index += 1) {
      if (cancelRequested.value) throw new Error('流程已停止')
      const step = flow.steps[index]
      stepStatuses.value[index] = 'running'
      const request = renderApiFlowRequest(step, variables)
      const result = await executeRequest(request, step.sampleResponse)
      if (cancelRequested.value) throw new Error('流程已停止')
      if (!result?.ok) throw new Error(result?.error || '请求执行失败')
      if ((result.status || 0) < 200 || (result.status || 0) >= 300) {
        throw new Error(`HTTP ${result.status || 0} ${result.statusText || ''}`.trim())
      }
      const response = parseApiFlowResponse(result.body)
      lastRunResponses.value = {
        ...lastRunResponses.value,
        [step.id]: typeof response === 'string' ? response : JSON.stringify(response, null, 2),
      }

      for (const extractor of step.extractors) {
        const resolution = resolveValueAtPath(response, extractor.path)
        const value = resolution.value
        if (!resolution.found && extractor.required !== false) {
          const suggestions = suggestValuePaths(response, extractor.path)
          const hint = suggestions.length ? `；实际响应中找到：${suggestions.join('、')}` : ''
          throw new Error(`响应变量 ${extractor.name} 未找到：${extractor.path}${hint}`)
        }
        variables[extractor.name] = value
        if (extractor.output) {
          const existing = runOutputs.value.find(item => item.name === extractor.name)
          if (existing) existing.value = value
          else runOutputs.value.push({ name: extractor.name, value })
        }
      }

      if (step.selection) {
        const items = getValueAtPath(response, step.selection.sourcePath)
        if (!Array.isArray(items) || !items.length) throw new Error(`选择列表为空：${step.selection.sourcePath}`)
        const selectedIndex = step.selection.mode === 'first' || items.length === 1 ? 0 : await waitForSelection(index, step.selection, items)
        if (selectedIndex == null) throw new Error('流程已停止')
        const value = selectionValue(items[selectedIndex], step.selection.valueField)
        if (value === undefined) throw new Error(`选中项中不存在字段 ${step.selection.valueField}`)
        variables[step.selection.variableName] = value
      }

      runtimeVariables.value = { ...variables }
      stepStatuses.value[index] = 'success'
    }
    runCompleted.value = true
    emit('notify', `流程执行完成，共 ${flow.steps.length} 个步骤`)
  } catch (error) {
    const currentIndex = stepStatuses.value.findIndex(status => status === 'running')
    failedStepId.value = currentIndex >= 0 ? flow.steps[currentIndex]?.id || '' : ''
    if (currentIndex >= 0) stepStatuses.value[currentIndex] = 'failed'
    stepStatuses.value = stepStatuses.value.map((status, index) => currentIndex >= 0 && index > currentIndex && status === 'idle' ? 'skipped' : status)
    runError.value = error instanceof Error ? error.message : '流程执行失败'
    emit('notify', runError.value, cancelRequested.value ? 'info' : 'error')
  } finally {
    running.value = false
    pendingSelection.value = null
    selectionResolver = null
  }
}

function showRunErrorDetails() {
  if (!activeRunFlow.value) return
  emit('editorOpen')
  editing.value = cloneFlow(activeRunFlow.value)
  void nextTick(() => document.querySelector('.api-flow-editor-body')?.scrollTo({ top: 0, behavior: 'smooth' }))
}

function stopRun() {
  cancelRequested.value = true
  selectionResolver?.(null)
  selectionResolver = null
  pendingSelection.value = null
}

async function copyOutput(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    emit('notify', '结果已复制')
  } catch {
    emit('notify', '复制失败，请重试', 'error')
  }
}

function openOutput(value: unknown) {
  if (typeof value === 'string' && /^https?:\/\//.test(value)) window.open(value, '_blank', 'noopener,noreferrer')
}

function displayOutputValue(value: unknown) {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  return JSON.stringify(value, null, 2)
}

async function consumeDraft(flow: ApiFlow) {
  const previousFlows = cloneFlow(flows.value)
  const draft = cloneFlow(flow)
  try {
    const index = flows.value.findIndex(item => item.id === draft.id)
    if (index >= 0) flows.value[index] = draft
    else flows.value.unshift(draft)
    await persistFlows()
    emit('editorOpen')
    editing.value = cloneFlow(draft)
    resetRunState()
    emit('draftConsumed')
  } catch (error) {
    flows.value = previousFlows
    emit('countChange', flows.value.length)
    emit('notify', error instanceof Error ? error.message : '流程创建失败', 'error')
  }
}

watch(() => props.draftFlow, flow => {
  if (flow && loaded.value) void consumeDraft(flow)
}, { deep: true })

onMounted(async () => {
  try {
    await loadFlows()
    loaded.value = true
    if (props.draftFlow) await consumeDraft(props.draftFlow)
  } catch (error) {
    flows.value = []
    loaded.value = true
    emit('countChange', 0)
    emit('notify', error instanceof Error ? `流程读取失败：${error.message}` : '流程读取失败', 'error')
  }
})
</script>

<template>
  <section class="page api-flow-page" :class="{ 'editor-open': !!editing }">
    <header class="page-toolbar api-flow-toolbar">
      <div><b>接口流程</b><span>把捕获的 XHR/FETCH 串成可重复执行的请求链</span></div>
      <button class="primary-button" type="button" @click="newFlow"><Plus :size="15" />新建流程</button>
    </header>

    <div class="api-flow-list">
        <article v-for="flow in flows" :key="flow.id" class="api-flow-card">
          <button class="api-flow-card-main" type="button" @click="editFlow(flow)">
            <span class="api-flow-card-icon"><GitBranch :size="19" /></span>
            <span class="api-flow-card-copy">
              <b>{{ flow.name }}</b>
              <small>{{ flow.steps.length }} 个步骤 · {{ flow.variables.length }} 个运行参数</small>
            </span>
            <ArrowRight :size="16" />
          </button>
          <div class="api-flow-card-steps">
            <span v-for="(step, index) in flow.steps.slice(0, 4)" :key="step.id"><i>{{ index + 1 }}</i><b :class="step.method.toLowerCase()">{{ step.method }}</b>{{ step.name }}</span>
            <span v-if="flow.steps.length > 4">还有 {{ flow.steps.length - 4 }} 步</span>
          </div>
          <div class="api-flow-card-footer">
            <span v-if="outputNames(flow).length"><Variable :size="13" />输出 {{ outputNames(flow).join('、') }}</span>
            <span v-else><Variable :size="13" />未设置最终输出</span>
            <div>
              <button type="button" title="运行流程" :disabled="running" @click="runFlow(flow)"><Play :size="14" />运行</button>
              <button type="button" @click="requestDeleteFlow(flow)"><Trash2 :size="13" />删除</button>
            </div>
          </div>
        </article>

        <div v-if="!flows.length" class="api-flow-empty">
          <GitBranch :size="30" />
          <b>还没有接口流程</b>
          <span>回到请求记录，选择几个 XHR/FETCH 接口开始编排。</span>
          <button type="button" @click="newFlow"><Plus :size="14" />新建空白流程</button>
        </div>
    </div>

    <Transition name="sheet">
      <div v-if="editing" class="sheet-backdrop api-flow-editor-backdrop" @click.self="closeEditor">
        <section class="api-flow-editor-sheet resizable-sheet" :class="{ dragging }" :style="{ height: `${height}px` }" role="dialog" aria-modal="true" :aria-label="isCreatingFlow ? '新建接口流程' : '编辑接口流程'">
          <button class="resize-handle" title="拖动调整流程面板高度" aria-label="拖动调整流程面板高度" @pointerdown="emit('resizeStart', $event)"><i /></button>
          <header class="api-flow-editor-toolbar">
            <div class="api-flow-editor-heading"><span class="api-flow-editor-heading-icon"><GitBranch :size="17" /></span><span><small>接口流程</small><b>{{ isCreatingFlow ? '新建流程' : '编辑流程' }}</b></span></div>
            <button type="button" class="api-flow-editor-close" aria-label="关闭流程面板" :disabled="running" @click="closeEditor"><X :size="17" /></button>
          </header>

          <div class="api-flow-editor-body" :class="{ 'with-run-panel': runPanelVisible }">
            <section class="api-flow-editor-section api-flow-basics-section">
              <header><div><GitBranch :size="16" /><span><b>基本信息</b><small>设置便于识别的流程名称</small></span></div></header>
              <label class="api-flow-field"><span>流程名称</span><input v-model="editing.name" aria-label="流程名称" placeholder="例如：套餐下单与支付" /></label>
            </section>
        <section class="api-flow-editor-section">
          <header><div><Variable :size="16" /><span><b>运行参数</b><small>Base API 与流程开始前可修改的变量</small></span></div><button type="button" @click="addVariable"><Plus :size="13" />添加参数</button></header>
          <div class="api-flow-variable-list">
            <div v-for="(variable, index) in editing.variables" :key="variable.id" class="api-flow-variable-row">
              <input v-model="variable.name" :readonly="variable.name === 'baseApi'" aria-label="变量名称" />
              <span>=</span>
              <input v-model="variable.value" :type="variable.secret ? 'password' : 'text'" aria-label="变量值" />
              <button type="button" :disabled="variable.name === 'baseApi'" aria-label="删除变量" @click="removeVariable(index)"><X :size="13" /></button>
            </div>
          </div>
        </section>

        <section class="api-flow-editor-section steps-section">
          <header><div><GitBranch :size="16" /><span><b>请求步骤</b><small>任一步骤失败都会立即停止</small></span></div><button type="button" @click="addStep"><Plus :size="13" />添加步骤</button></header>
          <div class="api-flow-step-list">
            <template v-for="(step, index) in editing.steps" :key="step.id">
            <article class="api-flow-step" :class="stepStatuses[index] || 'idle'">
              <header>
                <i>{{ String(index + 1).padStart(2, '0') }}</i>
                <SelectMenu v-model="step.method" :options="methodOptions" compact class="api-flow-method-select" />
                <input v-model="step.name" aria-label="步骤名称" />
                <div class="api-flow-step-actions">
                  <button type="button" :disabled="index === 0 || running" aria-label="上移步骤" @click="moveStep(index, -1)"><ChevronUp :size="13" /></button>
                  <button type="button" :disabled="index === editing.steps.length - 1 || running" aria-label="下移步骤" @click="moveStep(index, 1)"><ChevronDown :size="13" /></button>
                  <button type="button" :disabled="editing.steps.length === 1 || running" aria-label="删除步骤" @click="removeStep(index)"><Trash2 :size="13" /></button>
                </div>
              </header>

              <label class="api-flow-field"><span>请求地址</span><input v-model="step.url" spellcheck="false" /></label>

              <details class="api-flow-details">
                <summary><span>请求 Header</span><b>{{ Object.keys(step.headers).length }}</b><ChevronDown :size="14" /></summary>
                <div class="api-flow-header-list">
                  <div v-for="(value, name) in step.headers" :key="name">
                    <input :value="name" aria-label="Header 名称" @change="updateHeader(step, name, ($event.target as HTMLInputElement).value)" />
                    <input v-model="step.headers[name]" aria-label="Header 值" />
                    <button type="button" aria-label="删除 Header" @click="removeHeader(step, name)"><X :size="12" /></button>
                  </div>
                  <button type="button" class="api-flow-inline-add" @click="addHeader(step)"><Plus :size="12" />添加 Header</button>
                </div>
              </details>

              <details class="api-flow-details" :open="!!step.body">
                <summary><span>请求 Body</span><b>{{ step.body ? 'JSON' : '空' }}</b><ChevronDown :size="14" /></summary>
                <div class="api-flow-code-heading"><span>支持使用 <code v-pre>{{variable}}</code></span><div><button v-if="step.body" type="button" @click="copyOutput(step.body)"><Copy :size="12" />复制</button><button type="button" @click="formatBody(step)"><FileJson :size="12" />格式化</button></div></div>
                <div class="api-flow-code-editor" :style="{ height: `${bodyEditorHeight(step.id)}px` }">
                  <pre aria-hidden="true" v-html="highlightJson(step.body)" />
                  <textarea v-model="step.body" spellcheck="false" aria-label="请求 Body 编辑器" @keydown="handleBodyKeydown($event, step)" @scroll="syncCodeScroll" />
                </div>
                <div class="api-flow-code-resizer" role="group" aria-label="调整请求 Body 编辑器高度">
                  <button type="button" aria-label="缩小请求 Body 编辑器" title="缩小编辑器" @click="adjustBodyEditorHeight(step.id, -70)"><Minus :size="14" /></button>
                  <button type="button" class="api-flow-code-dragger" aria-label="拖动调整请求 Body 编辑器高度" title="向上或向下拖动调整高度" @mousedown="startBodyResize(step.id, $event)"><GripHorizontal :size="16" /><span>拖动调整编辑器高度</span></button>
                  <button type="button" aria-label="放大请求 Body 编辑器" title="放大编辑器" @click="adjustBodyEditorHeight(step.id, 70)"><Plus :size="14" /></button>
                </div>
              </details>

              <details v-if="step.sampleResponse" class="api-flow-details sample-response">
                <summary><span>录制时响应样本</span><b>{{ isJsonSample(step.sampleResponse) ? 'JSON 已格式化' : '原始文本' }}</b><ChevronDown :size="14" /></summary>
                <div class="api-flow-response-toolbar"><span>{{ isJsonSample(step.sampleResponse) ? '点击字段名即可保存为变量' : 'RESPONSE SAMPLE' }}</span><button type="button" @click="copyOutput(formattedResponseSample(step.sampleResponse))"><Copy :size="12" />复制</button></div>
                <pre :class="{ interactive: isJsonSample(step.sampleResponse) }" v-html="interactiveResponseSampleHtml(step)" @click="handleResponseSampleClick($event, step)" />
              </details>

              <details class="api-flow-details" :open="!!step.extractors.length || !!step.selection">
                <summary><span>从响应中取值</span><b>{{ step.extractors.length + (step.selection ? 1 : 0) }}</b><ChevronDown :size="14" /></summary>
                <div class="api-flow-extractor-list">
                  <div v-for="(extractor, extractorIndex) in step.extractors" :key="extractor.id" class="api-flow-extractor" :class="{ valid: extractorPreview(step, extractor).found }">
                    <div class="api-flow-extractor-heading">
                      <label><span>保存为变量</span><input v-model="extractor.name" aria-label="变量名称" placeholder="orderId" /></label>
                      <label class="api-flow-extractor-output" title="流程完成后展示这个变量"><input v-model="extractor.output" type="checkbox" />设为最终输出</label>
                      <button type="button" aria-label="删除响应变量" @click="removeExtractor(step, extractorIndex)"><Trash2 :size="13" /></button>
                    </div>
                    <div class="api-flow-extractor-path-wrap">
                      <label class="api-flow-extractor-path">
                        <span>响应路径</span>
                        <input
                          v-model="extractor.path"
                          aria-label="JSON Path"
                          :placeholder="step.sampleResponse ? '输入或从响应字段中选择' : '$.data.orderId'"
                          autocomplete="off"
                          @focus="openPathPicker(step, extractor)"
                          @input="openPathPicker(step, extractor)"
                          @blur="extractor.path = extractor.path.trim(); closePathPicker(step, extractor)"
                        />
                      </label>
                      <div v-if="activePathPicker === `${step.id}:${extractor.id}`" class="api-flow-path-menu">
                        <div class="api-flow-path-menu-title"><span>响应样本字段</span><small>{{ filteredResponsePaths(step, extractor.path).length }} 个匹配</small></div>
                        <button
                          v-for="entry in filteredResponsePaths(step, extractor.path)"
                          :key="entry.path"
                          type="button"
                          :class="{ active: entry.path === extractor.path }"
                          @mousedown.prevent
                          @click="chooseResponsePath(step, extractor, entry.path)"
                        >
                          <code>{{ entry.path }}</code>
                          <span>{{ responsePathValue(entry) }}</span>
                          <Check v-if="entry.path === extractor.path" :size="12" />
                        </button>
                        <div v-if="!filteredResponsePaths(step, extractor.path).length" class="api-flow-path-empty">样本中没有匹配字段，可以继续手动输入</div>
                      </div>
                    </div>
                    <div class="api-flow-extractor-preview" :class="{ found: extractorPreview(step, extractor).found }" :title="extractorPreview(step, extractor).resolvedPath">
                      <CheckCircle2 v-if="extractorPreview(step, extractor).found" :size="14" />
                      <CircleAlert v-else :size="14" />
                      <span><b>{{ extractorPreview(step, extractor).found ? '样本中已找到' : '路径需要检查' }}</b><code>{{ extractorPreview(step, extractor).label }}</code></span>
                      <button v-if="extractorPreview(step, extractor).found" type="button" title="复制样本值" aria-label="复制样本值" @click="copyOutput(extractorPreview(step, extractor).value)"><Copy :size="12" /></button>
                      <button v-else-if="extractorPreview(step, extractor).suggestedPath" type="button" title="使用建议路径" aria-label="使用建议路径" @click="extractor.path = extractorPreview(step, extractor).suggestedPath || extractor.path"><Check :size="12" /></button>
                    </div>
                  </div>
                  <div v-if="step.selection" class="api-flow-selection-config">
                    <div class="api-flow-selection-heading">
                      <span class="api-flow-selection-icon"><ListChecks :size="15" /></span>
                      <span><b>从返回列表中选一项</b><small>例如从套餐列表中选中一项，把它的 ID 交给下一步</small></span>
                      <button type="button" aria-label="删除返回列表取值" @click="step.selection = undefined"><X :size="13" /></button>
                    </div>
                    <div class="api-flow-selection-fields">
                      <label><span>返回列表的位置</span><input v-model="step.selection.sourcePath" aria-label="返回列表的位置" placeholder="$.data.list" /></label>
                      <label><span>使用选中项的字段</span><input v-model="step.selection.valueField" aria-label="使用选中项的字段" placeholder="id" /></label>
                      <label><span>保存为变量</span><input v-model="step.selection.variableName" aria-label="保存为变量" placeholder="planId" /></label>
                      <label><span>如何选择</span><SelectMenu v-model="step.selection.mode" :options="selectionModeOptions" compact /></label>
                    </div>
                  </div>
                  <button type="button" class="api-flow-inline-add" @click="addExtractor(step)"><Plus :size="12" />提取一个字段</button>
                </div>
              </details>
            </article>
            <div v-if="index < editing.steps.length - 1" class="api-flow-connector">
              <span class="api-flow-connector-line"><i /><ArrowDown :size="14" /></span>
              <span class="api-flow-connector-copy">
                <Link2 :size="13" />
                <template v-if="connectionVariables(step, editing.steps[index + 1]).length">
                  传递 {{ connectionVariables(step, editing.steps[index + 1]).join('、') }}
                </template>
                <template v-else>完成后继续下一步</template>
              </span>
            </div>
            </template>
          </div>
        </section>
          </div>
          <footer class="api-flow-editor-footer">
            <button type="button" class="secondary-button" :disabled="running" @click="closeEditor">取消</button>
            <button type="button" class="secondary-button api-flow-save" :disabled="saving || running" @click="saveAndClose"><Save :size="14" />保存</button>
            <button v-if="!running" type="button" class="primary-button api-flow-run" @click="runFlow()"><Play :size="14" fill="currentColor" />运行流程</button>
            <button v-else type="button" class="danger-button api-flow-stop" @click="stopRun"><CircleStop :size="14" />停止运行</button>
          </footer>
        </section>
      </div>
    </Transition>

    <section v-if="runPanelVisible" class="api-flow-run-panel api-flow-run-dock" :class="{ failed: runError, completed: runCompleted && !runError }">
      <div class="api-flow-run-title">
        <span>
          <LoaderCircle v-if="running" :size="16" class="spin" />
          <AlertTriangle v-else-if="runError" :size="16" />
          <CheckCircle2 v-else :size="16" />
          <b>{{ running ? `正在运行：${activeRunFlow?.name || '接口流程'}` : runError ? '流程运行失败' : '流程运行完成' }}</b>
        </span>
        <small v-if="running">{{ stepStatuses.filter(item => item === 'success').length }}/{{ activeRunFlow?.steps.length || 0 }} 步</small>
        <small v-else-if="runError && failedStepNumber">第 {{ failedStepNumber }} 步 · {{ failedStepName }}</small>
        <button v-if="running" type="button" class="api-flow-run-panel-action danger" @click="stopRun"><CircleStop :size="13" />停止</button>
        <button v-else type="button" class="api-flow-run-panel-close" aria-label="关闭运行结果" @click="resetRunState"><X :size="14" /></button>
      </div>
      <div v-if="running" class="api-flow-progress-steps">
        <span v-for="(step, index) in activeRunFlow?.steps || []" :key="step.id" :class="stepStatuses[index] || 'idle'" :title="`${index + 1}. ${step.name}`">
          <LoaderCircle v-if="stepStatuses[index] === 'running'" :size="12" class="spin" />
          <Check v-else-if="stepStatuses[index] === 'success'" :size="12" />
          <X v-else-if="stepStatuses[index] === 'failed'" :size="12" />
          <i v-else>{{ index + 1 }}</i>
        </span>
      </div>
      <div v-if="runError" class="api-flow-run-error">
        <span v-if="failedStepNumber">第 {{ failedStepNumber }} 步</span>
        <b>{{ runError }}</b>
        <button v-if="!editing" type="button" @click="showRunErrorDetails">查看错误详情</button>
      </div>
      <details v-if="editing && runError && failedStepId && lastRunResponses[failedStepId]" class="api-flow-run-response">
        <summary>失败步骤的实际响应<ChevronDown :size="13" /></summary>
        <div class="api-flow-response-toolbar"><span>ACTUAL RESPONSE</span><button type="button" @click="copyOutput(lastRunResponses[failedStepId])"><Copy :size="12" />复制</button></div>
        <pre v-html="highlightJson(formattedResponseSample(lastRunResponses[failedStepId]))" />
      </details>
      <div v-if="runOutputs.length" class="api-flow-outputs">
        <div v-for="output in runOutputs" :key="output.name">
          <span><b>{{ output.name }}</b><code>{{ displayOutputValue(output.value) }}</code></span>
          <button type="button" title="复制结果" @click="copyOutput(output.value)"><Copy :size="14" /></button>
          <button v-if="typeof output.value === 'string' && /^https?:\/\//.test(output.value)" type="button" title="打开链接" @click="openOutput(output.value)"><ExternalLink :size="14" /></button>
        </div>
      </div>
      <div v-else-if="runCompleted && !runError" class="api-flow-no-output">流程已完成，但尚未设置需要展示的最终输出。</div>
    </section>

    <div v-if="pendingSelection" class="api-flow-selection-backdrop">
      <section class="api-flow-selection-sheet" role="dialog" aria-modal="true" aria-label="选择要继续使用的数据">
        <header><div><Clipboard :size="17" /><span><b>选择要继续使用的数据</b><small>“{{ pendingSelectionStepName }}”返回了 {{ pendingSelection.items.length }} 条数据，请选择下一步要使用的一条</small></span></div><button type="button" aria-label="停止流程" @click="stopRun"><X :size="16" /></button></header>
        <div class="api-flow-selection-items">
          <button v-for="(item, index) in pendingSelection.items" :key="index" type="button" :class="{ active: selectedItemIndex === index }" @click="selectedItemIndex = index" @dblclick="chooseSelection(index)">
            <span><b>{{ selectionLabel(item, index, pendingSelection.selection.labelFields) }}</b><small>选择后：{{ pendingSelection.selection.variableName }} = {{ selectionValue(item, pendingSelection.selection.valueField) }}</small></span>
            <Check v-if="selectedItemIndex === index" :size="15" />
          </button>
        </div>
        <footer>
          <span>下一步将使用 <b>{{ pendingSelection.selection.variableName }} = {{ selectedPendingValue }}</b></span>
          <button type="button" class="secondary-button" @click="stopRun">停止流程</button>
          <button type="button" class="primary-button" @click="chooseSelection(selectedItemIndex)"><Check :size="14" />使用这条数据并继续</button>
        </footer>
      </section>
    </div>

    <div v-if="deleteTarget" class="api-flow-selection-backdrop api-flow-confirm-backdrop" @click.self="deleteTarget = null">
      <section class="api-flow-confirm-sheet" role="dialog" aria-modal="true" aria-label="确认删除接口流程">
        <header>
          <span class="api-flow-confirm-icon"><Trash2 :size="17" /></span>
          <span><b>删除“{{ deleteTarget.name }}”</b><small>该流程的请求步骤、变量配置和响应样本都会被删除，此操作无法撤销。</small></span>
          <button type="button" aria-label="取消删除" @click="deleteTarget = null"><X :size="15" /></button>
        </header>
        <footer><button type="button" class="secondary-button" @click="deleteTarget = null">取消</button><button type="button" class="danger-button" @click="confirmDeleteFlow"><Trash2 :size="14" />确认删除</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.api-flow-page { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
.api-flow-toolbar { flex: 0 0 60px; }
.api-flow-list, .api-flow-editor-body { min-height: 0; flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.api-flow-list { display: flex; flex-direction: column; gap: 8px; padding: 10px 10px 26px; }
.api-flow-card { border: 1px solid var(--border); border-radius: 11px; background: var(--panel); box-shadow: var(--shadow-soft); overflow: hidden; transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; }
.api-flow-card:hover { border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); box-shadow: 0 5px 16px rgba(22,34,53,.08); }
.api-flow-card-main { width: 100%; min-height: 58px; display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 0; color: var(--muted); background: transparent; text-align: left; cursor: pointer; }
.api-flow-card-main:hover { background: var(--panel-hover); }
.api-flow-card-icon { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border)); border-radius: 9px; color: var(--accent-dark); background: var(--accent-soft); }
.api-flow-card-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.api-flow-card-copy b { overflow: hidden; color: var(--text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-card-copy small { color: var(--muted); font-size: 12px; }
.api-flow-card-steps { display: flex; flex-direction: column; gap: 1px; padding: 7px 10px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--panel-soft); }
.api-flow-card-steps > span { position: relative; min-height: 27px; display: grid; grid-template-columns: 20px 42px minmax(0,1fr); align-items: center; gap: 5px; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-card-steps > span:not(:last-child)::after { content: ''; position: absolute; z-index: 0; top: 21px; left: 8px; width: 2px; height: 10px; border-radius: 2px; background: color-mix(in srgb,var(--accent) 24%,var(--border)); }
.api-flow-card-steps i { position: relative; z-index: 1; width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid color-mix(in srgb,var(--accent) 20%,var(--border)); border-radius: 50%; color: var(--accent-dark); background: var(--panel); font-size: 12px; font-style: normal; }
.api-flow-card-steps b { font: 700 12px 'DM Mono'; }
.api-flow-card-steps b.get { color: var(--green); }.api-flow-card-steps b.post { color: var(--accent-dark); }.api-flow-card-steps b.delete { color: var(--red); }.api-flow-card-steps b.put,.api-flow-card-steps b.patch { color: var(--amber); }
.api-flow-card-footer { min-height: 42px; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; }
.api-flow-card-footer > span { min-width: 0; flex: 1; display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-card-footer > div { display: flex; gap: 5px; }
.api-flow-card-footer button { height: 28px; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); font-size: 12px; cursor: pointer; }
.api-flow-card-footer button:hover { color: var(--accent-dark); border-color: color-mix(in srgb,var(--accent) 34%,var(--border)); background: var(--accent-soft); }
.api-flow-card-footer button.danger { color: var(--red); border-color: color-mix(in srgb,var(--red) 28%,var(--border)); background: color-mix(in srgb,var(--red) 6%,var(--panel)); }
.api-flow-empty { min-height: 270px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--faint); text-align: center; }
.api-flow-empty b { color: var(--text); font-size: 13px; }.api-flow-empty span { max-width: 280px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.api-flow-empty button { height: 32px; display: inline-flex; align-items: center; gap: 5px; margin-top: 4px; padding: 0 9px; border: 1px solid var(--accent); border-radius: 8px; color: #fff; background: var(--accent); font-size: 12px; cursor: pointer; }
.api-flow-editor-toolbar { min-height: 54px; flex: 0 0 54px; display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-bottom: 1px solid var(--border-strong); background: var(--panel); }
.api-flow-editor-toolbar > input { min-width: 0; height: 34px; flex: 1; padding: 0 9px; border: 1px solid transparent; border-radius: 7px; color: var(--text); background: transparent; font-size: 13px; font-weight: 680; }
.api-flow-editor-toolbar > input:hover,.api-flow-editor-toolbar > input:focus { border-color: var(--border); background: var(--panel-soft); outline: 0; }
.api-flow-back { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); background: var(--panel); cursor: pointer; }
.api-flow-save,.api-flow-run,.api-flow-stop { height: 32px; display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); background: var(--panel); font-size: 12px; font-weight: 650; cursor: pointer; }
.api-flow-run { color: #fff; border-color: var(--accent); background: var(--accent); }.api-flow-stop { color: #fff; border-color: var(--red); background: var(--red); }
.api-flow-editor-toolbar button:disabled { opacity: .45; cursor: not-allowed; }
.api-flow-editor-body { display: flex; flex-direction: column; gap: 8px; padding: 9px 9px 28px; }
.api-flow-run-panel,.api-flow-editor-section { flex: 0 0 auto; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); box-shadow: var(--shadow-soft); overflow: hidden; }
.api-flow-run-panel { padding: 9px; border-color: color-mix(in srgb,var(--accent) 28%,var(--border)); }
.api-flow-run-dock { z-index: 8; max-height: min(46%,420px); margin: 0 8px 8px; overflow-y: auto; box-shadow: 0 -8px 28px rgba(15,23,42,.1),0 2px 8px rgba(15,23,42,.06); animation: api-run-dock-enter .2s ease-out; }
.api-flow-run-panel.failed { border-color: color-mix(in srgb,var(--red) 34%,var(--border)); }.api-flow-run-panel.completed { border-color: color-mix(in srgb,var(--green) 34%,var(--border)); }
.api-flow-run-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.api-flow-run-title > span { min-width: 0; flex: 1; display: flex; align-items: center; gap: 6px; color: var(--accent-dark); }.failed .api-flow-run-title > span { color: var(--red); }.completed .api-flow-run-title > span { color: var(--green); }
.api-flow-run-title > span b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-run-title b { color: var(--text); font-size: 12px; }.api-flow-run-title small { color: var(--muted); font-size: 12px; }
.api-flow-run-panel-close { width: 26px; height: 26px; flex: 0 0 auto; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); cursor: pointer; }
.api-flow-run-panel-action { height: 27px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid color-mix(in srgb,var(--red) 28%,var(--border)); border-radius: 7px; color: var(--red); background: color-mix(in srgb,var(--red) 5%,var(--panel)); font-size: 11px; cursor: pointer; }
.api-flow-progress-steps { display: flex; align-items: center; gap: 5px; margin-top: 8px; }
.api-flow-progress-steps > span { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 7px; color: var(--faint); background: var(--panel-soft); }
.api-flow-progress-steps > span.running { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }.api-flow-progress-steps > span.success { color: var(--green); border-color: color-mix(in srgb,var(--green) 35%,var(--border)); background: color-mix(in srgb,var(--green) 7%,var(--panel)); }.api-flow-progress-steps > span.failed { color: var(--red); border-color: color-mix(in srgb,var(--red) 35%,var(--border)); background: color-mix(in srgb,var(--red) 7%,var(--panel)); }.api-flow-progress-steps > span.skipped { opacity: .4; }
.api-flow-progress-steps i { font-size: 12px; font-style: normal; }
.api-flow-run-error { display: flex; align-items: flex-start; gap: 7px; margin-top: 7px; padding: 6px 8px; border-radius: 7px; color: var(--red); background: color-mix(in srgb,var(--red) 6%,var(--panel)); }.api-flow-run-error b { min-width: 0; flex: 1; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }.api-flow-run-error > span { flex: 0 0 auto; padding: 1px 5px; border: 1px solid color-mix(in srgb,var(--red) 22%,transparent); border-radius: 5px; color: var(--red); background: color-mix(in srgb,var(--red) 7%,var(--panel)); font-size: 11px; font-weight: 700; white-space: nowrap; }.api-flow-run-error > button { height: 25px; flex: 0 0 auto; padding: 0 7px; border: 1px solid color-mix(in srgb,var(--red) 24%,var(--border)); border-radius: 6px; color: var(--red); background: var(--panel); font-size: 11px; cursor: pointer; }
.api-flow-run-response { margin-top: 7px; border: 1px solid color-mix(in srgb,var(--red) 18%,var(--border)); border-radius: 8px; overflow: hidden; background: var(--panel-soft); }
.api-flow-run-response summary { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 8px; color: var(--muted); font-size: 12px; font-weight: 650; cursor: pointer; list-style: none; }
.api-flow-run-response summary::-webkit-details-marker { display: none; }
.api-flow-run-response[open] summary { border-bottom: 1px solid var(--border); }
.api-flow-run-response[open] summary svg { transform: rotate(180deg); }
.api-flow-run-response summary svg { transition: transform .18s ease; }
.api-flow-run-response pre { max-height: 260px; margin: 0; padding: 9px; overflow: auto; color: #d7e0ee; background: #101827; font: 12px/1.65 'DM Mono',monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.api-flow-outputs { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.api-flow-outputs > div { min-height: 38px; display: flex; align-items: flex-start; gap: 5px; padding: 6px; border: 1px solid color-mix(in srgb,var(--green) 25%,var(--border)); border-radius: 8px; background: color-mix(in srgb,var(--green) 4%,var(--panel)); }
.api-flow-outputs > div > span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; padding: 1px 2px; }.api-flow-outputs b { color: var(--green); font-size: 12px; }.api-flow-outputs code { color: var(--text); font: 12px/1.55 'DM Mono'; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.api-flow-outputs button { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); cursor: pointer; }
.api-flow-no-output { margin-top: 7px; padding: 7px 8px; border-radius: 7px; color: var(--muted); background: var(--panel-soft); font-size: 11px; }
.api-flow-editor-section > header { min-height: 45px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 10px; border-bottom: 1px solid var(--border); background: var(--panel-soft); }
.api-flow-editor-section > header > div { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--accent-dark); }.api-flow-editor-section > header span { display: flex; flex-direction: column; gap: 2px; }.api-flow-editor-section > header b { color: var(--text); font-size: 12px; }.api-flow-editor-section > header small { color: var(--muted); font-size: 12px; }
.api-flow-editor-section > header > button,.api-flow-inline-add { height: 28px; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); font-size: 12px; cursor: pointer; }
.api-flow-variable-list { display: flex; flex-direction: column; }
.api-flow-variable-row { min-height: 42px; display: grid; grid-template-columns: minmax(84px,.72fr) 12px minmax(120px,1.4fr) 28px; align-items: center; gap: 5px; padding: 5px 7px; border-bottom: 1px solid var(--border); }
.api-flow-variable-row:last-child { border-bottom: 0; }.api-flow-variable-row > span { color: var(--faint); text-align: center; }
.api-flow-variable-row input,.api-flow-field input,.api-flow-header-list input,.api-flow-extractor input,.api-flow-selection-config input { min-width: 0; height: 31px; padding: 0 7px; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: var(--panel); font-size: 12px; outline: 0; }
.api-flow-variable-row input:focus,.api-flow-field input:focus,.api-flow-header-list input:focus,.api-flow-extractor input:focus,.api-flow-selection-config input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb,var(--accent) 9%,transparent); }
.api-flow-variable-row input:first-child { font-family: 'DM Mono'; }.api-flow-variable-row input[readonly] { color: var(--accent-dark); background: var(--accent-soft); }
.api-flow-variable-row > button,.api-flow-header-list div > button,.api-flow-extractor > button,.api-flow-selection-config > button { width: 27px; height: 27px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; color: var(--faint); background: transparent; cursor: pointer; }.api-flow-variable-row > button:hover,.api-flow-header-list div > button:hover,.api-flow-extractor > button:hover,.api-flow-selection-config > button:hover { color: var(--red); background: color-mix(in srgb,var(--red) 7%,var(--panel)); }
.api-flow-variable-row > button:disabled { opacity: .25; cursor: not-allowed; }
.steps-section { overflow: visible; }
.api-flow-step-list { display: flex; flex-direction: column; padding: 8px; background: var(--bg); }
.api-flow-step { border: 1px solid var(--border); border-radius: 9px; background: var(--panel); box-shadow: 0 1px 3px rgba(22,34,53,.04); overflow: hidden; transition: border-color .18s,box-shadow .18s; }
.api-flow-step.running { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb,var(--accent) 9%,transparent); }.api-flow-step.success { border-color: color-mix(in srgb,var(--green) 34%,var(--border)); }.api-flow-step.failed { border-color: color-mix(in srgb,var(--red) 42%,var(--border)); }
.api-flow-step > header { min-height: 44px; display: grid; grid-template-columns: 25px 72px minmax(80px,1fr) auto; align-items: center; gap: 5px; padding: 5px 6px; border-bottom: 1px solid var(--border); background: var(--panel-soft); }
.api-flow-step > header > i { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 7px; color: var(--accent-dark); background: var(--accent-soft); font: 700 12px 'DM Mono'; font-style: normal; }
.api-flow-step > header > input { min-width: 0; height: 31px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; color: var(--text); background: transparent; font-size: 12px; font-weight: 650; outline: 0; }.api-flow-step > header > input:hover,.api-flow-step > header > input:focus { border-color: var(--border); background: var(--panel); }
.api-flow-method-select { width: 72px; }
.api-flow-method-select :deep(.select-trigger) { width: 100%; height: 30px; padding: 0 6px; border-radius: 7px; font: 700 12px 'DM Mono'; }
.api-flow-connector { position: relative; height: 48px; flex: 0 0 48px; display: flex; align-items: center; padding-left: 37px; }
.api-flow-connector-line { position: absolute; inset: 0 auto 0 17px; width: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--accent); }
.api-flow-connector-line i { width: 2px; flex: 1; border-radius: 2px; background: linear-gradient(var(--accent),color-mix(in srgb,var(--accent) 38%,var(--border))); }
.api-flow-connector-line svg { flex: 0 0 auto; margin-top: -3px; filter: drop-shadow(0 1px 2px color-mix(in srgb,var(--accent) 25%,transparent)); }
.api-flow-connector-copy { min-width: 0; max-width: calc(100% - 10px); display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid color-mix(in srgb,var(--accent) 20%,var(--border)); border-radius: 999px; overflow: hidden; color: var(--accent-dark); background: color-mix(in srgb,var(--accent) 5%,var(--panel)); font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-step-actions { display: flex; gap: 2px; }.api-flow-step-actions button { width: 25px; height: 25px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; color: var(--faint); background: transparent; cursor: pointer; }.api-flow-step-actions button:hover { color: var(--text); background: var(--panel); }.api-flow-step-actions button:last-child:hover { color: var(--red); }.api-flow-step-actions button:disabled { opacity: .2; cursor: not-allowed; }
.api-flow-field { display: flex; flex-direction: column; gap: 4px; padding: 7px; }.api-flow-field > span { color: var(--muted); font-size: 12px; font-weight: 650; }.api-flow-field input { width: 100%; font-family: 'DM Mono'; }
.api-flow-details { border-top: 1px solid var(--border); }
.api-flow-details summary { min-height: 38px; display: flex; align-items: center; gap: 6px; padding: 5px 8px; color: var(--muted); background: var(--panel); list-style: none; cursor: pointer; }.api-flow-details summary::-webkit-details-marker { display: none; }.api-flow-details summary > span { flex: 1; font-size: 12px; font-weight: 650; }.api-flow-details summary > b { padding: 2px 5px; border-radius: 5px; color: var(--faint); background: var(--panel-soft); font-size: 12px; font-weight: 600; }.api-flow-details summary svg { transition: transform .18s; }.api-flow-details[open] summary svg { transform: rotate(180deg); }
.api-flow-details summary:focus { outline: 0; }.api-flow-details summary:focus-visible { box-shadow: inset 0 0 0 2px color-mix(in srgb,var(--accent) 42%,transparent); }
.api-flow-header-list,.api-flow-extractor-list { display: flex; flex-direction: column; gap: 5px; padding: 6px 7px 7px; border-top: 1px solid var(--border); background: var(--panel-soft); }
.api-flow-header-list > div { display: grid; grid-template-columns: minmax(90px,.8fr) minmax(120px,1.2fr) 27px; gap: 5px; }.api-flow-header-list input:first-child { font-family: 'DM Mono'; color: var(--accent-dark); }
.api-flow-inline-add { align-self: flex-start; }
.api-flow-code-heading { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 7px; padding: 4px 7px; border-top: 1px solid var(--border); background: var(--panel-soft); }.api-flow-code-heading > span { color: var(--muted); font-size: 12px; }.api-flow-code-heading code { color: var(--accent-dark); font: 12px 'DM Mono'; }.api-flow-code-heading > div { display: flex; gap: 5px; }.api-flow-code-heading button { height: 25px; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--panel); font-size: 12px; cursor: pointer; }.api-flow-code-heading button:hover { color: var(--accent-dark); border-color: color-mix(in srgb,var(--accent) 30%,var(--border)); background: var(--accent-soft); }
.api-flow-code-editor { position: relative; min-height: 150px; max-height: 620px; background: var(--code-bg); overflow: hidden; transition: box-shadow .16s ease; }.api-flow-code-editor:focus-within { box-shadow: inset 0 0 0 1px color-mix(in srgb,var(--accent) 55%,transparent); }.api-flow-code-editor pre,.api-flow-code-editor textarea { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 10px 11px; border: 0; overflow: auto; font: 12px/1.65 'DM Mono'; tab-size: 2; white-space: pre; }.api-flow-code-editor pre { color: #d7e0ee; pointer-events: none; }.api-flow-code-editor textarea { z-index: 2; resize: none; color: transparent; caret-color: #e2e8f0; background: transparent; outline: 0; -webkit-text-fill-color: transparent; }.api-flow-code-editor textarea::selection { background: rgba(96,165,250,.28); }
.api-flow-code-resizer { width: 100%; height: 28px; display: grid; grid-template-columns: 34px 1fr 34px; align-items: stretch; border-top: 1px solid #263449; color: #8493a8; background: #111b2b; }.api-flow-code-resizer > button { min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 0; border: 0; color: inherit; background: transparent; cursor: pointer; transition: color .15s ease,background .15s ease; }.api-flow-code-resizer > button:first-child { border-right: 1px solid #263449; }.api-flow-code-resizer > button:last-child { border-left: 1px solid #263449; }.api-flow-code-resizer > button:hover { color: #bfdbfe; background: #17243a; }.api-flow-code-dragger { font-size: 12px; cursor: ns-resize !important; touch-action: none; }.api-flow-code-dragger:active { color: #fff !important; background: #1c2c46 !important; }
.api-flow-code-editor :deep(.json-key),.sample-response :deep(.json-key),.api-flow-run-response :deep(.json-key) { color: #7dd3fc; }.api-flow-code-editor :deep(.json-string),.sample-response :deep(.json-string),.api-flow-run-response :deep(.json-string) { color: #86efac; }.api-flow-code-editor :deep(.json-number),.sample-response :deep(.json-number),.api-flow-run-response :deep(.json-number) { color: #fbbf24; }.api-flow-code-editor :deep(.json-boolean),.sample-response :deep(.json-boolean),.api-flow-run-response :deep(.json-boolean) { color: #c4b5fd; }.api-flow-code-editor :deep(.json-null),.sample-response :deep(.json-null),.api-flow-run-response :deep(.json-null) { color: #fda4af; }
.api-flow-extractor { border: 1px solid var(--border); border-radius: 9px; background: var(--panel); overflow: hidden; transition: border-color .18s ease,box-shadow .18s ease; }
.api-flow-extractor.valid { border-color: color-mix(in srgb,var(--green) 25%,var(--border)); }
.api-flow-extractor-heading { min-height: 48px; display: grid; grid-template-columns: minmax(110px,1fr) auto 28px; align-items: end; gap: 7px; padding: 7px 7px 8px; }
.api-flow-extractor-heading > label:first-child,.api-flow-extractor-path { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: var(--muted); font-size: 11px; font-weight: 650; }
.api-flow-extractor-heading > label:first-child input { width: 100%; font-family: 'DM Mono'; color: var(--accent-dark); }
.api-flow-extractor-output { height: 31px; display: flex; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel-soft); font-size: 11px; white-space: nowrap; cursor: pointer; }
.api-flow-extractor-output input { width: 13px; height: 13px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; accent-color: var(--accent); }
.api-flow-extractor-heading > button { width: 28px; height: 31px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 7px; color: var(--faint); background: transparent; cursor: pointer; }
.api-flow-extractor-heading > button:hover { color: var(--red); border-color: color-mix(in srgb,var(--red) 18%,var(--border)); background: color-mix(in srgb,var(--red) 6%,var(--panel)); }
.api-flow-extractor-path-wrap { position: relative; }
.api-flow-extractor-path { padding: 0 7px 8px; }
.api-flow-extractor-path input { width: 100%; font-family: 'DM Mono'; }
.api-flow-path-menu { max-height: 220px; display: flex; flex-direction: column; padding: 4px; border-top: 1px solid var(--border); overflow-y: auto; background: var(--panel-soft); box-shadow: inset 0 5px 12px -12px rgba(15,23,42,.5); }
.api-flow-path-menu-title { min-height: 27px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 5px 4px; color: var(--muted); font-size: 11px; font-weight: 650; }
.api-flow-path-menu-title small { color: var(--faint); font-size: 11px; font-weight: 500; }
.api-flow-path-menu > button { min-height: 37px; display: grid; grid-template-columns: minmax(0,1fr) minmax(72px,.55fr) 16px; align-items: center; gap: 7px; padding: 4px 6px; border: 1px solid transparent; border-radius: 6px; color: var(--muted); background: transparent; text-align: left; cursor: pointer; }
.api-flow-path-menu > button:hover,.api-flow-path-menu > button.active { border-color: color-mix(in srgb,var(--accent) 24%,var(--border)); background: var(--panel); }
.api-flow-path-menu > button code,.api-flow-path-menu > button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-path-menu > button code { color: var(--accent-dark); font: 11px 'DM Mono'; }
.api-flow-path-menu > button span { color: var(--muted); font-size: 11px; }
.api-flow-path-menu > button svg { color: var(--accent); }
.api-flow-path-empty { padding: 12px 7px; color: var(--faint); font-size: 11px; text-align: center; }
.api-flow-extractor-preview { min-height: 38px; display: grid; grid-template-columns: 17px minmax(0,1fr) 27px; align-items: center; gap: 6px; padding: 5px 7px; border-top: 1px solid var(--border); color: var(--amber); background: color-mix(in srgb,var(--amber) 4%,var(--panel-soft)); }
.api-flow-extractor-preview.found { color: var(--green); background: color-mix(in srgb,var(--green) 4%,var(--panel-soft)); }
.api-flow-extractor-preview > span { min-width: 0; display: flex; align-items: baseline; gap: 6px; overflow: hidden; }
.api-flow-extractor-preview b { flex: 0 0 auto; font-size: 11px; }
.api-flow-extractor-preview code { overflow: hidden; color: var(--text); font: 11px 'DM Mono'; text-overflow: ellipsis; white-space: nowrap; }
.api-flow-extractor-preview > button { width: 27px; height: 27px; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--panel); cursor: pointer; }
.api-flow-extractor-preview > button:hover { color: var(--accent-dark); border-color: color-mix(in srgb,var(--accent) 30%,var(--border)); background: var(--accent-soft); }
.api-flow-selection-config { border: 1px solid color-mix(in srgb,#7c3aed 20%,var(--border)); border-radius: 9px; background: color-mix(in srgb,#7c3aed 3%,var(--panel)); overflow: hidden; }
.api-flow-selection-heading { min-height: 48px; display: grid; grid-template-columns: 29px minmax(0,1fr) 28px; align-items: center; gap: 7px; padding: 7px 8px; border-bottom: 1px solid color-mix(in srgb,#7c3aed 15%,var(--border)); }
.api-flow-selection-icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; color: #7c3aed; background: color-mix(in srgb,#7c3aed 10%,var(--panel)); }
.api-flow-selection-heading > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 2px; }.api-flow-selection-heading b { color: var(--text); font-size: 12px; }.api-flow-selection-heading small { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.api-flow-selection-heading > button { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 7px; color: var(--faint); background: transparent; cursor: pointer; }.api-flow-selection-heading > button:hover { color: var(--red); background: color-mix(in srgb,var(--red) 7%,var(--panel)); }
.api-flow-selection-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 8px; }.api-flow-selection-fields > label { min-width: 0; display: flex; flex-direction: column; gap: 5px; }.api-flow-selection-fields > label > span { color: var(--muted); font-size: 12px; font-weight: 650; }.api-flow-selection-fields input { width: 100%; font-family: 'DM Mono'; }.api-flow-selection-fields :deep(.select-trigger) { width: 100%; height: 31px; padding: 0 7px; font-size: 12px; }
.api-flow-response-toolbar { min-height: 31px; display: flex; align-items: center; justify-content: space-between; gap: 7px; padding: 4px 7px; border-top: 1px solid var(--border); border-bottom: 1px solid #263449; color: #8493a8; background: #111b2b; font: 10px 'DM Mono'; letter-spacing: .45px; }
.api-flow-run-response .api-flow-response-toolbar { border-top: 0; }
.api-flow-response-toolbar button { height: 23px; display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border: 1px solid #314057; border-radius: 6px; color: #aab7ca; background: #17243a; font-size: 11px; cursor: pointer; }
.api-flow-response-toolbar button:hover { color: #dbeafe; border-color: #456188; background: #1c2c46; }
.sample-response > pre { max-height: 360px; margin: 0; padding: 11px 12px; overflow: auto; color: #d7e0ee; background: var(--code-bg); font: 12px/1.65 'DM Mono'; white-space: pre; tab-size: 2; }
.sample-response > pre.interactive :deep(.sample-json-key) { display: inline-block; margin: -1px -2px; padding: 1px 2px; border-radius: 4px; color: #7dd3fc; cursor: pointer; transition: color .14s ease,background .14s ease,box-shadow .14s ease; }
.sample-response > pre.interactive :deep(.sample-json-key:hover) { color: #e0f2fe; background: rgba(56,189,248,.16); box-shadow: 0 0 0 1px rgba(125,211,252,.26); }
.sample-response > pre.interactive :deep(.sample-json-key.extracted) { color: #86efac; background: rgba(74,222,128,.11); box-shadow: 0 0 0 1px rgba(134,239,172,.2); }
.api-flow-selection-backdrop { position: absolute; z-index: 34; inset: 0; display: flex; align-items: flex-end; padding: 10px; background: rgba(15,23,42,.38); backdrop-filter: blur(2px); }
.api-flow-selection-sheet { width: 100%; max-height: min(540px,calc(100% - 24px)); display: flex; flex-direction: column; border: 1px solid var(--border-strong); border-radius: 13px; background: var(--panel); box-shadow: 0 18px 48px rgba(15,23,42,.25); overflow: hidden; animation: api-selection-enter .22s ease-out; }
.api-flow-selection-sheet > header { min-height: 58px; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); }.api-flow-selection-sheet > header > svg { color: var(--accent); }.api-flow-selection-sheet > header > div { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; }.api-flow-selection-sheet > header span { min-width: 0; display: flex; flex-direction: column; gap: 3px; }.api-flow-selection-sheet > header b { color: var(--text); font-size: 13px; }.api-flow-selection-sheet > header small { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.api-flow-selection-sheet > header button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); cursor: pointer; }
.api-flow-selection-items { min-height: 0; display: flex; flex-direction: column; gap: 5px; padding: 7px; overflow-y: auto; background: var(--bg); }.api-flow-selection-items > button { min-height: 48px; display: grid; grid-template-columns: minmax(0,1fr) 20px; align-items: center; gap: 7px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); background: var(--panel); text-align: left; cursor: pointer; }.api-flow-selection-items > button:hover,.api-flow-selection-items > button.active { color: var(--accent-dark); border-color: color-mix(in srgb,var(--accent) 40%,var(--border)); background: var(--accent-soft); }.api-flow-selection-items > button > span { min-width: 0; display: flex; flex-direction: column; gap: 3px; }.api-flow-selection-items b,.api-flow-selection-items small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.api-flow-selection-items b { color: var(--text); font-size: 12px; }.api-flow-selection-items small { color: var(--muted); font-size: 12px; }
.api-flow-selection-sheet > footer { min-height: 57px; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; padding: 8px 10px; border-top: 1px solid var(--border); background: var(--panel); }
.api-flow-selection-sheet > footer > span { width: 100%; color: var(--muted); font-size: 11px; }.api-flow-selection-sheet > footer > span b { color: var(--accent-dark); font: 11px 'DM Mono'; }
.api-flow-confirm-backdrop { z-index: 40; }
.api-flow-confirm-sheet { width: 100%; border: 1px solid var(--border-strong); border-radius: 13px; background: var(--panel); box-shadow: 0 18px 48px rgba(15,23,42,.25); overflow: hidden; animation: api-selection-enter .2s ease-out; }
.api-flow-confirm-sheet > header { min-height: 72px; display: grid; grid-template-columns: 34px minmax(0,1fr) 30px; align-items: center; gap: 9px; padding: 10px; }.api-flow-confirm-sheet > header > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 4px; }.api-flow-confirm-sheet > header b { color: var(--text); font-size: 13px; }.api-flow-confirm-sheet > header small { color: var(--muted); font-size: 11px; line-height: 1.45; }.api-flow-confirm-sheet > header > button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); cursor: pointer; }
.api-flow-confirm-icon { width: 34px; height: 34px; display: grid !important; place-items: center; border-radius: 9px; color: var(--red); background: color-mix(in srgb,var(--red) 8%,var(--panel)); }
.api-flow-confirm-sheet > footer { min-height: 52px; display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding: 8px 10px; border-top: 1px solid var(--border); background: var(--panel-soft); }.api-flow-confirm-sheet > footer button { min-width: 78px; height: 32px; justify-content: center; font-size: 11px; }
.api-flow-editor-backdrop { z-index: 36; }
.api-flow-editor-sheet {
  min-height: min(400px, calc(100vh - 20px));
  max-height: calc(100vh - 20px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 4px 14px rgba(15,23,42,.12), 0 22px 54px rgba(15,23,42,.22);
  overflow: hidden;
}
.api-flow-editor-toolbar {
  min-height: 58px;
  flex: 0 0 58px;
  justify-content: space-between;
  padding: 0 12px;
}
.api-flow-editor-heading { min-width: 0; display: flex; align-items: center; gap: 9px; }
.api-flow-editor-heading-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border: 1px solid color-mix(in srgb,var(--accent) 22%,var(--border)); border-radius: 9px; color: var(--accent-dark); background: var(--accent-soft); }
.api-flow-editor-heading > span:last-child { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.api-flow-editor-heading small { color: var(--muted); font-size: 10px; }
.api-flow-editor-heading b { color: var(--text); font-size: 14px; }
.api-flow-editor-close { width: 31px; height: 31px; flex: 0 0 31px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.api-flow-editor-close:hover { color: var(--text); border-color: var(--border); background: var(--panel-soft); }
.api-flow-editor-close:disabled { opacity: .4; cursor: not-allowed; }
.api-flow-editor-body { min-height: 0; flex: 1 1 auto; padding: 10px; overflow-y: auto; overscroll-behavior: contain; background: var(--bg); }
.api-flow-editor-body.with-run-panel { padding-bottom: min(34vh, 290px); }
.api-flow-basics-section .api-flow-field { padding: 9px; }
.api-flow-basics-section .api-flow-field input { height: 36px; font-family: inherit; font-size: 13px; font-weight: 650; }
.api-flow-editor-footer { min-height: 58px; flex: 0 0 58px; display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding: 9px 10px; border-top: 1px solid var(--border); background: var(--panel); }
.api-flow-editor-footer button { min-width: 78px; height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; font-size: 12px; }
.api-flow-editor-footer .api-flow-run,.api-flow-editor-footer .api-flow-stop { min-width: 104px; }
.api-flow-page.editor-open > .api-flow-run-dock { position: fixed; z-index: 48; right: 18px; bottom: 78px; left: 18px; max-height: min(30vh,260px); margin: 0; }
.api-flow-selection-backdrop { position: fixed; z-index: 60; }
.api-flow-confirm-backdrop { z-index: 62; }
.spin { animation: api-flow-spin .8s linear infinite; }
@keyframes api-flow-spin { to { transform: rotate(360deg); } }
@keyframes api-selection-enter { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes api-run-dock-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 390px) {
  .api-flow-editor-footer { gap: 5px; }
  .api-flow-editor-footer button { min-width: 62px; padding: 0 7px; }
  .api-flow-editor-footer .api-flow-run,.api-flow-editor-footer .api-flow-stop { min-width: 92px; }
  .api-flow-step > header { grid-template-columns: 25px 68px minmax(68px,1fr) auto; }
  .api-flow-step-actions button:nth-child(-n+2) { display: none; }
  .api-flow-selection-fields { grid-template-columns: 1fr; }
}
</style>
