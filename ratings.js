// ==UserScript==
// @name         Jellyfin Ratings (v6.4.0 — keys via injector, MDBList cache, icons-only)
// @namespace    https://mdblist.com
// @version      6.4.0
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). Normalized 0–100, optional icons-only, colorized; custom inline “Ends at …” with bullet + 12/24h; parental rating cloned to start; single MutationObserver; namespaced caches; tidy helpers and styles. API keys come from injector/localStorage (not GitHub).
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

/* ======================================================
   DEFAULT CONFIG (override via window.MDBL_CFG in injector)
====================================================== */

/* SOURCES */
const DEFAULT_ENABLE_SOURCES = {
  imdb:                   true,
  tmdb:                   true,
  trakt:                  true,
  letterboxd:             true,
  rotten_tomatoes:        true,
  roger_ebert:            true,
  anilist:                true,
  myanimelist:            true,
  metacritic_critic:      true,
  metacritic_user:        true
};

/* DISPLAY */
const DEFAULT_DISPLAY = {
  showPercentSymbol:      true,   // “%”
  colorizeRatings:        true,   // traffic-light colors
  colorizeNumbersOnly:    true,   // false => add soft icon glow
  align:                  'left', // 'left'|'center'|'right'
  endsAtFormat:           '24h',  // '24h'|'12h'
  endsAtBullet:           true,   // • before “Ends at …”
  iconsOnly:              false,  // show icons only (hide numbers)
};

/* SPACING */
const DEFAULT_SPACING = {
  ratingsTopGapPx:        8
};

/* SORT ORDER (lower = earlier) */
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

/* NORMALIZATION (→ 0–100) */
const SCALE_MULTIPLIER = {
  imdb:                     10,
  tmdb:                      1,
  trakt:                     1,
  letterboxd:               20,
  roger_ebert:              25,
  metacritic_critic:         1,
  metacritic_user:          10,
  myanimelist:              10,
  anilist:                   1,
  rotten_tomatoes_critic:    1,
  rotten_tomatoes_audience:  1
};

/* COLORS */
const COLOR_THRESHOLDS = { green: 75, orange: 50, red: 0 };
const COLOR_VALUES     = { green: 'limegreen', orange: 'orange', red: 'crimson' };

/* CACHE + NAMESPACE */
const CACHE_DURATION_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const NS                 = 'mdbl_';                 // localStorage prefix

/* ICONS — keep in your repo */
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
  metacritic_user: `${ICON_BASE}/mus2.png`,
};

/* ======================================================
   MERGE CONFIG FROM INJECTOR (window.MDBL_CFG) IF PRESENT
====================================================== */
const __CFG__          = (typeof window !== 'undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES   = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources    || {});
const DISPLAY          = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display    || {});
const SPACING          = Object.assign({}, DEFAULT_SPACING,        __CFG__.spacing    || {});
const RATING_PRIORITY  = Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities || {});

/* ======================================================
   API KEYS (from injector or localStorage, never in GitHub)
   - Preferred: window.MDBL_KEYS = { MDBLIST: '...' }
   - Fallback:  localStorage['mdbl_keys'] = JSON.stringify({ MDBLIST:'...' })
====================================================== */
function readKeys() {
  const fromWindow = (typeof window !== 'undefined' && window.MDBL_KEYS) ? window.MDBL_KEYS : null;
  if (fromWindow && typeof fromWindow === 'object') return fromWindow;

  try {
    const j = JSON.parse(localStorage.getItem(`${NS}keys`) || '{}');
    if (j && typeof j === 'object') return j;
  } catch {}
  return {};
}
const KEYS = readKeys();
const MDBLIST_API_KEY = KEYS.MDBLIST || '';

/* expose minimal status for the injector UI/debug */
window.MDBL_STATUS = {
  version: '6.4.0',
  keys: { MDBLIST: !!MDBLIST_API_KEY },
};

