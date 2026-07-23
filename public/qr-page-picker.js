export async function runQrPagePicker() {
  const existing = document.getElementById('__suiye-qr-picker')
  existing?.remove()

  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.id = '__suiye-qr-picker'
    host.style.cssText = 'position:fixed;z-index:2147483647;inset:0;display:block;'
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `
      <style>
        *{box-sizing:border-box}
        .overlay{position:absolute;inset:0;overflow:hidden;cursor:crosshair;background:rgba(5,13,25,.40);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;touch-action:none;user-select:none}
        .overlay.selecting{background:transparent}
        .hint{position:absolute;z-index:3;top:22px;left:50%;display:flex;align-items:center;gap:9px;min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.20);border-radius:10px;color:#fff;background:rgba(10,20,35,.90);box-shadow:0 10px 30px rgba(0,0,0,.24);font-size:13px;transform:translateX(-50%);white-space:nowrap;pointer-events:none;backdrop-filter:blur(8px)}
        .hint i{width:8px;height:8px;border:2px solid #72a8ff;border-radius:2px}
        .hint kbd{padding:2px 6px;border:1px solid rgba(255,255,255,.22);border-radius:5px;color:#cad8ec;background:rgba(255,255,255,.08);font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
        .selection{position:absolute;display:none;border:2px solid #5b9cff;background:rgba(54,139,255,.08);box-shadow:0 0 0 9999px rgba(5,13,25,.48),0 0 0 1px rgba(255,255,255,.65) inset}
        .selection.active{display:block}
        .selection::before,.selection::after{content:"";position:absolute;width:8px;height:8px;border:2px solid #fff;background:#397ff0;box-shadow:0 1px 4px rgba(0,0,0,.28)}
        .selection::before{top:-5px;left:-5px}
        .selection::after{right:-5px;bottom:-5px}
        .size{position:absolute;right:-2px;bottom:-28px;min-width:70px;padding:4px 7px;border-radius:5px;color:#fff;background:rgba(9,19,33,.86);font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center}
      </style>
      <div class="overlay">
        <div class="hint"><i></i><span>拖动框选页面中的二维码</span><kbd>Esc 取消</kbd></div>
        <div class="selection"><span class="size"></span></div>
      </div>
    `
    const overlay = root.querySelector('.overlay')
    const selection = root.querySelector('.selection')
    const hintText = root.querySelector('.hint span')
    const size = root.querySelector('.size')
    let origin = null
    let pointerId = null

    const point = (event) => ({
      x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
      y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
    })
    const updateSelection = (current) => {
      const left = Math.min(origin.x, current.x)
      const top = Math.min(origin.y, current.y)
      const width = Math.abs(current.x - origin.x)
      const height = Math.abs(current.y - origin.y)
      selection.style.left = `${left}px`
      selection.style.top = `${top}px`
      selection.style.width = `${width}px`
      selection.style.height = `${height}px`
      size.textContent = `${Math.round(width)} × ${Math.round(height)}`
      return { x: left, y: top, width, height }
    }
    const finish = (result) => {
      document.removeEventListener('keydown', onKeyDown, true)
      host.remove()
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)))
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish({ cancelled: true })
    }

    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      pointerId = event.pointerId
      origin = point(event)
      overlay.classList.add('selecting')
      selection.classList.add('active')
      overlay.setPointerCapture?.(event.pointerId)
      updateSelection(origin)
    })
    overlay.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId || !origin) return
      updateSelection(point(event))
    })
    overlay.addEventListener('pointerup', (event) => {
      if (event.pointerId !== pointerId || !origin) return
      const rect = updateSelection(point(event))
      pointerId = null
      origin = null
      if (rect.width < 18 || rect.height < 18) {
        selection.classList.remove('active')
        overlay.classList.remove('selecting')
        hintText.textContent = '选区太小，请重新框选二维码'
        return
      }
      finish({ ...rect, devicePixelRatio: window.devicePixelRatio || 1 })
    })
    overlay.addEventListener('pointercancel', () => {
      pointerId = null
      origin = null
      selection.classList.remove('active')
      overlay.classList.remove('selecting')
    })
    document.addEventListener('keydown', onKeyDown, true)
    document.documentElement.appendChild(host)
  })
}
