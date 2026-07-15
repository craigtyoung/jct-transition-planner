// Admin unlock + write-lock client.
// Viewers see everything read-only. Only the holder of the admin password can save.
(function () {
  const KEY_STORE = 'jctAdminKey';
  const getKey = () => localStorage.getItem(KEY_STORE) || '';

  // Auto-attach the admin key to every POST, and catch view-only rejections.
  const _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts = {}) {
    if (opts && (opts.method || '').toUpperCase() === 'POST') {
      opts.headers = Object.assign({}, opts.headers, { 'x-admin-key': getKey() });
    }
    return _fetch(url, opts).then((res) => {
      if (res.status === 403) toast('View only — ask Craig for edit access.');
      return res;
    });
  };

  function toast(msg) {
    let t = document.getElementById('jct-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'jct-toast';
      t.style.cssText =
        'position:fixed;bottom:64px;right:16px;background:#0f2540;color:#fff;' +
        'padding:10px 14px;border-radius:8px;font:14px system-ui;z-index:9999;' +
        'box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:260px;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.style.opacity = '0'), 2600);
  }

  function render() {
    let pill = document.getElementById('jct-admin-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'jct-admin-pill';
      pill.style.cssText =
        'position:fixed;bottom:16px;right:16px;border:none;cursor:pointer;' +
        'padding:8px 14px;border-radius:20px;font:600 13px system-ui;z-index:9999;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.2);transition:opacity .3s;';
      document.body.appendChild(pill);
    }
    const admin = !!getKey();
    pill.textContent = admin ? 'Admin ✓ (lock)' : '🔒 View only — unlock';
    pill.style.background = admin ? '#1f7a4d' : '#0f2540';
    pill.style.color = '#fff';
    pill.onclick = () => {
      if (admin) {
        localStorage.removeItem(KEY_STORE);
        toast('Locked — now in view-only mode.');
      } else {
        const k = prompt('Enter admin password to enable editing:');
        if (k) {
          localStorage.setItem(KEY_STORE, k);
          toast('Unlocked — you can now save changes.');
        }
      }
      render();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
