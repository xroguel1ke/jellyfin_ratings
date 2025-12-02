// ==UserScript==
// @name         Jellyfin Ratings (v10.2.1 — Inline Fix)
// @namespace    https://mdblist.com
// @version      10.2.1
// @description  Places ratings truly inline with metadata (Year > Runtime > Parental > EndsAt > Ratings).
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

console.log('[Jellyfin Ratings] v10.2.1 loading...');

/* ==========================================================================
   1. CONFIGURATION
========================================================================== */

const NS = 'mdbl_';
const DEFAULTS = {
    sources: {
        master: true, imdb: true, tmdb: true, trakt: true, letterboxd: true,
        rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
        metacritic_critic: true, metacritic_user: true, roger_ebert: true,
        anilist: true, myanimelist: true
    },
    display: {
        showPercentSymbol: true, colorNumbers: true, colorIcons: false,
        posX: 0, posY: 0,
        colorBands: { redMax: 50, orangeMax: 69, ygMax: 79 },
        colorChoice: { red: 0, orange: 2, yg: 3, mg: 0 },
        endsAt24h: true
    },
    spacing: { ratingsTopGapPx: 0 },
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

const CACHE_DURATION_API = 24 * 60 * 60 * 1000;
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
    rotten_tomatoes_critic: 'Rotten Tomatoes (Critic)', rotten_tomatoes_audience: 'Rotten Tomatoes (Audience)',
    metacritic_critic: 'Metacritic (Critic)', metacritic_user: 'Metacritic (User)',
    roger_ebert: 'Roger Ebert', anilist: 'AniList', myanimelist: 'MyAnimeList'
};

let CFG = loadConfig();
let currentImdbId = null;

