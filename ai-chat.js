/* ═══════════════════════════════════════════════════════════════════════════
   SPS AI Assistant — client widget
   Include AFTER auth.js:   <script src="ai-chat.js"></script>

   Deliberately self-contained: injects its own CSS and markup so each portal
   only needs the one script tag. Colours come from the host page's CSS
   variables, so it themes itself per portal automatically.

   No API keys here. It calls the `ai-assistant` Edge Function with the user's
   Supabase JWT; identity and permissions are decided server-side.
   ═══════════════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  var HISTORY = []          // conversation turns sent back for context
  var PENDING = null        // action awaiting the user's confirmation
  var BUSY = false

  var BOT_NAME = 'Sakha'

  // Owl mascot. Uses currentColor for the body so it themes to each portal,
  // with fixed cream face + amber beak. Wrapped so we can drop it in at any size.
  function owl (size, onDark) {
    var faceStroke = onDark ? 'rgba(255,255,255,.9)' : 'currentColor'
    return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" fill="none" style="display:block">' +
      // ear tufts
      '<path d="M14 12 L17 5 L20 13 Z" fill="currentColor"/>' +
      '<path d="M34 12 L31 5 L28 13 Z" fill="currentColor"/>' +
      // body
      '<path d="M24 8 C33 8 39 15 39 25 C39 35 32 42 24 42 C16 42 9 35 9 25 C9 15 15 8 24 8 Z" fill="currentColor"/>' +
      // belly
      '<ellipse cx="24" cy="30" rx="8.5" ry="9" fill="' + (onDark ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.85)') + '"/>' +
      // eye discs
      '<circle cx="18" cy="21" r="7" fill="#FFF7E8"/>' +
      '<circle cx="30" cy="21" r="7" fill="#FFF7E8"/>' +
      // pupils
      '<circle cx="18.7" cy="21" r="3.2" fill="#2A2A3A"/>' +
      '<circle cx="29.3" cy="21" r="3.2" fill="#2A2A3A"/>' +
      '<circle cx="19.8" cy="19.9" r="1" fill="#fff"/>' +
      '<circle cx="30.4" cy="19.9" r="1" fill="#fff"/>' +
      // beak
      '<path d="M24 24 L21 27 L24 29 L27 27 Z" fill="#F5A623"/>' +
      // little feet
      '<path d="M20 41 l-1.5 3 M22 41.5 l0 3 M28 41 l1.5 3 M26 41.5 l0 3" stroke="#F5A623" stroke-width="1.4" stroke-linecap="round"/>' +
      '</svg>'
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  var css = document.createElement('style')
  css.textContent = [
    '#aiFab{position:fixed;bottom:22px;right:22px;width:60px;height:60px;border-radius:50%;',
    'background:linear-gradient(145deg,var(--indigo,var(--grn,#5B4FE8)),var(--indigo-dark,var(--grn-dark,#4A3FD6)));color:#fff;border:none;cursor:pointer;z-index:800;',
    'box-shadow:0 12px 30px -8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;',
    'transition:transform .18s,box-shadow .18s;padding:0}',
    '#aiFab:hover{transform:scale(1.08) rotate(-4deg)}',
    '#aiFab .owl{width:34px;height:34px;color:#fff}',
    '#aiFab::after{content:"";position:absolute;top:12px;right:12px;width:10px;height:10px;border-radius:50%;background:#3ED598;border:2px solid #fff;box-shadow:0 0 0 rgba(62,213,152,.6);animation:aiPulse 2.4s infinite}',
    '@keyframes aiPulse{0%{box-shadow:0 0 0 0 rgba(62,213,152,.5)}70%{box-shadow:0 0 0 7px rgba(62,213,152,0)}100%{box-shadow:0 0 0 0 rgba(62,213,152,0)}}',
    '#aiPanel{position:fixed;bottom:94px;right:22px;width:398px;max-width:calc(100vw - 32px);height:576px;',
    'max-height:calc(100vh - 130px);background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:20px;',
    'box-shadow:0 24px 60px rgba(0,0,0,.24);z-index:801;display:none;flex-direction:column;overflow:hidden}',
    '#aiPanel.open{display:flex;animation:aiUp .22s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes aiUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '#aiHead{padding:14px 16px;display:flex;align-items:center;gap:11px;flex-shrink:0;',
    'background:linear-gradient(135deg,var(--indigo,var(--grn,#5B4FE8)),var(--indigo-dark,var(--grn-dark,#4A3FD6)));color:#fff}',
    '#aiHead .av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#aiHead .av .owl{width:30px;height:30px;color:#fff}',
    '#aiHead .t{font-family:var(--font,sans-serif);font-size:15px;font-weight:800;color:#fff;line-height:1.15;display:flex;align-items:center;gap:7px}',
    '#aiHead .s{font-size:10.5px;color:rgba(255,255,255,.8);display:flex;align-items:center;gap:5px;margin-top:1px}',
    '#aiHead .s::before{content:"";width:6px;height:6px;border-radius:50%;background:#3ED598;display:inline-block}',
    '#aiHead button{margin-left:auto;background:rgba(255,255,255,.15);border:none;cursor:pointer;color:#fff;font-size:18px;line-height:1;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center}',
    '#aiHead button:hover{background:rgba(255,255,255,.28)}',
    '#aiBody{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--lav-50,#f7f7fb)}',
    '.ai-row{display:flex;gap:8px;align-items:flex-end;max-width:90%}',
    '.ai-row.me{align-self:flex-end;flex-direction:row-reverse;max-width:88%}',
    '.ai-av{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;',
    'background:linear-gradient(145deg,var(--indigo,var(--grn,#5B4FE8)),var(--indigo-dark,var(--grn-dark,#4A3FD6)))}',
    '.ai-av .owl{width:20px;height:20px;color:#fff}',
    '.ai-msg{font-family:var(--font,sans-serif);font-size:13.5px;line-height:1.6;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}',
    '.ai-me{background:var(--indigo,var(--grn,#5B4FE8));color:#fff;border-bottom-right-radius:5px}',
    '.ai-bot{background:#fff;color:var(--ink,#222);border:1px solid var(--line,#eee);border-bottom-left-radius:5px}',
    '.ai-err{background:#FDECEC;color:#B5122B;border:1px solid #F5C2C2;font-size:12.5px;border-radius:14px;padding:10px 13px}',
    '.ai-confirm{align-self:flex-start;background:#FFF8E6;border:1.5px solid var(--warn,#E8A23D);border-radius:14px;padding:13px;max-width:92%}',
    '.ai-confirm .h{font-family:var(--font,sans-serif);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#8A5A00;margin-bottom:6px}',
    '.ai-confirm .d{font-family:var(--font,sans-serif);font-size:13px;color:var(--ink,#222);line-height:1.55;margin-bottom:11px}',
    '.ai-confirm button{font-family:var(--font,sans-serif);font-size:12px;font-weight:700;padding:7px 14px;border-radius:8px;border:none;cursor:pointer;margin-right:8px}',
    '.ai-ok{background:var(--indigo,var(--grn,#5B4FE8));color:#fff}.ai-no{background:#fff;border:1px solid var(--line,#ddd)!important;color:var(--ink-soft,#666)}',
    '#aiFoot{padding:12px;border-top:1px solid var(--line,#eee);display:flex;gap:8px;flex-shrink:0;background:#fff}',
    '#aiInput{flex:1;font-family:var(--font,sans-serif);font-size:13.5px;padding:10px 13px;border:1.5px solid var(--line,#ddd);',
    'border-radius:12px;outline:none;resize:none;max-height:90px;min-height:42px}',
    '#aiInput:focus{border-color:var(--indigo,var(--grn,#5B4FE8))}',
    '#aiSend{background:linear-gradient(145deg,var(--indigo,var(--grn,#5B4FE8)),var(--indigo-dark,var(--grn-dark,#4A3FD6)));color:#fff;border:none;border-radius:12px;width:44px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}',
    '#aiSend:disabled{opacity:.45;cursor:default}#aiSend svg{width:17px;height:17px;stroke:#fff;fill:none;stroke-width:2}',
    '.ai-dots{display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid var(--line,#eee);border-radius:16px;border-bottom-left-radius:5px}',
    '.ai-dots i{width:6px;height:6px;border-radius:50%;background:var(--ink-faint,#bbb);animation:aiBl 1.2s infinite}',
    '.ai-dots i:nth-child(2){animation-delay:.2s}.ai-dots i:nth-child(3){animation-delay:.4s}',
    '@keyframes aiBl{0%,60%,100%{opacity:.25}30%{opacity:1}}',
    '.ai-chip{font-family:var(--font,sans-serif);font-size:11.5px;padding:7px 12px;border-radius:999px;border:1px solid var(--line,#ddd);',
    'background:#fff;color:var(--ink-soft,#555);cursor:pointer;margin:0 6px 6px 0;transition:all .12s}',
    '.ai-chip:hover{border-color:var(--indigo,var(--grn,#5B4FE8));color:var(--indigo,var(--grn,#5B4FE8));transform:translateY(-1px)}',
    '@media(max-width:560px){#aiPanel{right:8px;left:8px;width:auto;bottom:84px;height:min(72vh,540px)}#aiFab{bottom:16px;right:16px}}'
  ].join('')
  document.head.appendChild(css)

  // ── Markup ───────────────────────────────────────────────────────────────
  var fab = document.createElement('button')
  fab.id = 'aiFab'
  fab.title = 'Ask ' + BOT_NAME
  fab.innerHTML = '<span class="owl">' + owl(34, true) + '</span>'

  var panel = document.createElement('div')
  panel.id = 'aiPanel'
  panel.innerHTML =
    '<div id="aiHead">' +
      '<div class="av">' + owl(30, true) + '</div>' +
      '<div><div class="t">' + BOT_NAME + '</div><div class="s">Your school companion · online</div></div>' +
      '<button title="Close">&times;</button></div>' +
    '<div id="aiBody"></div>' +
    '<div id="aiFoot"><textarea id="aiInput" rows="1" placeholder="Ask ' + BOT_NAME + ' anything…"></textarea>' +
    '<button id="aiSend"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>'

  function mount () {
    document.body.appendChild(fab)
    document.body.appendChild(panel)
    panel.querySelector('#aiHead button').onclick = toggle
    fab.onclick = toggle
    document.getElementById('aiSend').onclick = send
    var inp = document.getElementById('aiInput')
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })
    inp.addEventListener('input', function () {
      inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 90) + 'px'
    })
    greet()
  }

  function toggle () {
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) setTimeout(function () { document.getElementById('aiInput').focus() }, 80)
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  // Bot messages get an owl avatar to their left; the user's sit plain on the
  // right. Errors and the "me" bubble skip the avatar.
  function bubble (text, cls) {
    var body = document.getElementById('aiBody')
    var msg = document.createElement('div')
    msg.className = 'ai-msg ' + cls
    msg.textContent = text
    if (cls === 'ai-bot') {
      var row = document.createElement('div')
      row.className = 'ai-row'
      var av = document.createElement('div')
      av.className = 'ai-av'
      av.innerHTML = owl(20, true)
      row.appendChild(av); row.appendChild(msg)
      body.appendChild(row)
    } else if (cls === 'ai-me') {
      var r2 = document.createElement('div')
      r2.className = 'ai-row me'
      r2.appendChild(msg)
      body.appendChild(r2)
    } else {
      body.appendChild(msg)
    }
    scroll()
    return msg
  }
  function scroll () { var b = document.getElementById('aiBody'); b.scrollTop = b.scrollHeight }

  function greet () {
    var b = document.getElementById('aiBody')
    var row = document.createElement('div')
    row.className = 'ai-row'
    var av = document.createElement('div'); av.className = 'ai-av'; av.innerHTML = owl(20, true)
    var w = document.createElement('div')
    w.className = 'ai-msg ai-bot'
    w.textContent = "Hi, I'm " + BOT_NAME + " \uD83E\uDD89 — your school companion. Ask me about attendance, students, fees or staff, or tell me to send a message."
    row.appendChild(av); row.appendChild(w)
    b.appendChild(row)
    var chips = document.createElement('div')
    chips.style.cssText = 'display:flex;flex-wrap:wrap;margin-top:2px'
    var suggestions = ['Who was absent today?', 'How many students do we have?', 'My attendance this month']
    suggestions.forEach(function (s) {
      var c = document.createElement('button')
      c.className = 'ai-chip'; c.textContent = s
      c.onclick = function () { document.getElementById('aiInput').value = s; send() }
      chips.appendChild(c)
    })
    b.appendChild(chips)
  }

  function thinking () {
    var row = document.createElement('div')
    row.className = 'ai-row'
    var av = document.createElement('div'); av.className = 'ai-av'; av.innerHTML = owl(20, true)
    var d = document.createElement('div')
    d.className = 'ai-dots'
    d.innerHTML = '<i></i><i></i><i></i>'
    row.appendChild(av); row.appendChild(d)
    document.getElementById('aiBody').appendChild(row)
    scroll()
    return row
  }

  function askConfirm (conf) {
    PENDING = conf
    var d = document.createElement('div')
    d.className = 'ai-confirm'
    d.innerHTML = '<div class="h">Confirm this action</div><div class="d"></div>' +
      '<button class="ai-ok">Yes, do it</button><button class="ai-no">Cancel</button>'
    d.querySelector('.d').textContent = conf.summary || 'Perform this action?'
    d.querySelector('.ai-ok').onclick = function () { d.remove(); runConfirmed() }
    d.querySelector('.ai-no').onclick = function () {
      d.remove(); PENDING = null; bubble('Cancelled — nothing was changed.', 'ai-bot')
    }
    document.getElementById('aiBody').appendChild(d)
    scroll()
  }

  // ── Network ──────────────────────────────────────────────────────────────
  function endpoint () {
    // SUPABASE_URL comes from config.js, which every portal already loads.
    var base = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) || ''
    return base.replace(/\/$/, '') + '/functions/v1/ai-assistant'
  }

  async function callFn (payload) {
    var client = window.sb
    if (!client) throw new Error('Not connected.')
    var sess = (await client.auth.getSession()).data.session
    if (!sess) throw new Error('Your session expired — please sign in again.')
    var res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.access_token },
      body: JSON.stringify(payload)
    })
    var data = await res.json()
    if (!res.ok) {
      // 429 is a quota pause, not a failure — word it so the user knows to wait
      // rather than assuming the assistant is broken.
      if (res.status === 429) {
        throw new Error(data.error || 'Too many requests just now — give it a minute and ask again.')
      }
      throw new Error(data.error || 'Request failed.')
    }
    return data
  }

  async function send () {
    if (BUSY) return
    var inp = document.getElementById('aiInput')
    var text = inp.value.trim()
    if (!text) return
    inp.value = ''; inp.style.height = 'auto'
    bubble(text, 'ai-me')
    BUSY = true; document.getElementById('aiSend').disabled = true
    var dots = thinking()
    try {
      var data = await callFn({ message: text, history: HISTORY })
      dots.remove()
      if (data.history) HISTORY = data.history
      if (data.reply) bubble(data.reply, 'ai-bot')
      if (data.needsConfirmation) askConfirm(data.needsConfirmation)
    } catch (e) {
      dots.remove()
      bubble(e.message, 'ai-err')
    } finally {
      BUSY = false; document.getElementById('aiSend').disabled = false
    }
  }

  async function runConfirmed () {
    if (!PENDING) return
    var action = PENDING; PENDING = null
    BUSY = true; document.getElementById('aiSend').disabled = true
    var dots = thinking()
    try {
      var data = await callFn({ confirmedAction: action, history: HISTORY })
      dots.remove()
      bubble(data.reply || 'Done.', 'ai-bot')
    } catch (e) {
      dots.remove()
      bubble(e.message, 'ai-err')
    } finally {
      BUSY = false; document.getElementById('aiSend').disabled = false
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()
