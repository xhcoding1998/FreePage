<script setup lang="ts">
import { Check, ChevronDown, Search, X } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string | number
  options: Array<{ label: string; value: string | number; description?: string }>
  compact?: boolean
  align?: 'left' | 'right'
  searchable?: boolean
  searchPlaceholder?: string
}>(), { align: 'left' })
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const optionsRoot = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const optionsStyle = ref<Record<string, string>>({})
const searchQuery = ref('')
const selected = computed(() => props.options.find(option => option.value === props.modelValue) || props.options[0])
const filteredOptions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!props.searchable || !query) return props.options
  return props.options.filter(option => `${option.label} ${option.description || ''} ${String(option.value)}`.toLowerCase().includes(query))
})

function choose(value: string | number) {
  emit('update:modelValue', value)
  open.value = false
  searchQuery.value = ''
}
function closeOutside(event: PointerEvent) {
  const target = event.target as Node
  if (!root.value?.contains(target) && !optionsRoot.value?.contains(target)) open.value = false
}

async function updatePosition() {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const viewportMargin = 8
  const gap = 6
  const availableWidth = Math.max(120, window.innerWidth - viewportMargin * 2)
  const width = Math.min(Math.max(rect.width, props.searchable ? 220 : 152), availableWidth)
  let left = props.align === 'right' ? rect.right - width : rect.left
  left = Math.max(viewportMargin, Math.min(left, window.innerWidth - width - viewportMargin))
  optionsStyle.value = {
    top: `${rect.bottom + gap}px`,
    left: `${left}px`,
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
  }
  await nextTick()
  const naturalHeight = Math.min(optionsRoot.value?.scrollHeight || 0, 360)
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportMargin)
  const spaceAbove = Math.max(0, rect.top - gap - viewportMargin)
  const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.max(48, Math.min(360, availableHeight))
  const visibleHeight = Math.min(naturalHeight, maxHeight)
  const top = openAbove
    ? Math.max(viewportMargin, rect.top - gap - visibleHeight)
    : rect.bottom + gap
  optionsStyle.value = {
    ...optionsStyle.value,
    top: `${top}px`,
    maxHeight: `${maxHeight}px`,
  }
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    searchQuery.value = ''
    await nextTick()
    await updatePosition()
    if (props.searchable) searchInput.value?.focus()
  }
}

function closeSearch() {
  searchQuery.value = ''
  searchInput.value?.focus()
}

function handleViewportChange() {
  if (open.value) void updatePosition()
}

onMounted(() => {
  window.addEventListener('pointerdown', closeOutside)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})
onUnmounted(() => {
  window.removeEventListener('pointerdown', closeOutside)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})

watch(filteredOptions, () => {
  if (open.value) void nextTick(updatePosition)
})
</script>

<template>
  <div ref="root" class="select-menu" :class="[{ open, compact }, `align-${align}`]">
    <button ref="trigger" class="select-trigger" type="button" :aria-expanded="open" @click="toggle">
      <slot name="icon" />
      <span>{{ selected?.label }}</span>
      <ChevronDown :size="compact ? 12 : 14" />
    </button>
    <Teleport to="body">
      <Transition name="select-pop">
        <div v-if="open" ref="optionsRoot" class="select-options select-options-portal" :style="optionsStyle">
          <label v-if="searchable" class="select-search">
            <Search :size="13" />
            <input ref="searchInput" v-model="searchQuery" :placeholder="searchPlaceholder || '搜索选项'" @keydown.esc="open = false" />
            <button v-if="searchQuery" type="button" aria-label="清空搜索" @click="closeSearch"><X :size="12" /></button>
          </label>
          <button v-for="option in filteredOptions" :key="option.value" type="button" :class="{ selected: option.value === modelValue }" @click="choose(option.value)">
            <span><b>{{ option.label }}</b><small v-if="option.description">{{ option.description }}</small></span>
            <Check v-if="option.value === modelValue" :size="14" />
          </button>
          <div v-if="!filteredOptions.length" class="select-empty">没有匹配的选项</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
