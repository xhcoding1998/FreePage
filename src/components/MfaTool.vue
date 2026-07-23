<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, Copy, FileKey2, FileText, ImageUp, KeyRound, LoaderCircle, LockKeyhole, Plus, ScanLine, ShieldCheck, Trash2, X } from 'lucide-vue-next'
import { parseMfaImports } from '../utils/mfa-import'
import { decodeQrImage } from '../utils/qr-reader'
import { generateTotpCode, type TotpAlgorithm } from '../utils/totp'

type MfaAccount = {
  id: string
  issuer: string
  account: string
  secret: string
  algorithm: TotpAlgorithm
  digits: 6 | 8
  period: number
  createdAt: number
}

defineProps<{
  height: number
  dragging: boolean
}>()

const emit = defineEmits<{
  resizeStart: [event: PointerEvent]
  sheetOpen: []
  notify: [message: string, tone?: 'success' | 'error' | 'info']
  countChange: [count: number]
}>()

const STORAGE_KEY = 'suiye-mfa-accounts-v1'
const accounts = ref<MfaAccount[]>([])
const codes = ref<Record<string, string>>({})
const codeErrors = ref<Record<string, string>>({})
const now = ref(Date.now())
const mode = ref<'list' | 'import'>('list')
const loading = ref(true)
const saving = ref(false)
const formError = ref('')
const importText = ref('')
const importOrigin = ref('')
const importingFile = ref(false)
const dragActive = ref(false)
const textFileInput = ref<HTMLInputElement | null>(null)
const qrFileInput = ref<HTMLInputElement | null>(null)
const copiedId = ref('')
const deleteTarget = ref<{ kind: 'account'; account: MfaAccount } | { kind: 'all' } | null>(null)
const deleting = ref(false)
let clockTimer: number | undefined
let feedbackTimer: number | undefined
let lastSecond = -1

const storageAvailable = typeof chrome !== 'undefined' && !!chrome.storage?.local
const accountCountText = computed(() => `${accounts.value.length} 个账户`)
watch(accounts, value => emit('countChange', value.length), { immediate: true })
const importResult = computed(() => {
  const batch = parseMfaImports(importText.value)
  const existing = new Set(accounts.value.map(accountSignature))
  const current = new Set<string>()
  const ready = []
  let duplicateCount = 0
  for (const account of batch.accounts) {
    const signature = accountSignature(account)
    if (existing.has(signature) || current.has(signature)) {
      duplicateCount += 1
      continue
    }
    current.add(signature)
    ready.push(account)
  }
  return {
    accounts: ready,
    duplicateCount,
    errors: batch.errors,
    parsedCount: batch.accounts.length + batch.errors.length,
    sources: [...new Set(batch.accounts.map(item => item.source))],
  }
})
const importSourceLabel = computed(() => {
  if (importResult.value.sources.length > 1) return '混合格式'
  if (importResult.value.sources[0] === 'otpauth') return 'OTPAUTH'
  if (importResult.value.sources[0] === 'json') return 'JSON'
  return 'BASE32'
})
function accountSignature(item: Pick<MfaAccount, 'secret' | 'algorithm' | 'digits' | 'period'>) {
  return `${item.secret}:${item.algorithm}:${item.digits}:${item.period}`
}

function isStoredAccount(value: unknown): value is MfaAccount {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<MfaAccount>
  return typeof item.id === 'string'
    && typeof item.issuer === 'string'
    && typeof item.account === 'string'
    && typeof item.secret === 'string'
    && ['SHA-1', 'SHA-256', 'SHA-512'].includes(item.algorithm || '')
    && [6, 8].includes(item.digits || 0)
    && typeof item.period === 'number'
}

