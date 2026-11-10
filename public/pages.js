/* DanGida v2 pages: discovery, professionals, trust centre, SPV investment, insights, company. */
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
  const cityCard = (c) => `<a class="city" href="/listings?city=${encodeURIComponent(c.city)}" data-link><b>${e(c.city)}</b><span>${c.n ? `${c.n} ${c.n === 1 ? 'property' : 'properties'}${c.from_price ? ` · from <span class="notranslate">${price(c.from_price)}</span>` : ''}` : 'Coming soon'}</span></a>`;
  route(/^\/$/, async () => {
    const [feat, recent, mk, spvs] = await Promise.all([api('/properties?featured=1&available=1&limit=4'), api('/properties?limit=8'), api('/markets'), api('/spvs')]);
    const tabs = [['sale', 'Buy'], ['rent', 'Rent'], ['shortlet', 'Short lets'], ['new', 'New developments']];
    app.innerHTML = `<div class="hero"><div class="hero-in">
      <h1>Own property the <em>easy</em>, safe way.</h1>
      <p>Verified houses, land and investment opportunities from ${co()}. Pay in instalments, invest through an SPV, and protect every deal with escrow.</p>
      <div class="pills" id="stabs">${tabs.map(([k, t], i) => `<button class="pill${i ? '' : ' on'}" data-k="${k}" style="border:0;cursor:pointer${i ? '' : ';background:var(--gold);color:#2b2205'}">${t}</button>`).join('')}</div>
      <form class="search" id="hs" style="margin-top:12px"><input class="wide" name="q" placeholder="City, area or keyword" aria-label="Search">
        <select name="type" aria-label="Type">${opts(S.cfg.types, '', 'Any type')}</select>
        <select name="beds" aria-label="Bedrooms">${opts([1, 2, 3, 4, 5].map((n) => [n, n + '+ beds']), '', 'Any beds')}</select>
        <input name="max" inputmode="numeric" placeholder="Max price ₦" aria-label="Maximum price">
        <button class="btn gold">Search</button></form>
      <div class="pills"><a class="pill" href="/listings?easy=1" data-link>Easy-buy properties</a><a class="pill" href="/invest" data-link>Invest from one unit</a><a class="pill" href="/listings?verified=1" data-link>✔ Verified only</a><a class="pill" href="/request" data-link>Can't find it? Request it</a></div>
    </div></div>
    ${feat.items.length ? `<section><div class="spread"><h2>Featured properties</h2><a href="/listings?featured=1" data-link>View all →</a></div>${cards(feat.items, '')}</section>` : ''}
    <section><div class="spread"><h2>Recently added</h2><a href="/listings" data-link>Browse marketplace →</a></div>${cards(recent.items, 'No properties yet. Check back soon.')}</section>
    <section><div class="spread"><h2>Featured cities</h2><a href="/markets" data-link>Explore markets →</a></div><div class="grid g4 keep2">${mk.featured.slice(0, 8).map(cityCard).join('')}</div></section>
    ${spvs.some((s) => s.status === 'open') ? `<section class="band"><div><h2>Invest in property from one unit</h2><p>Co-own income-producing property through a dedicated SPV. Open now: ${e(spvs.find((s) => s.status === 'open').title)}.</p></div><a class="btn gold" href="/invest" data-link>See investment offers</a></section>` : ''}
    <section><h2>Why ${site()}</h2><div class="grid g4">
      <div class="card"><h3>✔ Verified by design</h3><p class="muted">Listings and professionals carry a badge only after our checks are complete.</p></div>
      <div class="card"><h3>🛡 Escrow-ready</h3><p class="muted">Your money is held and released only when you confirm handover.</p></div>
      <div class="card"><h3>📅 Easy-buy plans</h3><p class="muted">Spread the cost with a deposit and monthly instalments.</p></div>
      <div class="card"><h3>🧾 Accountable</h3><p class="muted">Offers, payments and admin actions leave an audit trail for dispute support.</p></div></div>
      <p style="margin-top:14px"><a href="/trust" data-link>Visit the trust centre →</a></p></section>
    <section class="band"><div><h2>Take ${e(S.cfg.site_name)} with you</h2><p>Install the app on your phone for instant alerts on new listings and sales.</p></div><div class="row"><button class="btn gold" data-act="install">Install the app</button><a class="btn light" href="/request" data-link>Request a property</a></div></section>`;
    let mode = 'sale';
    app.querySelectorAll('#stabs button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.k; app.querySelectorAll('#stabs button').forEach((x) => { const on = x === b; x.style.background = on ? 'var(--gold)' : ''; x.style.color = on ? '#2b2205' : ''; }); }));
    $('#hs').addEventListener('submit', (ev) => { ev.preventDefault(); go('/listings?' + DG.cleanQuery({ ...formData(ev.target), ...(mode === 'new' ? { new_dev: 1 } : { purpose: mode }) })); });
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
      <section><h2>Listings</h2>${cards(p.properties, 'No live listings.')}</section>`;
  });
  route(/^\/services$/, async () => {
    const [rows, mt] = await Promise.all([api('/agents?type=service'), meta()]);
    app.innerHTML = `${h1('Services', 'Independent specialists for the work around a property transaction.')}
      <div class="chips" style="margin-bottom:18px">${mt.services.map((s) => `<span class="chip">${e(cap(s))}</span>`).join('')}</div>
      <div class="grid g3">${rows.map(proCard).join('') || '<p class="muted">No service providers are listed yet.</p>'}</div>
      <p class="small muted" style="margin-top:18px">Offer one of these services? Sign up as an agent, then set your account type to “Service provider” in your dashboard.</p>`;
  });

  // ---------- SPV investment ----------
  const RISK = `<div class="risk"><b>Risk notice.</b> Property investment puts your capital at risk. Projected returns are estimates, not guarantees; payouts depend on the property's performance, and units may be hard to sell before exit. Read the offer documents and take independent advice before investing.</div>`;
  const pct = (s) => Math.min(100, Math.round((s.sold_units / s.total_units) * 100));
  const spvCard = (s) => `<a class="pcard" href="/invest/${s.id}" data-link><div class="pimg">${s.cover_thumb ? `<img src="${e(s.cover_thumb)}" alt="" loading="lazy">` : ''}<div class="tags"><span class="tag ${s.status === 'open' ? 'gold' : 'grey'}">${e(cap(s.status))}</span><span class="tag">${e(cap(s.strategy))}</span></div></div>
    <div class="pbody"><div class="ptitle">${e(s.title)}</div><div class="ploc">${e(s.location)}</div>
      <div class="bar" style="margin:8px 0 2px"><i style="width:${pct(s)}%"></i></div><div class="small muted notranslate">${money(s.raised)} of ${money(s.target)} · ${pct(s)}%</div>
      <div class="specs"><span>Unit <b class="notranslate">${money(s.unit_price)}</b></span><span>Projected ${s.projected_return_pct}%/yr</span><span>${s.tenor_months} months</span></div></div></a>`;
  route(/^\/invest$/, async () => {
    const rows = await api('/spvs');
    app.innerHTML = `${h1('Invest in property through an SPV', `Each offer is held by its own special purpose vehicle (SPV). You buy units, co-own the asset with other investors and share in its income or sale proceeds in proportion to your units.`)}
      <div class="grid g4 steps" style="margin:18px 0"><div class="card"><h3>Verify your identity</h3><p class="muted">Investing requires a completed identity (KYC) check.</p></div><div class="card"><h3>Choose an offer</h3><p class="muted">Review the property, strategy, term and documents.</p></div><div class="card"><h3>Buy units</h3><p class="muted">Pay securely. Units appear in your portfolio at once.</p></div><div class="card"><h3>Track payouts</h3><p class="muted">Distributions are recorded per unit and shown in your dashboard.</p></div></div>
      ${RISK}<section>${rows.length ? `<div class="cards">${rows.map(spvCard).join('')}</div>` : '<p class="muted pad center">No investment offers are open right now. Turn on notifications to hear about the next one.</p>'}</section>`;
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
      <div style="margin-top:18px">${RISK}</div></div>
    <aside class="side"><div class="card"><h3>${e(cap(s.status))}</h3><div class="bar"><i style="width:${pct(s)}%"></i></div>
      <p class="small notranslate"><b>${money(s.raised)}</b> raised of ${money(s.target)}<br>${left.toLocaleString()} of ${s.total_units.toLocaleString()} units left</p>
      ${s.my_units ? `<p class="chip ok">You hold ${s.my_units} unit${s.my_units > 1 ? 's' : ''}</p>` : ''}
      ${s.status === 'open' && left > 0 ? `<form id="inv" class="grid"><div><label>Units to buy</label><input name="units" type="number" min="${s.min_units}" max="${left}" value="${Math.min(s.min_units, left)}" required></div>
        <p class="small">Total: <b class="notranslate" id="tot">${money(Math.min(s.min_units, left) * s.unit_price)}</b></p>
        <label class="check small"><input type="checkbox" name="accept_risk" required> I have read the risk notice and offer details.</label>
        <button class="btn gold block">Invest now</button></form>` : '<p class="muted">This offer is not open for new investment.</p>'}</div></aside></div>`;
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
        ${wa ? `<p><a class="btn sm" href="https://wa.me/${e(wa.replace(/^0/, '234'))}" target="_blank" rel="noopener">Chat on WhatsApp</a></p>` : ''}<p class="small muted">To report fraud or a security issue, use the <a href="/trust" data-link>trust centre</a>.</p></div></div>`;
    bindReport();
  });

  // ---------- company pages ----------
  const doc = (title, html) => { app.innerHTML = `<article class="doc">${h1(title)}${html}</article>`; };
  route(/^\/about$/, async () => doc(`About ${e(S.cfg.site_name)}`, `
    <p>${site()} is the online property marketplace of ${co()}. We connect buyers, tenants, investors and accredited property professionals, and we put the safeguards of a careful transaction — verification, escrow and a clear paper trail — into the product itself.</p>
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
    <p>These terms govern your use of ${site()}, operated by ${co()} (“we”). By creating an account you agree to them.</p>
    <h2>1. Accounts</h2><p>You sign in with your phone number and a one-time code. You are responsible for activity on your account and must give accurate information, including during identity checks.</p>
    <h2>2. Listings</h2><p>Listers must have the right to market a property and must describe it truthfully. We may edit, decline, unpublish or remove listings, and suspend accounts that break these terms.</p>
    <h2>3. Fees</h2><p>Fees for viewing full details, escrow and other services are shown before you pay. Fees for viewing full details are non-refundable once the details have been shown.</p>
    <h2>4. Escrow</h2><p>Funds paid into escrow are held until the buyer confirms handover, or until a dispute is decided by us after hearing both parties. We do not give legal advice; use your own solicitor for conveyancing.</p>
    <h2>5. Easy-buy plans</h2><p>Instalment plans are agreements to pay the stated total by the stated dates. The consequences of missed payments are set out in the plan agreement for each property.</p>
    <h2>6. Investment offers</h2><p>SPV offers are available only to verified members. Projected returns are estimates and are not guaranteed. Each offer is governed by its own documents, which prevail over this summary.</p>
    <h2>7. Liability</h2><p>Verification reduces risk but is not a warranty of title or value. To the extent the law allows, we are not liable for losses arising from dealings conducted outside the platform.</p>
    <h2>8. Governing law</h2><p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>`));
  route(/^\/legal\/privacy$/, async () => doc('Privacy policy', `
    <p>This policy explains how ${co()} handles personal data on ${site()}, in line with the Nigeria Data Protection Act.</p>
    <h2>What we collect</h2><ul><li>Your phone number, name and profile details.</li><li>Identity documents you submit for verification.</li><li>Listings, requests, messages and reports you create.</li><li>Payment references and amounts (card details are handled by our payment partner, not stored by us).</li><li>Device push-notification tokens, if you turn notifications on.</li></ul>
    <h2>How we use it</h2><p>To run your account, verify identities, process payments and escrow, prevent fraud, send alerts you asked for and meet legal obligations.</p>
    <h2>Sharing</h2><p>With payment and messaging providers that process data for us, with the other party to a transaction where needed, and with authorities where the law requires. We do not sell personal data.</p>
    <h2>Translation</h2><p>If you switch language, page text is sent to Google Translate to be translated.</p>
    <h2>Retention and your rights</h2><p>We keep records for as long as your account is open and as the law requires for financial records. You may ask to access, correct or delete your data through the <a href="/contact" data-link>contact page</a>.</p>`));

  // ---------- dashboard tabs ----------
  DG.dashTabs.overview = async () => {
    const u = S.user, pro = ['agent', 'admin'].includes(u.role), mt = await meta();
    return `<form id="pf2" class="card grid"><div class="spread"><h3 style="margin:0">Your profile</h3><span>${u.verified ? vbadge : `<a href="/dashboard?tab=verify" data-link>Get verified →</a>`}</span></div>
      <div class="grid g3"><div><label>Your name</label><input name="name" value="${e(u.name)}" maxlength="80"></div><div><label>City</label><input name="city" value="${e(u.city)}" maxlength="60"></div>
        ${pro ? `<div><label>Account type</label><select name="account_type">${opts(mt.account_types.map((t) => [t, TYPE[t]]), u.account_type)}</select></div>` : ''}</div>
      ${pro ? `<div class="grid g2"><div><label>Company / trading name</label><input name="company" value="${e(u.company)}" maxlength="100"></div><div><label>Service <span class="small muted">(service providers)</span></label><select name="service_category">${opts(mt.services, u.service_category, '—')}</select></div></div>
        <div><label>About <span class="small muted">(shown on your public profile)</span></label><textarea name="bio" maxlength="600">${e(u.bio)}</textarea></div>` : ''}
      <div class="row"><button class="btn sm">Save profile</button>${pro ? `<a class="small" href="/agents/${u.id}" data-link>View public profile</a>` : ''}<span class="small muted notranslate">+${e(u.phone)} · ${e(cap(u.role))}</span></div></form>
      <div class="grid g3" style="margin-top:16px"><a class="card" href="/listings" data-link><h3>Browse properties</h3><span class="muted small">Find your next home or plot</span></a><a class="card" href="/invest" data-link><h3>Invest</h3><span class="muted small">Buy units in SPV-held property</span></a><a class="card" href="/request" data-link><h3>Request a property</h3><span class="muted small">Tell us your specification</span></a></div>`;
  };
  DG.dashTabs.verify = async () => {
    const u = S.user, mt = await meta();
    const head = { none: '<p class="muted">Verify your identity to earn the verified badge and to invest in SPV offers.</p>', pending: '<p><span class="status pending">Under review</span> We are checking your document. You will be notified.</p>', approved: `<p>${vbadge} Your identity is verified.</p>`, rejected: `<p><span class="status rejected">Not approved</span> ${e(u.kyc_note)} Please submit again.</p>` }[u.kyc_status] || '';
    return `<div class="card" style="max-width:640px"><h3>Identity verification (KYC)</h3>${head}
      ${u.kyc_status === 'approved' ? '' : `<form id="kyc" class="grid"><div><label>Document type</label><select name="doc_type" required>${opts(mt.doc_types.map((d) => [d, d]), '', 'Select')}</select></div>
        <div><label>Photo or PDF of the document</label><input type="file" name="document" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
        <p class="small muted">Stored privately and seen only by our compliance staff. Max 10 MB.</p><div><button class="btn">Submit for review</button></div></form>`}</div>`;
  };
  DG.dashTabs.invest = async () => {
    const rows = await api('/my/investments');
    if (!rows.length) return '<p class="muted">You have no investments yet. <a href="/invest" data-link>See open offers →</a></p>';
    const tot = rows.reduce((a, r) => a + r.amount, 0), dist = rows.reduce((a, r) => a + r.distributed, 0);
    return `<div class="stats" style="margin-bottom:16px"><div class="stat"><b class="notranslate">${money(tot)}</b>Invested</div><div class="stat"><b class="notranslate">${money(dist)}</b>Payouts declared</div><div class="stat"><b>${rows.length}</b>Offers held</div></div>
      <div class="tablewrap"><table><tr><th>Offer</th><th>Units</th><th>Invested</th><th>Ownership</th><th>Payouts</th><th>Status</th></tr>${rows.map((r) => `<tr><td><a href="/invest/${r.spv_id}" data-link>${e(r.title)}</a></td><td>${r.units}</td><td class="notranslate">${money(r.amount)}</td><td>${((r.units / r.total_units) * 100).toFixed(2)}%</td><td class="notranslate">${money(r.distributed)}</td><td>${status(r.status)}</td></tr>`).join('')}</table></div>`;
  };
  DG.dashBind = (tab) => {
    const pf = $('#pf2'); if (pf) pf.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', pf), async () => { S.user = (await api('/me', { method: 'PATCH', body: formData(pf) })).user; toast('Profile saved.'); }); });
    const k = $('#kyc'); if (k) k.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', k), async () => { S.user = (await api('/me/kyc', { method: 'POST', form: new FormData(k) })).user; toast('Submitted for review.'); render(); }); });
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
    return `<h3>Identity checks awaiting review (${q.length})</h3>${q.length ? `<div class="tablewrap"><table><tr><th>Member</th><th>Document</th><th></th></tr>${q.map((u) => `<tr><td>${e(u.company || u.name || '—')}<br><span class="small muted notranslate">+${e(u.phone)} · ${e(TYPE[u.account_type] || '')}</span></td>
      <td>${e(u.kyc_doc_type)}<br><a href="/api/admin/kyc/${u.id}/file" target="_blank" rel="noopener">Open document ↗</a></td>
      <td><div class="row"><button class="btn sm" data-kyc="${u.id}" data-ok="1">Approve</button><button class="btn sm ghost" data-kyc="${u.id}" data-ok="0">Reject</button></div></td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing waiting.</p>'}
      <p class="small muted">Approving adds the verified badge. Listings are verified separately from the Listings tab.</p>`;
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
