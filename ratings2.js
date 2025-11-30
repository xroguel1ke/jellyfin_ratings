// ==UserScript==
// @name         Jellyfin Ratings (v10.1.2 — Fixed UI & Ranges)
// @namespace    https://mdblist.com
// @version      10.1.2
// @description  Master Rating links to Wikipedia via DuckDuckGo "!ducky" to avoid Google Redirect Notice.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

console.log('[Jellyfin Ratings] v10.1.2 loading...');

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
        compactLevel: 0,
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
            z-index: 2147483647; position: relative; pointer-events: auto; flex-shrink: 0;
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
        
        #customEndsAt { 
            font-size: inherit; opacity: 0.8; cursor: pointer; 
            margin-left: 10px; display: inline-block; vertical-align: baseline;
            pointer-events: auto; position: relative; z-index: 999;
            padding: 2px 4px;
        }
        #customEndsAt:hover { opacity: 1.0; text-decoration: underline; }
        
        #mdbl-settings-trigger {
            display: inline-flex; align-items: center; justify-content: center;
            margin-left: 6px; cursor: pointer !important; opacity: 0.7; transition: opacity 0.2s, transform 0.2s;
            width: 1.3em; height: 1.3em; vertical-align: middle;
            pointer-events: auto; position: relative; z-index: 2147483647;
        }
        #mdbl-settings-trigger:hover { opacity: 1; transform: rotate(45deg); }
        #mdbl-settings-trigger svg { width: 100%; height: 100%; fill: currentColor; pointer-events: none; }
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
        span.onclick = (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            openSettingsMenu();
        };
        
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
        
        icon.onclick = (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            openSettingsMenu();
        };

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

    // Master Rating Calculation
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
                const lnk = ids.imdb ? `
