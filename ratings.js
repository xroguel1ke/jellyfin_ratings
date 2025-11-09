// ==UserScript==
// @name         Jellyfin Ratings (v6.6.0 — Settings UI, No Repo Keys, RT Fallback)
// @namespace    https://mdblist.com
// @version      6.6.0
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). 0–100 normalized, colorized; inline “Ends at …” (12h/24h + bullet) with strict dedupe; parental rating cloned to start; single MutationObserver; caches; Settings UI; pulls API keys from JS injector/localStorage (no secrets in repo).
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

/* ======================================================
   DEFAULT CONFIG (editable via Settings)
====================================================== */

/* 🎬 SOURCES (defaults) */
const DEFAULT_ENABLE_SOURCES = {
  imdb:                   true,
  tmdb:                   true,
  trakt:                  true,
  letterboxd:             true,
  rotten_tomatoes:        true,  // controls both critic+audience
  roger_ebert:            true,
  anilist:                true,
  myanimelist:            true,
  metacritic_critic:      true,
  metacritic_user:        true
};

/* 🎨 DISPLAY (defaults) */
const DEFAULT_DISPLAY = {
  showPercentSymbol:      true,   // show “%”
  colorizeRatings:        true,   // colorize ratings
  colorizeNumbersOnly:    true,   // true: number only; false: number + icon glow
  align:                  'left', // 'left' | 'center' | 'right'
  endsAtFormat:           '24h',  // '24h' | '12h'
  endsAtBullet:           true    // show bullet • before “Ends at …”
};

/* 📏 SPACING (defaults) */
const DEFAULT_SPACING = {
  ratingsTopGapPx:        8       // gap between first row and ratings row
};

/* 🧮 SORT ORDER (defaults; lower appears earlier) */
const DEFAULT_PRIORITIES = {
  imdb:                     1,
  tmdb:                     2,
  trakt:                    3,
  letterboxd:               4,
  rotten_tomatoes_critic:   5,
  rotten_tomatoes_audience: 6,
  roger_ebert:              7,
  metacritic_critic:        8,
  metacritic_user:          9,
  anilist:                  10,
  myanimelist:              11
};

/* ⚙️ NORMALIZATION (→ 0–100) */
const SCALE_MULTIPLIER = {
  imdb:                     10,   // 0–10 → 0–100
  tmdb:                      1,   // already 0–100 in MDBList payload
  trakt:                     1,   // percent
  letterboxd:               20,   // 0–5 → 0–100
  roger_ebert:              25,   // 0–4 → 0–100
  metacritic_critic:         1,   // already 0–100
  metacritic_user:          10,   // 0–10 → 0–100
  myanimelist:              10,   // 0–10 → 0–100
  anilist:                   1,   // already 0–100
  rotten_tomatoes_critic:    1,
  rotten_tomatoes_audience:  1
};

/* 🎨 COLORS */
const COLOR_THRESHOLDS = { green: 75, orange: 50, red: 0 };
const COLOR_VALUES     = { green: 'limegreen', orange: 'orange', red: 'crimson' };

/* 🔑 API KEYS (no repo secrets; filled by JS injector or Settings) */
const DEFAULT_API_KEYS = {
  mdblist: '',  // required — provided by injector or saved via Settings
  tmdb:   ''    // optional — not required for links
};

/* 🗃️ CACHE + NAMESPACE */
const CACHE_DURATION  = 7 * 24 * 60 * 60 * 1000; // 7 days
const NS              = 'mdbl_';
const SETTINGS_KEY    = NS + 'settings_v1';

