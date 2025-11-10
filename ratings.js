// ==UserScript==
// @name         Jellyfin Ratings (v7.0 — modular, cached, mobile, lazy icons)
// @namespace    https://mdblist.com
// @version      7.0.0
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). Normalized 0–100, colorized; inline “Ends at …”; parental badge to start; single observer; cached lookups (IndexedDB w/ localStorage fallback); settings panel; mobile horizontal scroll; lazy-loaded icons.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(() => {
  'use strict';

  /* =====================================================
     1) CONFIG (merged, fewer globals)
  ===================================================== */
  const MDBL_CFG = {
    ns: 'mdbl_',
    iconsBase: 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons',
    defaults: {
      sources: {
        imdb: true, tmdb: true, trakt: true, letterboxd: true,
        rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
        metacritic_critic: true, metacritic_user: true,
        roger_ebert: true, anilist: true, myanimelist: true
      },
      display: {
        showPercentSymbol: true,
        colorizeRatings: true,
        colorNumbers: true,
        colorIcons: false,
        align: 'left',       // left|center|right
        endsAtFormat: '24h', // '24h' | '12h'
        endsAtBullet: true,
      },
      spacing: { ratingsTopGapPx: 8 },
      priorities: {
        imdb:1, tmdb:2, trakt:3, letterboxd:4,
        rotten_tomatoes_critic:5, rotten_tomatoes_audience:6,
        roger_ebert:7, metacritic_critic:8, metacritic_user:9,
        anilist:10, myanimelist:11
      }
    },
    scale: { // value -> % multiplier
      imdb:10, tmdb:1, trakt:1, letterboxd:20, roger_ebert:25,
      metacritic_critic:1, metacritic_user:10, myanimelist:10, anilist:1,
      rotten_tomatoes_critic:1, rotten_tomatoes_audience:1
    },
    colors: {
      thresholds: { green: 75, orange: 50, red: 0 },
      values: { green: 'limegreen', orange: 'orange', red: 'crimson' }
    },
    cacheTtlMs: {
      mdblist: 7*24*60*60*1000, // 7 days
      wikidata: 30*24*60*60*1000, // 30 days (IDs rarely change)
      rtHtml: 7*24*60*60*1000,    // 7 days
      icons: 30*24*60*60*1000     // hint caching for icon URL resolutions
    }
  };

  const LOGO = {
    imdb: `${MDBL_CFG.iconsBase}/IMDb.png`,
    tmdb: `${MDBL_CFG.iconsBase}/TMDB.png`,
    trakt: `${MDBL_CFG.iconsBase}/Trakt.png`,
    letterboxd: `${MDBL_CFG.iconsBase}/letterboxd.png`,
    anilist: `${MDBL_CFG.iconsBase}/anilist.png`,
    myanimelist: `${MDBL_CFG.iconsBase}/mal.png`,
    roger_ebert: `${MDBL_CFG.iconsBase}/Roger_Ebert.png`,
    rotten_tomatoes_critic: `${MDBL_CFG.iconsBase}/Rotten_Tomatoes.png`,
    rotten_tomatoes_audience: `${MDBL_CFG.iconsBase}/Rotten_Tomatoes_positive_audience.png`,
    metacritic_critic: `${MDBL_CFG.iconsBase}/Metacritic.png`,
    metacritic_user: `${MDBL_CFG.iconsBase}/mus2.png`,
  };

  /* =====================================================
     2) UTILITIES
  ===================================================== */
  const U = {
    pad: n => String(n).padStart(2, '0'),
    num: v => parseFloat(v),
    ok: v => !isNaN(parseFloat(v)),
    round: v => Math.round(parseFloat(v)),
    slug: t => (t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''),
    normalize(v, src) {
      const m = MDBL_CFG.scale[(src||'').toLowerCase()] || 1;
      const x = parseFloat(v);
      return isNaN(x) ? null : x * m;
    },
    safeJSON(str, fb = null) { try { return JSON.parse(str); } catch { return fb; } },
    debounce(fn, wait = 150) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; },
    timeString(date, fmt='24h') {
      if (fmt==='12h') { let h=date.getHours(); const m=U.pad(date.getMinutes()); const suf=h>=12?'PM':'AM'; h=h%12||12; return `${h}:${m} ${suf}`; }
      return `${U.pad(date.getHours())}:${U.pad(date.getMinutes())}`;
    },
  };

  /* =====================================================
     3) CACHE (IndexedDB with localStorage fallback)
  ===================================================== */
  const Cache = (() => {
    const DB_NAME = `${MDBL_CFG.ns}cache_db`;
    const STORE = 'kv';
    let supported = 'indexedDB' in window;
    let dbp = null;

    function openDB() {
      if (!supported) return Promise.resolve(null);
      if (dbp) return dbp;
      dbp = new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      return dbp;
    }

    async function get(key) {
      const now = Date.now();
      const db = await openDB();
      if (db) {
        return new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readonly');
          const st = tx.objectStore(STORE);
          const r = st.get(key);
          r.onsuccess = () => {
            const v = r.result;
            if (!v) return resolve(null);
            if (v.exp && v.exp < now) { resolve(null); del(key); }
            else resolve(v.val);
          };
          r.onerror = () => resolve(null);
        });
      }
      // fallback localStorage
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const j = U.safeJSON(raw);
      if (!j) return null;
      if (j.exp && j.exp < now) { localStorage.removeItem(key); return null; }
      return j.val;
    }

    async function set(key, val, ttlMs) {
      const exp = ttlMs ? Date.now() + ttlMs : 0;
      const db = await openDB();
      if (db) {
        return new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ key, val, exp });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      }
      // fallback localStorage
      try { localStorage.setItem(key, JSON.stringify({ val, exp })); } catch {}
      return true;
    }

    async function del(key) {
      const db = await openDB();
      if (db) {
        return new Promise((resolve) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      }
      try { localStorage.removeItem(key); } catch {}
      return true;
    }

    return { get, set, del };
  })();

  /* =====================================================
     4) NETWORK (unified GM_xmlhttpRequest + fetch proxy)
  ===================================================== */
  if (typeof GM_xmlhttpRequest === 'undefined') {
    const PROXIES = [
      'https://api.allorigins.win/raw?url=',
      'https://api.codetabs.com/v1/proxy?quest='
    ];
    const DIRECT = [ 'api.mdblist.com', 'graphql.anilist.co', 'query.wikidata.org', 'api.themoviedb.org' ];
    window.GM_xmlhttpRequest = ({ method='GET', url, headers={}, data, onload, onerror }) => {
      const isDirect = DIRECT.some(d => url.includes(d));
      const proxy = PROXIES[Math.floor(Math.random()*PROXIES.length)];
      const sep = url.includes('?') ? '&' : '?';
      const final = isDirect ? url : (proxy + encodeURIComponent(url + sep + `_=${Date.now()}`));
      fetch(final, { method, headers, body: data, cache: 'no-store' })
        .then(r => r.text().then(t => onload && onload({ status: r.status, responseText: t })))
        .catch(e => onerror && onerror(e));
    };
  }

  const Net = {
    text(url, opt={}) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: opt.method || 'GET', url,
          headers: opt.headers || {}, data: opt.data,
          onload: r => resolve(r.responseText),
          onerror: e => reject(e)
        });
      });
    },
    async json(url, opt={}) { const t = await Net.text(url, opt); return U.safeJSON(t, null); }
  };

  /* =====================================================
     5) ICONS (lazy-load)
  ===================================================== */
  const Icon = (() => {
    const cache = new Map(); // url -> Promise<string>

    function load(url) {
      if (!url) return Promise.resolve('');
      if (cache.has(url)) return cache.get(url);
      // We simply resolve URL; browser will lazy-load when <img loading="lazy"> is appended.
      const p = Promise.resolve(url);
      cache.set(url, p);
      return p;
    }

    return { load };
  })();

  /* =====================================================
     6) STATE (merged defaults + injector + saved prefs)
  ===================================================== */
  const __INJECT__ = (typeof window !== 'undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
  const ENABLE_SOURCES = Object.assign({}, MDBL_CFG.defaults.sources, __INJECT__.sources || {});
  const DISPLAY        = Object.assign({}, MDBL_CFG.defaults.display, __INJECT__.display || {});
  const SPACING        = Object.assign({}, MDBL_CFG.defaults.spacing, __INJECT__.spacing || {});
  const PRIORITY       = Object.assign({}, MDBL_CFG.defaults.priorities, __INJECT__.priorities || {});

  const INJ_KEYS = (window.MDBL_KEYS || {});
  const LS_KEYS_JSON = localStorage.getItem(`${MDBL_CFG.ns}keys`);
  const LS_KEYS = LS_KEYS_JSON ? (U.safeJSON(LS_KEYS_JSON) || {}) : {};
  const MDBLIST_API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || 'hehfnbo9y8blfyqm1d37ikubl');

  /* =====================================================
     7) STYLE (CSS classes, mobile horizontal scroll)
  ===================================================== */
  (function ensureStyle(){
    if (document.getElementById('mdblist-styles')) return;
    const css = `
    .mdblist-rating-row{ display:flex; flex-wrap:nowrap; align-items:center; gap:10px; padding-right:6px; width:100%; }
    .mdblist-rating-row.left{ justify-content:flex-start; }
    .mdblist-rating-row.center{ justify-content:center; }
    .mdblist-rating-row.right{ justify-content:flex-end; }
    .mdblist-rating-row.scrollable{ overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
    .mdblist-chip{ display:inline-flex; align-items:center; gap:6px; margin:0 6px; white-space:nowrap; }
    .mdblist-chip .mdblist-num{ font-size:1em; cursor:pointer; }
    .mdblist-chip img{ height:1.3em; width:auto; vertical-align:middle; }

    /* Parental badge cloned to front */
    #mdblistInlineParental{ display:inline-flex; align-items:center; justify-content:center; padding:2px 6px; border-radius:6px; font-weight:600; font-size:0.9em; line-height:1; background:var(--theme-primary-color, rgba(255,255,255,0.12)); color:var(--theme-text-color,#ddd); margin-right:10px; white-space:nowrap; vertical-align:middle; }

    /* Ends at */
    #mdblist-endsAt{ margin-left:6px; opacity:1; white-space:nowrap; }

    /* Settings panel */
    :root { --mdbl-right-col: 48px; --mdbl-right-col-wide: 200px; }
    #mdbl-panel{ position:fixed; right:16px; bottom:70px; width:520px; max-width:calc(100vw - 32px); max-height:88vh; overflow:auto; border-radius:14px; border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); backdrop-filter:blur(8px); color:#eaeaea; z-index:99999; box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; }
    #mdbl-panel header{ position:sticky; top:0; background:rgba(22,22,26,0.96); padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; gap:8px; cursor:move }
    #mdbl-panel header h3{ margin:0; font-size:15px; font-weight:700; flex:1 }
    #mdbl-close{ border:none; background:transparent; color:#aaa; font-size:18px; cursor:pointer; padding:4px; border-radius:8px }
    #mdbl-close:hover{ background:rgba(255,255,255,0.06); color:#fff }
    #mdbl-panel .mdbl-section{ padding:12px 16px; display:flex; flex-direction:column; gap:10px }
    #mdbl-panel .mdbl-subtle{ color:#9aa0a6; font-size:12px }
    #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source{ display:grid; grid-template-columns: 1fr var(--mdbl-right-col); align-items:center; gap:10px; padding:8px 10px; border-radius:12px }
    #mdbl-panel .mdbl-row{ background:transparent; border:1px solid rgba(255,255,255,0.06) }
    #mdbl-panel .mdbl-row.wide{ grid-template-columns: 1fr var(--mdbl-right-col-wide) }
    #mdbl-panel input[type="checkbox"]{ transform:scale(1.1); justify-self:end }
    #mdbl-panel input[type="text"]{ width:100%; padding:10px 0; border:0; background:transparent; color:#eaeaea; font-size:14px; outline:none }
    #mdbl-panel select{ padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#121317; color:#eaeaea; justify-self:end }
    #mdbl-panel .mdbl-select{ width:200px }
    #mdbl-panel .mdbl-actions{ position:sticky; bottom:0; background:rgba(22,22,26,0.96); display:flex; gap:10px; padding:12px 16px; border-top:1px solid rgba(255,255,255,0.08) }
    #mdbl-panel button{ padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#1b1c20; color:#eaeaea; cursor:pointer }
    #mdbl-panel button.primary{ background:#2a6df4; border-color:#2a6df4; color:#fff }
    #mdbl-sources{ display:flex; flex-direction:column; gap:8px }
    .mdbl-source{ background:#0f1115; border:1px solid rgba(255,255,255,0.1) }
    .mdbl-src-left{ display:flex; align-items:center; gap:10px }
    .mdbl-src-left img{ height:18px; width:auto }
    .mdbl-src-left .name{ font-size:13px }
    .mdbl-drag-handle{ justify-self:start; opacity:0.6; cursor:grab }
    #mdbl-key-box{ background:#0f1115; border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:12px }

    /* Mobile: make ratings row scrollable and compact */
    @media (max-width: 800px) {
      .mdblist-rating-row{ gap:8px; }
      .mdblist-rating-row.scrollable{ overflow-x:auto; padding-bottom:4px; }
    }
    `;
    const style = document.createElement('style');
    style.id = 'mdblist-styles';
    style.textContent = css;
    document.head.appendChild(style);
  })();

  /* =====================================================
     8) CORE DOM HELPERS (parental badge, endsAt, container)
  ===================================================== */
  function removeBuiltInEndsAt(){
    document.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo span, .itemMiscInfo div').forEach(el => {
      if (/\bends\s+at\b/i.test(el.textContent||'') && el.id !== 'mdblist-endsAt') el.remove();
    });
  }

  const findPrimaryRow = () => document.querySelector('.itemMiscInfo.itemMiscInfo-primary') || document.querySelector('.itemMiscInfo-primary') || document.querySelector('.itemMiscInfo');

  function findYearChip(primary){
    for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')){
      const t=(el.textContent||'').trim(); if (/^\d{4}$/.test(t)) return el;
    } return null;
  }

  function readAndHideOriginalBadge(){
    let original = document.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')
      || document.querySelector('.mediaInfoItem.mediaInfoText[data-type="officialRating"]');
    if (!original) {
      original = [...document.querySelectorAll('.itemMiscInfo .mediaInfoItem, .itemMiscInfo .mediaInfoText, .itemMiscInfo span')]
        .find(el => { const t=(el.textContent||'').trim(); return /^[A-Z0-9][A-Z0-9\-+]{0,5}$/.test(t) && !/^\d{4}$/.test(t); }) || null;
    }
    if (!original) return null;
    const v = (original.textContent||'').trim(); original.style.display='none'; return v || null;
  }

  function ensureInlineBadge(){
    const primary = findPrimaryRow(); if(!primary) return;
    const ratingValue = readAndHideOriginalBadge(); if(!ratingValue) return;
    if (primary.querySelector('#mdblistInlineParental')) return;
    const before = findYearChip(primary) || primary.firstChild;
    const badge = document.createElement('span'); badge.id='mdblistInlineParental'; badge.textContent=ratingValue;
    (before && before.parentNode) ? before.parentNode.insertBefore(badge, before) : primary.insertBefore(badge, primary.firstChild);
  }

  function parseRuntimeToMinutes(text){
    if(!text) return 0;
    const m=text.match(/(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
    if(!m) return 0; const h=parseInt(m[1]||'0',10), min=parseInt(m[2]||'0',10);
    if(h===0&&min===0){ const only=text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i); return only?parseInt(only[1],10):0; }
    return h*60+min;
  }

  function findRuntimeNode(primary){
    for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')){
      const mins=parseRuntimeToMinutes((el.textContent||'').trim()); if (mins>0) return {node:el, minutes:mins};
    }
    const mins=parseRuntimeToMinutes((primary.textContent||'').trim());
    return mins>0?{node:primary, minutes:mins}:{node:null, minutes:0};
  }

  function ensureEndsAtInline(){
    const primary=findPrimaryRow(); if(!primary) return;
    const {node, minutes} = findRuntimeNode(primary); if(!node || !minutes) return;
    const end = new Date(Date.now()+minutes*60000);
    const timeStr = U.timeString(end, DISPLAY.endsAtFormat);
    const content = `${DISPLAY.endsAtBullet ? ' • ' : ''}Ends at ${timeStr}`;
    let span = primary.querySelector('#mdblist-endsAt');
    if(!span){
      span=document.createElement('span'); span.id='mdblist-endsAt';
      (node.nextSibling)?node.parentNode.insertBefore(span,node.nextSibling):node.parentNode.appendChild(span);
    }
    span.textContent = content;
  }

  function hideDefaultRatingsOnce(){
    document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box => {
      box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el => el.style.display='none');
    });
  }

  /* =====================================================
     9) RATINGS CONTAINER SCAN/UPDATE
  ===================================================== */
  let currentImdbId = null;

  function scanLinks(){
    document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a => {
      if (a.dataset.mdblSeen==='1') return; a.dataset.mdblSeen='1';
      const m = a.href.match(/imdb\.com\/title\/(tt\d+)/); if (!m) return;
      const id=m[1]; if (id!==currentImdbId){ document.querySelectorAll('.mdblist-rating-row').forEach(el=>el.remove()); currentImdbId=id; }
    });

    [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].forEach(a => {
      if (a.dataset.mdblProc==='1') return; const m = a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/); if(!m) return;
      a.dataset.mdblProc='1'; const type = (m[1]==='tv')?'show':'movie', tmdbId=m[2];
      document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b => {
        const ref=b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')||b.querySelector('.mediaInfoItem:last-of-type'); if(!ref) return;
        if (ref.nextElementSibling && ref.nextElementSibling.classList?.contains('mdblist-rating-row')) return;
        const div=document.createElement('div');
        div.className = `mdblist-rating-row ${DISPLAY.align}`;
        if (window.innerWidth < 800) div.classList.add('scrollable');
        div.style.marginTop = `${SPACING.ratingsTopGapPx}px`;
        Object.assign(div.dataset, { type, tmdbId, mdblFetched:'0' });
        ref.insertAdjacentElement('afterend', div);
      });
    });

    hideDefaultRatingsOnce();
  }

  function updateRatings(){
    document.querySelectorAll('.mdblist-rating-row').forEach(c => {
      if (c.dataset.mdblFetched==='1') return; const type=c.dataset.type||'movie', tmdbId=c.dataset.tmdbId; if(!tmdbId) return;
      c.dataset.mdblFetched='1'; API.fetchRatings(tmdbId, currentImdbId, c, type);
    });
  }

  /* =====================================================
     10) RENDER (buffer + single sort/flush, lazy icons)
  ===================================================== */
  function colorFor(r){
    const t = MDBL_CFG.colors.thresholds, v = MDBL_CFG.colors.values;
    return r>=t.green ? v.green : r>=t.orange ? v.orange : v.red;
  }

  function getBuffer(container){
    if (!container.__buf) container.__buf = { list: [], scheduled: false };
    return container.__buf;
  }

  function appendRatingBuffered(container, {key, logoUrl, value, title, link, count, kind}){
    if (!U.ok(value)) return;
    const n = U.normalize(value, key); if (!U.ok(n)) return;
    const r = U.round(n);

    // Build node lazily (icons loaded on demand)
    const wrap = document.createElement('div');
    wrap.className = 'mdblist-chip';
    wrap.dataset.source = key;

    const a = document.createElement('a'); a.href = link || '#'; if (link && link!=='#') a.target='_blank'; a.style.textDecoration = 'none';

    const img = document.createElement('img'); img.alt = title; img.loading = 'lazy';
    const labelCount = (typeof count==='number' && isFinite(count)) ? `${count.toLocaleString()} ${kind || (key==='rotten_tomatoes_critic'?'Reviews':'Votes')}` : '';
    img.title = labelCount ? `${title} — ${labelCount}` : title;
    // Lazy assign src only when element is connected
    Icon.load(logoUrl).then(url => { if (img.isConnected) img.src = url; else img.addEventListener('connected', () => img.src=url, { once:true }); });

    const s = document.createElement('span'); s.className='mdblist-num'; s.textContent = DISPLAY.showPercentSymbol?`${r}%`:`${r}`;
    s.title='Open settings'; s.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS(); });

    if (DISPLAY.colorizeRatings){
      const col = colorFor(r);
      if (DISPLAY.colorNumbers) s.style.color = col;
      if (DISPLAY.colorIcons) img.style.filter = `drop-shadow(0 0 3px ${col})`;
    }

    a.appendChild(img); wrap.append(a, s);

    const buf = getBuffer(container);
    // de-dup by key
    if (buf.list.some(x => x.key === key)) return;
    buf.list.push({ key, node: wrap });

    if (!buf.scheduled) {
      buf.scheduled = true;
      queueMicrotask(() => flushBuffer(container));
    }
  }

  function flushBuffer(container){
    const buf = getBuffer(container);
    const list = buf.list;
    list.sort((a,b) => (PRIORITY[a.key]??999) - (PRIORITY[b.key]??999));
    list.forEach(({node}) => container.appendChild(node));
    buf.list.length = 0; buf.scheduled = false;
  }

  /* =====================================================
     11) WIKIDATA SHARED RESOLVER
  ===================================================== */
  async function getExternalId(imdbId, property){
    const key = `${MDBL_CFG.ns}wd_${property}_${imdbId}`;
    const cached = await Cache.get(key); if (cached) return cached;
    const q = `SELECT ?id WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:${property} ?id . } LIMIT 1`;
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
    const j = await Net.json(url);
    const val = j?.results?.bindings?.[0]?.id?.value || '';
    if (val) await Cache.set(key, val, MDBL_CFG.cacheTtlMs.wikidata);
    return val || '';
  }

  /* =====================================================
     12) API LAYER (MDBList + extras; RT deep-link + fallback)
  ===================================================== */
  const API = {
    async fetchRatings(tmdbId, imdbId, container, type='movie'){
      const key = `${MDBL_CFG.ns}mdbl_${type}_${tmdbId}`;
      let d = await Cache.get(key);
      if (!d) {
        const url = `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`;
        d = await Net.json(url);
        if (d) await Cache.set(key, d, MDBL_CFG.cacheTtlMs.mdblist);
      }
      if (!d) return;

      const title = d.title || ''; const slug = U.slug(title);
      let rtCriticVal=null, rtCriticCnt=null, rtAudienceVal=null, rtAudienceCnt=null;

      (d.ratings||[]).forEach(rr => {
        const s=(rr.source||'').toLowerCase(), v=rr.value;
        const cnt=rr.votes||rr.count||rr.reviewCount||rr.ratingCount;
        if (s.includes('imdb') && ENABLE_SOURCES.imdb)
          appendRatingBuffered(container, { key:'imdb', logoUrl:LOGO.imdb, value:v, title:'IMDb', link:`https://www.imdb.com/title/${imdbId}/`, count:cnt, kind:'Votes' });
        else if (s.includes('tmdb') && ENABLE_SOURCES.tmdb)
          appendRatingBuffered(container, { key:'tmdb', logoUrl:LOGO.tmdb, value:v, title:'TMDb', link:`https://www.themoviedb.org/${type}/${tmdbId}`, count:cnt, kind:'Votes' });
        else if (s.includes('trakt') && ENABLE_SOURCES.trakt)
          appendRatingBuffered(container, { key:'trakt', logoUrl:LOGO.trakt, value:v, title:'Trakt', link:`https://trakt.tv/search/imdb/${imdbId}`, count:cnt, kind:'Votes' });
        else if (s.includes('letterboxd') && ENABLE_SOURCES.letterboxd)
          appendRatingBuffered(container, { key:'letterboxd', logoUrl:LOGO.letterboxd, value:v, title:'Letterboxd', link:`https://letterboxd.com/imdb/${imdbId}/`, count:cnt, kind:'Votes' });
        else if ((s==='tomatoes' || s.includes('rotten_tomatoes'))) { rtCriticVal=v; rtCriticCnt=cnt; }
        else if ((s.includes('popcorn') || s.includes('audience'))) { rtAudienceVal=v; rtAudienceCnt=cnt; }
        else if (s==='metacritic' && ENABLE_SOURCES.metacritic_critic) {
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link= slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRatingBuffered(container, { key:'metacritic_critic', logoUrl:LOGO.metacritic_critic, value:v, title:'Metacritic (Critic)', link, count:cnt, kind:'Reviews' });
        }
        else if (s.includes('metacritic') && s.includes('user') && ENABLE_SOURCES.metacritic_user) {
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link= slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRatingBuffered(container, { key:'metacritic_user', logoUrl:LOGO.metacritic_user, value:v, title:'Metacritic (User)', link, count:cnt, kind:'Votes' });
        }
        else if (s.includes('roger') && ENABLE_SOURCES.roger_ebert)
          appendRatingBuffered(container, { key:'roger_ebert', logoUrl:LOGO.roger_ebert, value:v, title:'Roger Ebert', link:`https://www.rogerebert.com/reviews/${slug}` });
      });

      // Resolve RT link via Wikidata, then add MDBList-provided values if present
      const hasMDBL_RT = (rtCriticVal!=null) || (rtAudienceVal!=null);
      if (hasMDBL_RT) {
        const rtUrl = await API.getRTLink(imdbId) || (title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#');
        if (ENABLE_SOURCES.rotten_tomatoes_critic && rtCriticVal!=null)
          appendRatingBuffered(container, { key:'rotten_tomatoes_critic', logoUrl:LOGO.rotten_tomatoes_critic, value:rtCriticVal, title:'RT Critic', link:rtUrl, count:rtCriticCnt, kind:'Reviews' });
        if (ENABLE_SOURCES.rotten_tomatoes_audience && rtAudienceVal!=null)
          appendRatingBuffered(container, { key:'rotten_tomatoes_audience', logoUrl:LOGO.rotten_tomatoes_audience, value:rtAudienceVal, title:'RT Audience', link:rtUrl, count:rtAudienceCnt, kind:'Votes' });
      }

      // Extras + RT fallback
      if (ENABLE_SOURCES.anilist) API.fetchAniList(imdbId, container);
      if (ENABLE_SOURCES.myanimelist) API.fetchMAL(imdbId, container);
      if (!hasMDBL_RT && (ENABLE_SOURCES.rotten_tomatoes_critic || ENABLE_SOURCES.rotten_tomatoes_audience))
        API.fetchRT_HTMLFallback(imdbId, container);
    },

    async getRTLink(imdbId){
      const key = `${MDBL_CFG.ns}rturl_${imdbId}`;
      let url = await Cache.get(key);
      if (url) return url;
      const q=`SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
      const j = await Net.json('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q));
      const val = j?.results?.bindings?.[0]?.rtid?.value || '';
      url = val ? ('https://www.rottentomatoes.com/' + val.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'')) : '';
      if (url) await Cache.set(key, url, MDBL_CFG.cacheTtlMs.wikidata);
      return url;
    },

    async fetchAniList(imdbId, container){
      const id = await getExternalId(imdbId, 'P8729'); // AniList anime ID
      if (!id) return;
      const gql = 'query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
      const res = await Net.json('https://graphql.anilist.co', { method:'POST', headers:{'Content-Type':'application/json'}, data:JSON.stringify({ query:gql, variables:{ id: parseInt(id,10) } }) });
      const m = res?.data?.Media; if (U.ok(m?.meanScore))
        appendRatingBuffered(container, { key:'anilist', logoUrl:LOGO.anilist, value:m.meanScore, title:'AniList', link:`https://anilist.co/anime/${id}` });
    },

    async fetchMAL(imdbId, container){
      const id = await getExternalId(imdbId, 'P4086'); // MyAnimeList ID
      if (!id) return;
      const j = await Net.json(`https://api.jikan.moe/v4/anime/${id}`);
      const d = j?.data; if (U.ok(d?.score)) {
        const count = (typeof d.scored_by==='number')?d.scored_by:undefined;
        appendRatingBuffered(container, { key:'myanimelist', logoUrl:LOGO.myanimelist, value:d.score, title:'MyAnimeList', link:`https://myanimelist.net/anime/${id}`, count, kind:'Votes' });
      }
    },

    async fetchRT_HTMLFallback(imdbId, container){
      const key = `${MDBL_CFG.ns}rt_${imdbId}`;
      let cached = await Cache.get(key);
      if (cached) return addRT(container, cached);
      const id = await getExternalId(imdbId, 'P1258'); if (!id) return;
      const url = `https://www.rottentomatoes.com/${id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'')}`;
      const html = await Net.text(url);
      const m = html.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) return;
      const d = U.safeJSON(m[1], {});
      const critic = U.num(d?.criticsScore?.score);
      const cCount = typeof d?.criticsScore?.reviewCount === 'number' ? d.criticsScore.reviewCount : undefined;
      const audience = U.num(d?.audienceScore?.score);
      const aCount = typeof d?.audienceScore?.ratingCount === 'number' ? d.audienceScore.ratingCount : undefined;
      const scores = { critic, audience, link:url, cCount, aCount };
      await Cache.set(key, scores, MDBL_CFG.cacheTtlMs.rtHtml);
      addRT(container, scores);

      function addRT(c, s){
        if (U.ok(s.critic) && ENABLE_SOURCES.rotten_tomatoes_critic)
          appendRatingBuffered(c, { key:'rotten_tomatoes_critic', logoUrl:LOGO.rotten_tomatoes_critic, value:s.critic, title:'RT Critic', link:s.link||'#', count:s.cCount, kind:'Reviews' });
        if (U.ok(s.audience) && ENABLE_SOURCES.rotten_tomatoes_audience)
          appendRatingBuffered(c, { key:'rotten_tomatoes_audience', logoUrl:LOGO.rotten_tomatoes_audience, value:s.audience, title:'RT Audience', link:s.link||'#', count:s.aCount, kind:'Votes' });
      }
    }
  };

  /* =====================================================
     13) PIPELINE (updateAll + observer)
  ===================================================== */
  function updateAll(){
    try {
      removeBuiltInEndsAt();
      ensureInlineBadge();
      ensureEndsAtInline();
      removeBuiltInEndsAt();
      scanLinks();
      updateRatings();
    } catch {}
  }

  const observe = (node, cb, opts) => { const mo = new MutationObserver(U.debounce(cb,150)); mo.observe(node, opts); return mo; };
  observe(document.body, updateAll, { childList:true, subtree:true });
  updateAll();

  /* =====================================================
     14) SETTINGS PANEL (simplified, same features)
  ===================================================== */
  (function settingsMenu(){
    const PREFS_KEY = `${MDBL_CFG.ns}prefs`;
    const KEYS_LS   = `${MDBL_CFG.ns}keys`;

    const deep = o => JSON.parse(JSON.stringify(o));
    const loadPrefs = () => U.safeJSON(localStorage.getItem(PREFS_KEY)||'{}', {});
    const savePrefs = p => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p||{})); } catch {} };

    const ICON = {
      imdb:LOGO.imdb, tmdb:LOGO.tmdb, trakt:LOGO.trakt, letterboxd:LOGO.letterboxd,
      rotten_tomatoes_critic:LOGO.rotten_tomatoes_critic, rotten_tomatoes_audience:LOGO.rotten_tomatoes_audience,
      metacritic_critic:LOGO.metacritic_critic, metacritic_user:LOGO.metacritic_user,
      roger_ebert:LOGO.roger_ebert, anilist:LOGO.anilist, myanimelist:LOGO.myanimelist
    };
    const LABEL = {
      imdb:'IMDb', tmdb:'TMDb', trakt:'Trakt', letterboxd:'Letterboxd',
      rotten_tomatoes_critic:'Rotten Tomatoes (Critic)', rotten_tomatoes_audience:'Rotten Tomatoes (Audience)',
      metacritic_critic:'Metacritic (Critic)', metacritic_user:'Metacritic (User)',
      roger_ebert:'Roger Ebert', anilist:'AniList', myanimelist:'MyAnimeList'
    };

    const DEFAULTS = { sources:deep(ENABLE_SOURCES), display:deep(DISPLAY), priorities:deep(PRIORITY) };

    const getInjectorKey = () => { try { return (window.MDBL_KEYS && window.MDBL_KEYS.MDBLIST) ? String(window.MDBL_KEYS.MDBLIST) : ''; } catch { return ''; } };
    const getStoredKeys  = () => U.safeJSON(localStorage.getItem(KEYS_LS)||'{}', {});
    const setStoredKey   = (newKey) => {
      const obj = Object.assign({}, getStoredKeys(), { MDBLIST: newKey||'' });
      try { localStorage.setItem(KEYS_LS, JSON.stringify(obj)); } catch {}
      if (!getInjectorKey()) { if (!window.MDBL_KEYS || typeof window.MDBL_KEYS !== 'object') window.MDBL_KEYS = {}; window.MDBL_KEYS.MDBLIST = newKey || ''; }
      if (window.MDBL_STATUS && window.MDBL_STATUS.keys) { window.MDBL_STATUS.keys.MDBLIST = !!(getInjectorKey() || newKey); }
    };

    function applyPrefs(p){
      if (p.sources)    Object.keys(ENABLE_SOURCES).forEach(k => { if (k in p.sources) ENABLE_SOURCES[k] = !!p.sources[k]; });
      if (p.display)    Object.keys(DISPLAY).forEach(k => { if (k in p.display) DISPLAY[k] = p.display[k]; });
      if (p.priorities) Object.keys(p.priorities).forEach(k => { const v=+p.priorities[k]; if (isFinite(v)) PRIORITY[k] = v; });
    }

    const saved = loadPrefs(); if (saved && Object.keys(saved).length) applyPrefs(saved);

    // build panel once
    const panel = document.createElement('div'); panel.id='mdbl-panel';
    panel.innerHTML = `
      <header id="mdbl-drag-handle"><h3>Jellyfin Ratings — Settings</h3><button id="mdbl-close" aria-label="Close">✕</button></header>
      <div class="mdbl-section" id="mdbl-sec-keys"></div>
      <div class="mdbl-section" id="mdbl-sec-sources"></div>
      <div class="mdbl-section" id="mdbl-sec-display"></div>
      <div class="mdbl-actions"><button id="mdbl-btn-reset">Reset</button><button id="mdbl-btn-save" class="primary">Save & Apply</button></div>
    `;
    document.body.appendChild(panel);

    // outside click to close
    document.addEventListener('mousedown', e => { if (panel.style.display!=='block') return; if (!panel.contains(e.target)) hide(); });

    // draggable header
    (function makeDraggable(){
      const header=panel.querySelector('#mdbl-drag-handle'); let drag=false,sx=0,sy=0,sl=0,st=0;
      header.addEventListener('mousedown', e => {
        if (e.target.id==='mdbl-close') return;
        drag=true; const rect=panel.getBoundingClientRect();
        Object.assign(panel.style, { left:rect.left+'px', top:rect.top+'px', right:'auto', bottom:'auto' });
        sx=e.clientX; sy=e.clientY; sl=rect.left; st=rect.top;
        const move=e2=>{ if(!drag) return; panel.style.left=Math.max(0, sl+(e2.clientX-sx))+'px'; panel.style.top=Math.max(0, st+(e2.clientY-sy))+'px'; };
        const up=()=>{ drag=false; document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
        document.addEventListener('mousemove',move); document.addEventListener('mouseup',up); e.preventDefault();
      });
    })();

    function orderFromPriorities(){
      return Object.keys(PRIORITY).filter(k=>k in ENABLE_SOURCES)
        .sort((a,b)=>(PRIORITY[a]??999)-(PRIORITY[b]??999))
        .map(k=>({k, icon:ICON[k], label:LABEL[k]||k.replace(/_/g,' ')}));
    }

    function makeSourceRow(item){
      const key=item.k, checked=!!ENABLE_SOURCES[key];
      const row=document.createElement('div'); row.className='mdbl-source'; row.dataset.k=key; row.draggable=true;
      row.innerHTML=`<div class="mdbl-src-left"><span class="mdbl-drag-handle" title="Drag to reorder">⋮⋮</span><img src="${item.icon}" alt="${item.label}"><span class="name">${item.label}</span></div><input type="checkbox" ${checked?'checked':''} data-toggle="${key}">`;
      return row;
    }

    function enableDnD(container){
      let dragging=null;
      container.addEventListener('dragstart',e=>{ const t=e.target.closest('.mdbl-source'); if(!t) return; dragging=t; t.style.opacity='0.6'; e.dataTransfer.effectAllowed='move'; });
      container.addEventListener('dragover',e=>{ if(!dragging) return; e.preventDefault(); const after=getAfter(container,e.clientY); (after==null)?container.appendChild(dragging):container.insertBefore(dragging,after); });
      ['drop','dragend'].forEach(evt=>container.addEventListener(evt,()=>{ if(dragging) dragging.style.opacity=''; dragging=null; }));
      function getAfter(container,y){
        const els=[...container.querySelectorAll('.mdbl-source:not([style*="opacity: 0.6"])')];
        return els.reduce((c,ch)=>{ const box=ch.getBoundingClientRect(), off=y-box.top-box.height/2; return (off<0&&off>c.offset)?{offset:off,element:ch}:c; }, {offset:-1e9}).element;
      }
    }

    function render(){
      // Keys
      const kWrap=panel.querySelector('#mdbl-sec-keys');
      const injKey=getInjectorKey(); const stored=getStoredKeys().MDBLIST||''; const value=injKey?injKey:(stored||''); const readonly=injKey?'readonly':'';
      kWrap.innerHTML = `<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" ${readonly} placeholder="MDBList API key" value="${value}"></div>`;

      // Sources
      const sWrap=panel.querySelector('#mdbl-sec-sources');
      sWrap.innerHTML=`<div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div>`;
      const sList=sWrap.querySelector('#mdbl-sources');
      orderFromPriorities().forEach(item=>sList.appendChild(makeSourceRow(item)));
      enableDnD(sList);

      // Display
      const dWrap=panel.querySelector('#mdbl-sec-display');
      dWrap.innerHTML = `
        <div class="mdbl-subtle">Display</div>
        <div class="mdbl-row"><span>Colorize ratings</span><input type="checkbox" id="d_colorize" ${DISPLAY.colorizeRatings?'checked':''}></div>
        <div class="mdbl-row"><span>Color numbers</span><input type="checkbox" id="d_colorNumbers" ${DISPLAY.colorNumbers?'checked':''}></div>
        <div class="mdbl-row"><span>Color icons</span><input type="checkbox" id="d_colorIcons" ${DISPLAY.colorIcons?'checked':''}></div>
        <div class="mdbl-row"><span>Show %</span><input type="checkbox" id="d_showPercent" ${DISPLAY.showPercentSymbol?'checked':''}></div>
        <div class="mdbl-row"><span>Show bullet before “Ends at”</span><input type="checkbox" id="d_endsBullet" ${DISPLAY.endsAtBullet?'checked':''}></div>
        <div class="mdbl-row wide"><span>Align</span><select id="d_align" class="mdbl-select"><option value="left" ${DISPLAY.align==='left'?'selected':''}>left</option><option value="center" ${DISPLAY.align==='center'?'selected':''}>center</option><option value="right" ${DISPLAY.align==='right'?'selected':''}>right</option></select></div>
        <div class="mdbl-row wide"><span>Ends at format</span><select id="d_endsFmt" class="mdbl-select"><option value="24h" ${DISPLAY.endsAtFormat==='24h'?'selected':''}>24h</option><option value="12h" ${DISPLAY.endsAtFormat==='12h'?'selected':''}>12h</option></select></div>
      `;
    }

    function show(){ panel.style.display='block'; }
    function hide(){ panel.style.display='none'; }
    window.MDBL_OPEN_SETTINGS = () => { render(); show(); };
    panel.addEventListener('click', e => { if (e.target.id==='mdbl-close') hide(); });

    // Reset / Save
    panel.querySelector('#mdbl-btn-reset').addEventListener('click', () => {
      Object.assign(ENABLE_SOURCES, deep(DEFAULTS.sources));
      Object.assign(DISPLAY,        deep(DEFAULTS.display));
      Object.assign(PRIORITY,       deep(DEFAULTS.priorities));
      savePrefs({});
      render();
      if (window.MDBL_API?.refresh) window.MDBL_API.refresh();
    });

    panel.querySelector('#mdbl-btn-save').addEventListener('click', () => {
      const prefs = { sources:{}, display:{}, priorities:{} };
      // priorities from drag order
      [...panel.querySelectorAll('#mdbl-sources .mdbl-source')].forEach((el,i)=>{ prefs.priorities[el.dataset.k]=i+1; });
      // source toggles
      panel.querySelectorAll('#mdbl-sources input[type="checkbox"][data-toggle]').forEach(cb => { prefs.sources[cb.dataset.toggle] = cb.checked; });
      // display toggles
      prefs.display.colorizeRatings   = panel.querySelector('#d_colorize').checked;
      prefs.display.colorNumbers      = panel.querySelector('#d_colorNumbers').checked;
      prefs.display.colorIcons        = panel.querySelector('#d_colorIcons').checked;
      prefs.display.showPercentSymbol = panel.querySelector('#d_showPercent').checked;
      prefs.display.endsAtBullet      = panel.querySelector('#d_endsBullet').checked;
      prefs.display.align             = panel.querySelector('#d_align').value;
      prefs.display.endsAtFormat      = panel.querySelector('#d_endsFmt').value;

      savePrefs(prefs); applyPrefs(prefs);

      // keys (only if no injector key)
      const injKey=getInjectorKey(); const keyInput=panel.querySelector('#mdbl-key-mdb');
      if (keyInput && !injKey) setStoredKey((keyInput.value||'').trim());

      if (window.MDBL_API?.refresh) window.MDBL_API.refresh();
      location.reload();
    });
  })();

})();