// GET KEY SAFELY
const INJ_KEYS = (window.MDBL_KEYS || {});
const LS_KEYS = JSON.parse(localStorage.getItem(`${NS}keys`) || '{}');
const API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || 'hehfnbo9y8blfyqm1d37ikubl');

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
        /* UPDATED: inline-flex, with default margin-left to separate from Ends At */
        .mdblist-rating-container {
            display: inline-flex; 
            align-items: center;
            justify-content: flex-start; 
            width: auto;
            margin-left: 12px; 
            margin-top: ${CFG.spacing.ratingsTopGapPx}px;
            box-sizing: border-box;
            transform: translate(var(--mdbl-x), var(--mdbl-y));
            z-index: 2147483647; 
            position: relative; 
            pointer-events: auto !important; 
            flex-shrink: 0;
            min-height: 24px;
            vertical-align: middle;
        }
        .mdbl-rating-item {
            display: inline-flex; align-items: center; margin: 0 6px; gap: 6px;
            text-decoration: none;
            transition: transform 0.2s ease;
            cursor: pointer;
            color: inherit;
        }
        .mdbl-rating-item:hover { transform: scale(1.15) rotate(2deg); z-index: 2147483647; }
        .mdbl-rating-item img { height: 1.3em; vertical-align: middle; }
        .mdbl-rating-item span { font-size: 1em; vertical-align: middle; }
        
        .mdbl-settings-btn {
            opacity: 0.6; margin-right: 8px; border-right: 1px solid rgba(255,255,255,0.2); 
            padding: 4px 8px 4px 0; cursor: pointer !important; pointer-events: auto !important;
            order: -9999 !important; display: inline-flex;
        }
        .mdbl-settings-btn:hover { opacity: 1; transform: scale(1.1); }
        .mdbl-settings-btn svg { width: 1.2em; height: 1.2em; fill: currentColor; }
        
        .mdbl-status-text {
            font-size: 11px; opacity: 0.8; margin-left: 5px; color: #ffeb3b;
            white-space: nowrap; font-family: monospace; font-weight: bold;
        }

        /* Ensure parent containers allow overflow for tooltips/popups */
        .itemMiscInfo, .mainDetailRibbon, .detailRibbon { overflow: visible !important; contain: none !important; position: relative; z-index: 10; }
        
        /* Ends At style */
        #customEndsAt { font-size: inherit; opacity: 0.9; cursor: default; margin-left: 10px; display: inline-block; padding: 2px 4px; vertical-align: middle; }
        
        /* Ensure the official rating acts like an inline item */
        .mediaInfoOfficialRating { display: inline-flex !important; vertical-align: middle; }
        
        /* Hides default stars/ratings */
        .starRatingContainer, .mediaInfoCriticRating, .mediaInfoAudienceRating, .starRating { display: none !important; }
    `;

    Object.keys(CFG.priorities).forEach(key => {
        const isEnabled = CFG.sources[key];
        const order = CFG.priorities[key];
        rules += `.mdbl-rating-item[data-source="${key}"] { display: ${isEnabled ? 'inline-flex' : 'none'}; order: ${order}; }`;
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
    initMenu();
    const p = document.getElementById('mdbl-panel');
    if(p) {
        const col = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary-color').trim() || '#2a6df4';
        p.style.setProperty('--mdbl-theme', col);
        renderMenuContent(p);
        p.style.display = 'block';
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
        if (el.offsetParent !== null) { primary = el; break; }
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
    
    // Hide old native "Ends at" text so we can control placement with #customEndsAt
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
        let span = primary.querySelector('#customEndsAt');
        if (!span) {
            span = document.createElement('div');
            span.id = 'customEndsAt';
            
            // KEY FIX: Insert customEndsAt BEFORE ratings container if it exists.
            // This ensures order: [Metadata] [Ends At] [Ratings]
            const rc = primary.querySelector('.mdblist-rating-container');
            if (rc) primary.insertBefore(span, rc); 
            else primary.appendChild(span);
        }
        span.textContent = `Ends at ${timeStr}`;
        span.style.display = ''; 
    } else {
        const span = primary.querySelector('#customEndsAt');
        if(span) span.remove();
    }
}

// === LINK LOGIC ===
function generateLink(key, ids, apiLink, type, title) {
    const sLink = String(apiLink || '');
    const safeTitle = encodeURIComponent(title || '');
    const safeType = (type === 'show' || type === 'tv') ? 'tv' : 'movie';
    
    if (sLink.startsWith('http') && key !== 'metacritic_user' && key !== 'roger_ebert') return sLink;

    switch(key) {
        case 'imdb': return ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : '#';
        case 'tmdb': return ids.tmdb ? `https://www.themoviedb.org/${safeType}/${ids.tmdb}` : '#';
        case 'trakt': return ids.trakt ? `https://trakt.tv/${safeType}s/${ids.trakt}` : (ids.imdb ? `https://trakt.tv/search/imdb/${ids.imdb}` : '#');
        case 'letterboxd': return (sLink.includes('/film/') || sLink.includes('/slug/')) ? `https://letterboxd.com${sLink.startsWith('/') ? '' : '/'}${sLink}` : (ids.imdb ? `https://letterboxd.com/imdb/${ids.imdb}/` : '#');
        
        case 'metacritic_critic':
        case 'metacritic_user': 
            if (sLink.startsWith('/movie/') || sLink.startsWith('/tv/')) return `https://www.metacritic.com${sLink}`;
            const slug = localSlug(title);
            return slug ? `https://www.metacritic.com/${safeType}/${slug}` : '#';

        case 'rotten_tomatoes_critic':
        case 'rotten_tomatoes_audience': 
            if (sLink.startsWith('/')) return `https://www.rottentomatoes.com${sLink}`;
            if (sLink.length > 2) return `https://www.rottentomatoes.com/m/${sLink}`;
            return '#';
            
        case 'anilist': 
            if (ids.anilist) return `https://anilist.co/anime/${ids.anilist}`;
            if (/^\d+$/.test(sLink)) return `https://anilist.co/anime/${sLink}`;
            return `https://anilist.co/search/anime?search=${safeTitle}`;
            
        case 'myanimelist': 
            if (ids.mal) return `https://myanimelist.net/anime/${ids.mal}`;
            if (/^\d+$/.test(sLink)) return `https://myanimelist.net/anime/${sLink}`;
            return `https://myanimelist.net/anime.php?q=${safeTitle}`;
            
        case 'roger_ebert':
             if (sLink && sLink.length > 2 && sLink !== '#') {
                 if (sLink.startsWith('http')) return sLink;
                 let path = sLink.startsWith('/') ? sLink : `/${sLink}`;
                 if (!path.includes('/reviews/')) path = `/reviews${path}`;
                 return `https://www.rogerebert.com${path}`;
             }
             return `https://duckduckgo.com/?q=!ducky+site:rogerebert.com/reviews+${safeTitle}`;

        default: return '#';
    }
}

