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

  // ── Styles ───────────────────────────────────────────────────────────────
  var css = document.createElement('style')
  css.textContent = [
    '#aiFab{position:fixed;bottom:22px;right:22px;width:54px;height:54px;border-radius:50%;',
    'background:var(--indigo,var(--grn,#5B4FE8));color:#fff;border:none;cursor:pointer;z-index:800;',
    'box-shadow:0 10px 28px -8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;',
    'transition:transform .15s}',
    '#aiFab:hover{transform:scale(1.06)}#aiFab svg{width:24px;height:24px;stroke:#fff;fill:none;stroke-width:1.9}',
    '#aiPanel{position:fixed;bottom:88px;right:22px;width:390px;max-width:calc(100vw - 32px);height:560px;',
    'max-height:calc(100vh - 130px);background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:18px;',
    'box-shadow:0 24px 60px rgba(0,0,0,.22);z-index:801;display:none;flex-direction:column;overflow:hidden}',
    '#aiPanel.open{display:flex;animation:aiUp .2s ease}',
    '@keyframes aiUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
    '#aiHead{padding:14px 16px;border-bottom:1px solid var(--line,#eee);display:flex;align-items:center;gap:10px;flex-shrink:0}',
    '#aiHead .t{font-family:var(--font,sans-serif);font-size:14px;font-weight:800;color:var(--ink,#222)}',
    '#aiHead .s{font-size:10.5px;color:var(--ink-faint,#999)}',
    '#aiHead button{margin-left:auto;background:none;border:none;cursor:pointer;color:var(--ink-faint,#999);font-size:22px;line-height:1}',
    '#aiBody{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--lav-50,#fafafa)}',
    '.ai-msg{font-family:var(--font,sans-serif);font-size:13.5px;line-height:1.6;padding:10px 13px;border-radius:14px;max-width:88%;white-space:pre-wrap;word-wrap:break-word}',
    '.ai-me{align-self:flex-end;background:var(--indigo,var(--grn,#5B4FE8));color:#fff;border-bottom-right-radius:5px}',
    '.ai-bot{align-self:flex-start;background:#fff;color:var(--ink,#222);border:1px solid var(--line,#eee);border-bottom-left-radius:5px}',
    '.ai-err{align-self:flex-start;background:#FDECEC;color:#B5122B;border:1px solid #F5C2C2;font-size:12.5px}',
    '.ai-confirm{align-self:flex-start;background:#FFF8E6;border:1.5px solid var(--warn,#E8A23D);border-radius:14px;padding:13px;max-width:92%}',
    '.ai-confirm .h{font-family:var(--font,sans-serif);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#8A5A00;margin-bottom:6px}',
    '.ai-confirm .d{font-family:var(--font,sans-serif);font-size:13px;color:var(--ink,#222);line-height:1.55;margin-bottom:11px}',
    '.ai-confirm button{font-family:var(--font,sans-serif);font-size:12px;font-weight:700;padding:7px 14px;border-radius:8px;border:none;cursor:pointer;margin-right:8px}',
    '.ai-ok{background:var(--indigo,var(--grn,#5B4FE8));color:#fff}.ai-no{background:#fff;border:1px solid var(--line,#ddd)!important;color:var(--ink-soft,#666)}',
    '#aiFoot{padding:12px;border-top:1px solid var(--line,#eee);display:flex;gap:8px;flex-shrink:0;background:#fff}',
    '#aiInput{flex:1;font-family:var(--font,sans-serif);font-size:13.5px;padding:10px 13px;border:1.5px solid var(--line,#ddd);',
    'border-radius:10px;outline:none;resize:none;max-height:90px;min-height:40px}',
    '#aiInput:focus{border-color:var(--indigo,var(--grn,#5B4FE8))}',
    '#aiSend{background:var(--indigo,var(--grn,#5B4FE8));color:#fff;border:none;border-radius:10px;width:40px;cursor:pointer;flex-shrink:0}',
    '#aiSend:disabled{opacity:.45;cursor:default}#aiSend svg{width:17px;height:17px;stroke:#fff;fill:none;stroke-width:2}',
    '.ai-dots{align-self:flex-start;display:flex;gap:4px;padding:12px 14px}',
    '.ai-dots i{width:6px;height:6px;border-radius:50%;background:var(--ink-faint,#bbb);animation:aiBl 1.2s infinite}',
    '.ai-dots i:nth-child(2){animation-delay:.2s}.ai-dots i:nth-child(3){animation-delay:.4s}',
    '@keyframes aiBl{0%,60%,100%{opacity:.25}30%{opacity:1}}',
    '.ai-chip{font-family:var(--font,sans-serif);font-size:11.5px;padding:6px 11px;border-radius:999px;border:1px solid var(--line,#ddd);',
    'background:#fff;color:var(--ink-soft,#555);cursor:pointer;margin:0 6px 6px 0}',
    '.ai-chip:hover{border-color:var(--indigo,var(--grn,#5B4FE8));color:var(--indigo,var(--grn,#5B4FE8))}',
    '@media(max-width:560px){#aiPanel{right:8px;left:8px;width:auto;bottom:80px;height:min(70vh,520px)}#aiFab{bottom:16px;right:16px}}'
  ].join('')
  document.head.appendChild(css)

  // ── Markup ───────────────────────────────────────────────────────────────
  var fab = document.createElement('button')
  fab.id = 'aiFab'
  fab.title = 'Ask the assistant'
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="8.5" cy="10" r="1" fill="#fff" stroke="none"/><circle cx="12" cy="10" r="1" fill="#fff" stroke="none"/><circle cx="15.5" cy="10" r="1" fill="#fff" stroke="none"/></svg>'

  var panel = document.createElement('div')
  panel.id = 'aiPanel'
  panel.innerHTML =
    '<div id="aiHead"><div><div class="t">Assistant</div><div class="s">Answers from your school data</div></div>' +
    '<button title="Close">&times;</button></div>' +
    '<div id="aiBody"></div>' +
    '<div id="aiFoot"><textarea id="aiInput" rows="1" placeholder="Ask something…"></textarea>' +
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
  function bubble (text, cls) {
    var d = document.createElement('div')
    d.className = 'ai-msg ' + cls
    d.textContent = text
    document.getElementById('aiBody').appendChild(d)
    scroll()
    return d
  }
  function scroll () { var b = document.getElementById('aiBody'); b.scrollTop = b.scrollHeight }

  function greet () {
    var b = document.getElementById('aiBody')
    var w = document.createElement('div')
    w.className = 'ai-msg ai-bot'
    w.textContent = 'Hello. Ask me about attendance, students, fees or staff records — or tell me to send a message.'
    b.appendChild(w)
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
    var d = document.createElement('div')
    d.className = 'ai-dots'
    d.innerHTML = '<i></i><i></i><i></i>'
    document.getElementById('aiBody').appendChild(d)
    scroll()
    return d
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
