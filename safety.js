/* Local acknowledgement only. No account, server receipt or browsing restriction. */
(function () {
  'use strict';
  const VERSION = '2.46.2';
  const ACK_VERSION = '2026-11-02', KEY = 'kt_safety_ack_v1';
  const t = key => window.KampTrailI18n?.t(key) ?? key;
  let sessionAccepted = false, pending = null, required = false;
  function hasAccepted() {
    if (sessionAccepted) return true;
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      return value?.version === ACK_VERSION && typeof value.acceptedAt === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.acceptedAt) &&
        Number.isFinite(Date.parse(value.acceptedAt)) && new Date(value.acceptedAt).toISOString() === value.acceptedAt;
    } catch { return false; }
  }
  function request(options = {}) {
    if (pending) { if (options.required === true) required = true; return pending; }
    if (hasAccepted()) return Promise.resolve(true);
    required = options.required === true;
    const focus = document.activeElement;
    let resolve;
    pending = new Promise(done => { resolve = done; });
    const result = pending;
    const el = (tag, text, attrs = {}) => {
      const node = document.createElement(tag);
      if (text) node.textContent = t(text);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      return node;
    };
    const dialog = el('dialog', null, {id:'kt-safety-ack', 'aria-labelledby':'kt-safety-title', 'aria-modal':'true'});
    dialog.append(el('p','Please read this before installing or using KampTrail.'));
    const checkbox = el('input', null, {type:'checkbox', id:'kt-safety-agree'});
    checkbox.checked = false;
    const agree = el('label', null, {for:'kt-safety-agree'});
    agree.append(checkbox, el('span', 'I have read and agree to the Terms of Use and acknowledge the Safety Disclaimer.'));
    const proceed = el('button', 'Continue', {type:'button', class:'btn primary'});
    proceed.disabled = true;
    const cancel = el('button', 'Cancel', {type:'button', class:'btn'});
    const status = el('p', null, {role:'status', 'aria-live':'polite'});
    const links = el('p');
    for (const [label, href] of [['Terms of Use','terms.html'],['Safety Disclaimer','safety.html'],['Privacy Policy','privacy.html']]) {
      links.append(el('a', label, {href, target:'_blank', rel:'noopener noreferrer'}), document.createTextNode(' '));
    }
    let finished = false, sessionOnly = false;
    const presentationFailed = () => {
      if (finished) return;
      finished = true;
      dialog.remove();
      if (required) {
        for (const child of document.body.children) child.inert = true;
        const panel = el('section', null, {id:'kt-safety-failure', role:'alert', tabindex:'-1'});
        const reload = el('button', 'Reload KampTrail', {type:'button', class:'btn primary'});
        reload.onclick = () => window.location.reload();
        panel.append(el('h2','Before you continue'),
          el('p','Safety acknowledgement could not be displayed. Reload KampTrail or close the app without accepting.'),
          links, reload);
        document.body.append(panel);
        panel.focus();
      } else focus?.focus?.();
      pending = null;
      required = false;
      resolve(false);
    };
    const finish = accepted => {
      if (finished) return;
      if (!accepted && required) {
        status.textContent = t('Acknowledgement is required to use the installed app. You can close this app without accepting.');
        if (!dialog.open) {
          try { dialog.showModal(); } catch { presentationFailed(); }
        }
        return;
      }
      finished = true;
      if (accepted) sessionAccepted = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      pending = null;
      required = false;
      focus?.focus?.();
      resolve(accepted);
    };
    checkbox.addEventListener('change', () => { proceed.disabled = !checkbox.checked; });
    cancel.onclick = () => finish(false);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => finish(false));
    proceed.onclick = () => {
      if (!checkbox.checked) return;
      if (!sessionOnly) {
        try {
          const record = JSON.stringify({version:ACK_VERSION, acceptedAt:new Date().toISOString()});
          localStorage.setItem(KEY, record);
          if (localStorage.getItem(KEY) !== record) throw new Error('not saved');
        } catch {
          sessionOnly = true;
          status.textContent = t('Your acknowledgement could not be saved on this device. It applies only to this session.');
          proceed.textContent = t('Continue for this session');
          return;
        }
      }
      finish(true);
    };
    dialog.append(el('h2','Before you continue',{id:'kt-safety-title'}),
      el('p','KampTrail is a planning aid, not a safety guarantee. Verify access, closures, road conditions and vehicle clearance with official sources. Maps and listings may be incomplete or outdated. Do not use while driving.'),
      el('p','These documents are currently in English.'), links, agree, status, cancel, proceed);
    try { document.body.append(dialog); dialog.showModal(); }
    catch { presentationFailed(); }
    return result;
  }
  window.KampTrailSafety = {version:VERSION, request, hasAccepted};
  const standalone = () => navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const firstLaunch = () => { if (standalone()) request({required:true}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', firstLaunch, {once:true});
  else Promise.resolve().then(firstLaunch);
})();