function createRatingHtml(key, val, link, count, title, kind) {
    if (val === null || isNaN(val)) return '';
    if (!LOGO[key]) return '';
    const n = parseFloat(val) * (SCALE[key] || 1);
    const r = Math.round(n);
    const tooltip = (count && count > 0) ? `${title} — ${count.toLocaleString()} ${kind||'Votes'}` : title;
    
    const style = (!link || link === '#') ? 'cursor:default;' : 'cursor:pointer;';
    return `<a href="${link}" target="_blank" class="mdbl-rating-item" data-source="${key}" data-score="${r}" style="${style}" title="${tooltip}"><img src="${LOGO[key]}" alt="${title}"><span>${CFG.display.showPercentSymbol ? r+'%' : r}</span></a>`;
}

function renderGearIcon(container, statusText = '') {
    if (!container.querySelector('.mdbl-settings-btn')) {
        const btn = document.createElement('div');
        btn.className = 'mdbl-rating-item mdbl-settings-btn';
        btn.title = 'Settings';
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSettingsMenu(); });
        container.appendChild(btn);
    }
    
    let st = container.querySelector('.mdbl-status-text');
    if (!st) {
        st = document.createElement('span');
        st.className = 'mdbl-status-text';
        container.appendChild(st);
    }
    st.textContent = statusText;
    
    updateGlobalStyles();
}

function updateStatus(container, text, color = '#ffeb3b') {
    if (!container.querySelector('.mdbl-settings-btn')) {
        renderGearIcon(container, text);
    }
    const st = container.querySelector('.mdbl-status-text');
    if(st) { 
        st.textContent = text; 
        st.style.color = color;
    }
}

