// ==UserScript==
// @name         Jellyfin Ratings (v10.3.2 — Master First & Menu Fix)
// @namespace    https://mdblist.com
// @version      10.3.2
// @description  Master Rating -> Gear -> Others. Menu opening logic restored from working version. Parental rating spacing fixed.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

console.log('[Jellyfin Ratings] v10.3.2 loading...');

/* ==========================================================================
   1. CONFIGURATION & CONSTANTS
========================================================================== */

const NS = 'mdbl_';
const API_KEY = (window.MDBL_KEYS?.MDBLIST) || (JSON.parse(localStorage.getItem(`${NS}keys`) || '{}').MDBLIST) || 'hehfnbo9y8blfyqm1d37ikubl';
const CACHE_DURATION = 86400000; // 24 Hours

const DEFAULTS = {
    sources: {
        master: true, imdb: true, tmdb: true, trakt: true, letterboxd: true,
        rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
        metacritic_critic: true, metacritic_user: true,
        roger_ebert: true, anilist: true, myanimelist: true
    },
    display: {
        showPercentSymbol: true, colorNumbers: true, colorIcons: false,
        posX: 0, posY: 0,
        colorBands: { redMax: 50, orangeMax: 69, ygMax: 79 },
        colorChoice: { red: 0, orange: 2, yg: 3, mg: 0 },
        endsAt24h: true
    },
    spacing: { ratingsTopGapPx: 4 },
    priorities: {
        master: -1, imdb: 1, tmdb: 2, trakt: 3, letterboxd: 4,
        rotten_tomatoes_critic: 5, rotten_tomatoes_audience: 6,
        roger_ebert: 7, metacritic_critic: 8, metacritic_user: 9,
        anilist: 10, myanimelist: 11
    }
};

