// ==UserScript==
// @name         Jellyfin Ratings (v9.6.0 — Stateless Scan & Layout)
// @namespace    https://mdblist.com
// @version      9.6.0
// @description  Fixes navigation loading by removing 'processed' flags and checking live DOM state. Compact Header.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

console.log('[Jellyfin Ratings] v9.6.0 loading...');

/* ==========================================================================
   1. CONFIGURATION & CONSTANTS
========================================================================== */

const NS = 'mdbl_';

const DEFAULTS = {
    sources: {
        imdb: true, tmdb: true, trakt: true, letterboxd: true,
        rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
        metacritic_critic: true, metacritic_user: true,
        roger_ebert: true, anilist: true, myanimelist: true
    },
    display: {
        showPercentSymbol: true,
        colorNumbers: true,
        colorIcons: false,
        posX: 0,
        posY: 0,
        colorBands: { redMax: 50, orangeMax: 69, ygMax: 79 },
        colorChoice: { red: 0, orange: 2, yg: 3, mg: 0 },
        compactLevel: 0,
        endsAt24h: true
    },
    spacing: { ratingsTopGapPx: 4 },
    priorities: {
        imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
        rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
        roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
        anilist: 10, myanimelist: 11
    }
};

const SCALE = {
    imdb: 10, tmdb: 1, trakt: 1, letterboxd: 20, roger_ebert: 25,
    metacritic_critic: 1, metacritic_user: 10, myanimelist: 10, anilist: 1,
    rotten_tomatoes_critic: 1, rotten_tomatoes_audience: 1
};

const SWATCHES = {
    red:    ['#e53935', '#f44336', '#d32f2f', '#c62828'],
    orange: ['#fb8c00', '#f39c12', '#ffa726', '#ef6c00'],
    yg:     ['#9ccc65', '#c0ca33', '#aeea00', '#cddc39'],
    mg:     ['#43a047', '#66bb6a', '#388e3c', '#81c784']
};

const PALETTE_NAMES = {
    red:    ['Alert Red', 'Tomato', 'Crimson', 'Deep Red'],
    orange: ['Amber', 'Signal Orange', 'Apricot', 'Burnt Orange'],
    yg:     ['Lime Leaf', 'Citrus', 'Chartreuse', 'Soft Lime'],
    mg:     ['Emerald', 'Leaf Green', 'Forest', 'Mint']
};

const CACHE_DURATION_API = 24 * 60 * 60 * 1000;
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';