function renderRatings(container, data, pageImdbId, type) {
    const btn = container.querySelector('.mdbl-settings-btn');
    container.innerHTML = ''; 
    
    if(btn) {
        container.appendChild(btn);
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openSettingsMenu(); });
    } else renderGearIcon(container, '');

    let html = '';
    
    const ids = { 
        imdb: data.ids?.imdb || data.imdbid || pageImdbId, 
        tmdb: data.ids?.tmdb || data.id || data.tmdbid || data.tmdb_id, 
        trakt: data.ids?.trakt || data.traktid || data.trakt_id, 
        slug: data.ids?.slug || data.slug,
        mal: data.ids?.mal,           
        anilist: data.ids?.anilist    
    };
    
    const add = (k, v, apiLink, c, tit, kind) => {
        const safeLink = generateLink(k, ids, apiLink, type, data.title);
        html += createRatingHtml(k, v, safeLink, c, tit, kind);
    };

    const fallbackSlug = localSlug(data.title || '');
    let masterSum = 0, masterCount = 0;
    const trackMaster = (val, scaleKey) => { if (val !== null && !isNaN(parseFloat(val))) { masterSum += parseFloat(val) * (SCALE[scaleKey] || 1); masterCount++; } };

    if (data.ratings && data.ratings.length > 0) {
        data.ratings.forEach(r => {
            const s = (r.source || '').toLowerCase();
            const v = r.value, c = r.votes || r.count, apiLink = r.url;
            
            if (s.includes('imdb')) { add('imdb', v, apiLink, c, 'IMDb', 'Votes'); trackMaster(v, 'imdb'); }
            else if (s.includes('tmdb')) { add('tmdb', v, apiLink, c, 'TMDb', 'Votes'); trackMaster(v, 'tmdb'); }
            else if (s.includes('trakt')) { add('trakt', v, apiLink, c, 'Trakt', 'Votes'); trackMaster(v, 'trakt'); }
            else if (s.includes('letterboxd')) { add('letterboxd', v, apiLink, c, 'Letterboxd', 'Votes'); trackMaster(v, 'letterboxd'); }
            else if (s.includes('tomatoes') || s.includes('rotten') || s.includes('popcorn')) {
                if(s.includes('audience') || s.includes('popcorn')) { add('rotten_tomatoes_audience', v, apiLink, c, 'RT Audience', 'Ratings'); trackMaster(v, 'rotten_tomatoes_audience'); }
                else { add('rotten_tomatoes_critic', v, apiLink, c, 'RT Critic', 'Reviews'); trackMaster(v, 'rotten_tomatoes_critic'); }
            }
            else if (s.includes('metacritic')) {
                if(s.includes('user')) { add('metacritic_user', v, apiLink, c, 'User', 'Ratings'); trackMaster(v, 'metacritic_user'); }
                else { add('metacritic_critic', v, apiLink, c, 'Metascore', 'Reviews'); trackMaster(v, 'metacritic_critic'); }
            }
            else if (s.includes('roger')) { add('roger_ebert', v, apiLink, c, 'Roger Ebert', 'Reviews'); trackMaster(v, 'roger_ebert'); }
            else if (s.includes('anilist')) { add('anilist', v, apiLink, c, 'AniList', 'Votes'); trackMaster(v, 'anilist'); }
            else if (s.includes('myanimelist')) { add('myanimelist', v, apiLink, c, 'MAL', 'Votes'); trackMaster(v, 'myanimelist'); }
        });
        
        if (masterCount > 0) {
            const avg = masterSum / masterCount;
            const wikiUrl = `https://duckduckgo.com/?q=!ducky+site:en.wikipedia.org+${encodeURIComponent(data.title || '')}+${(data.year || '')}+${type === 'movie' ? 'film' : 'TV series'}`;
            html += createRatingHtml('master', avg, wikiUrl, masterCount, 'Master Rating', 'Sources');
        }
        
        const contentDiv = document.createElement('span');
        contentDiv.innerHTML = html;
        while (contentDiv.firstChild) container.appendChild(contentDiv.firstChild);
        
        const st = container.querySelector('.mdbl-status-text');
        if(st) st.remove();
        
        refreshDomElements();
    } else {
        updateStatus(container, 'MDB: 0 Ratings', '#e53935');
    }
}

function fetchRatings(container, id, type, apiMode) {
    if (container.dataset.fetching === 'true') return;
    const apiUrl = (apiMode === 'imdb') ? `https://api.mdblist.com/imdb/${id}?apikey=${API_KEY}` : `https://api.mdblist.com/tmdb/${type}/${id}?apikey=${API_KEY}`;
    const cacheKey = `${NS}c_${id}`;
    
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const c = JSON.parse(cached);
            if (Date.now() - c.ts < CACHE_DURATION_API) { renderRatings(container, c.data, currentImdbId, type); return; }
        }
    } catch(e) {}

    container.dataset.fetching = 'true';
    updateStatus(container, `Fetching ${apiMode.toUpperCase()}...`);
    
    GM_xmlhttpRequest({
        method: 'GET', url: apiUrl,
        onload: r => {
            container.dataset.fetching = 'false';
            if (r.status !== 200) { 
                console.error('[MDBList] API Error:', r.status);
                updateStatus(container, `API ${r.status}`, '#e53935');
                return;
            }
            try {
                const d = JSON.parse(r.responseText);
                localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: d }));
                renderRatings(container, d, currentImdbId, type);
            } catch(e) { 
                console.error('[MDBList] Parse Error', e); 
                updateStatus(container, 'Parse Err', '#e53935');
            }
        },
        onerror: e => { 
            container.dataset.fetching = 'false'; 
            console.error('[MDBList] Net Error', e); 
            updateStatus(container, 'Net Err', '#e53935');
        }
    });
}

