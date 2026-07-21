<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, Clipboard, Copy, LockKeyhole, RotateCcw, X } from 'lucide-vue-next'

type ConverterCategory = 'json' | 'url' | 'base64' | 'jwt' | 'time' | 'generate'

const props = defineProps<{
  height: number
  dragging: boolean
}>()

const emit = defineEmits<{
  close: []
  resizeStart: [event: PointerEvent]
  notify: [message: string]
}>()

const categories: Array<{ value: ConverterCategory; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'url', label: 'URL' },
  { value: 'base64', label: 'Base64' },
  { value: 'jwt', label: 'JWT' },
  { value: 'time', label: '时间' },
  { value: 'generate', label: '生成' },
]

const categoryActions: Record<ConverterCategory, Array<{ value: string; label: string }>> = {
  json: [
    { value: 'format', label: '格式化' },
    { value: 'minify', label: '压缩' },
    { value: 'validate', label: '校验' },
    { value: 'sort', label: '排序' },
  ],
  url: [
    { value: 'encode', label: '编码' },
    { value: 'decode', label: '解码' },
    { value: 'params', label: '参数转 JSON' },
  ],
  base64: [
    { value: 'encode', label: '编码' },
    { value: 'decode', label: '解码' },
  ],
  jwt: [{ value: 'parse', label: '解析 Token' }],
  time: [
    { value: 'timestamp-to-date', label: '时间戳转日期' },
    { value: 'date-to-timestamp', label: '日期转时间戳' },
  ],
  generate: [
    { value: 'uuid', label: 'UUID' },
    { value: 'random', label: '随机字符串' },
  ],
}

const examples: Record<ConverterCategory, string> = {
  json: '{"name":"随页","version":1,"features":["network","toolkit"]}',
  url: 'https://example.com/search?q=随页&from=browser',
  base64: '随页 · 浏览器效率工具箱',
  jwt: '',
  time: String(Date.now()),
  generate: '',
}

const activeCategory = ref<ConverterCategory>('json')
const activeAction = ref('format')
const input = ref(examples.json)
const output = ref('')
const error = ref('')
const resultState = ref<'idle' | 'valid' | 'error'>('idle')
const randomLength = ref(24)
const inputRef = ref<HTMLTextAreaElement | null>(null)

const actions = computed(() => categoryActions[activeCategory.value])
const inputDisabled = computed(() => activeCategory.value === 'generate')
const inputLabel = computed(() => {
  if (activeCategory.value === 'jwt') return 'JWT TOKEN'
  if (activeCategory.value === 'time') return activeAction.value === 'timestamp-to-date' ? '时间戳' : '日期时间'
  if (activeCategory.value === 'generate') return '生成选项'
  if (activeCategory.value === 'url' && activeAction.value === 'params') return 'URL / QUERY'
  return '输入'
})
const outputLabel = computed(() => activeCategory.value === 'jwt' ? '解析结果' : activeCategory.value === 'url' && activeAction.value === 'params' ? 'JSON 参数' : '输出')
const inputPlaceholder = computed(() => {
  if (activeCategory.value === 'json') return '粘贴 JSON 内容'
  if (activeCategory.value === 'url') {
    if (activeAction.value === 'params') return '粘贴完整 URL、?a=1&b=2 或纯查询参数'
    return activeAction.value === 'encode' ? '输入需要编码的 URL 或文本' : '输入需要解码的 URL 编码文本'
  }
  if (activeCategory.value === 'base64') return activeAction.value === 'encode' ? '输入需要编码的文本' : '输入 Base64 内容'
  if (activeCategory.value === 'jwt') return '粘贴 JWT，仅在本地解析，不校验签名'
  if (activeCategory.value === 'time') return activeAction.value === 'timestamp-to-date' ? '例如：1721448000000' : '例如：2026-07-20 15:30:00'
  return ''
})
const primaryLabel = computed(() => {
  const labels: Record<string, string> = {
    format: '格式化 JSON', minify: '压缩 JSON', validate: '校验 JSON', sort: '排序 JSON',
    encode: activeCategory.value === 'url' ? '编码 URL' : 'Base64 编码',
    decode: activeCategory.value === 'url' ? '解码 URL' : 'Base64 解码', params: '提取 URL 参数',
    parse: '解析 JWT',
    'timestamp-to-date': '转换为日期', 'date-to-timestamp': '转换为时间戳',
    uuid: '生成 UUID', random: '生成随机字符串',
  }
  return labels[activeAction.value] || '开始转换'
})
const outputIsJson = computed(() => activeCategory.value === 'json' || activeCategory.value === 'jwt' || (activeCategory.value === 'url' && activeAction.value === 'params') || (activeCategory.value === 'time' && !!output.value))
const statusText = computed(() => {
  if (resultState.value === 'error') return error.value || '处理失败'
  if (resultState.value === 'valid') {
    if (activeCategory.value === 'json' && activeAction.value === 'validate') return 'JSON 语法有效'
    if (activeCategory.value === 'jwt') return 'JWT 已解析，签名未校验'
    return '处理完成'
  }
  return '等待处理'
})

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlightJson(value: string) {
  const escaped = escapeHtml(value)
  return escaped.replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+\-]?\d+)?\b/gi, (match, quoted, colon) => {
    if (quoted) return `<span class="${colon ? 'json-key' : 'json-string'}">${quoted}</span>${colon || ''}`
    if (/true|false/i.test(match)) return `<span class="json-boolean">${match}</span>`
    if (/null/i.test(match)) return `<span class="json-null">${match}</span>`
    return `<span class="json-number">${match}</span>`
  })
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]))
  }
  return value
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