async function restrictExtensionStorage() {
  if (!storageAvailable) return
  try {
    const localArea = chrome.storage.local as typeof chrome.storage.local & {
      setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>
    }
    await localArea.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch {
    // Older Chromium versions do not expose setAccessLevel.
  }
}

async function loadAccounts() {
  loading.value = true
  try {
    await restrictExtensionStorage()
    const stored = storageAvailable
      ? (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
      : JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    accounts.value = Array.isArray(stored) ? stored.filter(isStoredAccount) : []
    await refreshCodes()
  } catch {
    accounts.value = []
    emit('notify', 'MFA 账户读取失败', 'error')
  } finally {
    loading.value = false
  }
}

async function persistAccounts() {
  const plainAccounts = accounts.value.map(item => ({ ...item }))
  if (storageAvailable) await chrome.storage.local.set({ [STORAGE_KEY]: plainAccounts })
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(plainAccounts))
}

async function refreshCodes() {
  const nextCodes: Record<string, string> = {}
  const nextErrors: Record<string, string> = {}
  await Promise.all(accounts.value.map(async item => {
    try {
      nextCodes[item.id] = await generateTotpCode(item, now.value)
    } catch (reason) {
      nextErrors[item.id] = reason instanceof Error ? reason.message : '验证码生成失败'
    }
  }))
  codes.value = nextCodes
  codeErrors.value = nextErrors
}

function secondsRemaining(item: MfaAccount) {
  const elapsed = Math.floor(now.value / 1000) % item.period
  return item.period - elapsed
}

function countdownTone(item: MfaAccount) {
  const remaining = secondsRemaining(item)
  if (remaining <= 5) return 'danger'
  if (remaining <= 10) return 'warning'
  return 'safe'
}

function countdownColor(item: MfaAccount) {
  const tone = countdownTone(item)
  if (tone === 'danger') return 'var(--red)'
  if (tone === 'warning') return 'var(--amber)'
  return 'var(--green)'
}

function remainingPercent(item: MfaAccount) {
  return Math.max(0, Math.min(100, secondsRemaining(item) / item.period * 100))
}

function formattedCode(item: MfaAccount) {
  const code = codes.value[item.id] || '•'.repeat(item.digits)
  const midpoint = Math.ceil(code.length / 2)
  return `${code.slice(0, midpoint)} ${code.slice(midpoint)}`
}

function resetImport() {
  importText.value = ''
  importOrigin.value = ''
  formError.value = ''
  dragActive.value = false
}

function startImport() {
  resetImport()
  emit('sheetOpen')
  mode.value = 'import'
}

function cancelImport() {
  if (importingFile.value) return
  mode.value = 'list'
  resetImport()
}

function applyImportPayload(value: string, origin: string) {
  const normalized = value.trim()
  if (!normalized) {
    formError.value = `${origin}中没有可读取的内容`
    return
  }
  importText.value = normalized
  importOrigin.value = origin
  formError.value = ''
}

async function readTextFile(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('TXT 文件不能超过 5 MB')
  applyImportPayload(await file.text(), file.name)
}

async function readQrFile(file: File) {
  if (file.size > 15 * 1024 * 1024) throw new Error('二维码图片不能超过 15 MB')
  const payload = await decodeQrImage(file)
  if (!payload) throw new Error('图片中没有识别到二维码，请裁剪后重试')
  applyImportPayload(payload, file.name)
}

async function importFile(file: File, preferredType?: 'text' | 'image') {
  importingFile.value = true
  formError.value = ''
  try {
    const lowerName = file.name.toLowerCase()
    const isImage = preferredType === 'image' || file.type.startsWith('image/')
      || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lowerName)
    if (isImage) await readQrFile(file)
    else if (preferredType === 'text' || file.type.startsWith('text/') || /\.(txt|json)$/i.test(lowerName)) await readTextFile(file)
    else throw new Error('仅支持 TXT、JSON 或二维码图片文件')
  } catch (reason) {
    formError.value = reason instanceof Error ? reason.message : '文件读取失败'
  } finally {
    importingFile.value = false
  }
}

