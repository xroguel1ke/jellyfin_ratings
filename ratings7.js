// ==UserScript==
// @name         Jellyfin Ratings (v10.1.24 — Brute Force Hunter)
// @namespace    https://mdblist.com
// @version      10.1.24
// @description  Master Rating links to Wikipedia via DuckDuckGo "!ducky". Gear icon first. Hides default Jellyfin ratings. Aggressively scans for IDs.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

console.log('[Jellyfin Ratings] v10.1.24 loading...');

/* ==========================================================================
   1. CONFIGURATION & CONSTANTS
========================================================================== */

const NS = 'mdbl_';

const DEFAULTS = {
    sources: {
        master: true,
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
        endsAt24h: true
    },
    spacing: { ratingsTopGapPx: 4 },
    priorities: {
        master: -1, 
        imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
        rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
        roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
        anilist: 10, myanimelist: 11
    }
};

const SCALE = {
    master: 1,
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
    master: `${ICON_BASE}/master.png`,
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
    master: 'Master Rating',
    imdb: 'IMDb', tmdb: 'TMDb', trakt: 'Trakt', letterboxd: 'Letterboxd',
    rotten_tomatoes_critic: 'Rotten Tomatoes (Critic)', rotten_tomatoes_audience: 'Rotten Tomatoes (Audience)',
    metacritic_critic: 'Metacritic (Critic)', metacritic_user: 'Metacritic (User)',
    roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MyAnimeList'
};

let CFG = loadConfig();
let currentImdbId = null;

