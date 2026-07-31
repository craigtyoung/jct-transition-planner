// Role-aware client layer. Two roles come from the server (/api/whoami):
//   owner   — full access; also gets a "Preview as partner" toggle
//   partner — read-only, limited pages, no chatbot
// Owner preview routes /api GETs through ?as=partner so the preview shows
// EXACTLY what a partner sees. The real security is server-side; this is UX.
(function () {
  const PREVIEW_KEY = 'jctPreviewPartner';
  const previewOn = () => localStorage.getItem(PREVIEW_KEY) === '1';

  // Pages a partner may view. Everything else redirects to the first of these.
  const PARTNER_PAGES = ['/timeline.html', '/context.html'];
  const NAV_ALLOW = new Set(PARTNER_PAGES);

  // --- synchronous (before the page's own scripts run): in preview, send /api
  //     GETs through the partner filter so an owner sees the trimmed data too ---
  if (previewOn()) {
    const _fetch = window.fetch.bind(window);
    window.fetch = function (url, opts = {}) {
      try {
        const method = ((opts && opts.method) || 'GET').toUpperCase();
        if (method === 'GET' && typeof url === 'string' &&
            url.indexOf('/api/') === 0 && url.indexOf('/api/whoami') !== 0) {
          url += (url.indexOf('?') === -1 ? '?' : '&') + 'as=partner';
        }
      } catch (e) { /* leave url untouched */ }
      return _fetch(url, opts);
    };
  }

  let serverRole = 'owner';
  const curPage = () => { let p = location.pathname; return (p === '/' || p === '') ? '/index.html' : p; };
  const effRole = () => (serverRole === 'partner' || previewOn()) ? 'partner' : 'owner';

  function makeReadOnly() {
    document.querySelectorAll('.main input, .main select, .main textarea').forEach(el => { el.disabled = true; });
    document.querySelectorAll('.bd-btn,.bd-apply,.bd-remove,.bd-clear,.bd-drag,.bd-firm,.g-resize,.ctx-del,.btn-ghost,.ctx-toolbar')
      .forEach(el => { el.style.display = 'none'; });
    document.querySelectorAll('.g-bar').forEach(el => { el.style.cursor = 'default'; el.onmousedown = null; });
    document.querySelectorAll('.badge,.pill-item,.config-tab,.countdown-toggle,.collapsible-header')
      .forEach(el => { el.style.pointerEvents = 'none'; });
  }

  let mo = null;
  function enforceReadOnly() {
    makeReadOnly();
    if (!mo) {
      mo = new MutationObserver(() => { clearTimeout(mo._t); mo._t = setTimeout(makeReadOnly, 40); });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  function hideChatbot() {
    const kill = () => ['ap-fab', 'ap-panel'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    kill(); setTimeout(kill, 300); setTimeout(kill, 1200);
  }

  function banner() {
    if (document.getElementById('role-banner')) return;
    const b = document.createElement('div');
    b.id = 'role-banner';
    b.textContent = (serverRole === 'partner')
      ? 'Shared view — read only'
      : 'PREVIEW — this is exactly what shared partners see (read-only). Use the toggle to exit.';
    b.style.cssText = 'position:sticky;top:0;z-index:60;background:#b45309;color:#fff;text-align:center;font:600 12px system-ui;padding:6px 10px';
    document.body.insertBefore(b, document.body.firstChild);
  }

  function renderToggle() {
    if (serverRole !== 'owner') return;      // partners never see the toggle
    let pill = document.getElementById('role-toggle');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'role-toggle';
      pill.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9999;border:none;cursor:pointer;padding:9px 15px;border-radius:20px;font:700 13px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.25);color:#fff';
      document.body.appendChild(pill);
    }
    const on = previewOn();
    pill.textContent = on ? '● Previewing as partner — exit' : '◐ Preview as partner';
    pill.style.background = on ? '#b45309' : '#0f2540';
    pill.onclick = () => { on ? localStorage.removeItem(PREVIEW_KEY) : localStorage.setItem(PREVIEW_KEY, '1'); location.reload(); };
  }

  function applyNav() {
    document.querySelectorAll('.nav-link').forEach(a => {
      const href = a.getAttribute('href');
      a.style.display = (effRole() === 'partner' && !NAV_ALLOW.has(href)) ? 'none' : '';
    });
  }

  function apply() {
    applyNav();
    renderToggle();
    if (effRole() === 'partner') {
      if (!PARTNER_PAGES.includes(curPage())) { location.replace('/timeline.html'); return; }
      banner();
      enforceReadOnly();
      hideChatbot();
    }
  }

  async function init() {
    try { const r = await fetch('/api/whoami'); if (r.ok) serverRole = (await r.json()).role || 'owner'; } catch (e) {}
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }
  init();
})();
