/* Dangaske Real Estate v2 pages: discovery, professionals, trust centre, SPV investment, insights, company. */
(() => {
  const DG = window.DG;
  const { $, app, S, e, money, price, cap, date, status, opts, api, toast, busy, formData, go, needLogin, modal, closeModal, cards, STATES, render, vbadge } = DG;
  const route = (re, fn) => DG.routes.push([re, fn]);
  const h1 = (t, sub) => `<h1 style="margin-top:28px">${t}</h1>${sub ? `<p class="muted" style="max-width:66ch">${sub}</p>` : ''}`;
  const TYPE = { individual: 'Member', agent: 'Agent', agency: 'Agency', developer: 'Developer', service: 'Service provider' };
  let META = null;
  const meta = async () => META || (META = await api('/meta'));
  const co = () => `<span class="notranslate">${e(S.cfg.company)}</span>`;
  const site = () => `<span class="notranslate">${e(S.cfg.site_name)}</span>`;

  DG.ACTIONS.joinsvc = () => { DG.presetRole = 'service'; DG.openLogin(); };

  // ---------- header extras: currency, search palette, WhatsApp button, app install ----------
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installEvt = ev; const b = $('#install'); if (b) b.hidden = false; });
  DG.ACTIONS.install = async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } else toast('Open your browser menu and choose “Add to Home screen” / “Install app”.'); };

  DG.onBoot.push(() => {
    const cur = $('#cur');
    cur.innerHTML = opts(['NGN', ...Object.keys(S.cfg.currency_rates || {})].map((c) => [c, c]), DG.currency());
    cur.addEventListener('change', () => { try { localStorage.setItem('cur', cur.value); } catch { /* ignore */ } render(); });
    const wa = String(S.cfg.support_whatsapp || '').replace(/\D/g, '').replace(/^0/, '234');
    if (wa) { $('#wafab').href = `https://wa.me/${wa}?text=${encodeURIComponent('Hello ' + S.cfg.site_name)}`; $('#wafab').hidden = false; }
    $('#kbtn').addEventListener('click', palette);
    document.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette(); } if (ev.key === 'Escape') closeModal(); });
    document.addEventListener('click', (ev) => { const m = $('#more'); if (m.open && (!m.contains(ev.target) || ev.target.closest('a'))) m.open = false; });
  });

  function palette() {
    const links = [['Buy', '/listings?purpose=sale'], ['Rent', '/listings?purpose=rent'], ['New developments', '/projects'], ['SPV investment', '/invest'], ['Agents', '/agents'], ['Markets', '/markets'], ['Request a property', '/request'], ['Trust centre', '/trust']];
    const m = modal(`<h2>Search</h2><input id="kq" placeholder="City, area, property or page…" autocomplete="off" aria-label="Search"><div class="kres" id="kr"></div>`);
    const draw = (items) => {
      const term = $('#kq', m).value.trim().toLowerCase();
      $('#kr', m).innerHTML = items.map((p) => `<a href="/p/${p.id}" data-link>${p.cover_thumb ? `<img src="${e(p.cover_thumb)}" alt="">` : ''}<span><b>${e(p.title)}</b><br><span class="small muted">${e(DG.place(p))} · <span class="notranslate">${price(p.price)}</span></span></span></a>`).join('') +
        links.filter(([n]) => !term || n.toLowerCase().includes(term)).map(([n, u]) => `<a href="${u}" data-link>→ ${n}</a>`).join('');
    };
    draw([]);
    let t;
    $('#kq', m).addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(async () => { const v = ev.target.value.trim(); draw(v.length > 1 ? (await api('/properties?limit=6&q=' + encodeURIComponent(v))).items : []); }, 220); });
    $('#kq', m).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { closeModal(); go('/listings?q=' + encodeURIComponent(ev.target.value.trim())); } });
    m.addEventListener('click', (ev) => { if (ev.target.closest('a[data-link]')) closeModal(); });
  }

  // ---------- home ----------
  const cityCard = (c) => `<a class="city" href="/listings?city=${encodeURIComponent(c.city)}" data-link><small>Nigeria</small><b>${e(c.city)}</b><span>${c.n ? `${c.n} ${c.n === 1 ? 'property' : 'properties'}${c.from_price ? ` · from <span class="notranslate">${price(c.from_price)}</span>` : ''}` : 'Coming soon'}</span></a>`;
  route(/^\/$/, async () => {
    const [feat, recent, mk, spvs, st] = await Promise.all([api('/properties?featured=1&available=1&limit=4'), api('/properties?limit=8'), api('/markets'), api('/spvs'), api('/stats')]);
    const tabs = [['sale', 'Buy'], ['rent', 'Rent'], ['new', 'Off-plan'], ['commercial', 'Commercial']];
    const stat = [[st.verified_listings, 'verified listings'], [st.professionals, 'verified professionals'], [st.cities, 'cities']].filter(([n]) => n > 0);
    const std = [['🪪', 'Identity verification'], ['✔', 'KYC ready'], ['⚖', 'AML standards'], ['🔒', 'Data privacy'], ['💳', 'Secure payments'], ['🧾', 'Audit trail'], ['🛡', 'Escrow ready'], ['🚫', 'Fraud prevention']];
    app.innerHTML = `<div class="hero"><div class="hero-in">
      <span class="eyebrow">A property marketplace in Kano, Nigeria</span>
      <h1>Own property the <em>easy</em>, safe way.</h1>
      <p>Verified houses, land and investment opportunities from ${co()}. Pay in instalments, co-invest through an SPV, and protect every deal with escrow.</p>
      ${stat.length ? `<p class="hstats">${stat.map(([n, t]) => `<b>${n}</b> ${t}`).join(' &nbsp;·&nbsp; ')}</p>` : ''}
      <div class="stabs" id="stabs">${tabs.map(([k, t], i) => `<button type="button" data-k="${k}" class="${i ? '' : 'on'}">${t}</button>`).join('')}</div>
      <form class="search" id="hs"><input class="wide" name="q" placeholder="City, neighbourhood, landmark or keyword" aria-label="Search">
        <select name="type" aria-label="Type">${opts(S.cfg.types, '', 'Any type')}</select>
        <select name="beds" aria-label="Bedrooms">${opts([1, 2, 3, 4, 5].map((n) => [n, n + '+ beds']), '', 'Any beds')}</select>
        <input name="max" inputmode="numeric" placeholder="Max price ₦" aria-label="Maximum price">
        <button class="btn gold">Search</button></form>
      <div class="hlinks"><a href="/listings" data-link>⚙ Advanced filters</a><a href="/map" data-link>🗺 Map search</a><a href="/dashboard?tab=saved" data-link>🔔 Saved searches</a><a href="/listings?easy=1" data-link>Easy-buy</a><a href="/invest" data-link>Invest</a><a class="btn gold sm" href="/request" data-link>＋ Request a property</a><span>Verified listings · Escrow ready · Fraud protection</span></div>
    </div></div>
    <section class="sec"><span class="kicker">Featured properties</span><div class="spread"><h2>Verified inventory, curated for discovery.</h2><a href="/listings?featured=1" data-link>View all properties →</a></div>${feat.items.length ? cards(feat.items, '') : '<p class="muted">Verified listings appear here as inventory is published to the marketplace.</p>'}</section>
    <section class="sec"><span class="kicker">Recently added</span><div class="spread"><h2>Newly published listings.</h2><a href="/listings" data-link>Browse marketplace →</a></div>${cards(recent.items, 'No properties yet. Check back soon.')}</section>
    <section class="sec"><span class="kicker">Featured cities</span><div class="spread"><h2>Cross-city markets, one platform.</h2><a href="/markets" data-link>Explore markets →</a></div><div class="grid g4 keep2">${mk.featured.slice(0, 8).map(cityCard).join('')}</div></section>
    ${spvs.some((s) => s.status === 'open') ? `<section class="band"><div><h2>Invest in property from one unit</h2><p>Co-own income-producing property through a dedicated SPV. Open now: ${e(spvs.find((s) => s.status === 'open').title)}.</p></div><a class="btn gold" href="/invest" data-link>See investment offers</a></section>` : ''}
    <section class="sec"><span class="kicker">Why ${site()}</span><h2>Trusted infrastructure for property deals.</h2><div class="grid g4">
      <div class="card"><h3>✔ Verified listings</h3><p class="muted">Title, media and lister checks are completed before the badge appears.</p></div>
      <div class="card"><h3>🪪 Verified professionals</h3><p class="muted">Agents, agencies and developers pass identity checks.</p></div>
      <div class="card"><h3>🛡 Secure escrow</h3><p class="muted">Your money is held and released only when you confirm handover.</p></div>
      <div class="card"><h3>🚫 Fraud protection</h3><p class="muted">Monitoring, reporting and rapid suspension of bad actors.</p></div></div>
      <p style="margin-top:14px"><a href="/trust" data-link>Trust &amp; safety →</a></p></section>
    <section class="sec"><h2 class="center">Built to meet high standards</h2><p class="muted center">Security, compliance and transparency are engineered into every transaction — not outsourced to a badge.</p>
      <div class="grid g4 keep2 std">${std.map(([i, t]) => `<div class="card center"><div class="sicon">${i}</div><b>${t}</b></div>`).join('')}</div></section>
    <section class="band"><div><h2>Take ${site()} with you</h2><p>Get the Android app for instant alerts on new listings, inspections and sales.</p></div><div class="row"><button class="btn gold" data-act="install">Get the Android app</button><a class="btn light" href="/request" data-link>Request a property</a></div></section>`;
    let mode = 'sale';
    app.querySelectorAll('#stabs button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.k; app.querySelectorAll('#stabs button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#hs').addEventListener('submit', (ev) => { ev.preventDefault(); go('/listings?' + DG.cleanQuery({ ...formData(ev.target), ...(mode === 'new' ? { new_dev: 1 } : mode === 'commercial' ? { type: 'commercial' } : { purpose: mode }) })); });
  });

  // ---------- markets, projects ----------
  route(/^\/markets$/, async () => {
    const mk = await api('/markets');
    app.innerHTML = `${h1('Markets', 'Explore property by city. Counts update as listings go live.')}<h2>Featured markets</h2><div class="grid g4 keep2">${mk.featured.map(cityCard).join('')}</div>
      ${mk.other.length ? `<h2 style="margin-top:30px">More cities</h2><div class="grid g4 keep2">${mk.other.map(cityCard).join('')}</div>` : ''}`;
  });
  route(/^\/projects$/, async () => {
    const d = await api('/properties?new_dev=1&limit=24');
    app.innerHTML = `${h1('New developments', 'Off-plan and delivery-stage projects from developers on the platform.')}${cards(d.items, 'No development projects are listed yet.')}
      <p class="muted small" style="margin-top:18px">Are you a developer? <a href="/contact" data-link>Talk to us</a> about listing your project.</p>`;
  });

  // ---------- professionals ----------
  const proCard = (p) => `<a class="card pro" href="/agents/${p.id}" data-link><div class="row"><div class="avatar notranslate">${e((p.name || '?')[0].toUpperCase())}</div><div><b>${e(p.name)}</b> ${p.verified ? vbadge : ''}<br><span class="small muted">${e(TYPE[p.type] || 'Agent')}${p.service_category ? ' · ' + e(cap(p.service_category)) : ''}${p.city ? ' · ' + e(p.city) : ''}</span></div></div>
    <p class="small muted">${e(p.bio ? p.bio.slice(0, 120) : 'No description yet.')}</p><span class="small">${p.listings} live ${p.listings === 1 ? 'listing' : 'listings'}</span></a>`;
  route(/^\/agents$/, async (_m, q) => {
    const type = q.get('type') || '';
    const rows = await api('/agents?' + DG.cleanQuery({ type, q: q.get('q') }));
    app.innerHTML = `${h1('Property professionals', 'Agents, agencies and developers on the platform. The verified badge appears only after identity and credential checks.')}
      <div class="tabs">${[['', 'All'], ['agent', 'Agents'], ['agency', 'Agencies'], ['developer', 'Developers']].map(([k, t]) => `<button class="${k === type ? 'on' : ''}" data-t="${k}">${t}</button>`).join('')}</div>
      <div class="grid g3">${rows.map(proCard).join('') || '<p class="muted">No profiles published yet.</p>'}</div>`;
    app.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => go('/agents' + (b.dataset.t ? '?type=' + b.dataset.t : ''))));
  });
  route(/^\/agents\/(\d+)$/, async (m) => {
    const p = await api('/agents/' + m[1]);
    app.innerHTML = `<div class="card" style="margin-top:28px"><div class="row"><div class="avatar notranslate">${e(p.name[0].toUpperCase())}</div><div><h1 style="margin:0;font-size:1.7rem">${e(p.name)} ${p.verified ? vbadge : ''}</h1>
      <span class="muted">${e(TYPE[p.type] || 'Agent')}${p.person ? ' · ' + e(p.person) : ''}${p.city ? ' · ' + e(p.city) : ''} · Member since ${date(p.since)}</span></div></div>
      ${p.bio ? `<p class="prose">${e(p.bio)}</p>` : ''}<p class="small muted">Contact details are shared on each listing once unlocked. ${p.verified ? '' : 'This profile has not completed verification.'}</p></div>
      <section><h2>Listings</h2>${cards(p.properties, 'No live listings.')}</section><section id="rev"></section>`;
    if (DG.agentExtras) DG.agentExtras(p);
  });
  route(/^\/services$/, async (_m, q) => {
    const cat = q.get('category') || '';
    const [rows, mt] = await Promise.all([api('/agents?type=service' + (cat ? '&category=' + encodeURIComponent(cat) : '')), meta()]);
    const card = (p) => `<div class="card pro"><div class="row"><div class="avatar notranslate">${e((p.name || '?')[0].toUpperCase())}</div><div><b>${e(p.name)}</b> ${p.verified ? vbadge : ''}<br><span class="small muted">${e(cap(p.service_category))}${p.city ? ' · ' + e(p.city) : ''}</span></div></div>
      <p class="small muted">${e(p.bio ? p.bio.slice(0, 140) : 'Verified service provider.')}</p>
      <div class="row">${p.phone ? `<a class="btn sm" href="https://wa.me/${e(String(p.phone).replace(/\D/g, ''))}?text=${encodeURIComponent('Hello, I found you on ' + S.cfg.site_name)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn sm ghost notranslate" href="tel:+${e(String(p.phone).replace(/\D/g, ''))}">Call</a>` : ''}<a class="btn sm ghost" href="/agents/${p.id}" data-link>Profile</a></div></div>`;
    app.innerHTML = `${h1('Services', 'Verified specialists for the work around a property transaction. Contact them directly.')}
      <div class="chips" style="margin:14px 0 20px">${[['', 'All'], ...mt.services.map((x) => [x, cap(x)])].map(([k, t]) => `<a class="chip${k === cat ? ' ok' : ''}" href="/services${k ? '?category=' + encodeURIComponent(k) : ''}" data-link>${e(t)}</a>`).join('')}</div>
      <div class="grid g3">${rows.map(card).join('') || `<p class="muted">No verified ${cat ? e(cap(cat)) + ' ' : ''}providers are listed yet.</p>`}</div>
      <section class="band" style="margin-top:30px"><div><h2>Offer a service</h2><p>Lawyers, surveyors, valuers, designers and builders: join as a service provider, complete identity verification, and clients can contact you directly.</p></div><button class="btn gold" data-act="joinsvc">Join as a service provider</button></section>`;
  });

  // ---------- KYC (identity verification) ----------
  const SOURCES = ['Salary', 'Business income', 'Savings', 'Sale of property', 'Gift or inheritance', 'Diaspora remittance', 'Other'];
  const KYC_DOCS = { id_front: 'ID — front', id_back: 'ID — back', photo: 'Photograph', address_proof: 'Proof of address', cac: 'CAC certificate' };
  async function renderKyc(box, o = {}) {
    if (!box) return;
    const u = S.user, mt = await meta(), kd = u.kyc_data || {};
    const biz = ['agency', 'developer'].includes(u.account_type), svc = u.account_type === 'service';
    const max18 = new Date(Date.now() - 18 * 365.25 * 86400e3).toISOString().slice(0, 10);
    const head = { pending: '<p><span class="status pending">Under review</span> We are checking your documents and will notify you. You will be able to post and invest as soon as you are approved.</p>',
      approved: `<p>${vbadge} Your identity is verified.</p>`, rejected: `<p><span class="status rejected">Not approved</span> ${e(u.kyc_note)} Please correct the details and submit again.</p>` }[u.kyc_status] || '';
    const inp = (n, l, extra = '') => `<div><label>${l}</label><input name="${n}" value="${e(kd[n] || '')}" ${extra}></div>`;
    const file = (n, l, req) => `<div><label>${l}${req ? '' : ' <span class="small muted">(optional)</span>'}</label><input type="file" name="${n}" accept="image/jpeg,image/png,image/webp,application/pdf"${req ? ' required' : ''}></div>`;
    box.innerHTML = `<div class="card" style="max-width:820px"><h3>Identity verification (KYC)</h3>
      ${!['approved', 'pending'].includes(u.kyc_status) ? `<p class="muted">${['agent', 'agency', 'developer', 'service'].includes(u.account_type) ? 'Required before you can post or manage anything on the platform. Until then you can browse like any buyer.' : 'Required to invest through an SPV and to earn the verified badge.'} Documents are stored privately and seen only by our compliance staff.</p>` : ''}${head}
      ${['approved', 'pending'].includes(u.kyc_status) ? '' : `<form id="kycf" class="grid">
        <div class="grid g2">${inp('full_name', 'Full legal name (as on your ID)', 'required maxlength="120"')}<div><label>Date of birth</label><input type="date" name="dob" required max="${max18}" value="${e(kd.dob || '')}"></div></div>
        <div class="grid g3"><div><label>Gender <span class="small muted">(optional)</span></label><select name="gender">${opts(['Male', 'Female'], kd.gender, '—')}</select></div>${inp('nationality', 'Nationality', 'required')}${inp('occupation', 'Occupation', 'required maxlength="100"')}</div>
        <div><label>Residential address</label><input name="address" required maxlength="250" value="${e(kd.address || '')}"></div>
        <div><label>Source of funds</label><select name="source_of_funds" required>${opts(SOURCES, kd.source_of_funds, 'Select')}</select></div>
        <div class="grid g3"><div><label>ID type</label><select name="id_type" required>${opts(mt.doc_types.filter((d) => d !== 'CAC certificate'), kd.id_type, 'Select')}</select></div>${inp('id_number', 'ID number', 'required maxlength="40"')}<div><label>BVN <span class="small muted">(optional, 11 digits)</span></label><input name="bvn" inputmode="numeric" maxlength="11" value="${e(kd.bvn || '')}"></div></div>
        ${biz ? `<div class="grid g2">${inp('business_name', 'Registered business name', 'required maxlength="150"')}${inp('rc_number', 'CAC registration (RC) number', 'required maxlength="30"')}</div>` : ''}
        ${svc ? `<div><label>Service you offer</label><select name="service_category" required>${opts(mt.services, u.service_category, 'Select')}</select></div>` : ''}
        <h4 style="margin:6px 0 0">Documents <span class="small muted">(JPG, PNG, WebP or PDF, up to 10 MB each)</span></h4>
        <div class="grid g2">${file('id_front', 'Government ID — front', true)}${file('id_back', 'Government ID — back', false)}${file('photo', 'Passport-style photograph', true)}${file('address_proof', 'Proof of address (utility bill, bank statement or tenancy agreement)', true)}${biz ? file('cac', 'CAC certificate', true) : ''}</div>
        <label class="check"><input type="checkbox" name="consent" required> I declare that the information and documents are true and I agree to their verification (see the <a href="/legal/privacy" data-link>Privacy policy</a>).</label>
        <div><button class="btn gold">Submit for verification</button></div></form>`}</div>`;
    const f = $('#kycf', box);
    if (f) f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), async () => { S.user = (await api('/me/kyc', { method: 'POST', form: new FormData(f) })).user; toast('Submitted. We will review your documents.'); (o.after || (() => renderKyc(box, o)))(); }); });
  }
  route(/^\/kyc$/, async () => {
    if (needLogin()) return (app.innerHTML = '<p class="pad center muted">Sign in to continue.</p>');
    app.innerHTML = `${h1('Identity verification', 'Complete your KYC to unlock posting and investing.')}<div id="kycbox"></div>${['agent', 'admin'].includes(S.user.role) ? '<p style="margin-top:16px"><a class="btn ghost" href="/dashboard" data-link>Go to dashboard</a></p>' : ''}`;
    await renderKyc($('#kycbox'), { after: () => render() });
  });

  // ---------- SPV investment ----------
  const RISK = `<div class="risk"><b>Risk notice.</b> Property investment puts your capital at risk. Projected returns are estimates, not guarantees; payouts depend on the property's performance, and units may be hard to sell before exit. Read the offer documents and take independent advice before investing.</div>`;
  const pct = (s) => Math.min(100, Math.round((s.sold_units / s.total_units) * 100));
  const spvCard = (s) => `<a class="pcard" href="/invest/${s.id}" data-link><div class="pimg">${s.cover_thumb ? `<img src="${e(s.cover_thumb)}" alt="" loading="lazy">` : ''}<div class="tags"><span class="tag ${s.status === 'open' ? 'gold' : 'grey'}">${e(cap(s.status))}</span><span class="tag">${e(cap(s.strategy))}</span></div></div>
    <div class="pbody"><div class="ptitle">${e(s.title)}</div><div class="ploc">${e(s.location)}</div>
      <div class="bar" style="margin:8px 0 2px"><i style="width:${pct(s)}%"></i></div><div class="small muted notranslate">${money(s.raised)} of ${money(s.target)} · ${pct(s)}%</div>
      <div class="specs"><span>Unit <b class="notranslate">${money(s.unit_price)}</b></span><span>Projected ${s.projected_return_pct}%/yr</span><span>${s.tenor_months} months</span></div></div></a>`;
  route(/^\/invest$/, async (_m, q) => {
    const rows = await api('/spvs');
    const u = S.user, verified = Boolean(u && u.verified), submitted = Boolean(u && ['pending', 'approved'].includes(u.kyc_status));
    const step = Math.min(4, Math.max(1, Number(q.get('step')) || (verified ? 2 : 1)));
    let sel = 0; try { sel = Number(sessionStorage.getItem('spv')) || 0; } catch { /* ignore */ }
    const chosen = rows.find((x) => x.id === sel && x.status === 'open') || null;
    const steps = [['Verify your identity', 'Complete your KYC', submitted], ['Choose an offer', 'Pick an SPV', Boolean(chosen)], ['Buy units', 'Pay securely', false], ['Track payouts', 'Your portfolio', false]];
    const nav = (back, next, ok = true) => `<div class="row" style="margin-top:18px;justify-content:space-between">${back ? `<a class="btn ghost" href="${back}" data-link>← Back</a>` : '<span></span>'}${next ? `<a class="btn gold${ok ? '' : ' disabled'}" href="${next}" data-link>Next →</a>` : ''}</div>`;
    const login = '<div class="card center"><p>Sign in or join to continue.</p><button class="btn gold" data-act="login">Sign in or join</button></div>';
    app.innerHTML = `${h1('Invest in property through an SPV', 'Each offer is held by its own special purpose vehicle (SPV). You buy units, co-own the asset with other investors and share in its income or sale proceeds in proportion to your units.')}
      <div class="grid g4 steps" style="margin:18px 0">${steps.map(([t, d, done], i) => `<a class="card stepc${step === i + 1 ? ' on' : ''}${done ? ' done' : ''}" href="/invest?step=${i + 1}" data-link><h3>${t}</h3><p class="muted">${d}</p></a>`).join('')}</div>
      ${RISK}<section id="stepbody" style="margin-top:20px"></section>`;
    const body = $('#stepbody');
    if (step === 1) {
      if (!u) body.innerHTML = login;
      else { body.innerHTML = '<div id="kycbox"></div>' + nav(null, '/invest?step=2', submitted); await renderKyc($('#kycbox'), { after: () => render() }); }
    } else if (step === 2) {
      body.innerHTML = `<h2>Choose an offer</h2>${rows.filter((x) => x.status === 'open').length ? `<div class="cards">${rows.filter((x) => x.status === 'open').map((x) => `<div class="pcard${chosen && chosen.id === x.id ? ' sel' : ''}"><div class="pimg">${x.cover_thumb ? `<img src="${e(x.cover_thumb)}" alt="" loading="lazy">` : ''}<div class="tags"><span class="tag">${e(cap(x.strategy))}</span></div></div>
        <div class="pbody"><div class="ptitle">${e(x.title)}</div><div class="ploc">${e(x.location)}</div><div class="bar" style="margin:8px 0 2px"><i style="width:${pct(x)}%"></i></div><div class="small muted notranslate">${money(x.raised)} of ${money(x.target)}</div>
        <div class="specs"><span>Unit <b class="notranslate">${money(x.unit_price)}</b></span><span>${x.projected_return_pct}%/yr</span><span>${x.tenor_months} months</span></div>
        <div class="row" style="margin-top:8px"><button class="btn sm${chosen && chosen.id === x.id ? '' : ' gold'}" data-pick="${x.id}">${chosen && chosen.id === x.id ? '✓ Selected' : 'Select this offer'}</button><a class="small" href="/invest/${x.id}" data-link>Details</a></div></div></div>`).join('')}</div>` : '<p class="muted pad center">No investment offers are open right now. Turn on notifications to hear about the next one.</p>'}
        ${nav('/invest?step=1', '/invest?step=3', Boolean(chosen))}`;
      body.querySelectorAll('[data-pick]').forEach((bt) => bt.addEventListener('click', () => { try { sessionStorage.setItem('spv', bt.dataset.pick); } catch { /* ignore */ } render(); }));
    } else if (step === 3) {
      if (!u) body.innerHTML = login;
      else if (!chosen) body.innerHTML = `<div class="card center"><p>Choose an offer first.</p><a class="btn gold" href="/invest?step=2" data-link>Choose an offer</a></div>${nav('/invest?step=2', '/invest?step=4')}`;
      else {
        const left = chosen.total_units - chosen.sold_units;
        body.innerHTML = `<h2>Buy units in ${e(chosen.title)}</h2><div class="card" style="max-width:520px">
          <p class="small muted notranslate">Unit price ${money(chosen.unit_price)} · minimum ${chosen.min_units} unit(s) · ${left.toLocaleString()} left</p>
          ${verified ? '' : `<p class="demo">${u.kyc_status === 'pending' ? 'Your identity check is under review. You can buy as soon as it is approved.' : 'Complete your identity check first.'} <a href="/invest?step=1" data-link>Go to step 1</a></p>`}
          <form id="inv" class="grid"><div><label>Units to buy</label><input name="units" type="number" min="${chosen.min_units}" max="${left}" value="${Math.min(chosen.min_units, left)}" required></div>
            <p class="small">Total: <b class="notranslate" id="tot">${money(Math.min(chosen.min_units, left) * chosen.unit_price)}</b></p>
            <label class="check small"><input type="checkbox" name="accept_risk" required> I have read the risk notice and the offer details.</label>
            <button class="btn gold block"${verified ? '' : ' disabled'}>Pay &amp; invest</button></form></div>${nav('/invest?step=2', '/invest?step=4')}`;
        const f = $('#inv');
        f.units.addEventListener('input', () => ($('#tot').textContent = money((Number(f.units.value) || 0) * chosen.unit_price)));
        f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), () => DG.pay2(`/spvs/${chosen.id}/invest`, { units: Number(f.units.value), accept_risk: true })); });
      }
    } else {
      body.innerHTML = u ? `<h2>Your portfolio and payouts</h2>${await DG.dashTabs.invest()}${nav('/invest?step=3', null)}` : login;
    }
  });
  route(/^\/invest\/(\d+)$/, async (m) => {
    const s = await api('/spvs/' + m[1]);
    const left = s.total_units - s.sold_units;
    app.innerHTML = `<div class="detail"><div>
      ${s.cover ? `<div class="gallery-main"><img src="${e(s.cover)}" alt=""></div>` : ''}
      <h1 style="margin-top:18px">${e(s.title)}</h1><p class="muted">${e(s.location)}${s.spv_name ? ` · Held by <span class="notranslate">${e(s.spv_name)}</span>` : ''}</p>
      <div class="facts"><div class="fact"><small>Unit price</small><b class="notranslate">${money(s.unit_price)}</b></div><div class="fact"><small>Minimum</small><b>${s.min_units} unit${s.min_units > 1 ? 's' : ''}</b></div><div class="fact"><small>Projected return</small><b>${s.projected_return_pct}% / yr</b></div><div class="fact"><small>Term</small><b>${s.tenor_months} months</b></div><div class="fact"><small>Strategy</small><b>${e(cap(s.strategy))}</b></div><div class="fact"><small>Investors</small><b>${s.investors}</b></div></div>
      ${s.summary ? `<p><b>${e(s.summary)}</b></p>` : ''}<p class="prose">${e(s.description)}</p>
      ${s.property_id ? `<p><a href="/p/${s.property_id}" data-link>View the underlying property →</a></p>` : ''}
      ${s.distributions.length ? `<h3>Payout history</h3><div class="tablewrap"><table><tr><th>Date</th><th>Per unit</th><th>Note</th></tr>${s.distributions.map((d) => `<tr><td>${date(d.created_at)}</td><td class="notranslate">${money(d.amount_per_unit)}</td><td>${e(d.note)}</td></tr>`).join('')}</table></div>` : ''}
      <div id="mkt"></div><div style="margin-top:18px">${RISK}</div></div>
    <aside class="side"><div class="card"><h3>${e(cap(s.status))}</h3><div class="bar"><i style="width:${pct(s)}%"></i></div>
      <p class="small notranslate"><b>${money(s.raised)}</b> raised of ${money(s.target)}<br>${left.toLocaleString()} of ${s.total_units.toLocaleString()} units left</p>
      ${s.my_units ? `<p class="chip ok">You hold ${s.my_units} unit${s.my_units > 1 ? 's' : ''}</p>` : ''}
      ${s.status === 'open' && left > 0 ? `<form id="inv" class="grid"><div><label>Units to buy</label><input name="units" type="number" min="${s.min_units}" max="${left}" value="${Math.min(s.min_units, left)}" required></div>
        <p class="small">Total: <b class="notranslate" id="tot">${money(Math.min(s.min_units, left) * s.unit_price)}</b></p>
        <label class="check small"><input type="checkbox" name="accept_risk" required> I have read the risk notice and offer details.</label>
        <button class="btn gold block">Invest now</button></form>` : '<p class="muted">This offer is not open for new investment.</p>'}</div></aside></div>`;
    if (DG.spvExtras) DG.spvExtras(s);
    const f = $('#inv'); if (!f) return;
    f.units.addEventListener('input', () => ($('#tot').textContent = money((Number(f.units.value) || 0) * s.unit_price)));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const run = () => busy($('button', f), async () => {
        try { await DG.pay2(`/spvs/${s.id}/invest`, { units: Number(f.units.value), accept_risk: true }); }
        catch (err) { if (err.status === 403) { toast(err.message, true); go('/dashboard?tab=verify'); } else throw err; }
      });
      if (!needLogin(run)) run();
    });
  });
  DG.pay2 = async (path, body) => { const r = await api(path, { method: 'POST', body }); if (r.url) location.href = r.url; return r; };

  // ---------- insights / newsroom / careers ----------
  const postList = (rows, empty) => rows.map((p) => `<a class="card pro" href="/insights/${e(p.slug)}" data-link><span class="small muted">${e(cap(p.category))} · ${date(p.created_at)}</span><h3 style="margin:0">${e(p.title)}</h3><p class="small muted">${e(p.excerpt)}…</p></a>`).join('') || `<p class="muted">${empty}</p>`;
  route(/^\/insights$/, async (_m, q) => {
    const cat = q.get('category') || '';
    const rows = await api('/posts' + (cat ? '?category=' + cat : ''));
    app.innerHTML = `${h1(cat === 'news' ? 'Newsroom' : cat === 'guide' ? 'Guides' : 'Insights', 'Market notes, buying guides and company announcements.')}
      <div class="tabs">${[['', 'All'], ['insight', 'Insights'], ['guide', 'Guides'], ['news', 'Newsroom']].map(([k, t]) => `<button class="${k === cat ? 'on' : ''}" data-c="${k}">${t}</button>`).join('')}</div>
      <div class="grid g2">${postList(rows, 'Nothing published here yet.')}</div>`;
    app.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => go('/insights' + (b.dataset.c ? '?category=' + b.dataset.c : ''))));
  });
  route(/^\/insights\/([a-z0-9-]+)$/, async (m) => {
    const p = await api('/posts/' + m[1]);
    document.title = `${p.title} | ${S.cfg.site_name}`;
    app.innerHTML = `<article class="doc"><p class="small muted" style="margin-top:28px"><a href="/insights" data-link>← Insights</a> · ${e(cap(p.category))} · ${date(p.created_at)}</p><h1>${e(p.title)}</h1><div class="prose">${e(p.body)}</div></article>`;
  });
  route(/^\/careers$/, async () => {
    const rows = await api('/posts?category=career');
    app.innerHTML = `${h1('Careers', `Work with ${S.cfg.company}. We value integrity with clients' money, clear communication and getting the details of a transaction right.`)}
      <h2>Open roles</h2><div class="grid g2">${postList(rows, 'There are no open roles right now.')}</div><p style="margin-top:18px"><a class="btn" href="/contact" data-link>Send us your CV</a></p>`;
  });

  // ---------- trust centre + contact ----------
  function reportForm(kind, propertyId) {
    return `<form id="rep" class="card grid" style="max-width:640px"><input type="hidden" name="kind" value="${kind}">${propertyId ? `<input type="hidden" name="property_id" value="${e(propertyId)}"><p class="small muted">Reporting listing #${e(propertyId)}</p>` : ''}
      <div class="grid g2"><div><label>Your name</label><input name="name" maxlength="80" value="${e(S.user ? S.user.name : '')}"></div><div><label>Phone or email</label><input name="contact" maxlength="120" value="${e(S.user ? '+' + S.user.phone : '')}"></div></div>
      <div><label>${kind === 'contact' ? 'Message' : 'What happened?'}</label><textarea name="message" required minlength="10" maxlength="2000"></textarea></div><div><button class="btn">${kind === 'contact' ? 'Send message' : 'Submit report'}</button></div></form>`;
  }
  const bindReport = () => { const f = $('#rep'); f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', f), async () => { await api('/reports', { method: 'POST', body: formData(f) }); f.outerHTML = '<div class="card"><h3>Thank you</h3><p class="muted">We have received it and will respond as soon as we can.</p></div>'; }); }); };

  route(/^\/trust$/, async (_m, q) => {
    const rid = q.get('report');
    const items = [
      ['Verification', 'A listing is marked verified after we check its title documents, its photos and the person listing it. Unverified listings are still shown, without the badge.'],
      ['Identity checks (KYC)', 'Agents, agencies, developers and anyone investing through an SPV submit a government ID. Documents are stored privately and seen only by our compliance staff.'],
      ['Escrow', 'Buyer funds are paid through our licensed payment partner and held until the buyer confirms handover. Every escrow shows its state: awaiting payment, funded, disputed, released or refunded.'],
      ['Anti-money-laundering', 'We may ask for source-of-funds information on large transactions and will decline or report transactions where the law requires it.'],
      ['Fraud prevention', 'We watch for impersonation, duplicate or fake listings and attempts to move payments off the platform. Accounts can be suspended immediately, which also hides their listings.'],
      ['Data security', 'Connections are encrypted (TLS). Login is by one-time code; we store no passwords. Staff access is role-based and limited to what each role needs.'],
      ['Audit trail', 'Sign-ins, listing changes, escrow events and every admin action are logged so that disputes can be reconstructed.'],
      ['Shared responsibility', 'Never pay a seller outside escrow, never share your login code, and inspect a property and its documents before you release funds.'],
    ];
    app.innerHTML = `${h1('Trust centre', `How ${S.cfg.site_name} keeps property transactions safe — and what the badges mean.`)}
      <div class="grid g2">${items.map(([t, d]) => `<div class="card"><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}</div>
      <section><h2>Trust badges explained</h2><div class="grid g3"><div class="card"><span class="chip ok">✔ Verified listing</span><p class="muted small">Title, media and lister checks are complete for this property.</p></div><div class="card"><span class="chip ok">✔ Verified professional</span><p class="muted small">This agent, agency or developer passed identity and credential checks.</p></div><div class="card"><span class="chip ok">🛡 Escrow-ready</span><p class="muted small">You can pay for this property through escrow on the platform.</p></div></div>
        <p class="small muted">Badges reflect completed checks. They are not investment advice or a guarantee of value.</p></section>
      <section id="report"><h2>${rid ? 'Report this listing' : 'Report a security or trust issue'}</h2><p class="muted">Suspicious listing, impersonation, a request to pay outside the platform, or a security weakness — tell us.${S.cfg.contact_email ? ` You can also email <a class="notranslate" href="mailto:${e(S.cfg.contact_email)}">${e(S.cfg.contact_email)}</a>.` : ''}</p>${reportForm(rid ? 'listing' : 'security', rid)}</section>`;
    bindReport();
    if (rid) $('#report').scrollIntoView();
  });
  route(/^\/contact$/, async () => {
    const wa = String(S.cfg.support_whatsapp || '').replace(/\D/g, '');
    app.innerHTML = `${h1('Contact us', `Questions about a property, an investment offer, a partnership or your account — we are glad to help.`)}
      <div class="grid g2"><div>${reportForm('contact')}</div><div class="card"><h3 class="notranslate">${e(S.cfg.company)}</h3>
        ${S.cfg.office_address ? `<p>${e(S.cfg.office_address)}</p>` : ''}${S.cfg.contact_email ? `<p class="notranslate"><a href="mailto:${e(S.cfg.contact_email)}">${e(S.cfg.contact_email)}</a></p>` : ''}
        ${S.cfg.phones ? `<p class="notranslate">${e(S.cfg.phones)}</p>` : ''}${S.cfg.rc_number ? `<p class="small muted notranslate">RC ${e(S.cfg.rc_number)}</p>` : ''}
        ${wa ? `<p><a class="btn sm" href="https://wa.me/${e(wa.replace(/^0/, '234'))}" target="_blank" rel="noopener">Chat on WhatsApp</a></p>` : ''}<p class="small muted">To report fraud or a security issue, use the <a href="/trust" data-link>trust centre</a>.</p></div></div>`;
    bindReport();
  });

  // ---------- company pages ----------
  const doc = (title, html) => { app.innerHTML = `<article class="doc">${h1(title)}${html}</article>`; };
  route(/^\/about$/, async () => doc(`About ${e(S.cfg.site_name)}`, `
    <p>${site()} is the online property marketplace of Kano-based ${co()}. We connect buyers, tenants, investors and accredited property professionals, and we put the safeguards of a careful transaction — verification, escrow and a clear paper trail — into the product itself.</p>
    <h2>Mission</h2><p>Make owning property simple, affordable and safe.</p>
    <h2>Vision</h2><p>A market where every listing can be trusted and every payment is protected.</p>
    <h2>What we offer</h2><ul><li><b>Marketplace</b> — homes, land, commercial property and new developments, with verified badges.</li><li><b>Easy-buy plans</b> — a deposit and monthly instalments.</li><li><b>Escrow</b> — funds released only when the buyer confirms handover.</li><li><b>SPV investment</b> — co-own property by buying units in a dedicated vehicle.</li><li><b>Property requests</b> — tell us what you need and let agents come to you.</li><li><b>Professionals directory</b> — agents, agencies, developers and service providers.</li></ul>
    <h2>How we work</h2><p>Trust before scale: we would rather show fewer listings that have been checked than many that have not. See the <a href="/trust" data-link>trust centre</a> for how verification and escrow work.</p>
    <p><a class="btn" href="/contact" data-link>Contact us</a></p>`));
  route(/^\/solutions$/, async () => doc('Solutions', `
    <div class="grid g2">${[['Buyers & tenants', 'Search verified listings, unlock full details, pay outright, by instalment or through escrow.', '/listings'], ['Investors', 'Buy units in SPV-held property and track payouts in your portfolio.', '/invest'], ['Agents & agencies', 'List by web or WhatsApp, get verified, and receive buyer requests that match your stock.', '/agents'], ['Developers', 'Publish off-plan and delivery-stage projects and sell units with easy-buy plans.', '/projects'], ['Diaspora buyers', 'Browse in your currency and language and buy remotely with escrow protection.', '/escrow'], ['Service providers', 'Lawyers, surveyors, valuers and designers can be found in the services directory.', '/services']].map(([t, d, u]) => `<a class="card pro" href="${u}" data-link><h3>${t}</h3><p class="muted">${d}</p></a>`).join('')}</div>`));
  route(/^\/developers$/, async () => doc('Developers', `
    <p>${site()} exposes a read-only JSON API for published listings, so partners can show our properties on their own sites. No key is required for these endpoints; please cache responses and keep requests reasonable.</p>
    <h2>Endpoints</h2><div class="tablewrap"><table><tr><th>Request</th><th>Returns</th></tr>
      <tr><td><code>GET /api/properties</code></td><td>Listings. Filters: <code>q, purpose, type, state, city, min, max, beds, easy, verified, new_dev, featured, sort, page, limit</code></td></tr>
      <tr><td><code>GET /api/properties/{id}</code></td><td>One listing (public details)</td></tr><tr><td><code>GET /api/markets</code></td><td>Cities with live listing counts</td></tr>
      <tr><td><code>GET /api/agents</code></td><td>Professional profiles</td></tr><tr><td><code>GET /api/spvs</code></td><td>Investment offers</td></tr><tr><td><code>GET /api/posts</code></td><td>Published articles</td></tr></table></div>
    <h2>Quick start</h2><pre class="code notranslate">curl "${e(location.origin)}/api/properties?purpose=sale&amp;state=Kano&amp;limit=5"</pre>
    <p class="muted small">Address, contact details and full galleries are not part of the public API. For write access or a data partnership, <a href="/contact" data-link>contact us</a>.</p>`));
  const reviewNote = '';
  route(/^\/legal\/terms$/, async () => doc('Terms of use', `${reviewNote}
    <p>These terms govern your use of ${site()}, (“we”). By creating an account you agree to them.</p>
    <h2>1. Accounts</h2><p>You sign in with your phone number and a one-time code. You are responsible for activity on your account and must give accurate information, including during identity checks.</p>
    <h2>2. Listings</h2><p>Listers must have the right to market a property and must describe it truthfully. We may edit, decline, unpublish or remove listings, and suspend accounts that break these terms.</p>
    <h2>3. Fees</h2><p>Fees for viewing full details, escrow and other services are shown before you pay. Fees for viewing full details are non-refundable once the details have been shown.</p>
    <h2>4. Escrow</h2><p>Funds paid into escrow are held until the buyer confirms handover, or until a dispute is decided by us after hearing both parties. We do not give legal advice; use your own solicitor for conveyancing.</p>
    <h2>5. Easy-buy plans</h2><p>Instalment plans are agreements to pay the stated total by the stated dates. The consequences of missed payments are set out in the plan agreement for each property.</p>
    <h2>6. Investment offers</h2><p>SPV offers are available only to verified members. Projected returns are estimates and are not guaranteed. Each offer is governed by its own documents, which prevail over this summary.</p>
    <h2>7. Liability</h2><p>Verification reduces risk but is not a warranty of title or value. To the extent the law allows, we are not liable for losses arising from dealings conducted outside the platform.</p>
    <h2>8. Governing law</h2><p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>`));
  route(/^\/legal\/privacy$/, async () => doc('Privacy policy', `
    <p>This policy explains how ${site()} handles personal data on ${site()}, in line with the Nigeria Data Protection Act.</p>
    <h2>What we collect</h2><ul><li>Your phone number, name and profile details.</li><li>Identity documents you submit for verification.</li><li>Listings, requests, messages and reports you create.</li><li>Payment references and amounts (card details are handled by our payment partner, not stored by us).</li><li>Device push-notification tokens, if you turn notifications on.</li></ul>
    <h2>How we use it</h2><p>To run your account, verify identities, process payments and escrow, prevent fraud, send alerts you asked for and meet legal obligations.</p>
    <h2>Sharing</h2><p>With payment and messaging providers that process data for us, with the other party to a transaction where needed, and with authorities where the law requires. We do not sell personal data.</p>
    <h2>Translation</h2><p>If you switch language, page text is sent to Google Translate to be translated.</p>
    <h2>Retention and your rights</h2><p>We keep records for as long as your account is open and as the law requires for financial records. You may ask to access, correct or delete your data through the <a href="/contact" data-link>contact page</a>.</p>`));

  // ---------- dashboard tabs ----------
  DG.dashTabs.overview = async () => {
    const u = S.user, pro = ['agent', 'admin'].includes(u.role), mt = await meta();
    const gate = u.role === 'agent' && !u.verified ? `<div class="demo" style="margin-bottom:14px"><b>${u.kyc_status === 'pending' ? 'Verification under review.' : 'Verification required.'}</b> ${u.kyc_status === 'pending' ? 'You can post once you are approved. Until then you can browse like a buyer.' : 'Complete your identity verification (KYC) to post and manage listings. Until then you can browse like a buyer.'} <a class="btn sm gold" href="/dashboard?tab=verify" data-link>${u.kyc_status === 'pending' ? 'View' : 'Complete KYC'}</a></div>` : '';
    return `${gate}<form id="pf2" class="card grid"><div class="spread"><h3 style="margin:0">Your profile</h3><span>${u.verified ? vbadge : `<a href="/dashboard?tab=verify" data-link>Get verified →</a>`}</span></div>
      <div class="grid g3"><div><label>Your name</label><input name="name" value="${e(u.name)}" maxlength="80"></div><div><label>City</label><input name="city" value="${e(u.city)}" maxlength="60"></div>
        ${pro ? `<div><label>Account type</label><select name="account_type">${opts(mt.account_types.map((t) => [t, TYPE[t]]), u.account_type)}</select></div>` : ''}</div>
      ${pro ? `<div class="grid g2"><div><label>Company / trading name</label><input name="company" value="${e(u.company)}" maxlength="100"></div><div><label>Service <span class="small muted">(service providers)</span></label><select name="service_category">${opts(mt.services, u.service_category, '—')}</select></div></div>
        <div><label>About <span class="small muted">(shown on your public profile)</span></label><textarea name="bio" maxlength="600">${e(u.bio)}</textarea></div>` : ''}
      <div class="row"><button class="btn sm">Save profile</button>${pro ? `<a class="small" href="/agents/${u.id}" data-link>View public profile</a>` : ''}<span class="small muted notranslate">+${e(u.phone)} · ${e(cap(u.role))}</span></div></form>
      <div class="card" style="margin-top:16px"><h3>Email <span class="small muted">(optional)</span> ${u.email_verified ? vbadge : ''}</h3><p class="small muted">Sign-in codes always go to your WhatsApp. Add an email to also get codes, receipts and alerts there.</p>
        <form id="emf" class="row"><input name="email" type="email" value="${e(u.email)}" placeholder="you@example.com" style="flex:1;min-width:200px" maxlength="200"><button class="btn sm">${u.email ? 'Change' : 'Add email'}</button></form>
        ${u.email && !u.email_verified ? `<form id="emv" class="row" style="margin-top:10px"><input name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code from your email" style="flex:1;min-width:200px" required><button class="btn sm gold">Confirm email</button></form>` : ''}</div>
      <div class="grid g3" style="margin-top:16px"><a class="card" href="/listings" data-link><h3>Browse properties</h3><span class="muted small">Find your next home or plot</span></a><a class="card" href="/invest" data-link><h3>Invest</h3><span class="muted small">Buy units in SPV-held property</span></a><a class="card" href="/request" data-link><h3>Request a property</h3><span class="muted small">Tell us your specification</span></a></div>`;
  };
  DG.dashTabs.verify = async () => '<div id="kycbox"></div>';
  DG.dashTabs.invest = async () => {
    const rows = await api('/my/investments');
    if (!rows.length) return '<p class="muted">You have no investments yet. <a href="/invest" data-link>See open offers →</a></p>';
    const tot = rows.reduce((a, r) => a + r.amount, 0), dist = rows.reduce((a, r) => a + r.distributed, 0);
    return `<div class="stats" style="margin-bottom:16px"><div class="stat"><b class="notranslate">${money(tot)}</b>Invested</div><div class="stat"><b class="notranslate">${money(dist)}</b>Payouts declared</div><div class="stat"><b>${rows.length}</b>Offers held</div></div>
      <div class="tablewrap"><table><tr><th>Offer</th><th>Units</th><th>Invested</th><th>Ownership</th><th>Payouts</th><th>Status</th></tr>${rows.map((r) => `<tr><td><a href="/invest/${r.spv_id}" data-link>${e(r.title)}</a></td><td>${r.units}</td><td class="notranslate">${money(r.amount)}</td><td>${((r.units / r.total_units) * 100).toFixed(2)}%</td><td class="notranslate">${money(r.distributed)}</td><td>${status(r.status)}</td></tr>`).join('')}</table></div>`;
  };
  DG.dashBind = (tab) => {
    const pf = $('#pf2'); if (pf) pf.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', pf), async () => { S.user = (await api('/me', { method: 'PATCH', body: formData(pf) })).user; toast('Profile saved.'); }); });
    const ef = $('#emf'); if (ef) ef.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', ef), async () => { const r = await api('/me/email', { method: 'POST', body: formData(ef) }); S.user = r.user; toast(r.user.email ? `Code sent to ${r.user.email}.${r.demo_code ? ' Demo code: ' + r.demo_code : ''}` : 'Email removed.'); render(); }); });
    const ev2 = $('#emv'); if (ev2) ev2.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', ev2), async () => { S.user = (await api('/me/email/verify', { method: 'POST', body: formData(ev2) })).user; toast('Email confirmed.'); render(); }); });
    if (tab === 'verify') renderKyc($('#kycbox'), { after: () => render() });
    void tab;
  };

  // ---------- admin tabs ----------
  let trust = null;
  const getTrust = async () => (trust = await api('/admin/trust'));
  DG.adminTabs.users = async (d) => `<div class="tablewrap"><table><tr><th>Member</th><th>Phone</th><th>Type</th><th>Joined</th><th>Role</th><th>Status</th></tr>${d.users.map((u) => `<tr><td>${e(u.company || u.name || '—')} ${u.verified ? vbadge : ''}</td><td class="notranslate">+${e(u.phone)}</td><td>${e(TYPE[u.account_type] || '')}</td><td>${date(u.created_at)}</td>
    <td><select data-role="${u.id}"${u.id === S.user.id ? ' disabled' : ''}>${opts(['buyer', 'agent', 'admin'], u.role)}</select></td>
    <td>${u.id === S.user.id ? '' : `<button class="btn sm ${u.suspended ? '' : 'danger'}" data-sus="${u.id}" data-v="${u.suspended ? 0 : 1}">${u.suspended ? 'Reinstate' : 'Suspend'}</button>`}</td></tr>`).join('')}</table></div>`;
  DG.adminTabs.verify = async (d) => {
    const q = d.users.filter((u) => u.kyc_status === 'pending');
    const parse = (x) => { try { return JSON.parse(x || '{}'); } catch { return {}; } };
    const L = { full_name: 'Name', dob: 'Date of birth', gender: 'Gender', nationality: 'Nationality', occupation: 'Occupation', address: 'Address', source_of_funds: 'Source of funds', id_type: 'ID type', id_number: 'ID number', bvn: 'BVN', business_name: 'Business', rc_number: 'RC number' };
    return `<h3>Identity checks awaiting review (${q.length})</h3>${q.map((u) => { const k = parse(u.kyc_data), f = parse(u.kyc_files); return `<div class="card" style="margin-bottom:12px"><div class="spread"><b>${e(u.company || u.name || '—')} <span class="small muted notranslate">+${e(u.phone)} · ${e(TYPE[u.account_type] || '')}</span></b>
      <span class="row"><button class="btn sm" data-kyc="${u.id}" data-ok="1">Approve</button><button class="btn sm ghost" data-kyc="${u.id}" data-ok="0">Reject</button></span></div>
      <table style="margin-top:8px">${Object.keys(L).filter((x) => k[x]).map((x) => `<tr><td class="small muted" style="width:170px">${L[x]}</td><td class="notranslate">${e(k[x])}</td></tr>`).join('')}</table>
      <p class="row" style="margin-top:8px">${Object.keys(f).map((x) => `<a class="btn sm ghost" href="/api/admin/kyc/${u.id}/file?doc=${x}" target="_blank" rel="noopener">${KYC_DOCS[x] || x} ↗</a>`).join('')}</p></div>`; }).join('') || '<p class="muted">Nothing waiting.</p>'}
      <p class="small muted">Approving adds the verified badge and lets agents, agencies, developers and service providers post. Listings are verified separately from the Listings tab.</p>`;
  };
  DG.adminTabs.reports = async () => {
    const t = await getTrust(), r = t.risk;
    return `<div class="stats" style="margin-bottom:16px"><div class="stat"><b>${r.open_reports}</b>Open trust reports</div><div class="stat"><b>${r.pending_kyc}</b>ID checks pending</div><div class="stat"><b>${r.disputes}</b>Escrow disputes</div><div class="stat"><b>${r.suspended}</b>Suspended accounts</div><div class="stat"><b>${r.failed_payments}</b>Failed payments (7 days)</div><div class="stat"><b>${r.unverified_agents}</b>Unverified agents</div></div>
      <div class="tablewrap"><table><tr><th>Received</th><th>Type</th><th>From</th><th>Message</th><th></th></tr>${t.reports.map((x) => `<tr><td>${date(x.created_at)}</td><td>${status(x.status)} ${e(cap(x.kind))}${x.property_id ? `<br><a href="/p/${x.property_id}" data-link>#${x.property_id} ${e(x.property_title || '')}</a>` : ''}</td><td>${e(x.name)}<br><span class="small notranslate">${e(x.contact)}</span></td><td class="prose">${e(x.message)}</td><td>${x.status === 'open' ? `<button class="btn sm" data-res="${x.id}">Resolve</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No messages or reports.</td></tr>'}</table></div>`;
  };
  DG.adminTabs.audit = async () => {
    const t = await getTrust();
    return `<p class="muted small">Latest 200 recorded actions: sign-ins, listing changes, escrow events and admin actions.</p><div class="tablewrap"><table><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Detail</th></tr>${t.audit.map((a) => `<tr><td class="nowrap">${e(a.created_at)}</td><td class="notranslate">${e(a.actor_name || '')} ${a.actor_phone ? '+' + e(a.actor_phone) : ''}</td><td><code>${e(a.action)}</code></td><td class="small" style="word-break:break-word">${e(a.detail)}</td></tr>`).join('')}</table></div>`;
  };
  DG.adminTabs.posts = async () => {
    const t = await getTrust();
    const form = (p) => `<form class="card grid postf" data-id="${p.id || ''}" style="margin-bottom:14px"><div class="grid g3"><div style="grid-column:span 2"><label>Title</label><input name="title" required maxlength="140" value="${e(p.title || '')}"></div><div><label>Section</label><select name="category">${opts([['insight', 'Insight'], ['guide', 'Guide'], ['news', 'Newsroom'], ['career', 'Career / open role']], p.category || 'insight')}</select></div></div>
      <div><label>Text</label><textarea name="body" required maxlength="20000" style="min-height:${p.id ? 90 : 160}px">${e(p.body || '')}</textarea></div>
      <div class="row"><label class="check"><input type="checkbox" name="published"${p.id && !p.published ? '' : ' checked'}> Published</label><button class="btn sm">${p.id ? 'Save' : 'Publish article'}</button>${p.id ? `<button type="button" class="btn sm ghost" data-delpost="${p.id}">Delete</button><a class="small" href="/insights/${e(p.slug)}" data-link>View</a>` : ''}</div></form>`;
    return `<h3>New article</h3>${form({})}<h3>Published</h3>${t.posts.map(form).join('') || '<p class="muted">None yet.</p>'}`;
  };
  DG.adminTabs.invest = async () => {
    const rows = await api('/admin/spvs');
    const form = (s) => `<form class="card grid spvf" data-id="${s.id || ''}" style="margin-bottom:16px">${s.id ? `<div class="spread"><h3 style="margin:0">#${s.id} ${e(s.title)}</h3><span>${status(s.status)} <span class="small notranslate">${money(s.raised)} / ${money(s.target)} · ${s.investors} investors</span></span></div>` : ''}
      <div class="grid g3"><div><label>Title</label><input name="title" required value="${e(s.title || '')}"></div><div><label>SPV registered name</label><input name="spv_name" value="${e(s.spv_name || '')}"></div><div><label>Location</label><input name="location" value="${e(s.location || '')}"></div></div>
      <div class="grid g4 keep2"><div><label>Unit price (₦)</label><input name="unit_price" inputmode="numeric" required value="${e(s.unit_price || '')}"></div><div><label>Total units</label><input name="total_units" inputmode="numeric" required value="${e(s.total_units || '')}"></div><div><label>Minimum units</label><input name="min_units" inputmode="numeric" value="${e(s.min_units || 1)}"></div><div><label>Projected return %/yr</label><input name="projected_return_pct" inputmode="decimal" value="${e(s.projected_return_pct ?? '')}"></div></div>
      <div class="grid g4 keep2"><div><label>Term (months)</label><input name="tenor_months" inputmode="numeric" value="${e(s.tenor_months || 12)}"></div><div><label>Strategy</label><select name="strategy">${opts(['rental', 'appreciation', 'development'], s.strategy)}</select></div><div><label>Status</label><select name="status">${opts(['draft', 'open', 'funded', 'closed', 'exited'], s.status || 'draft')}</select></div><div><label>Linked listing # <span class="small muted">(cover photo)</span></label><input name="property_id" inputmode="numeric" value="${e(s.property_id || '')}"></div></div>
      <div><label>One-line summary</label><input name="summary" maxlength="300" value="${e(s.summary || '')}"></div><div><label>Full details (asset, structure, fees, exit, risks)</label><textarea name="description" maxlength="6000">${e(s.description || '')}</textarea></div>
      <div class="row"><button class="btn sm">${s.id ? 'Save offer' : 'Create offer'}</button>${s.id ? `<a class="small" href="/invest/${s.id}" data-link>View page</a><button type="button" class="btn sm gold" data-dist="${s.id}">Record payout</button>` : ''}</div>
      ${s.holders && s.holders.length ? `<details><summary>Investors (${s.holders.length})</summary><table><tr><th>Name</th><th>Phone</th><th>Units</th><th>Amount</th></tr>${s.holders.map((x) => `<tr><td>${e(x.name)}</td><td class="notranslate">+${e(x.phone)}</td><td>${x.units}</td><td class="notranslate">${money(x.amount)}</td></tr>`).join('')}</table></details>` : ''}</form>`;
    return `<div class="risk" style="margin-bottom:16px">Offering investments to the public is regulated. Confirm each offer's structure and documents with your lawyer (and the SEC where required) before setting it to “open”.</div><h3>New offer</h3>${form({})}<h3>Offers</h3>${rows.map(form).join('') || '<p class="muted">None yet.</p>'}`;
  };
  DG.adminBind = () => {
    const post = (sel, attr, fn) => app.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => busy(b, async () => { await fn(b, b.getAttribute(attr)); render(); })));
    post('[data-sus]', 'data-sus', (b, id) => api(`/admin/users/${id}/suspend`, { method: 'POST', body: { suspended: b.dataset.v === '1' } }));
    post('[data-res]', 'data-res', (_b, id) => api(`/admin/reports/${id}/resolve`, { method: 'POST' }));
    post('[data-delpost]', 'data-delpost', (_b, id) => (confirm('Delete this article?') ? api(`/admin/posts/${id}`, { method: 'DELETE' }) : null));
    post('[data-kyc]', 'data-kyc', (b, id) => { const ok = b.dataset.ok === '1'; const note = ok ? '' : prompt('Reason (sent to the member):'); return note === null ? null : api(`/admin/users/${id}/kyc`, { method: 'POST', body: { approve: ok, note } }); });
    post('[data-dist]', 'data-dist', (_b, id) => { const per = prompt('Payout amount PER UNIT (₦):'); if (!per) return null; const note = prompt('Note (e.g. “Q1 rental income”):') || ''; return api(`/admin/spvs/${id}/distribute`, { method: 'POST', body: { amount_per_unit: per, note } }); });
    const forms = (sel, base) => app.querySelectorAll(sel).forEach((f) => f.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button.btn', f), async () => { const body = formData(f); if (sel === '.postf') body.published = Boolean(body.published); await api(base + (f.dataset.id ? '/' + f.dataset.id : ''), { method: f.dataset.id ? 'PUT' : 'POST', body }); toast('Saved.'); render(); }); }));
    forms('.postf', '/admin/posts'); forms('.spvf', '/admin/spvs');
  };
})();