/* ======================================================
   POLYFILL (for environments without GM_xmlhttpRequest)
====================================================== */
if (typeof GM_xmlhttpRequest === 'undefined') {
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
  ];
  const DIRECT = ['api.mdblist.com','graphql.anilist.co','query.wikidata.org','api.themoviedb.org'];
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
    .mdblist-rating-container a { text-decoration: none; }
    .mdblist-rating-container img { height: 1.3em; margin-right: 3px; vertical-align: middle; }
    .mdblist-rating-container span { font-size: 1em; vertical-align: middle; }
  `;
  document.head.appendChild(style);
})();

/* ======================================================
   CORE LOGIC (single observer → debounced updateAll)
====================================================== */
(function(){
'use strict';

let currentImdbId = null;

/* -------- Remove any non-inline (ours) “Ends at …” -------- */
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

/* -------- Parental rating to start -------- */
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
    display:'inline-flex',
    alignItems:'center',
    justifyContent:'center',
    padding:'2px 6px',
    borderRadius:'6px',
    fontWeight:'600',
    fontSize:'0.9em',
    lineHeight:'1',
    background:'var(--theme-primary-color, rgba(255,255,255,0.12))',
    color:'var(--theme-text-color, #ddd)',
    marginRight:'10px',
    whiteSpace:'nowrap',
    flex:'0 0 auto',
    verticalAlign:'middle'
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

/* -------- Custom EndsAt on first row -------- */
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
    span.style.marginLeft = '6px';
    span.style.whiteSpace = 'nowrap';
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

/* -------- Ratings: scan rows, insert containers, fetch once -------- */
function hideDefaultRatingsOnce(){
  document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box=>{
    box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el=>{ el.style.display='none'; });
  });
}

function scanLinks(){
  // Track current IMDb id; reset containers when tt changes
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

  // Insert ratings containers next to the first-row info
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
        display:flex;
        flex-wrap:wrap;
        align-items:center;
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

/* -------- Rendering helpers -------- */
function appendRating(container, logo, val, title, key, link){
  if (!Util.validNumber(val)) return;
  const n = Util.normalize(val, key);
  if (!Util.validNumber(n)) return;
  const r = Util.round(n);

  // icons-only mode -> hide text number
  const disp = DISPLAY.iconsOnly ? '' : (DISPLAY.showPercentSymbol ? `${r}%` : `${r}`);
  if (container.querySelector(`[data-source="${key}"]`)) return;

  const wrap = document.createElement('div');
  wrap.dataset.source = key;
  wrap.style = 'display:inline-flex;align-items:center;margin:0 6px;';
  const a = document.createElement('a');
  a.href = link || '#'; a.target = '_blank';

  const img = document.createElement('img');
  img.src = logo; img.alt = title; img.title = DISPLAY.iconsOnly ? title : `${title}: ${disp}`;

  const s = document.createElement('span');
  s.textContent = disp;

  if (DISPLAY.colorizeRatings){
    let col;
    if (r >= COLOR_THRESHOLDS.green) col = COLOR_VALUES.green;
    else if (r >= COLOR_THRESHOLDS.orange) col = COLOR_VALUES.orange;
    else col = COLOR_VALUES.red;
    if (!DISPLAY.iconsOnly) {
      if (DISPLAY.colorizeNumbersOnly) s.style.color = col;
      else { s.style.color = col; img.style.filter = `drop-shadow(0 0 3px ${col})`; }
    } else {
      // icons-only -> apply subtle glow
      img.style.filter = `drop-shadow(0 0 3px ${col})`;
    }
  }

  a.append(img);
  if (!DISPLAY.iconsOnly) a.append(s);
  wrap.append(a);
  container.append(wrap);

  // sort by configured priority
  [...container.children]
    .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
    .forEach(el=>container.appendChild(el));
}

/* ======================================================
   FETCH (MDBList + extras) — with caching
====================================================== */
function cacheGet(key){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (Date.now() - j.time > CACHE_DURATION_MS) return null;
    return j.data;
  }catch{ return null; }
}
function cacheSet(key, data){
  try{ localStorage.setItem(key, JSON.stringify({ time:Date.now(), data })); }catch{}
}

function fetchRatings(tmdbId, imdbId, container, type='movie'){
  if (!MDBLIST_API_KEY) {
    // Still allow extras that don’t require this key
    if (ENABLE_SOURCES.anilist)         fetchAniList(imdbId, container);
    if (ENABLE_SOURCES.myanimelist)     fetchMAL(imdbId, container);
    if (ENABLE_SOURCES.rotten_tomatoes) fetchRT(imdbId, container);
    return;
  }

  const cacheKey = `${NS}mdb_${type}_${tmdbId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    renderFromMDBListPayload(cached, imdbId, container, type);
    // extras
    if (ENABLE_SOURCES.anilist)         fetchAniList(imdbId, container);
    if (ENABLE_SOURCES.myanimelist)     fetchMAL(imdbId, container);
    if (ENABLE_SOURCES.rotten_tomatoes) fetchRT(imdbId, container);
    return;
  }

  GM_xmlhttpRequest({
    method:'GET',
    url:`https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${encodeURIComponent(MDBLIST_API_KEY)}`,
    onload:r=>{
      if (r.status !== 200) return;
      let d; try { d = JSON.parse(r.responseText); } catch { return; }
      cacheSet(cacheKey, d);
      renderFromMDBListPayload(d, imdbId, container, type);

      if (ENABLE_SOURCES.anilist)         fetchAniList(imdbId, container);
      if (ENABLE_SOURCES.myanimelist)     fetchMAL(imdbId, container);
      if (ENABLE_SOURCES.rotten_tomatoes) fetchRT(imdbId, container); // fallback RT
    }
  });
}

