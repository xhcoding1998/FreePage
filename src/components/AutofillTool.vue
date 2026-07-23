<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Check, Copy, CreditCard, ExternalLink, FileJson2, Globe2, RefreshCw, UserRound, WandSparkles } from 'lucide-vue-next'
import SelectMenu from './SelectMenu.vue'
import { autofillCountries, fillPageFields, generateTestEmail, generateTestProfile, testCards, type TestCard } from '../utils/autofill'

const emit = defineEmits<{
  notify: [message: string, tone?: 'success' | 'error' | 'info']
}>()

const isExtension = location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && !!chrome.runtime?.id
const countryCode = ref('US')
const emailDomain = ref('gmail.com')
const profile = ref(generateTestProfile(countryCode.value, emailDomain.value))
const provider = ref<TestCard['provider']>('Stripe')
const selectedScenarioId = ref('stripe-success')
const selectedCardId = ref('stripe-success-visa')
const includeIdentity = ref(true)
const includePayment = ref(true)
const filling = ref(false)
const profileRefreshing = ref(false)
const copiedKey = ref('')
const targetTab = ref<{ id?: number; url: string; title: string }>({ url: '', title: '' })
let copyTimer: number | undefined

const providerOptions = [
  { label: 'Stripe', value: 'Stripe', description: 'Stripe 官方沙箱测试卡' },
  { label: 'Adyen', value: 'Adyen', description: 'Adyen 官方测试卡' },
  { label: 'PayPal', value: 'PayPal', description: 'PayPal Expanded Checkout 沙箱' },
  { label: 'Airwallex', value: 'Airwallex', description: 'Airwallex 官方沙箱测试卡' },
]
const emailDomainOptions = [
  { label: 'gmail.com', value: 'gmail.com', description: '常用邮箱格式' },
  { label: 'foxmail.com', value: 'foxmail.com', description: '常用邮箱格式' },
  { label: 'outlook.com', value: 'outlook.com', description: '常用邮箱格式' },
  { label: 'qq.com', value: 'qq.com', description: '常用邮箱格式' },
  { label: 'icloud.com', value: 'icloud.com', description: '常用邮箱格式' },
]
const scenarioOptions = computed(() => {
  const scenarios = new Map<string, { label: string; value: string; description: string }>()
  testCards.filter(card => card.provider === provider.value).forEach(card => {
    if (!scenarios.has(card.scenarioId)) {
      scenarios.set(card.scenarioId, {
        label: card.scenarioLabel,
        value: card.scenarioId,
        description: card.scenarioDescription,
      })
    }
  })
  return [...scenarios.values()]
})
const availableCards = computed(() => testCards.filter(card => card.provider === provider.value && card.scenarioId === selectedScenarioId.value))
const selectedCard = computed(() => testCards.find(card => card.id === selectedCardId.value) || availableCards.value[0])
const targetHost = computed(() => {
  try { return new URL(targetTab.value.url).hostname || '本地文件' } catch { return '未识别网页' }
})
const isSupportedPage = computed(() => /^https?:|^file:/.test(targetTab.value.url))
const fillDisabled = computed(() => filling.value || !isSupportedPage.value || (!includeIdentity.value && !includePayment.value))

watch(countryCode, value => {
  profile.value = generateTestProfile(value, emailDomain.value)
})
watch(emailDomain, value => {
  profile.value.email = generateTestEmail(profile.value, value)
})
watch(provider, value => {
  const firstCard = testCards.find(card => card.provider === value)
  selectedScenarioId.value = firstCard?.scenarioId || ''
  selectedCardId.value = firstCard?.id || ''
})
watch(selectedScenarioId, value => {
  selectedCardId.value = testCards.find(card => card.provider === provider.value && card.scenarioId === value)?.id || ''
})

async function regenerateProfile() {
  if (profileRefreshing.value) return
  profileRefreshing.value = true
  await new Promise(resolve => window.setTimeout(resolve, 320))
  profile.value = generateTestProfile(countryCode.value, emailDomain.value)
  await new Promise(resolve => window.setTimeout(resolve, 650))
  profileRefreshing.value = false
  emit('notify', '已生成一组新的测试资料', 'success')
}

function copyProfileJson() {
  void copyValue('profile-json', JSON.stringify(profile.value, null, 2))
}

