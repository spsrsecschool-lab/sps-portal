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
  async function acquireDocument(type) {
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
      if (!addBack) return { file: first, pages: 1, merged: false }
      const back = await chooseOne({ accept: 'image/*', prompt: (type || 'Document') + ' — back side' })
      if (!back) return { file: first, pages: 1, merged: false } // they skipped the back
      if (!/^image\//.test(back.type)) { alert('The back side must be an image so it can be combined. Keeping the first page only.'); return { file: first, pages: 1, merged: false } }
      const merged = await mergeImages([first, back], { name: String(type).replace(/\s+/g, '_') + '.jpg' })
      return { file: merged, pages: 2, merged: true }
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