/* 🖼️ LOGOS (hosted in your repo) */
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
  imdb:            `${ICON_BASE}/IMDb.png`,
  tmdb:            `${ICON_BASE}/TMDB.png`,
  trakt:           `${ICON_BASE}/Trakt.png`,
  letterboxd:      `${ICON_BASE}/letterboxd.png`,
  anilist:         `${ICON_BASE}/anilist.png`,
  myanimelist:     `${ICON_BASE}/mal.png`,
  roger:           `${ICON_BASE}/Roger_Ebert.png`,
  tomatoes:        `${ICON_BASE}/Rotten_Tomatoes.png`,
  audience:        `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
  metacritic:      `${ICON_BASE}/Metacritic.png`,
  metacritic_user: `${ICON_BASE}/mus2.png`
};

/* ======================================================
   MERGE CONFIG FROM INJECTOR (window.MDBL_CFG) + persisted
====================================================== */
const __CFG__ = (typeof window !== 'undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES  = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources   || {});
const DISPLAY         = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display   || {});
const SPACING         = Object.assign({}, DEFAULT_SPACING,        __CFG__.spacing   || {});
const RATING_PRIORITY = Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities|| {});
const API_KEYS        = Object.assign({}, DEFAULT_API_KEYS,       __CFG__.apiKeys   || {});

// Load persisted settings (including apiKeys)
(function loadPersisted(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const u = JSON.parse(raw);
    if (u.sources)    Object.assign(ENABLE_SOURCES,  u.sources);
    if (u.display)    Object.assign(DISPLAY,         u.display);
    if (u.spacing)    Object.assign(SPACING,         u.spacing);
    if (u.priorities) Object.assign(RATING_PRIORITY, u.priorities);
    if (u.apiKeys)    Object.assign(API_KEYS,        u.apiKeys);
  }catch{}
})();

// If injector signals late arrival of keys, merge + persist + refresh
window.addEventListener('mdbl-config-ready', () => {
  try {
    const cfgKeys = (window.MDBL_CFG && window.MDBL_CFG.apiKeys) || {};
    Object.assign(API_KEYS, cfgKeys);
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    saved.apiKeys = Object.assign({}, saved.apiKeys || {}, API_KEYS);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    refreshAll && refreshAll();
  } catch {}
});

/* ======================================================
   POLYFILL (for browsers without GM_xmlhttpRequest)
====================================================== */
if (typeof GM_xmlhttpRequest === 'undefined') {
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
  ];
  const DIRECT = [
    'api.mdblist.com','graphql.anilist.co','query.wikidata.org','api.themoviedb.org'
  ];
  window.GM_xmlhttpRequest = ({ method='GET', url, headers={}, data, onload, onerror }) => {
    const isDirect = DIRECT.some(d => url.includes(d));
    const proxy = PROXIES[Math.floor(Math.random() * PROXIES.length)];
    const sep = url.includes('?') ? '&' : '?';
    const final = isDirect ? url : (proxy + encodeURIComponent(url + sep + `_=${Date.now()}`));
    fetch(final, { method, headers, body:data, cache:'no-store' })
      .then(r => r.text().then(t => onload && onload({ status:r.status, responseText:t })))
      .catch(e => onerror && onerror(e));
  };
}

/* ======================================================
   HELPERS & STYLES
====================================================== */
const Util = {
  pad(n){ return String(n).padStart(2,'0'); },
  validNumber(v){ const n = parseFloat(v); return !isNaN(n); },
  round(v){ return Math.round(parseFloat(v)); },
  normalize(v, src){
    const m = SCALE_MULTIPLIER[(src||'').toLowerCase()] || 1;
    const x = parseFloat(v);
    return isNaN(x) ? null : x * m;
  },
  slug(t){ return (t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
};

(function ensureStyleTag(){
  if (document.getElementById('mdblist-styles')) return;
  const style = document.createElement('style');
  style.id = 'mdblist-styles';
  style.textContent = `
    .mdblist-rating-container{}
    /* Settings UI */
    #mdbl-settings-fab{
      position:fixed; right:18px; bottom:18px; z-index:999999;
      width:44px; height:44px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      background: var(--theme-primary-color, #2a2a2a);
      color: var(--theme-text-color, #fff);
      box-shadow: 0 6px 18px rgba(0,0,0,.35);
      cursor:pointer; user-select:none;
      border:1px solid rgba(255,255,255,.15);
    }
    #mdbl-settings-fab:hover{ transform:translateY(-1px); }
    #mdbl-settings-overlay{
      position:fixed; inset:0; z-index:999998; background:rgba(0,0,0,.45); display:none;
    }
    #mdbl-settings-panel{
      position:fixed; right:18px; bottom:76px; z-index:999999;
      width:min(520px, 94vw); max-height:80vh; overflow:auto;
      background: var(--dialog-backdrop, #1e1e1e);
      color: var(--theme-text-color, #ddd);
      border:1px solid rgba(255,255,255,.12);
      border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,.45); display:none;
    }
    #mdbl-settings-panel header{
      position:sticky; top:0; background:inherit; z-index:1;
      padding:12px 16px; border-bottom:1px solid rgba(255,255,255,.12);
      display:flex; align-items:center; justify-content:space-between;
      font-weight:700;
    }
    #mdbl-settings-panel section{ padding:12px 16px; }
    #mdbl-settings-panel h3{
      margin:10px 0 8px; font-size:14px; opacity:.9;
      text-transform:uppercase; letter-spacing:.04em;
    }
    .mdbl-grid{
      display:grid; grid-template-columns:1fr 90px; gap:8px 12px; align-items:center;
    }
    .mdbl-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:6px 0; }
    .mdbl-note{ opacity:.7; font-size:12px; }
    .mdbl-num{ width:90px; }
    .mdbl-actions{ display:flex; gap:8px; margin:8px 16px 16px; }
    .mdbl-btn{
      padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.18);
      background:#2a2a2a; color:#fff; cursor:pointer;
    }
    .mdbl-btn.primary{ background:#4b66ff; border-color:#4b66ff; }
    .mdbl-btn.warn{ background:#8a2b2b; border-color:#c24; }
    .mdbl-input{ background:#111; color:#eee; border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:6px 8px; }
    .mdbl-checkbox{ transform:translateY(1px); }
    .mdbl-select{ min-width:120px; }
  `;
  document.head.appendChild(style);
})();

/* ======================================================
   CORE LOGIC (single observer → debounced updateAll)
====================================================== */
(function(){
'use strict';

let currentImdbId = null;

/* -------- Strictly remove any non-inline (ours) “Ends at …” -------- */
function removeBuiltInEndsAt(){
  document.querySelectorAll('.itemMiscInfo-secondary').forEach(row => {
    const txt = (row.textContent || '');
    if (/\bends\s+at\b/i.test(txt)) row.remove();
  });
  const ours = document.getElementById('customEndsAt');
  document.querySelectorAll('.itemMiscInfo span, .itemMiscInfo div').forEach(el => {
    if (el === ours || (ours && ours.contains(el))) return;
    const txt = (el.textContent || '');
    if (/\bends\s+at\b/i.test(txt)) el.remove();
  });
}

/* -------- Parental rating: clone to start, hide original -------- */
function ensureInlineBadge(){
  const primary = findPrimaryRow();
  if (!primary) return;
  const ratingValue = readAndHideOriginalBadge();
  if (!ratingValue) return;
  if (primary.querySelector('#mdblistInlineParental')) return;

  const before = findYearChip(primary) || primary.firstChild;
  const badge = document.createElement('span');
  badge.id = 'mdblistInlineParental';
  badge.textContent = ratingValue;
  Object.assign(badge.style,{
    display:'inline-flex', alignItems:'center', justifyContent:'center',
    padding:'2px 6px', borderRadius:'6px', fontWeight:'600',
    fontSize:'0.9em', lineHeight:'1',
    background:'var(--theme-primary-color, rgba(255,255,255,0.12))',
    color:'var(--theme-text-color, #ddd)',
    marginRight:'10px', whiteSpace:'nowrap', flex:'0 0 auto', verticalAlign:'middle'
  });
  if (before && before.parentNode) before.parentNode.insertBefore(badge,before);
  else primary.insertBefore(badge,primary.firstChild);
}

function findPrimaryRow(){
  return document.querySelector('.itemMiscInfo.itemMiscInfo-primary')
      || document.querySelector('.itemMiscInfo-primary')
      || document.querySelector('.itemMiscInfo');
}
function findYearChip(primary){
  const chips = primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div');
  for (const el of chips){
    const t = (el.textContent || '').trim();
    if (/^\d{4}$/.test(t)) return el;
  }
  return null;
}
function readAndHideOriginalBadge(){
  let original = document.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')
               || document.querySelector('.mediaInfoItem.mediaInfoText[data-type="officialRating"]');
  if (!original) {
    const candidates=[...document.querySelectorAll('.itemMiscInfo .mediaInfoItem, .itemMiscInfo .mediaInfoText, .itemMiscInfo span')];
    original = candidates.find(el=>{
      const t=(el.textContent||'').trim();
      return /^[A-Z0-9][A-Z0-9\-+]{0,5}$/.test(t) && !/^\d{4}$/.test(t);
    }) || null;
  }
  if (!original) return null;
  const value = (original.textContent || '').trim();
  original.style.display='none';
  return value || null;
}

/* -------- Custom EndsAt on first row (12h/24h + bullet toggle) -------- */
function ensureEndsAtInline(){
  const primary = findPrimaryRow(); if (!primary) return;
  const {node: anchorNode, minutes} = findRuntimeNode(primary);
  if (!anchorNode || !minutes) return;

  const end = new Date(Date.now() + minutes * 60000);
  const timeStr = formatEndTime(end);
  const prefix  = DISPLAY.endsAtBullet ? ' • ' : '';
  const content = `${prefix}Ends at ${timeStr}`;

  let span = primary.querySelector('#customEndsAt');
  if (!span){
    span = document.createElement('span');
    span.id = 'customEndsAt';
    span.style.marginLeft='6px';
    span.style.color='inherit';
    span.style.opacity='1';
    span.style.fontSize='inherit';
    span.style.fontWeight='inherit';
    span.style.whiteSpace='nowrap';
    span.style.display='inline';
    if (anchorNode.nextSibling) anchorNode.parentNode.insertBefore(span, anchorNode.nextSibling);
    else anchorNode.parentNode.appendChild(span);
  }
  span.textContent = content;
}
function formatEndTime(d){
  if (DISPLAY.endsAtFormat === '12h') {
    let h = d.getHours();
    const m = Util.pad(d.getMinutes());
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${suffix}`;
  }
  return `${Util.pad(d.getHours())}:${Util.pad(d.getMinutes())}`;
}
function findRuntimeNode(primary){
  const chips = primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div');
  for (const el of chips){
    const t=(el.textContent||'').trim();
    const mins=parseRuntimeToMinutes(t);
    if (mins>0) return {node:el, minutes:mins};
  }
  const t=(primary.textContent||'').trim();
  const mins=parseRuntimeToMinutes(t);
  return mins>0 ? {node:primary, minutes:mins} : {node:null, minutes:0};
}
function parseRuntimeToMinutes(text){
  if (!text) return 0;
  const re = /(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i;
  const m = text.match(re);
  if (!m) return 0;
  const h = parseInt(m[1]||'0',10);
  const min = parseInt(m[2]||'0',10);
  if (h===0 && min===0) {
    const onlyMin = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
    return onlyMin ? parseInt(onlyMin[1],10) : 0;
  }
  return h*60 + min;
}

/* -------- Ratings containers + fetch -------- */
function hideDefaultRatingsOnce(){
  document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box=>{
    box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el=>{ el.style.display='none'; });
  });
}