const LOGO = {
    imdb: `${ICON_BASE}/IMDb.png`,
    tmdb: `${ICON_BASE}/TMDB.png`,
    trakt: `${ICON_BASE}/Trakt.png`,
    letterboxd: `${ICON_BASE}/letterboxd.png`,
    anilist: `${ICON_BASE}/anilist.png`,
    myanimelist: `${ICON_BASE}/mal.png`,
    roger_ebert: `${ICON_BASE}/Roger_Ebert.png`,
    rotten_tomatoes_critic: `${ICON_BASE}/Rotten_Tomatoes.png`,
    rotten_tomatoes_audience: `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
    metacritic_critic: `${ICON_BASE}/Metacritic.png`,
    metacritic_user: `${ICON_BASE}/mus2.png`
};

const LABEL = {
    imdb: 'IMDb', tmdb: 'TMDb', trakt: 'Trakt', letterboxd: 'Letterboxd',
    rotten_tomatoes_critic: 'Rotten Tomatoes (Critic)', rotten_tomatoes_audience: 'Rotten Tomatoes (Audience)',
    metacritic_critic: 'Metacritic (Critic)', metacritic_user: 'Metacritic (User)',
    roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MyAnimeList'
};

let CFG = loadConfig();
let currentImdbId = null;
let lastPath = window.location.pathname;

function loadConfig() {
    try {
        const raw = localStorage.getItem(`${NS}prefs`);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
        const p = JSON.parse(raw);
        if (p.display && (isNaN(parseInt(p.display.posX)) || isNaN(parseInt(p.display.posY)))) {
            p.display.posX = 0; p.display.posY = 0;
        }
        return {
            sources: { ...DEFAULTS.sources, ...p.sources },
            display: { ...DEFAULTS.display, ...p.display, colorBands: { ...DEFAULTS.display.colorBands, ...p.display?.colorBands }, colorChoice: { ...DEFAULTS.display.colorChoice, ...p.display?.colorChoice } },
            spacing: { ...DEFAULTS.spacing, ...p.spacing },
            priorities: { ...DEFAULTS.priorities, ...p.priorities }
        };
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function saveConfig() {
    try { localStorage.setItem(`${NS}prefs`, JSON.stringify(CFG)); } catch (e) {}
}

const INJ_KEYS = (window.MDBL_KEYS || {});
const LS_KEYS = JSON.parse(localStorage.getItem(`${NS}keys`) || '{}');
const API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || 'hehfnbo9y8blfyqm1d37ikubl');

/* ==========================================================================
   2. UTILITIES & STYLES
========================================================================== */

if (typeof GM_xmlhttpRequest === 'undefined') {
    const PROXIES = ['https://api.allorigins.win/raw?url=', 'https://api.codetabs.com/v1/proxy?quest='];
    window.GM_xmlhttpRequest = ({ method = 'GET', url, onload, onerror }) => {
        const useProxy = !url.includes('mdblist.com') && !url.includes('graphql.anilist.co');
        const finalUrl = useProxy ? PROXIES[Math.floor(Math.random() * PROXIES.length)] + encodeURIComponent(url) : url;
        fetch(finalUrl).then(r => r.text().then(t => onload && onload({ status: r.status, responseText: t }))).catch(e => onerror && onerror(e));
    };
}

const localSlug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const styleEl = document.createElement('style');
styleEl.id = 'mdbl-dynamic-styles';
document.head.appendChild(styleEl);

function updateGlobalStyles() {
    document.documentElement.style.setProperty('--mdbl-x', `${CFG.display.posX}px`);
    document.documentElement.style.setProperty('--mdbl-y', `${CFG.display.posY}px`);

    let rules = `
        .mdblist-rating-container {
            display: flex; flex-wrap: wrap; align-items: center;
            justify-content: flex-end; 
            width: 100%; margin-top: ${CFG.spacing.ratingsTopGapPx}px;
            box-sizing: border-box;
            transform: translate(var(--mdbl-x), var(--mdbl-y));
            z-index: 99999; position: relative; pointer-events: auto; flex-shrink: 0;
        }
        .mdbl-rating-item {
            display: inline-flex; align-items: center; margin: 0 6px; gap: 6px;
            text-decoration: none;
            transition: transform 0.2s ease;
            cursor: pointer;
            color: inherit;
        }
        .mdbl-rating-item:hover {
            transform: scale(1.15) rotate(2deg);
            z-index: 1000;
        }
        .mdbl-rating-item img { height: 1.3em; vertical-align: middle; transition: filter 0.2s; }
        .mdbl-rating-item span { font-size: 1em; vertical-align: middle; transition: color 0.2s; }
        .itemMiscInfo, .mainDetailRibbon, .detailRibbon { overflow: visible !important; contain: none !important; }
        
        /* Ends At & Settings Icon */
        #customEndsAt { 
            font-size: inherit; opacity: 0.7; cursor: pointer; 
            margin-left: 10px; display: inline; vertical-align: baseline;
        }
        #customEndsAt:hover { opacity: 1.0; text-decoration: underline; }
        
        #mdbl-settings-trigger {
            display: inline-flex; align-items: center; justify-content: center;
            margin-left: 6px; cursor: pointer; opacity: 0.6; transition: opacity 0.2s, transform 0.2s;
            width: 1.1em; height: 1.1em; vertical-align: middle;
        }
        #mdbl-settings-trigger:hover { opacity: 1; transform: rotate(45deg); }
        #mdbl-settings-trigger svg { width: 100%; height: 100%; fill: currentColor; }
    `;

    Object.keys(CFG.priorities).forEach(key => {
        const isEnabled = CFG.sources[key];
        const order = CFG.priorities[key] || 999;
        rules += `
            .mdbl-rating-item[data-source="${key}"] {
                display: ${isEnabled ? 'inline-flex' : 'none'};
                order: ${order};
            }
        `;
    });
    styleEl.textContent = rules;
}

function getRatingColor(bands, choice, r) {
    bands = bands || { redMax: 50, orangeMax: 69, ygMax: 79 };
    choice = choice || { red: 0, orange: 0, yg: 0, mg: 0 };
    let band = 'mg';
    if (r <= bands.redMax) band = 'red';
    else if (r <= bands.orangeMax) band = 'orange';
    else if (r <= bands.ygMax) band = 'yg';
    const idx = Math.max(0, Math.min(3, choice[band] || 0));
    return SWATCHES[band][idx];
}

function refreshDomElements() {
    updateGlobalStyles(); 
    document.querySelectorAll('.mdbl-rating-item').forEach(el => {
        const score = parseFloat(el.dataset.score);
        if (isNaN(score)) return;
        const color = getRatingColor(CFG.display.colorBands, CFG.display.colorChoice, score);
        const img = el.querySelector('img');
        const span = el.querySelector('span');
        if (CFG.display.colorIcons) img.style.filter = `drop-shadow(0 0 3px ${color})`;
        else img.style.filter = '';
        if (CFG.display.colorNumbers) span.style.color = color;
        else span.style.color = '';
        const text = CFG.display.showPercentSymbol ? `${Math.round(score)}%` : `${Math.round(score)}`;
        if (span.textContent !== text) span.textContent = text;
    });
    updateEndsAt();
}

updateGlobalStyles();

/* ==========================================================================
   3. MAIN LOGIC
========================================================================== */

function fixUrl(url, domain) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const clean = url.startsWith('/') ? url.substring(1) : url;
    return `https://${domain}/${clean}`;
}

