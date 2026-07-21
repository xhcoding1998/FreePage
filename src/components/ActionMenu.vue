<script setup lang="ts">
import { ChevronUp } from 'lucide-vue-next'
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

interface ActionMenuItem {
  label: string
  value: string
  description?: string
  danger?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  items: ActionMenuItem[]
  label: string
  title?: string
  align?: 'left' | 'right'
}>(), { align: 'right' })
const emit = defineEmits<{ select: [value: string] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

function choose(item: ActionMenuItem) {
  if (item.disabled) return
  open.value = false
  emit('select', item.value)
}

function closeOutside(event: PointerEvent) {
  const target = event.target as Node
  if (!root.value?.contains(target) && !menu.value?.contains(target)) open.value = false
}

async function positionMenu() {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const width = 168
  const left = Math.max(8, Math.min(props.align === 'right' ? rect.right - width : rect.left, window.innerWidth - width - 8))
  menuStyle.value = { top: `${rect.bottom + 6}px`, left: `${left}px`, width: `${width}px` }
  await nextTick()
  const height = menu.value?.getBoundingClientRect().height || 0
  if (rect.bottom + height + 6 > window.innerHeight - 8 && rect.top - height - 6 >= 8) {
    menuStyle.value = { ...menuStyle.value, top: `${rect.top - height - 6}px` }
  }
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    await positionMenu()
  }
}

function handleViewportChange() {
  if (open.value) void positionMenu()
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
  <div ref="root" class="action-menu" :class="{ open }">
    <button ref="trigger" class="footer-icon action-menu-trigger" type="button" :title="title" :aria-expanded="open" aria-haspopup="menu" @click="toggle">
      <slot name="icon" />
      <span>{{ label }}</span>
      <ChevronUp :size="11" />
    </button>
    <Teleport to="body">
      <Transition name="select-pop">
        <div v-if="open" ref="menu" class="action-menu-options" :style="menuStyle" role="menu">
          <button v-for="item in items" :key="item.value" type="button" role="menuitem" :disabled="item.disabled" :class="{ danger: item.danger }" @click="choose(item)">
            <span><b>{{ item.label }}</b><small v-if="item.description">{{ item.description }}</small></span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