const SCALE = {
    master: 1, imdb: 10, tmdb: 1, trakt: 1, letterboxd: 20, roger_ebert: 25,
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

const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
    master: `${ICON_BASE}/master.png`, imdb: `${ICON_BASE}/IMDb.png`, tmdb: `${ICON_BASE}/TMDB.png`,
    trakt: `${ICON_BASE}/Trakt.png`, letterboxd: `${ICON_BASE}/letterboxd.png`, anilist: `${ICON_BASE}/anilist.png`,
    myanimelist: `${ICON_BASE}/mal.png`, roger_ebert: `${ICON_BASE}/Roger_Ebert.png`,
    rotten_tomatoes_critic: `${ICON_BASE}/Rotten_Tomatoes.png`,
    rotten_tomatoes_audience: `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
    metacritic_critic: `${ICON_BASE}/Metacritic.png`, metacritic_user: `${ICON_BASE}/mus2.png`
};

const LABEL = {
    master: 'Master Rating', imdb: 'IMDb', tmdb: 'TMDb', trakt: 'Trakt', letterboxd: 'Letterboxd',
    rotten_tomatoes_critic: 'RT Critic', rotten_tomatoes_audience: 'RT Audience',
    metacritic_critic: 'Meta Critic', metacritic_user: 'Meta User',
    roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MAL'
};

/* ==========================================================================
   2. STATE & UTILS
========================================================================== */

let CFG = loadConfig();
let currentImdbId = null;
let lastPath = window.location.pathname;

function loadConfig() {
    try {
        const raw = localStorage.getItem(`${NS}prefs`);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
        const p = JSON.parse(raw);
        // Force clamp limits on load: X(-700, 500), Y(-500, 500)
        if(p.display) {
            p.display.posX = Math.max(-700, Math.min(500, parseInt(p.display.posX) || 0));
            p.display.posY = Math.max(-500, Math.min(500, parseInt(p.display.posY) || 0));
        }
        return {
            sources: { ...DEFAULTS.sources, ...p.sources },
            display: { ...DEFAULTS.display, ...p.display, colorBands: { ...DEFAULTS.display.colorBands, ...p.display?.colorBands }, colorChoice: { ...DEFAULTS.display.colorChoice, ...p.display?.colorChoice } },
            spacing: { ...DEFAULTS.spacing, ...p.spacing },
            priorities: { ...DEFAULTS.priorities, ...p.priorities }
        };
    } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function saveConfig() { localStorage.setItem(`${NS}prefs`, JSON.stringify(CFG)); }

// Polyfill GM_xmlhttpRequest if needed
if (typeof GM_xmlhttpRequest === 'undefined') {
    const PROXIES = ['https://api.allorigins.win/raw?url=', 'https://api.codetabs.com/v1/proxy?quest='];
    window.GM_xmlhttpRequest = ({ method = 'GET', url, onload, onerror }) => {
        const useProxy = !url.includes('mdblist.com') && !url.includes('graphql.anilist.co');
        const finalUrl = useProxy ? PROXIES[Math.floor(Math.random() * PROXIES.length)] + encodeURIComponent(url) : url;
        fetch(finalUrl).then(r => r.text().then(t => onload && onload({ status: r.status, responseText: t }))).catch(e => onerror && onerror(e));
    };
}

const localSlug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fixUrl = (url, domain) => !url ? null : (url.startsWith('http') ? url : `https://${domain}/${url.startsWith('/')?url.substring(1):url}`);

/* ==========================================================================
   3. CSS INJECTION
========================================================================== */

const CSS_MAIN = `
    .mdblist-rating-container {
        display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;
        width: 100%; margin-top: 4px; box-sizing: border-box;
        transform: translate(var(--mdbl-x), var(--mdbl-y));
        z-index: 2147483647; position: relative; pointer-events: auto !important; flex-shrink: 0;
    }
    .mdbl-rating-item {
        display: inline-flex; align-items: center; margin: 0 6px; gap: 6px;
        text-decoration: none; transition: transform 0.2s ease; cursor: pointer; color: inherit;
    }
    .mdbl-rating-item:hover { transform: scale(1.15) rotate(2deg); z-index: 2147483647; }
    .mdbl-rating-item img { height: 1.3em; vertical-align: middle; transition: filter 0.2s; }
    .mdbl-rating-item span { font-size: 1em; vertical-align: middle; transition: color 0.2s; }
    
    .mdbl-settings-btn {
        opacity: 0.6; margin: 0 8px; border-right: 1px solid rgba(255,255,255,0.2); border-left: 1px solid rgba(255,255,255,0.2);
        padding: 4px 8px 4px 0; cursor: pointer !important; pointer-events: auto !important;
    }
    .mdbl-settings-btn:hover { opacity: 1; transform: scale(1.1); }
    .mdbl-settings-btn svg { width: 1.2em; height: 1.2em; fill: currentColor; pointer-events: none; }
    
    .itemMiscInfo, .mainDetailRibbon, .detailRibbon { 
        overflow: visible !important; contain: none !important; position: relative; z-index: 10; 
    }
    
    /* Spacing & Parental Rating Fixes */
    #customEndsAt { 
        font-size: inherit; opacity: 0.9; cursor: default; 
        margin-left: 0 !important; display: inline-block; vertical-align: baseline;
        pointer-events: auto; position: relative; z-index: 9999; padding: 2px 4px;
    }
    
    /* Parental Rating Styling - Matches standard items */
    .mediaInfoOfficialRating { 
        margin-right: 14px !important; 
        display: inline-block !important; 
        opacity: 1 !important;
    }

    /* Hide Native Star/Tomato Ratings */
    .starRatingContainer, .mediaInfoCriticRating, .mediaInfoAudienceRating, .starRating {
        display: none !important;
    }
`;

const CSS_MENU = `
    :root { --mdbl-right-col: 48px; }
    #mdbl-panel { 
        position:fixed; right:16px; bottom:70px; width:500px; max-height:90vh; 
        overflow:auto; border-radius:14px;
        border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); 
        backdrop-filter:blur(8px); color:#eaeaea; z-index:2147483647; 
        box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; font-family: sans-serif;
        resize: both; min-width: 350px; min-height: 200px;
    }
    #mdbl-panel header { 
        position:sticky; top:0; background:rgba(22,22,26,0.98); padding:6px 12px; 
        border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; 
        gap:8px; cursor:move; z-index:999; font-weight: bold; justify-content: space-between; 
    }
    #mdbl-close { 
        width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; 
        background: transparent; border: none; color: #aaa; font-size: 18px; cursor: pointer; padding: 0;
    }
    #mdbl-close:hover { background:rgba(255,255,255,0.06); color:#fff; }
    #mdbl-panel .mdbl-section { padding:2px 12px; gap:2px; display:flex; flex-direction:column; }
    #mdbl-panel .mdbl-subtle { color:#9aa0a6; font-size:12px; }
    
    #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { display:grid; grid-template-columns:1fr var(--mdbl-right-col); align-items:center; gap:5px; padding:2px 6px; border-radius:6px; min-height: 32px; }
    #mdbl-panel .mdbl-row { background:transparent; border:1px solid rgba(255,255,255,0.06); box-sizing:border-box; }
    
    /* Flexbox Slider Row */
    .mdbl-slider-row {
        display: flex; align-items: center; justify-content: space-between; gap: 15px;
        padding: 4px 6px; border-radius: 6px; background: transparent; 
        border: 1px solid rgba(255,255,255,0.06); min-height: 32px;
    }
    .mdbl-slider-row > span { white-space: nowrap; width: 110px; flex-shrink: 0; }
    .mdbl-slider-row .slider-wrapper { flex-grow: 1; display: flex; align-items: center; gap: 10px; width: 100%; }
    
    #mdbl-panel input[type="checkbox"] { transform: scale(1.2); cursor: pointer; accent-color: var(--mdbl-theme); }
    #mdbl-panel input[type="range"] { flex-grow: 1; width: 100%; margin: 0; cursor: pointer; accent-color: var(--mdbl-theme); }
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
    #mdbl-panel button.primary { background-color: var(--mdbl-theme) !important; border-color: var(--mdbl-theme) !important; color: #fff; }
    
    #mdbl-sources { display:flex; flex-direction:column; gap:8px; }
    .mdbl-source { background:#0f1115; border:1px solid rgba(255,255,255,0.1); cursor: grab; }
    .mdbl-src-left { display:flex; align-items:center; gap:10px; }
    .mdbl-src-left img { height:16px; width:auto; }
    .mdbl-src-left .name { font-size:13px; }
    .mdbl-drag-handle { justify-self:start; opacity:0.6; cursor:grab; }
    
    .mdbl-grid { display:grid; grid-template-columns:1fr; gap:10px; }
    .mdbl-grid .grid-row { display:grid; grid-template-columns:1fr 1fr; align-items:center; gap:12px; }
    .grid-right { display:flex; align-items:center; gap:8px; justify-content:flex-end; }
    .sw { display:inline-block; width:18px; height:18px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); }
    #mdbl-panel hr { border:0; border-top:1px solid rgba(255,255,255,0.08); margin:4px 0; }
`;

const styleEl = document.createElement('style');
styleEl.textContent = CSS_MAIN;
document.head.appendChild(styleEl);

function updateGlobalStyles() {
    document.documentElement.style.setProperty('--mdbl-x', `${CFG.display.posX}px`);
    document.documentElement.style.setProperty('--mdbl-y', `${CFG.display.posY}px`);
    
    let priorityRules = '';
    Object.keys(CFG.priorities).forEach(key => {
        priorityRules += `.mdbl-rating-item[data-source="${key}"] { display: ${CFG.sources[key]?'inline-flex':'none'}; order: ${CFG.priorities[key]}; }`;
    });
    styleEl.textContent = CSS_MAIN + priorityRules;
}

function getRatingColor(r) {
    const b = CFG.display.colorBands;
    const c = CFG.display.colorChoice;
    let band = 'mg';
    if (r <= b.redMax) band = 'red';
    else if (r <= b.orangeMax) band = 'orange';
    else if (r <= b.ygMax) band = 'yg';
    return SWATCHES[band][Math.max(0, Math.min(3, c[band]||0))];
}

function refreshDomElements() {
    updateGlobalStyles(); 
    document.querySelectorAll('.mdbl-rating-item:not(.mdbl-settings-btn)').forEach(el => {
        const score = parseFloat(el.dataset.score);
        if (isNaN(score)) return;
        const color = getRatingColor(score);
        const img = el.querySelector('img');
        const span = el.querySelector('span');
        if (img) img.style.filter = CFG.display.colorIcons ? `drop-shadow(0 0 3px ${color})` : '';
        if (span) span.style.color = CFG.display.colorNumbers ? color : '';
        const text = CFG.display.showPercentSymbol ? `${Math.round(score)}%` : `${Math.round(score)}`;
        if (span && span.textContent !== text) span.textContent = text;
    });
    updateEndsAt();
}

/* ==========================================================================
   4. CORE LOGIC
========================================================================== */

// Define global function immediately for inline onclicks
window.MDBL_OPEN_SETTINGS_GL = () => { initMenu(); if(window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS(); };

function parseRuntimeToMinutes(text) {
    if (!text) return 0;
    let m = text.match(/(?:(\d+)\s*(?:h|hr|std?)\w*\s*)?(?:(\d+)\s*(?:m|min)\w*)?/i);
    if (m && (m[1] || m[2])) return (parseInt(m[1]||'0') * 60) + parseInt(m[2]||'0');
    m = text.match(/(\d+)\s*(?:m|min)\w*/i);
    return m ? parseInt(m[1]) : 0;
}

function updateEndsAt() {
    const primary = document.querySelector('.itemMiscInfo.itemMiscInfo-primary') || document.querySelector('.itemMiscInfo');
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
    
    document.querySelectorAll('.itemMiscInfo-secondary, .itemMiscInfo span, .itemMiscInfo div').forEach(el => {
        if (el.id === 'customEndsAt' || el.closest('.mdblist-rating-container')) return;
        const t = (el.textContent || '').toLowerCase();
        if (t.includes('ends at') || t.includes('endet um') || t.includes('endet am')) {
             el.style.display = minutes > 0 ? 'none' : '';
        }
    });

    if (minutes > 0) {
        const d = new Date(Date.now() + minutes * 60000);
        const timeStr = d.toLocaleTimeString([], CFG.display.endsAt24h ? {hour:'2-digit', minute:'2-digit', hour12:false} : {hour:'numeric', minute:'2-digit', hour12:true});
        const content = `Ends at ${timeStr}`;

        let span = primary.querySelector('#customEndsAt');
        if (!span) {
            span = document.createElement('div');
            span.id = 'customEndsAt';
            span.title = 'Calculated finish time';
            const rc = primary.querySelector('.mdblist-rating-container');
            rc && rc.nextSibling ? primary.insertBefore(span, rc.nextSibling) : primary.appendChild(span);
        }
        if (span.textContent !== content) span.textContent = content;
        span.style.display = ''; 
    } else {
        primary.querySelector('#customEndsAt')?.remove();
    }
}

function createRatingHtml(key, val, link, count, title) {
    if (val === null || isNaN(val) || !LOGO[key]) return '';
    const r = Math.round(parseFloat(val) * (SCALE[key] || 1));
    const tooltip = (count > 0) ? `${title} — ${count.toLocaleString()} Votes` : title;
    const safeLink = (link && link !== '#' && !link.startsWith('http://192')) ? link : '#';
    const style = safeLink === '#' ? 'cursor:default;' : '';
    
    return `<a href="${safeLink}" target="_blank" class="mdbl-rating-item" data-source="${key}" data-score="${r}" style="${style}" title="${tooltip}">
            <img src="${LOGO[key]}" alt="${title}"><span>${CFG.display.showPercentSymbol ? r+'%' : r}</span></a>`;
}

function renderRatings(container, data, pageImdbId, type) {
    let html = '';
    const ids = { imdb: data.imdbid||data.imdb_id||pageImdbId, tmdb: data.id||data.tmdbid||container.dataset.tmdbId, trakt: data.traktid };
    let mSum = 0, mCount = 0;

    // 1. MASTER RATING (First)
    data.ratings?.forEach(r => {
        const s = (r.source||'').toLowerCase();
        let k = '';
        if (s.includes('imdb')) k='imdb'; else if (s.includes('tmdb')) k='tmdb'; else if (s.includes('trakt')) k='trakt'; else if (s.includes('letterboxd')) k='letterboxd'; else if (s.includes('tomatoes') || s === 'tomatoes') k='rotten_tomatoes_critic'; else if (s.includes('audience') || s.includes('popcorn')) k='rotten_tomatoes_audience'; else if (s.includes('metacritic') && !s.includes('user')) k='metacritic_critic'; else if (s.includes('metacritic') && s.includes('user')) k='metacritic_user'; else if (s.includes('roger')) k='roger_ebert'; else if (s.includes('anilist')) k='anilist'; else if (s.includes('myanimelist')) k='myanimelist';
        
        if (k && r.value) { mSum += parseFloat(r.value) * (SCALE[k]||1); mCount++; }
    });

    if (mCount > 0) {
        const wiki = `https://duckduckgo.com/?q=!ducky+site:en.wikipedia.org+${encodeURIComponent(data.title||'')} ${data.year||''} ${type==='movie'?'film':'TV series'}`;
        html += createRatingHtml('master', mSum/mCount, wiki, mCount, 'Master Rating');
    }

    // 2. GEAR ICON (Second)
    // Using the exact Working inline handler pattern
    html += `<div class="mdbl-rating-item mdbl-settings-btn" title="Settings" onclick="event.preventDefault();event.stopPropagation();window.MDBL_OPEN_SETTINGS_GL();">
       <svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></div>`;

    // 3. OTHER RATINGS (Following)
    data.ratings?.forEach(r => {
        const s = (r.source||'').toLowerCase(), v = r.value, c = r.votes||r.count, u = r.url;
        let k = null, lnk = null, tit = '';
        
        if (s.includes('imdb')) { k='imdb'; lnk=ids.imdb?`https://www.imdb.com/title/${ids.imdb}/`:u; tit='IMDb'; }
        else if (s.includes('tmdb')) { k='tmdb'; lnk=ids.tmdb?`https://www.themoviedb.org/${type}/${ids.tmdb}`:'#'; tit='TMDb'; }
        else if (s.includes('trakt')) { k='trakt'; lnk=ids.imdb?`https://trakt.tv/search/imdb/${ids.imdb}`:'#'; tit='Trakt'; }
        else if (s.includes('letterboxd')) { k='letterboxd'; lnk=fixUrl(u, 'letterboxd.com'); tit='Letterboxd'; }
        else if (s.includes('tomatoes') || s === 'tomatoes') { k='rotten_tomatoes_critic'; lnk=fixUrl(u, 'rottentomatoes.com'); tit='RT Critic'; }
        else if (s.includes('audience') || s.includes('popcorn')) { k='rotten_tomatoes_audience'; lnk=fixUrl(u, 'rottentomatoes.com'); tit='RT Audience'; }
        else if (s.includes('metacritic') && !s.includes('user')) { k='metacritic_critic'; lnk=fixUrl(u, 'metacritic.com'); tit='Metacritic'; }
        else if (s.includes('metacritic') && s.includes('user')) { k='metacritic_user'; lnk=fixUrl(u, 'metacritic.com'); tit='User'; }
        else if (s.includes('roger')) { k='roger_ebert'; lnk=fixUrl(u, 'rogerebert.com'); tit='Roger Ebert'; }
        else if (s.includes('anilist')) { k='anilist'; lnk=fixUrl(u, 'anilist.co'); tit='AniList'; }
        else if (s.includes('myanimelist')) { k='myanimelist'; lnk=fixUrl(u, 'myanimelist.net'); tit='MAL'; }

        if (k && v !== null) html += createRatingHtml(k, v, lnk, c, tit);
    });

    container.innerHTML = html;
    refreshDomElements();
}

function fetchRatings(container, tmdbId, type) {
    const cacheKey = `${NS}c_${tmdbId}`;
    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && (Date.now() - cached.ts < CACHE_DURATION)) return renderRatings(container, cached.data, currentImdbId, type);
    } catch {}

    GM_xmlhttpRequest({
        method: 'GET', url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${API_KEY}`,
        onload: r => {
            try {
                const d = JSON.parse(r.responseText);
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: d }));
                renderRatings(container, d, currentImdbId, type);
            } catch {}
        }
    });
}

function scan() {
    if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname; currentImdbId = null;
        document.querySelectorAll('.mdblist-rating-container').forEach(e => e.remove());
    }
    updateEndsAt();
    
    const imdbLink = document.querySelector('a[href*="imdb.com/title/"]');
    if (imdbLink) {
        const m = imdbLink.href.match(/tt\d+/);
        if (m && m[0] !== currentImdbId) {
            currentImdbId = m[0];
            document.querySelectorAll('.mdblist-rating-container').forEach(e => e.remove());
        }
    }

    document.querySelectorAll('a[href*="themoviedb.org/"]').forEach(a => {
        const m = a.href.match(/\/(movie|tv)\/(\d+)/);
        if (m) {
            const wrapper = document.querySelector('.itemMiscInfo');
            if (wrapper && !wrapper.querySelector(`.mdblist-rating-container[data-tmdb-id="${m[2]}"]`)) {
                wrapper.querySelectorAll('.mdblist-rating-container').forEach(e => e.remove());
                const div = document.createElement('div');
                div.className = 'mdblist-rating-container';
                div.dataset.type = m[1]==='tv'?'show':'movie'; div.dataset.tmdbId = m[2];
                wrapper.appendChild(div);
                fetchRatings(div, m[2], div.dataset.type);
            }
        }
    });
}
setInterval(scan, 500);

/* ==========================================================================
   5. SETTINGS MENU UI
========================================================================== */
function initMenu() {
    if(document.getElementById('mdbl-panel')) return;
    
    const style = document.createElement('style');
    style.textContent = CSS_MENU;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'mdbl-panel';
    document.body.appendChild(panel);

    let isDrag = false, startX, startY, startLeft, startTop;
    panel.addEventListener('mousedown', (e) => {
        if (['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) return;
        const rect = panel.getBoundingClientRect();
        if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) return;

        isDrag = true; 
        startX = e.clientX; startY = e.clientY;
        startLeft = rect.left; startTop = rect.top;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDrag) return;
        panel.style.left = (startLeft + (e.clientX - startX)) + 'px';
        panel.style.top = (startTop + (e.clientY - startY)) + 'px';
    });
    document.addEventListener('mouseup', () => isDrag = false);
    
    document.addEventListener('mousedown', (e) => {
        if (panel.style.display === 'block' && !panel.contains(e.target) && !e.target.closest('.mdbl-settings-btn') && e.target.id !== 'customEndsAt') {
            panel.style.display = 'none';
        }
    });

    window.MDBL_OPEN_SETTINGS = () => {
        const btn = document.querySelector('.button-submit, .btnPlay, .main-button');
        const col = btn ? window.getComputedStyle(btn).backgroundColor : '#2a6df4';
        panel.style.setProperty('--mdbl-theme', col !== 'rgba(0, 0, 0, 0)' ? col : '#2a6df4');
        renderMenuContent(panel);
        panel.style.display = 'block';
    };
}

function renderMenuContent(panel) {
    const row = (lbl, inp) => `<div class="mdbl-row"><span>${lbl}</span>${inp}</div>`;
    const sRow = (lbl, idR, idN, min, max, val) => `<div class="mdbl-slider-row"><span>${lbl}</span><div class="slider-wrapper"><input type="range" id="${idR}" min="${min}" max="${max}" value="${val}"><input type="number" id="${idN}" value="${val}" class="mdbl-num-input"></div></div>`;
    
    panel.innerHTML = `
    <header><h3>Settings</h3><button id="mdbl-close">✕</button></header>
    <div class="mdbl-section" id="mdbl-sec-keys">
       ${(!INJ_KEYS.MDBLIST && !JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST) ? `<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value="${(JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST)||''}"></div>` : ''}
    </div>
    <div class="mdbl-section">
       <div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div><hr>
    </div>
    <div class="mdbl-section">
        <div class="mdbl-subtle">Display</div>
        ${row('Color numbers', `<input type="checkbox" id="d_cnum" ${CFG.display.colorNumbers?'checked':''}>`)}
        ${row('Color icons', `<input type="checkbox" id="d_cicon" ${CFG.display.colorIcons?'checked':''}>`)}
        ${row('Show %', `<input type="checkbox" id="d_pct" ${CFG.display.showPercentSymbol?'checked':''}>`)}
        ${row('Enable 24h format', `<input type="checkbox" id="d_24h" ${CFG.display.endsAt24h?'checked':''}>`)}
        ${sRow('Pos X (px)', 'd_x_rng', 'd_x_num', -700, 500, CFG.display.posX)}
        ${sRow('Pos Y (px)', 'd_y_rng', 'd_y_num', -500, 500, CFG.display.posY)}
        <hr>
        <div class="mdbl-subtle">Colors</div>
        ${createColorBandRow('th_red', 'Rating', CFG.display.colorBands.redMax, 'red')}
        ${createColorBandRow('th_orange', 'Rating', CFG.display.colorBands.orangeMax, 'orange')}
        ${createColorBandRow('th_yg', 'Rating', CFG.display.colorBands.ygMax, 'yg')}
        <div class="mdbl-slider-row"><span>Top tier</span><div class="slider-wrapper"><span class="sw" id="sw_mg" style="background:${SWATCHES.mg[CFG.display.colorChoice.mg]}"></span><select id="col_mg" class="mdbl-select">${PALETTE_NAMES.mg.map((n,i)=>`<option value="${i}" ${CFG.display.colorChoice.mg===i?'selected':''}>${n}</option>`).join('')}</select></div></div>
    </div>
    <div class="mdbl-actions"><div class="mdbl-actions-grow"></div><button id="mdbl-btn-reset">Reset</button><button id="mdbl-btn-save" class="primary">Save</button></div>`;

    const sList = panel.querySelector('#mdbl-sources');
    Object.keys(CFG.priorities).sort((a,b) => CFG.priorities[a]-CFG.priorities[b]).forEach(k => {
         const div = document.createElement('div'); div.className = 'mdbl-source'; div.draggable = true; div.dataset.key = k;
         div.innerHTML = `<div class="mdbl-src-left"><span class="mdbl-drag-handle">⋮⋮</span><img src="${LOGO[k]||''}">
            <span class="name" style="margin-left:8px">${LABEL[k]}</span></div><input type="checkbox" class="src-check" ${CFG.sources[k]?'checked':''}>`;
         sList.appendChild(div);
    });

    panel.querySelector('#mdbl-close').onclick = () => panel.style.display = 'none';
    
    const update = () => {
        CFG.display.colorNumbers = panel.querySelector('#d_cnum').checked;
        CFG.display.colorIcons = panel.querySelector('#d_cicon').checked;
        CFG.display.showPercentSymbol = panel.querySelector('#d_pct').checked;
        CFG.display.endsAt24h = panel.querySelector('#d_24h').checked;
        CFG.display.colorBands.redMax = parseInt(panel.querySelector('#th_red').value)||50;
        CFG.display.colorBands.orangeMax = parseInt(panel.querySelector('#th_orange').value)||69;
        CFG.display.colorBands.ygMax = parseInt(panel.querySelector('#th_yg').value)||79;
        ['red','orange','yg','mg'].forEach(k => {
            CFG.display.colorChoice[k] = parseInt(panel.querySelector(`#col_${k}`).value)||0;
            panel.querySelector(`#sw_${k}`).style.background = SWATCHES[k][CFG.display.colorChoice[k]];
        });
        refreshDomElements();
    };
    panel.addEventListener('change', (e) => {
        if(e.target.matches('input[type="checkbox"], select')) update();
        if(e.target.classList.contains('src-check')) {
            CFG.sources[e.target.closest('.mdbl-source').dataset.key] = e.target.checked; updateGlobalStyles();
        }
    });
    
    const bindPos = (rng, num, axis) => {
        const set = v => { CFG.display[axis] = parseInt(v); panel.querySelector(`#${rng}`).value = v; panel.querySelector(`#${num}`).value = v; updateGlobalStyles(); };
        panel.querySelector(`#${rng}`).addEventListener('input', e => set(e.target.value));
        panel.querySelector(`#${num}`).addEventListener('input', e => set(e.target.value));
    };
    bindPos('d_x_rng', 'd_x_num', 'posX'); bindPos('d_y_rng', 'd_y_num', 'posY');
    panel.querySelectorAll('input[type="number"]').forEach(i => i.addEventListener('input', update));

    let dragSrc;
    panel.querySelectorAll('.mdbl-source').forEach(row => {
        row.addEventListener('dragstart', e => { dragSrc = row; e.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragover', e => { 
            e.preventDefault(); 
            if (dragSrc && dragSrc !== row) {
                const list = row.parentNode, all = [...list.children];
                list.insertBefore(dragSrc, all.indexOf(dragSrc) < all.indexOf(row) ? row.nextSibling : row);
                [...list.children].forEach((r, i) => CFG.priorities[r.dataset.key] = i+1);
                updateGlobalStyles();
            }
        });
    });

    panel.querySelector('#mdbl-btn-save').onclick = () => {
        saveConfig();
        const ki = panel.querySelector('#mdbl-key-mdb');
        if(ki && ki.value.trim()) localStorage.setItem(`${NS}keys`, JSON.stringify({MDBLIST: ki.value.trim()}));
        location.reload();
    };
    panel.querySelector('#mdbl-btn-reset').onclick = () => { if(confirm('Reset settings?')) { localStorage.removeItem(`${NS}prefs`); location.reload(); } };
}

function createColorBandRow(id, lbl, val, key) {
    const opts = PALETTE_NAMES[key].map((n,i) => `<option value="${i}" ${CFG.display.colorChoice[key]===i?'selected':''}>${n}</option>`).join('');
    return `<div class="mdbl-slider-row"><span>${lbl} ≤</span><div class="slider-wrapper"><input type="number" id="${id}" value="${val}" class="mdbl-num-input" style="width:50px;margin-right:10px"><span class="sw" id="sw_${key}" style="background:${SWATCHES[key][CFG.display.colorChoice[key]]}"></span><select id="col_${key}" class="mdbl-select">${opts}</select></div></div>`;
}