function getJellyfinId() {
    const url = window.location.hash || window.location.search;
    const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : url);
    return params.get('id');
}

// === SCANNER LOGIC (UPDATED FOR INLINE FIX) ===
function scan() {
    updateEndsAt();
    
    // 1. Look for TMDB links (Preferred)
    const tmdbLinks = document.querySelectorAll('a[href*="themoviedb.org/"]:not([data-mdbl-processed])');
    if (tmdbLinks.length > 0) {
        const link = tmdbLinks[0];
        link.dataset.mdblProcessed = "true";
        
        const m = link.href.match(/\/(movie|tv)\/(\d+)/);
        if (m) {
            const type = m[1] === 'tv' ? 'show' : 'movie';
            const id = m[2];
            injectContainer(id, type, 'tmdb');
            return;
        }
    }

    // 2. Look for IMDb links (Fallback)
    const imdbLinks = document.querySelectorAll('a[href*="imdb.com/title/"]:not([data-mdbl-processed])');
    if (imdbLinks.length > 0) {
        const link = imdbLinks[0];
        link.dataset.mdblProcessed = "true";
        
        const m = link.href.match(/tt\d+/);
        if (m) {
            injectContainer(m[0], 'movie', 'imdb');
            return;
        }
    }
}

function injectContainer(id, type, apiMode) {
    // 1. Find the official rating to locate the correct metadata ROW
    let target = document.querySelector('.mediaInfoOfficialRating');
    let parent = null;

    if (target && target.offsetParent !== null) {
        // If we found the rating, use its PARENT as the container
        parent = target.parentNode; 
    } else {
        // Fallback: search for itemMiscInfo
         const allWrappers = document.querySelectorAll('.itemMiscInfo');
         for (const el of allWrappers) {
             if (el.offsetParent !== null) { 
                 parent = el; 
                 break; 
             }
         }
    }

    if (!parent) return;

    // Check if we already have a container here
    const existing = parent.querySelector('.mdblist-rating-container');
    if (existing) {
        if (existing.dataset.tmdbId === id) return;
        existing.remove();
    }

    const container = document.createElement('div');
    container.className = 'mdblist-rating-container';
    container.dataset.tmdbId = id; 
    
    // KEY FIX: Just append to parent. 
    // This places it INSIDE the flex/block container, preventing it from breaking to a new line (unless the row is full).
    // And since 'updateEndsAt' now inserts Time BEFORE this container, the order will be correct.
    parent.appendChild(container);
    
    renderGearIcon(container, 'Loading...');
    fetchRatings(container, id, type, apiMode);
}

setInterval(scan, 500);