function decodeBase64(value: string) {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function parseJwt(value: string) {
  const parts = value.trim().split('.')
  if (parts.length !== 3) throw new Error('JWT 应包含 Header、Payload 和 Signature 三部分')
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(decodeBase64(parts[0]))
    payload = JSON.parse(decodeBase64(parts[1]))
  } catch {
    throw new Error('JWT 的 Header 或 Payload 不是有效的 Base64URL JSON')
  }
  return { header, payload, signature: parts[2], signatureVerified: false }
}

function extractUrlParams(value: string) {
  const trimmed = value.trim()
  let query = trimmed
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) query = new URL(trimmed).search.slice(1)
    else {
      const questionMark = trimmed.indexOf('?')
      if (questionMark >= 0) query = trimmed.slice(questionMark + 1)
      query = query.replace(/^\?/, '').split('#')[0]
    }
  } catch {
    throw new Error('URL 格式不正确，无法提取查询参数')
  }

  const params = new URLSearchParams(query)
  const result: Record<string, string | string[]> = {}
  params.forEach((itemValue, key) => {
    const existing = result[key]
    if (existing === undefined) result[key] = itemValue
    else if (Array.isArray(existing)) existing.push(itemValue)
    else result[key] = [existing, itemValue]
  })
  if (!Object.keys(result).length) throw new Error('没有找到可提取的 URL 查询参数')
  return result
}

function secureRandom(length: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

function parseTimestamp(value: string) {
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error('请输入有效的秒级或毫秒级时间戳')
  const raw = Number(trimmed)
  const milliseconds = Math.abs(raw) < 1e11 ? raw * 1000 : raw
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) throw new Error('时间戳超出可转换范围')
  return {
    local: date.toLocaleString('zh-CN', { hour12: false }),
    iso: date.toISOString(),
    timestampSeconds: Math.floor(date.getTime() / 1000),
    timestampMilliseconds: date.getTime(),
  }
}

function parseDate(value: string) {
  const date = new Date(value.trim().replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) throw new Error('请输入有效日期，例如 2026-07-20 15:30:00')
  return {
    local: date.toLocaleString('zh-CN', { hour12: false }),
    iso: date.toISOString(),
    timestampSeconds: Math.floor(date.getTime() / 1000),
    timestampMilliseconds: date.getTime(),
  }
}

function runTransform() {
  error.value = ''
  try {
    const value = input.value
    if (!inputDisabled.value && !value.trim()) throw new Error('请先输入需要处理的内容')

    if (activeCategory.value === 'json') {
      const parsed = JSON.parse(value)
      if (activeAction.value === 'format') output.value = JSON.stringify(parsed, null, 2)
      if (activeAction.value === 'minify') output.value = JSON.stringify(parsed)
      if (activeAction.value === 'validate') output.value = JSON.stringify(parsed, null, 2)
      if (activeAction.value === 'sort') output.value = JSON.stringify(sortJson(parsed), null, 2)
    } else if (activeCategory.value === 'url') {
      if (activeAction.value === 'params') output.value = JSON.stringify(extractUrlParams(value), null, 2)
      else output.value = activeAction.value === 'encode' ? encodeURIComponent(value) : decodeURIComponent(value)
    } else if (activeCategory.value === 'base64') {
      output.value = activeAction.value === 'encode' ? encodeBase64(value) : decodeBase64(value)
    } else if (activeCategory.value === 'jwt') {
      output.value = JSON.stringify(parseJwt(value), null, 2)
    } else if (activeCategory.value === 'time') {
      const result = activeAction.value === 'timestamp-to-date' ? parseTimestamp(value) : parseDate(value)
      output.value = JSON.stringify(result, null, 2)
    } else {
      output.value = activeAction.value === 'uuid' ? crypto.randomUUID() : secureRandom(randomLength.value)
    }
    resultState.value = 'valid'
  } catch (reason) {
    output.value = ''
    const fallback = reason instanceof Error ? reason.message : '无法处理当前内容'
    if (activeCategory.value === 'json' && reason instanceof SyntaxError) error.value = 'JSON 语法不正确，请检查括号、引号和逗号'
    else if (activeCategory.value === 'url' && activeAction.value !== 'params') error.value = `URL ${activeAction.value === 'encode' ? '编码' : '解码'}失败，请检查输入内容`
    else if (activeCategory.value === 'base64') error.value = `Base64 ${activeAction.value === 'encode' ? '编码' : '解码'}失败，请检查输入内容`
    else error.value = fallback
    resultState.value = 'error'
  }
}

