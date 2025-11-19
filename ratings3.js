// ==UserScript==
// @name         Jellyfin Ratings (v10.1.0 — Stale DOM Protection)
// @namespace    https://mdblist.com
// @version      10.1.0
// @description  Fixes "wrong ratings" on navigation by waiting for DOM ID to change. fixes "not loading" via smart lock mechanism.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

console.log('[Jellyfin Ratings] v10.1.0 loading...');

/* ==========================================================================
   1. CONFIGURATION & CONSTANTS
========================================================================== */

const NS = 'mdbl_';
const API_KEY_DEFAULT = 'hehfnbo9y8blfyqm1d37ikubl'; // Fallback key

const DEFAULTS = {
    sources: { imdb:true, tmdb:true, trakt:true, letterboxd:true, rotten_tomatoes_critic:true, rotten_tomatoes_audience:true, metacritic_critic:true, metacritic_user:true, roger_ebert:true, anilist:true, myanimelist:true },
    display: { showPercentSymbol:true, colorNumbers:true, colorIcons:false, posX:0, posY:0, colorBands:{redMax:50,orangeMax:69,ygMax:79}, colorChoice:{red:0,orange:2,yg:3,mg:0}, compactLevel:0, endsAt24h:true },
    spacing: { ratingsTopGapPx: 4 },
    priorities: { imdb:1, tmdb:2, trakt:3, letterboxd:4, rotten_tomatoes_critic:5, rotten_tomatoes_audience:6, roger_ebert:7, metacritic_critic:8, metacritic_user:9, anilist:10, myanimelist:11 }
};

const SCALE = { imdb:10, tmdb:1, trakt:1, letterboxd:20, roger_ebert:25, metacritic_critic:1, metacritic_user:10, myanimelist:10, anilist:1, rotten_tomatoes_critic:1, rotten_tomatoes_audience:1 };
const SWATCHES = { red:['#e53935','#f44336','#d32f2f','#c62828'], orange:['#fb8c00','#f39c12','#ffa726','#ef6c00'], yg:['#9ccc65','#c0ca33','#aeea00','#cddc39'], mg:['#43a047','#66bb6a','#388e3c','#81c784'] };
const PALETTE_NAMES = { red:['Alert Red','Tomato','Crimson','Deep Red'], orange:['Amber','Signal Orange','Apricot','Burnt Orange'], yg:['Lime Leaf','Citrus','Chartreuse','Soft Lime'], mg:['Emerald','Leaf Green','Forest','Mint'] };
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = { imdb:`${ICON_BASE}/IMDb.png`, tmdb:`${ICON_BASE}/TMDB.png`, trakt:`${ICON_BASE}/Trakt.png`, letterboxd:`${ICON_BASE}/letterboxd.png`, anilist:`${ICON_BASE}/anilist.png`, myanimelist:`${ICON_BASE}/mal.png`, roger_ebert:`${ICON_BASE}/Roger_Ebert.png`, rotten_tomatoes_critic:`${ICON_BASE}/Rotten_Tomatoes.png`, rotten_tomatoes_audience:`${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`, metacritic_critic:`${ICON_BASE}/Metacritic.png`, metacritic_user:`${ICON_BASE}/mus2.png` };
const LABEL = { imdb:'IMDb', tmdb:'TMDb', trakt:'Trakt', letterboxd:'Letterboxd', rotten_tomatoes_critic:'RT Critic', rotten_tomatoes_audience:'RT Audience', metacritic_critic:'Metacritic', metacritic_user:'User Score', roger_ebert:'Roger Ebert', anilist:'AniList', myanimelist:'MAL' };

/* --- STATE --- */
let CFG = loadConfig();
let STATE = {
    lastUrl: location.href,
    lastTmdbId: null,      // Track the last seen ID to detect stale DOM
    navLock: false,        // Lock scanning while waiting for DOM update
    navLockTime: 0         // Timestamp when lock started
};
let currentImdbId = null;