/* ==========================================================================
   4. SETTINGS MENU
========================================================================== */
function initMenu() {
    if(document.getElementById('mdbl-panel')) return;

    const css = `
    :root { --mdbl-right-col: 48px; }
    #mdbl-panel { position:fixed; right:16px; bottom:70px; width:500px; max-height:90vh; overflow:auto; border-radius:14px;
        border:1px solid rgba(255,255,255,0.15); background:rgba(22,22,26,0.94); backdrop-filter:blur(8px);
        color:#eaeaea; z-index:100000; box-shadow:0 20px 40px rgba(0,0,0,0.45); display:none; font-family: sans-serif; }
    #mdbl-panel header { position:sticky; top:0; background:rgba(22,22,26,0.98); padding:6px 12px; border-bottom:1px solid rgba(255,255,255,0.08);
        display:flex; align-items:center; gap:8px; cursor:move; z-index:999; backdrop-filter:blur(8px); font-weight: bold; justify-content: space-between; }
    #mdbl-close { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; color: #aaa; font-size: 18px; cursor: pointer; padding: 0; border-radius: 6px; }
    #mdbl-close:hover { background:rgba(255,255,255,0.06); color:#fff; }
    #mdbl-panel .mdbl-section { padding:2px 12px; gap:2px; display:flex; flex-direction:column; }
    #mdbl-panel .mdbl-subtle { color:#9aa0a6; font-size:12px; }
    #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source { display:grid; grid-template-columns:1fr var(--mdbl-right-col); align-items:center; gap:5px; padding:2px 6px; border-radius:6px; min-height: 32px; }
    #mdbl-panel .mdbl-row { background:transparent; border:1px solid rgba(255,255,255,0.06); box-sizing:border-box; }
    .mdbl-slider-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 4px 6px; border-radius: 6px; background: transparent; border: 1px solid rgba(255,255,255,0.06); min-height: 32px; }
    .mdbl-slider-row > span { white-space: nowrap; width: 110px; flex-shrink: 0; }
    .mdbl-slider-row .slider-wrapper { flex-grow: 1; display: flex; align-items: center; gap: 10px; justify-content: flex-end; width: 100%; }
    #mdbl-panel input[type="checkbox"] { transform: scale(1.2); cursor: pointer; accent-color: var(--mdbl-theme); }
    #mdbl-panel input[type="range"] { flex-grow: 1; width: 100%; margin: 0; cursor: pointer; accent-color: var(--mdbl-theme); }
    #mdbl-panel input[type="text"] { width:100%; padding:10px 0; border:0; background:transparent; color:#eaeaea; font-size:14px; outline:none; }
    #mdbl-panel select, #mdbl-panel input.mdbl-pos-input, #mdbl-panel input.mdbl-num-input { padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#121317; color:#eaeaea; height:28px; line-height: 28px; font-size: 12px; box-sizing:border-box; display:inline-block; color-scheme: dark; }
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
        #mdbl-panel { width: 96% !important; left: 2% !important; right: 2% !important; bottom: 10px !important; top: auto !important; transform: none !important; max-height: 80vh; --mdbl-right-col: 40px; }
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

function renderMenuContent(panel) {
    const row = (label, input) => `<div class="mdbl-row"><span>${label}</span>${input}</div>`;
    const sliderRow = (label, idRange, idNum, min, max, val) => `
    <div class="mdbl-slider-row">
        <span>${label}</span>
        <div class="slider-wrapper">
            <input type="range" id="${idRange}" min="${min}" max="${max}" value="${val}">
            <input type="number" id="${idNum}" value="${val}" class="mdbl-pos-input">
        </div>
    </div>`;
    
    let html = `
    <header><h3>Settings</h3><button id="mdbl-close">✕</button></header>
    <div class="mdbl-section" id="mdbl-sec-keys">
       ${(!INJ_KEYS.MDBLIST && !JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST) ? `<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value="${(JSON.parse(localStorage.getItem('mdbl_keys')||'{}').MDBLIST)||''}"></div>` : ''}
    </div>
    <div class="mdbl-section"><div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div><hr></div>
    <div class="mdbl-section" id="mdbl-sec-display">
        <div class="mdbl-subtle">Display</div>
        ${row('Color numbers', `<input type="checkbox" id="d_cnum" ${CFG.display.colorNumbers?'checked':''}>`)}
        ${row('Color icons', `<input type="checkbox" id="d_cicon" ${CFG.display.colorIcons?'checked':''}>`)}
        ${row('Show %', `<input type="checkbox" id="d_pct" ${CFG.display.showPercentSymbol?'checked':''}>`)}
        ${row('Enable 24h format', `<input type="checkbox" id="d_24h" ${CFG.display.endsAt24h?'checked':''}>`)}
        ${sliderRow('Position X (px)', 'd_x_rng', 'd_x_num', -700, 500, CFG.display.posX)}
        ${sliderRow('Position Y (px)', 'd_y_rng', 'd_y_num', -500, 500, CFG.display.posY)}
        <hr>
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
    <div class="mdbl-actions" style="padding-bottom:16px">
      <button id="mdbl-btn-reset">Reset</button>
      <button id="mdbl-btn-save" class="primary">Save & Apply</button>
    </div>`;
    
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
                <img src="${LOGO[k]||''}" style="height:16px">
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
        CFG.display.endsAt24h = panel.querySelector('#d_24h').checked; 
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
