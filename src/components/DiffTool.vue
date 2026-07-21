<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, Copy, GitCompareArrows, LockKeyhole, Trash2, X } from 'lucide-vue-next'
import { diffLines } from 'diff'

type DiffMode = 'text' | 'json'
type DiffView = 'input' | 'result'
type DiffCell = { type: 'same' | 'added' | 'removed'; text: string; lineNumber: number }
type DiffRow = { left?: DiffCell; right?: DiffCell }

defineProps<{
  height: number
  dragging: boolean
}>()

const emit = defineEmits<{
  close: []
  resizeStart: [event: PointerEvent]
  notify: [message: string]
}>()

const mode = ref<DiffMode>('text')
const view = ref<DiffView>('input')
const ignoreWhitespace = ref(false)
const sortKeys = ref(true)
const textLeft = ref('GET /api/users\n状态: 200\n耗时: 128 ms')
const textRight = ref('GET /api/users\n状态: 200\n耗时: 214 ms')
const jsonLeft = ref(JSON.stringify({ status: 200, data: { name: '随页', enabled: true }, duration: 128 }, null, 2))
const jsonRight = ref(JSON.stringify({ status: 200, data: { name: '随页', enabled: false }, duration: 214 }, null, 2))
const resultRows = ref<DiffRow[]>([])
const error = ref('')
const compared = ref(false)
const leftHighlight = ref<HTMLElement | null>(null)
const rightHighlight = ref<HTMLElement | null>(null)

const leftContent = computed({
  get: () => mode.value === 'text' ? textLeft.value : jsonLeft.value,
  set: value => { if (mode.value === 'text') textLeft.value = value; else jsonLeft.value = value },
})
const rightContent = computed({
  get: () => mode.value === 'text' ? textRight.value : jsonRight.value,
  set: value => { if (mode.value === 'text') textRight.value = value; else jsonRight.value = value },
})
const stats = computed(() => ({
  added: resultRows.value.filter(row => row.right?.type === 'added').length,
  removed: resultRows.value.filter(row => row.left?.type === 'removed').length,
  unchanged: resultRows.value.filter(row => row.left?.type === 'same' && row.right?.type === 'same').length,
}))
const isIdentical = computed(() => compared.value && stats.value.added === 0 && stats.value.removed === 0)
const statusText = computed(() => {
  if (error.value) return error.value
  if (!compared.value) return '等待对比'
  if (isIdentical.value) return '两侧内容完全一致'
  return `新增 ${stats.value.added} 行 · 删除 ${stats.value.removed} 行`
})

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]))
  }
  return value
}

function prepareText(value: string) {
  if (!ignoreWhitespace.value) return value.replace(/\r\n/g, '\n')
  return value.replace(/\r\n/g, '\n').split('\n').map(line => line.trim().replace(/\s+/g, ' ')).join('\n')
}

function prepareJson(value: string, side: string) {
  try {
    const parsed = JSON.parse(value)
    return JSON.stringify(sortKeys.value ? sortJson(parsed) : parsed, null, 2)
  } catch {
    throw new Error(`${side} JSON 语法不正确，请检查括号、引号和逗号`)
  }
}

function splitChangeLines(value: string) {
  const values = value.split('\n')
  if (values[values.length - 1] === '') values.pop()
  return values
}

function buildRows(left: string, right: string) {
  const changes = diffLines(left, right)
  const rows: DiffRow[] = []
  let leftNumber = 1
  let rightNumber = 1
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]
    const next = changes[index + 1]
    if (change.removed && next?.added) {
      const removedLines = splitChangeLines(change.value)
      const addedLines = splitChangeLines(next.value)
      const count = Math.max(removedLines.length, addedLines.length)
      for (let lineIndex = 0; lineIndex < count; lineIndex += 1) {
        const removedText = removedLines[lineIndex]
        const addedText = addedLines[lineIndex]
        rows.push({
          ...(removedText !== undefined ? { left: { type: 'removed' as const, text: removedText, lineNumber: leftNumber++ } } : {}),
          ...(addedText !== undefined ? { right: { type: 'added' as const, text: addedText, lineNumber: rightNumber++ } } : {}),
        })
      }
      index += 1
      continue
    }

    splitChangeLines(change.value).forEach(text => {
      if (change.added) rows.push({ right: { type: 'added', text, lineNumber: rightNumber++ } })
      else if (change.removed) rows.push({ left: { type: 'removed', text, lineNumber: leftNumber++ } })
      else rows.push({ left: { type: 'same', text, lineNumber: leftNumber++ }, right: { type: 'same', text, lineNumber: rightNumber++ } })
    })
  }
  return rows
}

