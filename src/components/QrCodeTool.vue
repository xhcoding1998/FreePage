<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, ChevronDown, Copy, Download, FileCode2, LoaderCircle, LockKeyhole, QrCode, SlidersHorizontal, X } from 'lucide-vue-next'
import QRCode from 'qrcode'

type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

const props = defineProps<{
  height: number
  dragging: boolean
}>()

const emit = defineEmits<{
  close: []
  resizeStart: [event: PointerEvent]
  notify: [message: string, tone?: 'success' | 'error' | 'info']
}>()

const sizeOptions = [256, 512, 1024]
const levelOptions: Array<{ value: ErrorCorrectionLevel; label: string; description: string }> = [
  { value: 'L', label: 'L', description: '7%' },
  { value: 'M', label: 'M', description: '15%' },
  { value: 'Q', label: 'Q', description: '25%' },
  { value: 'H', label: 'H', description: '30%' },
]
const marginOptions = [1, 2, 4]
const palettes = [
  { id: 'ink', label: '经典', dark: '#0f172a', light: '#ffffff' },
  { id: 'blue', label: '蓝色', dark: '#1d4ed8', light: '#eff6ff' },
  { id: 'forest', label: '森林', dark: '#166534', light: '#f0fdf4' },
  { id: 'violet', label: '紫色', dark: '#6d28d9', light: '#faf5ff' },
]

const content = ref('')
const size = ref(512)
const level = ref<ErrorCorrectionLevel>('M')
const margin = ref(2)
const paletteId = ref('ink')
const qrDataUrl = ref('')
const qrSvg = ref('')
const status = ref<'idle' | 'generating' | 'ready' | 'error'>('idle')
const error = ref('')
const dirty = ref(false)
const initialized = ref(false)
const showSettings = ref(false)
const copyState = ref<'idle' | 'copying' | 'success' | 'error'>('idle')
let copyFeedbackTimer: number | undefined

const palette = computed(() => palettes.find(item => item.id === paletteId.value) || palettes[0])
const statusText = computed(() => {
  if (status.value === 'generating') return '正在生成二维码'
  if (status.value === 'error') return error.value || '生成失败'
  if (dirty.value) return '内容或设置已修改，请重新生成'
  if (status.value === 'ready') return `${size.value} × ${size.value} · 容错 ${level.value}`
  return '等待生成'
})
const canExport = computed(() => status.value === 'ready' && !dirty.value && !!qrDataUrl.value)
const settingsSummary = computed(() => `${size.value}px · ${level.value} 级 · 边距 ${margin.value} · ${palette.value.label}`)

async function getCurrentTabUrl() {
  if (location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && chrome.tabs?.query) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.url) return tab.url
    } catch {
      // Fall back to a useful example when the active browser page is unavailable.
    }
  }
  return 'https://example.com'
}

async function generateQr() {
  const value = content.value.trim()
  if (!value) {
    status.value = 'error'
    error.value = '请输入需要生成二维码的文字或 URL'
    return
  }
  status.value = 'generating'
  error.value = ''
  try {
    const options = {
      width: size.value,
      margin: margin.value,
      errorCorrectionLevel: level.value,
      color: { dark: palette.value.dark, light: palette.value.light },
    }
    const [dataUrl, svg] = await Promise.all([
      QRCode.toDataURL(value, { ...options, type: 'image/png' }),
      QRCode.toString(value, { ...options, type: 'svg' }),
    ])
    qrDataUrl.value = dataUrl
    qrSvg.value = svg
    dirty.value = false
    status.value = 'ready'
  } catch (reason) {
    status.value = 'error'
    error.value = reason instanceof Error ? reason.message : '二维码生成失败，请缩短内容后重试'
  }
}