function scanLinks(){
  document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a=>{
    if (a.dataset.mdblSeen === '1') return;
    a.dataset.mdblSeen = '1';
    const m=a.href.match(/imdb\.com\/title\/(tt\d+)/);
    if (!m) return;
    const id = m[1];
    if (id !== currentImdbId){
      document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove());
      currentImdbId = id;
    }
  });

  [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].forEach(a=>{
    if (a.dataset.mdblProc === '1') return;
    const m=a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    if (!m) return;
    a.dataset.mdblProc = '1';
    const type = m[1] === 'tv' ? 'show' : 'movie';
    const tmdbId = m[2];

    document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b=>{
      const ref=b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating') || b.querySelector('.mediaInfoItem:last-of-type');
      if (!ref) return;
      if (ref.nextElementSibling && ref.nextElementSibling.classList?.contains('mdblist-rating-container')) return;

      const div = document.createElement('div');
      div.className = 'mdblist-rating-container';
      const justify     = DISPLAY.align==='center' ? 'center' : DISPLAY.align==='left' ? 'flex-start' : 'flex-end';
      const paddingRight= DISPLAY.align==='right' ? '6px' : '0';
      div.style = `
        display:flex; flex-wrap:wrap; align-items:center;
        justify-content:${justify};
        width:calc(100% + 6px);
        margin-left:-6px;
        margin-top:${SPACING.ratingsTopGapPx}px;
        padding-right:${paddingRight};
        box-sizing:border-box;
      `;
      div.dataset.type = type;
      div.dataset.tmdbId = tmdbId;
      div.dataset.mdblFetched = '0';
      ref.insertAdjacentElement('afterend', div);
    });
  });

  hideDefaultRatingsOnce();
}

