/* Initial shell and offline status; independent of map startup. */
(function(){'use strict';const VERSION='2.46.0';const t=(k,p)=>window.KampTrailI18n?.t(k,p)??k;
  // Localize initial shell labels before live counts and statuses are rendered.
  window.KampTrailI18n?.apply();
  let toastTimer;
  window.escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.showToast = function (message, type = 'info', duration = 6000) {
    const el = document.getElementById('toast');
    clearTimeout(toastTimer);
    el.textContent = message;
    el.className = `toast show ${type}`;
    if (duration > 0) toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  };
  window.setLoading = on => { document.getElementById('loading').hidden = !on; };
  function updateOnline() {
    document.getElementById('status-dot').style.color = navigator.onLine ? '#287d45' : '#b06719';
    document.getElementById('status-text').textContent = navigator.onLine ? t("Online") : t("Offline: viewed listings, saved stops and saved Topo maps work");
  }
  addEventListener('online', updateOnline);
  addEventListener('offline', updateOnline);
  updateOnline();

  if ('serviceWorker' in navigator) {
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      // First install controls this page without a reload. Reload only on request.
      if (hadController || window.ktReloadForUpdate) { refreshing = true; location.reload(); }
    });
    navigator.serviceWorker.register('service-worker.js', {updateViaCache:'none'}).then(reg => {
      function offer(sw) {
        const toast = document.getElementById('toast');
        showToast(t("An updated KampTrail is ready."), 'info', 0);
        const button = document.createElement('button');button.textContent = t("Reload update");
        button.onclick = () => {window.ktReloadForUpdate = true;sw.postMessage('SKIP_WAITING');};toast.append(button);
      }
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {if (sw.state === 'installed' && navigator.serviceWorker.controller) offer(sw);});
      });
    }).catch(() => {showToast(t("Offline saving is unavailable. You can still use the map online."));});
  }


  window.KampTrailShell={version:VERSION};
  const pwa=new URLSearchParams(location.search).get('source')==='pwa'||matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  document.body.classList.toggle('kt-workspace',pwa);
  const view=document.getElementById('kt-full-site');
  if(view){view.hidden=!pwa;view.onclick=()=>{document.body.classList.toggle('kt-workspace');view.textContent=t(document.body.classList.contains('kt-workspace')?'Full website':'Map workspace');};}
})();