function loadConfig() {
    try {
        const raw = localStorage.getItem(`${NS}prefs`);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
        const p = JSON.parse(raw);
        if (p.display && (isNaN(parseInt(p.display.posX)) || isNaN(parseInt(p.display.posY)))) {
            p.display.posX = 0; p.display.posY = 0;
        }
        if (p.display.posX > 500) p.display.posX = 500;
        if (p.display.posX < -700) p.display.posX = -700;
        if (p.display.posY > 500) p.display.posY = 500;
        if (p.display.posY < -500) p.display.posY = -500;
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
        /* Main Container */
        .mdblist-rating-container {
            display: flex; flex-wrap: wrap; align-items: center;
            justify-content: flex-end; 
            width: 100%; margin-top: ${CFG.spacing.ratingsTopGapPx}px;
            box-sizing: border-box;
            transform: translate(var(--mdbl-x), var(--mdbl-y));
            z-index: 2147483647; position: relative; 
            pointer-events: auto !important; 
            flex-shrink: 0;
            min-height: 24px;
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
            z-index: 2147483647;
        }
        .mdbl-rating-item img { height: 1.3em; vertical-align: middle; transition: filter 0.2s; }
        .mdbl-rating-item span { font-size: 1em; vertical-align: middle; transition: color 0.2s; }
        
        /* Settings Button - Forced first via order */
        .mdbl-settings-btn {
            opacity: 0.6; margin-right: 8px; border-right: 1px solid rgba(255,255,255,0.2); 
            padding: 4px 8px 4px 0;
            cursor: pointer !important; pointer-events: auto !important;
            order: -9999 !important; 
            display: inline-flex;
        }
        .mdbl-settings-btn:hover { opacity: 1; transform: scale(1.1); }
        .mdbl-settings-btn svg { width: 1.2em; height: 1.2em; fill: currentColor; pointer-events: none; }
        
        /* Scan Indicator */
        .mdbl-scan-dot {
            animation: mdbl-blink 1s infinite;
            font-size: 18px;
            line-height: 10px;
            opacity: 0.5;
            margin-right: 5px;
        }
        @keyframes mdbl-blink { 0% {opacity:0.2} 50% {opacity:0.8} 100% {opacity:0.2} }

        .itemMiscInfo, .mainDetailRibbon, .detailRibbon { 
            overflow: visible !important; contain: none !important; position: relative; z-index: 10; 
        }
        
        #customEndsAt { 
            font-size: inherit; opacity: 0.9; cursor: default; 
            margin-left: 10px; display: inline-block; vertical-align: baseline;
            pointer-events: auto; position: relative; z-index: 9999;
            padding: 2px 4px;
        }

        .mediaInfoOfficialRating {
            display: inline-flex !important;
            margin-right: 14px;
        }

        .starRatingContainer, 
        .mediaInfoCriticRating, 
        .mediaInfoAudienceRating,
        .starRating {
            display: none !important;
        }
    `;

    Object.keys(CFG.priorities).forEach(key => {
        const isEnabled = CFG.sources[key];
        const order = CFG.priorities[key];
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
    document.querySelectorAll('.mdbl-rating-item:not(.mdbl-settings-btn)').forEach(el => {
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

function openSettingsMenu() {
    if (window.MDBL_OPEN_SETTINGS) {
        window.MDBL_OPEN_SETTINGS();
    } else {
        initMenu();
        if (window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS();
    }
}

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
    const allWrappers = document.querySelectorAll('.itemMiscInfo');
    let primary = null;
    for (const el of allWrappers) {
        if (el.offsetParent !== null) { 
            primary = el;
            break;
        }
    }
    
    if (!primary) return; 

    let minutes = 0;
    const detailContainer = primary.closest('.detailRibbon') || primary.closest('.mainDetailButtons') || primary.parentNode;
    
    if (detailContainer) {
        const walker = document.createTreeWalker(detailContainer, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            const val = node.nodeValue.trim();
            if (val.length > 0 && val.length < 20 && /\d/.test(val)) {
                const p = parseRuntimeToMinutes(val);
                if (p > 0) { minutes = p; break; }
            }
        }
    }
    
    const parent = primary.parentNode;
    if (parent) {
        parent.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo span, .itemMiscInfo div').forEach(el => {
            if (el.id === 'customEndsAt') return;
            if (el.classList.contains('mdblist-rating-container') || el.closest('.mdblist-rating-container')) return;
            if (el.classList.contains('mediaInfoOfficialRating')) return;
            
            const t = (el.textContent || '').toLowerCase();
            if (t.includes('ends at') || t.includes('endet um') || t.includes('endet am')) {
                 if (minutes > 0) el.style.display = 'none';
                 else el.style.display = ''; 
            }
        });
    }

    document.querySelectorAll('.starRatingContainer, .mediaInfoCriticRating, .mediaInfoAudienceRating').forEach(el => el.style.display = 'none');

    if (minutes > 0) {
        const timeStr = formatTime(minutes);
        const content = `Ends at ${timeStr}`;

        let span = primary.querySelector('#customEndsAt');
        if (!span) {
            span = document.createElement('div');
            span.id = 'customEndsAt';
            span.title = 'Calculated finish time';
            const rc = primary.querySelector('.mdblist-rating-container');
            if (rc && rc.nextSibling) primary.insertBefore(span, rc.nextSibling);
            else primary.appendChild(span);
        }
        if (span.textContent !== content) span.textContent = content;
        span.style.display = ''; 
    } else {
        const span = primary.querySelector('#customEndsAt');
        if(span) span.remove();
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

function renderGearIcon(container) {
    if (container.querySelector('.mdbl-settings-btn')) return;
    container.innerHTML = `
    <div class="mdbl-rating-item mdbl-settings-btn" title="Settings" style="order: -9999 !important;" onclick="event.preventDefault(); event.stopPropagation(); window.MDBL_OPEN_SETTINGS_GL();">
       <svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
    </div>
    <span class="mdbl-scan-dot">...</span>
    `;
    updateGlobalStyles();
}

function renderRatings(container, data, pageImdbId, type) {
    let html = `
    <div class="mdbl-rating-item mdbl-settings-btn" title="Settings" style="order: -9999 !important;" onclick="event.preventDefault(); event.stopPropagation(); window.MDBL_OPEN_SETTINGS_GL();">
       <svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>
    </div>
    `;

    const add = (k, v, lnk, cnt, tit, kind) => html += createRatingHtml(k, v, lnk, cnt, tit, kind);
    
    const ids = {
        imdb: data.imdbid || data.imdb_id || pageImdbId,
        tmdb: data.id || data.tmdbid || data.tmdb_id || container.dataset.tmdbId,
        trakt: data.traktid || data.trakt_id,
        slug: data.slug || data.ids?.slug
    };
    
    const fallbackSlug = localSlug(data.title || '');
    const metaType = type === 'show' ? 'tv' : 'movie';

    let masterSum = 0;
    let masterCount = 0;
    const trackMaster = (val, scaleKey) => {
        if (val !== null && !isNaN(parseFloat(val))) {
            masterSum += parseFloat(val) * (SCALE[scaleKey] || 1);
            masterCount++;
        }
    };

    if (data.ratings) {
        data.ratings.forEach(r => {
            const s = (r.source || '').toLowerCase();
            const v = r.value;
            const c = r.votes || r.count;
            const apiLink = r.url; 

            if (s.includes('imdb')) {
                const lnk = ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : (apiLink && apiLink.startsWith('http') ? apiLink : null);
                add('imdb', v, lnk, c, 'IMDb', 'Votes');
                trackMaster(v, 'imdb');
            } 
            else if (s.includes('tmdb')) {
                const lnk = ids.tmdb ? `https://www.themoviedb.org/${type}/${ids.tmdb}` : '#';
                add('tmdb', v, lnk, c, 'TMDb', 'Votes');
                trackMaster(v, 'tmdb');
            }
            else if (s.includes('trakt')) {
                const lnk = ids.imdb ? `https://trakt.tv/search/imdb/${ids.imdb}` : '#';
                add('trakt', v, lnk, c, 'Trakt', 'Votes');
                trackMaster(v, 'trakt');
            }
            else if (s.includes('letterboxd')) {
                const lnk = ids.imdb ? `https://letterboxd.com/imdb/${ids.imdb}/` : fixUrl(apiLink, 'letterboxd.com');
                add('letterboxd', v, lnk, c, 'Letterboxd', 'Votes');
                trackMaster(v, 'letterboxd');
            }
            else if (s === 'tomatoes' || s.includes('rotten_tomatoes')) {
                add('rotten_tomatoes_critic', v, fixUrl(apiLink, 'rottentomatoes.com'), c, 'RT Critic', 'Reviews');
                trackMaster(v, 'rotten_tomatoes_critic');
            }
            else if (s.includes('popcorn') || s.includes('audience')) {
                add('rotten_tomatoes_audience', v, fixUrl(apiLink, 'rottentomatoes.com'), c, 'RT Audience', 'Ratings');
                trackMaster(v, 'rotten_tomatoes_audience');
            }
            else if (s.includes('metacritic') && !s.includes('user')) {
                const lnk = fallbackSlug ? `https://www.metacritic.com/${metaType}/${fallbackSlug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(data.title||'')}/results`;
                add('metacritic_critic', v, lnk, c, 'Metacritic', 'Reviews');
                trackMaster(v, 'metacritic_critic');
            }
            else if (s.includes('metacritic') && s.includes('user')) {
                const lnk = fallbackSlug ? `https://www.metacritic.com/${metaType}/${fallbackSlug}` : `https://www.metacritic.com/search/all/${encodeURIComponent(data.title||'')}/results`;
                add('metacritic_user', v, lnk, c, 'User', 'Ratings');
                trackMaster(v, 'metacritic_user');
            }
            else if (s.includes('roger')) {
                add('roger_ebert', v, fixUrl(apiLink, 'rogerebert.com'), c, 'Roger Ebert', 'Reviews');
                trackMaster(v, 'roger_ebert');
            }
            else if (s.includes('anilist')) {
                add('anilist', v, fixUrl(apiLink, 'anilist.co'), c, 'AniList', 'Votes');
                trackMaster(v, 'anilist');
            }
            else if (s.includes('myanimelist')) {
                add('myanimelist', v, fixUrl(apiLink, 'myanimelist.net'), c, 'MAL', 'Votes');
                trackMaster(v, 'myanimelist');
            }
        });
    }

    if (masterCount > 0) {
        const average = masterSum / masterCount;
        const safeTitle = encodeURIComponent(data.title || '');
        const safeYear = (data.year || '').toString();
        const suffix = type === 'movie' ? 'film' : 'TV series';
        const wikiUrl = `https://duckduckgo.com/?q=!ducky+site:en.wikipedia.org+${safeTitle}+${safeYear}+${suffix}`;
        add('master', average, wikiUrl, masterCount, 'Master Rating', 'Sources');
    }

    container.innerHTML = html;
    refreshDomElements();
}

