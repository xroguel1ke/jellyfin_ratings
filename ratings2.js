// ==UserScript==
// @name         Jellyfin Ratings (v6.8.0 — Clean Menu & Uniform Compact)
// @namespace    https://mdblist.com
// @version      6.8.0
// @description  Unified ratings. API Key box hidden if valid. Uniform box sizes in Compact Mode.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

console.log('[Jellyfin Ratings] v6.8.0 loading...');

/* ==========================================================================
   1. CONFIGURATION & CONSTANTS
========================================================================== */

// --- Storage Cleanup ---
try {
    const rawKey = 'mdbl_prefs';
    const raw = localStorage.getItem(rawKey);
    if (raw) {
        const p = JSON.parse(raw);
        if (p.display && (isNaN(parseInt(p.display.posX)) || isNaN(parseInt(p.display.posY)))) {
            localStorage.removeItem(rawKey);
        }
    }
} catch (e) { localStorage.removeItem('mdbl_prefs'); }

// --- Defaults ---
const DEFAULT_ENABLE_SOURCES = {
    imdb: true, tmdb: true, trakt: true, letterboxd: true,
    rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
    metacritic_critic: true, metacritic_user: true,
    roger_ebert: true, anilist: true, myanimelist: true
};
const DEFAULT_DISPLAY = {
    showPercentSymbol: true,
    colorNumbers: true,
    colorIcons: false,
    posX: 0,
    posY: 0,
    colorBands: { redMax: 50, orangeMax: 69, ygMax: 79 },
    colorChoice: { red: 0, orange: 2, yg: 3, mg: 0 },
    compactLevel: 0
};
const DEFAULT_SPACING = { ratingsTopGapPx: 8 };
const DEFAULT_PRIORITIES = {
    imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
    rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
    roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
    anilist: 10, myanimelist: 11
};
const SCALE_MULTIPLIER = {
    imdb: 10, tmdb: 1, trakt: 1, letterboxd: 20, roger_ebert: 25,
    metacritic_critic: 1, metacritic_user: 10, myanimelist: 10, anilist: 1,
    rotten_tomatoes_critic: 1, rotten_tomatoes_audience: 1
};
const COLOR_SWATCHES = {
    red:    ['#e53935', '#f44336', '#d32f2f', '#c62828'],
    orange: ['#fb8c00', '#f39c12', '#ffa726', '#ef6c00'],
    yg:     ['#9ccc65', '#c0ca33', '#aeea00', '#cddc39'],
    mg:     ['#43a047', '#66bb6a', '#388e3c', '#81c784']
};

// Removed Hex Codes from names
const PALETTE_NAMES = {
    red:    ['Alert Red', 'Tomato', 'Crimson', 'Deep Red'],
    orange: ['Amber', 'Signal Orange', 'Apricot', 'Burnt Orange'],
    yg:     ['Lime Leaf', 'Citrus', 'Chartreuse', 'Soft Lime'],
    mg:     ['Emerald', 'Leaf Green', 'Forest', 'Mint']
};

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;
const NS = 'mdbl_';
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
    imdb: `${ICON_BASE}/IMDb.png`, tmdb: `${ICON_BASE}/TMDB.png`, trakt: `${ICON_BASE}/Trakt.png`,
    letterboxd: `${ICON_BASE}/letterboxd.png`, anilist: `${ICON_BASE}/anilist.png`, myanimelist: `${ICON_BASE}/mal.png`,
    roger: `${ICON_BASE}/Roger_Ebert.png`, tomatoes: `${ICON_BASE}/Rotten_Tomatoes.png`,
    audience: `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`, metacritic: `${ICON_BASE}/Metacritic.png`,
    metacritic_user: `${ICON_BASE}/mus2.png`,
};

const __CFG__ = (typeof window !== 'undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources || {});
const DISPLAY = Object.assign({}, DEFAULT_DISPLAY, __CFG__.display || {});
const SPACING = Object.assign({}, DEFAULT_SPACING, __CFG__.spacing || {});
const RATING_PRIORITY = Object.assign({}, DEFAULT_PRIORITIES, __CFG__.priorities || {});

if (isNaN(parseFloat(DISPLAY.posX))) DISPLAY.posX = 0;
if (isNaN(parseFloat(DISPLAY.posY))) DISPLAY.posY = 0;

const INJ_KEYS = (window.MDBL_KEYS || {});
const LS_KEYS_JSON = localStorage.getItem(`${NS}keys`);
const LS_KEYS = LS_KEYS_JSON ? (JSON.parse(LS_KEYS_JSON) || {}) : {};
const MDBLIST_API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || 'hehfnbo9y8blfyqm1d37ikubl');

/* ==========================================================================
   2. UTILITIES
========================================================================== */
if (typeof GM_xmlhttpRequest === 'undefined') {
    const PROXIES = ['https://api.allorigins.win/raw?url=', 'https://api.codetabs.com/v1/proxy?quest='];
    const DIRECT = ['api.mdblist.com', 'graphql.anilist.co', 'query.wikidata.org', 'api.themoviedb.org'];
    window.GM_xmlhttpRequest = ({ method = 'GET', url, headers = {}, data, onload, onerror }) => {
        const isDirect = DIRECT.some(d => url.includes(d));
        const proxy = PROXIES[Math.floor(Math.random() * PROXIES.length)];
        const sep = url.includes('?') ? '&' : '?';
        const final = isDirect ? url : (proxy + encodeURIComponent(url + sep + `_=${Date.now()}`));
        fetch(final, { method, headers, body: data, cache: 'no-store' })
            .then(r => r.text().then(t => onload && onload({ status: r.status, responseText: t })))
            .catch(e => onerror && onerror(e));
    };
}

