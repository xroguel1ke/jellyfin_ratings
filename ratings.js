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
/* ======================================================
   Floating Settings Menu (bottom-right) + Keys editor
   v2 — single column, icons, drag&drop sort, page reload on save
====================================================== */
(function settingsMenu(){
  const PREFS_KEY = `${NS}prefs`;
  const LS_KEYS   = 'mdbl_keys'; // where we mirror keys locally

  // ---- Utilities -----------------------------------------------------------
  const deepClone = (o)=>JSON.parse(JSON.stringify(o));
  const loadPrefs = ()=>{ try { return JSON.parse(localStorage.getItem(PREFS_KEY)||'{}'); } catch { return {}; } };
  const savePrefs = (p)=>{ try { localStorage.setItem(PREFS_KEY, JSON.stringify(p||{})); } catch {} };

  // Human labels + icons for sources (keys from your script)
  const SOURCE_LABEL = {
    imdb: 'IMDb',
    tmdb: 'TMDb',
    trakt: 'Trakt',
    letterboxd: 'Letterboxd',
    rotten_tomatoes_critic: 'Rotten Tomatoes (Critic)',
    rotten_tomatoes_audience: 'Rotten Tomatoes (Audience)',
    roger_ebert: 'Roger Ebert',
    metacritic_critic: 'Metacritic (Critic)',
    metacritic_user: 'Metacritic (User)',
    anilist: 'AniList',
    myanimelist: 'MyAnimeList',
  };
  const SOURCE_ICON = {
    imdb: LOGO.imdb,
    tmdb: LOGO.tmdb,
    trakt: LOGO.trakt,
    letterboxd: LOGO.letterboxd,
    rotten_tomatoes_critic: LOGO.tomatoes,
    rotten_tomatoes_audience: LOGO.audience,
    roger_ebert: LOGO.roger,
    metacritic_critic: LOGO.metacritic,
    metacritic_user: LOGO.metcacritic_user || LOGO.metacritic_user, // fallback if name differs
    anilist: LOGO.anilist,
    myanimelist: LOGO.myanimelist,
  };

  // Build defaults snapshot from current live objects
  const DEFAULTS = {
    sources:    deepClone(ENABLE_SOURCES),
    display:    deepClone(DISPLAY),
    priorities: deepClone(RATING_PRIORITY),
  };

  // --- Keys helpers (prefer injector over local) ---------------------------
  function getInjectorKey(){
    try { return (window.MDBL_KEYS && typeof window.MDBL_KEYS==='object' && window.MDBL_KEYS.MDBLIST) ? String(window.MDBL_KEYS.MDBLIST) : ''; }
    catch { return ''; }
  }
  function getStoredKeys(){
    try { return JSON.parse(localStorage.getItem(LS_KEYS) || '{}'); } catch { return {}; }
  }
  function getEffectiveKey(){
    const inj = getInjectorKey();
    if (inj) return inj;
    return getStoredKeys().MDBLIST || '';
  }
  function setStoredKey(newKey){
    const obj = Object.assign({}, getStoredKeys(), { MDBLIST: newKey || '' });
    try { localStorage.setItem(LS_KEYS, JSON.stringify(obj)); } catch {}
    if (!getInjectorKey()) { // only mirror if no injector override
      if (!window.MDBL_KEYS || typeof window.MDBL_KEYS!=='object') window.MDBL_KEYS = {};
      window.MDBL_KEYS.MDBLIST = newKey || '';
    }
    if (window.MDBL_STATUS && window.MDBL_STATUS.keys) {
      window.MDBL_STATUS.keys.MDBLIST = !!getEffectiveKey();
    }
  }

  // Apply prefs into live objects (mutates in place)
  function applyPrefs(prefs){
    const p = prefs || {};
    if (p.sources) Object.keys(ENABLE_SOURCES).forEach(k=>{
      if (k in p.sources) ENABLE_SOURCES[k] = !!p.sources[k];
    });
    if (p.display){
      Object.keys(DISPLAY).forEach(k=>{
        if (k in p.display) DISPLAY[k] = p.display[k];
      });
    }
    if (p.priorities){
      Object.keys(RATING_PRIORITY).forEach(k=>{
        if (k in p.priorities){
          const v = Number(p.priorities[k]);
          RATING_PRIORITY[k] = Number.isFinite(v) ? v : RATING_PRIORITY[k];
        }
      });
    }
  }

  // Load saved prefs (if any) and apply once
  const saved = loadPrefs();
  if (saved && Object.keys(saved).length) applyPrefs(saved);

  // ---- UI -----------------------------------------------------------------
  const css = `
  #mdbl-gear{position:fixed;right:16px;bottom:16px;width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);
    background:rgba(20,20,20,0.78);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:99999;
    box-shadow:0 4px 14px rgba(0,0,0,0.35)}
  #mdbl-gear svg{width:22px;height:22px;fill:currentColor;color:#ddd}
  #mdbl-panel{position:fixed;right:16px;bottom:70px;width:420px;max-height:72vh;overflow:auto;border-radius:14px;border:1px solid rgba(255,255,255,0.15);
    background:rgba(22,22,26,0.94);backdrop-filter:blur(8px);color:#eaeaea;z-index:99999;box-shadow:0 20px 40px rgba(0,0,0,0.45);display:none}
  #mdbl-panel header{position:sticky;top:0;background:rgba(22,22,26,0.96);padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:8px}
  #mdbl-panel header h3{margin:0;font-size:15px;font-weight:700;flex:1}
  #mdbl-panel .mdbl-section{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  #mdbl-panel .mdbl-subtle{color:#9aa0a6;font-size:12px}
  #mdbl-panel .mdbl-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  #mdbl-panel .mdbl-row > *:last-child{margin-left:auto}
  #mdbl-panel input[type="checkbox"]{transform:scale(1.1)}
  #mdbl-panel select, #mdbl-panel input[type="text"]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#121317;color:#eaeaea}
  #mdbl-panel .mdbl-actions{position:sticky;bottom:0;background:rgba(22,22,26,0.96);display:flex;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08)}
  #mdbl-panel button{padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#1b1c20;color:#eaeaea;cursor:pointer}
  #mdbl-panel button.primary{background:#2a6df4;border-color:#2a6df4;color:#fff}
  /* Source chips */
  #mdbl-sources{display:flex;flex-direction:column;gap:8px}
  .mdbl-source{display:flex;align-items:center;gap:10px;background:#0f1115;border:1px solid rgba(255,255,255,0.1);padding:8px 10px;border-radius:12px}
  .mdbl-source img{height:18px;width:auto}
  .mdbl-source .name{font-size:13px}
  .mdbl-source .spacer{flex:1}
  .mdbl-drag{cursor:grab;opacity:0.8}
  .mdbl-drag:active{cursor:grabbing}
  .mdbl-drag-handle{font-size:16px;opacity:0.6}
  .mdbl-dropping{outline:2px dashed rgba(255,255,255,0.25)}
  #mdbl-keys-note{margin-top:6px;font-size:12px;color:#9aa0a6}
  `;
  const style = document.createElement('style');
  style.id = 'mdbl-settings-css';
  style.textContent = css;
  document.head.appendChild(style);

  const gear = document.createElement('div');
  gear.id = 'mdbl-gear';
  gear.title = 'Jellyfin Ratings — Settings';
  gear.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 .001 7.001A3.5 3.5 0 0 0 12 8.5zm8.94 3.09l-1.73-.29a7.2 7.2 0 0 0-.68-1.64l1.03-1.4a.75.75 0 0 0-.09-.97l-1.44-1.44a.75.75 0 0 0-.97-.09l-1.4 1.03c-.52-.29-1.07-.51-1.64-.68l-.29-1.73A.75.75 0 0 0 12.19 2h-2.38a.75.75 0 0 0-.74.63l-.29 1.73c-.57.17-1.12.39-1.64.68L5.74 4.7a.75.75 0 0 0-.97.09L3.33 6.23a.75.75 0 0 0-.09.97l1.03 1.4c-.29.52-.51 1.07-.68 1.64l-1.73.29a.75.75 0 0 0-.63.74v2.38c0 .37.27.69.63.74l1.73.29c.17.57.39 1.12.68 1.64l-1.03 1.4a.75.75 0 0 0 .09.97l1.44 1.44c.26.26.67.3.97.09l1.4-1.03c.52.29 1.07.51 1.64.68l.29 1.73c.05.36.37.63.74.63h2.38c.37 0 .69-.27.74-.63l.29-1.73c.57-.17 1.12-.39 1.64-.68l1.4 1.03c.3.21.71.17.97-.09l1.44-1.44c.26-.26.3-.67.09-.97l-1.03-1.4c.29-.52.51-1.07.68-1.64l1.73-.29c.36-.05.63-.37.63-.74v-2.38a.75.75 0 0 0-.63-.74z"/></svg>`;
  document.body.appendChild(gear);

  const panel = document.createElement('div');
  panel.id = 'mdbl-panel';
  panel.innerHTML = `
    <header>
      <h3>Jellyfin Ratings — Settings</h3>
      <span class="mdbl-subtle">v${(window.MDBL_STATUS&&window.MDBL_STATUS.version)||'6.x'}</span>
    </header>

    <div class="mdbl-section" id="mdbl-sec-keys"></div>
    <div class="mdbl-section" id="mdbl-sec-sources"></div>
    <div class="mdbl-section" id="mdbl-sec-display"></div>

    <div class="mdbl-actions">
      <button id="mdbl-btn-cancel">Close</button>
      <button id="mdbl-btn-reset">Reset</button>
      <button id="mdbl-btn-save" class="primary">Save & Apply</button>
    </div>
    <div class="mdbl-subtle" style="padding:0 16px 14px;">
      Settings and local keys are stored only on this device. If your injector provides a key, it takes precedence.
    </div>
  `;
  document.body.appendChild(panel);

  // ---- Drag & Drop helpers for priorities --------------------------------
  function buildOrderedSourceList(){
    // order by current RATING_PRIORITY (lower first)
    return Object.keys(RATING_PRIORITY)
      .sort((a,b)=>(RATING_PRIORITY[a]??999)-(RATING_PRIORITY[b]??999))
      .filter(k => k in ENABLE_SOURCES); // keep only known keys
  }
  function makeSourceRow(key){
    const li = document.createElement('div');
    li.className = 'mdbl-source mdbl-drag';
    li.draggable = true;
    li.dataset.k = key;
    const icon = SOURCE_ICON[key] || '';
    const name = SOURCE_LABEL[key] || key.replace(/_/g,' ');
    li.innerHTML = `
      <img src="${icon}" alt="${name}" title="${name}">
      <span class="name">${name}</span>
      <div class="spacer"></div>
      <label class="toggle">
        <input type="checkbox" ${ENABLE_SOURCES[key] ? 'checked':''} data-toggle="${key}">
      </label>
      <span class="mdbl-drag-handle" title="Drag to reorder">⋮⋮</span>
    `;
    return li;
  }
  function enableDnD(container){
    let dragging = null;
    container.addEventListener('dragstart', e=>{
      const target = e.target.closest('.mdbl-source');
      if (!target) return;
      dragging = target;
      target.classList.add('mdbl-dropping');
      e.dataTransfer.effectAllowed = 'move';
    });
    container.addEventListener('dragover', e=>{
      if (!dragging) return;
      e.preventDefault();
      const after = getDragAfterElement(container, e.clientY);
      if (after == null) container.appendChild(dragging);
      else container.insertBefore(dragging, after);
    });
    container.addEventListener('drop', ()=>{
      if (dragging) dragging.classList.remove('mdbl-dropping');
      dragging = null;
    });
    container.addEventListener('dragend', ()=>{
      if (dragging) dragging.classList.remove('mdbl-dropping');
      dragging = null;
    });
    function getDragAfterElement(container, y){
      const els = [...container.querySelectorAll('.mdbl-source:not(.mdbl-dropping)')];
      return els.reduce((closest,child)=>{
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height/2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        else return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
  }

  // ---- Render -------------------------------------------------------------
  function render(){
    // KEYS (top)
    const kWrap = panel.querySelector('#mdbl-sec-keys');
    const injKey = getInjectorKey();
    const effKey = getEffectiveKey();
    const stored = getStoredKeys().MDBLIST || '';
    const masked = effKey ? (effKey.length > 6 ? `${effKey.slice(0,3)}…${effKey.slice(-3)}` : '•••') : '—';
    const readonlyAttr = injKey ? 'readonly' : '';
    const placeholder = injKey ? '(managed by injector)' : 'Enter MDBList API key';
    const note = injKey
      ? `<div id="mdbl-keys-note">Using key from injector. Local value is ignored while the injector key exists.</div>`
      : `<div id="mdbl-keys-note">No injector key detected. This local key will be used.</div>`;
    kWrap.innerHTML = `
      <div class="mdbl-subtle">Keys</div>
      <label class="mdbl-subtle">MDBList API key (effective: <strong>${masked}</strong>)</label>
      <input type="text" id="mdbl-key-mdb" ${readonlyAttr} placeholder="${placeholder}" value="${injKey ? injKey : (stored || '')}">
      ${note}
    `;

    // SOURCES (draggable list)
    const sWrap = panel.querySelector('#mdbl-sec-sources');
    sWrap.innerHTML = `<div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div>`;
    const sList = sWrap.querySelector('#mdbl-sources');
    buildOrderedSourceList().forEach(k=> sList.appendChild(makeSourceRow(k)));
    enableDnD(sList);

    // DISPLAY (single column)
    const dWrap = panel.querySelector('#mdbl-sec-display');
    dWrap.innerHTML = `
      <div class="mdbl-subtle">Display</div>
      <label class="mdbl-row"><span>Show %</span><input type="checkbox" id="d_showPercent" ${DISPLAY.showPercentSymbol?'checked':''}></label>
      <label class="mdbl-row"><span>Colorize ratings</span><input type="checkbox" id="d_colorize" ${DISPLAY.colorizeRatings?'checked':''}></label>
      <label class="mdbl-row"><span>Numbers only colored</span><input type="checkbox" id="d_colorNumsOnly" ${DISPLAY.colorizeNumbersOnly?'checked':''}></label>
      <label class="mdbl-row"><span>Icons only</span><input type="checkbox" id="d_iconsOnly" ${DISPLAY.iconsOnly?'checked':''}></label>
      <label class="mdbl-row"><span>Show bullet before “Ends at”</span><input type="checkbox" id="d_endsBullet" ${DISPLAY.endsAtBullet?'checked':''}></label>
      <label class="mdbl-row">
        <span>Align</span>
        <select id="d_align">
          <option value="left" ${DISPLAY.align==='left'?'selected':''}>left</option>
          <option value="center" ${DISPLAY.align==='center'?'selected':''}>center</option>
          <option value="right" ${DISPLAY.align==='right'?'selected':''}>right</option>
        </select>
      </label>
      <label class="mdbl-row">
        <span>Ends at format</span>
        <select id="d_endsFmt">
          <option value="24h" ${DISPLAY.endsAtFormat==='24h'?'selected':''}>24h</option>
          <option value="12h" ${DISPLAY.endsAtFormat==='12h'?'selected':''}>12h</option>
        </select>
      </label>
    `;
  }

  function show(){ panel.style.display = 'block'; }
  function hide(){ panel.style.display = 'none'; }

  gear.addEventListener('click', () => {
    if (panel.style.display === 'block') hide(); else { render(); show(); }
  });
  panel.querySelector('#mdbl-btn-cancel').addEventListener('click', hide);

  panel.querySelector('#mdbl-btn-reset').addEventListener('click', ()=>{
    Object.assign(ENABLE_SOURCES, deepClone(DEFAULTS.sources));
    Object.assign(DISPLAY,         deepClone(DEFAULTS.display));
    Object.assign(RATING_PRIORITY, deepClone(DEFAULTS.priorities));
    savePrefs({});
    render();
    if (window.MDBL_API && typeof window.MDBL_API.refresh==='function') window.MDBL_API.refresh();
  });

  panel.querySelector('#mdbl-btn-save').addEventListener('click', ()=>{
    // prefs to persist
    const prefs = { sources:{}, display:{}, priorities:{} };

    // Sources toggle states + order -> priorities
    const orderedKeys = [...panel.querySelectorAll('#mdbl-sources .mdbl-source')].map(el=>el.dataset.k);
    orderedKeys.forEach((k, idx)=>{
      prefs.priorities[k] = idx + 1; // lower appears earlier
    });
    panel.querySelectorAll('#mdbl-sources input[type="checkbox"][data-toggle]').forEach(cb=>{
      prefs.sources[cb.dataset.toggle] = cb.checked;
    });

    // Display
    prefs.display.showPercentSymbol   = panel.querySelector('#d_showPercent').checked;
    prefs.display.colorizeRatings     = panel.querySelector('#d_colorize').checked;
    prefs.display.colorizeNumbersOnly = panel.querySelector('#d_colorNumsOnly').checked;
    prefs.display.iconsOnly           = panel.querySelector('#d_iconsOnly').checked;
    prefs.display.align               = panel.querySelector('#d_align').value;
    prefs.display.endsAtFormat        = panel.querySelector('#d_endsFmt').value;
    prefs.display.endsAtBullet        = panel.querySelector('#d_endsBullet').checked;

    // Persist + apply
    savePrefs(prefs);
    applyPrefs(prefs);

    // Keys: save local key only if injector didn’t supply one
    const injKey = getInjectorKey();
    const keyInput = panel.querySelector('#mdbl-key-mdb');
    if (keyInput && !injKey) setStoredKey((keyInput.value||'').trim());

    // Optional immediate refresh of our widgets (before reload)
    if (window.MDBL_API && typeof window.MDBL_API.refresh==='function') window.MDBL_API.refresh();

    // Full page reload as requested
    location.reload();
  });

})();

})();
