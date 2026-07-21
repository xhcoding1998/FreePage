<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string | number
  options: Array<{ label: string; value: string | number; description?: string }>
  compact?: boolean
  align?: 'left' | 'right'
}>(), { align: 'left' })
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const optionsRoot = ref<HTMLElement | null>(null)
const optionsStyle = ref<Record<string, string>>({})
const selected = computed(() => props.options.find(option => option.value === props.modelValue) || props.options[0])

function choose(value: string | number) {
  emit('update:modelValue', value)
  open.value = false
}
function closeOutside(event: PointerEvent) {
  const target = event.target as Node
  if (!root.value?.contains(target) && !optionsRoot.value?.contains(target)) open.value = false
}

async function updatePosition() {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = Math.max(rect.width, 152)
  let left = props.align === 'right' ? rect.right - width : rect.left
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  optionsStyle.value = { top: `${rect.bottom + 6}px`, left: `${left}px`, minWidth: `${width}px` }
  await nextTick()
  const menuHeight = optionsRoot.value?.getBoundingClientRect().height || 0
  if (rect.bottom + 6 + menuHeight > window.innerHeight - 8 && rect.top - menuHeight - 6 >= 8) {
    optionsStyle.value = { ...optionsStyle.value, top: `${rect.top - menuHeight - 6}px` }
  }
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    await updatePosition()
  }
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
          <button v-for="option in options" :key="option.value" type="button" :class="{ selected: option.value === modelValue }" @click="choose(option.value)">
            <span><b>{{ option.label }}</b><small v-if="option.description">{{ option.description }}</small></span>
            <Check v-if="option.value === modelValue" :size="14" />
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
