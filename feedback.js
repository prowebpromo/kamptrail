/* Private app feedback. Reuses moderation and status tokens, never map evidence. */
(function () {
  'use strict';
  const t = (key, params) => window.KampTrailI18n?.t(key, params) ?? key;
  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text != null) node.textContent = text;
    return node;
  };
  let dialog, lastFocus;
  const statuses = () => ({received:t('Received. Waiting for review.'), accepted:t('Accepted for follow-up.'), rejected:t('Closed without a change.'), applied:t('Completed.')});
  function diagnostics() {
    const ua = navigator.userAgent;
    return {version:'2.46.1', language:window.KampTrailI18n?.language || document.documentElement.lang || 'en', browser:/Firefox\//.test(ua)?'Firefox':/Edg\//.test(ua)?'Edge':/(Chrome|CriOS)\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other', width:window.innerWidth, height:window.innerHeight, connection:navigator.onLine?'online':'offline'};
  }
  function ensure() {
    if (dialog) return dialog;
    dialog = el('dialog', {id:'kt-feedback', 'aria-labelledby':'kt-feedback-title'});
    const head = el('div', {class:'kt-report-head'});
    const close = el('button', {type:'button', class:'btn', 'aria-label':t('Close feedback')}, t('Close'));
    close.onclick = () => dialog.close();
    head.append(el('h2', {id:'kt-feedback-title'}, t('Help improve KampTrail')), close);
    dialog.append(head, el('div', {class:'kt-report-body'}));
    dialog.addEventListener('close', () => {
      if (location.hash.startsWith('#feedback=')) history.replaceState(null, '', location.pathname + location.search);
      lastFocus?.focus?.();
    });
    document.body.append(dialog);
    return dialog;
  }
  function myReports() { dialog.close(); window.KampTrailContrib.showReports(); }
  function field(text, input, hint) {
    const label = el('label', {class:'kt-field'});
    label.append(el('span', {}, t(text)), input);
    if (hint) label.append(el('small', {}, t(hint)));
    return label;
  }
  function fallback(message) {
    const p = el('p', {class:'kt-report-msg is-error', role:'status'}, t(message));
    p.append(' ', el('a', {href:'https://boondockorbust.com/contact/#contact-form', target:'_blank', rel:'noopener noreferrer'}, t('Contact KampTrail')));
    return p;
  }
  function open(kind = 'bug') {
    const d = ensure(); if (!d.open) lastFocus = document.activeElement;
    const body = d.querySelector('.kt-report-body'); body.replaceChildren();
    body.append(el('p', {class:'kt-fine'}, t('Found a bug or have an idea? Send it privately. No account required. Email is optional.')));
    const f = el('form');
    const type = el('select', {name:'kind'});
    type.append(el('option', {value:'bug'}, t('Report a bug')), el('option', {value:'feature'}, t('Suggest a feature')));
    type.value = kind === 'feature' ? 'feature' : 'bug';
    const summary = el('input', {name:'title', required:'', minlength:'3', maxlength:'200', autocomplete:'off'});
    const details = el('textarea', {name:'details', required:'', minlength:'10', maxlength:'4000', rows:'5'});
    const detailsLabel = field('What happened?', details, 'For bugs, include the steps, what you expected and what happened. Do not include passwords or sensitive personal information.');
    const changeType = () => { detailsLabel.firstElementChild.textContent = t(type.value === 'feature' ? 'What would help you, and why?' : 'What happened?'); };
    type.onchange = changeType; changeType();
    f.append(field('Feedback type', type), field('Short summary', summary), detailsLabel,
      field('Email (optional)', el('input', {type:'email', name:'contact_email', maxlength:'200', autocomplete:'email'}), 'Only for a moderator’s follow-up question. Never shown publicly.'));
    const hp = el('div', {class:'kt-hp', 'aria-hidden':'true'});
    hp.append(field('Website', el('input', {name:'website', tabindex:'-1', autocomplete:'off'}))); f.append(hp);
    const diag = el('input', {type:'checkbox', name:'include_diagnostics'});
    const label = el('label', {class:'kt-confirm'}); label.append(diag, ' ' + t('Include basic app diagnostics (optional)'));
    const preview = el('details', {class:'kt-feedback-diagnostics'});
    preview.append(el('summary', {}, t('See what diagnostics would include')),
      el('p', {class:'kt-fine'}, t('App version, interface language, browser family, screen size and connection status only. No location, saved stops, URLs or browsing history.')),
      el('pre', {}, JSON.stringify(diagnostics(), null, 2)));
    const note = el('p', {class:'kt-report-msg', role:'status', 'aria-live':'polite'});
    const send = el('button', {type:'submit', class:'btn primary'}, t('Send feedback'));
    const mine = el('button', {type:'button', class:'btn'}, t('My reports')); mine.onclick = myReports;
    const actions = el('div', {class:'kt-feedback-actions'}); actions.append(send, mine);
    f.append(label, preview, el('p', {class:'kt-fine'}, t('Feedback is reviewed privately. A suggestion is not a promise to build it. For a campsite correction, use “Suggest a fix” on that listing.')), note, actions);
    const openedAt = Date.now();
    f.onsubmit = async event => {
      event.preventDefault(); if (!f.reportValidity()) return;
      const values = new FormData(f);
      const payload = {kind:type.value, title:values.get('title'), details:values.get('details'), contact_email:values.get('contact_email'), website:values.get('website'), elapsed_ms:Date.now()-openedAt};
      if (diag.checked) Object.assign(payload, {include_diagnostics:true, diagnostics:diagnostics()});
      if(navigator.onLine===false){note.replaceChildren(...fallback('Feedback could not be sent. Your text is still here. Try again when connected, or use the contact form.').childNodes);note.classList.add('is-error');return;}
      send.disabled = true; note.textContent = t('Sending…');
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch('api/submit.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:controller.signal});
        const out = await response.json();
        if (response.status === 201 && /^[a-f0-9]{32}$/.test(out.token || '')) {
          window.KampTrailBeta?.track('feedback_submitted');
          window.KampTrailContrib.rememberReport({token:out.token, name:payload.title, kind:payload.kind, at:new Date().toISOString()});
          body.replaceChildren(el('p', {class:'kt-report-ok', role:'status'}, t('Thanks. Your feedback was received.')),
            el('p', {class:'kt-fine'}, t('Check My reports on this device for updates. Keep your private status link if browser storage is unavailable or cleared.')));
          const link = new URL(location.pathname, location.origin); link.hash = 'feedback=report:' + out.token;
          body.append(el('a', {href:link.href}, t('Private report status')), mine); return;
        }
        note.textContent = response.status === 422 && out.fields ? Object.values(out.fields).map(value=>t(value)).join(' ') : response.status === 429 ? t('Too many reports from this connection. Try again later.') : '';
        if (note.textContent) return;
        throw new Error('unavailable');
      } catch {
        note.replaceChildren(...fallback('Feedback could not be sent. Your text is still here. Try again when connected, or use the contact form.').childNodes);note.classList.add('is-error');
      } finally { clearTimeout(timeout); send.disabled = false; }
    };
    body.append(f); if (!d.open) d.showModal(); summary.focus();
  }
  async function showStatus(token) {
    const d = ensure(); if (!d.open) lastFocus = document.activeElement;
    const body = d.querySelector('.kt-report-body');
    const text = el('p', {role:'status'}, t('Checking status…')); body.replaceChildren(text);
    if (!d.open) d.showModal();
    try {
      const response = await fetch('api/status.php?token=' + encodeURIComponent(token));
      const report = await response.json();
      text.textContent = response.ok ? (statuses()[report.status] || t('Status unavailable right now.')) : response.status === 404 ? t('Not found.') : t('Status unavailable right now.');
      if (response.ok && report.note) body.append(el('p', {}, t('Moderator note: {0}', {0:report.note})));
    } catch { text.textContent = t('Status unavailable right now.'); }
  }
  function fromHash() {
    const hash = location.hash;
    if (hash === '#feedback=bug' || hash === '#feedback=feature') open(hash.slice(10));
    const match = hash.match(/^#feedback=report:([a-f0-9]{32})$/);
    if (match) showStatus(match[1]);
  }
  window.KampTrailFeedback = {version:'2.46.1', open};
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('kt-feedback-open')?.addEventListener('click', () => open());
    document.querySelectorAll('[data-feedback-kind]').forEach(button => button.addEventListener('click', () => open(button.dataset.feedbackKind)));
    fromHash();
  });
  window.addEventListener('hashchange', fromHash);
})();