window.MDBL_OPEN_SETTINGS_GL = () => openSettingsMenu();

function fetchRatings(container, tmdbId, type) {
    if (container.dataset.fetching === 'true') return; 
    
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

    container.dataset.fetching = 'true';
    GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${API_KEY}`,
        onload: r => {
            container.dataset.fetching = 'false';
            try {
                if (r.status !== 200) { console.error('[MDBList] API Error:', r.status); return; }
                const d = JSON.parse(r.responseText);
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: d }));
                renderRatings(container, d, currentImdbId, type);
            } catch(e) { console.error('[MDBList] Parse Error', e); }
        },
        onerror: e => {
            container.dataset.fetching = 'false';
            console.error('[MDBList] Net Error', e)
        }
    });
}

// === BRUTE FORCE ID HUNTER ===

// Helper to extract Jellyfin Internal ID
function getJellyfinId() {
    const url = window.location.hash || window.location.search;
    const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : url);
    return params.get('id');
}

function scan() {
    updateEndsAt();

    const currentJellyfinId = getJellyfinId();

    // 1. Find the VISIBLE wrapper
    const allWrappers = document.querySelectorAll('.itemMiscInfo');
    let wrapper = null;
    for (const el of allWrappers) {
        if (el.offsetParent !== null) { 
            wrapper = el;
            break;
        }
    }

    if (!wrapper) return; 

    // 2. Ensure Container & Gear Icon Exist
    let container = wrapper.querySelector('.mdblist-rating-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'mdblist-rating-container';
        container.dataset.jellyfinId = currentJellyfinId;
        wrapper.appendChild(container);
        renderGearIcon(container);
    } 
    else if (container.dataset.jellyfinId !== currentJellyfinId) {
        // New page detected
        container.innerHTML = '';
        renderGearIcon(container);
        container.dataset.jellyfinId = currentJellyfinId;
        container.dataset.tmdbId = '';
        container.dataset.fetched = '';
        container.dataset.fetching = 'false';
    }

    // 3. Stop if we already have visible ratings
    if (container.querySelector('.mdbl-rating-item:not(.mdbl-settings-btn)')) return;

    // 4. BRUTE FORCE ID SEARCH (Scanning ALL links)
    // We iterate document.links which is faster than querySelectorAll for all anchors
    // This catches external links even if Jellyfin puts them in weird places
    let type = 'movie'; // Default
    let id = null;

    // First try: TMDB
    for (let i = 0; i < document.links.length; i++) {
        const href = document.links[i].href;
        if (href.includes('themoviedb.org')) {
            const m = href.match(/\/(movie|tv)\/(\d+)/);
            if (m) {
                type = m[1] === 'tv' ? 'show' : 'movie';
                id = m[2];
                break;
            }
        }
    }

    // Second try: IMDb (Fallback if no TMDB link found)
    if (!id) {
        for (let i = 0; i < document.links.length; i++) {
            const href = document.links[i].href;
            if (href.includes('imdb.com/title/')) {
                const m = href.match(/tt\d+/);
                if (m) {
                    id = m[0]; // We use the IMDB ID directly
                    // Note: MDBList API supports IMDB ID query via ?imdb_id=... but the URL structure is slightly different.
                    // However, standard MDBList endpoint usually expects TMDB ID.
                    // For simplicity, we assume if we found IMDB, we might need a different lookup, 
                    // BUT for now let's assume TMDB link is key. 
                    // If your Jellyfin ONLY has IMDB links, let me know. 
                    // I'll keep it strictly TMDB for now to avoid ID confusion, as most Jellfin metadata fetches TMDB.
                }
            }
        }
    }

    // 5. Trigger Fetch if valid ID found
    if (id && /^\d+$/.test(id)) { // Ensure it's numeric (TMDB ID)
        if (container.dataset.tmdbId !== id) {
            container.dataset.tmdbId = id;
            container.dataset.type = type;
            fetchRatings(container, id, type);
        }
    }
}

// Run every 500ms
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
    :root { --mdbl-right-col: 48px; }
    #mdbl-panel { position:fixed; right:16px; bottom:70px; width:500px; max-height:90vh; overflow:auto; border-radius:14px;
        border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); backdrop-filter:blur(8px);
        color:#eaeaea; z-index:100000; box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; font-family: sans-serif; }
    #mdbl-panel header { position:sticky; top:0; background:rgba(22,22,26,0.98); padding:6px 12px; border-bottom:1px solid rgba(255,255,255,0.08);
        display:flex; align-items:center; gap:8px; cursor:move; z-index:999; backdrop-filter:blur(8px); font-weight: bold; justify-content: space-between; }
    #mdbl-close { 
        width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; 
        background: transparent; border: none; color: #aaa; font-size: 18px; cursor: pointer; 
        padding: 0; border-radius: 6px; 
    }
    #mdbl-close:hover { background:rgba(255,255,255,0.06); color:#fff; }
    #mdbl-panel .mdbl-section { padding:2px 12px; gap:2px; display:flex; flex-direction:column; }
    #mdbl-panel .mdbl-subtle { color:#9aa0a6; font-size:12px; }
    
    #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { display:grid; grid-template-columns:1fr var(--mdbl-right-col); align-items:center; gap:5px; padding:2px 6px; border-radius:6px; min-height: 32px; }
    #mdbl-panel .mdbl-row { background:transparent; border:1px solid rgba(255,255,255,0.06); box-sizing:border-box; }
    
    .mdbl-slider-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 15px;
        padding: 4px 6px;
        border-radius: 6px;
        background: transparent; 
        border: 1px solid rgba(255,255,255,0.06);
        min-height: 32px;
    }
    .mdbl-slider-row > span { white-space: nowrap; width: 110px; flex-shrink: 0; }
    .mdbl-slider-row .slider-wrapper {
        flex-grow: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: flex-end;
        width: 100%;
    }
    
    #mdbl-panel input[type="checkbox"] { 
        transform: scale(1.2); cursor: pointer; 
        accent-color: var(--mdbl-theme); 
    }
    #mdbl-panel input[type="range"] { 
        flex-grow: 1; 
        width: 100%;
        margin: 0; cursor: pointer; accent-color: var(--mdbl-theme); 
    }
    
    #mdbl-panel input[type="text"] { width:100%; padding:10px 0; border:0; background:transparent; color:#eaeaea; font-size:14px; outline:none; }
    
    #mdbl-panel select, #mdbl-panel input.mdbl-pos-input, #mdbl-panel input.mdbl-num-input {
        padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#121317; color:#eaeaea;
        height:28px; line-height: 28px; font-size: 12px; box-sizing:border-box; display:inline-block; color-scheme: dark;
    }
    #mdbl-panel .mdbl-select { width:140px; justify-self:end; }
    #mdbl-panel input.mdbl-pos-input { width: 75px; text-align: center; font-size: 14px; }
    #mdbl-panel input.mdbl-num-input { width: 60px; text-align: center; }

    #mdbl-panel .mdbl-actions { position:sticky; bottom:0; background:rgba(22,22,26,0.96); display:flex; gap:10px; padding:6px 10px; border-top:1px solid rgba(255,255,255,0.08); }
    #mdbl-panel button { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#1b1c20; color:#eaeaea; cursor:pointer; }
    
    #mdbl-panel button.primary { 
        background-color: var(--mdbl-theme) !important; 
        border-color: var(--mdbl-theme) !important; 
        color: #fff; 
    }
    
    #mdbl-sources { display:flex; flex-direction:column; gap:8px; }
    .mdbl-source { background:#0f1115; border:1px solid rgba(255,255,255,0.1); cursor: grab; }
    .mdbl-src-left { display:flex; align-items:center; gap:10px; }
    .mdbl-src-left img { height:16px; width:auto; }
    .mdbl-src-left .name { font-size:13px; }
    .mdbl-drag-handle { justify-self:start; opacity:0.6; cursor:grab; }
    #mdbl-key-box { background:#0f1115; border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:12px; }
    
    .mdbl-grid { display:grid; grid-template-columns:1fr; gap:10px; }
    .mdbl-grid .grid-row { display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:12px; }
    .grid-right { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
    .mdbl-grid label { white-space: nowrap; }
    .sw { display:inline-block; width:18px; height:18px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); }
    
    #mdbl-panel hr { border:0; border-top:1px solid rgba(255,255,255,0.08); margin:4px 0; }
    #mdbl-panel .mdbl-actions { display:flex; align-items:center; gap:8px; }
    #mdbl-panel .mdbl-actions .mdbl-grow { flex:1; }

    @media (max-width: 600px) {
        #mdbl-panel {
            width: 96% !important; left: 2% !important; right: 2% !important; bottom: 10px !important; top: auto !important;
            transform: none !important; max-height: 80vh;
            --mdbl-right-col: 40px; 
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
    
    document.addEventListener('mousedown', (e) => {
        if (panel.style.display === 'block' && !panel.contains(e.target) && e.target.id !== 'customEndsAt' && !e.target.closest('.mdbl-settings-btn')) {
            panel.style.display = 'none';
        }
    });
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
