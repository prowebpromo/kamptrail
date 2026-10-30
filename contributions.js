/* In-app corrections and new-campsite proposals. Reports go to the KampTrail moderation queue,
   not straight onto the map. No account. A private token on this device shows the report's status. */
(function () {
  'use strict';
  const STORE = 'kt_reports_v1';
  const API = 'api/';
  const PROBLEMS = [['closed', 'Closed or gone'], ['not_allowed', 'Camping not allowed'], ['fee', 'Fee is wrong'], ['location', 'Location is wrong'], ['amenities', 'Amenities are wrong'], ['access', 'Road or rig access is wrong'], ['name', 'Name is wrong'], ['other', 'Something else']];
  const STATUS_TEXT = {received: 'Received. Waiting for review.', accepted: 'Accepted. The data will be updated in a coming release.', rejected: 'Not accepted.', applied: 'Applied to the map data.'};
  const st = {dialog: null, openedAt: 0, target: null, lastFocus: null};
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); } if (text != null) e.textContent = text; return e; };
  function reports() { try { const r = JSON.parse(localStorage.getItem(STORE)); return Array.isArray(r) ? r.filter(x => x && /^[a-f0-9]{32}$/.test(x.token)) : []; } catch { return []; } }
  function remember(entry) { try { const list = reports(); list.unshift(entry); localStorage.setItem(STORE, JSON.stringify(list.slice(0, 50))); } catch {} }
  function fallbackLink(target) {
    const href = window.KampTrailShare ? (target.kind === 'new_place' ? KampTrailShare.issueUrl('new', {lat: target.lat, lng: target.lng}) : KampTrailShare.issueUrl('fix', target.site)) : 'https://github.com/prowebpromo/kamptrail/issues/new/choose';
    const a = el('a', {href, target: '_blank', rel: 'noopener noreferrer'}, 'report it on GitHub instead');
    return a;
  }
  function ensureDialog() {
    if (st.dialog) return st.dialog;
    const d = el('dialog', {id: 'kt-report', 'aria-labelledby': 'kt-report-title'});
    d.innerHTML = '<div class="kt-report-head"><h2 id="kt-report-title"></h2><button type="button" class="btn kt-report-close" aria-label="Close report form">Close</button></div><div class="kt-report-body"></div>';
    d.querySelector('.kt-report-close').onclick = () => d.close();
    d.addEventListener('close', () => { st.lastFocus?.focus?.(); });
    document.body.append(d);
    return st.dialog = d;
  }
  function field(label, input, hint) {
    const wrap = el('label', {class: 'kt-field'});
    wrap.append(el('span', {}, label), input);
    if (hint) wrap.append(el('small', {}, hint));
    return wrap;
  }
  function form(target) {
    const f = el('form', {novalidate: true});
    const isNew = target.kind === 'new_place';
    const intro = el('p', {class: 'kt-fine'}, 'Report only what you saw yourself or can link to an official source. A moderator reviews every report before the map changes. No account needed.');
    f.append(intro);
    if (isNew) {
      f.append(field('Campsite name', el('input', {name: 'campsite_name', required: true, maxlength: '200', autocomplete: 'off'})));
      const gps = el('p', {class: 'kt-muted'}, `Location: ${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`);
      f.append(gps);
    } else {
      f.append(el('p', {class: 'kt-report-site'}, target.site.properties.name));
      const set = el('fieldset', {class: 'kt-problems'});
      set.append(el('legend', {}, 'What is wrong?'));
      PROBLEMS.forEach(([v, l]) => { const lab = el('label'); lab.append(el('input', {type: 'checkbox', name: 'problems', value: v}), ' ' + l); set.append(lab); });
      f.append(set);
    }
    f.append(field(isNew ? 'What is there?' : 'What did you see?', el('textarea', {name: 'details', rows: '4', maxlength: '4000', required: true}), isNew ? 'Type of site, land manager, road, rig size, fee, stay limit, and when you were there.' : 'Include the fee, sign wording, road or rig limits, and the date you saw it.'));
    f.append(field('Source (optional)', el('input', {name: 'source', maxlength: '500', placeholder: 'Official page, or "visited 2026-10-20"'})));
    f.append(field('Email (optional)', el('input', {name: 'contact_email', type: 'email', maxlength: '200', autocomplete: 'email'}), 'Only for a moderator’s follow-up question. Never shown publicly.'));
    const hp = el('div', {class: 'kt-hp', 'aria-hidden': 'true'}); hp.append(field('Website', el('input', {name: 'website', tabindex: '-1', autocomplete: 'off'}))); f.append(hp);
    const confirm = el('label', {class: 'kt-confirm'}); confirm.append(el('input', {type: 'checkbox', name: 'firsthand', required: true}), ' This is first-hand or from an official source. I did not copy it from another app.'); f.append(confirm);
    const msg = el('p', {class: 'kt-report-msg', role: 'status', 'aria-live': 'polite'});
    const send = el('button', {type: 'submit', class: 'btn primary'}, 'Send report');
    f.append(msg, send);
    f.onsubmit = async e => {
      e.preventDefault();
      const data = new FormData(f);
      const body = {kind: target.kind, details: data.get('details'), source: data.get('source'), contact_email: data.get('contact_email'), website: data.get('website'), firsthand: data.get('firsthand') === 'on', elapsed_ms: Date.now() - st.openedAt};
      if (isNew) Object.assign(body, {campsite_name: data.get('campsite_name'), lat: +target.lat.toFixed(6), lng: +target.lng.toFixed(6), problems: ['new']});
      else { const [lng, lat] = target.site.geometry.coordinates; Object.assign(body, {campsite_id: target.site.properties.id, campsite_name: target.site.properties.name, lat, lng, problems: data.getAll('problems')}); }
      send.disabled = true; msg.textContent = 'Sending…'; msg.className = 'kt-report-msg';
      let res, out = {};
      try { res = await fetch(API + 'submit.php', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); out = await res.json().catch(() => ({})); }
      catch { res = null; }
      send.disabled = false;
      if (res && res.status === 201 && out.token) {
        remember({token: out.token, name: body.campsite_name || 'New campsite', kind: target.kind, at: new Date().toISOString()});
        done(out.token, body.campsite_name);
        return;
      }
      msg.className = 'kt-report-msg is-error';
      if (res && res.status === 422 && out.fields) { msg.textContent = Object.values(out.fields).join(' '); return; }
      if (res && res.status === 429) { msg.textContent = out.message || 'Too many reports from this connection. Try again later.'; return; }
      msg.textContent = navigator.onLine ? 'Reports are unavailable right now. Try again later, or ' : 'You are offline. Send this when you have signal, or ';
      msg.append(fallbackLink(target), '.');
    };
    return f;
  }
  function done(token, name) {
    const body = st.dialog.querySelector('.kt-report-body');
    body.replaceChildren(el('p', {class: 'kt-report-ok'}, `Thanks. Your report on ${name || 'this place'} was received.`),
      el('p', {class: 'kt-fine'}, 'A moderator will review it. Check its status any time under About the data, My reports. The status link is saved on this device only.'));
    const mine = el('button', {type: 'button', class: 'btn'}, 'My reports'); mine.onclick = () => showReports(); body.append(mine);
  }
  async function showReports() {
    const d = ensureDialog();
    d.querySelector('#kt-report-title').textContent = 'My reports';
    const body = d.querySelector('.kt-report-body');
    const list = reports();
    body.replaceChildren();
    if (!list.length) { body.append(el('p', {}, 'No reports from this device yet. Use “Suggest a fix” on a campsite, or long-press the map to suggest a new one.')); if (!d.open) d.showModal(); return; }
    const ul = el('ul', {class: 'kt-report-list'});
    body.append(ul);
    if (!d.open) d.showModal();
    for (const r of list.slice(0, 20)) {
      const li = el('li'); li.append(el('strong', {}, r.name), el('span', {class: 'kt-muted'}, ` · sent ${String(r.at).slice(0, 10)}`));
      const s = el('div', {class: 'kt-muted'}, 'Checking status…'); li.append(s); ul.append(li);
      try {
        const res = await fetch(API + 'status.php?token=' + encodeURIComponent(r.token));
        const out = await res.json();
        if (res.ok && out.status) { s.textContent = STATUS_TEXT[out.status] || out.status; if (out.note) li.append(el('div', {class: 'kt-fine'}, `Moderator note: ${out.note}`)); }
        else s.textContent = res.status === 404 ? 'Not found.' : 'Status unavailable right now.';
      } catch { s.textContent = 'Status unavailable right now.'; }
    }
  }
  function open(target) {
    const d = ensureDialog();
    st.target = target; st.openedAt = Date.now(); st.lastFocus = document.activeElement;
    d.querySelector('#kt-report-title').textContent = target.kind === 'new_place' ? 'Suggest a campsite' : 'Suggest a fix';
    d.querySelector('.kt-report-body').replaceChildren(form(target));
    if (!d.open) d.showModal();
    d.querySelector(target.kind === 'new_place' ? '[name="campsite_name"]' : '[name="problems"]')?.focus();
  }
  window.KampTrailContrib = {version: '2.15.0', open, showReports, reports};
})();