function updateRatings(){
  document.querySelectorAll('.mdblist-rating-container').forEach(c=>{
    if (c.dataset.mdblFetched === '1') return;
    const type   = c.dataset.type || 'movie';
    const tmdbId = c.dataset.tmdbId;
    if (!tmdbId) return;
    c.dataset.mdblFetched = '1';
    fetchRatings(tmdbId, currentImdbId, c, type);
  });
}

function appendRating(container, logo, val, title, key, link){
  // Respect enable toggles
  if (!key.startsWith('rotten_tomatoes')) {
    if (!ENABLE_SOURCES[key]) return;
  } else if (!ENABLE_SOURCES.rotten_tomatoes) {
    return;
  }
  if (!Util.validNumber(val)) return;

  const n = Util.normalize(val, key);
  if (!Util.validNumber(n)) return;
  const r = Util.round(n);
  const disp = DISPLAY.showPercentSymbol ? `${r}%` : `${r}`;
  if (container.querySelector(`[data-source="${key}"]`)) return;

  const wrap = document.createElement('div');
  wrap.dataset.source = key;
  wrap.style = 'display:inline-flex;align-items:center;margin:0 6px;';
  const a = document.createElement('a');
  a.href = link; a.target = '_blank'; a.style.textDecoration='none;';

  const img = document.createElement('img');
  img.src = logo; img.alt = title; img.title = `${title}: ${disp}`;
  img.style = 'height:1.3em;margin-right:3px;vertical-align:middle;';

  const s = document.createElement('span');
  s.textContent = disp; s.style = 'font-size:1em;vertical-align:middle;';

  if (DISPLAY.colorizeRatings){
    let col;
    if (r >= COLOR_THRESHOLDS.green) col = COLOR_VALUES.green;
    else if (r >= COLOR_THRESHOLDS.orange) col = COLOR_VALUES.orange;
    else col = COLOR_VALUES.red;
    if (DISPLAY.colorizeNumbersOnly) s.style.color = col;
    else { s.style.color = col; img.style.filter = `drop-shadow(0 0 3px ${col})`; }
  }

  a.append(img,s);
  wrap.append(a);
  container.append(wrap);

  // Sort by configured priority
  [...container.children]
    .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
    .forEach(el=>container.appendChild(el));
}