function onFileSelected(event: Event, preferredType: 'text' | 'image') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void importFile(file, preferredType)
  input.value = ''
}

function onImportDragLeave(event: DragEvent) {
  const container = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return
  dragActive.value = false
}

function onImportDrop(event: DragEvent) {
  dragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    void importFile(file)
    return
  }
  const text = event.dataTransfer?.getData('text/plain') || ''
  if (text.trim()) applyImportPayload(text, '拖入文本')
  else formError.value = '没有读取到可导入的文本或文件'
}

async function captureCurrentPage() {
  formError.value = ''
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    formError.value = '当前环境无法在网页中框选，请改用二维码图片'
    return
  }
  importingFile.value = true
  try {
    const response = await chrome.runtime.sendMessage({ type: 'START_QR_PAGE_PICKER' }) as {
      ok?: boolean
      cancelled?: boolean
      dataUrl?: string
      crop?: { x: number; y: number; width: number; height: number }
      error?: string
    }
    if (response?.cancelled) return
    if (!response?.ok || !response.dataUrl || !response.crop) throw new Error(response?.error || '网页框选失败')
    const payload = await decodeQrImage(response.dataUrl, response.crop)
    if (!payload) throw new Error('框选区域没有识别到二维码，请重新框选')
    applyImportPayload(payload, '当前网页二维码')
    emit('notify', '二维码已识别，请确认账户信息', 'success')
  } catch (reason) {
    formError.value = reason instanceof Error ? reason.message : '网页框选失败'
  } finally {
    importingFile.value = false
  }
}

async function saveAccount() {
  formError.value = ''
  const candidates = importResult.value.accounts
  if (!candidates.length) {
    formError.value = importResult.value.errors[0]?.message
      || (importResult.value.duplicateCount ? '这些 MFA 账户已经存在' : '没有可导入的 MFA 账户')
    return
  }

  saving.value = true
  const previous = accounts.value
  const skippedBeforeValidation = importResult.value.duplicateCount + importResult.value.errors.length
  try {
    const valid = []
    let validationErrorCount = 0
    for (const candidate of candidates) {
      try {
        await generateTotpCode(candidate)
        valid.push(candidate)
      } catch {
        validationErrorCount += 1
      }
    }
    if (!valid.length) {
      formError.value = '这些 MFA 密钥无法生成验证码'
      return
    }

    const imported = valid.map((parsed, index) => ({
      id: crypto.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      issuer: parsed.issuer || 'MFA 账户',
      account: parsed.account || `账户 ${previous.length + index + 1}`,
      secret: parsed.secret,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
      createdAt: Date.now(),
    }))
    accounts.value = [...previous, ...imported]
    await persistAccounts()
    await refreshCodes()
    mode.value = 'list'
    resetImport()
    const skipped = skippedBeforeValidation + validationErrorCount
    emit('notify', skipped ? `已导入 ${imported.length} 个账户，跳过 ${skipped} 项` : `已导入 ${imported.length} 个 MFA 账户`, 'success')
  } catch {
    accounts.value = previous
    formError.value = '账户批量保存失败，请检查扩展存储权限'
  } finally {
    saving.value = false
  }
}

async function copyCode(item: MfaAccount) {
  const code = codes.value[item.id]
  if (!code || codeErrors.value[item.id]) return
  try {
    await navigator.clipboard.writeText(code)
    copiedId.value = item.id
    if (feedbackTimer) window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => { copiedId.value = '' }, 1600)
    emit('notify', `${item.issuer} 验证码已复制`, 'success')
  } catch {
    emit('notify', '验证码复制失败', 'error')
  }
}

function requestDelete(item: MfaAccount) {
  deleteTarget.value = { kind: 'account', account: item }
}

function requestClearAll() {
  deleteTarget.value = { kind: 'all' }
}