function compare() {
  error.value = ''
  if (!leftContent.value.trim() && !rightContent.value.trim()) {
    error.value = '请至少输入一侧内容'
    return
  }
  try {
    const left = mode.value === 'json' ? prepareJson(leftContent.value, '左侧') : prepareText(leftContent.value)
    const right = mode.value === 'json' ? prepareJson(rightContent.value, '右侧') : prepareText(rightContent.value)
    resultRows.value = buildRows(left, right)
    compared.value = true
    view.value = 'result'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '内容对比失败'
  }
}

function chooseMode(nextMode: DiffMode) {
  mode.value = nextMode
  view.value = 'input'
  compared.value = false
  resultRows.value = []
  error.value = ''
}

function swapSides() {
  const left = leftContent.value
  leftContent.value = rightContent.value
  rightContent.value = left
}

function clearInputs() {
  leftContent.value = ''
  rightContent.value = ''
  compared.value = false
  resultRows.value = []
  error.value = ''
  view.value = 'input'
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlightLine(value: string) {
  if (mode.value !== 'json') return escapeHtml(value)
  return escapeHtml(value).replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:e[+\-]?\d+)?\b/gi, (match, quoted, colon) => {
    if (quoted) return `<span class="${colon ? 'json-key' : 'json-string'}">${quoted}</span>${colon || ''}`
    if (/true|false/i.test(match)) return `<span class="json-boolean">${match}</span>`
    if (/null/i.test(match)) return `<span class="json-null">${match}</span>`
    return `<span class="json-number">${match}</span>`
  })
}

async function copyResult() {
  if (!compared.value) return
  const value = resultRows.value.flatMap(row => {
    if (row.left?.type === 'same' && row.right?.type === 'same') return [`  ${row.left.text}`]
    return [row.left ? `- ${row.left.text}` : null, row.right ? `+ ${row.right.text}` : null].filter((line): line is string => !!line)
  }).join('\n')
  await navigator.clipboard.writeText(value)
  emit('notify', '差异结果已复制')
}

function syncInputScroll(side: 'left' | 'right', event: Event) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  const highlight = side === 'left' ? leftHighlight.value : rightHighlight.value
  if (!highlight) return
  highlight.scrollTop = textarea.scrollTop
  highlight.scrollLeft = textarea.scrollLeft
}
</script>