document.addEventListener('click', (e) => {
    if (e.target.id === 'customEndsAt' || e.target.closest('#mdbl-settings-trigger')) {
        e.preventDefault(); e.stopPropagation();
        if(window.MDBL_OPEN_SETTINGS) {
             window.MDBL_OPEN_SETTINGS();
        } else {
             initMenu();
             if(window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS();
        }
    }
}, true);

function formatTime(minutes) {
    const d = new Date(Date.now() + minutes * 60000);
    const opts = CFG.display.endsAt24h 
        ? { hour: '2-digit', minute: '2-digit', hour12: false } 
        : { hour: 'numeric', minute: '2-digit', hour12: true };
    return d.toLocaleTimeString([], opts);
}

function parseRuntimeToMinutes(text) {
    if (!text) return 0;
    let m = text.match(/(?:(\d+)\s*(?:h|hr|std?)\w*\s*)?(?:(\d+)\s*(?:m|min)\w*)?/i);
    if (m && (m[1] || m[2])) {
        const h = parseInt(m[1] || '0', 10);
        const min = parseInt(m[2] || '0', 10);
        if (h > 0 || min > 0) return h * 60 + min;
    }
    m = text.match(/(\d+)\s*(?:m|min)\w*/i);
    if (m) return parseInt(m[1], 10);
    return 0;
}

function updateEndsAt() {
    document.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo span, .itemMiscInfo div').forEach(el => {
        if (el.id === 'customEndsAt' || el.id === 'mdbl-settings-trigger' || el.closest('.mdblist-rating-container')) return;
        const t = (el.textContent || '').toLowerCase();
        if (t.includes('ends at') || t.includes('endet um') || t.includes('endet am') || (t.includes('%') && (t.includes('tomato') || el.querySelector('img[src*="tomato"]')))) {
             el.style.display = 'none';
        }
    });
    document.querySelectorAll('.mediaInfoCriticRating, .mediaInfoAudienceRating, .starRatingContainer').forEach(el => el.style.display = 'none');

    const primary = document.querySelector('.itemMiscInfo.itemMiscInfo-primary') || document.querySelector('.itemMiscInfo');
    if (!primary) return;

    let minutes = 0;
    for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')) {
        const parsed = parseRuntimeToMinutes((el.textContent || '').trim());
        if (parsed > 0) { minutes = parsed; break; }
    }
    if (minutes === 0) minutes = parseRuntimeToMinutes((primary.textContent || '').trim());
    
    if (!minutes) {
        if (primary.querySelector('#customEndsAt')) primary.querySelector('#customEndsAt').remove();
        if (primary.querySelector('#mdbl-settings-trigger')) primary.querySelector('#mdbl-settings-trigger').remove();
        return;
    }

    const timeStr = formatTime(minutes);
    const content = `Ends at ${timeStr}`;

    let span = primary.querySelector('#customEndsAt');
    if (!span) {
        span = document.createElement('div');
        span.id = 'customEndsAt';
        span.title = 'Click to open Settings';
        const ref = primary.querySelector('.mediaInfoOfficialRating') || primary.lastElementChild;
        if(ref && ref.parentNode === primary) primary.insertBefore(span, ref.nextSibling);
        else primary.appendChild(span);
    }
    if (span.textContent !== content) span.textContent = content;

    let icon = primary.querySelector('#mdbl-settings-trigger');
    if (!icon) {
        icon = document.createElement('div');
        icon.id = 'mdbl-settings-trigger';
        icon.title = 'Settings';
        icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
        if (span.nextSibling) span.parentNode.insertBefore(icon, span.nextSibling);
        else span.parentNode.appendChild(icon);
    }
}

function createRatingHtml(key, val, link, count, title, kind) {
    if (val === null || isNaN(val)) return '';
    if (!LOGO[key]) return '';

    const n = parseFloat(val) * (SCALE[key] || 1);
    const r = Math.round(n);
    
    const tooltip = (count && count > 0) ? `${title} — ${count.toLocaleString()} ${kind||'Votes'}` : title;
    const safeLink = (link && link !== '#' && !link.startsWith('http://192')) ? link : '#';
    const style = safeLink === '#' ? 'cursor:default;' : '';
    
    return `
        <a href="${safeLink}" target="_blank" class="mdbl-rating-item" data-source="${key}" data-score="${r}" style="${style}" title="${tooltip}">
            <img src="${LOGO[key]}" alt="${title}">
            <span>${CFG.display.showPercentSymbol ? r+'%' : r}</span>
        </a>
    `;
}

