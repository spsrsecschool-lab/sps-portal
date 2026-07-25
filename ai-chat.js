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

  // Small brown-owl avatar for message rows (static). Matches the perched owl's
  // palette so the character is consistent everywhere.
  function owl (size) {
    return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" fill="none" style="display:block">' +
      '<path d="M14 14 q-2 -5 2 -8 q2 3 2 7 Z" fill="#7A4526"/>' +
      '<path d="M34 14 q2 -5 -2 -8 q-2 3 -2 7 Z" fill="#7A4526"/>' +
      '<path d="M24 8 C33 8 39 16 39 26 C39 38 32 44 24 44 C16 44 9 38 9 26 C9 16 15 8 24 8 Z" fill="#9A5B33"/>' +
      '<ellipse cx="24" cy="30" rx="9" ry="10" fill="#D9A876"/>' +
      '<ellipse cx="24" cy="22" rx="13" ry="11" fill="#F2E4CE"/>' +
      '<circle cx="18" cy="22" r="6" fill="#fff"/><circle cx="30" cy="22" r="6" fill="#fff"/>' +
      '<circle cx="18.5" cy="22" r="3.4" fill="#3A2416"/><circle cx="29.5" cy="22" r="3.4" fill="#3A2416"/>' +
      '<circle cx="19.6" cy="20.8" r="1.1" fill="#fff"/><circle cx="30.6" cy="20.8" r="1.1" fill="#fff"/>' +
      '<g fill="none" stroke="#2A2A2A" stroke-width="1.4"><circle cx="18" cy="22" r="7"/><circle cx="30" cy="22" r="7"/></g>' +
      '<path d="M24 25 L21 28 L24 31 L27 28 Z" fill="#E8912B"/>' +
      '<path d="M20 43 l-1.5 3 M28 43 l1.5 3" stroke="#E8912B" stroke-width="1.6" stroke-linecap="round"/>' +
      '</svg>'
  }

  // The full animated perched owl (brown, glasses) that sits on the card's top
  // edge and reacts to conversation state. Returned as an HTML string.
  function perchedOwl () {
    return '<svg viewBox="0 0 84 100" xmlns="http://www.w3.org/2000/svg">' +
      '<text class="zzz z1" x="62" y="24" font-size="11" fill="#7A4526">z</text>' +
      '<text class="zzz z2" x="68" y="16" font-size="9" fill="#7A4526">z</text>' +
      '<text class="zzz z3" x="73" y="10" font-size="7" fill="#7A4526">z</text>' +
      '<g class="owl-body-grp">' +
        '<g fill="#E8912B">' +
          '<path d="M34 88 q-4 4 -6 8 q3 1 5 -1 q0 3 2 4 q2 -2 2 -5 q2 2 4 1 q-2 -4 -5 -7 Z"/>' +
          '<path d="M50 88 q4 4 6 8 q-3 1 -5 -1 q0 3 -2 4 q-2 -2 -2 -5 q-2 2 -4 1 q2 -4 5 -7 Z"/>' +
        '</g>' +
        '<path d="M36 78 q6 10 12 0 Z" fill="#7A4526"/>' +
        '<path class="wing wing-l" d="M17 46 q-7 8 -3 26 q6 3 10 -2 q-5 -12 -3 -22 Z" fill="#7A4526"/>' +
        '<path class="wing wing-r" d="M67 46 q7 8 3 26 q-6 3 -10 -2 q5 -12 3 -22 Z" fill="#7A4526"/>' +
        '<g class="head-grp">' +
          '<path d="M24 26 q-3 -8 3 -12 q3 4 3 11 Z" fill="#7A4526"/>' +
          '<path d="M60 26 q3 -8 -3 -12 q-3 4 -3 11 Z" fill="#7A4526"/>' +
          '<path d="M42 16 C58 16 66 28 66 46 C66 68 56 84 42 84 C28 84 18 68 18 46 C18 28 26 16 42 16 Z" fill="#9A5B33"/>' +
          '<path d="M42 16 C30 16 22 26 20 42 C24 34 32 30 42 30 Z" fill="#C08552" opacity=".55"/>' +
          '<path d="M42 40 C53 40 58 52 58 62 C58 74 50 82 42 82 C34 82 26 74 26 62 C26 52 31 40 42 40 Z" fill="#D9A876"/>' +
          '<g stroke="#C08552" stroke-width="1" fill="none" opacity=".6">' +
            '<path d="M34 54 q4 4 8 0 M42 54 q4 4 8 0"/>' +
            '<path d="M31 62 q5 5 11 0 M42 62 q5 5 11 0"/>' +
            '<path d="M34 70 q4 4 8 0 M42 70 q4 4 8 0"/>' +
          '</g>' +
          '<ellipse cx="42" cy="40" rx="24" ry="20" fill="#F2E4CE"/>' +
          '<path d="M42 22 a24 20 0 0 0 -24 18 q0 -20 24 -20 Z" fill="#fff" opacity=".4"/>' +
          '<circle cx="31" cy="40" r="11" fill="#fff"/>' +
          '<circle cx="53" cy="40" r="11" fill="#fff"/>' +
          '<g class="pupil">' +
            '<circle cx="32" cy="40" r="6.5" fill="#3A2416"/>' +
            '<circle cx="52" cy="40" r="6.5" fill="#3A2416"/>' +
            '<circle cx="34" cy="37.6" r="2.1" fill="#fff"/>' +
            '<circle cx="54" cy="37.6" r="2.1" fill="#fff"/>' +
          '</g>' +
          '<g class="lids">' +
            '<path class="lid" d="M20 40 a11 11 0 0 1 22 0 v2 h-22 Z" fill="#9A5B33"/>' +
            '<path class="lid" d="M42 40 a11 11 0 0 1 22 0 v2 h-22 Z" fill="#9A5B33"/>' +
          '</g>' +
          '<g class="lids">' +
            '<path class="lid" d="M23 42 h16 M45 42 h16" stroke="#7A4526" stroke-width="1.5" stroke-linecap="round"/>' +
          '</g>' +
          '<g class="glasses" fill="none" stroke="#2A2A2A" stroke-width="2.4">' +
            '<circle cx="31" cy="40" r="13"/>' +
            '<circle cx="53" cy="40" r="13"/>' +
            '<path d="M43.8 38 q0.2 -3 -2.6 -3 M40.2 38 q-0.2 -3 2.6 -3" stroke-width="2"/>' +
            '<path d="M18 40 q-4 0 -6 3" stroke-width="2"/>' +
            '<path d="M66 40 q4 0 6 3" stroke-width="2"/>' +
          '</g>' +
          '<path class="beak" d="M42 46 L37.5 50 L42 55 L46.5 50 Z" fill="#E8912B" stroke="#C9761B" stroke-width=".8" style="transform-origin:42px 50px"/>' +
        '</g>' +
      '</g>' +
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

    /* ── Outer panel: fixed position only, NOT clipped — this is what lets
       the perched owl extend above the card without being cut off. ── */
    '#aiPanel{position:fixed;bottom:94px;right:22px;width:398px;max-width:calc(100vw - 32px);height:576px;',
    'max-height:calc(100vh - 130px);z-index:801;display:none;flex-direction:column}',
    '#aiPanel.open{display:flex;animation:aiUp .22s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes aiUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',

    /* ── Inner card: this is what actually clips (rounded corners, scroll,
       shadow). The owl lives OUTSIDE this element so it's never clipped. ── */
    '#aiPanelInner{flex:1;min-height:0;display:flex;flex-direction:column;background:#fff;',
    'border:1px solid var(--line,#e5e5e5);border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.24);overflow:hidden}',

    '#aiHead{padding:14px 16px 14px 96px;display:flex;align-items:center;gap:11px;flex-shrink:0;position:relative;',
    'background:linear-gradient(135deg,var(--indigo,var(--grn,#5B4FE8)),var(--indigo-dark,var(--grn-dark,#4A3FD6)));color:#fff}',
    // perched owl sits straddling the panel's top-left, positioned relative to
    // #aiPanel (not #aiPanelInner) so overflow:hidden on the card never clips it
    '#aiOwl{position:absolute;left:10px;top:-46px;width:84px;height:100px;z-index:5;cursor:pointer;user-select:none}',
    '#aiOwl svg{width:100%;height:100%;overflow:visible;display:block;filter:drop-shadow(0 6px 8px rgba(0,0,0,.18))}',
    '.owl-body-grp{transform-origin:50% 80%;animation:owlBreathe 3.4s ease-in-out infinite}',
    '@keyframes owlBreathe{0%,100%{transform:scaleY(1) translateY(0)}50%{transform:scaleY(1.03) translateY(-1px)}}',
    '.lid{transition:transform .18s ease}',
    '.eyes-open .lid{transform:translateY(-16px)}',
    '.eyes-closed .lid{transform:translateY(0)}',
    '.pupil{transition:transform .3s ease}',
    '.look-up .pupil{transform:translateY(-1.6px)}',
    '.head-grp{transform-origin:50% 70%;transition:transform .35s cubic-bezier(.3,1.4,.5,1)}',
    '.tilt .head-grp{transform:rotate(-8deg)}',
    '.waking{animation:owlWake .6s cubic-bezier(.3,1.5,.5,1)}',
    '@keyframes owlWake{0%{transform:translateY(4px) scale(.96)}55%{transform:translateY(-8px) scale(1.05)}100%{transform:translateY(0) scale(1)}}',
    '.talking .head-grp{animation:owlBob .28s ease-in-out infinite}',
    '@keyframes owlBob{0%,100%{transform:translateY(0)}50%{transform:translateY(1.5px)}}',
    '.talking .beak{animation:owlFlap .28s ease-in-out infinite}',
    '@keyframes owlFlap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.5) translateY(1px)}}',
    '.wing{transform-origin:70% 40%;transition:transform .3s ease}',
    '.thinking .wing-r{animation:owlScratch 1s ease-in-out infinite}',
    '@keyframes owlScratch{0%,100%{transform:rotate(0)}50%{transform:rotate(-38deg) translate(-2px,-6px)}}',
    '.zzz{opacity:0;font-weight:800}',
    '.sleeping .zzz{animation:owlFloat 3s ease-in-out infinite}',
    '.sleeping .z2{animation-delay:1s}.sleeping .z3{animation-delay:2s}',
    '@keyframes owlFloat{0%{opacity:0;transform:translate(0,0) scale(.6)}30%{opacity:.9}100%{opacity:0;transform:translate(6px,-16px) scale(1.1)}}',
    '.awake-idle .owl-body-grp{animation:owlBreathe 3.4s ease-in-out infinite, owlSway 6s ease-in-out infinite}',
    '@keyframes owlSway{0%,100%{rotate:0deg}25%{rotate:2deg}75%{rotate:-2deg}}',
    '@media(prefers-reduced-motion:reduce){.owl-body-grp,.talking .head-grp,.talking .beak,.thinking .wing-r,.sleeping .zzz,.awake-idle .owl-body-grp{animation:none}}',
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
  fab.innerHTML = '<span class="owl">' + owl(34) + '</span>'

  var panel = document.createElement('div')
  panel.id = 'aiPanel'
  // #aiOwl is a direct child of #aiPanel (NOT #aiPanelInner) so it can perch
  // above the card without being clipped by the card's overflow:hidden.
  panel.innerHTML =
    '<div id="aiOwl" class="sleeping eyes-closed" title="' + BOT_NAME + '">' + perchedOwl() + '</div>' +
    '<div id="aiPanelInner">' +
      '<div id="aiHead">' +
        '<div style="margin-left:8px"><div class="t">' + BOT_NAME + '</div><div class="s">Your school companion</div></div>' +
        '<button title="Close">&times;</button></div>' +
      '<div id="aiBody"></div>' +
      '<div id="aiFoot"><textarea id="aiInput" rows="1" placeholder="Ask ' + BOT_NAME + ' anything…"></textarea>' +
      '<button id="aiSend"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>' +
    '</div>'

  // ── Owl state machine ────────────────────────────────────────────────────
  var OWL_STATES = ['sleeping','awake-idle','tilt','thinking','talking','eyes-open','eyes-closed','look-up','waking']
  var blinkTimer, idleTimer, talkTimer
  function owlEl () { return document.getElementById('aiOwl') }
  function owlClear () { var o = owlEl(); if (o) OWL_STATES.forEach(function (s) { o.classList.remove(s) }) }
  function owlSleep () { var o = owlEl(); if (!o) return; owlClear(); o.classList.add('sleeping','eyes-closed'); clearInterval(blinkTimer) }
  function owlWake () {
    var o = owlEl(); if (!o) return
    owlClear(); o.classList.add('waking','eyes-open','awake-idle')
    setTimeout(function () { o.classList.remove('waking') }, 600)
    owlStartBlink(); owlResetIdle()
  }
  function owlListen () { var o = owlEl(); if (!o) return; owlClear(); o.classList.add('eyes-open','tilt','awake-idle','look-up'); owlStartBlink(); owlResetIdle() }
  function owlThink () { var o = owlEl(); if (!o) return; owlClear(); o.classList.add('eyes-open','thinking','look-up'); clearInterval(blinkTimer) }
  function owlTalk () {
    var o = owlEl(); if (!o) return
    owlClear(); o.classList.add('eyes-open','talking','awake-idle'); owlStartBlink()
    clearTimeout(talkTimer); talkTimer = setTimeout(owlWake, 2600)
  }
  function owlBlinkOnce () {
    var o = owlEl(); if (!o || o.classList.contains('sleeping') || o.classList.contains('thinking')) return
    o.classList.remove('eyes-open'); o.classList.add('eyes-closed')
    setTimeout(function () { o.classList.remove('eyes-closed'); o.classList.add('eyes-open') }, 150)
  }
  function owlStartBlink () {
    clearInterval(blinkTimer)
    blinkTimer = setInterval(function () { if (Math.random() > 0.35) owlBlinkOnce() }, 2800)
  }
  function owlResetIdle () { clearTimeout(idleTimer); idleTimer = setTimeout(owlSleep, 12000) }

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
      if (!BUSY) { inp.value.trim() ? owlListen() : owlWake() }  // don't override thinking/talking
    })
    inp.addEventListener('focus', function () { if (owlEl().classList.contains('sleeping')) owlWake() })
    // tap the owl to wake / blink it
    owlEl().addEventListener('click', function () {
      owlEl().classList.contains('sleeping') ? owlWake() : owlBlinkOnce()
    })
    greet()
    owlSleep()   // start asleep until the user engages
  }

  function toggle () {
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) {
      owlWake()
      setTimeout(function () { document.getElementById('aiInput').focus() }, 80)
    }
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
      av.innerHTML = owl(20)
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
    var av = document.createElement('div'); av.className = 'ai-av'; av.innerHTML = owl(20)
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
    var av = document.createElement('div'); av.className = 'ai-av'; av.innerHTML = owl(20)
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
    owlThink()
    var dots = thinking()
    try {
      var data = await callFn({ message: text, history: HISTORY })
      dots.remove()
      if (data.history) HISTORY = data.history
      if (data.reply) bubble(data.reply, 'ai-bot')
      if (data.needsConfirmation) askConfirm(data.needsConfirmation)
      owlTalk()
    } catch (e) {
      dots.remove()
      bubble(e.message, 'ai-err')
      owlWake()
    } finally {
      BUSY = false; document.getElementById('aiSend').disabled = false
    }
  }

  async function runConfirmed () {
    if (!PENDING) return
    var action = PENDING; PENDING = null
    BUSY = true; document.getElementById('aiSend').disabled = true
    owlThink()
    var dots = thinking()
    try {
      var data = await callFn({ confirmedAction: action, history: HISTORY })
      dots.remove()
      bubble(data.reply || 'Done.', 'ai-bot')
      owlTalk()
    } catch (e) {
      dots.remove()
      bubble(e.message, 'ai-err')
      owlWake()
    } finally {
      BUSY = false; document.getElementById('aiSend').disabled = false
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()