/* -------- Fetch ratings (MDBList primary, extra sources + RT fallback) -------- */
function fetchRatings(tmdbId, imdbId, container, type='movie'){
  // Require MDBList key from injector/settings
  if (!API_KEYS.mdblist || !API_KEYS.mdblist.trim()) {
    console.warn('[MDBL] Missing MDBList API key (set via Settings or JS Injector).');
    return;
  }
  GM_xmlhttpRequest({
    method:'GET',
    url:`https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${encodeURIComponent(API_KEYS.mdblist.trim())}`,
    onload:r=>{
      if (r.status !== 200) return;
      let d; try { d = JSON.parse(r.responseText); } catch { return; }
      const title = d.title || ''; const slug = Util.slug(title);

      d.ratings?.forEach(rr=>{
        const s = (rr.source||'').toLowerCase();
        const v = rr.value;

        if (s.includes('imdb') && ENABLE_SOURCES.imdb)
          appendRating(container, LOGO.imdb, v, 'IMDb', 'imdb', `https://www.imdb.com/title/${imdbId || ''}/`);

        else if (s.includes('tmdb') && ENABLE_SOURCES.tmdb)
          appendRating(container, LOGO.tmdb, v, 'TMDb', 'tmdb', `https://www.themoviedb.org/${type}/${tmdbId}`);

        else if (s.includes('trakt') && ENABLE_SOURCES.trakt)
          appendRating(container, LOGO.trakt, v, 'Trakt', 'trakt', imdbId ? `https://trakt.tv/search/imdb/${imdbId}` : `https://trakt.tv/search?query=${encodeURIComponent(title)}`);

        else if (s.includes('letterboxd') && ENABLE_SOURCES.letterboxd)
          appendRating(container, LOGO.letterboxd, v, 'Letterboxd', 'letterboxd', imdbId ? `https://letterboxd.com/imdb/${imdbId}/` : `https://letterboxd.com/search/${encodeURIComponent(title)}/`);

        // RT from MDBList when present
        else if ((s === 'tomatoes' || s.includes('rotten_tomatoes')) && ENABLE_SOURCES.rotten_tomatoes) {
          const rtSearch = title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#';
          appendRating(container, LOGO.tomatoes, v, 'RT Critic', 'rotten_tomatoes_critic', rtSearch);
        }
        else if ((s.includes('popcorn') || s.includes('audience')) && ENABLE_SOURCES.rotten_tomatoes) {
          const rtSearch = title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#';
          appendRating(container, LOGO.audience, v, 'RT Audience', 'rotten_tomatoes_audience', rtSearch);
        }

        else if (s === 'metacritic' && ENABLE_SOURCES.metacritic_critic){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container, LOGO.metacritic, v, 'Metacritic (Critic)', 'metacritic_critic', link);
        }
        else if (s.includes('metacritic') && s.includes('user') && ENABLE_SOURCES.metacritic_user){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container, LOGO.metacritic_user, v, 'Metacritic (User)', 'metacritic_user', link);
        }
        else if (s.includes('roger') && ENABLE_SOURCES.roger_ebert)
          appendRating(container, LOGO.roger, v, 'Roger Ebert', 'roger_ebert', slug?`https://www.rogerebert.com/reviews/${slug}`:`https://www.rogerebert.com/reviews?filters%5Bq%5D=${encodeURIComponent(title)}`);
      });

      // Extra sources + RT fallback
      if (ENABLE_SOURCES.anilist)           fetchAniList(imdbId, container);
      if (ENABLE_SOURCES.myanimelist)       fetchMAL(imdbId, container);
      if (ENABLE_SOURCES.rotten_tomatoes)   fetchRT(imdbId, container);
    }
  });
}

/* -------- Extra sources: AniList / MAL / RT (cached) -------- */
function fetchAniList(imdbId, container){
  if (!imdbId) return;
  const q=`SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id = JSON.parse(r.responseText).results.bindings[0]?.anilist?.value;
        if (!id) return;
        const gql='query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
        GM_xmlhttpRequest({
          method:'POST',
          url:'https://graphql.anilist.co',
          headers:{'Content-Type':'application/json'},
          data:JSON.stringify({query:gql,variables:{id:parseInt(id,10)}}),
          onload:rr=>{
            try{
              const m = JSON.parse(rr.responseText).data?.Media;
              if (Util.validNumber(m?.meanScore))
                appendRating(container, LOGO.anilist, m.meanScore, 'AniList', 'anilist', `https://anilist.co/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

function fetchMAL(imdbId, container){
  if (!imdbId) return;
  const q=`SELECT ?mal WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P4086 ?mal . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id = JSON.parse(r.responseText).results.bindings[0]?.mal?.value;
        if (!id) return;
        GM_xmlhttpRequest({
          method:'GET',
          url:`https://api.jikan.moe/v4/anime/${id}`,
          onload:rr=>{
            try{
              const d = JSON.parse(rr.responseText).data;
              if (Util.validNumber(d.score))
                appendRating(container, LOGO.myanimelist, d.score, 'MyAnimeList', 'myanimelist', `https://myanimelist.net/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

function fetchRT(imdbId, container){
  if (!imdbId) return;
  const key = `${NS}rt_${imdbId}`;
  const cache = localStorage.getItem(key);
  if (cache){
    try{
      const j = JSON.parse(cache);
      if (Date.now() - j.time < CACHE_DURATION){
        addRT(container, j.scores);
        return;
      }
    }catch{}
  }

  const q=`SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id = JSON.parse(r.responseText).results.bindings[0]?.rtid?.value;
        if (!id) return;
        const path = id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'');
        const url  = `https://www.rottentomatoes.com/${path}`;
        GM_xmlhttpRequest({
          method:'GET', url,
          onload:rr=>{
            try{
              const m = rr.responseText.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
              if (!m) return;
              const d = JSON.parse(m[1]);
              const critic   = parseFloat(d.criticsScore?.score);
              const audience = parseFloat(d.audienceScore?.score);
              const scores = { critic, audience, link:url };
              addRT(container, scores);
              localStorage.setItem(key, JSON.stringify({ time:Date.now(), scores }));
            }catch(e){ console.error('RT parse error', e); }
          }
        });
      }catch(e){ console.error(e); }
    }
  });

  function addRT(c, s){
    if (Util.validNumber(s.critic))
      appendRating(c, LOGO.tomatoes, s.critic, 'RT Critic', 'rotten_tomatoes_critic', s.link || '#');
    if (Util.validNumber(s.audience))
      appendRating(c, LOGO.audience, s.audience, 'RT Audience', 'rotten_tomatoes_audience', s.link || '#');
  }
}