function renderRatings(container, data, pageImdbId, type) {
    let html = '';
    const add = (k, v, lnk, cnt, tit, kind) => html += createRatingHtml(k, v, lnk, cnt, tit, kind);
    
    const ids = {
        imdb: data.imdbid || data.imdb_id || pageImdbId,
        tmdb: data.id || data.tmdbid || data.tmdb_id || container.dataset.tmdbId,
        trakt: data.traktid || data.trakt_id,
        slug: data.slug || data.ids?.slug
    };
    
    const traktType = type === 'show' ? 'shows' : 'movies';
    const metaType = type === 'show' ? 'tv' : 'movie';
    const fallbackSlug = localSlug(data.title || '');

    if (data.ratings) {
        data.ratings.forEach(r => {
            const s = (r.source || '').toLowerCase();
            const v = r.value;
            const c = r.votes || r.count;
            const apiLink = r.url; 

            if (s.includes('imdb')) {
                const lnk = ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : (apiLink && apiLink.startsWith('http') ? apiLink : null);
                add('imdb', v, lnk, c, 'IMDb', 'Votes');
            } 
            else if (s.includes('tmdb')) {
                const lnk = ids.tmdb ? `https://www.themoviedb.org/${type}/${ids.tmdb}` : '#';
                add('tmdb', v, lnk, c, 'TMDb', 'Votes');
            }
            else if (s.includes('trakt')) {
                const lnk = ids.imdb ? `https://trakt.tv/search/imdb/${ids.imdb}` : '#';
                add('trakt', v, lnk, c, 'Trakt', 'Votes');
            }
            else if (s.includes('letterboxd')) {
                const lnk = ids.imdb ? `https://letterboxd.com/imdb/${ids.imdb}/` : fixUrl(apiLink, 'letterboxd.com');
                add('letterboxd', v, lnk, c, 'Letterboxd', 'Votes');
            }
            else if (s === 'tomatoes' || s.includes('rotten_tomatoes')) {
                add('rotten_tomatoes_critic', v, fixUrl(apiLink, 'rottentomatoes.com'), c, 'RT Critic', 'Reviews');
            }
            else if (s.includes('popcorn') || s.includes('audience')) {
                add('rotten_tomatoes_audience', v, fixUrl(apiLink, 'rottentomatoes.com'), c, 'RT Audience', 'Ratings');
            }
            else if (s.includes('metacritic') && !s.includes('user')) {
                const lnk = fallbackSlug ? `https://www.metacritic.com/${metaType}/${fallbackSlug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(data.title||'')}/results`;
                add('metacritic_critic', v, lnk, c, 'Metacritic', 'Reviews');
            }
            else if (s.includes('metacritic') && s.includes('user')) {
                const lnk = fallbackSlug ? `https://www.metacritic.com/${metaType}/${fallbackSlug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(data.title||'')}/results`;
                add('metacritic_user', v, lnk, c, 'User', 'Ratings');
            }
            else if (s.includes('roger')) {
                add('roger_ebert', v, fixUrl(apiLink, 'rogerebert.com'), c, 'Roger Ebert', 'Reviews');
            }
            else if (s.includes('anilist')) {
                add('anilist', v, fixUrl(apiLink, 'anilist.co'), c, 'AniList', 'Votes');
            }
            else if (s.includes('myanimelist')) {
                add('myanimelist', v, fixUrl(apiLink, 'myanimelist.net'), c, 'MAL', 'Votes');
            }
        });
    }
    container.innerHTML = html;
    refreshDomElements();
}