function formatCardNumber(card: TestCard) {
  if (card.brand === 'American Express') return card.number.replace(/(\d{4})(\d{6})(\d{5})/, '$1 $2 $3')
  return card.number.replace(/(\d{4})(?=\d)/g, '$1 ')
}

async function copyValue(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    if (copyTimer) window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => { copiedKey.value = '' }, 1300)
    emit('notify', '测试数据已复制', 'success')
  } catch {
    emit('notify', '复制失败，请检查剪贴板权限', 'error')
  }
}

async function refreshTargetTab() {
  if (!isExtension) {
    targetTab.value = { id: 1, url: 'http://localhost:3000/checkout', title: '本地测试页面' }
    return
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    targetTab.value = { id: tab?.id, url: tab?.url || '', title: tab?.title || '未命名网页' }
  } catch {
    targetTab.value = { url: '', title: '' }
  }
}

async function fillCurrentPage() {
  if (fillDisabled.value) return
  if (!isExtension || !targetTab.value.id) {
    emit('notify', '界面预览中不会修改网页表单', 'info')
    return
  }
  filling.value = true
  try {
    const card = selectedCard.value
    const payload = {
      ...(includeIdentity.value ? { identity: profile.value } : {}),
      ...(includePayment.value && card ? {
        payment: {
          name: card.holderName || profile.value.fullName,
          number: card.number,
          expiry: card.expiry,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          cvc: card.cvc,
        },
      } : {}),
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.value.id, allFrames: true },
      world: 'ISOLATED',
      func: fillPageFields,
      args: [payload],
    })
    const filled = results.reduce((total, result) => total + Number(result.result?.filled || 0), 0)
    const filledFrames = results.filter(result => Number(result.result?.filled || 0) > 0).length
    emit('notify', filled ? `已在 ${filledFrames} 个页面框架中填充 ${filled} 个字段，未提交表单` : '没有识别到可填充的表单字段', filled ? 'success' : 'info')
  } catch (reason) {
    emit('notify', reason instanceof Error ? reason.message : '网页填充失败', 'error')
  } finally {
    filling.value = false
  }
}

function onTabActivated() {
  void refreshTargetTab()
}
function onTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
  if (tabId === targetTab.value.id && (changeInfo.url || changeInfo.status === 'complete')) void refreshTargetTab()
}

onMounted(() => {
  void refreshTargetTab()
  if (isExtension) {
    chrome.tabs.onActivated.addListener(onTabActivated)
    chrome.tabs.onUpdated.addListener(onTabUpdated)
  }
})
onBeforeUnmount(() => {
  if (copyTimer) window.clearTimeout(copyTimer)
  if (isExtension) {
    chrome.tabs.onActivated.removeListener(onTabActivated)
    chrome.tabs.onUpdated.removeListener(onTabUpdated)
  }
})
</script>