/* --- HELPERS --- */
function loadConfig(){
    try {
        const p = JSON.parse(localStorage.getItem(`${NS}prefs`)) || {};
        return {
            sources: {...DEFAULTS.sources, ...p.sources},
            display: {...DEFAULTS.display, ...p.display, colorBands:{...DEFAULTS.display.colorBands,...p.display?.colorBands}, colorChoice:{...DEFAULTS.display.colorChoice,...p.display?.colorChoice}},
            spacing: {...DEFAULTS.spacing, ...p.spacing},
            priorities: {...DEFAULTS.priorities, ...p.priorities}
        };
    } catch(e){ return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function saveConfig(){ try{ localStorage.setItem(`${NS}prefs`, JSON.stringify(CFG)); }catch(e){} }

function getApiKey(){
    const inj = (window.MDBL_KEYS && window.MDBL_KEYS.MDBLIST);
    const ls = JSON.parse(localStorage.getItem(`${NS}keys`)||'{}').MDBLIST;
    return inj || ls || API_KEY_DEFAULT;
}

/* --- XHR POLYFILL --- */
if (typeof GM_xmlhttpRequest === 'undefined'){
    window.GM_xmlhttpRequest = ({ method='GET', url, onload }) => {
        fetch(url).then(r=>r.text().then(t=>onload({status:r.status, responseText:t}))).catch(console.error);
    };
}

/* --- STYLES --- */
const styleEl = document.createElement('style');
styleEl.id = 'mdbl-styles';
document.head.appendChild(styleEl);

function updateStyles(){
    const css = `
        .mdblist-rating-container {
            display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;
            width: 100%; margin-top: ${CFG.spacing.ratingsTopGapPx}px;
            transform: translate(${CFG.display.posX}px, ${CFG.display.posY}px);
            z-index: 9999; position: relative;
        }
        .mdbl-rating-item {
            display: inline-flex; align-items: center; margin: 0 6px; gap: 6px;
            text-decoration: none; transition: transform 0.2s; cursor: pointer; color: inherit;
        }
        .mdbl-rating-item:hover { transform: scale(1.15) rotate(2deg); z-index: 100; }
        .mdbl-rating-item img { height: 1.3em; vertical-align: middle; }
        .mdbl-rating-item span { font-size: 1em; vertical-align: middle; }
        #customEndsAt { opacity: 0.7; cursor: pointer; margin-left: 10px; display: inline; }
        #customEndsAt:hover { opacity: 1; text-decoration: underline; }
        #mdbl-settings-trigger { display: inline-flex; margin-left: 6px; opacity: 0.6; cursor: pointer; width: 1.1em; vertical-align: middle; }
        #mdbl-settings-trigger:hover { opacity: 1; }
        #mdbl-settings-trigger svg { fill: currentColor; }
        .itemMiscInfo { overflow: visible !important; }
    `;
    let vis = '';
    Object.keys(CFG.priorities).forEach(k => {
        vis += `.mdbl-rating-item[data-source="${k}"] { display: ${CFG.sources[k]?'inline-flex':'none'}; order: ${CFG.priorities[k]}; }\n`;
    });
    styleEl.textContent = css + vis;
}
updateStyles();

/* --- LOGIC --- */
function getRatingColor(val){
    const b = CFG.display.colorBands; const c = CFG.display.colorChoice;
    let k = 'mg';
    if(val <= b.redMax) k='red'; else if(val <= b.orangeMax) k='orange'; else if(val <= b.ygMax) k='yg';
    return SWATCHES[k][c[k]];
}

function fixUrl(url, type, ids) {
    if (!url || url === '#' || url.includes('localhost') || url.includes('192.168')) {
        if (type === 'imdb') return ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : '#';
        if (type === 'tmdb') return ids.tmdb ? `https://www.themoviedb.org/${ids.type}/${ids.tmdb}` : '#';
        if (type === 'trakt') return ids.imdb ? `https://trakt.tv/search/imdb/${ids.imdb}` : '#';
        if (type === 'letterboxd') return ids.imdb ? `https://letterboxd.com/imdb/${ids.imdb}/` : '#';
        if (type.includes('metacritic')) return ids.slug ? `https://www.metacritic.com/${ids.type==='show'?'tv':'movie'}/${ids.slug}` : '#';
        return '#';
    }
    if (url.startsWith('http')) return url;
    return 'https://' + url;
}

const localSlug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function render(container, data, type, tmdbId) {
    // Final check: Is the container still in DOM and valid?
    if(!document.body.contains(container)) return;
    
    // Stale Check: Does the current DOM still point to this ID?
    // If Jellyfin swapped the page while we fetched, abort.
    const currentLink = document.querySelector('a[href*="themoviedb.org/"]');
    if(currentLink) {
        const m = currentLink.href.match(/\/(movie|tv)\/(\d+)/);
        if(m && m[2] !== tmdbId) {
            console.log('[Jellyfin Ratings] Abort render: DOM ID mismatch (stale)');
            return;
        }
    }

    let html = '';
    const ids = { 
        imdb: data.imdbid||currentImdbId, 
        tmdb: tmdbId, 
        type: type,
        slug: localSlug(data.title)
    };
    
    (data.ratings||[]).forEach(r => {
        const s = (r.source||'').toLowerCase();
        const v = parseFloat(r.value);
        let key = null;
        let kind = 'Votes';
        
        if(s.includes('imdb')) key='imdb';
        else if(s.includes('tmdb')) key='tmdb';
        else if(s.includes('trakt')) key='trakt';
        else if(s.includes('letterboxd')) key='letterboxd';
        else if(s.includes('rotten') && s.includes('critic')) { key='rotten_tomatoes_critic'; kind='Reviews'; }
        else if(s.includes('audience') || s.includes('popcorn')) { key='rotten_tomatoes_audience'; kind='Ratings'; }
        else if(s.includes('metacritic') && s.includes('user')) { key='metacritic_user'; kind='Ratings'; }
        else if(s.includes('metacritic')) { key='metacritic_critic'; kind='Reviews'; }
        else if(s.includes('roger')) { key='roger_ebert'; kind='Reviews'; }
        else if(s.includes('anilist')) key='anilist';
        else if(s.includes('myanimelist')) key='myanimelist';

        if(key) {
            const finalScore = Math.round(v * (SCALE[key]||1));
            const url = fixUrl(r.url, key, ids);
            const col = getRatingColor(finalScore);
            
            const styleColor = CFG.display.colorNumbers ? `color:${col};` : '';
            const styleFilter = CFG.display.colorIcons ? `filter:drop-shadow(0 0 3px ${col});` : '';
            const text = CFG.display.showPercentSymbol ? `${finalScore}%` : finalScore;
            const tooltip = `${LABEL[key]} — ${r.votes||r.count||'?'} ${kind}`;
            
            // Prevent self-link if #
            const tag = (url === '#') ? 'div' : 'a';
            const href = (url === '#') ? '' : `href="${url}" target="_blank"`;
            const ptr = (url === '#') ? 'cursor:default' : '';

            html += `<${tag} ${href} class="mdbl-rating-item" data-source="${key}" style="${styleColor}${ptr}" title="${tooltip}">
                <img src="${LOGO[key]}" style="${styleFilter}">
                <span>${text}</span>
            </${tag}>`;
        }
    });
    container.innerHTML = html;
}

function fetchRatings(container, tmdbId, type){
    const url = `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${getApiKey()}`;
    const cKey = `${NS}c_${tmdbId}`;
    
    try {
        const cached = JSON.parse(localStorage.getItem(cKey));
        if(cached && Date.now() - cached.ts < 24*3600*1000) {
            render(container, cached.data, type, tmdbId);
            return;
        }
    } catch(e){}

    GM_xmlhttpRequest({
        method:'GET', url: url,
        onload: (res) => {
            if(res.status === 200) {
                try {
                    const d = JSON.parse(res.responseText);
                    localStorage.setItem(cKey, JSON.stringify({ts:Date.now(), data:d}));
                    render(container, d, type, tmdbId);
                } catch(e){}
            }
        }
    });
}

/* --- MAIN LOOP --- */
function loop(){
    // 1. Navigation Detection
    if(location.href !== STATE.lastUrl) {
        STATE.lastUrl = location.href;
        // Reset everything on navigation
        document.querySelectorAll('.mdblist-rating-container').forEach(e=>e.remove());
        currentImdbId = null;
        STATE.navLock = true; // Lock scanning
        STATE.navLockTime = Date.now();
    }

    // 2. Stale DOM Protection
    // If locked, wait until the TMDb ID on page CHANGES from what we last saw
    // OR if 2 seconds passed (timeout fallback)
    if (STATE.navLock) {
        const link = document.querySelector('a[href*="themoviedb.org/"]');
        if (link) {
            const m = link.href.match(/\/(movie|tv)\/(\d+)/);
            if (m) {
                const newId = m[2];
                if (newId !== STATE.lastTmdbId || (Date.now() - STATE.navLockTime > 2000)) {
                    // ID Changed or Timeout -> Safe to unlock
                    STATE.navLock = false;
                    STATE.lastTmdbId = newId;
                } else {
                    // ID matches old page -> Still stale DOM, wait
                    return; 
                }
            }
        } else if (Date.now() - STATE.navLockTime > 2000) {
            STATE.navLock = false; // Timeout even if no link found
        } else {
            return; // No link yet, wait
        }
    }

    // 3. Cleanup Native Elements
    document.querySelectorAll('.itemMiscInfo-secondary, .mediaInfoCriticRating, .mediaInfoAudienceRating, .starRatingContainer').forEach(el => {
        if(!el.closest('.mdblist-rating-container')) el.style.display = 'none';
    });
    
    // 4. Ends At
    const primary = document.querySelector('.itemMiscInfo.itemMiscInfo-primary');
    if(primary) {
        let mins = 0;
        const txt = primary.textContent;
        // Robust parser for "1 hr 30 min", "90 min", "1 Std 30 Min"
        let m = txt.match(/(?:(\d+)\s*(?:h|hr|std)\w*\s*)?(?:(\d+)\s*(?:m|min)\w*)?/i);
        if(m && (m[1]||m[2])) {
             let h = parseInt(m[1]||0);
             let mi = parseInt(m[2]||0);
             mins = h*60 + mi;
        } else {
            m = txt.match(/(\d+)\s*(?:m|min)\w*/i);
            if(m) mins = parseInt(m[1]);
        }
        
        if(mins > 0) {
            const d = new Date(Date.now() + mins*60000);
            const ts = d.toLocaleTimeString([], {hour: CFG.display.endsAt24h ? '2-digit' : 'numeric', minute:'2-digit', hour12: !CFG.display.endsAt24h});
            
            let span = document.getElementById('customEndsAt');
            if(!span) {
                span = document.createElement('div');
                span.id = 'customEndsAt';
                span.title = 'Settings';
                span.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openMenu(); };
                primary.appendChild(span);
            }
            span.textContent = `Ends at ${ts}`;
            
            let icon = document.getElementById('mdbl-settings-trigger');
            if(!icon) {
                icon = document.createElement('div');
                icon.id = 'mdbl-settings-trigger';
                icon.title = 'Settings';
                icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
                icon.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openMenu(); };
                primary.appendChild(icon);
            }
        }
    }

    // 5. Inject Ratings
    const imdbL = document.querySelector('a[href*="imdb.com/title/"]');
    if(imdbL) { const m = imdbL.href.match(/tt\d+/); if(m) currentImdbId = m[0]; }

    // Scan for TMDb links
    document.querySelectorAll('a[href*="themoviedb.org/"]').forEach(a => {
        const m = a.href.match(/\/(movie|tv)\/(\d+)/);
        if(m) {
            const type = m[1] === 'tv' ? 'show' : 'movie';
            const id = m[2];
            
            // Store last seen ID globally
            if (!STATE.navLock) STATE.lastTmdbId = id; 

            const wrapper = document.querySelector('.itemMiscInfo');
            if(wrapper) {
                // Check if specific container already exists
                const existing = wrapper.querySelector(`.mdblist-rating-container[data-id="${id}"]`);
                if (!existing) {
                    // Kill any other containers
                    wrapper.querySelectorAll('.mdblist-rating-container').forEach(e=>e.remove());
                    
                    const div = document.createElement('div');
                    div.className = 'mdblist-rating-container';
                    div.dataset.id = id;
                    wrapper.appendChild(div);
                    
                    fetchRatings(div, id, type);
                }
            }
        }
    });
}

