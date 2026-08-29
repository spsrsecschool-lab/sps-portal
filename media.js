// ═══════════════════════════════════════════════════════════════════════════
// SPSMedia — shared photo/document capture helper for the SPS portals
//
// Two jobs:
//  1. On mobile, when the user wants to add a photo/document, ask whether to
//     TAKE a photo (camera) or CHOOSE an existing file. On desktop it just
//     opens the normal file picker.
//  2. For document types that need two sides (e.g. Aadhaar front + back), it
//     collects both images and MERGES them into ONE file (stacked vertically),
//     so a single file is stored — not two separate ones.
//
// Include with:  <script src="media.js"></script>
// Use:           const res = await SPSMedia.acquireDocument('Aadhar Card')
//                const photo = await SPSMedia.acquirePhoto()
// ═══════════════════════════════════════════════════════════════════════════
window.SPSMedia = (function () {
  const isMobile = () =>
    /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && window.innerWidth < 900)

  // Document types that must be captured as multiple images and merged into one
  // file. Extend this map to add more (value = the labels shown per capture).
  const MULTI = {
    'Aadhar Card': ['Front side', 'Back side'],
    'Aadhaar Card': ['Front side', 'Back side'],
  }

  // Low-level: open a single file input, optionally forcing the camera.
  function grabFile({ accept = 'image/*', capture = false } = {}) {
    return new Promise((resolve) => {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = accept
      if (capture) inp.setAttribute('capture', 'environment')
      inp.style.position = 'fixed'
      inp.style.left = '-9999px'
      let settled = false
      const finish = (f) => { if (!settled) { settled = true; resolve(f || null); setTimeout(() => inp.remove(), 300) } }
      inp.onchange = () => finish(inp.files && inp.files[0])
      // Fallback: if the picker is dismissed with no file, resolve null when the
      // window regains focus (best-effort; not all browsers fire reliably).
      const onFocus = () => { setTimeout(() => { if (!settled && (!inp.files || !inp.files.length)) finish(null); window.removeEventListener('focus', onFocus) }, 600) }
      window.addEventListener('focus', onFocus)
      document.body.appendChild(inp)
      inp.click()
    })
  }

  // Show the Take-Photo / Choose-File chooser (mobile). Desktop → direct picker.
  function chooseOne({ accept = 'image/*', allowPdf = false, prompt = 'Add photo' } = {}) {
    const fileAccept = allowPdf ? accept + ',application/pdf,.pdf' : accept
    if (!isMobile()) return grabFile({ accept: fileAccept, capture: false })

    return new Promise((resolve) => {
      const ov = document.createElement('div')
      ov.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:flex-end;justify-content:center;font-family:inherit'
      ov.innerHTML =
        '<div style="background:#fff;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:18px 16px;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));animation:spsSheetUp .2s ease">' +
        '<div style="font-size:15px;font-weight:800;text-align:center;margin-bottom:3px;color:#1a1a1a">' + esc(prompt) + '</div>' +
        '<div style="font-size:12px;color:#8a8a8a;text-align:center;margin-bottom:15px">Take a new photo or choose an existing file</div>' +
        '<button data-a="cam" style="width:100%;padding:15px;border:none;border-radius:12px;background:#4F46E5;color:#fff;font-size:15px;font-weight:700;margin-bottom:10px;font-family:inherit;cursor:pointer">📷&nbsp; Take Photo</button>' +
        '<button data-a="file" style="width:100%;padding:15px;border:1.5px solid #e0e0e0;border-radius:12px;background:#fff;color:#333;font-size:15px;font-weight:700;margin-bottom:10px;font-family:inherit;cursor:pointer">🖼️&nbsp; Choose File</button>' +
        '<button data-a="cancel" style="width:100%;padding:13px;border:none;border-radius:12px;background:transparent;color:#999;font-size:14px;font-family:inherit;cursor:pointer">Cancel</button>' +
        '</div>'
      if (!document.getElementById('sps-sheet-anim')) {
        const st = document.createElement('style'); st.id = 'sps-sheet-anim'
        st.textContent = '@keyframes spsSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}'
        document.head.appendChild(st)
      }
      const cleanup = () => ov.remove()
      ov.addEventListener('click', async (e) => {
        const btn = e.target.closest && e.target.closest('[data-a]')
        const a = btn && btn.getAttribute('data-a')
        if (!a) { if (e.target === ov) { cleanup(); resolve(null) } return }
        if (a === 'cancel') { cleanup(); resolve(null); return }
        cleanup()
        const f = await grabFile({ accept: fileAccept, capture: a === 'cam' })
        resolve(f)
      })
      document.body.appendChild(ov)
    })
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); res(img) }
      img.onerror = (e) => { URL.revokeObjectURL(url); rej(e) }
      img.src = url
    })
  }

  // Merge multiple images into ONE JPEG File, stacked vertically on a canvas.
  async function mergeImages(files, { name = 'document.jpg', quality = 0.9, bg = '#ffffff' } = {}) {
    const imgs = await Promise.all(files.map(loadImage))
    const w = Math.max(...imgs.map((i) => i.naturalWidth || i.width)) || 1000
    const gap = Math.round(w * 0.02)
    const scaled = imgs.map((i) => {
      const iw = i.naturalWidth || i.width, ih = i.naturalHeight || i.height
      return { img: i, h: Math.round(ih * (w / iw)) }
    })
    const totalH = scaled.reduce((s, x) => s + x.h, 0) + gap * (scaled.length - 1)
    const c = document.createElement('canvas')
    c.width = w; c.height = totalH
    const ctx = c.getContext('2d')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, totalH)
    let y = 0
    for (const s of scaled) { ctx.drawImage(s.img, 0, y, w, s.h); y += s.h + gap }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality))
    return new File([blob], name, { type: 'image/jpeg' })
  }

  // A small Yes/No sheet (mobile) or confirm() (desktop). Resolves boolean.
  function askYesNo({ prompt = '', yes = 'Yes', no = 'No' } = {}) {
    if (!isMobile()) return Promise.resolve(window.confirm(prompt))
    return new Promise((resolve) => {
      const ov = document.createElement('div')
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:flex-end;justify-content:center;font-family:inherit'
      ov.innerHTML =
        '<div style="background:#fff;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:18px 16px;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));animation:spsSheetUp .2s ease">' +
        '<div style="font-size:14.5px;font-weight:700;text-align:center;margin-bottom:15px;color:#1a1a1a;line-height:1.45">' + esc(prompt) + '</div>' +
        '<button data-a="yes" style="width:100%;padding:15px;border:none;border-radius:12px;background:#4F46E5;color:#fff;font-size:15px;font-weight:700;margin-bottom:10px;font-family:inherit;cursor:pointer">' + esc(yes) + '</button>' +
        '<button data-a="no" style="width:100%;padding:15px;border:1.5px solid #e0e0e0;border-radius:12px;background:#fff;color:#333;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer">' + esc(no) + '</button>' +
        '</div>'
      const cleanup = () => ov.remove()
      ov.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-a]')
        const a = btn && btn.getAttribute('data-a')
        if (!a) { if (e.target === ov) { cleanup(); resolve(false) } return }
        cleanup(); resolve(a === 'yes')
      })
      document.body.appendChild(ov)
    })
  }

  // High-level: acquire a document file for a given type. For types that CAN
  // have two sides (e.g. Aadhaar), the second side is OPTIONAL — a single page
  // showing both sides is fine. If two are captured they're merged into one file.
  // Compress an image file to at most ~maxKB by downscaling + re-encoding as
  // JPEG. Non-images (e.g. PDFs) are returned unchanged. Used before every
  // upload so photos and document scans stay small.
  async function compressImage(file, { maxKB = 100, maxDim = 1600 } = {}) {
    if (!file || !/^image\//.test(file.type)) return file
    let img
    try { img = await loadImage(file) } catch (_) { return file }
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
    if (!w || !h) return file
    if (Math.max(w, h) > maxDim) { const r = maxDim / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r) }
    const canvas = document.createElement('canvas')
    const draw = (cw, ch) => {
      canvas.width = cw; canvas.height = ch
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch)
      ctx.drawImage(img, 0, 0, cw, ch)
    }
    const toBlob = q => new Promise(res => canvas.toBlob(res, 'image/jpeg', q))
    const target = maxKB * 1024
    const mkFile = blob => new File([blob], (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
    let cw = w, ch = h
    for (let attempt = 0; attempt < 6; attempt++) {
      draw(cw, ch)
      let q = 0.9, blob = await toBlob(q)
      while (blob && blob.size > target && q > 0.4) { q -= 0.1; blob = await toBlob(q) }
      if (blob && blob.size <= target) return mkFile(blob)
      cw = Math.round(cw * 0.82); ch = Math.round(ch * 0.82)   // still too big → shrink and retry
      if (cw < 240 || ch < 240) { draw(cw, ch); const b = await toBlob(0.5); return b ? mkFile(b) : file }
    }
    draw(cw, ch); const b = await toBlob(0.5); return b ? mkFile(b) : file
  }

  async function acquireDocument(type) {
    const _wrap = async (r) => { return r }
    const pages = MULTI[type]
    if (pages) {
      const first = await chooseOne({ accept: 'image/*', prompt: (type || 'Document') + ' — photo' })
      if (!first) return null // cancelled
      if (!/^image\//.test(first.type)) {
        // A PDF/non-image for an Aadhaar-type: just use it as-is (can't merge).
        return { file: first, pages: 1, merged: false }
      }
      const addBack = await askYesNo({
        prompt: 'Does the ' + (type || 'card') + ' have a separate back side to add?\n\nIf both sides are on one page, choose "Just this page".',
        yes: '+ Add back side',
        no: 'Just this page',
      })
      if (!addBack) return await _wrap({ file: first, pages: 1, merged: false })
      const back = await chooseOne({ accept: 'image/*', prompt: (type || 'Document') + ' — back side' })
      if (!back) return await _wrap({ file: first, pages: 1, merged: false }) // they skipped the back
      if (!/^image\//.test(back.type)) { alert('The back side must be an image so it can be combined. Keeping the first page only.'); return await _wrap({ file: first, pages: 1, merged: false }) }
      const merged = await mergeImages([first, back], { name: String(type).replace(/\s+/g, '_') + '.jpg' })
      return await _wrap({ file: merged, pages: 2, merged: true })
    }
    const f = await chooseOne({ accept: 'image/*', allowPdf: true, prompt: type || 'Upload document' })
    if (!f) return null
    return await _wrap({ file: f, pages: 1, merged: false })
  }

  // ── Circular photo cropper ────────────────────────────────────────────────
  // Shows a framing screen: drag to pan, pinch / slider / wheel to zoom, with a
  // circular guide. Exports a square JPEG of the framed area (displayed circular
  // by the round avatar containers). Resolves the cropped File, or null if
  // cancelled. Falls back to the original file if the image can't be loaded.
  function cropCircle(file, { outputSize = 512, title = 'Frame the photo' } = {}) {
    return new Promise(async (resolve) => {
      let img
      try { img = await loadImage(file) } catch (e) { resolve(file); return }
      const V = Math.min(320, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.78))
      const ov = document.createElement('div')
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:inherit;padding:20px;box-sizing:border-box'
      ov.innerHTML =
        '<div style="color:#fff;font-size:15px;font-weight:700;margin-bottom:5px">' + esc(title) + '</div>' +
        '<div style="color:#aaa;font-size:12px;margin-bottom:16px;text-align:center">Drag to move · pinch or use the slider to zoom</div>' +
        '<div id="spsCropArea" style="position:relative;width:' + V + 'px;height:' + V + 'px;touch-action:none;cursor:grab">' +
          '<canvas id="spsCropCanvas" width="' + V + '" height="' + V + '" style="width:' + V + 'px;height:' + V + 'px;display:block;border-radius:8px;background:#000"></canvas>' +
          '<div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none;border:2px solid rgba(255,255,255,.9)"></div>' +
        '</div>' +
        '<input id="spsCropZoom" type="range" min="1" max="4" step="0.01" value="1" style="width:' + V + 'px;max-width:80vw;margin:20px 0 6px;accent-color:#4F46E5">' +
        '<div style="display:flex;gap:12px;margin-top:10px">' +
          '<button id="spsCropCancel" style="padding:12px 22px;border:1.5px solid #555;border-radius:12px;background:transparent;color:#eee;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer">Cancel</button>' +
          '<button id="spsCropOk" style="padding:12px 26px;border:none;border-radius:12px;background:#4F46E5;color:#fff;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer">Use Photo</button>' +
        '</div>'
      document.body.appendChild(ov)

      const canvas = ov.querySelector('#spsCropCanvas')
      const ctx = canvas.getContext('2d')
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
      const baseScale = V / Math.min(iw, ih)  // "cover" the viewport
      let zoom = 1
      let ox = (V - iw * baseScale) / 2
      let oy = (V - ih * baseScale) / 2

      function clamp() {
        const s = baseScale * zoom, dw = iw * s, dh = ih * s
        ox = Math.min(0, Math.max(V - dw, ox))
        oy = Math.min(0, Math.max(V - dh, oy))
      }
      function draw() {
        const s = baseScale * zoom
        ctx.clearRect(0, 0, V, V)
        ctx.drawImage(img, ox, oy, iw * s, ih * s)
      }
      clamp(); draw()

      const zoomSlider = ov.querySelector('#spsCropZoom')
      function setZoom(nz) {
        nz = Math.max(1, Math.min(4, nz))
        const s0 = baseScale * zoom, s1 = baseScale * nz
        const cx = (V / 2 - ox) / s0, cy = (V / 2 - oy) / s0   // keep centre anchored
        ox = V / 2 - cx * s1; oy = V / 2 - cy * s1
        zoom = nz; clamp(); draw()
      }
      zoomSlider.addEventListener('input', () => setZoom(parseFloat(zoomSlider.value)))

      const area = ov.querySelector('#spsCropArea')
      let dragging = false, lastX = 0, lastY = 0
      const pointers = new Map()
      let pinchStartDist = 0, pinchStartZoom = 1
      area.addEventListener('pointerdown', (e) => {
        area.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.size === 1) { dragging = true; lastX = e.clientX; lastY = e.clientY; area.style.cursor = 'grabbing' }
        else if (pointers.size === 2) { dragging = false; const p = [...pointers.values()]; pinchStartDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); pinchStartZoom = zoom }
      })
      area.addEventListener('pointermove', (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.size === 2) { const p = [...pointers.values()]; const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); if (pinchStartDist > 0) { setZoom(pinchStartZoom * d / pinchStartDist); zoomSlider.value = zoom } return }
        if (!dragging) return
        ox += e.clientX - lastX; oy += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; clamp(); draw()
      })
      const endP = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStartDist = 0; if (pointers.size === 0) { dragging = false; area.style.cursor = 'grab' } }
      area.addEventListener('pointerup', endP); area.addEventListener('pointercancel', endP)
      area.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 0.92)); zoomSlider.value = zoom }, { passive: false })

      const cleanup = () => ov.remove()
      ov.querySelector('#spsCropCancel').onclick = () => { cleanup(); resolve(null) }
      ov.querySelector('#spsCropOk').onclick = () => {
        const out = document.createElement('canvas'); out.width = outputSize; out.height = outputSize
        const octx = out.getContext('2d')
        octx.fillStyle = '#fff'; octx.fillRect(0, 0, outputSize, outputSize)
        const r = outputSize / V, s = baseScale * zoom
        octx.drawImage(img, ox * r, oy * r, iw * s * r, ih * s * r)
        out.toBlob((blob) => { cleanup(); resolve(new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '_cropped.jpg', { type: 'image/jpeg' })) }, 'image/jpeg', 0.92)
      }
    })
  }

  // High-level: acquire a single profile photo, then frame it in the cropper.
  async function acquirePhoto(prompt = 'Profile photo') {
    const f = await chooseOne({ accept: 'image/*', prompt })
    if (!f) return null
    if (!/^image\//.test(f.type)) return f            // safety: non-image, skip crop
    const cropped = await cropCircle(f, { title: 'Frame the photo' })
    if (!cropped) return null                          // null = cancelled the crop
    return await compressImage(cropped, { maxKB: 100 })
  }

  // Small helper to make a preview object URL (caller should revoke when done).
  function previewURL(file) { try { return URL.createObjectURL(file) } catch (_) { return '' } }

  function needsMultiple(type) { return !!MULTI[type] }

  return { isMobile, chooseOne, mergeImages, compressImage, acquireDocument, acquirePhoto, cropCircle, previewURL, needsMultiple, MULTI }
})()
