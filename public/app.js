/* Dangaske Real Estate single-page app (no build step). */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  const S = { user: null, cfg: {}, unread: 0 };
  const STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];

  const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
  const SYM = { NGN: '₦', USD: '$', GBP: '£', AED: 'AED ' };
  const currency = () => { try { const c = localStorage.getItem('cur'); return c && (S.cfg.currency_rates || {})[c] ? c : 'NGN'; } catch { return 'NGN'; } };
  /** Listing prices in the visitor's chosen display currency (payments are always in naira). */
  const price = (n) => { const c = currency(); return c === 'NGN' ? money(n) : '≈ ' + (SYM[c] || c + ' ') + Math.round(Number(n || 0) / S.cfg.currency_rates[c]).toLocaleString('en'); };
  const vbadge = '<span class="vb" title="Verified">✔ Verified</span>';
  const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const date = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length > 10 ? 'Z' : '')).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  const status = (s) => `<span class="status ${e(s)}">${e(cap(s))}</span>`;
  const opts = (list, sel, blank) => (blank !== undefined ? `<option value="">${e(blank)}</option>` : '') +
    list.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, cap(o)]; return `<option value="${e(v)}"${String(v) === String(sel ?? '') ? ' selected' : ''}>${e(t)}</option>`; }).join('');

  async function api(path, { method = 'GET', body, form } = {}) {
    const res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'Request failed'); err.status = res.status; err.code = data.code; throw err; }
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 4200);
  }
  const fail = (err) => { if (err.status === 401) openLogin(); else if (err.code === 'kyc_required') { toast(err.message, true); go('/kyc'); } else toast(err.message, true); };

  /** Run an async action with the button disabled; errors become toasts. */
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (err) { fail(err); } finally { if (btn) btn.disabled = false; }
  }
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  const go = (url) => { history.pushState(null, '', url); render(); };
  const needLogin = (then) => { if (S.user) return false; openLogin(then); return true; };

  // ---------- modal + sign in (phone number, code delivered on WhatsApp) ----------
  function modal(html) {
    const m = $('#modal');
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><button class="x" data-close aria-label="Close">×</button>${html}</div>`;
    m.hidden = false;
    const first = $('input,select,textarea,button:not(.x)', m); if (first) first.focus();
    return m;
  }
  const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
  $('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal' || ev.target.closest('[data-close]')) closeModal(); });

  function openLogin(then) {
    const m = modal(`<h2>Sign in or join</h2>
      <p class="muted">Enter your WhatsApp number. We will send a verification code to it on WhatsApp.</p>
      <form id="f1"><label for="ph">WhatsApp phone number</label>
        <input id="ph" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" required>
        <p><button class="btn block">Send code on WhatsApp</button></p></form>`);
    $('#f1', m).addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy($('button.btn', ev.target), async () => {
        const r = await api('/auth/request-otp', { method: 'POST', body: formData(ev.target) });
        codeStep(r, then);
      });
    });
  }

  function codeStep(r, then) {
    const m = modal(`<h2>Enter your code</h2>
      <p class="muted">We sent a 6-digit code on WhatsApp to <b class="notranslate">+${e(r.phone)}</b>${(r.channels || []).includes('email') ? ' and to your email address' : ''}.</p>
      ${r.demo_code ? `<div class="demo">Demo mode — WhatsApp is not connected yet. Your code is <b class="notranslate">${e(r.demo_code)}</b></div>` : ''}
      <form id="f2" class="grid">
        <div><label for="cd">Verification code</label><input id="cd" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required value="${e(r.demo_code || '')}"></div>
        ${r.is_new ? `<div><label for="nm">Your name</label><input id="nm" name="name" autocomplete="name" required maxlength="80"></div>
        <div><label for="em">Email <span class="small muted">(optional — for receipts and alerts)</span></label><input id="em" name="email" type="email" autocomplete="email" maxlength="200"></div>
        <div><label for="rl">I am a</label><select id="rl" name="role">${[['buyer', 'Buyer / tenant / investor'], ['agent', 'Agent / property owner'], ['agency', 'Real estate agency'], ['developer', 'Developer'], ['service', 'Service provider (lawyer, surveyor…)']].map(([v, t]) => `<option value="${v}"${v === (DG.presetRole || 'buyer') ? ' selected' : ''}>${t}</option>`).join('')}</select><p class="small muted" style="margin:4px 0 0">Agents, agencies, developers and service providers complete identity verification (KYC) before they can post.</p></div>` : ''}
        <button class="btn block">Verify and continue</button></form>`);
    $('#f2', m).addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy($('button.btn', ev.target), async () => {
        const out = await api('/auth/verify', { method: 'POST', body: { phone: r.phone, ref: DG.ref ? DG.ref() : '', ...formData(ev.target) } });
        S.user = out.user; closeModal(); toast(`Welcome${S.user.name ? ', ' + S.user.name : ''}!`);
        const em = (formData(ev.target).email || '').trim();
        if (em) api('/me/email', { method: 'POST', body: { email: em } }).then((x) => { S.user = x.user; toast('We emailed you a code — confirm your email in your dashboard.'); }).catch(() => {});
        await refreshNotifs(); renderUser();
        if (r.is_new) offerPush();
        if (r.is_new && out.user.role === 'agent') go('/kyc'); else if (typeof then === 'function') then(); else render();
      });
    });
  }

  // ---------- push notifications ----------
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (s) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  async function enablePush() {
    if (!pushSupported) return toast('This browser does not support notifications.', true);
    if ((await Notification.requestPermission()) !== 'granted') return toast('Notifications are blocked in your browser settings.', true);
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(S.cfg.vapid_public_key) }));
    await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
    toast('Notifications are on. You will hear about new listings and sales first.');
  }
  function offerPush() {
    if (!pushSupported || Notification.permission !== 'default') return;
    const m = modal(`<h2>Get alerts first</h2><p>Turn on notifications to hear about new listings, price changes and sales the moment they happen.</p>
      <div class="row"><button class="btn gold" id="pyes">Turn on notifications</button><button class="btn ghost" data-close>Not now</button></div>`);
    $('#pyes', m).addEventListener('click', (ev) => busy(ev.target, async () => { await enablePush(); closeModal(); }));
  }
  async function refreshNotifs() {
    if (!S.user) return;
    try { S.unread = (await api('/notifications')).unread; } catch { /* ignore */ }
  }

  // ---------- header ----------
  function renderUser() {
    const box = $('#userbox');
    if (!S.user) { box.innerHTML = '<button class="btn gold sm" data-act="login">Sign in</button>'; return; }
    const pro = ['agent', 'admin'].includes(S.user.role);
    box.innerHTML = `${pro ? '<a class="btn gold sm" href="/post" data-link>+ Post property</a>' : ''}
      <a href="/dashboard" data-link>Dashboard</a>${S.user.role === 'admin' ? '<a href="/admin" data-link>Admin</a>' : ''}
      <a class="bell" href="/dashboard?tab=alerts" data-link aria-label="Notifications">🔔${S.unread ? `<b>${S.unread}</b>` : ''}</a>
      <button class="btn ghost sm" style="color:#fff;border-color:#fff" data-act="logout">Sign out</button>`;
  }

  // ---------- language (Google Translate) ----------
  function setupTranslate() {
    const sel = $('#lang');
    const cur = (document.cookie.match(/googtrans=\/en\/([a-z-]+)/i) || [])[1] || 'en';
    sel.value = cur;
    const load = () => {
      if (window.google && google.translate) return;
      window.gtInit = () => new google.translate.TranslateElement({ pageLanguage: 'en', includedLanguages: 'en,ha,yo,ig,ar,fr', autoDisplay: false }, 'gt-el');
      const s = document.createElement('script');
      s.src = 'https://translate.google.com/translate_a/element.js?cb=gtInit';
      s.onerror = () => toast('Translation is unavailable right now.', true);
      document.head.appendChild(s);
    };
    if (cur !== 'en') load();
    sel.addEventListener('change', () => {
      const host = location.hostname;
      const set = (v) => {
        document.cookie = `googtrans=${v}; path=/`;
        if (host.includes('.')) document.cookie = `googtrans=${v}; path=/; domain=.${host.split('.').slice(-2).join('.')}`;
      };
      if (sel.value === 'en') set('; expires=Thu, 01 Jan 1970 00:00:00 GMT'); else set(`/en/${sel.value}`);
      document.documentElement.dir = sel.value === 'ar' ? 'rtl' : 'ltr';
      location.reload();
    });
    if (cur === 'ar') document.documentElement.dir = 'rtl';
  }

  // ---------- shared pieces ----------
  const place = (p) => [p.area, p.city, p.state].filter(Boolean).join(', ');
  const specs = (p) => [p.bedrooms && `${p.bedrooms} bed`, p.bathrooms && `${p.bathrooms} bath`, p.size_sqm && `${Number(p.size_sqm).toLocaleString()} m²`, cap(p.type)].filter(Boolean).map((x) => `<span>${e(x)}</span>`).join('');
  const pcard = (p) => `<a class="pcard ${p.status === 'sold' ? 'sold' : ''}" href="/p/${p.id}" data-link>
    <div class="pimg">${p.cover_thumb ? `<img src="${e(p.cover_thumb)}" alt="" loading="lazy">` : ''}
      <div class="tags">${p.status === 'sold' ? '<span class="tag red">Sold</span>' : `<span class="tag">For ${e(p.purpose)}</span>`}${p.easy_buy && p.status !== 'sold' ? '<span class="tag gold">Easy-buy</span>' : ''}${p.new_dev ? '<span class="tag blue">New development</span>' : ''}${!['active', 'sold'].includes(p.status) ? `<span class="tag grey">${e(p.status)}</span>` : ''}</div>${p.verified ? '<span class="vtag">✔ Verified</span>' : ''}<span class="cardacts"><button data-act="fav" data-id="${p.id}" aria-label="Save" title="Save">${p.fav ? '♥' : '♡'}</button><button data-act="cmp" data-id="${p.id}" aria-label="Compare" title="Compare">⇄</button></span></div>
    <div class="pbody"><div class="price notranslate">${price(p.price)}${p.purpose === 'rent' ? '<small> /yr</small>' : ''}</div>
      <div class="ptitle">${e(p.title)}</div><div class="ploc">${e(place(p))}</div><div class="specs">${specs(p)}</div></div></a>`;
  const cards = (items, empty) => (items.length ? `<div class="cards">${items.map(pcard).join('')}</div>` : `<p class="muted pad center">${e(empty)}</p>`);

  function shareBar(p) {
    const url = location.origin + '/p/' + p.id;
    const text = `${p.title} — ${money(p.price)}${place(p) ? ', ' + place(p) : ''}`;
    const u = encodeURIComponent(url), t = encodeURIComponent(text);
    const links = [
      ['WhatsApp', `https://wa.me/?text=${t}%20${u}`], ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
      ['X', `https://twitter.com/intent/tweet?text=${t}&url=${u}`], ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`],
      ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`], ['Email', `mailto:?subject=${t}&body=${u}`],
    ];
    return `<div class="share">${navigator.share ? `<button data-act="nshare" data-url="${e(url)}" data-text="${e(text)}">Share…</button>` : ''}
      ${links.map(([n, h]) => `<a href="${e(h)}" target="_blank" rel="noopener">${n}</a>`).join('')}
      <button data-act="copy" data-url="${e(url)}">Copy link</button></div>
      <p class="small muted">Instagram and TikTok do not accept shared links — copy the link into your post or bio.</p>`;
  }

  // ---------- pages ----------
  async function home() {
    const { items } = await api('/properties?limit=8');
    app.innerHTML = `<div class="hero"><div class="hero-in">
      <h1>Own property the <em>easy</em>, safe way.</h1>
      <p>Verified houses and land from <span class="notranslate">${e(S.cfg.company)}</span>. Pay in instalments with easy-buy plans and protect every deal with escrow.</p>
      <form class="search" id="hs"><input class="wide" name="q" placeholder="City, area or keyword" aria-label="Search">
        <select name="purpose" aria-label="Purpose">${opts(S.cfg.purposes.map((x) => [x, 'For ' + x]), 'sale')}</select>
        <select name="type" aria-label="Type">${opts(S.cfg.types, '', 'Any type')}</select>
        <select name="state" aria-label="State">${opts(STATES, '', 'Any state')}</select>
        <button class="btn gold">Search</button></form>
      <div class="pills"><a class="pill" href="/listings?easy=1" data-link>Easy-buy properties</a><a class="pill" href="/listings?type=land" data-link>Land</a><a class="pill" href="/listings?purpose=rent" data-link>For rent</a><a class="pill" href="/request" data-link>Can't find it? Request it</a></div>
    </div></div>
    <section><div class="spread"><h2>Latest properties</h2><a href="/listings" data-link>View all →</a></div>${cards(items, 'No properties yet. Check back soon.')}</section>
    <section><h2>How it works</h2><div class="grid g4 steps">
      <div class="card"><h3>Join with WhatsApp</h3><p class="muted">Sign up with just your phone number, verified by a code on WhatsApp.</p></div>
      <div class="card"><h3>Find &amp; unlock</h3><p class="muted">Browse freely, then unlock a listing's address, documents, full gallery and contact.</p></div>
      <div class="card"><h3>Pay your way</h3><p class="muted">Pay outright or spread the cost with an easy-buy plan.</p></div>
      <div class="card"><h3>Protected by escrow</h3><p class="muted">Your money is held safely and only released when you confirm handover.</p></div></div></section>
    <section class="band"><div><h2>Looking for something specific?</h2><p>Tell us your budget and specification — agents will bring matching properties to you.</p></div><a class="btn gold" href="/request" data-link>Request a property</a></section>`;
    $('#hs').addEventListener('submit', (ev) => { ev.preventDefault(); go('/listings?' + cleanQuery(formData(ev.target))); });
  }
  const cleanQuery = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

  async function listingsPage(q) {
    const f = Object.fromEntries(q.entries());
    const data = await api('/properties?' + q.toString());
    app.innerHTML = `<h1 style="margin-top:28px">Properties</h1>
      <form class="filters" id="ff"><input name="q" placeholder="City, area or keyword" value="${e(f.q)}" aria-label="Search">
        <select name="purpose" aria-label="Purpose">${opts(S.cfg.purposes.map((x) => [x, 'For ' + x]), f.purpose, 'Any purpose')}</select>
        <select name="type" aria-label="Type">${opts(S.cfg.types, f.type, 'Any type')}</select>
        <select name="state" aria-label="State">${opts(STATES, f.state, 'Any state')}</select>
        <select name="beds" aria-label="Bedrooms">${opts([1, 2, 3, 4, 5].map((n) => [n, n + '+ beds']), f.beds, 'Any beds')}</select>
        <input name="max" inputmode="numeric" placeholder="Max price ₦" value="${e(f.max)}" aria-label="Maximum price">
        <button class="btn">Filter</button>
        <label class="check"><input type="checkbox" name="easy" value="1"${f.easy ? ' checked' : ''}> Easy-buy only</label>
        <label class="check"><input type="checkbox" name="verified" value="1"${f.verified ? ' checked' : ''}> Verified only</label>
        <label class="check"><input type="checkbox" name="new_dev" value="1"${f.new_dev ? ' checked' : ''}> New developments</label>
        <select name="sort" aria-label="Sort">${opts([['', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']], f.sort)}</select></form>
      <div class="spread"><p class="muted">${data.total} ${data.total === 1 ? 'property' : 'properties'} found</p><div class="row"><button class="btn sm ghost" data-act="savesearch">🔔 Save this search</button><a class="btn sm gold" href="/request" data-link>＋ Request a property</a><a class="btn sm ghost" href="/map" data-link>Map view</a><a class="btn sm ghost" href="/compare" data-link>Compare</a></div></div>
      ${cards(data.items, 'Nothing matches those filters yet. Try widening your search or send us a request.')}
      ${data.pages > 1 ? `<div class="pager">${data.page > 1 ? `<a class="btn ghost sm" data-link href="/listings?${cleanQuery({ ...f, page: data.page - 1 })}">← Prev</a>` : ''}<span>Page ${data.page} of ${data.pages}</span>${data.page < data.pages ? `<a class="btn ghost sm" data-link href="/listings?${cleanQuery({ ...f, page: data.page + 1 })}">Next →</a>` : ''}</div>` : ''}`;
    $('#ff').addEventListener('submit', (ev) => { ev.preventDefault(); go('/listings?' + cleanQuery(formData(ev.target))); });
  }

  async function propertyPage(id) {
    const p = await api('/properties/' + id);
    document.title = `${p.title} | ${S.cfg.site_name}`;
    const media = (p.media || []).filter((m) => m.status === 'ready');
    const main = (m) => (m.kind === 'video' ? `<video src="${e(m.url)}" controls playsinline poster="${e(m.thumb)}"></video>` : `<img src="${e(m.url)}" alt="${e(p.title)}">`);
    const sold = p.status === 'sold';
    app.innerHTML = `<div class="detail"><div>
      <div class="gallery-main" id="gm">${media.length ? main(media[0]) : p.cover ? `<img src="${e(p.cover)}" alt="${e(p.title)}">` : ''}
        <div class="tags">${sold ? '<span class="tag red">Sold</span>' : `<span class="tag">For ${e(p.purpose)}</span>`}${p.easy_buy && !sold ? '<span class="tag gold">Easy-buy</span>' : ''}</div></div>
      ${media.length > 1 ? `<div class="thumbs">${media.map((m, i) => `<button class="${i ? '' : 'on'} ${m.kind === 'video' ? 'play' : ''}" data-i="${i}" aria-label="Media ${i + 1}">${m.thumb ? `<img src="${e(m.thumb)}" alt="">` : ''}</button>`).join('')}</div>` : ''}
      <h1 style="margin-top:18px">${e(p.title)}</h1><p class="muted">${e(place(p))}</p>
      <div class="chips" style="margin-bottom:6px">${p.verified ? '<span class="chip ok">✔ Verified listing</span>' : ''}${p.agent && p.agent.verified ? '<span class="chip ok">✔ Verified professional</span>' : ''}${!sold ? '<span class="chip ok">🛡 Escrow-ready</span>' : ''}${p.new_dev ? '<span class="chip">New development</span>' : ''}<a class="chip" href="/trust" data-link>What do these mean?</a></div>
      ${p.agent ? `<p class="small">Listed by <a href="/agents/${p.agent.id}" data-link>${e(p.agent.name)}</a></p>` : ''}
      <div class="facts"><div class="fact"><small>Price</small><b class="notranslate">${money(p.price)}</b>${currency() !== 'NGN' ? `<small class="notranslate">${price(p.price)}</small>` : ''}</div><div class="fact"><small>Type</small><b>${e(cap(p.type))}</b></div>
        ${p.bedrooms ? `<div class="fact"><small>Bedrooms</small><b>${p.bedrooms}</b></div>` : ''}${p.bathrooms ? `<div class="fact"><small>Bathrooms</small><b>${p.bathrooms}</b></div>` : ''}
        ${p.size_sqm ? `<div class="fact"><small>Size</small><b>${Number(p.size_sqm).toLocaleString()} m²</b></div>` : ''}<div class="fact"><small>Photos / videos</small><b>${p.image_count} / ${p.video_count}</b></div></div>
      ${p.locked ? `<p class="prose">${e(p.excerpt)}</p>
        <div class="lockbox"><h3>🔒 Unlock full information</h3>
          <ul><li>Exact address and map</li><li>Full description and features</li><li>All ${p.image_count} photos and ${p.video_count} videos</li><li>Title documents</li><li>Direct contact number</li></ul>
          <div><button class="btn gold" data-act="unlock" data-id="${p.id}">Unlock for <span class="notranslate">${money(p.unlock_fee)}</span></button></div>
          <p class="small muted">One-time fee. Access stays on your account.</p></div>`
      : `<h3>Description</h3><p class="prose">${e(p.description) || '<span class="muted">No description.</span>'}</p>
        ${p.features ? `<h3>Features</h3><div class="chips">${p.features.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `<span class="chip">${e(x)}</span>`).join('')}</div>` : ''}
        <div class="facts">${p.address ? `<div class="fact"><small>Address</small><b>${e(p.address)}</b></div>` : ''}${p.title_doc ? `<div class="fact"><small>Title document</small><b>${e(p.title_doc)}</b></div>` : ''}
          <div class="fact"><small>Listed by</small><b>${e(p.listed_by)}</b></div></div>
        ${p.map_url ? `<p><a href="${e(p.map_url)}" target="_blank" rel="noopener">Open location on map ↗</a></p>` : ''}`}
    <div id="pmain"></div></div>
    <aside class="side"><div id="px" class="grid"></div>
      ${p.can_manage ? `<div class="card"><h3>Manage listing</h3><p>${status(p.status)}</p><div class="row"><a class="btn sm" href="/post?id=${p.id}" data-link>Edit</a>${p.status === 'active' ? `<button class="btn sm danger" data-act="sold" data-id="${p.id}">Mark sold</button>` : ''}</div></div>` : ''}
      ${!p.locked && p.contact_phone && !sold ? `<div class="card"><h3>Contact</h3><p class="notranslate"><b>${e(p.contact_phone)}</b></p><div class="row"><a class="btn sm" href="https://wa.me/${e(String(p.contact_phone).replace(/\D/g, '').replace(/^0/, '234'))}?text=${encodeURIComponent('Hello, I am interested in: ' + p.title + ' ' + location.origin + '/p/' + p.id)}" target="_blank" rel="noopener">Chat on WhatsApp</a><a class="btn sm ghost" href="tel:${e(p.contact_phone)}">Call</a></div></div>` : ''}
      ${p.plans && p.plans.length ? `<div class="card"><h3>Easy-buy plans</h3><div class="grid">${p.plans.map((pl) => `<div class="plan"><div class="spread"><b>${e(pl.name)}</b><span class="small muted">${pl.months} months</span></div>
          <div class="small">Deposit <b class="notranslate">${money(pl.deposit)}</b> (${pl.deposit_pct}%) then <b class="notranslate">${money(pl.monthly)}</b>/month</div>
          <div class="small muted">Total <span class="notranslate">${money(pl.total)}</span>${pl.markup_pct ? ` (+${pl.markup_pct}%)` : ' (no extra charge)'}</div>
          <button class="btn sm" data-act="subscribe" data-id="${p.id}" data-plan="${pl.plan_id}">Choose this plan</button></div>`).join('')}</div></div>` : ''}
      ${!sold && !p.can_manage ? `<div class="card"><h3>Buy safely with escrow</h3><p class="small muted">We hold your payment and only release it to the seller when you confirm handover. Fee: ${S.cfg.escrow_fee_pct}%.</p><button class="btn block" data-act="escrow" data-id="${p.id}" data-price="${p.price}">Start escrow</button></div>` : ''}
      <div class="card"><h3>Share this property</h3>${shareBar(p)}</div>
      <p class="small center"><a href="/trust?report=${p.id}" data-link>Report this listing</a></p>
    </aside></div>`;
    if (DG.propertyExtras) DG.propertyExtras(p);
    app.querySelectorAll('.thumbs button').forEach((b) => b.addEventListener('click', () => {
      app.querySelectorAll('.thumbs button').forEach((x) => x.classList.toggle('on', x === b));
      const tags = $('#gm .tags').outerHTML; $('#gm').innerHTML = main(media[b.dataset.i]) + tags;
    }));
  }

  // post / edit listing
  async function postPage(q) {
    if (needLogin()) return (app.innerHTML = '<p class="pad center muted">Sign in to post a property.</p>');
    if (S.user.role === 'agent' && !S.user.verified) return (app.innerHTML = `<div class="pad center"><h2>Verify your identity first</h2><p class="muted">${S.user.kyc_status === 'pending' ? 'Your documents are under review. You can post as soon as you are approved.' : 'Agents, agencies and developers must complete identity verification (KYC) before posting.'}</p><a class="btn gold" href="/kyc" data-link>${S.user.kyc_status === 'pending' ? 'View my verification' : 'Complete KYC'}</a></div>`);
    if (!['agent', 'admin'].includes(S.user.role)) return (app.innerHTML = '<div class="pad center"><h2>Agents only</h2><p class="muted">Posting is for registered agents. Contact us to upgrade your account, or send a <a href="/request" data-link>property request</a>.</p></div>');
    const id = q.get('id');
    let p = id ? await api('/properties/' + id) : null;
    const v = (k) => e(p ? p[k] ?? '' : '');
    const draw = () => {
      app.innerHTML = `<h1 style="margin-top:28px">${p ? 'Edit listing' : 'Post a property'}</h1>
      ${p ? `<p>${status(p.status)} ${p.status === 'active' ? `<a href="/p/${p.id}" data-link>View live page</a>` : ''}</p>` : '<p class="muted">Step 1: details. Step 2: photos and videos. Tip: admins and agents can also post from WhatsApp.</p>'}
      <form id="pf" class="card grid">
        <div><label>Title</label><input name="title" required maxlength="120" value="${v('title')}" placeholder="e.g. 4 bedroom duplex with BQ"></div>
        <div class="grid g4 keep2"><div><label>Purpose</label><select name="purpose">${opts(S.cfg.purposes, p && p.purpose)}</select></div><div><label>Type</label><select name="type">${opts(S.cfg.types, p && p.type)}</select></div>
          <div><label>Price (₦)</label><input name="price" inputmode="numeric" required value="${v('price')}"></div><div><label>Size (m²)</label><input name="size_sqm" inputmode="numeric" value="${p && p.size_sqm ? p.size_sqm : ''}"></div></div>
        <div class="grid g4 keep2"><div><label>State</label><select name="state">${opts(STATES, p && p.state, 'Select')}</select></div><div><label>City / LGA</label><input name="city" value="${v('city')}"></div>
          <div><label>Area</label><input name="area" value="${v('area')}"></div><div><label>Bedrooms</label><input name="bedrooms" inputmode="numeric" value="${p && p.bedrooms ? p.bedrooms : ''}"></div></div>
        <div class="grid g3"><div><label>Bathrooms</label><input name="bathrooms" inputmode="numeric" value="${p && p.bathrooms ? p.bathrooms : ''}"></div><div><label>Title document</label><input name="title_doc" value="${v('title_doc')}" placeholder="C of O, R of O, Deed…"></div><div><label>Contact phone</label><input name="contact_phone" type="tel" value="${v('contact_phone')}"></div></div>
        <div><label>Full address <span class="muted small">(only shown after unlock)</span></label><input name="address" value="${v('address')}"></div>
        <div><label>Map link <span class="muted small">(optional, https)</span></label><input name="map_url" type="url" value="${v('map_url')}"></div>
        <div class="grid g3"><div><label>Latitude <span class="muted small">(optional)</span></label><input name="lat" inputmode="decimal" value="${p && p.lat != null ? p.lat : ''}" placeholder="12.0022"></div><div><label>Longitude</label><input name="lng" inputmode="decimal" value="${p && p.lng != null ? p.lng : ''}" placeholder="8.5920"></div><div><label>Virtual tour / video link <span class="muted small">(https)</span></label><input name="tour_url" type="url" value="${v('tour_url')}"></div></div>
        <div><label>Nearby <span class="muted small">(schools, roads, markets — comma separated, shown publicly)</span></label><input name="nearby" value="${v('nearby')}"></div>
        <div><label>Distance from the city centre (km) <span class="muted small">— land; used for the inspection fee when there is no map pin</span></label><input name="distance_km" inputmode="decimal" value="${p && p.distance_km != null ? p.distance_km : ''}"></div>
        <div><label>Features <span class="muted small">(comma separated)</span></label><input name="features" value="${v('features')}" placeholder="Borehole, parking, BQ"></div>
        <div><label>Description</label><textarea name="description" maxlength="5000">${v('description')}</textarea></div>
        <label class="check"><input type="checkbox" name="easy_buy" value="1"${p && p.easy_buy ? ' checked' : ''}> Offer easy-buy instalment plans on this property</label>
        <label class="check"><input type="checkbox" name="new_dev" value="1"${p && p.new_dev ? ' checked' : ''}> This is a new development / off-plan project</label>
        <div class="row"><button class="btn">${p ? 'Save changes' : 'Save and add photos'}</button></div></form>
      ${p ? `<section class="card"><div class="spread"><h2>Photos &amp; videos</h2><span class="small muted">Compressed automatically to save space</span></div>
        ${p.status === 'sold' ? '<p class="muted">This listing is sold — only the cover photo is kept.</p>' : `<p><input type="file" id="files" accept="image/*,video/*" multiple> </p>`}
        <div class="mediagrid">${(p.media || []).map((m) => `<div class="mitem ${m.is_cover ? 'cover' : ''}">${m.thumb ? `<img src="${e(m.thumb)}" alt="">` : ''}
          ${m.status !== 'ready' ? `<div class="note">${m.status === 'processing' ? 'Compressing video…' : 'Failed'}</div>` : m.orig_bytes ? `<div class="note" style="background:none;place-items:start;font-size:.7rem"><span style="background:rgba(0,0,0,.55);padding:1px 5px;border-radius:4px">${mb(m.bytes)} (was ${mb(m.orig_bytes)})</span></div>` : ''}
          <div class="acts">${m.kind === 'image' && !m.is_cover ? `<button data-act="cover" data-m="${m.id}">Cover</button>` : ''}${p.status !== 'sold' ? `<button data-act="delm" data-m="${m.id}">Delete</button>` : ''}</div></div>`).join('') || '<p class="muted">No media yet.</p>'}</div></section>
        <div class="row" style="margin:20px 0">${['draft', 'rejected'].includes(p.status) ? `<button class="btn gold" id="pub">${S.user.role === 'admin' ? 'Publish now' : 'Submit for approval'}</button>` : ''}
          ${p.status === 'active' ? `<button class="btn danger" data-act="sold" data-id="${p.id}">Mark as sold</button>` : ''}<button class="btn ghost" id="del">Delete listing</button></div>` : ''}`;
      $('#pf').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const body = formData(ev.target); body.easy_buy = Boolean(body.easy_buy); body.new_dev = Boolean(body.new_dev);
        busy($('button', ev.target), async () => {
          if (p) { p = await api('/properties/' + p.id, { method: 'PATCH', body }); toast('Saved.'); draw(); }
          else { const n = await api('/properties', { method: 'POST', body }); toast('Saved. Now add photos.'); history.replaceState(null, '', '/post?id=' + n.id); p = n; draw(); }
        });
      });
      if (!p) return;
      const files = $('#files');
      if (files) files.addEventListener('change', () => busy(files, async () => {
        const form = new FormData(); for (const f of files.files) form.append('files', f);
        toast('Uploading and compressing…');
        p = await api(`/properties/${p.id}/media`, { method: 'POST', form });
        toast(p.failed && p.failed.length ? `Could not process: ${p.failed.join(', ')}` : 'Media added.', p.failed && p.failed.length); draw();
      }));
      app.querySelectorAll('[data-act=cover]').forEach((b) => b.addEventListener('click', () => busy(b, async () => { p = await api(`/properties/${p.id}/cover`, { method: 'POST', body: { media_id: Number(b.dataset.m) } }); draw(); })));
      app.querySelectorAll('[data-act=delm]').forEach((b) => b.addEventListener('click', () => busy(b, async () => { p = await api(`/properties/${p.id}/media/${b.dataset.m}`, { method: 'DELETE' }); draw(); })));
      const pub = $('#pub');
      if (pub) pub.addEventListener('click', () => busy(pub, async () => { p = await api(`/properties/${p.id}/submit`, { method: 'POST' }); toast(p.status === 'active' ? 'Published! Members have been notified.' : 'Submitted for approval.'); p = await api('/properties/' + p.id); draw(); }));
      $('#del').addEventListener('click', () => { if (confirm('Delete this listing and all its media?')) busy($('#del'), async () => { await api('/properties/' + p.id, { method: 'DELETE' }); toast('Listing deleted.'); go('/dashboard'); }); });
      if ((p.media || []).some((m) => m.status === 'processing')) setTimeout(async () => { if (location.pathname === '/post' && $('#pf')) { p = await api('/properties/' + p.id).catch(() => p); draw(); } }, 5000);
    };
    draw();
  }

  // property requests
  function requestPage() {
    const fee = S.user && S.user.role === 'admin' ? 0 : S.cfg.request_fee || 0;
    app.innerHTML = `<h1 style="margin-top:28px">Request a property</h1><p class="muted">Agents and buyers: describe exactly what you need. Our team and registered agents are notified, and you get an alert when a matching property is listed.</p>
      <form id="rf" class="card grid">
        <div class="grid g3"><div><label>I want to</label><select name="purpose">${opts([['sale', 'Buy'], ['rent', 'Rent'], ['shortlet', 'Shortlet']])}</select></div><div><label>Property type</label><select name="type">${opts(S.cfg.types, '', 'Any type')}</select></div><div><label>Minimum bedrooms</label><input name="bedrooms" inputmode="numeric"></div></div>
        <div class="grid g2"><div><label>State</label><select name="state">${opts(STATES, '', 'Any state')}</select></div><div><label>City / preferred areas</label><input name="city"></div></div>
        <div class="grid g3"><div><label>Minimum budget (₦)</label><input name="min_price" inputmode="numeric"></div><div><label>Maximum budget (₦)</label><input name="max_price" inputmode="numeric"></div><div><label>Contact phone</label><input name="contact_phone" type="tel" value="${e(S.user ? S.user.phone : '')}"></div></div>
        <div><label>Specification</label><textarea name="details" maxlength="1500" placeholder="Size, documents required, road access, finishing, timeline, payment preference…"></textarea></div>
        ${fee ? `<p class="demo" style="margin:0">A request fee of <b class="notranslate">${money(fee)}</b> applies. It keeps requests serious and is paid when you submit; your request goes live as soon as payment is confirmed.</p>` : ''}<div><button class="btn gold">${fee ? `Pay <span class="notranslate">${money(fee)}</span> &amp; submit request` : 'Submit request'}</button></div></form>`;
    $('#rf').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const send = () => busy($('button', ev.target), async () => { const r = await api('/requests', { method: 'POST', body: formData(ev.target) }); if (r.url) { location.href = r.url; return; } toast('Request published. Agents have been alerted.'); go('/requests'); });
      if (!needLogin(send)) send();
    });
  }

  async function requestsPage() {
    const rows = await api('/requests');
    const budget = (r) => (r.min_price || r.max_price ? `${r.min_price ? money(r.min_price) : 'Any'} – ${r.max_price ? money(r.max_price) : 'Any'}` : 'Open budget');
    app.innerHTML = `<div class="spread" style="margin-top:28px"><h1>Property requests</h1><a class="btn gold" href="/request" data-link>+ Add a request</a></div>
      <p class="muted">What buyers and agents are looking for right now. ${S.user && ['agent', 'admin'].includes(S.user.role) ? '' : 'Contact details are visible to registered agents.'}</p>
      <div class="grid g2">${rows.map((r) => `<div class="card"><div class="spread"><h3>${e(cap(r.type || 'Property'))} to ${r.purpose === 'sale' ? 'buy' : e(r.purpose)}</h3>${r.mine ? '<span class="status open">Yours</span>' : ''}</div>
        <p class="small muted">${e([r.city, r.state].filter(Boolean).join(', ') || 'Any location')} · ${r.bedrooms ? r.bedrooms + '+ beds · ' : ''}<span class="notranslate">${budget(r)}</span> · ${date(r.created_at)}</p>
        <p class="prose">${e(r.details)}</p>
        ${r.contact_phone ? `<p class="small notranslate"><b>${e(r.user_name || 'Member')}</b> · <a href="https://wa.me/${e(String(r.contact_phone).replace(/\D/g, '').replace(/^0/, '234'))}" target="_blank" rel="noopener">${e(r.contact_phone)}</a></p>` : ''}
        ${r.mine || (S.user && S.user.role === 'admin') ? `<button class="btn sm ghost" data-act="closereq" data-id="${r.id}">Close request</button>` : ''}</div>`).join('') || '<p class="muted">No open requests yet.</p>'}</div>`;
  }

  const escrowRow = (x, adminView) => {
    const acts = [];
    if (x.status === 'awaiting_payment' && x.role === 'buyer') acts.push(`<button class="btn sm gold" data-act="epay" data-id="${x.id}">Pay ${money(x.amount + x.fee - (x.credit || 0))}</button>`, `<button class="btn sm ghost" data-act="ecancel" data-id="${x.id}">Cancel</button>`);
    if (x.status === 'funded' && x.role === 'buyer') acts.push(`<button class="btn sm" data-act="erelease" data-id="${x.id}">Confirm handover &amp; release</button>`);
    if (x.status === 'funded' && !adminView) acts.push(`<button class="btn sm ghost" data-act="edispute" data-id="${x.id}">Raise dispute</button>`);
    if (adminView && ['funded', 'disputed'].includes(x.status)) acts.push(`<button class="btn sm" data-act="erelease" data-id="${x.id}">Release to seller</button>`, x.docs_checked ? '' : `<button class="btn sm ghost" data-act="edocs" data-id="${x.id}">Documents verified</button>`, `<button class="btn sm danger" data-act="erefund" data-id="${x.id}">Refund buyer</button>`);
    return `<tr><td>#${x.id}<br><a href="/p/${x.property_id}" data-link>${e(x.property_title)}</a></td>
      <td class="notranslate">${money(x.amount)}<br><span class="small muted">+ ${money(x.fee)} fee${x.credit ? `<br>− ${money(x.credit)} fees already paid` : ''}</span></td>
      <td>${adminView ? `<span class="small notranslate">Buyer: ${e(x.buyer_name)} +${e(x.buyer_phone)}<br>Seller: ${e(x.seller_name)} +${e(x.seller_phone)}</span>` : e(cap(x.role))}</td>
      <td>${status(x.status)}${DG.tracker ? DG.tracker(x) : ''}<ul class="timeline">${x.events.map((v) => `<li>${date(v.created_at)} — ${e(v.event)}${v.note ? ': ' + e(v.note) : ''}</li>`).join('')}</ul></td><td><div class="row">${acts.join('')}</div></td></tr>`;
  };
  const subBlock = (s, adminView) => `<div class="card" style="margin-bottom:14px"><div class="spread"><h3><a href="/p/${s.property_id}" data-link>${e(s.property_title)}</a> — ${e(s.plan_name)}</h3>${status(s.status)}</div>
    <p class="small muted notranslate">${adminView ? `${e(s.user_name)} +${e(s.user_phone)} · ` : ''}Paid ${money(s.paid)} of ${money(s.total)}</p>
    <div class="tablewrap"><table><tr><th>#</th><th>Due</th><th>Amount</th><th>Status</th><th></th></tr>${s.installments.map((i, n) => `<tr><td>${i.seq === 0 ? 'Deposit' : i.seq}</td><td>${date(i.due_date)}</td><td class="notranslate">${money(i.amount)}</td><td>${status(i.status)}</td>
      <td>${!adminView && i.status !== 'paid' && s.status !== 'cancelled' && s.installments.slice(0, n).every((k) => k.status === 'paid') ? `<button class="btn sm gold" data-act="ipay" data-id="${i.id}">Pay now</button>` : ''}</td></tr>`).join('')}</table></div></div>`;

  async function dashboard(q) {
    if (needLogin()) return (app.innerHTML = '<p class="pad center muted">Sign in to see your dashboard.</p>');
    const tab = q.get('tab') || 'overview';
    const pro = ['agent', 'admin'].includes(S.user.role);
    const tabs = [['overview', 'Overview'], ...(pro ? [['listings', 'My listings']] : []), ['messages', 'Messages'], ['inspections', 'Inspections'], ['saved', 'Saved'], ['plans', 'Easy-buy'], ['escrow', 'Escrow'], ['invest', 'Investments'], ['payments', 'Receipts & documents'], ['referrals', 'Refer & earn'], ['verify', 'Verification'], ['alerts', `Alerts${S.unread ? ` (${S.unread})` : ''}`]];
    let body = '';
    if (DG.dashTabs[tab]) body = await DG.dashTabs[tab]();
    else if (tab === 'listings') body = cards(await api('/my/properties'), 'You have not posted any property yet.');
    else if (tab === 'plans') { const subs = await api('/my/subscriptions'); body = subs.map((s) => subBlock(s)).join('') || '<p class="muted">No easy-buy plans yet. Look for the “Easy-buy” tag on listings.</p>'; }
    else if (tab === 'escrow') { const es = await api('/my/escrows'); body = es.length ? `<div class="tablewrap"><table><tr><th>Property</th><th>Amount</th><th>You are</th><th>Status</th><th></th></tr>${es.map((x) => escrowRow(x)).join('')}</table></div>` : '<p class="muted">No escrow transactions yet.</p>'; }
    else if (tab === 'alerts') {
      const n = await api('/notifications'); const seen = n.unread; api('/notifications/seen', { method: 'POST' }).catch(() => {}); S.unread = 0; renderUser();
      body = `<p><button class="btn sm gold" data-act="push">Turn on push notifications on this device</button></p>` + (n.items.map((x, i) => `<a class="notif ${i < seen ? 'unread' : ''}" href="${e(x.url)}" data-link><b>${e(x.title)}</b><br><span class="small">${e(x.body)}</span> <span class="small muted">· ${date(x.created_at)}</span></a>`).join('') || '<p class="muted">Nothing yet.</p>');
    } else body = `<div class="card"><form id="nf" class="row"><div style="flex:1;min-width:200px"><label>Your name</label><input name="name" value="${e(S.user.name)}" maxlength="80"></div><button class="btn sm" style="align-self:flex-end">Save</button></form>
        <p class="small muted notranslate">+${e(S.user.phone)} · ${e(cap(S.user.role))} account</p></div>
      <div class="grid g3" style="margin-top:16px"><a class="card" href="/listings" data-link><h3>Browse properties</h3><span class="muted small">Find your next home or plot</span></a><a class="card" href="/request" data-link><h3>Request a property</h3><span class="muted small">Tell us your specification</span></a><a class="card" href="/dashboard?tab=alerts" data-link><h3>Notifications</h3><span class="muted small">New listings and sales activity</span></a></div>`;
    app.innerHTML = `<h1 style="margin-top:28px">Dashboard</h1><div class="tabs">${tabs.map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${e(t)}</button>`).join('')}</div>${body}`;
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go('/dashboard?tab=' + b.dataset.tab)));
    if (DG.dashBind) DG.dashBind(tab);
  }

  async function adminPage(q) {
    if (needLogin()) return (app.innerHTML = '<p class="pad center muted">Sign in as an admin.</p>');
    const d = await api('/admin/overview');
    const tab = q.get('tab') || 'listings';
    const s = d.stats, ig = d.integrations;
    const on = (v) => (v ? '<span class="status active">Connected</span>' : '<span class="status pending">Not set up</span>');
    const prow = (p) => `<tr><td>#${p.id} <a href="/p/${p.id}" data-link>${e(p.title)}</a><br><span class="small muted">${e(place(p))}</span></td><td class="notranslate">${money(p.price)}</td><td>${status(p.status)}</td><td>${p.image_count}/${p.video_count}</td>
      <td><div class="row">${p.status === 'pending' ? `<button class="btn sm" data-act="approve" data-id="${p.id}">Approve</button><button class="btn sm ghost" data-act="reject" data-id="${p.id}">Reject</button>` : ''}<a class="btn sm ghost" href="/post?id=${p.id}" data-link>Edit</a>${p.status === 'active' ? `<button class="btn sm ghost" data-act="pflag" data-id="${p.id}" data-k="verified" data-v="${p.verified ? 0 : 1}">${p.verified ? '✔ Verified' : 'Verify'}</button><button class="btn sm ghost" data-act="pflag" data-id="${p.id}" data-k="featured" data-v="${p.featured ? 0 : 1}">${p.featured ? '★ Featured' : 'Feature'}</button><button class="btn sm danger" data-act="sold" data-id="${p.id}">Sold</button>` : ''}</div></td></tr>`;
    const body = {
      listings: `<div class="tablewrap"><table><tr><th>Listing</th><th>Price</th><th>Status</th><th>Photos/videos</th><th></th></tr>${[...d.pending, ...d.listings].map(prow).join('')}</table></div>`,
      escrow: d.escrows.length ? `<div class="tablewrap"><table><tr><th>Property</th><th>Amount</th><th>Parties</th><th>Status</th><th></th></tr>${d.escrows.map((x) => escrowRow(x, true)).join('')}</table></div><p class="small muted">Releasing marks the property sold. Pay out the seller (or refund the buyer) from your Paystack dashboard / bank.</p>` : '<p class="muted">No escrows yet.</p>',
      plans: `<h3>Plans offered</h3><div class="tablewrap"><table><tr><th>Name</th><th>Months</th><th>Deposit %</th><th>Markup %</th><th>Active</th><th></th></tr>${[...d.plans, { id: '', name: '', months: '', deposit_pct: '', markup_pct: '', active: 1 }].map((p) => `<tr data-plan="${p.id}"><td><input name="name" value="${e(p.name)}" placeholder="New plan name"></td><td><input name="months" inputmode="numeric" value="${e(p.months)}"></td><td><input name="deposit_pct" inputmode="decimal" value="${e(p.deposit_pct)}"></td><td><input name="markup_pct" inputmode="decimal" value="${e(p.markup_pct)}"></td><td><input type="checkbox" name="active" style="width:auto"${p.active ? ' checked' : ''}></td><td><button class="btn sm" data-act="saveplan">${p.id ? 'Save' : 'Add'}</button></td></tr>`).join('')}</table></div>
        <h3 style="margin-top:24px">Customer plans</h3>${d.subscriptions.map((x) => subBlock(x, true)).join('') || '<p class="muted">None yet.</p>'}`,
      users: `<div class="tablewrap"><table><tr><th>Member</th><th>Phone</th><th>Joined</th><th>Role</th></tr>${d.users.map((u) => `<tr><td>${e(u.name || '—')}</td><td class="notranslate">+${e(u.phone)}</td><td>${date(u.created_at)}</td><td><select data-role="${u.id}"${u.id === S.user.id ? ' disabled' : ''}>${opts(['buyer', 'agent', 'admin'], u.role)}</select></td></tr>`).join('')}</table></div>`,
      settings: `<form id="sf" class="card grid"><h3>Fees</h3><div class="grid g3"><div><label>Escrow fee (%)</label><input name="escrow_fee_pct" inputmode="decimal" value="${e(d.settings.escrow_fee_pct)}"></div><div><label>Phone numbers shown on the site</label><input name="phones" value="${e(d.settings.phones)}"></div><div><label>Support WhatsApp number</label><input name="support_whatsapp" value="${e(d.settings.support_whatsapp)}"></div></div><div class="grid g3"><div><label>Contact email</label><input name="contact_email" type="email" value="${e(d.settings.contact_email)}"></div><div><label>Office address</label><input name="office_address" value="${e(d.settings.office_address)}"></div><div><label>Property request fee (₦, 0 = free)</label><input name="request_fee" inputmode="numeric" value="${e(d.settings.request_fee)}"></div></div><h3>Inspection fees</h3><p class="small muted">Paid by the buyer to confirm an inspection. Land: base fee + rate × km between the plot and the city centre (from the map pin, or the distance the lister enters), never above the maximum.</p><div class="grid g3"><div><label>Rent: fee changes at (₦ a year)</label><input name="insp_rent_limit" inputmode="numeric" value="${e(d.settings.insp_rent_limit)}"></div><div><label>Rent below that (₦)</label><input name="insp_rent_low" inputmode="numeric" value="${e(d.settings.insp_rent_low)}"></div><div><label>Rent at or above (₦)</label><input name="insp_rent_high" inputmode="numeric" value="${e(d.settings.insp_rent_high)}"></div><div><label>Buy: first band up to (₦)</label><input name="insp_sale_t1" inputmode="numeric" value="${e(d.settings.insp_sale_t1)}"></div><div><label>Buy: below first limit (₦)</label><input name="insp_sale_f1" inputmode="numeric" value="${e(d.settings.insp_sale_f1)}"></div><div><label>Buy: second band up to (₦)</label><input name="insp_sale_t2" inputmode="numeric" value="${e(d.settings.insp_sale_t2)}"></div><div><label>Buy: between the limits (₦)</label><input name="insp_sale_f2" inputmode="numeric" value="${e(d.settings.insp_sale_f2)}"></div><div><label>Buy: above second limit (₦)</label><input name="insp_sale_f3" inputmode="numeric" value="${e(d.settings.insp_sale_f3)}"></div><div><label>Fallback fee (₦)</label><input name="inspection_fee" inputmode="numeric" value="${e(d.settings.inspection_fee)}"></div><div><label>Land: base fee (₦)</label><input name="insp_land_base" inputmode="numeric" value="${e(d.settings.insp_land_base)}"></div><div><label>Land: extra per km from city (₦)</label><input name="insp_land_km" inputmode="numeric" value="${e(d.settings.insp_land_km)}"></div><div><label>Land: maximum fee (₦)</label><input name="insp_land_max" inputmode="numeric" value="${e(d.settings.insp_land_max)}"></div></div><div class="grid g3"><div><label>Title check fee (₦)</label><input name="title_check_fee" inputmode="numeric" value="${e(d.settings.title_check_fee)}"></div><div><label>Referral reward (₦)</label><input name="referral_reward" inputmode="numeric" value="${e(d.settings.referral_reward)}"></div><div><label>SPV unit resale market</label><select name="secondary_market">${opts([['0', 'Off'], ['1', 'On']], d.settings.secondary_market)}</select></div><div><label>Display currency rates (₦ per 1 unit, JSON)</label><input name="currency_rates" value="${e(d.settings.currency_rates)}"></div></div><div><button class="btn">Save settings</button></div></form>
        <form id="bf" class="card grid" style="margin-top:16px"><h3>Send a push notification to all members</h3><input name="title" placeholder="Title" required maxlength="80"><input name="body" placeholder="Message" maxlength="200"><div><button class="btn gold">Send to ${s.push_devices} device(s)</button></div></form>
        <div class="card" style="margin-top:16px"><h3>Integrations</h3><table><tr><td>WhatsApp (login codes + listing bot)</td><td>${on(ig.whatsapp)}</td></tr><tr><td>Email (codes, receipts and alerts)</td><td>${on(ig.email)}</td></tr><tr><td>Paystack payments</td><td>${on(ig.payments)}</td></tr><tr><td>Video compression (ffmpeg)</td><td>${on(ig.video_compression)}</td></tr><tr><td>Auto-post to Facebook page</td><td>${on(ig.facebook)}</td></tr><tr><td>Auto-post to Telegram channel</td><td>${on(ig.telegram)}</td></tr></table><p class="small muted">Set these up in the server's .env file — see the README.</p></div>`,
    }[DG.adminTabs[tab] ? '' : tab] || (DG.adminTabs[tab] ? await DG.adminTabs[tab](d) : '');
    app.innerHTML = `<h1 style="margin-top:28px">Admin</h1>
      <div class="stats"><div class="stat"><b>${s.members}</b>Members</div><div class="stat"><b>${s.active}</b>Live listings</div><div class="stat"><b>${s.pending}</b>Awaiting approval</div><div class="stat"><b>${s.sold}</b>Sold</div><div class="stat"><b class="notranslate">${money(s.unlock_revenue)}</b>Unlock revenue</div><div class="stat"><b class="notranslate">${money(s.escrow_held)}</b>Held in escrow</div><div class="stat"><b>${mb(s.storage_used)}</b>Media storage (${mb(s.storage_saved)} saved)</div></div>
      <div class="tabs">${[['listings', 'Listings'], ['escrow', 'Escrow'], ['plans', 'Easy-buy'], ['invest', 'Investments'], ['desk', 'Service desk'], ['users', 'Members'], ['verify', 'Verification'], ['reports', 'Reports'], ['posts', 'Articles'], ['audit', 'Audit trail'], ['settings', 'Settings']].map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>${body}`;
    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go('/admin?tab=' + b.dataset.tab)));
    app.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', () => busy(sel, async () => { await api(`/admin/users/${sel.dataset.role}/role`, { method: 'POST', body: { role: sel.value } }); toast('Role updated.'); })));
    app.querySelectorAll('[data-act=saveplan]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const tr = b.closest('tr'); const body = {}; tr.querySelectorAll('input').forEach((i) => (body[i.name] = i.type === 'checkbox' ? i.checked : i.value));
      await api('/admin/plans' + (tr.dataset.plan ? '/' + tr.dataset.plan : ''), { method: tr.dataset.plan ? 'PUT' : 'POST', body }); toast('Plan saved.'); render();
    })));
    if (DG.adminBind) DG.adminBind(tab, d);
    const sf = $('#sf'); if (sf) sf.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', sf), async () => { await api('/admin/settings', { method: 'PUT', body: formData(sf) }); toast('Settings saved.'); await boot(true); }); });
    const bf = $('#bf'); if (bf) bf.addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button', bf), async () => { await api('/admin/broadcast', { method: 'POST', body: formData(bf) }); toast('Notification sent.'); bf.reset(); }); });
  }

  async function easyBuyPage() {
    const plans = await api('/plans');
    app.innerHTML = `<h1 style="margin-top:28px">Easy-buy plans</h1><p class="muted" style="max-width:60ch">Pay a deposit, then spread the balance over monthly instalments. Pick a property with the “Easy-buy” tag and choose the plan that suits you.</p>
      <div class="grid g3">${plans.map((p) => `<div class="card"><h2>${e(p.name)}</h2><p><b>${p.deposit_pct}%</b> deposit, then <b>${p.months}</b> monthly payments.</p><p class="muted small">${p.markup_pct ? `${p.markup_pct}% added to the outright price.` : 'Same price as paying outright.'}</p>
        <p class="small">Example on ₦10,000,000:<br><span class="notranslate">${money(1e7 * (1 + p.markup_pct / 100) * p.deposit_pct / 100)} deposit + ${money(Math.ceil(1e7 * (1 + p.markup_pct / 100) * (1 - p.deposit_pct / 100) / p.months))}/month</span></p></div>`).join('')}</div>
      <p style="margin-top:22px"><a class="btn gold" href="/listings?easy=1" data-link>See easy-buy properties</a></p>`;
  }

  function escrowPage() {
    app.innerHTML = `<h1 style="margin-top:28px">Buy safely with escrow</h1><p class="muted" style="max-width:60ch">Escrow protects both sides. <span class="notranslate">${e(S.cfg.company)}</span> holds the buyer's payment and releases it to the seller only when the buyer confirms handover.</p>
      <div class="grid g4 steps"><div class="card"><h3>Open escrow</h3><p class="muted">On any listing, tap “Start escrow” and agree the amount.</p></div><div class="card"><h3>Pay securely</h3><p class="muted">Your payment (plus a ${S.cfg.escrow_fee_pct}% fee) is held — not sent to the seller.</p></div><div class="card"><h3>Inspect &amp; verify</h3><p class="muted">Check the property and documents. Raise a dispute if anything is wrong.</p></div><div class="card"><h3>Release</h3><p class="muted">Confirm handover and the seller is paid. Disputes are reviewed by our team and can be refunded.</p></div></div>
      <p style="margin-top:22px"><a class="btn gold" href="/listings" data-link>Browse properties</a></p>`;
  }

  async function payDemo(q) {
    if (needLogin()) return (app.innerHTML = '<p class="pad center muted">Sign in to continue.</p>');
    const ref = q.get('reference');
    const p = await api('/payments/demo/' + encodeURIComponent(ref));
    app.innerHTML = `<div class="card" style="max-width:460px;margin:50px auto;text-align:center"><h2>Demo checkout</h2><div class="demo">No payment provider is connected yet, so this page stands in for Paystack. No real money moves.</div>
      <p>${e(cap(p.purpose))} payment</p><p class="price notranslate" style="font-size:2rem">${money(p.amount)}</p><p class="small muted notranslate">${e(p.reference)}</p>
      <button class="btn gold block" id="dp">Simulate successful payment</button></div>`;
    $('#dp').addEventListener('click', (ev) => busy(ev.target, async () => { const r = await api('/payments/demo/' + encodeURIComponent(ref), { method: 'POST' }); toast(r.message); go(r.redirect); }));
  }

  async function payReturn(q) {
    const ref = q.get('reference') || q.get('trxref');
    app.innerHTML = '<p class="pad center">Confirming your payment…</p>';
    const r = await api('/payments/verify/' + encodeURIComponent(ref));
    if (r.paid) { toast(r.message); go(r.redirect); }
    else app.innerHTML = `<div class="pad center"><h2>Payment not completed</h2><p class="muted">We could not confirm this payment. If you were charged, it will be applied automatically within a few minutes.</p><a class="btn" href="/dashboard" data-link>Go to dashboard</a></div>`;
  }

  // ---------- global actions ----------
  const pay = async (path) => { const r = await api(path, { method: 'POST' }); if (r.url) location.href = r.url; return r; };
  const ACTIONS = {
    login: () => openLogin(),
    logout: async () => { await api('/auth/logout', { method: 'POST' }); S.user = null; S.unread = 0; renderUser(); go('/'); },
    push: (b) => busy(b, enablePush),
    copy: async (b) => { try { await navigator.clipboard.writeText(b.dataset.url); toast('Link copied.'); } catch { prompt('Copy this link', b.dataset.url); } },
    nshare: (b) => navigator.share({ title: b.dataset.text, text: b.dataset.text, url: b.dataset.url }).catch(() => {}),
    unlock: (b) => { const run = () => busy(b, async () => { const r = await pay(`/properties/${b.dataset.id}/unlock`); if (r.unlocked) render(); }); if (!needLogin(run)) run(); },
    subscribe: (b) => { const run = () => busy(b, async () => { await api(`/properties/${b.dataset.id}/subscribe`, { method: 'POST', body: { plan_id: Number(b.dataset.plan) } }); toast('Plan created. Pay the deposit to start.'); go('/dashboard?tab=plans'); }); if (!needLogin(run)) run(); },
    escrow: (b) => {
      const run = () => {
        const m = modal(`<h2>Start escrow</h2><form id="ef" class="grid"><div><label>Agreed amount (₦)</label><input name="amount" inputmode="numeric" value="${e(b.dataset.price)}" required></div><div><label>Note <span class="muted small">(optional)</span></label><textarea name="note" maxlength="500" placeholder="Anything agreed with the seller"></textarea></div><p class="small muted">A ${S.cfg.escrow_fee_pct}% escrow fee is added at payment.</p><button class="btn block">Create escrow</button></form>`);
        $('#ef', m).addEventListener('submit', (ev) => { ev.preventDefault(); busy($('button.btn', ev.target), async () => { await api(`/properties/${b.dataset.id}/escrow`, { method: 'POST', body: formData(ev.target) }); closeModal(); toast('Escrow created. Pay to fund it.'); go('/dashboard?tab=escrow'); }); });
      };
      if (!needLogin(run)) run();
    },
    sold: (b) => { if (confirm('Mark as sold? All photos and videos except the cover will be permanently deleted.')) busy(b, async () => { const r = await api(`/properties/${b.dataset.id}/sold`, { method: 'POST' }); toast(`Marked sold. ${mb(r.freed_bytes || 0)} of media removed.`); render(); }); },
    epay: (b) => busy(b, () => pay(`/escrows/${b.dataset.id}/pay`)),
    ipay: (b) => busy(b, () => pay(`/installments/${b.dataset.id}/pay`)),
    ecancel: (b) => busy(b, async () => { await api(`/escrows/${b.dataset.id}/cancel`, { method: 'POST' }); render(); }),
    erelease: (b) => { if (confirm('Release the money to the seller? This cannot be undone and marks the property sold.')) busy(b, async () => { await api(`/escrows/${b.dataset.id}/release`, { method: 'POST' }); toast('Escrow released.'); render(); }); },
    edispute: (b) => { const note = prompt('Briefly describe the problem:'); if (note) busy(b, async () => { await api(`/escrows/${b.dataset.id}/dispute`, { method: 'POST', body: { note } }); toast('Dispute raised. Our team will contact you.'); render(); }); },
    erefund: (b) => { const note = prompt('Reason for refund:'); if (note !== null) busy(b, async () => { await api(`/escrows/${b.dataset.id}/refund`, { method: 'POST', body: { note } }); toast('Marked refunded.'); render(); }); },
    approve: (b) => busy(b, async () => { await api(`/admin/properties/${b.dataset.id}/approve`, { method: 'POST' }); toast('Approved and published.'); render(); }),
    reject: (b) => { const reason = prompt('Reason (sent to the agent):'); if (reason !== null) busy(b, async () => { await api(`/admin/properties/${b.dataset.id}/reject`, { method: 'POST', body: { reason } }); render(); }); },
    pflag: (b) => busy(b, async () => { await api(`/admin/properties/${b.dataset.id}/flags`, { method: 'POST', body: { [b.dataset.k]: b.dataset.v === '1' } }); render(); }),
    closereq: (b) => busy(b, async () => { await api(`/requests/${b.dataset.id}/close`, { method: 'POST' }); render(); }),
  };

  document.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]');
    if (act && ACTIONS[act.dataset.act]) { ev.preventDefault(); Promise.resolve(ACTIONS[act.dataset.act](act)).catch(fail); return; }
    const a = ev.target.closest('a[data-link]');
    if (a && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && a.target !== '_blank') { ev.preventDefault(); $('#nav').classList.remove('open'); go(a.getAttribute('href')); return; }
    const b = ev.target.closest('[data-act]');
    if (b && ACTIONS[b.dataset.act]) { ev.preventDefault(); Promise.resolve(ACTIONS[b.dataset.act](b)).catch(fail); }
  });
  $('#burger').addEventListener('click', () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); });
  window.addEventListener('popstate', () => render());

  // ---------- router ----------
  let seq = 0;
  async function render() {
    const my = ++seq;
    const path = location.pathname, q = new URLSearchParams(location.search);
    document.title = `${S.cfg.site_name} — property made easy`;
    const fc = $('#footc'); if (fc && !fc.dataset.done) { fc.dataset.done = 1; fc.innerHTML = `${S.cfg.rc_number ? `<span class="notranslate">RC ${e(S.cfg.rc_number)}</span><br>` : ''}${e(S.cfg.office_address || '')}<br><span class="notranslate">${e(S.cfg.phones || '')}</span>${S.cfg.contact_email ? `<br><a class="notranslate" href="mailto:${e(S.cfg.contact_email)}">${e(S.cfg.contact_email)}</a>` : ''}`; }
    try {
      const m = path.match(/^\/p\/(\d+)$/);
      const ext = DG.routes.map(([re, fn]) => [path.match(re), fn]).find(([hit]) => hit);
      if (ext) await ext[1](ext[0], q);
      else if (m) await propertyPage(m[1]);
      else if (path === '/') await home();
      else if (path === '/listings') await listingsPage(q);
      else if (path === '/post') await postPage(q);
      else if (path === '/request') requestPage();
      else if (path === '/requests') await requestsPage();
      else if (path === '/dashboard') await dashboard(q);
      else if (path === '/admin') await adminPage(q);
      else if (path === '/easy-buy') await easyBuyPage();
      else if (path === '/escrow') escrowPage();
      else if (path === '/pay/demo') await payDemo(q);
      else if (path === '/pay/return') await payReturn(q);
      else app.innerHTML = '<div class="pad center"><h2>Page not found</h2><a class="btn" href="/" data-link>Go home</a></div>';
    } catch (err) {
      if (my !== seq) return;
      app.innerHTML = `<div class="pad center"><h2>${err.status === 404 ? 'Not found' : err.status === 403 ? 'Not allowed' : 'Something went wrong'}</h2><p class="muted">${e(err.message)}</p><a class="btn" href="/" data-link>Go home</a></div>`;
    }
    if (my === seq) window.scrollTo(0, 0);
  }

  async function boot(soft) {
    const me = await api('/me');
    S.user = me.user; S.cfg = me.config;
    if (soft) return;
    await refreshNotifs(); renderUser(); setupTranslate(); DG.onBoot.forEach((fn) => fn());
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    render();
  }
  const DG = (window.DG = { $, app, S, e, money, price, currency, SYM, cap, date, mb, status, opts, api, toast, busy, formData, go, needLogin, modal, closeModal, cards, pcard, place, cleanQuery, STATES, render, vbadge, pay, ACTIONS, openLogin, easyBuyPage, shareBar, fail, routes: [], dashTabs: {}, adminTabs: {}, onBoot: [] });
  boot().catch(() => (app.innerHTML = '<p class="pad center">Could not load the site. Please refresh.</p>'));
})();