function cancelDelete() {
  if (deleting.value) return
  deleteTarget.value = null
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return
  const target = deleteTarget.value
  const previous = accounts.value
  const removedName = target.kind === 'account' ? target.account.issuer : ''
  deleting.value = true
  accounts.value = target.kind === 'account' ? accounts.value.filter(account => account.id !== target.account.id) : []
  try {
    await persistAccounts()
    deleteTarget.value = null
    emit('notify', target.kind === 'account' ? `${removedName} 已删除` : 'MFA 账户已全部清空', 'success')
  } catch {
    accounts.value = previous
    emit('notify', target.kind === 'account' ? '账户删除失败' : '账户清空失败', 'error')
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await loadAccounts()
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
    const second = Math.floor(now.value / 1000)
    if (second !== lastSecond) {
      lastSecond = second
      void refreshCodes()
    }
  }, 250)
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
})
</script>

<template>
  <section class="page mfa-page">
    <header class="page-toolbar mfa-page-toolbar">
      <div><b>MFA 验证器</b><span>动态验证码仅在本机生成和保存</span></div>
      <button class="primary-button" type="button" @click="startImport"><Plus :size="15" />导入账户</button>
    </header>

    <div class="mfa-page-body">
      <section class="mfa-vault-summary"><ShieldCheck :size="17" /><span><b>本机验证账户</b><small>密钥不会同步或发送到网络</small></span><em>{{ accountCountText }}</em></section>
      <div class="mfa-list-heading"><div><b>验证码</b><span>点击任意账户即可复制</span></div><small>自动刷新</small></div>

      <div v-if="loading" class="mfa-empty"><KeyRound :size="28" /><b>正在读取账户</b><span>请稍候</span></div>
      <div v-else-if="!accounts.length" class="mfa-empty"><KeyRound :size="29" /><b>还没有 MFA 账户</b><span>导入密钥或 otpauth 地址后，即可在这里查看动态验证码</span><button type="button" @click="startImport"><Plus :size="14" />导入第一个账户</button></div>
      <div v-else class="mfa-account-list">
        <div
          v-for="(item, index) in accounts"
          :key="item.id"
          class="mfa-account-shell"
          :style="{ '--mfa-index': Math.min(index, 8) }"
        >
          <article
            class="mfa-account-card"
            :class="[{ copied: copiedId === item.id, invalid: codeErrors[item.id], refreshed: secondsRemaining(item) >= item.period - 1 }, `tone-${countdownTone(item)}`]"
            role="button"
            tabindex="0"
            :aria-disabled="!!codeErrors[item.id]"
            :aria-label="`${item.issuer} ${item.account}，验证码 ${codes[item.id] || '生成中'}，点击复制`"
            :title="codeErrors[item.id] || '点击复制当前验证码'"
            @click="copyCode(item)"
            @keydown.enter.prevent="copyCode(item)"
            @keydown.space.prevent="copyCode(item)"
          >
            <div class="mfa-card-top">
              <i class="mfa-account-avatar">{{ item.issuer.slice(0, 1).toUpperCase() }}</i>
              <span class="mfa-account-name"><b>{{ item.issuer }}</b><small>{{ item.account }}</small></span>
            </div>
            <div class="mfa-code-row" :class="`tone-${countdownTone(item)}`">
              <strong>{{ formattedCode(item) }}</strong>
              <span
                class="mfa-countdown"
                :class="`tone-${countdownTone(item)}`"
                :style="{ background: `conic-gradient(${countdownColor(item)} ${remainingPercent(item)}%, var(--panel-soft) 0)` }"
              ><i><b>{{ secondsRemaining(item) }}</b><small>秒</small></i></span>
            </div>
            <div class="mfa-card-bottom">
              <span>{{ item.algorithm.replace('SHA-', 'SHA') }} · {{ item.digits }} 位 · {{ item.period }} 秒周期</span>
              <small class="mfa-copy-affordance" :class="{ success: copiedId === item.id }"><Check v-if="copiedId === item.id" :size="13" /><Copy v-else :size="13" />{{ copiedId === item.id ? '已复制' : '点击复制' }}</small>
            </div>
            <div class="mfa-time-track"><i :class="`tone-${countdownTone(item)}`" :style="{ width: `${remainingPercent(item)}%` }" /></div>
          </article>
          <button class="mfa-delete" type="button" :aria-label="`删除 ${item.issuer}`" title="删除账户" @click="requestDelete(item)"><Trash2 :size="13" /></button>
        </div>
      </div>

      <footer v-if="accounts.length" class="mfa-list-footer"><span><LockKeyhole :size="13" />{{ accountCountText }} · 本机持久化</span><button type="button" @click="requestClearAll"><Trash2 :size="13" />清空全部</button></footer>
    </div>

    <Transition name="sheet">
      <div v-if="mode === 'import'" class="sheet-backdrop utility-tool-backdrop mfa-import-backdrop" @click.self="cancelImport">
        <section class="utility-sheet mfa-import-sheet resizable-sheet" :class="{ dragging }" :style="{ height: `${height}px` }" role="dialog" aria-modal="true" aria-label="导入 MFA 账户">
          <button class="resize-handle" title="拖动调整面板高度" aria-label="拖动调整 MFA 导入面板高度" @pointerdown="emit('resizeStart', $event)"><i /></button>
          <header class="utility-sheet-header">
            <FileKey2 :size="19" />
            <div><h2>导入验证账户</h2></div>
            <span class="utility-local-state"><LockKeyhole :size="12" />仅本机</span>
            <button class="utility-close" type="button" :disabled="importingFile" aria-label="关闭导入面板" @click="cancelImport"><X :size="17" /></button>
          </header>

          <form
            class="utility-scroll-body mfa-import-body"
            :class="{ 'is-dragging': dragActive }"
            @submit.prevent="saveAccount"
            @dragenter.prevent="dragActive = true"
            @dragover.prevent="dragActive = true"
            @dragleave="onImportDragLeave"
            @drop.prevent="onImportDrop"
          >
            <div class="mfa-import-intro"><div><b>导入 MFA 账户</b><span>粘贴内容、选择文件，或从当前网页框选二维码</span></div><FileKey2 :size="19" /></div>
            <div class="mfa-import-methods">
              <input ref="textFileInput" type="file" accept=".txt,.json,text/plain,application/json" hidden @change="onFileSelected($event, 'text')">
              <input ref="qrFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden @change="onFileSelected($event, 'image')">
              <button type="button" :disabled="importingFile" @click="textFileInput?.click()"><FileText :size="16" /><span><b>TXT 文件</b><small>批量密钥</small></span></button>
              <button type="button" :disabled="importingFile" @click="qrFileInput?.click()"><ImageUp :size="16" /><span><b>二维码图片</b><small>本地识别</small></span></button>
              <button type="button" :disabled="importingFile" @click="captureCurrentPage"><ScanLine :size="16" /><span><b>框选当前页</b><small>截取二维码</small></span></button>
            </div>
            <label class="mfa-import-card" :class="{ valid: importResult.accounts.length, invalid: (!importResult.accounts.length && importResult.errors.length) || formError, dragging: dragActive }">
              <span><b>MFA 密钥</b><small>支持拖入 TXT、二维码图片或文本</small></span>
              <textarea v-model="importText" autocomplete="off" spellcheck="false" placeholder="每行粘贴一个密钥或 otpauth://totp/...&#10;也可以粘贴 JSON 数组" @input="formError = ''" />
              <em v-if="importingFile"><LoaderCircle class="spin" :size="13" />正在读取本机文件</em>
              <em v-else>{{ importText ? `共读取 ${importResult.parsedCount} 项${importOrigin ? ` · 来自 ${importOrigin}` : ''}` : '可直接粘贴，也可以把文件拖到此处' }}</em>
            </label>

            <Transition name="settings-expand">
              <section v-if="importResult.accounts.length" class="mfa-import-preview batch">
                <header><span><Check :size="14" />可导入 {{ importResult.accounts.length }} 个账户</span><b>{{ importSourceLabel }}</b></header>
                <div class="mfa-import-preview-list">
                  <div v-for="(item, index) in importResult.accounts" :key="`${accountSignature(item)}-${index}`" class="mfa-import-preview-row">
                    <i>{{ item.issuer.slice(0, 1).toUpperCase() }}</i>
                    <span><b>{{ item.issuer }}</b><small>{{ item.account || `账户 ${accounts.length + index + 1}` }}</small></span>
                    <em>{{ item.algorithm.replace('SHA-', 'SHA') }} · {{ item.digits }} 位 · {{ item.period }}s</em>
                  </div>
                </div>
              </section>
            </Transition>
            <div v-if="importResult.duplicateCount" class="mfa-import-duplicate"><Check :size="14" />已自动忽略 {{ importResult.duplicateCount }} 个重复账户</div>
            <section v-if="importResult.errors.length" class="mfa-import-issues">
              <header><AlertTriangle :size="14" /><b>{{ importResult.errors.length }} 项未识别</b><span>不会影响其他账户导入</span></header>
              <div v-for="issue in importResult.errors.slice(0, 3)" :key="`${issue.index}-${issue.message}`"><b>第 {{ issue.index + 1 }} 项</b><span>{{ issue.message }}</span></div>
              <small v-if="importResult.errors.length > 3">另有 {{ importResult.errors.length - 3 }} 项未展示</small>
            </section>
            <div v-if="formError" class="mfa-form-error"><AlertTriangle :size="14" />{{ formError }}</div>
            <div v-else-if="!importText" class="mfa-import-hint"><KeyRound :size="14" /><span>推荐粘贴完整 otpauth 地址，可自动保留服务名、账户与验证码参数。</span></div>
          </form>

          <div class="utility-primary-bar mfa-primary-bar"><button class="mfa-cancel-button" type="button" :disabled="importingFile" @click="cancelImport">取消</button><button type="button" :disabled="saving || importingFile || !importResult.accounts.length" @click="saveAccount"><Check :size="15" />{{ saving ? '正在导入' : `确认导入 ${importResult.accounts.length} 个` }}</button></div>
          <footer class="utility-footer"><div class="utility-result-state ready"><ShieldCheck :size="14" />密钥将保存至本机扩展存储</div></footer>
        </section>
      </div>
    </Transition>

    <Transition name="mfa-confirm">
      <div v-if="deleteTarget" class="mfa-confirm-backdrop" @click.self="cancelDelete">
        <section class="mfa-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mfa-delete-title">
          <div class="mfa-confirm-icon"><Trash2 :size="20" /></div>
          <div class="mfa-confirm-copy">
            <h2 id="mfa-delete-title">{{ deleteTarget.kind === 'account' ? `删除 ${deleteTarget.account.issuer}？` : '清空全部 MFA 账户？' }}</h2>
            <p>{{ deleteTarget.kind === 'account' ? `将从本机移除 ${deleteTarget.account.account} 的密钥和验证码。` : `将永久移除本机保存的 ${accounts.length} 个 MFA 账户。` }}</p>
          </div>
          <div v-if="deleteTarget.kind === 'account'" class="mfa-confirm-account"><i>{{ deleteTarget.account.issuer.slice(0, 1).toUpperCase() }}</i><span><b>{{ deleteTarget.account.issuer }}</b><small>{{ deleteTarget.account.account }}</small></span></div>
          <footer><button type="button" :disabled="deleting" @click="cancelDelete">取消</button><button class="confirm-danger" type="button" :disabled="deleting" @click="confirmDelete"><Trash2 :size="14" />{{ deleting ? '正在删除' : '确认删除' }}</button></footer>
        </section>
      </div>
    </Transition>
  </section>
</template>