/* -------- Main update pipeline (order matters) -------- */
function updateAll(){
  try {
    removeBuiltInEndsAt();
    ensureInlineBadge();
    ensureEndsAtInline();
    removeBuiltInEndsAt();
    scanLinks();
    updateRatings();
    applyContainerAlignmentAndSpacing();
  } catch (e) {}
}

function applyContainerAlignmentAndSpacing(){
  document.querySelectorAll('.mdblist-rating-container').forEach(div=>{
    const justify = DISPLAY.align==='center' ? 'center' : DISPLAY.align==='left' ? 'flex-start' : 'flex-end';
    const paddingRight = DISPLAY.align==='right' ? '6px' : '0';
    div.style.justifyContent = justify;
    div.style.marginTop = `${SPACING.ratingsTopGapPx}px`;
    div.style.paddingRight = paddingRight;
  });
  // Re-sort by updated priorities
  document.querySelectorAll('.mdblist-rating-container').forEach(div=>{
    [...div.children]
      .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
      .forEach(el=>div.appendChild(el));
  });
}

/* -------- Observe DOM changes once; debounce updates -------- */
const MDbl = { debounceTimer: null };
MDbl.debounce = (fn, wait=150) => { clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer = setTimeout(fn, wait); };

(function observePage(){
  const obs = new MutationObserver(() => MDbl.debounce(updateAll, 150));
  obs.observe(document.body, { childList:true, subtree:true });
  updateAll(); // initial
})();

/* ======================================================
   SETTINGS UI (⚙️ bottom-right) — includes API Keys
====================================================== */
function saveSettingsToStorage(){
  const payload = {
    sources:    ENABLE_SOURCES,
    display:    DISPLAY,
    spacing:    SPACING,
    priorities: RATING_PRIORITY,
    apiKeys:    API_KEYS
  };
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload)); }catch{}
}

function resetSettings(){
  Object.assign(ENABLE_SOURCES,  DEFAULT_ENABLE_SOURCES);
  Object.assign(DISPLAY,         DEFAULT_DISPLAY);
  Object.assign(SPACING,         DEFAULT_SPACING);
  Object.assign(RATING_PRIORITY, DEFAULT_PRIORITIES);
  Object.assign(API_KEYS,        DEFAULT_API_KEYS);
  saveSettingsToStorage();
  rebuildSettingsForm(); // refresh UI
  refreshAll();
}

function refreshAll(){
  // Remove existing containers to fully re-render with new settings
  document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove());
  // Remove inline parental and ends-at to rebuild
  document.getElementById('mdblistInlineParental')?.remove();
  document.getElementById('customEndsAt')?.remove();
  updateAll();
}

