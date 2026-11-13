/* Dangaske Real Estate v3: inspections (fee confirms booking), chat, saved items, receipts & vault, reviews,
   title checks, purchase tracker, map, compare, affordability, referrals, SPV unit resale. */
(() => {
  const DG = window.DG;
  const { $, app, S, e, money, price, cap, date, status, opts, api, toast, busy, formData, go, needLogin, modal, closeModal, cards, render } = DG;
  const route = (re, fn) => DG.routes.push([re, fn]);
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };
  const when = (slot) => `${new Date(slot).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}, ${slot.slice(11, 16)}`;
  const stars = (n) => `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}</span>`;
  const payTo = async (path, body) => { const r = await api(path, { method: 'POST', body }); if (r.url) location.href = r.url; return r; };

  // referral code from ?ref= is remembered until sign-up
  const refParam = new URLSearchParams(location.search).get('ref');
  if (refParam) store.set('ref', refParam.slice(0, 12));
  DG.ref = () => store.get('ref', '');

  /** Date calendar + hourly time slots (taken or too-soon times are disabled). Returns a function giving 'YYYY-MM-DDTHH:MM'. */
  function slotPicker(box, propertyId) {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    box.innerHTML = `<div><label>Date</label><input type="date" name="date" min="${today}" required></div><div><label>Time <span class="small muted">(8am–5pm)</span></label><select name="time" disabled><option value="">Choose a date first</option></select></div>`;
    const d = $('[name=date]', box), t = $('[name=time]', box);
    d.addEventListener('change', async () => {
      if (!d.value) return;
      t.disabled = true; t.innerHTML = '<option value="">Loading…</option>';
      const r = await api(`/properties/${propertyId}/slots?date=${d.value}`).catch(() => ({ booked: [] }));
      const soon = Date.now() + 2 * 3600e3, list = [];
      for (let h = 8; h <= 17; h++) {
        const hh = String(h).padStart(2, '0') + ':00', taken = r.booked.includes(hh), past = new Date(`${d.value}T${hh}`).getTime() < soon;
        list.push(`<option value="${hh}"${taken || past ? ' disabled' : ''}>${hh}${taken ? ' — booked' : past ? ' — too soon' : ''}</option>`);
      }
      t.innerHTML = '<option value="">Choose a time</option>' + list.join(''); t.disabled = false;
    });
    return () => (d.value && t.value ? `${d.value}T${t.value}` : '');
  }

  // ---------- card actions ----------
  Object.assign(DG.ACTIONS, {
    fav: (b) => { const run = () => busy(b, async () => { const r = await api(`/properties/${b.dataset.id}/favourite`, { method: 'POST' }); b.textContent = b.dataset.long ? (r.fav ? '♥ Saved' : '♡ Save') : r.fav ? '♥' : '♡'; toast(r.fav ? 'Saved to your favourites.' : 'Removed from favourites.'); }); if (!needLogin(run)) run(); },
    cmp: (b) => {
      const id = Number(b.dataset.id); let list = store.get('cmp', []);
      if (list.includes(id)) list = list.filter((x) => x !== id); else { if (list.length >= 3) return toast('You can compare up to 3 properties.', true); list.push(id); }
      store.set('cmp', list); toast(list.includes(id) ? `Added to compare (${list.length}/3). Open “Compare” to view.` : 'Removed from compare.');
    },
    savesearch: (b) => {
      const query = Object.fromEntries(new URLSearchParams(location.search).entries()); delete query.page; delete query.sort;
      const run = () => { const name = prompt('Name this search (you will be alerted when new listings match):', Object.values(query).join(' · ')); if (name !== null) busy(b, async () => { await api('/saved-searches', { method: 'POST', body: { name, query } }); toast('Search saved. We will alert you about new matches.'); }); };
      if (!needLogin(run)) run();
    },
    edocs: (b) => busy(b, async () => { await api(`/admin/escrows/${b.dataset.id}/docs-checked`, { method: 'POST' }); render(); }),
  });

  // ---------- purchase tracker shown on every escrow ----------
  DG.tracker = (x) => {
    const dead = ['cancelled', 'refunded'].includes(x.status);
    const steps = [['Offer', true], ['Paid into escrow', !['awaiting_payment', 'cancelled'].includes(x.status)], ['Documents checked', Boolean(x.docs_checked) || x.status === 'released'], ['Handover', x.status === 'released']];
    return dead ? '' : `<div class="track">${steps.map(([t, on]) => `<span class="${on ? 'done' : ''}">${t}</span>`).join('')}</div>`;
  };

  // ---------- property page extras ----------
  DG.propertyExtras = (p) => {
    const fee = p.inspection_fee, sold = p.status === 'sold';
    const min = new Date(Date.now() + 3 * 3600 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#px').innerHTML = `${!sold && !p.can_manage ? `<div class="card" style="border-color:var(--gold-2)"><h3>Book an inspection</h3>
        <form id="insp" class="grid"><div id="sp" class="grid"></div>
        <div><label>Note <span class="small muted">(optional)</span></label><input name="note" maxlength="300" placeholder="e.g. coming with my surveyor"></div>
        <button class="btn gold block">${fee ? `Pay <span class="notranslate">${money(fee)}</span> to confirm` : 'Confirm booking'}</button></form>
        <p class="small muted">${fee ? `The inspection fee confirms your appointment${p.locked ? ', unlocks the full address' : ''} and is <b>deducted from the price</b> if you buy through escrow.${p.type === 'land' ? ' For land the fee depends on the distance from the city centre.' : ''}` : 'The agent will be notified at once.'}</p></div>` : ''}
      <div class="row"><button class="btn sm ghost" data-act="fav" data-long="1" data-id="${p.id}">${p.fav ? '♥ Saved' : '♡ Save'}</button><button class="btn sm ghost" data-act="cmp" data-id="${p.id}">⇄ Compare</button>
        ${!p.can_manage && !p.locked ? `<button class="btn sm" id="chatbtn">💬 Message agent</button>` : ''}</div>
      ${!sold && !p.can_manage && S.cfg.title_check_fee ? `<div class="card"><h3>Title verification report</h3><p class="small muted">We search the land registry for this property and send you a written report on ownership and encumbrances.</p><button class="btn sm block" id="tcbtn">Order for <span class="notranslate">${money(S.cfg.title_check_fee)}</span></button></div>` : ''}`;
    const near = String(p.nearby || '').split(',').map((x) => x.trim()).filter(Boolean);
    const d = 0.006;
    $('#pmain').innerHTML = `${p.agent && p.agent.reviews ? `<p class="small">${stars(p.agent.rating)} ${p.agent.rating} from ${p.agent.reviews} review${p.agent.reviews > 1 ? 's' : ''} of <a href="/agents/${p.agent.id}" data-link>${e(p.agent.name)}</a></p>` : ''}
      ${near.length ? `<h3>Nearby</h3><div class="chips">${near.map((x) => `<span class="chip">${e(x)}</span>`).join('')}</div>` : ''}
      ${p.tour_url ? `<p style="margin-top:14px"><a class="btn sm" href="${e(p.tour_url)}" target="_blank" rel="noopener">▶ Open virtual tour</a></p>` : p.has_tour && p.locked ? '<p class="small muted">🎥 A virtual tour is available once unlocked.</p>' : ''}
      ${p.lat != null && p.lng != null ? `<h3 style="margin-top:14px">Location</h3><iframe class="osm" loading="lazy" title="Map" src="https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - d}%2C${p.lat - d}%2C${p.lng + d}%2C${p.lat + d}&amp;layer=mapnik&amp;marker=${p.lat}%2C${p.lng}"></iframe>` : p.approx && p.locked ? '<p class="small muted">📍 The exact map location is shown once unlocked.</p>' : ''}`;
    const f = $('#insp');
    const getSlot = f ? slotPicker($('#sp'), p.id) : null;
    if (f) f.addEventListener('submit', (ev) => { ev.preventDefault(); const run = () => busy($('button', f), async () => { const slot = getSlot(); if (!slot) { toast('Pick a date and a time from the calendar.', true); return; } const r = await payTo(`/properties/${p.id}/inspections`, { ...formData(f), slot }); if (r.confirmed) { toast('Inspection confirmed.'); go('/dashboard?tab=inspections'); } }); if (!needLogin(run)) run(); });
    const cb = $('#chatbtn');
    if (cb) cb.addEventListener('click', () => { const run = () => busy(cb, async () => { const r = await api(`/properties/${p.id}/chat`, { method: 'POST' }); go(`/dashboard?tab=messages&t=${r.id}`); }); if (!needLogin(run)) run(); });
    const tc = $('#tcbtn');
    if (tc) tc.addEventListener('click', () => { const run = () => busy(tc, () => payTo(`/properties/${p.id}/title-check`)); if (!needLogin(run)) run(); });
  };

  // ---------- dashboard: messages ----------
  let poll = null;
  DG.dashTabs.messages = async () => {
    const q = new URLSearchParams(location.search), open = Number(q.get('t')) || 0;
    const list = await api('/my/threads');
    const cur = open ? await api('/threads/' + open) : null;
    return `<div class="chat"><div class="tlist">${list.map((t) => `<a href="/dashboard?tab=messages&t=${t.id}" data-link class="${t.id === open ? 'on' : ''} ${t.unread ? 'unread' : ''}"><b>${e(t.with)}</b><br><span class="small muted">${e(t.property_title)}</span><br><span class="small">${e(t.last)}</span></a>`).join('') || (cur ? '' : '<p class="muted">No conversations yet. Open a listing you have unlocked and tap “Message agent”.</p>')}</div>
      <div>${cur ? `<p><b>${e(cur.with)}</b> · <a href="/p/${cur.property_id}" data-link>${e(cur.property_title)}</a></p><div class="msgs" id="msgs" data-t="${cur.id}"></div>
        <form id="sendf" class="row" style="margin-top:8px"><input name="body" maxlength="2000" placeholder="Type a message" autocomplete="off" style="flex:1" required><button class="btn">Send</button></form>
        <p class="small muted">Keep payments on the platform — never pay a seller outside escrow.</p>` : list.length ? '<p class="muted">Choose a conversation.</p>' : ''}</div></div>`;
  };
  function bindChat() {
    clearInterval(poll);
    const box = $('#msgs'); if (!box) return;
    let last = 0;
    const load = async () => {
      if (!document.body.contains(box)) return clearInterval(poll);
      const r = await api(`/threads/${box.dataset.t}?after=${last}`).catch(() => null);
      if (!r || !r.messages.length) return;
      last = r.messages[r.messages.length - 1].id;
      box.insertAdjacentHTML('beforeend', r.messages.map((m) => `<div class="msg ${m.mine ? 'me' : ''}">${e(m.body)}<small>${e(m.created_at.slice(5, 16))}</small></div>`).join(''));
      box.scrollTop = box.scrollHeight;
    };
    load(); poll = setInterval(load, 5000);
    const f = $('#sendf');
    f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), async () => { await api(`/threads/${box.dataset.t}/messages`, { method: 'POST', body: formData(f) }); f.reset(); await load(); f.body.focus(); }); });
  }

  // ---------- dashboard: inspections ----------
  DG.dashTabs.inspections = async () => {
    const rows = await api('/my/inspections');
    if (!rows.length) return '<p class="muted">No inspections yet. Book one from any listing.</p>';
    return `<div class="tablewrap"><table><tr><th>When</th><th>Property</th><th>With</th><th>Status</th><th></th></tr>${rows.map((i) => {
      const ok = i.status === 'confirmed', acts = [];
      if (ok) acts.push(`<button class="btn sm ghost" data-ires="${i.id}" data-prop="${i.property_id}">Reschedule</button>`);
      if (ok && i.role === 'agent') acts.push(`<button class="btn sm" data-ist="${i.id}" data-s="completed">Done</button>`, `<button class="btn sm ghost" data-ist="${i.id}" data-s="no_show">No-show</button>`);
      if (ok || (i.status === 'awaiting_payment' && i.role === 'buyer')) acts.push(`<button class="btn sm ghost" data-ist="${i.id}" data-s="cancelled">Cancel</button>`);
      return `<tr><td class="nowrap"><b>${when(i.slot)}</b></td><td><a href="/p/${i.property_id}" data-link>${e(i.property_title)}</a>${ok && i.role === 'buyer' && i.address ? `<br><span class="small">${e(i.address)}</span>` : ''}${i.note ? `<br><span class="small muted">“${e(i.note)}”</span>` : ''}</td>
        <td class="small notranslate">${i.role === 'agent' ? `${e(i.buyer_name)}<br>+${e(i.buyer_phone)}` : i.status === 'awaiting_payment' ? '—' : `${e(i.agent_name)}<br>${e(i.contact_phone)}`}</td>
        <td>${status(i.status)}<br><span class="small muted notranslate">${i.fee ? money(i.fee) + (i.status === 'awaiting_payment' ? ' unpaid' : ' paid') : 'No fee'}</span></td><td><div class="row">${acts.join('')}</div></td></tr>`;
    }).join('')}</table></div><p class="small muted">Inspection fees are deducted from the price if you buy through escrow. If the agent cancels a paid inspection, the fee is refunded.</p>`;
  };

  // ---------- dashboard: saved ----------
  DG.dashTabs.saved = async () => {
    const [favs, searches] = await Promise.all([api('/my/favourites'), api('/saved-searches')]);
    return `<h3>Saved searches</h3>${searches.map((s) => `<div class="card spread" style="margin-bottom:8px"><span><b>${e(s.name)}</b><br><span class="small muted">${e(Object.entries(s.query).map(([k, v]) => `${k}: ${v}`).join(' · '))}</span></span><span class="row"><a class="btn sm" data-link href="/listings?${DG.cleanQuery(s.query)}">View</a><button class="btn sm ghost" data-dels="${s.id}">Remove</button></span></div>`).join('') || '<p class="muted">None yet. Filter the listings page, then tap “Save this search”.</p>'}
      <h3 style="margin-top:22px">Favourites</h3>${cards(favs, 'No favourites yet. Tap the heart on any listing.')}`;
  };

  // ---------- dashboard: receipts, title reports, documents ----------
  DG.dashTabs.payments = async () => {
    const [pays, tcs, docs, pend] = await Promise.all([api('/my/payments'), api('/my/title-checks'), api('/my/documents'), api('/my/pending-payments')]);
    return `${pend.length ? `<h3>Bank transfers awaiting confirmation</h3>${pend.map((x) => `<div class="card spread" style="margin-bottom:8px"><span><b class="notranslate">${money(x.amount)}</b> · ${e(x.label)}${x.item ? ' — ' + e(x.item) : ''}<br><span class="small muted notranslate">Reference ${e(x.reference)} · ${x.claimed_at ? 'we are checking for your payment' : 'not marked as paid yet'}</span></span><a class="btn sm ${x.claimed_at ? 'ghost' : 'gold'}" href="/pay/transfer?reference=${e(x.reference)}" data-link>${x.claimed_at ? 'View' : 'Pay now'}</a></div>`).join('')}` : ''}<h3>Receipts</h3>${pays.length ? `<div class="tablewrap"><table><tr><th>Date</th><th>For</th><th>Amount</th><th></th></tr>${pays.map((p) => `<tr><td>${date(p.paid_at)}</td><td>${e(p.label)}${p.item ? `<br><span class="small muted">${e(p.item)}</span>` : ''}</td><td class="notranslate">${money(p.amount)}</td><td><a class="btn sm ghost" href="/api/payments/${e(p.reference)}/receipt" target="_blank" rel="noopener">Receipt ↗</a></td></tr>`).join('')}</table></div>` : '<p class="muted">No payments yet.</p>'}
      ${tcs.length ? `<h3 style="margin-top:22px">Title verification reports</h3>${tcs.map((t) => `<div class="card" style="margin-bottom:8px"><div class="spread"><b>${e(t.property_title)}</b>${status(t.status === 'requested' ? 'pending' : t.status)}</div>${t.result ? `<p class="prose">${e(t.result)}</p><span class="small muted">Completed ${date(t.completed_at)}</span>` : '<p class="small muted">Our team is carrying out the search.</p>'}</div>`).join('')}` : ''}
      <h3 style="margin-top:22px">Document vault</h3><p class="small muted">Offer letters, deeds, survey plans and agreements. Private to you and our staff.</p>
      ${docs.map((d) => `<div class="card spread" style="margin-bottom:8px"><span><b>${e(d.title)}</b><br><span class="small muted">${date(d.created_at)}${d.property_title ? ' · ' + e(d.property_title) : ''}${d.from_company ? ' · from ' + e(S.cfg.company) : ''}</span></span><span class="row"><a class="btn sm" href="/api/documents/${d.id}/file" target="_blank" rel="noopener">Open ↗</a>${d.from_company ? '' : `<button class="btn sm ghost" data-deld="${d.id}">Delete</button>`}</span></div>`).join('') || '<p class="muted">No documents yet.</p>'}
      <form id="docf" class="card grid" style="max-width:560px;margin-top:10px"><b>Add a document</b><input name="title" placeholder="Name, e.g. Survey plan" required maxlength="120"><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><div><button class="btn sm">Upload</button></div></form>`;
  };

  // ---------- dashboard: referrals ----------
  DG.dashTabs.referrals = async () => {
    const r = await api('/my/referrals');
    return `<div class="card" style="max-width:640px"><h3>Refer & earn</h3><p class="muted">Share your link. ${r.reward ? `You earn <b class="notranslate">${money(r.reward)}</b> when someone you invite completes a purchase, plan payment or investment.` : 'You will be credited when someone you invite completes a purchase.'}</p>
      <div class="row"><input readonly value="${e(r.link)}" style="flex:1" class="notranslate" aria-label="Your referral link"><button class="btn sm" data-act="copy" data-url="${e(r.link)}">Copy</button><a class="btn sm ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Find verified property on ' + S.cfg.site_name + ': ' + r.link)}">Share on WhatsApp</a></div>
      <p class="small muted">Your code: <b class="notranslate">${e(r.code)}</b></p></div>
      <h3 style="margin-top:20px">People you invited (${r.referred.length})</h3>${r.referred.length ? `<div class="tablewrap"><table><tr><th>Name</th><th>Joined</th><th>Reward</th></tr>${r.referred.map((x) => `<tr><td>${e(x.name)}</td><td>${date(x.joined)}</td><td>${x.qualified ? '<span class="status active">Earned</span>' : '<span class="status pending">Not yet</span>'}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nobody yet.</p>'}`;
  };

  const prevBind = DG.dashBind;
  DG.dashBind = (tab) => {
    if (prevBind) prevBind(tab);
    clearInterval(poll);
    if (tab === 'messages') bindChat();
    const on = (sel, fn) => app.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => busy(b, async () => { if ((await fn(b)) !== false) render(); })));
    on('[data-ist]', (b) => (b.dataset.s !== 'cancelled' || confirm('Cancel this inspection?') ? api(`/inspections/${b.dataset.ist}/status`, { method: 'POST', body: { status: b.dataset.s } }) : false));
    on('[data-ires]', (b) => {
      const m = modal('<h2>Reschedule inspection</h2><div id="rsp" class="grid"></div><p><button class="btn block" id="rgo">Confirm new time</button></p>');
      const get = slotPicker($('#rsp', m), b.dataset.prop);
      $('#rgo', m).addEventListener('click', () => { const slot = get(); if (!slot) return toast('Pick a date and a time.', true); busy($('#rgo', m), async () => { await api(`/inspections/${b.dataset.ires}/reschedule`, { method: 'POST', body: { slot } }); closeModal(); toast('Inspection rescheduled.'); render(); }); });
      return false;
    });
    on('[data-dels]', (b) => api('/saved-searches/' + b.dataset.dels, { method: 'DELETE' }));
    on('[data-deld]', (b) => (confirm('Delete this document?') ? api('/documents/' + b.dataset.deld, { method: 'DELETE' }) : false));
    const df = $('#docf'); if (df) df.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', df), async () => { await api('/documents', { method: 'POST', form: new FormData(df) }); toast('Document saved.'); render(); }); });
  };

  // ---------- agent reviews ----------
  DG.agentExtras = async (p) => {
    const r = await api(`/agents/${p.id}/reviews`).catch(() => null);
    const box = $('#rev'); if (!r || !box) return;
    box.innerHTML = `<h2>Reviews ${r.count ? `${stars(r.avg)} <span class="small muted">${r.avg} · ${r.count}</span>` : ''}</h2>
      ${r.can_review.length ? `<form id="revf" class="card grid" style="max-width:560px;margin-bottom:14px"><b>Rate your experience</b><select name="property_id">${opts(r.can_review.map((x) => [x.id, x.title]))}</select><select name="rating">${opts([5, 4, 3, 2, 1].map((n) => [n, '★'.repeat(n) + ' ' + n]))}</select><textarea name="comment" maxlength="600" placeholder="How did it go?" style="min-height:70px"></textarea><div><button class="btn sm">Post review</button></div></form>` : ''}
      ${r.items.map((x) => `<div class="card" style="margin-bottom:8px">${stars(x.rating)} <b>${e(x.name)}</b> <span class="small muted">· ${date(x.created_at)}</span>${x.comment ? `<p class="prose" style="margin:6px 0 0">${e(x.comment)}</p>` : ''}</div>`).join('') || '<p class="muted">No reviews yet. Reviews can only be left after a completed inspection or purchase.</p>'}`;
    const f = $('#revf'); if (f) f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), async () => { await api(`/agents/${p.id}/reviews`, { method: 'POST', body: formData(f) }); toast('Thank you for your review.'); render(); }); });
  };

  // ---------- SPV unit resale ----------
  DG.spvExtras = async (s) => {
    const m = await api(`/spvs/${s.id}/market`).catch(() => null);
    const box = $('#mkt'); if (!m || !m.enabled || !box) return;
    box.innerHTML = `<h3 style="margin-top:20px">Units for resale</h3><p class="small muted">Investors can sell units to other verified members. Price is set by the seller.</p>
      ${m.listings.length ? `<div class="tablewrap"><table><tr><th>Units</th><th>Price per unit</th><th>Total</th><th></th></tr>${m.listings.map((l) => `<tr><td>${l.units}</td><td class="notranslate">${money(l.price_per_unit)}</td><td class="notranslate">${money(l.units * l.price_per_unit)}</td><td>${l.mine ? `<button class="btn sm ghost" data-ulc="${l.id}">Withdraw</button>` : `<button class="btn sm gold" data-ulb="${l.id}">Buy</button>`}</td></tr>`).join('')}</table></div>` : '<p class="muted small">No units are on offer right now.</p>'}
      ${m.available > 0 ? `<form id="sellf" class="row" style="margin-top:10px"><input name="units" type="number" min="1" max="${m.available}" placeholder="Units (you have ${m.available})" required style="max-width:220px"><input name="price_per_unit" inputmode="numeric" placeholder="Price per unit ₦" required style="max-width:200px"><button class="btn sm">List my units for sale</button></form>` : ''}`;
    box.querySelectorAll('[data-ulb]').forEach((b) => b.addEventListener('click', () => { const run = () => { if (confirm('Buy these units? Property investment puts your capital at risk; returns are not guaranteed.')) busy(b, async () => { try { await payTo(`/unit-listings/${b.dataset.ulb}/buy`, { accept_risk: true }); } catch (err) { if (err.status === 403) { toast(err.message, true); go('/dashboard?tab=verify'); } else throw err; } }); }; if (!needLogin(run)) run(); }));
    box.querySelectorAll('[data-ulc]').forEach((b) => b.addEventListener('click', () => busy(b, async () => { await api(`/unit-listings/${b.dataset.ulc}/cancel`, { method: 'POST' }); render(); })));
    const f = $('#sellf'); if (f) f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), async () => { await api(`/spvs/${s.id}/market`, { method: 'POST', body: formData(f) }); toast('Your units are listed.'); render(); }); });
  };

  // ---------- compare ----------
  route(/^\/compare$/, async () => {
    const ids = store.get('cmp', []);
    const items = (await Promise.all(ids.map((id) => api('/properties/' + id).catch(() => null)))).filter(Boolean);
    const row = (label, fn) => `<tr><th>${label}</th>${items.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
    app.innerHTML = `<h1 style="margin-top:28px">Compare properties</h1>${items.length ? `<div class="tablewrap"><table class="cmp">
      ${row('', (p) => `${p.cover_thumb ? `<img src="${e(p.cover_thumb)}" alt="">` : ''}<br><a href="/p/${p.id}" data-link><b>${e(p.title)}</b></a>`)}
      ${row('Price', (p) => `<b class="notranslate">${price(p.price)}</b>`)}${row('Purpose', (p) => 'For ' + e(p.purpose))}${row('Type', (p) => e(cap(p.type)))}${row('Location', (p) => e(DG.place(p)))}
      ${row('Bedrooms', (p) => p.bedrooms || '—')}${row('Bathrooms', (p) => p.bathrooms || '—')}${row('Size', (p) => (p.size_sqm ? p.size_sqm.toLocaleString() + ' m²' : '—'))}
      ${row('Price per m²', (p) => (p.size_sqm ? `<span class="notranslate">${price(Math.round(p.price / p.size_sqm))}</span>` : '—'))}
      ${row('Verified', (p) => (p.verified ? '✔ Yes' : 'Not yet'))}${row('Easy-buy', (p) => (p.easy_buy ? '✔ Available' : '—'))}${row('Nearby', (p) => e(p.nearby || '—'))}${row('Status', (p) => status(p.status))}
      ${row('', (p) => `<button class="btn sm ghost" data-act="cmp" data-id="${p.id}" data-rerender="1">Remove</button>`)}</table></div>` : '<p class="muted pad center">Nothing to compare yet. Tap ⇄ on up to three listings.</p>'}
      <p style="margin-top:16px"><a class="btn" href="/listings" data-link>Browse properties</a></p>`;
    app.querySelectorAll('[data-rerender]').forEach((b) => b.addEventListener('click', () => setTimeout(render, 50)));
  });

  // ---------- map search (public pins are approximate) ----------
  const loadLeaflet = () => new Promise((ok, bad) => {
    if (window.L) return ok();
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = ok; s.onerror = () => bad(new Error('map')); document.head.appendChild(s);
  });
  route(/^\/map$/, async () => {
    const pins = (await api('/properties?limit=48&available=1')).items.filter((p) => p.approx);
    app.innerHTML = `<h1 style="margin-top:28px">Map search</h1><p class="muted">Pins show the approximate area of each property. The exact address is shown when you unlock a listing or book an inspection.</p><div id="mapbox"></div>
      ${pins.length ? '' : '<p class="muted">No listings have a map location yet.</p>'}`;
    try {
      await loadLeaflet();
      if (!$('#mapbox')) return;
      const map = window.L.map('mapbox').setView(pins.length ? pins[0].approx : [9.08, 8.68], pins.length ? 11 : 6);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      pins.forEach((p) => window.L.circle(p.approx, { radius: 600, color: '#14148a', fillColor: '#d81f2a', fillOpacity: 0.5 }).addTo(map).bindPopup(`<b>${e(p.title)}</b><br>${e(price(p.price))}<br><a href="/p/${p.id}">View property</a>`));
      if (pins.length > 1) map.fitBounds(pins.map((p) => p.approx), { padding: [30, 30] });
    } catch { const b = $('#mapbox'); if (b) b.outerHTML = '<p class="card">The map could not be loaded. Please check your connection and try again.</p>'; }
  });

  // ---------- easy-buy affordability calculator ----------
  route(/^\/easy-buy$/, async () => {
    await DG.easyBuyPage();
    const plans = await api('/plans');
    app.insertAdjacentHTML('beforeend', `<section class="card" style="max-width:760px"><h2>What can I afford?</h2><form id="aff" class="grid g3"><div><label>Monthly income (₦)</label><input name="income" inputmode="numeric" required></div><div><label>Deposit you have (₦)</label><input name="deposit" inputmode="numeric" required></div><div style="align-self:end"><button class="btn block">Calculate</button></div></form><div id="affout" style="margin-top:14px"></div>
      <p class="small muted">Estimate only. Assumes instalments of up to one third of your monthly income.</p></section>`);
    $('#aff').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const n = (v) => Number(String(v).replace(/[^\d.]/g, '')) || 0, f = formData(ev.target), inc = n(f.income), dep = n(f.deposit);
      $('#affout').innerHTML = `<div class="tablewrap"><table><tr><th>Plan</th><th>Property price up to</th><th>Your monthly payment</th><th></th></tr>${plans.map((p) => {
        const m = 1 + p.markup_pct / 100, d = p.deposit_pct / 100;
        const max = Math.floor(Math.min(dep / (d * m), ((inc / 3) * p.months) / ((1 - d) * m)) / 1000) * 1000;
        return `<tr><td><b>${e(p.name)}</b><br><span class="small muted">${p.months} months</span></td><td class="notranslate"><b>${money(max)}</b></td><td class="notranslate">${money(Math.ceil((max * m * (1 - d)) / p.months))}</td><td>${max > 0 ? `<a class="btn sm" data-link href="/listings?easy=1&max=${max}">See properties</a>` : ''}</td></tr>`;
      }).join('')}</table></div>`;
    });
  });

  // ---------- admin service desk ----------
  DG.adminTabs.desk = async (d) => {
    const k = await api('/admin/desk');
    return `<div class="stats" style="margin-bottom:16px"><div class="stat"><b class="notranslate">${money(k.fees.collected)}</b>Inspection fees collected</div><div class="stat"><b>${k.inspections.filter((i) => i.status === 'confirmed').length}</b>Upcoming inspections</div><div class="stat"><b>${k.title_checks.filter((t) => t.status === 'requested').length}</b>Title checks to do</div><div class="stat"><b>${k.referrals.filter((x) => x.qualified).length}</b>Referral rewards earned</div></div>
      <h3>Inspections</h3><div class="tablewrap"><table><tr><th>When</th><th>Property</th><th>Buyer</th><th>Agent</th><th>Fee</th><th>Status</th></tr>${k.inspections.map((i) => `<tr><td class="nowrap">${when(i.slot)}</td><td><a href="/p/${i.property_id}" data-link>${e(i.property_title)}</a></td><td class="small notranslate">${e(i.buyer_name)} +${e(i.buyer_phone)}</td><td class="small">${e(i.agent_name)}</td><td class="notranslate">${money(i.fee)}</td><td>${status(i.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">None yet.</td></tr>'}</table></div>
      <h3 style="margin-top:22px">Title verification requests</h3>${k.title_checks.map((t) => `<form class="card grid tcf" data-id="${t.id}" style="margin-bottom:10px"><div class="spread"><b><a href="/p/${t.property_id}" data-link>${e(t.property_title)}</a></b>${status(t.status === 'requested' ? 'pending' : t.status)}</div><span class="small muted notranslate">${e(t.user_name)} +${e(t.user_phone)} · document on listing: ${e(t.title_doc || 'not stated')}</span>
        ${t.status === 'completed' ? `<p class="prose">${e(t.result)}</p>` : '<textarea name="result" required minlength="10" maxlength="4000" placeholder="Findings of the registry search: registered owner, title type and number, encumbrances, disputes, recommendation."></textarea><div><button class="btn sm">Send report</button></div>'}</form>`).join('') || '<p class="muted">None.</p>'}
      <h3 style="margin-top:22px">Send a document to a member's vault</h3><form id="adoc" class="card grid g4 keep2"><select name="user_id" required>${opts(d.users.map((u) => [u.id, `${u.name || 'Member'} +${u.phone}`]), '', 'Choose member')}</select><input name="title" placeholder="e.g. Offer letter" required><input type="file" name="file" accept="application/pdf,image/*" required><button class="btn sm">Upload</button></form>
      <h3 style="margin-top:22px">Referrals</h3><div class="tablewrap"><table><tr><th>Referrer</th><th>Invited</th><th>Joined</th><th>Reward due</th></tr>${k.referrals.map((x) => `<tr><td class="notranslate">${e(x.referrer)} +${e(x.referrer_phone)}</td><td>${e(x.name)}</td><td>${date(x.created_at)}</td><td>${x.qualified ? `<span class="status active notranslate">${money(S.cfg.referral_reward)}</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet.</td></tr>'}</table></div>
      ${k.unit_trades.length ? `<h3 style="margin-top:22px">SPV unit resales</h3><div class="tablewrap"><table><tr><th>Offer</th><th>Seller (pay out)</th><th>Buyer</th><th>Units × price</th><th>Status</th></tr>${k.unit_trades.map((u) => `<tr><td>${e(u.title)}</td><td class="notranslate">${e(u.seller_name)} +${e(u.seller_phone)}</td><td>${e(u.buyer_name || '—')}</td><td class="notranslate">${u.units} × ${money(u.price_per_unit)}</td><td>${status(u.status)}</td></tr>`).join('')}</table></div>` : ''}`;
  };
  const prevAdmin = DG.adminBind;
  DG.adminBind = (tab, d) => {
    if (prevAdmin) prevAdmin(tab, d);
    app.querySelectorAll('.tcf').forEach((f) => f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), async () => { await api(`/admin/title-checks/${f.dataset.id}/complete`, { method: 'POST', body: formData(f) }); toast('Report sent.'); render(); }); }));
    const a = $('#adoc'); if (a) a.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', a), async () => { await api('/documents', { method: 'POST', form: new FormData(a) }); toast('Document sent to the member.'); a.reset(); }); });
  };
  void modal; void closeModal;
})();