<template>
  <section class="page autofill-page">
    <header class="page-toolbar autofill-toolbar">
      <div><b>智能填充</b><span>生成测试身份并识别当前网页表单</span></div>
      <button type="button" class="autofill-regenerate" :class="{ refreshing: profileRefreshing }" :disabled="profileRefreshing" :aria-busy="profileRefreshing" @click="regenerateProfile"><RefreshCw :size="14" />{{ profileRefreshing ? '正在生成' : '整组刷新' }}</button>
    </header>

    <div class="autofill-body">
      <section class="autofill-target" :class="{ supported: isSupportedPage }">
        <span class="autofill-target-icon"><Globe2 :size="16" /></span>
        <span><b>{{ targetHost }}</b><small>{{ targetTab.title || '等待当前网页' }}</small></span>
        <em>{{ isSupportedPage ? '可填充' : '不可填充' }}</em>
      </section>

      <section class="autofill-section profile-section" :class="{ 'profile-refreshing': profileRefreshing }">
        <header class="autofill-section-heading">
          <span class="autofill-section-icon identity"><UserRound :size="17" /></span>
          <span><b>测试资料生成</b><small>整组随机生成，字段可单独复制</small></span>
          <SelectMenu v-model="countryCode" :options="autofillCountries" searchable search-placeholder="搜索国家、英文名、代码或区号" align="right" class="autofill-country-select" />
        </header>
        <div class="autofill-generator-bar">
          <span>邮箱后缀</span>
          <SelectMenu v-model="emailDomain" :options="emailDomainOptions" compact align="left" class="email-domain-select" />
          <button type="button" :class="{ copied: copiedKey === 'profile-json' }" @click="copyProfileJson"><Check v-if="copiedKey === 'profile-json'" :size="13" /><FileJson2 v-else :size="13" />复制 JSON</button>
        </div>
        <div class="autofill-data-grid">
          <div class="autofill-data-item"><span>姓名</span><b>{{ profile.fullName }}</b><span class="autofill-data-actions"><button type="button" title="复制姓名" aria-label="复制姓名" @click="copyValue('name', profile.fullName)"><Check v-if="copiedKey === 'name'" :size="12" /><Copy v-else :size="12" /></button></span></div>
          <div class="autofill-data-item"><span>用户名</span><b>{{ profile.username }}</b><span class="autofill-data-actions"><button type="button" title="复制用户名" aria-label="复制用户名" @click="copyValue('username', profile.username)"><Check v-if="copiedKey === 'username'" :size="12" /><Copy v-else :size="12" /></button></span></div>
          <div class="autofill-data-item wide"><span>随机邮箱</span><b>{{ profile.email }}</b><span class="autofill-data-actions"><button type="button" title="复制邮箱" aria-label="复制邮箱" @click="copyValue('email', profile.email)"><Check v-if="copiedKey === 'email'" :size="12" /><Copy v-else :size="12" /></button></span></div>
          <div class="autofill-data-item"><span>随机国际号码</span><b>{{ profile.phone }}</b><span class="autofill-data-actions"><button type="button" title="复制国际号码" aria-label="复制国际号码" @click="copyValue('phone', profile.phone)"><Check v-if="copiedKey === 'phone'" :size="12" /><Copy v-else :size="12" /></button></span></div>
          <div class="autofill-data-item"><span>公司</span><b>{{ profile.company }}</b><span class="autofill-data-actions"><button type="button" title="复制公司" aria-label="复制公司" @click="copyValue('company', profile.company)"><Check v-if="copiedKey === 'company'" :size="12" /><Copy v-else :size="12" /></button></span></div>
          <div class="autofill-data-item wide"><span>测试地址</span><b>{{ profile.addressLine1 }} · {{ profile.city }} · {{ profile.postalCode }}</b><span class="autofill-data-actions"><button type="button" title="复制地址" aria-label="复制地址" @click="copyValue('address', `${profile.addressLine1}, ${profile.city}, ${profile.state} ${profile.postalCode}`)"><Check v-if="copiedKey === 'address'" :size="12" /><Copy v-else :size="12" /></button></span></div>
        </div>
      </section>

      <section class="autofill-section payment-section">
        <header class="autofill-section-heading">
          <span class="autofill-section-icon payment"><CreditCard :size="17" /></span>
          <span><b>支付测试卡</b><small>仅适用于支付平台沙箱环境</small></span>
          <SelectMenu v-model="provider" :options="providerOptions" compact align="right" class="autofill-provider-select" />
        </header>
        <div class="test-scenario-bar">
          <span><b>模拟状态</b><small>{{ selectedCard?.scenarioDescription }}</small></span>
          <SelectMenu v-model="selectedScenarioId" :options="scenarioOptions" compact align="right" class="autofill-scenario-select" />
        </div>
        <div class="test-card-tabs" role="tablist" aria-label="测试卡品牌">
          <button v-for="card in availableCards" :key="card.id" type="button" role="tab" :aria-selected="selectedCardId === card.id" :class="{ active: selectedCardId === card.id }" @click="selectedCardId = card.id">{{ card.brand }}</button>
        </div>
        <div v-if="selectedCard" class="test-card-preview">
          <div class="test-card-top"><span><CreditCard :size="16" />{{ selectedCard.provider }} TEST</span><em :class="selectedCard.scenarioTone">{{ selectedCard.scenarioLabel }}</em></div>
          <button type="button" class="test-card-number" @click="copyValue('card', selectedCard.number)"><span>{{ formatCardNumber(selectedCard) }}</span><Check v-if="copiedKey === 'card'" :size="15" /><Copy v-else :size="15" /></button>
          <div class="test-card-meta"><span><small>卡组织</small><b>{{ selectedCard.brand }}</b></span><span><small>有效期</small><b>{{ selectedCard.expiry }}</b></span><span><small>CVC</small><b>{{ selectedCard.cvc }}</b></span><a :href="selectedCard.sourceUrl" target="_blank" rel="noreferrer">官方来源<ExternalLink :size="11" /></a></div>
          <div v-if="selectedCard.trigger" class="test-card-trigger"><span>触发条件</span><b>{{ selectedCard.trigger }}</b></div>
        </div>
        <div class="autofill-warning"><AlertTriangle :size="15" /><span><b>测试卡不可用于真实支付</b><small>随页不会自动提交表单，也不会保存真实银行卡信息。</small></span></div>
      </section>
    </div>

    <footer class="autofill-footer">
      <div class="autofill-scope">
        <button type="button" :class="{ active: includeIdentity }" @click="includeIdentity = !includeIdentity"><UserRound :size="13" />身份</button>
        <button type="button" :class="{ active: includePayment }" @click="includePayment = !includePayment"><CreditCard :size="13" />测试卡</button>
      </div>
      <button type="button" class="autofill-primary" :disabled="fillDisabled" @click="fillCurrentPage"><WandSparkles :size="15" /><span>{{ filling ? '正在填充…' : '填充当前网页' }}</span></button>
    </footer>
  </section>