<template>
  <section class="diff-sheet utility-sheet resizable-sheet" :class="{ dragging }" :style="{ height: `${height}px` }" role="dialog" aria-modal="true" aria-label="内容对比工具">
    <button class="resize-handle" title="拖动调整工具高度" aria-label="拖动调整内容对比工具高度" @pointerdown="emit('resizeStart', $event)"><i /></button>
    <header class="utility-sheet-header">
      <div><small>本地开发工具</small><h2>内容对比</h2></div>
      <span class="utility-local-state"><LockKeyhole :size="13" />仅在本机处理</span>
      <button class="utility-close" type="button" aria-label="关闭内容对比工具" @click="emit('close')"><X :size="18" /></button>
    </header>

    <nav class="diff-view-tabs" aria-label="内容对比视图">
      <button type="button" :class="{ active: view === 'input' }" @click="view = 'input'">输入内容</button>
      <button type="button" :disabled="!compared" :class="{ active: view === 'result' }" @click="view = 'result'">对比结果<span v-if="compared">{{ stats.added + stats.removed }}</span></button>
    </nav>

    <div v-if="view === 'input'" class="diff-input-body utility-scroll-body">
      <div class="diff-mode-toolbar">
        <div class="diff-mode-switch"><button type="button" :class="{ active: mode === 'text' }" @click="chooseMode('text')">文本</button><button type="button" :class="{ active: mode === 'json' }" @click="chooseMode('json')">JSON</button></div>
        <button v-if="mode === 'text'" type="button" class="diff-option-toggle" :class="{ active: ignoreWhitespace }" @click="ignoreWhitespace = !ignoreWhitespace"><i />忽略空白</button>
        <button v-else type="button" class="diff-option-toggle" :class="{ active: sortKeys }" @click="sortKeys = !sortKeys"><i />忽略键顺序</button>
      </div>
      <div class="diff-editor-grid">
        <section class="diff-editor-card"><header><b>内容 A</b><span>{{ leftContent.length }} 字符</span></header><div class="diff-input-code" :class="{ highlighted: mode === 'json' }"><pre v-if="mode === 'json'" ref="leftHighlight" aria-hidden="true" v-html="highlightLine(leftContent)" /><textarea v-model="leftContent" spellcheck="false" :placeholder="mode === 'json' ? '粘贴左侧 JSON' : '粘贴左侧文本'" @scroll="syncInputScroll('left', $event)" /></div></section>
        <section class="diff-editor-card"><header><b>内容 B</b><span>{{ rightContent.length }} 字符</span></header><div class="diff-input-code" :class="{ highlighted: mode === 'json' }"><pre v-if="mode === 'json'" ref="rightHighlight" aria-hidden="true" v-html="highlightLine(rightContent)" /><textarea v-model="rightContent" spellcheck="false" :placeholder="mode === 'json' ? '粘贴右侧 JSON' : '粘贴右侧文本'" @scroll="syncInputScroll('right', $event)" /></div></section>
      </div>
      <div v-if="error" class="diff-error"><AlertTriangle :size="14" />{{ error }}</div>
    </div>

    <div v-else class="diff-result-body">
      <div class="diff-summary" :class="{ identical: isIdentical }">
        <span v-if="isIdentical"><Check :size="16" />内容完全一致</span>
        <template v-else><span class="added"><i />新增 {{ stats.added }} 行</span><span class="removed"><i />删除 {{ stats.removed }} 行</span><span><i />未变化 {{ stats.unchanged }} 行</span></template>
      </div>
      <div class="diff-split-view" :class="{ json: mode === 'json' }">
        <header><div><b>内容 A</b><span>删除 {{ stats.removed }} 行</span></div><div><b>内容 B</b><span>新增 {{ stats.added }} 行</span></div></header>
        <div class="diff-split-scroll">
          <div v-for="(row, index) in resultRows" :key="index" class="diff-split-row">
            <div class="diff-split-cell" :class="row.left?.type || 'empty'"><span>{{ row.left?.lineNumber || '' }}</span><b>{{ row.left?.type === 'removed' ? '−' : '' }}</b><code v-if="row.left" v-html="highlightLine(row.left.text)" /></div>
            <div class="diff-split-cell" :class="row.right?.type || 'empty'"><span>{{ row.right?.lineNumber || '' }}</span><b>{{ row.right?.type === 'added' ? '+' : '' }}</b><code v-if="row.right" v-html="highlightLine(row.right.text)" /></div>
          </div>
        </div>
      </div>
    </div>

    <div class="utility-primary-bar">
      <button v-if="view === 'input'" type="button" @click="compare"><GitCompareArrows :size="15" />开始对比</button>
      <button v-else type="button" @click="view = 'input'"><ArrowLeft :size="15" />返回编辑</button>
    </div>
    <footer class="utility-footer">
      <div class="utility-result-state" :class="{ ready: compared && !error, error: !!error }"><Check v-if="compared && !error" :size="14" /><AlertTriangle v-else-if="error" :size="14" /><i v-else />{{ statusText }}</div>
      <div class="utility-footer-actions">
        <template v-if="view === 'input'"><button type="button" title="交换左右内容" @click="swapSides"><ArrowLeftRight :size="13" />交换</button><button type="button" title="清空输入" @click="clearInputs"><Trash2 :size="13" />清空</button></template>
        <button v-else type="button" @click="copyResult"><Copy :size="13" />复制结果</button>
      </div>
    </footer>
  </section>
</template>