const Util = {
    pad: n => String(n).padStart(2, '0'),
    num: v => parseFloat(v),
    ok: v => !isNaN(parseFloat(v)),
    round: v => Math.round(parseFloat(v)),
    normalize: (v, src) => {
        const m = SCALE_MULTIPLIER[(src || '').toLowerCase()] || 1;
        const x = parseFloat(v);
        return isNaN(x) ? null : x * m;
    },
    slug: t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
};

function getRatingColor(bands, choice, r) {
    bands = bands || { redMax: 50, orangeMax: 69, ygMax: 79 };
    choice = choice || { red: 0, orange: 0, yg: 0, mg: 0 };
    let band;
    if (r <= bands.redMax) band = 'red';
    else if (r <= bands.orangeMax) band = 'orange';
    else if (r <= bands.ygMax) band = 'yg';
    else band = 'mg';
    const i = Math.max(0, Math.min(3, (choice[band] | 0)));
    return COLOR_SWATCHES[band][i];
}

(function ensureStyleTag() {
    if (document.getElementById('mdblist-styles')) return;
    const style = document.createElement('style');
    style.id = 'mdblist-styles';
    style.textContent = `
    .mdblist-rating-container { pointer-events: auto; }
    .itemMiscInfo, .mainDetailRibbon, .detailRibbon { overflow: visible !important; contain: none !important; }
    #customEndsAt { font-size: inherit; opacity: 0.7; cursor: pointer; }
    #customEndsAt:hover { opacity: 1.0; text-decoration: underline; }
  `;
    document.head.appendChild(style);
})();

