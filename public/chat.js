// Ask-the-Planner — floating chat widget.
// Talks to POST /api/chat, which proxies to Anthropic server-side (key never
// reaches the browser). Grounded in the planner's live data. Self-contained:
// drop <script src="chat.js"></script> before </body> on any page.
(function () {
  const NAVY = '#0f2540', GREEN = '#1f7a4d';
  const history = [];   // { role: 'user'|'assistant', content }
  let open = false, busy = false;

  const style = document.createElement('style');
  style.textContent = `
    #ap-fab{position:fixed;bottom:20px;right:20px;z-index:9998;border:none;cursor:pointer;
      width:56px;height:56px;border-radius:50%;background:${NAVY};color:#fff;font-size:24px;
      box-shadow:0 4px 14px rgba(15,37,64,.35);transition:transform .12s,opacity .2s;}
    #ap-fab:hover{transform:scale(1.06);}
    #ap-panel{position:fixed;bottom:88px;right:20px;z-index:9998;width:380px;max-width:calc(100vw - 40px);
      height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;display:none;
      flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(15,37,64,.28);
      border:1px solid #e2e8f0;font-family:system-ui,-apple-system,sans-serif;}
    #ap-panel.open{display:flex;}
    #ap-head{background:${NAVY};color:#fff;padding:13px 16px;display:flex;align-items:center;
      justify-content:space-between;}
    #ap-head b{font-size:14px;font-weight:700;}
    #ap-head span{font-size:11px;opacity:.7;display:block;margin-top:1px;}
    #ap-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;opacity:.8;line-height:1;}
    #ap-close:hover{opacity:1;}
    #ap-log{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px;}
    .ap-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;}
    .ap-user{align-self:flex-end;background:${NAVY};color:#fff;border-bottom-right-radius:3px;}
    .ap-bot{align-self:flex-start;background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:3px;}
    .ap-err{align-self:flex-start;background:#fdeaea;color:#9b2c2c;border:1px solid #f5c6c6;font-size:12px;}
    .ap-hint{color:#94a3b8;font-size:12px;text-align:center;padding:8px 6px;line-height:1.5;}
    #ap-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#fff;}
    #ap-input{flex:1;border:1px solid #cbd5e1;border-radius:9px;padding:9px 11px;font-size:13px;
      font-family:inherit;resize:none;max-height:90px;outline:none;}
    #ap-input:focus{border-color:${NAVY};}
    #ap-send{border:none;background:${GREEN};color:#fff;border-radius:9px;padding:0 15px;cursor:pointer;
      font-weight:700;font-size:13px;}
    #ap-send:disabled{opacity:.5;cursor:default;}
  `;
  document.head.appendChild(style);

  const fab = el('button', { id: 'ap-fab', title: 'Ask the Planner' }, '💬');
  const panel = el('div', { id: 'ap-panel' });
  panel.innerHTML = `
    <div id="ap-head">
      <div><b>Ask the Planner</b><span>Grounded in this planner's data</span></div>
      <button id="ap-close" title="Close">×</button>
    </div>
    <div id="ap-log"></div>
    <form id="ap-form">
      <textarea id="ap-input" rows="1" placeholder="Ask about costs, contacts, timeline…"></textarea>
      <button id="ap-send" type="submit">Send</button>
    </form>`;
  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const log = panel.querySelector('#ap-log');
  const input = panel.querySelector('#ap-input');
  const sendBtn = panel.querySelector('#ap-send');

  hint('Ask me anything about the JCT transition plan — the cost stack, who to call, what\'s still open, the pro-forma numbers.');

  fab.onclick = toggle;
  panel.querySelector('#ap-close').onclick = toggle;
  panel.querySelector('#ap-form').onsubmit = (e) => { e.preventDefault(); send(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(90, input.scrollHeight) + 'px';
  });

  function toggle() {
    open = !open;
    panel.classList.toggle('open', open);
    fab.textContent = open ? '×' : '💬';
    if (open) input.focus();
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = ''; input.style.height = 'auto';
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    busy = true; sendBtn.disabled = true;
    const thinking = addMsg('bot', '…');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });
      const data = await res.json().catch(() => ({}));
      thinking.remove();
      if (!res.ok) {
        addMsg('err', data.error || `Error ${res.status}.`);
      } else {
        addMsg('bot', data.reply);
        history.push({ role: 'assistant', content: data.reply });
      }
    } catch (e) {
      thinking.remove();
      addMsg('err', 'Could not reach the assistant. Is the server running?');
    } finally {
      busy = false; sendBtn.disabled = false; input.focus();
    }
  }

  function addMsg(kind, text) {
    const cls = kind === 'user' ? 'ap-user' : kind === 'err' ? 'ap-err' : 'ap-bot';
    const m = el('div', { class: 'ap-msg ' + cls }, text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }
  function hint(text) {
    log.appendChild(el('div', { class: 'ap-hint' }, text));
  }
  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
})();