function fetchRatings(container, tmdbId, type) {
    const cacheKey = `${NS}c_${tmdbId}`;
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const c = JSON.parse(cached);
            if (Date.now() - c.ts < CACHE_DURATION_API) {
                renderRatings(container, c.data, currentImdbId, type);
                return;
            }
        }
    } catch(e) {}

    GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${API_KEY}`,
        onload: r => {
            try {
                const d = JSON.parse(r.responseText);
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: d }));
                renderRatings(container, d, currentImdbId, type);
            } catch(e) {}
        }
    });
}

function scan() {
    // --- NAVIGATION GUARD (Aggressive Mode) ---
    // Reset everything if URL path changed since last check
    if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        currentImdbId = null; 
        document.querySelectorAll('.mdblist-rating-container').forEach(e => e.remove());
    }
    
    updateEndsAt();

    const imdbLink = document.querySelector('a[href*="imdb.com/title/"]');
    if (imdbLink) {
        const m = imdbLink.href.match(/tt\d+/);
        if (m) {
            if (m[0] !== currentImdbId) {
                currentImdbId = m[0];
                document.querySelectorAll('.mdblist-rating-container').forEach(e => e.remove());
            }
        }
    }

    // Use Stateless Check: Only inject if this specific ID is missing from wrapper
    [...document.querySelectorAll('a[href*="themoviedb.org/"]')].forEach(a => {
        const m = a.href.match(/\/(movie|tv)\/(\d+)/);
        if (m) {
            const type = m[1] === 'tv' ? 'show' : 'movie';
            const id = m[2];
            
            const wrapper = document.querySelector('.itemMiscInfo');
            if (wrapper) {
                // "Stateless" check: Does the wrapper already have a container for THIS id?
                // If not, or if it has a container for a WRONG id (recycled), fix it.
                const existing = wrapper.querySelector('.mdblist-rating-container');
                
                if (!existing || existing.dataset.tmdbId !== id) {
                    if(existing) existing.remove(); // Remove stale recycled container

                    const div = document.createElement('div');
                    div.className = 'mdblist-rating-container';
                    div.dataset.type = type;
                    div.dataset.tmdbId = id;
                    wrapper.appendChild(div);
                    fetchRatings(div, id, type);
                }
            }
        }
    });
}

setInterval(scan, 500);


/* ==========================================================================
   4. SETTINGS MENU (INIT)
========================================================================== */
let dragSrc = null;
let themeColor = '#2a6df4';

function getJellyfinColor() {
    const rootVar = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary-color').trim();
    if(rootVar) return rootVar;
    const btn = document.querySelector('.button-submit, .btnPlay, .main-button, .emby-button-foreground');
    if(btn) {
        const col = window.getComputedStyle(btn).backgroundColor;
        if(col && col !== 'rgba(0, 0, 0, 0)') return col;
    }
    return '#2a6df4';
}

function initMenu() {
    if(document.getElementById('mdbl-panel')) return;

    const css = `
    :root { --mdbl-right-col: 48px; --mdbl-right-col-wide: 200px; }
    #mdbl-panel { position:fixed; right:16px; bottom:70px; width:480px; max-height:90vh; overflow:auto; border-radius:14px;
        border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); backdrop-filter:blur(8px);
        color:#eaeaea; z-index:100000; box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; font-family: sans-serif; }
    #mdbl-panel header { position:sticky; top:0; background:rgba(22,22,26,0.98); padding:4px 16px; border-bottom:1px solid rgba(255,255,255,0.08);
        display:flex; align-items:center; gap:8px; cursor:move; z-index:999; backdrop-filter:blur(8px); font-weight: bold; justify-content: space-between; }
    #mdbl-close { 
        width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; 
        background: transparent; border: none; color: #aaa; font-size: 18px; cursor: pointer; 
        padding: 0; border-radius: 6px; 
    }
    #mdbl-close:hover { background:rgba(255,255,255,0.06); color:#fff; }
    #mdbl-panel .mdbl-section { padding:12px 16px; display:flex; flex-direction:column; gap:10px; }
    #mdbl-panel .mdbl-subtle { color:#9aa0a6; font-size:12px; }
    
    #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { display:grid; grid-template-columns:1fr var(--mdbl-right-col); align-items:center; gap:10px; padding:8px 10px; border-radius:12px; }
    #mdbl-panel .mdbl-row { background:transparent; border:1px solid rgba(255,255,255,0.06); min-height: 48px; box-sizing:border-box; }
    #mdbl-panel .mdbl-row.wide { grid-template-columns:1fr var(--mdbl-right-col-wide); }
    
    /* Theme Sync */
    #mdbl-panel input[type="checkbox"] { 
        transform: scale(1.2); cursor: pointer; 
        accent-color: var(--mdbl-theme); 
    }
    #mdbl-panel input[type="range"] { flex: 1; margin: 0 12px; cursor: pointer; accent-color: var(--mdbl-theme); }
    
    #mdbl-panel input[type="text"] { width:100%; padding:10px 0; border:0; background:transparent; color:#eaeaea; font-size:14px; outline:none; }
    
    #mdbl-panel select, #mdbl-panel input.mdbl-pos-input, #mdbl-panel input.mdbl-num-input {
        padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#121317; color:#eaeaea;
        height:32px; line-height: 32px; box-sizing:border-box; display:inline-block; color-scheme: dark;
    }
    #mdbl-panel .mdbl-select { width:140px; justify-self:end; }
    #mdbl-panel input.mdbl-pos-input { width: 75px; text-align: center; font-size: 14px; }
    #mdbl-panel input.mdbl-num-input { width: 60px; text-align: center; }

    #mdbl-panel .mdbl-actions { position:sticky; bottom:0; background:rgba(22,22,26,0.96); display:flex; gap:10px; padding:12px 16px; border-top:1px solid rgba(255,255,255,0.08); }
    #mdbl-panel button { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#1b1c20; color:#eaeaea; cursor:pointer; }
    
    /* Force Theme Color */
    #mdbl-panel button.primary { 
        background-color: var(--mdbl-theme) !important; 
        border-color: var(--mdbl-theme) !important; 
        color: #fff; 
    }
    
    #mdbl-sources { display:flex; flex-direction:column; gap:8px; }
    .mdbl-source { background:#0f1115; border:1px solid rgba(255,255,255,0.1); cursor: grab; }
    .mdbl-src-left { display:flex; align-items:center; gap:10px; }
    .mdbl-src-left img { height:18px; width:auto; }
    .mdbl-src-left .name { font-size:13px; }
    .mdbl-drag-handle { justify-self:start; opacity:0.6; cursor:grab; }
    #mdbl-key-box { background:#0f1115; border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:12px; }
    
    .mdbl-grid { display:grid; grid-template-columns:1fr; gap:10px; }
    .mdbl-grid .grid-row { display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:12px; }
    .grid-right { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
    .mdbl-grid label { white-space: nowrap; }
    .sw { display:inline-block; width:18px; height:18px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); }
    
    #mdbl-panel hr { border:0; border-top:1px solid rgba(255,255,255,0.08); margin:10px 0; }
    #mdbl-panel .mdbl-actions { display:flex; align-items:center; gap:8px; }
    #mdbl-panel .mdbl-actions .mdbl-grow { flex:1; }
    #mdbl-panel .mdbl-actions .mdbl-compact { display:inline-flex; align-items:center; gap:6px; opacity:0.95; }
    
    #mdbl-panel[data-compact="1"] { --mdbl-right-col:44px; --mdbl-right-col-wide:220px; width:460px; }
    #mdbl-panel[data-compact="1"] header { padding:6px 12px; }
    #mdbl-panel[data-compact="1"] .mdbl-section { padding:2px 12px; gap:2px; }
    #mdbl-panel[data-compact="1"] .mdbl-row, #mdbl-panel[data-compact="1"] .mdbl-source { gap:5px; padding:2px 6px; border-radius:6px; min-height: 32px; }
    #mdbl-panel[data-compact="1"] .mdbl-actions { padding:6px 10px; }
    #mdbl-panel[data-compact="1"] .mdbl-src-left img { height:16px; }
    #mdbl-panel[data-compact="1"] select, #mdbl-panel[data-compact="1"] input.mdbl-pos-input, #mdbl-panel[data-compact="1"] input.mdbl-num-input { height: 28px; font-size: 12px; line-height: 28px; }
    #mdbl-panel[data-compact="1"] .mdbl-select { width: 140px; }
    #mdbl-panel[data-compact="1"] hr { margin: 4px 0; }

    @media (max-width: 600px) {
        #mdbl-panel, #mdbl-panel[data-compact="1"] {
            width: 96% !important; left: 2% !important; right: 2% !important; bottom: 10px !important; top: auto !important;
            transform: none !important; max-height: 80vh;
            --mdbl-right-col: 40px; --mdbl-right-col-wide: 140px;
        }
        #mdbl-panel header { cursor: default; }
        #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { min-height: 42px; padding: 4px 8px; }
        #mdbl-panel .mdbl-select { width: 140px; }
    }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'mdbl-panel';
    document.body.appendChild(panel);

    window.MDBL_OPEN_SETTINGS = () => {
        const col = getJellyfinColor();
        panel.style.setProperty('--mdbl-theme', col);
        renderMenuContent(panel);
        panel.style.display = 'block';
    };

    let isDrag = false, sx, sy, lx, ly;
    panel.addEventListener('mousedown', (e) => {
        if (window.innerWidth <= 600 || ['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) return;
        if (e.target.closest('.sec') || e.target.closest('.mdbl-section')) return; 
        isDrag = true; const r = panel.getBoundingClientRect();
        lx = r.left; ly = r.top; sx = e.clientX; sy = e.clientY;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
        panel.style.left = lx + 'px'; panel.style.top = ly + 'px';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDrag) return;
        panel.style.left = (lx + (e.clientX - sx)) + 'px';
        panel.style.top = (ly + (e.clientY - sy)) + 'px';
    });
    document.addEventListener('mouseup', () => isDrag = false);
    
    // Fix: Close on click outside
    document.addEventListener('mousedown', (e) => {
        if (panel.style.display === 'block' && !panel.contains(e.target) && e.target.id !== 'customEndsAt' && !e.target.closest('#mdbl-settings-trigger')) {
            panel.style.display = 'none';
        }
    });
    
    if(loadConfig().display.compactLevel) panel.setAttribute('data-compact', '1');
}