function ensureSettingsUI(){
  if (document.getElementById('mdbl-settings-fab')) return;

  // FAB (gear)
  const fab = document.createElement('div');
  fab.id = 'mdbl-settings-fab';
  fab.title = 'Jellyfin Ratings — Settings';
  fab.innerHTML = '⚙️';
  document.body.appendChild(fab);

  // Overlay + Panel
  const overlay = document.createElement('div');
  overlay.id = 'mdbl-settings-overlay';
  const panel = document.createElement('div');
  panel.id = 'mdbl-settings-panel';
  panel.innerHTML = `
    <header>
      <span>Jellyfin Ratings — Settings</span>
      <button class="mdbl-btn" id="mdbl-close">Close</button>
    </header>

    <section id="mdbl-sect-sources">
      <h3>Sources</h3>
      <div class="mdbl-grid" id="mdbl-sources-grid"></div>
      <p class="mdbl-note">Enable/disable rating sources. “Rotten Tomatoes” controls both Critic & Audience.</p>
    </section>

    <section id="mdbl-sect-display">
      <h3>Display</h3>
      <div class="mdbl-row">
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-showPercent"> Show “%”</label><span></span>
      </div>
      <div class="mdbl-row">
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-colorize"> Colorize ratings</label><span></span>
      </div>
      <div class="mdbl-row">
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-colorNumsOnly"> Color numbers only (no icon glow)</label><span></span>
      </div>
      <div class="mdbl-row">
        <label>Alignment
          <select id="mdbl-align" class="mdbl-input mdbl-select">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <span></span>
      </div>
      <div class="mdbl-row">
        <label>“Ends at …” format
          <select id="mdbl-endsFmt" class="mdbl-input mdbl-select">
            <option value="24h">24h</option>
            <option value="12h">12h</option>
          </select>
        </label>
        <label><input type="checkbox" class="mdbl-checkbox" id="mdbl-endsBullet"> Bullet before “Ends at …”</label>
      </div>
    </section>

    <section id="mdbl-sect-spacing">
      <h3>Spacing</h3>
      <div class="mdbl-row">
        <label>Ratings top gap (px)</label>
        <input type="number" id="mdbl-gap" min="0" max="48" step="1" class="mdbl-input mdbl-num">
      </div>
    </section>

    <section id="mdbl-sect-prio">
      <h3>Sort Priority</h3>
      <div class="mdbl-grid" id="mdbl-prio-grid"></div>
      <p class="mdbl-note">Lower numbers appear earlier.</p>
    </section>

    <section id="mdbl-sect-apikeys">
      <h3>API Keys</h3>
      <div class="mdbl-row">
        <label style="flex:1">MDBList (required)
          <input type="password" id="mdbl-key-mdblist" class="mdbl-input" placeholder="MDBList API key">
        </label>
        <button class="mdbl-btn" id="mdbl-key-mdblist-toggle" title="Show/Hide">👁️</button>
      </div>
      <div class="mdbl-row">
        <label style="flex:1">TMDb (optional)
          <input type="password" id="mdbl-key-tmdb" class="mdbl-input" placeholder="TMDb API key (optional)">
        </label>
        <button class="mdbl-btn" id="mdbl-key-tmdb-toggle" title="Show/Hide">👁️</button>
      </div>
      <p class="mdbl-note">Keys can be provided by your Jellyfin JS Injector and are never stored in this GitHub file.</p>
    </section>

    <section id="mdbl-sect-io">
      <h3>Export / Import</h3>
      <div class="mdbl-row">
        <button class="mdbl-btn" id="mdbl-export">Export JSON</button>
        <input type="file" id="mdbl-import-file" accept="application/json" class="mdbl-input">
      </div>
      <textarea id="mdbl-import-text" class="mdbl-input" rows="4" placeholder="Paste settings JSON here..."></textarea>
    </section>

    <div class="mdbl-actions">
      <button class="mdbl-btn primary" id="mdbl-apply">Save & Apply</button>
      <button class="mdbl-btn warn"    id="mdbl-reset">Reset to Defaults</button>
    </div>
  `;
  document.body.append(overlay, panel);

  // Build dynamic content
  rebuildSettingsForm();

  // Wiring
  const open = ()=>{ overlay.style.display='block'; panel.style.display='block'; };
  const close= ()=>{ overlay.style.display='none';  panel.style.display='none';  };
  fab.addEventListener('click', open);
  overlay.addEventListener('click', close);
  panel.querySelector('#mdbl-close').addEventListener('click', close);

  // Apply
  panel.querySelector('#mdbl-apply').addEventListener('click', ()=>{
    collectSettingsFromForm(); saveSettingsToStorage(); refreshAll(); close();
  });

  // Reset
  panel.querySelector('#mdbl-reset').addEventListener('click', resetSettings);

  // Export
  panel.querySelector('#mdbl-export').addEventListener('click', ()=>{
    const payload = {
      sources:ENABLE_SOURCES, display:DISPLAY, spacing:SPACING, priorities:RATING_PRIORITY, apiKeys:API_KEYS
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='jellyfin_ratings_settings.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  });

  // Import file
  panel.querySelector('#mdbl-import-file').addEventListener('change', (ev)=>{
    const f = ev.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try{
        const j = JSON.parse(rd.result);
        applyImportedSettings(j); rebuildSettingsForm(); saveSettingsToStorage(); refreshAll();
      }catch(e){ alert('Invalid JSON'); }
    };
    rd.readAsText(f);
  });

  // Import textarea
  panel.querySelector('#mdbl-import-text').addEventListener('change', (ev)=>{
    const txt = ev.target.value;
    if (!txt.trim()) return;
    try{
      const j = JSON.parse(txt);
      applyImportedSettings(j); rebuildSettingsForm(); saveSettingsToStorage(); refreshAll();
    }catch(e){ alert('Invalid JSON'); }
  });
}

function applyImportedSettings(j){
  if (j.sources)    Object.assign(ENABLE_SOURCES, j.sources);
  if (j.display)    Object.assign(DISPLAY, j.display);
  if (j.spacing)    Object.assign(SPACING, j.spacing);
  if (j.priorities) Object.assign(RATING_PRIORITY, j.priorities);
  if (j.apiKeys)    Object.assign(API_KEYS, j.apiKeys);
}

function rebuildSettingsForm(){
  const panel = document.getElementById('mdbl-settings-panel');
  if (!panel) return;

  // Sources
  const sg = panel.querySelector('#mdbl-sources-grid');
  sg.innerHTML = '';
  const sourceLabels = {
    imdb:'IMDb', tmdb:'TMDb', trakt:'Trakt', letterboxd:'Letterboxd',
    rotten_tomatoes:'Rotten Tomatoes (Critic+Audience)', roger_ebert:'Roger Ebert',
    anilist:'AniList', myanimelist:'MyAnimeList',
    metacritic_critic:'Metacritic (Critic)', metacritic_user:'Metacritic (User)'
  };
  Object.keys(DEFAULT_ENABLE_SOURCES).forEach(k=>{
    const rowLabel = document.createElement('label');
    rowLabel.innerHTML = `<input type="checkbox" class="mdbl-checkbox" data-src="${k}"> ${sourceLabels[k]||k}`;
    const valWrap = document.createElement('div'); // empty second column
    sg.append(rowLabel, valWrap);
    rowLabel.querySelector('input').checked = !!ENABLE_SOURCES[k];
  });

  // Display
  panel.querySelector('#mdbl-showPercent').checked  = !!DISPLAY.showPercentSymbol;
  panel.querySelector('#mdbl-colorize').checked     = !!DISPLAY.colorizeRatings;
  panel.querySelector('#mdbl-colorNumsOnly').checked= !!DISPLAY.colorizeNumbersOnly;
  panel.querySelector('#mdbl-align').value          = DISPLAY.align || 'left';
  panel.querySelector('#mdbl-endsFmt').value        = DISPLAY.endsAtFormat || '24h';
  panel.querySelector('#mdbl-endsBullet').checked   = !!DISPLAY.endsAtBullet;

  // Spacing
  panel.querySelector('#mdbl-gap').value = Number(SPACING.ratingsTopGapPx||0);

  // Priorities
  const pg = panel.querySelector('#mdbl-prio-grid');
  pg.innerHTML = '';
  const prioKeys = Object.keys(DEFAULT_PRIORITIES);
  prioKeys.forEach(k=>{
    const lab = document.createElement('label'); lab.textContent = k.replace(/_/g,' ');
    const inp = document.createElement('input');
    inp.type='number'; inp.step='1'; inp.className='mdbl-input mdbl-num';
    inp.dataset.prio = k; inp.value = Number(RATING_PRIORITY[k] ?? 999);
    pg.append(lab, inp);
  });

  // API keys
  panel.querySelector('#mdbl-key-mdblist').value = API_KEYS.mdblist || '';
  panel.querySelector('#mdbl-key-tmdb').value    = API_KEYS.tmdb || '';
  const mk = panel.querySelector('#mdbl-key-mdblist');
  panel.querySelector('#mdbl-key-mdblist-toggle').onclick = ()=> {
    mk.type = mk.type === 'password' ? 'text' : 'password';
  };
  const tk = panel.querySelector('#mdbl-key-tmdb');
  panel.querySelector('#mdbl-key-tmdb-toggle').onclick = ()=> {
    tk.type = tk.type === 'password' ? 'text' : 'password';
  };
}

function collectSettingsFromForm(){
  const panel = document.getElementById('mdbl-settings-panel');
  if (!panel) return;

  // Sources
  panel.querySelectorAll('[data-src]').forEach(cb=>{
    const key = cb.getAttribute('data-src');
    ENABLE_SOURCES[key] = cb.checked;
  });

  // Display
  DISPLAY.showPercentSymbol   = panel.querySelector('#mdbl-showPercent').checked;
  DISPLAY.colorizeRatings     = panel.querySelector('#mdbl-colorize').checked;
  DISPLAY.colorizeNumbersOnly = panel.querySelector('#mdbl-colorNumsOnly').checked;
  DISPLAY.align               = panel.querySelector('#mdbl-align').value;
  DISPLAY.endsAtFormat        = panel.querySelector('#mdbl-endsFmt').value;
  DISPLAY.endsAtBullet        = panel.querySelector('#mdbl-endsBullet').checked;

  // Spacing
  const gap = parseInt(panel.querySelector('#mdbl-gap').value,10);
  SPACING.ratingsTopGapPx = Number.isFinite(gap) ? Math.max(0, Math.min(48, gap)) : DEFAULT_SPACING.ratingsTopGapPx;

  // Priorities
  panel.querySelectorAll('[data-prio]').forEach(inp=>{
    const k = inp.getAttribute('data-prio');
    let v = parseInt(inp.value,10);
    if (!Number.isFinite(v)) v = 999;
    RATING_PRIORITY[k] = v;
  });

  // API keys
  API_KEYS.mdblist = panel.querySelector('#mdbl-key-mdblist').value.trim();
  API_KEYS.tmdb    = panel.querySelector('#mdbl-key-tmdb').value.trim();
}

// Only show FAB on “items” pages (best-effort)
function shouldShowFab(){
  return !!document.querySelector('.itemMiscInfo');
}

(function initSettingsOnce(){
  const tick = () => {
    if (!document.body) return requestAnimationFrame(tick);
    if (shouldShowFab()) ensureSettingsUI();
    else setTimeout(initSettingsOnce, 800);
  };
  tick();
})();
})(); // end IIFE