function chooseCategory(category: ConverterCategory) {
  activeCategory.value = category
  activeAction.value = categoryActions[category][0].value
  input.value = examples[category]
  output.value = ''
  error.value = ''
  resultState.value = 'idle'
  if (category === 'json' || category === 'time' || category === 'generate') runTransform()
  void nextTick(() => inputRef.value?.focus())
}

function chooseAction(action: string) {
  activeAction.value = action
  output.value = ''
  error.value = ''
  resultState.value = 'idle'
  if (activeCategory.value === 'generate') runTransform()
}

function clearAll() {
  input.value = ''
  output.value = ''
  error.value = ''
  resultState.value = 'idle'
  inputRef.value?.focus()
}

async function copyValue(value: string, label: string) {
  if (!value) return emit('notify', `${label}为空`)
  await navigator.clipboard.writeText(value)
  emit('notify', `${label}已复制`)
}

watch(randomLength, () => activeCategory.value === 'generate' && activeAction.value === 'random' && runTransform())
onMounted(runTransform)
</script>

<template>
  <section class="converter-sheet resizable-sheet" :class="{ dragging }" :style="{ height: `${height}px` }" role="dialog" aria-modal="true" aria-label="开发转换工具">
    <button class="resize-handle" title="拖动调整工具高度" aria-label="拖动调整开发转换工具高度" @pointerdown="emit('resizeStart', $event)"><i /></button>
    <header class="converter-header">
      <div>
        <small>本地开发工具</small>
        <h2>开发转换</h2>
      </div>
      <span class="local-only"><LockKeyhole :size="13" />仅在本机处理</span>
      <button class="converter-close" type="button" aria-label="关闭开发转换工具" @click="emit('close')"><X :size="18" /></button>
    </header>

    <nav class="converter-categories" aria-label="转换类型">
      <button v-for="category in categories" :key="category.value" type="button" :class="{ active: activeCategory === category.value }" @click="chooseCategory(category.value)">{{ category.label }}</button>
    </nav>

    <div class="converter-body">
      <div class="converter-action-bar" aria-label="操作类型">
        <button v-for="action in actions" :key="action.value" type="button" :class="{ active: activeAction === action.value }" @click="chooseAction(action.value)">{{ action.label }}</button>
      </div>

      <div v-if="activeCategory === 'generate' && activeAction === 'random'" class="random-length-row">
        <span>字符长度</span>
        <button v-for="length in [16, 24, 32, 64]" :key="length" type="button" :class="{ active: randomLength === length }" @click="randomLength = length">{{ length }}</button>
      </div>

      <div class="converter-editor-grid" :class="{ 'single-output': inputDisabled }">
        <section v-if="!inputDisabled" class="converter-code-card">
          <header><span>{{ inputLabel }}</span><button v-if="!inputDisabled" type="button" @click="copyValue(input, '输入内容')"><Copy :size="13" />复制</button></header>
          <textarea ref="inputRef" v-model="input" spellcheck="false" :placeholder="inputPlaceholder" @keydown.ctrl.enter.prevent="runTransform" @keydown.meta.enter.prevent="runTransform" />
        </section>

        <section class="converter-code-card output-card" :class="{ invalid: resultState === 'error' }">
          <header><span>{{ outputLabel }}</span><button type="button" :disabled="!output" @click="copyValue(output, '输出内容')"><Copy :size="13" />复制</button></header>
          <pre v-if="output" :class="{ highlighted: outputIsJson }" v-html="outputIsJson ? highlightJson(output) : escapeHtml(output)" />
          <div v-else class="converter-output-empty"><AlertTriangle v-if="resultState === 'error'" :size="22" /><Clipboard v-else :size="22" /><span>{{ resultState === 'error' ? error : '转换结果会显示在这里' }}</span></div>
        </section>
      </div>

    </div>

    <div class="converter-primary-bar"><button class="converter-primary" type="button" @click="runTransform">{{ primaryLabel }}</button></div>

    <footer class="converter-footer">
      <div class="converter-result-state" :class="resultState"><Check v-if="resultState === 'valid'" :size="14" /><AlertTriangle v-else-if="resultState === 'error'" :size="14" /><i v-else />{{ statusText }}</div>
      <button type="button" @click="clearAll"><RotateCcw :size="13" />清空</button>
    </footer>
  </section>
</template>
