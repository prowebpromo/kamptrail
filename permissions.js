/* Overnight permission evidence and moderated firsthand reports are deliberately separate. */
(function () {
  'use strict';
  const API = 'api/permissions.php', STORE = 'kt_permission_owners_v1';
  const activities = {overnight_occupancy: 'Overnight occupancy', unoccupied_vehicle_parking: 'Unoccupied vehicle parking'};
  const observations = {granted_to_me: 'Permission granted to me', refused_to_me: 'Permission refused to me', prohibition_sign_seen: 'Prohibition sign seen', stayed_without_asking: 'Stayed without asking'};
  const state = {dialog: null, body: null, place: null, activity: 'overnight_occupancy', generation: 0, controller: null, focus: null, publicView: null, expiryTimer: null, offlineNotice: null};
  function node(tag, attrs = {}, text) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : String(v));
    if (text != null) n.textContent = String(text);
    return n;
  }
  function button(label, action) {const b = node('button', {type: 'button', class: 'btn'}, label); b.addEventListener('click', action); return b;}
  function notice(text) {return node('p', {role: 'status', 'aria-live': 'polite'}, text);}
  function field(label, input, hint) {
    const wrap = node('label', {class: 'kt-field'}); input.setAttribute('aria-label', label); wrap.append(node('span', {}, label), input);
    if (hint) wrap.append(node('small', {}, hint)); return wrap;
  }
  function today() {return new Date().toISOString().slice(0, 10);}
  function invalidate() {state.generation++; state.controller?.abort(); state.controller = new AbortController(); clearTimeout(state.expiryTimer); state.expiryTimer = null; state.publicView = null; state.offlineNotice = null;}
  function expirePublic(view, offline = false) {
    if (!state.dialog?.open || state.publicView !== view) return;
    invalidate(); state.publicView = view;
    view.source.replaceChildren(); view.list.replaceChildren(); view.concerns.replaceChildren(); view.more.hidden = true;
    view.summary.replaceChildren(document.createTextNode(offline ? 'Offline: current permission information and reports are unavailable. This is not a zero count or a permission decision.' : 'This permission assessment is no longer current. Reload source evidence and reports before relying on them.'), button('Retry', view.refresh));
  }
  function scheduleExpiry(view, official) {
    clearTimeout(state.expiryTimer);
    const now = Date.now(), deadlines = [now + 15 * 60 * 1000];
    if (['allowed', 'conditional', 'prohibited', 'conflict'].includes(official?.status)) {
      const assessed = Date.parse(official.as_of);
      if (Number.isFinite(assessed)) deadlines.push(assessed + 15 * 60 * 1000);
    }
    for (const r of official?.evidence || []) {
      if (r.freshness === 'current') {
        const review = Date.parse(r.review_after), until = Date.parse(r.effective_until);
        if (Number.isFinite(review)) deadlines.push(review);
        if (Number.isFinite(until)) deadlines.push(until + 86400000); // Effective-through dates are inclusive UTC days.
      }
      if (r.freshness === 'future') {const starts = Date.parse(r.effective_from); if (Number.isFinite(starts)) deadlines.push(starts);}
    }
    state.expiryTimer = setTimeout(() => expirePublic(view), Math.max(0, Math.min(...deadlines) - now));
  }
  window.addEventListener('offline', () => {
    if (!state.dialog?.open) return;
    if (state.publicView) expirePublic(state.publicView, true);
    else if (!state.offlineNotice) {state.offlineNotice = notice('Offline. Your draft remains here; reconnect before sending. Nothing will be submitted automatically.'); state.body.append(state.offlineNotice);}
  });
  function resumePublic() {
    if (state.dialog?.open && state.publicView) {
      if (navigator.onLine) state.publicView.refresh();
      else expirePublic(state.publicView, true);
    }
  }
  document.addEventListener('visibilitychange', () => {if (document.visibilityState === 'visible') resumePublic();});
  window.addEventListener('pageshow', event => {if (event.persisted) resumePublic();});
  function shell(title) {
    invalidate();
    if (!state.dialog) {
      const d = node('dialog', {id: 'kt-permissions', 'aria-labelledby': 'kt-permissions-title'});
      const header = node('div', {class: 'kt-report-head'});
      header.append(node('h2', {id: 'kt-permissions-title', tabindex: '-1'}), button('Close', () => d.close()));
      state.body = node('div', {class: 'kt-permissions-body'}); d.append(header, state.body);
      d.addEventListener('close', () => {invalidate(); state.body.replaceChildren(); if (state.focus?.isConnected) state.focus.focus();});
      d.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const all = [...d.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length && n.tabIndex >= 0);
        if (!all.length) {e.preventDefault(); return;}
        const first = all[0], last = all[all.length - 1];
        if (e.shiftKey && (document.activeElement === first || !all.includes(document.activeElement))) {e.preventDefault(); last.focus();}
        else if (!e.shiftKey && (document.activeElement === last || !all.includes(document.activeElement))) {e.preventDefault(); first.focus();}
      });
      document.body.append(d); state.dialog = d;
    }
    state.dialog.querySelector('h2').textContent = title; state.body.replaceChildren();
    if (!state.dialog.open) state.dialog.showModal();
    state.dialog.querySelector('h2').focus(); return state.body;
  }
  async function request(payload, token, signal) {
    const headers = {'Content-Type': 'application/json'}; if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(API, {method: 'POST', cache: 'no-store', credentials: 'same-origin', headers, body: JSON.stringify(payload), signal});
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || 'Permission information is unavailable. Check your connection and retry.'); error.status = response.status; throw error;
    }
    return result;
  }
  function saved() {
    try {const rows = JSON.parse(localStorage.getItem(STORE)); return Array.isArray(rows) ? rows.filter(r => /^[a-f0-9]{64}$/.test(r?.token)) : [];} catch {return [];}
  }
  function remember(item) {
    try {localStorage.setItem(STORE, JSON.stringify([{id: item.id, token: item.token, name: item.name, at: new Date().toISOString()}, ...saved().filter(r => r.token !== item.token)].slice(0, 100))); return true;} catch {return false;}
  }
  function forget(token) {try {localStorage.setItem(STORE, JSON.stringify(saved().filter(r => r.token !== token)));} catch { /* Browser storage is optional. */ }}
  function safeURL(value) {try {const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null;} catch {return null;}}
  function officialSection(official, activity) {
    const section = node('section', {'aria-label': 'Source conclusion and evidence'});
    section.append(node('h3', {}, 'Source conclusion'));
    const scoped = official && official.activity === activity;
    const statuses = {allowed: 'permission described in source evidence', conditional: 'conditional permission', prohibited: 'a prohibition', conflict: 'conflicting evidence', historical: 'historical evidence only', unknown: 'permission unknown'};
    section.append(node('p', {}, `Source reports: ${scoped ? (statuses[official.status] || statuses.unknown) : statuses.unknown} for ${activities[activity].toLowerCase()}.`));
    if (scoped && official.summary) section.append(node('p', {}, official.summary));
    section.append(node('p', {class: 'kt-fine'}, `Source assessment as of ${scoped && official.as_of ? official.as_of : 'date unavailable'}. Confirm current rules with the responsible operator or land manager. Parking permission does not establish overnight occupancy permission.`));
    const evidence = scoped && Array.isArray(official.evidence) ? official.evidence : [];
    const details = node('details'); details.append(node('summary', {}, `Source evidence and history (${evidence.length})`));
    if (!evidence.length) details.append(node('p', {}, 'No source evidence is available for this activity. This does not establish permission or a prohibition.'));
    for (const r of evidence) {
      const card = node('article', {class: 'kt-permission-card'});
      card.append(node('h4', {}, r.issuer || 'Source issuer unavailable'), node('p', {}, `Evidence: ${r.freshness || 'currency unknown'} · ${r.statement || 'statement unavailable'}`));
      if (r.quote) card.append(node('blockquote', {}, r.quote));
      if (r.conditions?.length) {const ul = node('ul'); r.conditions.forEach(c => ul.append(node('li', {}, c))); card.append(ul);}
      card.append(node('p', {class: 'kt-fine'}, `Effective from ${r.effective_from || 'unspecified'} through ${r.effective_until || 'unspecified'}. Retrieved ${r.retrieved_at || 'unknown'}; reviewed ${r.reviewed_at || 'unknown'}; review due ${r.review_after || 'unknown'}.`));
      if (['expired', 'superseded', 'stale', 'future'].includes(r.freshness)) card.append(node('p', {}, 'Historical or noncurrent evidence; this does not establish current permission.'));
      const href = safeURL(r.source_url); if (href) card.append(node('a', {href, target: '_blank', rel: 'noopener noreferrer'}, 'Open source evidence'));
      details.append(card);
    }
    section.append(details); return section;
  }
  function reportCard(report) {
    const article = node('article', {class: 'kt-permission-card'});
    article.append(node('h4', {}, `${observations[report.observation] || 'Firsthand observation'} · ${report.display_name || 'Camper'}`));
    article.append(node('p', {class: 'kt-fine'}, `${activities[report.activity] || 'Activity unspecified'} · observed ${report.visited_on || 'unknown'} · published report submitted ${String(report.created_at || '').slice(0, 10) || 'unknown'}`));
    if (report.authority_role || report.authority_office) article.append(node('p', {}, `Reported authority: ${report.authority_role || 'unspecified'}; office or organization: ${report.authority_office || 'unspecified'}.`));
    article.append(node('p', {class: 'kt-permission-text'}, report.body));
    if (report.observation === 'stayed_without_asking') article.append(node('p', {}, 'Staying without asking is not permission.'));
    article.append(button('Flag report', () => flag(report.id))); return article;
  }
  function validPlace(place) {
    return place && ['campsite', 'service', 'spot'].includes(place.kind) && typeof place.id === 'string' && place.id.length > 0 && typeof place.name === 'string' && Array.isArray(place.coordinates) && place.coordinates.length === 2 && place.coordinates.every(Number.isFinite) && Math.abs(place.coordinates[0]) <= 180 && Math.abs(place.coordinates[1]) <= 90;
  }
  function canonicalPlace(place) {
    const copy = {kind: place.kind, id: place.id, name: place.name, coordinates: [...place.coordinates]};
    if (copy.kind === 'spot') {
      copy.coordinates = copy.coordinates.map(value => {
        const rounded = Math.sign(value) * Math.floor(Math.abs(value) * 1e5 + 0.5) / 1e5;
        return rounded === 0 ? 0 : rounded;
      });
      copy.id = `spot:${copy.coordinates[1].toFixed(5)},${copy.coordinates[0].toFixed(5)}`;
    }
    return copy;
  }
  async function open(place, activity = 'overnight_occupancy') {
    if (!state.dialog?.open) state.focus = document.activeElement;
    if (!validPlace(place)) {shell('Overnight permission').append(notice('This place lacks a usable location. Reopen it from the map.')); return;}
    state.place = canonicalPlace(place);
    state.activity = Object.hasOwn(activities, activity) ? activity : 'overnight_occupancy';
    const body = shell('Overnight permission'), generation = state.generation, selectedPlace = state.place, selectedActivity = state.activity;
    body.append(node('h3', {}, selectedPlace.name));
    const scope = node('select'); for (const [value, label] of Object.entries(activities)) scope.append(node('option', {value, selected: value === selectedActivity}, label));
    scope.onchange = () => open(selectedPlace, scope.value); body.append(field('Activity scope', scope));
    body.append(node('p', {}, 'Source evidence and personal experiences are separate. Reports never automatically establish permission.'));
    const actions = node('div', {class: 'kt-permission-actions'}); actions.append(button('Share firsthand report', () => edit({place: selectedPlace, activity: selectedActivity})), button('My permission reports', mine)); body.append(actions);
    const source = node('div'), summary = notice('Loading source evidence and published reports…'), list = node('div'), concerns = node('section', {'aria-label': 'Reported concerns'});
    const more = button('Load more reports', () => load(more.dataset.before)); more.hidden = true; body.append(source, node('h3', {}, 'Published firsthand reports'), summary, concerns, list, more);
    const view = {source, summary, list, concerns, more, refresh: () => open(selectedPlace, selectedActivity)}; state.publicView = view;
    const seen = new Set(), concernTypes = new Set();
    async function load(before) {
      more.disabled = true;
      try {
        const out = await request({action: 'read', place: selectedPlace, activity: selectedActivity, ...(before ? {before: Number(before)} : {})}, null, state.controller.signal);
        if (generation !== state.generation) return;
        source.replaceChildren(officialSection(out.official, selectedActivity));
        scheduleExpiry(view, out.official);
        if (out.reports_available === false) {
          summary.replaceChildren(document.createTextNode('Published reports are unavailable. This is not a zero count or a permission decision.'), button('Retry', () => load(before))); more.hidden = true; return;
        }
        const reports = (out.reports || []).filter(r => (!r.status || r.status === 'published') && r.activity === selectedActivity);
        summary.textContent = `${Number(out.count) || 0} published firsthand report${out.count === 1 ? '' : 's'} for this activity. Individual experiences do not establish permission for another visit.`;
        for (const r of reports) if (!seen.has(r.id)) {seen.add(r.id); list.append(reportCard(r)); if (['refused_to_me', 'prohibition_sign_seen'].includes(r.observation)) concernTypes.add(r.observation);}
        concerns.replaceChildren();
        if (concernTypes.size) concerns.append(node('h4', {}, 'Reported concerns'), node('p', {}, 'Published reports include a refusal or a prohibition sign. Review their dates and scope below; these reports do not change the source conclusion.'));
        more.hidden = !out.next_before; more.dataset.before = out.next_before || '';
      } catch (error) {
        if (generation !== state.generation || error.name === 'AbortError') return;
        summary.replaceChildren(document.createTextNode(navigator.onLine ? 'Permission information could not be loaded. Availability and permission remain unknown.' : 'Offline: current permission information and reports are unavailable. This is not a zero count or a permission decision.'), button('Retry', () => load(before)));
      } finally {if (generation === state.generation) more.disabled = false;}
    }
    if (!navigator.onLine) {expirePublic(view, true); return;}
    await load();
  }
  function codePanel(body, token) {
    const input = node('input', {type: 'password', readonly: true, value: token, autocomplete: 'off'});
    body.append(field('Private management code', input, 'Anyone with this code can edit or delete this report. Save it privately; it cannot be recovered from the server.'));
    const show = button('Show code', () => {input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show code' : 'Hide code';});
    const feedback = notice('');
    body.append(show, button('Copy code', async () => {try {await navigator.clipboard.writeText(token); feedback.textContent = 'Code copied.';} catch {feedback.textContent = 'Copy unavailable. Show the code and copy it manually.';}}), feedback);
  }
  function edit(report, token) {
    const body = shell(token ? 'Edit permission report' : 'Share firsthand permission report'), generation = state.generation, started = Date.now();
    const place = report.place || state.place, activity = report.activity || state.activity;
    body.append(node('h3', {}, place.name), node('p', {}, `Activity: ${activities[activity]}`));
    const form = node('form');
    const observation = node('select', {name: 'observation', required: true}); observation.append(node('option', {value: ''}, 'Choose what happened'));
    for (const [value, label] of Object.entries(observations)) observation.append(node('option', {value, selected: value === report.observation}, label));
    form.append(field('Firsthand observation', observation));
    form.append(field('Date observed', node('input', {name: 'visited_on', type: 'date', min: '1900-01-01', max: today(), required: true, value: report.visited_on || ''})), field('Public display name', node('input', {name: 'display_name', minlength: 2, maxlength: 60, required: true, value: report.display_name || '', autocomplete: 'nickname'}), 'A nickname is welcome.'));
    const authority = node('fieldset'); authority.append(node('legend', {}, 'Person who granted or refused permission'));
    const role = node('input', {name: 'authority_role', minlength: 2, maxlength: 120, value: report.authority_role || ''}), office = node('input', {name: 'authority_office', minlength: 2, maxlength: 120, value: report.authority_office || ''});
    authority.append(field('Role or title', role, 'Use a role, not a private person’s name.'), field('Office or organization', office)); form.append(authority);
    function toggleAuthority() {const required = ['granted_to_me', 'refused_to_me'].includes(observation.value); authority.hidden = !required; role.required = office.required = required; role.disabled = office.disabled = !required;}
    observation.onchange = toggleAuthority; toggleAuthority();
    form.append(field('What happened?', node('textarea', {name: 'body', required: true, minlength: 20, maxlength: 3000, rows: 5}, report.body || ''), 'Describe only your own experience, including conditions or limits. Do not include private contact information.'));
    const consent = node('label', {class: 'kt-confirm'}); consent.append(node('input', {type: 'checkbox', name: 'firsthand', required: true}), document.createTextNode(' I confirm this is my firsthand experience.')); form.append(consent);
    form.append(node('p', {}, 'After moderation, this location, observation date, display name, report text and authority role/office will be public. Do not share sensitive locations or private details. Pending reports are never public.'));
    if (token) form.append(node('p', {}, 'Saving edits removes the published report until it is moderated again.'));
    const hp = node('input', {name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', hidden: true}); form.append(hp);
    const feedback = notice(''), send = node('button', {type: 'submit', class: 'btn primary'}, token ? 'Save and resubmit' : 'Send for moderation'); form.append(feedback, send); body.append(form, button('Back to permission information', () => open(place, activity)));
    form.onsubmit = async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const data = new FormData(form), visited = String(data.get('visited_on'));
      if (visited > today()) {feedback.textContent = 'The observation date cannot be in the future.'; return;}
      const payload = {action: token ? 'edit' : 'submit', place, activity, observation: data.get('observation'), visited_on: visited, firsthand: data.get('firsthand') === 'on', display_name: data.get('display_name'), body: data.get('body'), authority_role: data.get('authority_role') || '', authority_office: data.get('authority_office') || '', elapsed_ms: Date.now() - started, website: data.get('website') || '', ...(token ? {id: report.id, version: report.version} : {})};
      send.disabled = true; feedback.textContent = 'Sending report…';
      try {
        const out = await request(payload, token), code = token || out.token;
        const stored = /^[a-f0-9]{64}$/.test(code) && remember({id: out.id || report.id, token: code, name: place.name});
        if (generation !== state.generation) return;
        const done = shell('Permission report received'); done.append(notice('Your report is pending moderation and is not public.'), node('p', {}, stored ? 'The private management code is saved on this device.' : 'The code could not be saved on this device. Copy it now to manage your report.'));
        if (code) codePanel(done, code); done.append(button('My permission reports', mine), button('Back to permission information', () => open(place, activity)));
      } catch (error) {if (generation === state.generation) mutationError(feedback, error, token);}
      finally {if (generation === state.generation) send.disabled = false;}
    };
  }
  function mutationError(target, error, token) {
    target.replaceChildren(document.createTextNode(error.status === 409 ? 'This report changed elsewhere. Your changes have not been saved. Load the latest version before trying again.' : error.message));
    if (error.status === 409) target.append(button('Load latest report', () => manage(token)));
  }
  async function manage(token) {
    const body = shell('Manage permission report'), generation = state.generation; body.append(notice('Loading your report…'));
    try {
      const out = await request({action: 'owner'}, token, state.controller.signal); if (generation !== state.generation) return;
      const r = out.report; body.replaceChildren();
      body.append(node('h3', {}, r.place?.name || 'Your permission report'), node('p', {}, `Status: ${r.status}. Version ${r.version}.`), node('p', {}, `Observed ${r.visited_on} · ${activities[r.activity] || r.activity}`), node('p', {class: 'kt-permission-text'}, r.body));
      if (r.public_note) body.append(node('p', {}, 'Moderator note: ' + r.public_note));
      codePanel(body, token);
      if (r.status !== 'deleted') {
        body.append(button('Edit report', () => edit(r, token)), button('Delete report', () => {
          const confirm = shell('Delete permission report'), confirmGeneration = state.generation;
          confirm.append(node('p', {}, 'Permanently delete this permission report and remove it from public view?'));
          const feedback = notice(''), remove = button('Confirm delete', async () => {
            remove.disabled = true;
            try {await request({action: 'delete', id: r.id, version: r.version}, token); forget(token); if (confirmGeneration !== state.generation) return; shell('Permission report deleted').append(notice('Your report has been deleted.'), button('My permission reports', mine));}
            catch (error) {if (confirmGeneration === state.generation) {mutationError(feedback, error, token); remove.disabled = false;}}
          }); confirm.append(remove, button('Keep report', () => manage(token)), feedback);
        }));
      }
      body.append(button('My permission reports', mine));
    } catch (error) {
      if (generation !== state.generation || error.name === 'AbortError') return;
      body.replaceChildren(notice(error.status === 404 ? 'No report was found for this code. It may have been deleted, or the code may be incorrect.' : error.message), button('Retry', () => manage(token)), button('My permission reports', mine));
    }
  }
  function mine() {
    const body = shell('My permission reports'), list = node('ul'), rows = saved();
    body.append(node('p', {}, 'Only private management codes and report labels are saved on this device. Published reports are fetched fresh.'));
    for (const r of rows) {const li = node('li'); li.append(button(r.name || 'Permission report', () => manage(r.token))); list.append(li);}
    if (!rows.length) body.append(node('p', {}, 'No management codes are saved on this device.'));
    body.append(list);
    const form = node('form'), code = node('input', {type: 'password', required: true, pattern: '[a-f0-9]{64}', autocomplete: 'off'});
    form.append(field('Restore a private management code', code), node('button', {type: 'submit', class: 'btn'}, 'Open my report'));
    form.onsubmit = event => {event.preventDefault(); if (form.reportValidity()) manage(code.value.trim());}; body.append(form);
    if (state.place) body.append(button('Back to permission information', () => open(state.place, state.activity)));
  }
  function flag(id) {
    const body = shell('Flag permission report'), generation = state.generation, started = Date.now(), form = node('form');
    const reason = node('textarea', {required: true, minlength: 10, maxlength: 1000, rows: 4}); form.append(field('Reason for flagging', reason));
    const feedback = notice(''), send = node('button', {type: 'submit', class: 'btn'}, 'Send flag'); form.append(feedback, send); body.append(form);
    form.onsubmit = async event => {event.preventDefault(); if (!form.reportValidity()) return; send.disabled = true;
      try {await request({action: 'flag', id, reason: reason.value, elapsed_ms: Date.now() - started, website: ''}); if (generation === state.generation) shell('Flag received').append(notice('A moderator will review this report.'), button('Back to permission information', () => open(state.place, state.activity)));}
      catch (error) {if (generation === state.generation) {feedback.textContent = error.message; send.disabled = false;}}
    };
  }
  window.KampTrailPermissions = {version: '2.15.1', open, mine};
})();