/* ==========================================================================
   3. CORE LOGIC
========================================================================== */
(function () {
    'use strict';
    let currentImdbId = null;

    const findPrimaryRow = () => document.querySelector('.itemMiscInfo.itemMiscInfo-primary') || document.querySelector('.itemMiscInfo-primary') || document.querySelector('.itemMiscInfo');

    function parseRuntimeToMinutes(text) {
        if (!text) return 0;
        const m = text.match(/(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
        if (!m) return 0;
        const h = parseInt(m[1] || '0', 10);
        const min = parseInt(m[2] || '0', 10);
        if (h === 0 && min === 0) {
            const only = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
            return only ? parseInt(only[1], 10) : 0;
        }
        return h * 60 + min;
    }

    function findRuntimeNode(primary) {
        for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')) {
            const mins = parseRuntimeToMinutes((el.textContent || '').trim());
            if (mins > 0) return { node: el, minutes: mins };
        }
        const mins = parseRuntimeToMinutes((primary.textContent || '').trim());
        return mins > 0 ? { node: primary, minutes: mins } : { node: null, minutes: 0 };
    }

    function hideNativeEndsAt() {
        const candidates = document.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo span, .itemMiscInfo div');
        candidates.forEach(el => {
            if (el.id === 'customEndsAt' || el.classList.contains('mdblist-rating-container') || el.closest('.mdblist-rating-container')) return;
            const text = (el.textContent || '').toLowerCase();
            if (text.includes('ends at') || text.includes('endet um') || text.includes('endet am')) {
                el.style.display = 'none';
            }
        });
    }

    function ensureEndsAtInline() {
        const primary = findPrimaryRow(); if (!primary) return;
        const { node: runtimeNode, minutes } = findRuntimeNode(primary);
        
        if (!minutes && primary.querySelector('#customEndsAt')) {
            primary.querySelector('#customEndsAt').remove();
            return;
        }
        if (!minutes) return;

        const end = new Date(Date.now() + minutes * 60000);
        const timeStr = `${Util.pad(end.getHours())}:${Util.pad(end.getMinutes())}`;
        const content = `Ends at ${timeStr}`;

        let span = primary.querySelector('#customEndsAt');
        if (!span) {
            span = document.createElement('span');
            span.id = 'customEndsAt';
            // Click to open settings
            span.title = 'Click to open Jellyfin Ratings Settings';
            span.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if(window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS();
            });

            Object.assign(span.style, {
                marginLeft: '10px',
                marginRight: '24px',
                display: 'inline', 
                verticalAlign: 'baseline'
            });
            
            if (runtimeNode && runtimeNode.nextSibling) {
                runtimeNode.parentNode.insertBefore(span, runtimeNode.nextSibling);
            } else {
                primary.appendChild(span);
            }
        }
        if (span.textContent !== content) span.textContent = content;
    }

    function hideDefaultRatingsOnce() {
        document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box => {
            box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el => el.style.display = 'none');
        });
    }

    function scanLinks() {
        document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a => {
            if (a.dataset.mdblSeen === '1') return; a.dataset.mdblSeen = '1';
            const m = a.href.match(/imdb\.com\/title\/(tt\d+)/); if (!m) return;
            const id = m[1];
            if (id !== currentImdbId) {
                document.querySelectorAll('.mdblist-rating-container').forEach(el => el.remove());
                currentImdbId = id;
            }
        });

        [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].forEach(a => {
            if (a.dataset.mdblProc === '1') return;
            const m = a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/); if (!m) return;
            a.dataset.mdblProc = '1';

            const type = m[1] === 'tv' ? 'show' : 'movie';
            const tmdbId = m[2];
            
            document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b => {
                const ref = b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating') || b.querySelector('.mediaInfoItem:last-of-type');
                if (!ref) return;
                if (ref.nextElementSibling && ref.nextElementSibling.classList?.contains('mdblist-rating-container')) return;

                const div = document.createElement('div');
                div.className = 'mdblist-rating-container';

                let px = parseFloat(DISPLAY.posX); if (isNaN(px)) px = 0;
                let py = parseFloat(DISPLAY.posY); if (isNaN(py)) py = 0;

                div.style.cssText += `display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;width:calc(100% + 6px);margin-left:-6px;margin-top:${SPACING.ratingsTopGapPx}px;padding-right:0;box-sizing:border-box;transform:translate(${px}px,${py}px);z-index:99999;position:relative;pointer-events:auto;`;
                
                Object.assign(div.dataset, { type, tmdbId, mdblFetched: '0' });
                ref.insertAdjacentElement('afterend', div);
            });
        });
        hideDefaultRatingsOnce();
    }

    function updateRatings() {
        document.querySelectorAll('.mdblist-rating-container').forEach(c => {
            if (c.dataset.mdblFetched === '1') return;
            const type = c.dataset.type || 'movie';
            const tmdbId = c.dataset.tmdbId;
            if (!tmdbId) return;
            c.dataset.mdblFetched = '1';
            fetchRatings(tmdbId, currentImdbId, c, type);
        });
    }

    function appendRating(container, logo, val, title, key, link, count, kind) {
        if (!Util.ok(val)) return;
        const n = Util.normalize(val, key); if (!Util.ok(n)) return;
        const r = Util.round(n);
        const disp = DISPLAY.showPercentSymbol ? `${r}%` : `${r}`;
        
        if (container.querySelector(`[data-source="${key}"]`)) return;

        const wrap = document.createElement('div');
        wrap.dataset.source = key;
        wrap.style = 'display:inline-flex;align-items:center;margin:0 6px;gap:6px;';

        const a = document.createElement('a');
        a.href = link || '#';
        if (link && link !== '#') a.target = '_blank';
        a.style.textDecoration = 'none';
        
        const img = document.createElement('img');
        img.src = logo; img.alt = title;
        img.style = 'height:1.3em;vertical-align:middle;';
        const labelCount = (typeof count === 'number' && isFinite(count)) ? `${count.toLocaleString()} ${kind || (key === 'rotten_tomatoes_critic' ? 'Reviews' : 'Votes')}` : '';
        img.title = labelCount ? `${title} — ${labelCount}` : title;
        a.appendChild(img);

        const s = document.createElement('span');
        s.textContent = disp;
        s.title = 'Open settings';
        s.style = 'font-size:1em;vertical-align:middle;cursor:pointer;';
        s.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS(); });

        if (DISPLAY.colorNumbers || DISPLAY.colorIcons) {
            const col = getRatingColor(DISPLAY.colorBands, DISPLAY.colorChoice, r);
            if (DISPLAY.colorNumbers) s.style.color = col;
            if (DISPLAY.colorIcons) img.style.filter = `drop-shadow(0 0 3px ${col})`;
        }

        wrap.append(a, s);
        container.append(wrap);
        
        [...container.children]
            .sort((a, b) => (RATING_PRIORITY[a.dataset.source] ?? 999) - (RATING_PRIORITY[b.dataset.source] ?? 999))
            .forEach(el => container.appendChild(el));
    }

    function fetchRTDirectLink(imdbId, cb) {
        const key = `${NS}rturl_${imdbId}`;
        const cache = localStorage.getItem(key);
        if (cache) { try { return cb(JSON.parse(cache)); } catch { } }
        const q = `SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
            onload: r => {
                try {
                    const val = JSON.parse(r.responseText).results.bindings[0]?.rtid?.value || '';
                    const url = val ? ('https://www.rottentomatoes.com/' + val.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//, '')) : '';
                    if (url) localStorage.setItem(key, JSON.stringify(url));
                    cb(url || '');
                } catch { cb(''); }
            },
            onerror: () => cb('')
        });
    }

    function fetchRatings(tmdbId, imdbId, container, type = 'movie') {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
            onload: r => {
                if (r.status !== 200) { console.error('MDBList API Error:', r.status); return; }
                let d; try { d = JSON.parse(r.responseText); } catch { return; }
                const title = d.title || '';
                const slug = Util.slug(title);

                let rtCriticVal = null, rtCriticCnt = null;
                let rtAudienceVal = null, rtAudienceCnt = null;

                d.ratings?.forEach(rr => {
                    const s = (rr.source || '').toLowerCase();
                    const v = rr.value;
                    const cnt = rr.votes || rr.count || rr.reviewCount || rr.ratingCount;

                    if (s.includes('imdb') && ENABLE_SOURCES.imdb)
                        appendRating(container, LOGO.imdb, v, 'IMDb', 'imdb', `https://www.imdb.com/title/${imdbId}/`, cnt, 'Votes');
                    else if (s.includes('tmdb') && ENABLE_SOURCES.tmdb)
                        appendRating(container, LOGO.tmdb, v, 'TMDb', 'tmdb', `https://www.themoviedb.org/${type}/${tmdbId}`, cnt, 'Votes');
                    else if (s.includes('trakt') && ENABLE_SOURCES.trakt)
                        appendRating(container, LOGO.trakt, v, 'Trakt', 'trakt', `https://trakt.tv/search/imdb/${imdbId}`, cnt, 'Votes');
                    else if (s.includes('letterboxd') && ENABLE_SOURCES.letterboxd)
                        appendRating(container, LOGO.letterboxd, v, 'Letterboxd', 'letterboxd', `https://letterboxd.com/imdb/${imdbId}/`, cnt, 'Votes');
                    else if ((s === 'tomatoes' || s.includes('rotten_tomatoes'))) {
                        rtCriticVal = v; rtCriticCnt = cnt;
                    }
                    else if ((s.includes('popcorn') || s.includes('audience'))) {
                        rtAudienceVal = v; rtAudienceCnt = cnt;
                    }
                    else if (s === 'metacritic' && ENABLE_SOURCES.metacritic_critic) {
                        const seg = (container.dataset.type === 'show') ? 'tv' : 'movie';
                        const link = slug ? `https://www.metacritic.com/${seg}/${slug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
                        appendRating(container, LOGO.metacritic, v, 'Metacritic (Critic)', 'metacritic_critic', link, cnt, 'Reviews');
                    }
                    else if (s.includes('metacritic') && s.includes('user') && ENABLE_SOURCES.metacritic_user) {
                        const seg = (container.dataset.type === 'show') ? 'tv' : 'movie';
                        const link = slug ? `https://www.metacritic.com/${seg}/${slug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
                        appendRating(container, LOGO.metacritic_user, v, 'Metacritic (User)', 'metacritic_user', link, cnt, 'Votes');
                    }
                    else if (s.includes('roger') && ENABLE_SOURCES.roger_ebert)
                        appendRating(container, LOGO.roger, v, 'Roger Ebert', 'roger_ebert', `https://www.rogerebert.com/reviews/${slug}`, cnt);
                });

                const hasMDBL_RT = (rtCriticVal != null) || (rtAudienceVal != null);
                if (hasMDBL_RT) {
                    fetchRTDirectLink(imdbId, (rtUrl) => {
                        const link = rtUrl || (title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#');
                        if (ENABLE_SOURCES.rotten_tomatoes_critic && rtCriticVal != null)
                            appendRating(container, LOGO.tomatoes, rtCriticVal, 'RT Critic', 'rotten_tomatoes_critic', link, rtCriticCnt, 'Reviews');
                        if (ENABLE_SOURCES.rotten_tomatoes_audience && rtAudienceVal != null)
                            appendRating(container, LOGO.audience, rtAudienceVal, 'RT Audience', 'rotten_tomatoes_audience', link, rtAudienceCnt, 'Votes');
                    });
                }
                if (ENABLE_SOURCES.anilist) fetchAniList(imdbId, container);
                if (ENABLE_SOURCES.myanimelist) fetchMAL(imdbId, container);
                if (!hasMDBL_RT && (ENABLE_SOURCES.rotten_tomatoes_critic || ENABLE_SOURCES.rotten_tomatoes_audience))
                    fetchRT_HTMLFallback(imdbId, container);
            }
        });
    }

    function fetchAniList(imdbId, container) {
        const q = `SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
        GM_xmlhttpRequest({
            method: 'GET', url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
            onload: r => {
                try {
                    const id = JSON.parse(r.responseText).results.bindings[0]?.anilist?.value; if (!id) return;
                    const gql = 'query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
                    GM_xmlhttpRequest({
                        method: 'POST', url: 'https://graphql.anilist.co', headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify({ query: gql, variables: { id: parseInt(id, 10) } }),
                        onload: rr => {
                            const m = JSON.parse(rr.responseText).data?.Media;
                            if (Util.ok(m?.meanScore)) appendRating(container, LOGO.anilist, m.meanScore, 'AniList', 'anilist', `https://anilist.co/anime/${id}`);
                        }
                    });
                } catch { }
            }
        });
    }
    function fetchMAL(imdbId, container) {
        const q = `SELECT ?mal WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P4086 ?mal . } LIMIT 1`;
        GM_xmlhttpRequest({
            method: 'GET', url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
            onload: r => {
                try {
                    const id = JSON.parse(r.responseText).results.bindings[0]?.mal?.value; if (!id) return;
                    GM_xmlhttpRequest({
                        method: 'GET', url: `https://api.jikan.moe/v4/anime/${id}`,
                        onload: rr => {
                            const d = JSON.parse(rr.responseText).data;
                            if (Util.ok(d.score)) appendRating(container, LOGO.myanimelist, d.score, 'MyAnimeList', 'myanimelist', `https://myanimelist.net/anime/${id}`, d.scored_by, 'Votes');
                        }
                    });
                } catch { }
            }
        });
    }
    function fetchRT_HTMLFallback(imdbId, container) {
        const key = `${NS}rt_${imdbId}`;
        const cache = localStorage.getItem(key);
        if (cache) { try { const j = JSON.parse(cache); if (Date.now() - j.time < CACHE_DURATION) { addRT(container, j.scores); return; } } catch { } }
        const q = `SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
        GM_xmlhttpRequest({
            method: 'GET', url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
            onload: r => {
                try {
                    const id = JSON.parse(r.responseText).results.bindings[0]?.rtid?.value; if (!id) return;
                    const url = `https://www.rottentomatoes.com/${id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//, '')}`;
                    GM_xmlhttpRequest({
                        method: 'GET', url,
                        onload: rr => {
                            try {
                                const m = rr.responseText.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
                                if (!m) return;
                                const d = JSON.parse(m[1]);
                                const scores = {
                                    critic: Util.num(d.criticsScore?.score),
                                    audience: Util.num(d.audienceScore?.score),
                                    link: url,
                                    cCount: d.criticsScore?.reviewCount,
                                    aCount: d.audienceScore?.ratingCount
                                };
                                addRT(container, scores);
                                localStorage.setItem(key, JSON.stringify({ time: Date.now(), scores }));
                            } catch { }
                        }
                    });
                } catch { }
            }
        });
        function addRT(c, s) {
            if (Util.ok(s.critic) && ENABLE_SOURCES.rotten_tomatoes_critic) appendRating(c, LOGO.tomatoes, s.critic, 'RT Critic', 'rotten_tomatoes_critic', s.link || '#', s.cCount, 'Reviews');
            if (Util.ok(s.audience) && ENABLE_SOURCES.rotten_tomatoes_audience) appendRating(c, LOGO.audience, s.audience, 'RT Audience', 'rotten_tomatoes_audience', s.link || '#', s.aCount, 'Votes');
        }
    }

    function updateAll() {
        try {
            hideNativeEndsAt();
            ensureEndsAtInline();
            hideDefaultRatingsOnce();
            scanLinks();
            updateRatings();
        } catch (e) { console.error('Ratings script error:', e); }
    }
    const MDbl = { debounceTimer: null };
    MDbl.debounce = (fn, wait = 150) => { clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer = setTimeout(fn, wait); };
    (new MutationObserver(() => MDbl.debounce(updateAll, 150))).observe(document.body, { childList: true, subtree: true });
    updateAll();
})();