function downloadFile(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

function downloadPng() {
  if (!canExport.value) return
  downloadFile(qrDataUrl.value, `suiye-qrcode-${Date.now()}.png`)
  emit('notify', 'PNG 二维码已下载')
}

function downloadSvg() {
  if (!canExport.value || !qrSvg.value) return
  const url = URL.createObjectURL(new Blob([qrSvg.value], { type: 'image/svg+xml;charset=utf-8' }))
  downloadFile(url, `suiye-qrcode-${Date.now()}.svg`)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  emit('notify', 'SVG 二维码已下载')
}

async function copyImage() {
  if (!canExport.value) return
  copyState.value = 'copying'
  if (copyFeedbackTimer) window.clearTimeout(copyFeedbackTimer)
  try {
    const blob = await (await fetch(qrDataUrl.value)).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    copyState.value = 'success'
    emit('notify', '二维码图片已复制到剪贴板', 'success')
  } catch (reason) {
    copyState.value = 'error'
    const denied = reason instanceof DOMException && reason.name === 'NotAllowedError'
    emit('notify', denied ? '复制权限被拒绝，请允许剪贴板权限后重试' : '复制图片失败，请改用 PNG 下载', 'error')
  }
  copyFeedbackTimer = window.setTimeout(() => { copyState.value = 'idle' }, 2200)
}

watch([content, size, level, margin, paletteId], () => {
  if (initialized.value) dirty.value = true
})

onMounted(async () => {
  content.value = await getCurrentTabUrl()
  await generateQr()
  initialized.value = true
})

onBeforeUnmount(() => {
  if (copyFeedbackTimer) window.clearTimeout(copyFeedbackTimer)
})
</script>

<template>
  <section class="qr-sheet utility-sheet resizable-sheet" :class="{ dragging }" :style="{ height: `${height}px` }" role="dialog" aria-modal="true" aria-label="二维码工具">
    <button class="resize-handle" title="拖动调整工具高度" aria-label="拖动调整二维码工具高度" @pointerdown="emit('resizeStart', $event)"><i /></button>
    <header class="utility-sheet-header">
      <div><small>本地开发工具</small><h2>二维码</h2></div>
      <span class="utility-local-state"><LockKeyhole :size="13" />仅在本机处理</span>
      <button class="utility-close" type="button" aria-label="关闭二维码工具" @click="emit('close')"><X :size="18" /></button>
    </header>

    <div class="qr-body utility-scroll-body">
      <section class="qr-input-card">
        <header><div><b>文字或 URL</b><span>支持中文、链接和任意文本内容</span></div><em>{{ content.length }} 字符</em></header>
        <textarea v-model="content" spellcheck="false" placeholder="输入需要生成二维码的内容" />
      </section>

      <section class="qr-settings-card" :class="{ expanded: showSettings }">
        <button class="qr-settings-toggle" type="button" :aria-expanded="showSettings" @click="showSettings = !showSettings"><SlidersHorizontal :size="16" /><span><b>生成设置</b><small>{{ settingsSummary }}</small></span><ChevronDown :size="16" /></button>
        <Transition name="settings-expand">
          <div v-if="showSettings" class="qr-settings-content">
            <div class="qr-setting-row"><span><b>图片尺寸</b><small>导出像素</small></span><div class="qr-option-group"><button v-for="option in sizeOptions" :key="option" type="button" :class="{ active: size === option }" @click="size = option">{{ option }}</button></div></div>
            <div class="qr-setting-row"><span><b>容错级别</b><small>污损后的可识别能力</small></span><div class="qr-option-group level-options"><button v-for="option in levelOptions" :key="option.value" type="button" :title="`约可恢复 ${option.description}`" :class="{ active: level === option.value }" @click="level = option.value"><b>{{ option.label }}</b><small>{{ option.description }}</small></button></div></div>
            <div class="qr-setting-row"><span><b>留白边距</b><small>二维码外侧模块数</small></span><div class="qr-option-group"><button v-for="option in marginOptions" :key="option" type="button" :class="{ active: margin === option }" @click="margin = option">{{ option }}</button></div></div>
            <div class="qr-setting-row palette-row"><span><b>颜色方案</b><small>前景与背景组合</small></span><div class="qr-palette-group"><button v-for="item in palettes" :key="item.id" type="button" :class="{ active: paletteId === item.id }" :title="item.label" :aria-label="`${item.label}配色`" @click="paletteId = item.id"><i :style="{ background: item.dark }" /><i :style="{ background: item.light }" /></button></div></div>
          </div>
        </Transition>
      </section>

      <section class="qr-preview-card">
        <header><span><QrCode :size="15" />预览</span><b v-if="canExport">{{ size }} px</b><em v-else-if="dirty">等待重新生成</em></header>
        <div class="qr-preview-stage" :style="{ background: palette.light }">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="二维码预览" />
          <div v-else class="qr-preview-empty"><AlertTriangle :size="24" /><span>{{ error || '二维码将在这里显示' }}</span></div>
        </div>
      </section>
    </div>

    <div class="utility-primary-bar"><button type="button" :disabled="status === 'generating'" @click="generateQr"><QrCode :size="15" />{{ status === 'generating' ? '正在生成' : '生成二维码' }}</button></div>
    <footer class="utility-footer">
      <div class="utility-result-state" :class="status"><Check v-if="status === 'ready' && !dirty" :size="14" /><AlertTriangle v-else-if="status === 'error'" :size="14" /><i v-else />{{ statusText }}</div>
      <div class="utility-footer-actions">
        <button class="qr-copy-button" :class="`action-${copyState}`" type="button" :disabled="!canExport || copyState === 'copying'" title="复制 PNG 图片" @click="copyImage">
          <LoaderCircle v-if="copyState === 'copying'" class="spin" :size="13" />
          <Check v-else-if="copyState === 'success'" :size="13" />
          <AlertTriangle v-else-if="copyState === 'error'" :size="13" />
          <Copy v-else :size="13" />
          {{ copyState === 'copying' ? '复制中' : copyState === 'success' ? '已复制' : copyState === 'error' ? '复制失败' : '复制' }}
        </button>
        <button type="button" :disabled="!canExport" title="下载 PNG" @click="downloadPng"><Download :size="13" />PNG</button>
        <button type="button" :disabled="!canExport" title="下载 SVG" @click="downloadSvg"><FileCode2 :size="13" />SVG</button>
      </div>
    </footer>
  </section>
</template>