</template>

<style scoped>
.autofill-page { display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
.autofill-toolbar { position: relative; }
.autofill-regenerate { height: 34px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); font-size: 12px; font-weight: 620; cursor: pointer; transition: color .15s, border-color .15s, background .15s; }
.autofill-regenerate:hover { color: var(--accent-dark); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); background: var(--accent-soft); }
.autofill-regenerate:disabled { cursor: wait; }
.autofill-regenerate.refreshing svg { animation: profile-refresh-spin .7s linear infinite; }
.autofill-body { min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 7px; padding: 8px 9px 12px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.autofill-target { min-height: 43px; flex: 0 0 auto; display: flex; align-items: center; gap: 7px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--panel); }
.autofill-target-icon { width: 30px; height: 30px; flex: 0 0 30px; display: grid; place-items: center; border-radius: 8px; color: var(--faint); background: var(--panel-soft); }
.autofill-target.supported .autofill-target-icon { color: var(--accent-dark); background: var(--accent-soft); }
.autofill-target > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.autofill-target b, .autofill-target small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.autofill-target b { color: var(--text); font-size: 12px; }
.autofill-target small { color: var(--muted); font-size: 11px; }
.autofill-target em { padding: 3px 6px; border-radius: 6px; color: var(--muted); background: var(--panel-soft); font-size: 10px; font-style: normal; white-space: nowrap; }
.autofill-target.supported em { color: var(--green); background: color-mix(in srgb, var(--green) 8%, var(--panel)); }
.autofill-section { flex: 0 0 auto; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); box-shadow: var(--shadow-soft); overflow: hidden; }
.autofill-section-heading { min-height: 49px; display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.autofill-section-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; }
.autofill-section-icon.identity { color: var(--accent-dark); background: var(--accent-soft); }
.autofill-section-icon.payment { color: #7c3aed; background: color-mix(in srgb, #7c3aed 8%, var(--panel)); }
.autofill-section-heading > span:nth-child(2) { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.autofill-section-heading b { color: var(--text); font-size: 12px; }
.autofill-section-heading small { color: var(--muted); font-size: 11px; white-space: nowrap; }
.autofill-country-select { width: 112px; flex: 0 0 112px; }
.autofill-provider-select { width: 102px; flex: 0 0 102px; }
.autofill-country-select :deep(.select-trigger) { width: 100%; height: 35px; padding: 0 9px; border-color: var(--border-strong); border-radius: 8px; background: var(--panel-soft); font-size: 12px; font-weight: 700; box-shadow: 0 1px 3px rgba(15,23,42,.045); }
.autofill-provider-select :deep(.select-trigger) { width: 100%; height: 32px; padding: 0 7px; border-radius: 7px; font-size: 11px; }
.autofill-generator-bar { min-height: 39px; display: flex; align-items: center; gap: 6px; padding: 4px 7px; border-bottom: 1px solid var(--border); background: var(--panel-soft); }
.autofill-generator-bar > span { color: var(--muted); font-size: 10px; white-space: nowrap; }
.email-domain-select { min-width: 0; flex: 1; }
.email-domain-select :deep(.select-trigger) { width: 100%; height: 30px; padding: 0 7px; border-radius: 7px; background: var(--panel); font-size: 10px; }
.autofill-generator-bar > button { height: 30px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); font-size: 10px; cursor: pointer; }
.autofill-generator-bar > button:hover, .autofill-generator-bar > button.copied { color: var(--accent-dark); border-color: color-mix(in srgb, var(--accent) 32%, var(--border)); background: var(--accent-soft); }
.autofill-data-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border); }
.autofill-data-item { min-width: 0; min-height: 52px; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto; align-content: center; gap: 2px 5px; padding: 5px 7px 5px 8px; color: var(--muted); background: var(--panel); transition: background .15s; }
.autofill-data-item:hover { background: var(--panel-hover); }
.autofill-data-item > span:first-child { grid-column: 1; grid-row: 1; color: var(--faint); font-size: 10px; }
.autofill-data-item b { min-width: 0; grid-column: 1; grid-row: 2; overflow: hidden; color: var(--text); font-size: 11px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
.autofill-data-item.wide { grid-column: 1 / -1; }
.autofill-data-actions { grid-column: 2; grid-row: 1 / 3; align-self: center; display: flex; gap: 3px; }
.autofill-data-actions button { width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 6px; color: var(--faint); background: transparent; cursor: pointer; transition: color .15s, border-color .15s, background .15s, transform .14s; }
.autofill-data-actions button:hover { color: var(--accent-dark); border-color: var(--border); background: var(--panel); }
.autofill-data-actions button:active { transform: scale(.94); }
.test-scenario-bar { min-height: 48px; display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-bottom: 1px solid var(--border); background: var(--panel-soft); }
.test-scenario-bar > span { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.test-scenario-bar b { color: var(--text); font-size: 12px; }
.test-scenario-bar small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.autofill-scenario-select { width: 142px; flex: 0 0 142px; }
.autofill-scenario-select :deep(.select-trigger) { width: 100%; height: 32px; padding: 0 8px; border-color: var(--border-strong); background: var(--panel); font-size: 11px; font-weight: 700; }
.test-card-tabs { display: flex; gap: 5px; padding: 8px 9px 1px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; }
.test-card-tabs::-webkit-scrollbar { display: none; }
.test-card-tabs button { width: max-content; min-width: 82px; height: 32px; flex: 1 0 max-content; padding: 0 11px; border: 1px solid var(--border-strong); border-radius: 7px; overflow: hidden; color: var(--text); background: var(--panel); font-size: 12px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; transition: color .15s, border-color .15s, background .15s, box-shadow .15s; }
.test-card-tabs button:hover { color: var(--accent-dark); border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); }
.test-card-tabs button.active { color: var(--accent-dark); border-color: color-mix(in srgb, var(--accent) 48%, var(--border)); background: var(--accent-soft); box-shadow: inset 0 -2px var(--accent); }
.test-card-preview { margin: 8px 9px; padding: 11px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 9px; background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 8%, var(--panel)), var(--panel)); }
.test-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 10px; }
.test-card-top span { display: inline-flex; align-items: center; gap: 5px; font-weight: 680; letter-spacing: .45px; }
.test-card-top em { padding: 3px 7px; border-radius: 999px; font-size: 10px; font-style: normal; font-weight: 700; }
.test-card-top em.success { color: var(--green); background: color-mix(in srgb, var(--green) 10%, var(--panel)); }
.test-card-top em.warning { color: var(--amber); background: color-mix(in srgb, var(--amber) 11%, var(--panel)); }
.test-card-top em.danger { color: var(--red); background: color-mix(in srgb, var(--red) 9%, var(--panel)); }
.test-card-top em.info { color: var(--accent-dark); background: var(--accent-soft); }
.test-card-number { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 13px 0 10px; padding: 0; border: 0; color: var(--text); background: transparent; cursor: pointer; }
.test-card-number span { font: 680 17px/1.2 'DM Mono'; letter-spacing: .35px; white-space: nowrap; }
.test-card-number svg { color: var(--muted); }
.test-card-meta { display: flex; align-items: flex-end; gap: 12px; }
.test-card-meta > span { display: flex; flex-direction: column; gap: 2px; }
.test-card-meta small { color: var(--faint); font-size: 9px; }
.test-card-meta b { color: var(--text); font: 650 11px 'DM Mono'; }
.test-card-meta a { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; color: var(--accent-dark); font-size: 10px; text-decoration: none; }
.test-card-trigger { display: flex; align-items: center; justify-content: space-between; gap: 9px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border-strong); }
.test-card-trigger span { color: var(--faint); font-size: 10px; }
.test-card-trigger b { overflow: hidden; color: var(--text); font: 650 10px 'DM Mono'; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.autofill-warning { display: flex; align-items: flex-start; gap: 7px; margin: 0 9px 9px; padding: 8px; border: 1px solid color-mix(in srgb, var(--amber) 25%, var(--border)); border-radius: 8px; color: var(--amber); background: color-mix(in srgb, var(--amber) 5%, var(--panel)); }
.autofill-warning > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.autofill-warning b { color: var(--text); font-size: 11px; }
.autofill-warning small { color: var(--muted); font-size: 10px; line-height: 1.45; }
.autofill-footer { min-height: 56px; flex: 0 0 auto; display: grid; grid-template-columns: auto minmax(130px, 1fr); gap: 8px; padding: 8px 11px 9px; border-top: 1px solid var(--border-strong); background: var(--panel); box-shadow: 0 -5px 16px rgba(22,34,53,.055); }
.autofill-scope { display: flex; gap: 4px; }
.autofill-scope button { height: 38px; display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); background: var(--panel); font-size: 11px; cursor: pointer; }
.autofill-scope button.active { color: var(--accent-dark); border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); background: var(--accent-soft); }
.autofill-primary { height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--accent); border-radius: 8px; color: #fff; background: var(--accent); box-shadow: 0 3px 9px color-mix(in srgb, var(--accent) 20%, transparent); font-size: 12px; font-weight: 680; cursor: pointer; }
.autofill-primary:disabled { opacity: .45; box-shadow: none; cursor: not-allowed; }
.profile-section .autofill-data-grid { position: relative; isolation: isolate; }
.profile-section.profile-refreshing .autofill-data-item { animation: profile-snap-item .78s ease-in-out both; }
.profile-section.profile-refreshing .autofill-data-item:nth-child(2) { animation-delay: .025s; }
.profile-section.profile-refreshing .autofill-data-item:nth-child(3) { animation-delay: .05s; }
.profile-section.profile-refreshing .autofill-data-item:nth-child(4) { animation-delay: .075s; }
.profile-section.profile-refreshing .autofill-data-item:nth-child(5) { animation-delay: .1s; }
.profile-section.profile-refreshing .autofill-data-item:nth-child(6) { animation-delay: .125s; }
.profile-section.profile-refreshing .autofill-data-grid::after { content: ''; position: absolute; z-index: 2; inset: 8% -4% 8% 46%; pointer-events: none; opacity: 0; background: radial-gradient(circle at 16% 18%, color-mix(in srgb, var(--accent) 52%, transparent) 0 1px, transparent 2px), radial-gradient(circle at 42% 34%, color-mix(in srgb, var(--faint) 55%, transparent) 0 1px, transparent 2px), radial-gradient(circle at 74% 22%, color-mix(in srgb, var(--accent) 42%, transparent) 0 1.5px, transparent 2.5px), radial-gradient(circle at 28% 72%, color-mix(in srgb, var(--faint) 52%, transparent) 0 1px, transparent 2px), radial-gradient(circle at 68% 68%, color-mix(in srgb, var(--accent) 48%, transparent) 0 1px, transparent 2px); background-size: 34px 31px, 29px 27px, 42px 36px, 31px 38px, 37px 29px; animation: profile-snap-dust .82s ease-out both; }
@keyframes profile-refresh-spin { to { transform: rotate(360deg); } }
@keyframes profile-snap-item {
  0%, 14%, 100% { opacity: 1; filter: blur(0); transform: translate3d(0,0,0) scale(1); }
  42%, 55% { opacity: 0; filter: blur(4px); transform: translate3d(12px,-5px,0) scale(.98); }
}
@keyframes profile-snap-dust {
  0% { opacity: 0; transform: translate3d(-8px,5px,0) scale(.92); }
  38% { opacity: .8; }
  100% { opacity: 0; transform: translate3d(24px,-11px,0) scale(1.08); }
}
@media (prefers-reduced-motion: reduce) {
  .profile-section.profile-refreshing .autofill-data-item,
  .profile-section.profile-refreshing .autofill-data-grid::after,
  .autofill-regenerate.refreshing svg { animation: none; }
}
@media (max-width: 390px) {
  .autofill-body { padding-right: 9px; padding-left: 9px; }
  .test-card-number span { font-size: 15px; }
  .autofill-scope button { padding: 0 7px; }
  .autofill-country-select { width: 106px; flex-basis: 106px; }
  .autofill-section-heading small { max-width: 128px; overflow: hidden; text-overflow: ellipsis; }
}
</style>