/* ==========================================================================
   4. SETTINGS MENU (UI)
========================================================================== */
(function settingsMenu() {
    const PREFS_KEY = `${NS}prefs`;
    const LS_KEYS = `${NS}keys`;

    const deepClone = o => JSON.parse(JSON.stringify(o));
    const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } };
    const savePrefs = p => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p || {})); } catch { } };

    const ICON = {
        imdb: LOGO.imdb, tmdb: LOGO.tmdb, trakt: LOGO.trakt, letterboxd: LOGO.letterboxd,
        rotten_tomatoes_critic: LOGO.tomatoes, rotten_tomatoes_audience: LOGO.audience,
        metacritic_critic: LOGO.metacritic, metacritic_user: LOGO.metacritic_user,
        roger_ebert: LOGO.roger, anilist: LOGO.anilist, myanimelist: LOGO.myanimelist
    };
    const LABEL = {
        imdb: 'IMDb', tmdb: 'TMDb', trakt: 'Trakt', letterboxd: 'Letterboxd',
        rotten_tomatoes_critic: 'Rotten Tomatoes (Critic)', rotten_tomatoes_audience: 'Rotten Tomatoes (Audience)',
        metacritic_critic: 'Metacritic (Critic)', metacritic_user: 'Metacritic (User)',
        roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MyAnimeList'
    };
    const DEFAULTS = { sources: deepClone(ENABLE_SOURCES), display: deepClone(DEFAULT_DISPLAY), priorities: deepClone(RATING_PRIORITY) };

    // Keys logic
    const getInjectorKey = () => { try { return (window.MDBL_KEYS && window.MDBL_KEYS.MDBLIST) ? String(window.MDBL_KEYS.MDBLIST) : ''; } catch { return ''; } };
    const getStoredKeys = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '{}'); } catch { return {}; } };
    const setStoredKey = (newKey) => {
        const obj = Object.assign({}, getStoredKeys(), { MDBLIST: newKey || '' });
        try { localStorage.setItem(LS_KEYS, JSON.stringify(obj)); } catch { }
        if (!getInjectorKey()) { if (!window.MDBL_KEYS || typeof window.MDBL_KEYS !== 'object') window.MDBL_KEYS = {}; window.MDBL_KEYS.MDBLIST = newKey || ''; }
    };
    function applyPrefs(p) {
        if (p.sources) Object.keys(ENABLE_SOURCES).forEach(k => { if (k in p.sources) ENABLE_SOURCES[k] = !!p.sources[k]; });
        if (p.display) Object.keys(DISPLAY).forEach(k => { if (k in p.display) DISPLAY[k] = p.display[k]; });
        if (p.priorities) Object.keys(p.priorities).forEach(k => { const v = +p.priorities[k]; if (isFinite(v)) RATING_PRIORITY[k] = v; });
    }
    const saved = loadPrefs(); if (saved && Object.keys(saved).length) applyPrefs(saved);

    // --- Consolidated CSS (Everything in one place) ---
    const css = `
    :root { --mdbl-right-col: 48px; --mdbl-right-col-wide: 200px; }
    #mdbl-panel { position:fixed; right:16px; bottom:70px; width:480px; max-height:90vh; overflow:auto; border-radius:14px;
        border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); backdrop-filter:blur(8px);
        color:#eaeaea; z-index:99999; box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; }
    #mdbl-panel header { position:sticky; top:0; background:rgba(22,22,26,0.98); padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.08);
        display:flex; align-items:center; gap:8px; cursor:move; z-index:999; backdrop-filter:blur(8px); }
    #mdbl-panel header h3 { margin:0; font-size:15px; font-weight:700; flex:1; }
    #mdbl-close { border:none; background:transparent; color:#aaa; font-size:18px; cursor:pointer; padding:4px; border-radius:8px; }
    #mdbl-close:hover { background:rgba(255,255,255,0.06); color:#fff; }
    #mdbl-panel .mdbl-section { padding:12px 16px; display:flex; flex-direction:column; gap:10px; }
    #mdbl-panel .mdbl-subtle { color:#9aa0a6; font-size:12px; }
    
    #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { display:grid; grid-template-columns:1fr var(--mdbl-right-col); align-items:center; gap:10px; padding:8px 10px; border-radius:12px; }
    #mdbl-panel .mdbl-row { background:transparent; border:1px solid rgba(255,255,255,0.06); min-height: 48px; box-sizing:border-box; }
    #mdbl-panel .mdbl-row.wide { grid-template-columns:1fr var(--mdbl-right-col-wide); }
    #mdbl-panel input[type="checkbox"] { transform:scale(1.1); justify-self:end; }
    #mdbl-panel input[type="text"] { width:100%; padding:10px 0; border:0; background:transparent; color:#eaeaea; font-size:14px; outline:none; }
    
    /* Common select & input styles */
    #mdbl-panel select, #mdbl-panel input.mdbl-pos-input, #mdbl-panel input.mdbl-num-input {
        padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#121317; color:#eaeaea;
        height:32px; line-height: 32px; box-sizing:border-box; display:inline-block;
    }
    #mdbl-panel .mdbl-select { width:140px; justify-self:end; }
    
    /* Uniform size & styling */
    #mdbl-panel input.mdbl-pos-input { width: 75px; text-align: center; font-size: 14px; }
    #mdbl-panel input.mdbl-num-input { width: 56px; text-align: center; -moz-appearance:textfield; }
    #mdbl-panel input.mdbl-num-input::-webkit-inner-spin-button, 
    #mdbl-panel input.mdbl-num-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

    #mdbl-panel .mdbl-actions { position:sticky; bottom:0; background:rgba(22,22,26,0.96); display:flex; gap:10px; padding:12px 16px; border-top:1px solid rgba(255,255,255,0.08); }
    #mdbl-panel button { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#1b1c20; color:#eaeaea; cursor:pointer; }
    #mdbl-panel button.primary { background:#2a6df4; border-color:#2a6df4; color:#fff; }
    
    #mdbl-sources { display:flex; flex-direction:column; gap:8px; }
    .mdbl-source { background:#0f1115; border:1px solid rgba(255,255,255,0.1); }
    .mdbl-src-left { display:flex; align-items:center; gap:10px; }
    .mdbl-src-left img { height:18px; width:auto; }
    .mdbl-src-left .name { font-size:13px; }
    .mdbl-drag-handle { justify-self:start; opacity:0.6; cursor:grab; }
    #mdbl-key-box { background:#0f1115; border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:12px; }
    
    .mdbl-grid { display:grid; grid-template-columns:1fr; gap:10px; }
    .mdbl-grid .grid-row { display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:12px; }
    @media (max-width: 420px){ .mdbl-grid .grid-row { grid-template-columns:1fr; } }
    .grid-right { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
    .mdbl-grid label { white-space: nowrap; }
    .sw { display:inline-block; width:18px; height:18px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); }
    
    #mdbl-panel hr { border:0; border-top:1px solid rgba(255,255,255,0.08); margin:10px 0; }
    #mdbl-panel .mdbl-actions { display:flex; align-items:center; gap:8px; }
    #mdbl-panel .mdbl-actions .mdbl-grow { flex:1; }
    #mdbl-panel .mdbl-actions .mdbl-compact { display:inline-flex; align-items:center; gap:6px; opacity:0.95; }
    
    /* FIXED: Compact Mode Width increased to 460 to fit slider + text */
    #mdbl-panel[data-compact="1"] { --mdbl-right-col:44px; --mdbl-right-col-wide:220px; width:460px; }
    #mdbl-panel[data-compact="1"] header { padding:6px 12px; }
    /* Tighter vertical spacing to prevent scroll */
    #mdbl-panel[data-compact="1"] .mdbl-section { padding:2px 12px; gap:2px; }
    #mdbl-panel[data-compact="1"] .mdbl-row, #mdbl-panel[data-compact="1"] .mdbl-source { gap:5px; padding:2px 6px; border-radius:6px; min-height: 32px; }
    #mdbl-panel[data-compact="1"] .mdbl-actions { padding:6px 10px; }
    #mdbl-panel[data-compact="1"] .mdbl-src-left img { height:16px; }
    #mdbl-panel[data-compact="1"] select, #mdbl-panel[data-compact="1"] input.mdbl-pos-input, #mdbl-panel[data-compact="1"] input.mdbl-num-input { height: 28px; font-size: 12px; line-height: 28px; }
    #mdbl-panel[data-compact="1"] .mdbl-select { width: 140px; }
    #mdbl-panel[data-compact="1"] hr { margin: 4px 0; }

    /* === MOBILE RESPONSIVENESS === */
    @media (max-width: 600px) {
        #mdbl-panel, #mdbl-panel[data-compact="1"] {
            width: 96% !important;
            left: 2% !important;
            right: 2% !important;
            bottom: 10px !important;
            top: auto !important;
            transform: none !important; /* Disable JS drag positioning */
            max-height: 80vh;
            --mdbl-right-col: 40px;
            --mdbl-right-col-wide: 140px;
        }
        /* Disable dragging on mobile */
        #mdbl-panel header { cursor: default; }
        /* Make rows slightly smaller on mobile */
        #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { min-height: 42px; padding: 4px 8px; }
        #mdbl-panel .mdbl-select { width: 140px; }
    }
    `;

    if (!document.getElementById('mdbl-settings-css')) {
        const style = document.createElement('style');
        style.id = 'mdbl-settings-css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // --- Build Panel ---
    const panel = document.createElement('div'); panel.id = 'mdbl-panel';
    panel.innerHTML = `
    <header id="mdbl-drag-handle">
      <h3>Jellyfin Ratings — Settings</h3>
      <button id="mdbl-close" aria-label="Close">✕</button>
    </header>

    <div class="mdbl-section" id="mdbl-sec-keys"></div>
    <hr>
    <div class="mdbl-section" id="mdbl-sec-sources"></div>
    <hr>
    <div class="mdbl-section" id="mdbl-sec-display"></div>

    <div class="mdbl-actions">
      <button id="mdbl-btn-reset">Reset</button>
      <button id="mdbl-btn-save" class="primary">Save & Apply</button>
      <div class="mdbl-grow"></div>
      <label class="mdbl-compact" for="mdbl-compact-toggle">
        <span>Compact</span>
        <input type="checkbox" id="mdbl-compact-toggle">
      </label>
    </div>
  `;
    document.body.appendChild(panel);

    // Initialize Compact Mode
    (function () {
        try {
            const prefs0 = Object.assign({}, DEFAULTS, loadPrefs() || {});
            let cl = +prefs0.display.compactLevel || 0;
            if (cl > 1) cl = 1; if (cl < 0) cl = 0;
            const chk = panel.querySelector('#mdbl-compact-toggle');
            if (chk) {
                chk.checked = !!cl;
                panel.setAttribute('data-compact', chk.checked ? '1' : '0');
                chk.addEventListener('change', () => { panel.setAttribute('data-compact', chk.checked ? '1' : '0'); });
            }
        } catch (e) { }
    })();

    document.addEventListener('mousedown', e => { if (panel.style.display !== 'block') return; if (!panel.contains(e.target)) hide(); });
    // Drag Logic (with mobile guard)
    (function makePanelDraggable() {
        const header = panel.querySelector('#mdbl-drag-handle'); let drag = false, sx = 0, sy = 0, sl = 0, st = 0;
        header.addEventListener('mousedown', e => {
            if (window.innerWidth <= 600) return;
            if (e.target.id === 'mdbl-close') return;
            drag = true; const rect = panel.getBoundingClientRect();
            panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
            sx = e.clientX; sy = e.clientY; sl = rect.left; st = rect.top;
            const move = e2 => { if (!drag) return; panel.style.left = Math.max(0, sl + (e2.clientX - sx)) + 'px'; panel.style.top = Math.max(0, st + (e2.clientY - sy)) + 'px'; };
            const up = () => { drag = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); e.preventDefault();
        });
    })();

    function makeSourceRow(item) {
        const key = item.k, checked = !!ENABLE_SOURCES[key];
        const row = document.createElement('div'); row.className = 'mdbl-source'; row.dataset.k = key; row.draggable = true;
        row.innerHTML = `
      <div class="mdbl-src-left">
        <span class="mdbl-drag-handle" title="Drag to reorder">⋮⋮</span>
        <img src="${item.icon}" alt="${item.label}">
        <span class="name">${item.label}</span>
      </div>
      <input type="checkbox" ${checked ? 'checked' : ''} data-toggle="${key}">
    `;
        return row;
    }

    function enableDnD(container) {
        let dragging = null;
        container.addEventListener('dragstart', e => {
            const t = e.target.closest('.mdbl-source'); if (!t) return; dragging = t; t.style.opacity = '0.6'; e.dataTransfer.effectAllowed = 'move';
        });
        container.addEventListener('dragover', e => {
            if (!dragging) return; e.preventDefault();
            const after = getAfter(container, e.clientY);
            (after == null) ? container.appendChild(dragging) : container.insertBefore(dragging, after);
        });
        ['drop', 'dragend'].forEach(evt => container.addEventListener(evt, () => { if (dragging) dragging.style.opacity = ''; dragging = null; }));
        function getAfter(container, y) {
            const els = [...container.querySelectorAll('.mdbl-source:not([style*="opacity: 0.6"])')];
            return els.reduce((c, ch) => { const box = ch.getBoundingClientRect(), off = y - box.top - box.height / 2; return (off < 0 && off > c.offset) ? { offset: off, element: ch } : c; }, { offset: -1e9 }).element;
        }
    }

    function updateLivePreview() {
        const x = parseInt(panel.querySelector('#d_posX_range').value || '0', 10);
        const y = parseInt(panel.querySelector('#d_posY_range').value || '0', 10);
        document.querySelectorAll('.mdblist-rating-container').forEach(el => {
            el.style.transform = `translate(${x}px, ${y}px)`;
        });
    }

    // --- Helper for Colors Grid ---
    function createColorBandRow(idPrefix, labelPrefix, defaultVal, colorKey) {
        const names = PALETTE_NAMES[colorKey] || [];
        const options = names.map((name, i) => {
            const sel = (DISPLAY.colorChoice && DISPLAY.colorChoice[colorKey] === i) ? 'selected' : '';
            return `<option value="${i}" ${sel}>${name}</option>`;
        }).join('');

        const isTop = (idPrefix === 'top_tier');
        if (isTop) {
            return `
            <div class="grid-row">
                <label id="label_top_tier">Top tier (≥ ${(((DISPLAY.colorBands && DISPLAY.colorBands.ygMax) != null ? DISPLAY.colorBands.ygMax : 79) + 1)}%)</label>
                <div class="grid-right">
                    <span class="sw" id="sw_mg" title="Current color"></span>
                    <select id="col_mg" class="mdbl-select">${options}</select>
                </div>
            </div>`;
        }

        return `
        <div class="grid-row">
            <label>${labelPrefix} ≤ <input id="${idPrefix}" type="number" min="0" max="100" value="${defaultVal}" class="mdbl-num-input"> %</label>
            <div class="grid-right">
                <span class="sw" id="sw_${colorKey}" title="Current color"></span>
                <select id="col_${colorKey}" class="mdbl-select">${options}</select>
            </div>
        </div>`;
    }

    function render() {
        // API Key UI
        const kWrap = panel.querySelector('#mdbl-sec-keys');
        const injKey = getInjectorKey(); const stored = getStoredKeys().MDBLIST || '';
        if (!!(injKey || stored)) {
            // If key exists, hide the box completely as requested
            kWrap.innerHTML = ``;
            kWrap.style.display = 'none'; // Hide the container too to save vertical space
        } else {
            kWrap.innerHTML = `<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value=""></div>`;
            kWrap.style.display = 'flex';
        }

        // Sources UI
        const sWrap = panel.querySelector('#mdbl-sec-sources');
        sWrap.innerHTML = `<div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div>`;
        const sList = sWrap.querySelector('#mdbl-sources');
        Object.keys(RATING_PRIORITY).filter(k => k in ENABLE_SOURCES)
            .sort((a, b) => (RATING_PRIORITY[a] ?? 999) - (RATING_PRIORITY[b] ?? 999))
            .map(k => ({ k, icon: ICON[k], label: LABEL[k] || k.replace(/_/g, ' ') }))
            .forEach(item => sList.appendChild(makeSourceRow(item)));
        enableDnD(sList);

        // Display UI
        const dWrap = panel.querySelector('#mdbl-sec-display');
        dWrap.innerHTML = `
        <div class="mdbl-subtle">Display</div>
        <div class="mdbl-row"><span>Color numbers</span><input type="checkbox" id="d_colorNumbers" ${DISPLAY.colorNumbers ? 'checked' : ''}></div>
        <div class="mdbl-row"><span>Color icons</span><input type="checkbox" id="d_colorIcons" ${DISPLAY.colorIcons ? 'checked' : ''}></div>
        <div class="mdbl-row"><span>Show %</span><input type="checkbox" id="d_showPercent" ${DISPLAY.showPercentSymbol ? 'checked' : ''}></div>
        
        <div class="mdbl-row wide">
            <span>Position X (px)</span>
            <div class="grid-right" style="flex:1; display:flex; justify-content:flex-end; align-items:center; gap:8px;">
            <input type="range" id="d_posX_range" min="-1500" max="1500" value="${DISPLAY.posX || 0}" style="flex:1; cursor:pointer;">
            <input type="number" id="d_posX" value="${DISPLAY.posX || 0}" class="mdbl-pos-input">
            </div>
        </div>
        <div class="mdbl-row wide">
            <span>Position Y (px)</span>
            <div class="grid-right" style="flex:1; display:flex; justify-content:flex-end; align-items:center; gap:8px;">
            <input type="range" id="d_posY_range" min="-1500" max="1500" value="${DISPLAY.posY || 0}" style="flex:1; cursor:pointer;">
            <input type="number" id="d_posY" value="${DISPLAY.posY || 0}" class="mdbl-pos-input">
            </div>
        </div>

        <hr>
        <div class="mdbl-subtle">Color bands &amp; palette</div>
        <div class="mdbl-grid">
            ${createColorBandRow('th_red', 'Rating', (DISPLAY.colorBands && DISPLAY.colorBands.redMax) != null ? DISPLAY.colorBands.redMax : 50, 'red')}
            ${createColorBandRow('th_orange', 'Rating', (DISPLAY.colorBands && DISPLAY.colorBands.orangeMax) != null ? DISPLAY.colorBands.orangeMax : 69, 'orange')}
            ${createColorBandRow('th_yg', 'Rating', (DISPLAY.colorBands && DISPLAY.colorBands.ygMax) != null ? DISPLAY.colorBands.ygMax : 79, 'yg')}
            ${createColorBandRow('top_tier', '', 0, 'mg')}
        </div>
        `;

        // Bind Sliders
        ['X', 'Y'].forEach(axis => {
            const rng = panel.querySelector(`#d_pos${axis}_range`);
            const num = panel.querySelector(`#d_pos${axis}`);
            if (rng && num) {
                rng.addEventListener('input', () => { num.value = rng.value; updateLivePreview(); });
                num.addEventListener('input', () => { rng.value = num.value; updateLivePreview(); });
            }
        });

        // Dynamic Label for Top Tier
        const _ygInput = panel.querySelector('#th_yg');
        const _labelTop = panel.querySelector('#label_top_tier');
        if (_ygInput && _labelTop) {
            _ygInput.addEventListener('input', () => {
                const v = parseInt(_ygInput.value || '79', 10);
                _labelTop.textContent = `Top tier (≥ ${isNaN(v) ? 80 : (v + 1)}%)`;
            });
        }

        // Palette Previews
        function mdblUpdateSwatches() {
            ['red', 'orange', 'yg', 'mg'].forEach(k => {
                const sel = panel.querySelector('#col_' + k);
                const sw = panel.querySelector('#sw_' + k);
                if (sel && sw) {
                    const idx = +(sel.value || 0);
                    sw.style.background = COLOR_SWATCHES[k][Math.max(0, Math.min(3, idx))];
                }
            });
        }
        ['#col_red', '#col_orange', '#col_yg', '#col_mg'].forEach(id => {
            const el = panel.querySelector(id);
            if (el) el.addEventListener('change', mdblUpdateSwatches);
        });
        mdblUpdateSwatches();
    }

    function show() { panel.style.display = 'block'; }
    function hide() { panel.style.display = 'none'; }
    window.MDBL_OPEN_SETTINGS = () => { render(); show(); };
    panel.addEventListener('click', e => { if (e.target.id === 'mdbl-close') hide(); });

    // Reset Action
    panel.querySelector('#mdbl-btn-reset').addEventListener('click', () => {
        Object.assign(ENABLE_SOURCES, deepClone(DEFAULTS.sources));
        Object.assign(DISPLAY, deepClone(DEFAULTS.display));
        Object.assign(RATING_PRIORITY, deepClone(DEFAULTS.priorities));
        savePrefs({});
        render();
        updateLivePreview();
        if (window.MDBL_API?.refresh) window.MDBL_API.refresh();
    });

    // Save Action
    panel.querySelector('#mdbl-btn-save').addEventListener('click', () => {
        const prefs = { sources: {}, display: {}, priorities: {} };
        [...panel.querySelectorAll('#mdbl-sources .mdbl-source')].forEach((el, i) => { prefs.priorities[el.dataset.k] = i + 1; });
        panel.querySelectorAll('#mdbl-sources input[type="checkbox"][data-toggle]').forEach(cb => { prefs.sources[cb.dataset.toggle] = cb.checked; });

        prefs.display.colorNumbers = panel.querySelector('#d_colorNumbers').checked;
        prefs.display.colorIcons = panel.querySelector('#d_colorIcons').checked;
        prefs.display.showPercentSymbol = panel.querySelector('#d_showPercent').checked;

        prefs.display.posX = parseInt(panel.querySelector('#d_posX').value || '0', 10);
        prefs.display.posY = parseInt(panel.querySelector('#d_posY').value || '0', 10);

        let _r = parseInt(panel.querySelector('#th_red')?.value || '50', 10);
        let _o = parseInt(panel.querySelector('#th_orange')?.value || '69', 10);
        let _y = parseInt(panel.querySelector('#th_yg')?.value || '79', 10);
        if (!isFinite(_r)) _r = 50; if (!isFinite(_o)) _o = 69; if (!isFinite(_y)) _y = 79;
        _r = Math.max(0, Math.min(100, _r));
        _o = Math.max(0, Math.min(100, _o));
        _y = Math.max(0, Math.min(100, _y));
        if (!(_r < _o && _o < _y)) { _o = Math.max(_r + 1, _o); _y = Math.max(_o + 1, _y); _y = Math.min(100, _y); }
        prefs.display.colorBands = { redMax: _r, orangeMax: _o, ygMax: _y };
        
        prefs.display.colorChoice = {
            red: +(panel.querySelector('#col_red')?.value || 0),
            orange: +(panel.querySelector('#col_orange')?.value || 0),
            yg: +(panel.querySelector('#col_yg')?.value || 0),
            mg: +(panel.querySelector('#col_mg')?.value || 0)
        };
        
        if(typeof loadPrefs().display?.compactLevel !== 'undefined') prefs.display.compactLevel = loadPrefs().display.compactLevel;

        savePrefs(prefs); applyPrefs(prefs);
        const keyInput = panel.querySelector('#mdbl-key-mdb');
        if (keyInput && !getInjectorKey()) setStoredKey((keyInput.value || '').trim());
        
        location.reload();
    });
})();