function renderFromMDBListPayload(d, imdbId, container, type){
  const title = d.title || ''; const slug = Util.slug(title);
  d.ratings?.forEach(rr=>{
    const s = (rr.source||'').toLowerCase();
    const v = rr.value;

    if (s.includes('imdb') && ENABLE_SOURCES.imdb)
      appendRating(container, LOGO.imdb, v, 'IMDb', 'imdb', `https://www.imdb.com/title/${imdbId}/`);

    else if (s.includes('tmdb') && ENABLE_SOURCES.tmdb)
      appendRating(container, LOGO.tmdb, v, 'TMDb', 'tmdb', `https://www.themoviedb.org/${type}/${container.dataset.tmdbId}`);

    else if (s.includes('trakt') && ENABLE_SOURCES.trakt)
      appendRating(container, LOGO.trakt, v, 'Trakt', 'trakt', `https://trakt.tv/search/imdb/${imdbId}`);

    else if (s.includes('letterboxd') && ENABLE_SOURCES.letterboxd)
      appendRating(container, LOGO.letterboxd, v, 'Letterboxd', 'letterboxd', `https://letterboxd.com/imdb/${imdbId}/`);

    // RT via MDBList when present
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
      appendRating(container, LOGO.roger, v, 'Roger Ebert', 'roger_ebert', `https://www.rogerebert.com/reviews/${slug}`);
  });
}

/* -------- Extra sources: AniList / MAL / RT (cached) -------- */
function fetchAniList(imdbId, container){
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
  const key = `${NS}rt_${imdbId}`;
  const cache = cacheGet(key);
  if (cache) return addRT(container, cache);

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
              cacheSet(key, scores);
            }catch(e){ /* console.error('RT parse error', e); */ }
          }
        });
      }catch(e){ /* console.error(e); */ }
    }
  });

  function addRT(c, s){
    if (Util.validNumber(s.critic))
      appendRating(c, LOGO.tomatoes, s.critic, 'RT Critic', 'rotten_tomatoes_critic', s.link || '#');
    if (Util.validNumber(s.audience))
      appendRating(c, LOGO.audience, s.audience, 'RT Audience', 'rotten_tomatoes_audience', s.link || '#');
  }
}

/* -------- Main update pipeline -------- */
function updateAll(){
  try {
    removeBuiltInEndsAt();
    ensureInlineBadge();
    ensureEndsAtInline();
    removeBuiltInEndsAt();
    scanLinks();
    updateRatings();
  } catch (e) { /* swallow */ }
}

/* -------- Observe DOM changes once; debounce updates -------- */
const MDbl = { debounceTimer: null };
MDbl.debounce = (fn, wait=150) => { clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer = setTimeout(fn, wait); };

(function observePage(){
  const obs = new MutationObserver(() => MDbl.debounce(updateAll, 150));
  obs.observe(document.body, { childList:true, subtree:true });
  updateAll(); // initial
})();

/* -------- Minimal API for injector (optional) -------- */
window.MDBL_API = {
  refresh(){ document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove()); updateAll(); },
  setConfig(cfg){ Object.assign(__CFG__, cfg||{}); },
};

})();
