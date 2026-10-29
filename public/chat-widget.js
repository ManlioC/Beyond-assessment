/*!
 * Beyond Strategy - Growth Advisor chat widget
 * Inserimento: <script src="https://assessment.beyondstrategy.it/chat-widget.js" defer></script>
 * Opzioni (attributi data-* sul tag script):
 *   data-api             endpoint della chat (default: stessa origine dello script + /api/chat)
 *   data-privacy-url     link all'informativa privacy (default: https://beyondstrategy.it/privacy)
 *   data-teaser          "off" per disattivare il messaggio proattivo
 */
(function () {
  'use strict';
  if (window.__beyondChatLoaded) return;
  window.__beyondChatLoaded = true;

  var script = document.currentScript || document.querySelector('script[src*="chat-widget.js"]');
  var scriptOrigin = script ? new URL(script.src, location.href).origin : location.origin;
  var API_URL = (script && script.dataset.api) || scriptOrigin + '/api/chat';
  var PRIVACY_URL = (script && script.dataset.privacyUrl) || 'https://beyondstrategy.it/privacy';
  var TEASER = !(script && script.dataset.teaser === 'off');
  var STORAGE_KEY = 'beyond_chat_v1';
  var MAX_HISTORY = 38;

  var WELCOME =
    'Ciao! Sono il **Growth Advisor** di Beyond Strategy, un assistente AI. ' +
    'Posso aiutarti a capire da dove partire per far crescere la tua azienda: go-to-market, acquisizione clienti, processo commerciale, brand e customer experience.\n\n' +
    'Qual \u00e8 la sfida di crescita pi\u00f9 importante per te in questo momento?';
  var SUGGESTIONS = [
    'Come trovare nuovi clienti B2B?',
    'Il mio processo commerciale non scala',
    'Cosa fa Beyond Strategy?',
    'Vorrei parlare con un consulente'
  ];

  // ---------- Stato ----------
  function safeGet(storage, key) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function safeSet(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  var saved = safeGet(sessionStorage, STORAGE_KEY) || {};
  var state = {
    messages: Array.isArray(saved.messages) ? saved.messages : [], // solo turni user/assistant
    ctas: saved.ctas || {}, // indice messaggio assistente -> {label,url}
    open: !!saved.open,
    teaserSeen: !!saved.teaserSeen,
    busy: false
  };
  function persist() {
    safeSet(sessionStorage, STORAGE_KEY, {
      messages: state.messages, ctas: state.ctas, open: state.open, teaserSeen: state.teaserSeen
    });
  }

  function assessmentContext() {
    var lead = safeGet(localStorage, 'beyond_lead');
    if (!lead || typeof lead !== 'object') return undefined;
    // Risultati più vecchi di 90 giorni non sono più rilevanti: li cancelliamo
    if (!lead.ts || Date.now() - new Date(lead.ts).getTime() > 90 * 864e5) {
      try { localStorage.removeItem('beyond_lead'); } catch (e) {}
      return undefined;
    }
    return {
      name: lead.name, company: lead.company, role: lead.role,
      sector: lead.sector, score: Number(lead.score), level: lead.level
    };
  }

  // ---------- Fonts ----------
  if (!document.querySelector('link[data-beyond-chat-fonts]')) {
    var fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600&display=swap';
    fonts.setAttribute('data-beyond-chat-fonts', '');
    document.head.appendChild(fonts);
  }

  // ---------- DOM ----------
  var host = document.createElement('div');
  host.id = 'beyond-chat';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    '.w{--navy:#001845;--navy-mid:#002060;--navy-light:#E8EEF8;--green:#00E060;--green-dark:#00B84C;--ink:#0D1117;--ink-mid:#3D4450;--ink-light:#6B7280;--border:#E5E7EB;--surface:#F9FAFB;--white:#fff;' +
    'font-family:Inter,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:var(--ink);position:fixed;right:20px;bottom:20px;z-index:2147483000}' +
    '.launcher{width:60px;height:60px;border-radius:50%;border:0;background:var(--navy);color:var(--white);cursor:pointer;box-shadow:0 8px 24px rgba(0,24,69,.28);display:grid;place-items:center;position:relative;transition:transform .2s}' +
    '.launcher:hover{transform:translateY(-2px)}' +
    '.launcher:focus-visible,.send:focus-visible,.chip:focus-visible,.close:focus-visible,.cta:focus-visible{outline:3px solid var(--green);outline-offset:2px}' +
    '.launcher .dot{position:absolute;top:4px;right:4px;width:12px;height:12px;border-radius:50%;background:var(--green);border:2px solid var(--navy)}' +
    '.teaser{position:absolute;right:0;bottom:74px;width:260px;background:var(--white);border:1px solid var(--border);border-radius:14px 14px 4px 14px;padding:12px 32px 12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.12);cursor:pointer;font-size:13.5px;color:var(--ink-mid)}' +
    '.teaser b{color:var(--navy)}' +
    '.teaser .x{position:absolute;top:6px;right:8px;border:0;background:none;color:var(--ink-light);font-size:16px;cursor:pointer;line-height:1}' +
    '.panel{position:absolute;right:0;bottom:76px;width:380px;height:min(620px,calc(100vh - 110px));background:var(--white);border-radius:16px;box-shadow:0 16px 48px rgba(0,24,69,.22);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--border)}' +
    '.panel[hidden],.teaser[hidden]{display:none}' +
    '.head{background:var(--navy);color:var(--white);padding:14px 16px;display:flex;align-items:center;gap:12px}' +
    '.avatar{width:36px;height:36px;border-radius:50%;background:var(--navy-mid);border:2px solid var(--green);display:grid;place-items:center;font-family:"DM Serif Display",Georgia,serif;font-size:17px;flex:none}' +
    '.title{font-family:"DM Serif Display",Georgia,serif;font-size:17px;line-height:1.2}' +
    '.sub{font-size:11.5px;color:#B9C6E0;display:flex;align-items:center;gap:6px}' +
    '.sub i{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block}' +
    '.close{margin-left:auto;border:0;background:transparent;color:var(--white);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:20px;line-height:1}' +
    '.close:hover{background:rgba(255,255,255,.1)}' +
    '.log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:var(--surface)}' +
    '.msg{max-width:86%;padding:10px 13px;border-radius:14px;word-wrap:break-word;white-space:normal}' +
    '.bot{align-self:flex-start;background:var(--white);border:1px solid var(--border);border-bottom-left-radius:4px}' +
    '.me{align-self:flex-end;background:var(--navy);color:var(--white);border-bottom-right-radius:4px}' +
    '.msg p+p,.msg p+ul,.msg ul+p{margin-top:8px}' +
    '.msg ul{padding-left:18px}' +
    '.msg a{color:var(--navy-mid);font-weight:500}' +
    '.me a{color:var(--green)}' +
    '.msg strong{font-weight:600}' +
    '.err{align-self:center;font-size:12.5px;color:#B42318;background:#FEF3F2;border:1px solid #FECDCA;border-radius:10px;padding:8px 12px;text-align:center}' +
    '.cta{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;background:var(--green);color:var(--navy);font-weight:600;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:13.5px}' +
    '.cta:hover{background:var(--green-dark)}' +
    '.typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:var(--white);border:1px solid var(--border);border-radius:14px;border-bottom-left-radius:4px}' +
    '.typing span{width:6px;height:6px;border-radius:50%;background:var(--ink-light);animation:b 1.2s infinite}' +
    '.typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}' +
    '@keyframes b{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;background:var(--surface)}' +
    '.chip{border:1px solid var(--border);background:var(--white);color:var(--navy);border-radius:999px;padding:6px 11px;font:inherit;font-size:12.5px;cursor:pointer}' +
    '.chip:hover{border-color:var(--navy);background:var(--navy-light)}' +
    '.form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);background:var(--white)}' +
    '.form textarea{flex:1;resize:none;border:1px solid var(--border);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;color:var(--ink);max-height:120px;min-height:42px;outline:none}' +
    '.form textarea:focus{border-color:var(--navy)}' +
    '.send{width:42px;height:42px;border:0;border-radius:10px;background:var(--navy);color:var(--white);cursor:pointer;display:grid;place-items:center;flex:none;align-self:flex-end}' +
    '.send:disabled{opacity:.4;cursor:default}' +
    '.foot{font-size:11px;color:var(--ink-light);text-align:center;padding:0 12px 10px;background:var(--white)}' +
    '.foot a{color:var(--ink-light)}' +
    '@media (max-width:480px){.w{right:12px;bottom:12px}.panel{position:fixed;inset:0;width:100%;height:100%;border-radius:0;border:0}.teaser{width:230px}.w.is-open .launcher{display:none}}' +
    '@media (prefers-reduced-motion:reduce){.launcher,.typing span{transition:none;animation:none}}' +
    '</style>' +
    '<div class="w">' +
    '  <div class="teaser" hidden role="button" tabindex="0"><button class="x" aria-label="Chiudi suggerimento">\u00d7</button><b>Vuoi crescere con pi\u00f9 metodo?</b><br>Raccontami la tua sfida: ti suggerisco da dove partire.</div>' +
    '  <section class="panel" hidden role="dialog" aria-label="Chat con il Growth Advisor di Beyond Strategy">' +
    '    <header class="head"><div class="avatar" aria-hidden="true">B</div><div><div class="title">Growth Advisor</div><div class="sub"><i></i>Assistente AI \u00b7 Beyond Strategy</div></div><button class="close" aria-label="Chiudi chat">\u00d7</button></header>' +
    '    <div class="log" aria-live="polite"></div>' +
    '    <div class="chips"></div>' +
    '    <form class="form"><textarea rows="1" placeholder="Scrivi un messaggio\u2026" aria-label="Messaggio" maxlength="2000"></textarea>' +
    '      <button class="send" type="submit" aria-label="Invia"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>' +
    '    <div class="foot">Assistente AI: le risposte possono contenere imprecisioni. <a target="_blank" rel="noopener">Informativa privacy</a></div>' +
    '  </section>' +
    '  <button class="launcher" aria-label="Apri la chat con il Growth Advisor" aria-expanded="false">' +
    '    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>' +
    '    <span class="dot"></span>' +
    '  </button>' +
    '</div>';

  var $ = function (sel) { return root.querySelector(sel); };
  var panel = $('.panel'), log = $('.log'), chips = $('.chips'), form = $('.form');
  var input = $('textarea'), send = $('.send'), launcher = $('.launcher'), teaser = $('.teaser');
  $('.foot a').href = PRIVACY_URL;

  // ---------- Rendering ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  function renderMarkdown(text) {
    var html = '', list = false;
    text.split('\n').forEach(function (line) {
      var item = line.match(/^\s*[-*\u2022]\s+(.*)/);
      if (item) {
        if (!list) { html += '<ul>'; list = true; }
        html += '<li>' + inline(item[1]) + '</li>';
        return;
      }
      if (list) { html += '</ul>'; list = false; }
      if (line.trim()) html += '<p>' + inline(line) + '</p>';
    });
    if (list) html += '</ul>';
    return html;
  }

  function addBubble(role, text) {
    var el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'me' : 'bot');
    if (role === 'user') el.textContent = text; else el.innerHTML = renderMarkdown(text);
    log.appendChild(el);
    scrollDown();
    return el;
  }
  function addCta(cta) {
    var a = document.createElement('a');
    a.className = 'cta';
    a.href = cta.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '\ud83d\udcc5 ' + cta.label;
    log.appendChild(a);
    scrollDown();
  }
  function addError(text) {
    var el = document.createElement('div');
    el.className = 'err';
    el.textContent = text;
    log.appendChild(el);
    scrollDown();
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function renderAll() {
    log.innerHTML = '';
    addBubble('assistant', WELCOME);
    state.messages.forEach(function (m, i) {
      addBubble(m.role, m.content);
      if (state.ctas[i]) addCta(state.ctas[i]);
    });
    renderChips();
  }
  function renderChips() {
    chips.innerHTML = '';
    if (state.messages.length) return;
    SUGGESTIONS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = s;
      b.addEventListener('click', function () { submit(s); });
      chips.appendChild(b);
    });
  }

  // ---------- Apertura/chiusura ----------
  function setOpen(open) {
    state.open = open;
    panel.hidden = !open;
    $('.w').classList.toggle('is-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      hideTeaser();
      scrollDown();
      setTimeout(function () { input.focus(); }, 50);
    }
    persist();
  }
  function hideTeaser() {
    teaser.hidden = true;
    state.teaserSeen = true;
    persist();
  }
  launcher.addEventListener('click', function () { setOpen(!state.open); });
  $('.close').addEventListener('click', function () { setOpen(false); launcher.focus(); });
  teaser.addEventListener('click', function (e) {
    if (e.target.classList.contains('x')) { e.stopPropagation(); hideTeaser(); return; }
    setOpen(true);
  });
  teaser.addEventListener('keydown', function (e) { if (e.key === 'Enter') setOpen(true); });
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) { setOpen(false); launcher.focus(); } });

  // ---------- Invio ----------
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input.value); }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(input.value); });

  function setBusy(busy) {
    state.busy = busy;
    send.disabled = busy;
    input.disabled = busy;
  }

  function submit(text) {
    text = (text || '').trim();
    if (!text || state.busy) return;
    input.value = '';
    input.style.height = 'auto';
    chips.innerHTML = '';

    state.messages.push({ role: 'user', content: text.slice(0, 2000) });
    // Conserva solo gli ultimi turni, ripartendo sempre da un messaggio dell'utente
    while (state.messages.length > MAX_HISTORY || (state.messages.length && state.messages[0].role !== 'user')) {
      state.messages.shift();
      state.ctas = {};
    }
    persist();
    ask(addBubble('user', text));
  }

  function ask(userBubble) {
    setBusy(true);
    var typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(typing);
    scrollDown();

    var bubble = null, reply = '', cta = null, failed = false;

    fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: state.messages,
        context: { page: location.href, assessment: assessmentContext() }
      })
    })
      .then(function (res) {
        if (res.status === 429) throw new Error('Hai inviato molti messaggi in poco tempo. Attendi un minuto e riprova.');
        if (!res.ok || !res.body) throw new Error('Al momento non riesco a rispondere. Riprova tra poco.');
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function handle(evt) {
          if (evt.type === 'text') {
            if (!bubble) { typing.remove(); bubble = addBubble('assistant', ''); }
            reply += evt.text;
            bubble.innerHTML = renderMarkdown(reply);
            scrollDown();
          } else if (evt.type === 'cta') {
            cta = { label: evt.label, url: evt.url };
          } else if (evt.type === 'error') {
            failed = true;
            addError(evt.message);
          }
        }

        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buffer += decoder.decode(r.value, { stream: true });
            var parts = buffer.split('\n\n');
            buffer = parts.pop();
            parts.forEach(function (p) {
              var line = p.split('\n').filter(function (l) { return l.indexOf('data: ') === 0; })[0];
              if (!line) return;
              try { handle(JSON.parse(line.slice(6))); } catch (e) {}
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        failed = true;
        addError(err && err.message ? err.message : 'Connessione non riuscita. Riprova.');
      })
      .then(function () {
        typing.remove();
        if (reply.trim()) {
          state.messages.push({ role: 'assistant', content: reply });
          if (cta) { state.ctas[state.messages.length - 1] = cta; addCta(cta); }
        } else {
          // Nessuna risposta: togli l'ultimo messaggio dalla cronologia per permettere all'utente di riprovare
          var last = state.messages.pop();
          if (bubble) bubble.remove();
          if (userBubble) userBubble.remove();
          if (!failed) addError('Nessuna risposta ricevuta. Riprova.');
          input.value = last ? last.content : '';
        }
        persist();
        setBusy(false);
        if (state.open) input.focus();
      });
  }

  // ---------- Avvio ----------
  function mount() {
    document.body.appendChild(host);
    renderAll();
    if (state.open) setOpen(true);
    if (TEASER && !state.teaserSeen && !state.open && !state.messages.length) {
      setTimeout(function () { if (!state.open && !state.teaserSeen) teaser.hidden = false; }, 12000);
    }
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