// Robust interval
if(document.body) setInterval(loop, 1000);

/* ==========================================================================
   4. SETTINGS MENU
========================================================================== */
function openMenu(){
    if(document.getElementById('mdbl-panel')) return;
    
    // Theme Color
    const btn = document.querySelector('.button-submit, .btnPlay');
    const col = btn ? getComputedStyle(btn).backgroundColor : '#2a6df4';

    const css = `
      #mdbl-panel { position: fixed; right: 20px; bottom: 80px; width: 460px; background: rgba(20,20,20,0.96); color: #eee; border: 1px solid #444; border-radius: 12px; z-index: 999999; font-family: sans-serif; backdrop-filter: blur(10px); box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
      #mdbl-panel header { padding: 4px 16px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; cursor: move; font-weight: bold; height: 35px; background: rgba(255,255,255,0.03); }
      #mdbl-panel header h3 { margin: 0; font-size: 14px; font-weight: 700; }
      #mdbl-panel .content { padding: 16px; overflow-y: auto; max-height: 80vh; }
      .mdbl-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 14px; }
      .mdbl-row.wide input[type=range] { flex: 1; margin: 0 10px; accent-color: ${col}; }
      .mdbl-input { background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; text-align: center; width: 60px; }
      select.mdbl-input { width: 140px; text-align: left; }
      input[type=checkbox] { accent-color: ${col}; transform: scale(1.2); }
      button.mdbl-btn { background: #333; border: none; color: #fff; padding: 8px 16px; border-radius: 4px; cursor: pointer; flex: 1; margin: 0 4px; }
      button.mdbl-primary { background: ${col} !important; }
      .mdbl-swatch { display: inline-block; width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; margin-right: 8px; border: 1px solid #555; }
      hr { border: 0; border-top: 1px solid #333; margin: 16px 0; }
      #mdbl-close { width: 28px; height: 28px; background: transparent; border: none; color: #aaa; cursor: pointer; padding: 0; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
      #mdbl-close:hover { background: rgba(255,255,255,0.1); color: #fff; }
    `;
    const s = document.createElement('style'); s.innerHTML = css; document.head.appendChild(s);

    const p = document.createElement('div'); p.id = 'mdbl-panel';
    
    const row = (lbl, html) => `<div class="mdbl-row"><span>${lbl}</span><div>${html}</div></div>`;
    const paletteRow = (id, lbl, key) => `
        <div class="mdbl-row">
            <label>${lbl} ≤ <input type="number" id="th_${key}" value="${CFG.display.colorBands[key+'Max']}" class="mdbl-input"> %</label>
            <div>
                <span class="mdbl-swatch" id="sw_${key}" style="background:${SWATCHES[key][CFG.display.colorChoice[key]]}"></span>
                <select id="col_${key}" class="mdbl-input">${PALETTE_NAMES[key].map((n,i)=>`<option value="${i}" ${CFG.display.colorChoice[key]===i?'selected':''}>${n}</option>`).join('')}</select>
            </div>
        </div>`;

    p.innerHTML = `
      <header><h3>Settings</h3><button id="mdbl-close">✕</button></header>
      <div class="content">
        ${!getApiKey().includes('heh') ? '' : `<div style="margin-bottom:10px"><input id="mdbl-key" class="mdbl-input" style="width:100%" placeholder="API Key"></div>`}
        
        <div style="opacity:0.7; font-size:0.8em; margin-bottom:5px">SOURCES (Drag to reorder)</div>
        <div id="mdbl-src-list"></div>
        <hr>
        
        <div style="opacity:0.7; font-size:0.8em; margin-bottom:5px">DISPLAY</div>
        ${row('Color Numbers', `<input type="checkbox" id="chk_num" ${CFG.display.colorNumbers?'checked':''}>`)}
        ${row('Color Icons', `<input type="checkbox" id="chk_ico" ${CFG.display.colorIcons?'checked':''}>`)}
        ${row('Show %', `<input type="checkbox" id="chk_pct" ${CFG.display.showPercentSymbol?'checked':''}>`)}
        ${row('Enable 24h format', `<input type="checkbox" id="chk_24h" ${CFG.display.endsAt24h?'checked':''}>`)}
        
        <div class="mdbl-row wide"><span>Position X</span><input type="range" min="-1000" max="1000" id="rng_x" value="${CFG.display.posX}"><input type="number" class="mdbl-input" id="num_x" value="${CFG.display.posX}"></div>
        <div class="mdbl-row wide"><span>Position Y</span><input type="range" min="-1000" max="1000" id="rng_y" value="${CFG.display.posY}"><input type="number" class="mdbl-input" id="num_y" value="${CFG.display.posY}"></div>
        
        <hr>
        ${paletteRow('red', 'Rating', 'red')}
        ${paletteRow('orange', 'Rating', 'orange')}
        ${paletteRow('yg', 'Rating', 'yg')}
        <div class="mdbl-row"><label>Top Tier (≥ ${CFG.display.colorBands.ygMax+1}%)</label><div><span class="mdbl-swatch" id="sw_mg" style="background:${SWATCHES.mg[CFG.display.colorChoice.mg]}"></span><select id="col_mg" class="mdbl-input">${PALETTE_NAMES.mg.map((n,i)=>`<option value="${i}" ${CFG.display.colorChoice.mg===i?'selected':''}>${n}</option>`).join('')}</select></div></div>
        
        <hr>
        <div style="display:flex">
            <button id="btn-reset" class="mdbl-btn">Reset</button>
            <button id="btn-save" class="mdbl-btn mdbl-primary">Save & Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(p);
    
    // Sources
    const list = p.querySelector('#mdbl-src-list');
    Object.keys(CFG.priorities).sort((a,b)=>CFG.priorities[a]-CFG.priorities[b]).forEach(k=>{
        const row = document.createElement('div');
        row.className = 'mdbl-row mdbl-drag';
        row.draggable = true;
        row.dataset.k = k;
        row.style.cursor = 'grab';
        row.innerHTML = `<span>⋮⋮ ${LABEL[k]}</span><input type="checkbox" ${CFG.sources[k]?'checked':''}>`;
        row.querySelector('input').onchange = (e) => { CFG.sources[k] = e.target.checked; updateStyles(); };
        
        row.ondragstart = e => { dragSrc = row; e.dataTransfer.effectAllowed='move'; row.style.opacity = '0.5'; };
        row.ondragend = () => row.style.opacity = '1';
        row.ondragover = e => { e.preventDefault(); };
        row.ondrop = e => {
            e.preventDefault();
            if(dragSrc !== row) {
                list.insertBefore(dragSrc, row);
                [...list.children].forEach((c,i) => CFG.priorities[c.dataset.k] = i+1);
                updateStyles();
            }
        };
        list.appendChild(row);
    });

    // Bindings
    const on = (id, fn) => document.getElementById(id).addEventListener('input', fn);
    
    on('chk_num', e => { CFG.display.colorNumbers = e.target.checked; updateStyles(); }); // Simplified
    on('chk_ico', e => { CFG.display.colorIcons = e.target.checked; updateStyles(); });
    on('chk_pct', e => { CFG.display.showPercentSymbol = e.target.checked; updateStyles(); });
    on('chk_24h', e => { CFG.display.endsAt24h = e.target.checked; loop(); }); // Re-run loop

    const updPos = (a, v) => { CFG.display[a] = parseInt(v); document.getElementById(`rng_${a === 'posX' ? 'x':'y'}`).value = v; document.getElementById(`num_${a === 'posX' ? 'x':'y'}`).value = v; updateStyles(); };
    on('rng_x', e => updPos('posX', e.target.value)); on('num_x', e => updPos('posX', e.target.value));
    on('rng_y', e => updPos('posY', e.target.value)); on('num_y', e => updPos('posY', e.target.value));

    // Color logic - Rebuild styles to refresh colors
    const updCol = () => {
        CFG.display.colorBands.redMax = parseInt(document.getElementById('th_red').value);
        CFG.display.colorBands.orangeMax = parseInt(document.getElementById('th_orange').value);
        CFG.display.colorBands.ygMax = parseInt(document.getElementById('th_yg').value);
        ['red','orange','yg','mg'].forEach(k => {
             const idx = document.getElementById(`col_${k}`).value;
             CFG.display.colorChoice[k] = idx;
             document.getElementById(`sw_${k}`).style.background = SWATCHES[k][idx];
        });
        // Force re-render to apply colors (simpler than updating existing DOM in this loop)
        document.querySelectorAll('.mdblist-rating-container').forEach(e=>e.remove());
        loop(); 
    };
    p.querySelectorAll('select, input[type=number]').forEach(el => el.addEventListener('input', updCol));

    // Close/Save
    document.getElementById('mdbl-close').onclick = () => p.remove();
    document.getElementById('btn-save').onclick = () => {
        saveConfig();
        const k = document.getElementById('mdbl-key');
        if(k && k.value) localStorage.setItem(`${NS}keys`, JSON.stringify({MDBLIST: k.value.trim()}));
        location.reload();
    };
    document.getElementById('btn-reset').onclick = () => {
        if(confirm('Reset?')) { localStorage.removeItem(`${NS}prefs`); location.reload(); }
    };

    // Header drag
    let isDown = false, offX, offY;
    const hdr = p.querySelector('header');
    hdr.onmousedown = e => { isDown = true; offX = e.clientX - p.offsetLeft; offY = e.clientY - p.offsetTop; };
    document.onmouseup = () => isDown = false;
    document.onmousemove = e => {
        if(isDown) {
            p.style.left = (e.clientX - offX) + 'px';
            p.style.top = (e.clientY - offY) + 'px';
            p.style.bottom = 'auto'; p.style.right = 'auto';
        }
    };
}