initMenu();

function renderMenuContent(panel) {
    const row = (label, input, wide) => `<div class="mdbl-row ${wide?'wide':''}"><span>${label}</span>${input}</div>`;
    
    let html = `
    <header>
      <h3>Settings</h3>
      <button id="mdbl-close">✕</button>
    </header>
    <div class="mdbl-section" id="mdbl-sec-keys">
       ${(!INJ_KEYS.MDBLIST && !JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST) ? `<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value="${(JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST)||''}"></div>` : ''}
    </div>
    <div class="mdbl-section" style="padding-top:24px">
       <div class="mdbl-subtle">Sources (drag to reorder)</div>
       <div id="mdbl-sources"></div>
       <hr style="border:0;border-top:1px solid rgba(255,255,255,0.08);margin:12px 0">
    </div>
    <div class="mdbl-section" id="mdbl-sec-display">
        <div class="mdbl-subtle">Display</div>
        ${row('Color numbers', `<input type="checkbox" id="d_cnum" ${CFG.display.colorNumbers?'checked':''}>`)}
        ${row('Color icons', `<input type="checkbox" id="d_cicon" ${CFG.display.colorIcons?'checked':''}>`)}
        ${row('Show %', `<input type="checkbox" id="d_pct" ${CFG.display.showPercentSymbol?'checked':''}>`)}
        ${row('Enable 24h format', `<input type="checkbox" id="d_24h" ${CFG.display.endsAt24h?'checked':''}>`)}
        
        <div class="mdbl-row wide">
            <span>Position X (px)</span>
            <div class="grid-right" style="flex:1; display:flex; justify-content:flex-end; align-items:center; gap:8px;">
            <input type="range" id="d_x_rng" min="-1000" max="1000" value="${CFG.display.posX}">
            <input type="number" id="d_x_num" value="${CFG.display.posX}" class="mdbl-pos-input">
            </div>
        </div>
        <div class="mdbl-row wide">
            <span>Position Y (px)</span>
            <div class="grid-right" style="flex:1; display:flex; justify-content:flex-end; align-items:center; gap:8px;">
            <input type="range" id="d_y_rng" min="-1000" max="1000" value="${CFG.display.posY}">
            <input type="number" id="d_y_num" value="${CFG.display.posY}" class="mdbl-pos-input">
            </div>
        </div>

        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.08);margin:12px 0">
        
        <div class="mdbl-subtle">Color bands &amp; palette</div>
        <div class="mdbl-grid">
            ${createColorBandRow('th_red', 'Rating', CFG.display.colorBands.redMax, 'red')}
            ${createColorBandRow('th_orange', 'Rating', CFG.display.colorBands.orangeMax, 'orange')}
            ${createColorBandRow('th_yg', 'Rating', CFG.display.colorBands.ygMax, 'yg')}
            <div class="grid-row">
                <label id="label_top_tier">Top tier (≥ ${CFG.display.colorBands.ygMax+1}%)</label>
                <div class="grid-right">
                    <span class="sw" id="sw_mg" style="background:${SWATCHES.mg[CFG.display.colorChoice.mg]}"></span>
                    <select id="col_mg" class="mdbl-select">${PALETTE_NAMES.mg.map((n,i)=>`<option value="${i}" ${CFG.display.colorChoice.mg===i?'selected':''}>${n}</option>`).join('')}</select>
                </div>
            </div>
        </div>
    </div>
    <div class="mdbl-actions" style="padding-bottom:16px; padding-top:24px">
      <button id="mdbl-btn-reset">Reset</button>
      <button id="mdbl-btn-save" class="primary">Save & Apply</button>
      <div class="mdbl-grow"></div>
      <label class="mdbl-compact" for="mdbl-compact-toggle">
        <span>Compact</span>
        <input type="checkbox" id="mdbl-compact-toggle" ${CFG.display.compactLevel?'checked':''}>
      </label>
    </div>
    `;
    
    panel.innerHTML = html;
    
    const sList = panel.querySelector('#mdbl-sources');
    Object.keys(CFG.priorities).sort((a,b) => CFG.priorities[a]-CFG.priorities[b]).forEach(k => {
         if (!CFG.sources.hasOwnProperty(k)) return;
         const div = document.createElement('div');
         div.className = 'mdbl-source mdbl-src-row';
         div.draggable = true;
         div.dataset.key = k;
         div.innerHTML = `
            <div class="mdbl-src-left">
                <span class="mdbl-drag-handle">⋮⋮</span>
                <img src="${LOGO[k]||''}" style="height:18px">
                <span class="name" style="font-size:13px;margin-left:8px">${LABEL[k]}</span>
            </div>
            <input type="checkbox" class="src-check" ${CFG.sources[k]?'checked':''}>
         `;
         sList.appendChild(div);
    });

    panel.querySelector('#mdbl-close').onclick = () => panel.style.display = 'none';
    
    const updateLiveAll = () => {
        CFG.display.colorNumbers = panel.querySelector('#d_cnum').checked;
        CFG.display.colorIcons = panel.querySelector('#d_cicon').checked;
        CFG.display.showPercentSymbol = panel.querySelector('#d_pct').checked;
        CFG.display.endsAt24h = panel.querySelector('#d_24h').checked; // Live Update 24h
        
        CFG.display.colorBands.redMax = parseInt(panel.querySelector('#th_red').value)||50;
        CFG.display.colorBands.orangeMax = parseInt(panel.querySelector('#th_orange').value)||69;
        CFG.display.colorBands.ygMax = parseInt(panel.querySelector('#th_yg').value)||79;
        
        ['red','orange','yg','mg'].forEach(k => CFG.display.colorChoice[k] = parseInt(panel.querySelector(`#col_${k}`).value)||0);
        
        panel.querySelector('#label_top_tier').textContent = `Top tier (≥ ${CFG.display.colorBands.ygMax+1}%)`;
        ['red','orange','yg','mg'].forEach(k => panel.querySelector(`#sw_${k}`).style.background = SWATCHES[k][CFG.display.colorChoice[k]]);
        
        refreshDomElements();
    };
    panel.querySelectorAll('input, select').forEach(el => {
        if(el.type === 'range' || el.type === 'text' || el.type === 'number') el.addEventListener('input', updateLiveAll);
        else el.addEventListener('change', updateLiveAll);
    });

    const updatePos = (axis, val) => {
        CFG.display[axis] = parseInt(val);
        panel.querySelector(`#d_${axis === 'posX' ? 'x' : 'y'}_rng`).value = val;
        panel.querySelector(`#d_${axis === 'posX' ? 'x' : 'y'}_num`).value = val;
        updateGlobalStyles();
    };
    const bindPos = (id, fn) => panel.querySelector(id).addEventListener('input', fn);
    bindPos('#d_x_rng', (e) => updatePos('posX', e.target.value));
    bindPos('#d_x_num', (e) => updatePos('posX', e.target.value));
    bindPos('#d_y_rng', (e) => updatePos('posY', e.target.value));
    bindPos('#d_y_num', (e) => updatePos('posY', e.target.value));
    
    panel.querySelectorAll('.src-check').forEach(cb => {
        cb.addEventListener('change', (e) => {
            CFG.sources[e.target.closest('.mdbl-source').dataset.key] = e.target.checked;
            updateGlobalStyles();
        });
    });

    panel.querySelector('#mdbl-compact-toggle').addEventListener('change', (e) => {
        panel.setAttribute('data-compact', e.target.checked ? '1':'0');
    });

    let dragSrc = null;
    panel.querySelectorAll('.mdbl-src-row').forEach(row => {
        row.addEventListener('dragstart', e => { dragSrc = row; e.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragover', e => { 
            e.preventDefault(); 
            if (dragSrc && dragSrc !== row) {
                const list = row.parentNode;
                const all = [...list.children];
                const srcI = all.indexOf(dragSrc);
                const tgtI = all.indexOf(row);
                if (srcI < tgtI) list.insertBefore(dragSrc, row.nextSibling);
                else list.insertBefore(dragSrc, row);
                
                [...list.querySelectorAll('.mdbl-src-row')].forEach((r, i) => CFG.priorities[r.dataset.key] = i+1);
                updateGlobalStyles();
            }
        });
    });

    panel.querySelector('#mdbl-btn-save').onclick = () => {
        CFG.display.compactLevel = panel.querySelector('#mdbl-compact-toggle').checked ? 1 : 0;
        saveConfig();
        const ki = panel.querySelector('#mdbl-key-mdb');
        if(ki && ki.value.trim()) localStorage.setItem('mdbl_keys', JSON.stringify({MDBLIST: ki.value.trim()}));
        location.reload();
    };
    panel.querySelector('#mdbl-btn-reset').onclick = () => {
        if(confirm('Reset all settings?')) { localStorage.removeItem('mdbl_prefs'); location.reload(); }
    };
    
    const getInjectorKey = () => { try { return (window.MDBL_KEYS && window.MDBL_KEYS.MDBLIST) ? String(window.MDBL_KEYS.MDBLIST) : ''; } catch { return ''; } };
    if (getInjectorKey()) {
       const kw = panel.querySelector('#mdbl-sec-keys');
       if(kw) { kw.innerHTML = ''; kw.style.display = 'none'; }
    }
}

function createColorBandRow(id, lbl, val, key) {
    const opts = PALETTE_NAMES[key].map((n,i) => `<option value="${i}" ${CFG.display.colorChoice[key]===i?'selected':''}>${n}</option>`).join('');
    return `<div class="grid-row">
        <label>${lbl} ≤ <input type="number" id="${id}" value="${val}" class="mdbl-num-input"> %</label>
        <div class="grid-right">
            <span class="sw" id="sw_${key}" style="background:${SWATCHES[key][CFG.display.colorChoice[key]]}"></span>
            <select id="col_${key}" class="mdbl-select">${opts}</select>
        </div>
    </div>`;
}
