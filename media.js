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

  // High-level: acquire a document file for a given type. If the type needs two
  // sides, collect both and merge into one file. Returns {file, pages} or null.
  async function acquireDocument(type) {
    const pages = MULTI[type]
    if (pages) {
      const collected = []
      for (const label of pages) {
        const f = await chooseOne({ accept: 'image/*', prompt: (type || 'Document') + ' — ' + label })
        if (!f) return null // cancelled
        if (!/^image\//.test(f.type)) { alert('For ' + type + ', please provide images for front and back so they can be combined into one file.'); return null }
        collected.push(f)
      }
      const merged = await mergeImages(collected, { name: String(type).replace(/\s+/g, '_') + '.jpg' })
      return { file: merged, pages: collected.length, merged: true }
    }
    const f = await chooseOne({ accept: 'image/*', allowPdf: true, prompt: type || 'Upload document' })
    if (!f) return null
    return { file: f, pages: 1, merged: false }
  }

  // High-level: acquire a single profile photo (with the mobile chooser).
  async function acquirePhoto(prompt = 'Profile photo') {
    return await chooseOne({ accept: 'image/*', prompt })
  }

  // Small helper to make a preview object URL (caller should revoke when done).
  function previewURL(file) { try { return URL.createObjectURL(file) } catch (_) { return '' } }

  function needsMultiple(type) { return !!MULTI[type] }

  return { isMobile, chooseOne, mergeImages, acquireDocument, acquirePhoto, previewURL, needsMultiple, MULTI }
})()
