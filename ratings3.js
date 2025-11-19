// ==UserScript==
// @name         Jellyfin Ratings (v10.0.0 — Stable Reset)
// @namespace    https://mdblist.com
// @version      10.0.0
// @description  Complete rewrite based on stable v8.4 core. Fixes loading issues, links, and menu layout.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

console.log('[Jellyfin Ratings] v10.0.0 starting...');

/* --- CONFIG --- */
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
let lastUrl = location.href;
let currentImdbId = null;

/* --- HELPERS --- */
function loadConfig(){
    try {
        const p = JSON.parse(localStorage.getItem(`${NS}prefs`)) || {};
        // Merge defaults
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
        .itemMiscInfo { overflow: visible !important; }
    `;
    // Add visibility rules
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
    if (!url || url === '#') {
        // Fallbacks
        if (type === 'imdb') return ids.imdb ? `https://www.imdb.com/title/${ids.imdb}/` : '#';
        if (type === 'tmdb') return ids.tmdb ? `https://www.themoviedb.org/${ids.type}/${ids.tmdb}` : '#';
        if (type === 'trakt') return ids.imdb ? `https://trakt.tv/search/imdb/${ids.imdb}` : '#';
        if (type === 'letterboxd') return ids.imdb ? `https://letterboxd.com/imdb/${ids.imdb}/` : '#';
        return '#';
    }
    if (url.startsWith('http')) return url;
    return 'https://' + url; // Simple fix for relative urls
}

function render(container, data, type, tmdbId) {
    let html = '';
    const ids = { imdb: data.imdbid||currentImdbId, tmdb: tmdbId, type: type };
    
    (data.ratings||[]).forEach(r => {
        const s = (r.source||'').toLowerCase();
        const v = parseFloat(r.value);
        let key = null;
        
        if(s.includes('imdb')) key='imdb';
        else if(s.includes('tmdb')) key='tmdb';
        else if(s.includes('trakt')) key='trakt';
        else if(s.includes('letterboxd')) key='letterboxd';
        else if(s.includes('rotten') && s.includes('critic')) key='rotten_tomatoes_critic';
        else if(s.includes('audience') || s.includes('popcorn')) key='rotten_tomatoes_audience';
        else if(s.includes('metacritic') && s.includes('user')) key='metacritic_user';
        else if(s.includes('metacritic')) key='metacritic_critic';
        else if(s.includes('roger')) key='roger_ebert';
        else if(s.includes('anilist')) key='anilist';
        else if(s.includes('myanimelist')) key='myanimelist';

        if(key) {
            const finalScore = Math.round(v * (SCALE[key]||1));
            const url = fixUrl(r.url, key, ids);
            const col = getRatingColor(finalScore);
            
            // Build styles
            const styleColor = CFG.display.colorNumbers ? `color:${col};` : '';
            const styleFilter = CFG.display.colorIcons ? `filter:drop-shadow(0 0 3px ${col});` : '';
            const text = CFG.display.showPercentSymbol ? `${finalScore}%` : finalScore;
            
            html += `<a href="${url}" target="_blank" class="mdbl-rating-item" data-source="${key}" style="${styleColor}">
                <img src="${LOGO[key]}" style="${styleFilter}">
                <span>${text}</span>
            </a>`;
        }
    });
    container.innerHTML = html;
}

function fetchRatings(container, tmdbId, type){
    const url = `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${getApiKey()}`;
    
    // Cache check
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
    // 1. Nav Check
    if(location.href !== lastUrl) {
        lastUrl = location.href;
        document.querySelectorAll('.mdblist-rating-container').forEach(e=>e.remove());
        currentImdbId = null;
    }

    // 2. Clean Native
    document.querySelectorAll('.itemMiscInfo-secondary, .mediaInfoCriticRating, .mediaInfoAudienceRating, .starRatingContainer').forEach(el => {
        if(!el.closest('.mdblist-rating-container')) el.style.display = 'none';
    });
    
    // 3. Ends At
    const primary = document.querySelector('.itemMiscInfo.itemMiscInfo-primary');
    if(primary) {
        // Try to get Runtime
        let mins = 0;
        const txt = primary.textContent;
        const m = txt.match(/(\d+)\s*(?:h|std|min|m)/i); // Simple detection
        if(m) {
            // Better parsing needed usually, but kept simple for stability. 
            // Assuming if we find a number it might be runtime if not year
            // Re-using robust logic from v8.x inside this block if needed
             let h=0, mi=0;
             let m1 = txt.match(/(\d+)\s*(?:h|std)/i);
             let m2 = txt.match(/(\d+)\s*(?:m|min)/i);
             if(m1) h = parseInt(m1[1]);
             if(m2) mi = parseInt(m2[1]);
             mins = h*60 + mi;
        }
        
        if(mins > 0) {
            const d = new Date(Date.now() + mins*60000);
            const ts = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: !CFG.display.endsAt24h});
            
            let span = document.getElementById('customEndsAt');
            if(!span) {
                span = document.createElement('div');
                span.id = 'customEndsAt';
                span.title = 'Settings';
                span.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openMenu(); };
                primary.appendChild(span);
            }
            span.textContent = `Ends at ${ts}`;
        }
    }

    // 4. Inject Ratings
    const imdbL = document.querySelector('a[href*="imdb.com/title/"]');
    if(imdbL) { const m = imdbL.href.match(/tt\d+/); if(m) currentImdbId = m[0]; }

    document.querySelectorAll('a[href*="themoviedb.org/"]').forEach(a => {
        if(a.dataset.mdblDone === location.href) return; // Check against current URL to handle nav

        const m = a.href.match(/\/(movie|tv)\/(\d+)/);
        if(m) {
            const type = m[1] === 'tv' ? 'show' : 'movie';
            const id = m[2];
            
            const wrapper = document.querySelector('.itemMiscInfo');
            if(wrapper && !wrapper.querySelector(`.mdblist-rating-container[data-id="${id}"]`)) {
                // Remove old
                wrapper.querySelectorAll('.mdblist-rating-container').forEach(e=>e.remove());
                
                const div = document.createElement('div');
                div.className = 'mdblist-rating-container';
                div.dataset.id = id;
                wrapper.appendChild(div);
                
                fetchRatings(div, id, type);
                a.dataset.mdblDone = location.href;
            }
        }
    });
}

setInterval(loop, 1000);

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
      #mdbl-panel header { padding: 8px 16px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; cursor: move; font-weight: bold; height: 30px; background: rgba(255,255,255,0.03); }
      #mdbl-panel .content { padding: 16px; overflow-y: auto; max-height: 80vh; }
      .mdbl-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 14px; }
      .mdbl-row.wide input[type=range] { flex: 1; margin: 0 10px; accent-color: ${col}; }
      .mdbl-input { background: #111; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 4px; text-align: center; width: 60px; }
      select.mdbl-input { width: 140px; text-align: left; }
      input[type=checkbox] { accent-color: ${col}; transform: scale(1.2); }
      button.mdbl-btn { background: #333; border: none; color: #fff; padding: 8px 16px; border-radius: 4px; cursor: pointer; flex: 1; margin: 0 4px; }
      button.mdbl-primary { background: ${col}; }
      .mdbl-swatch { display: inline-block; width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; margin-right: 8px; border: 1px solid #555; }
      hr { border: 0; border-top: 1px solid #333; margin: 16px 0; }
    `;
    const s = document.createElement('style'); s.innerHTML = css; document.head.appendChild(s);

    const p = document.createElement('div'); p.id = 'mdbl-panel';
    
    // Helper for HTML
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
      <header>Settings <button id="mdbl-close" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;width:30px;height:30px">✕</button></header>
      <div class="content">
        ${!getApiKey().includes('heh') ? '' : `<div style="margin-bottom:10px"><input id="mdbl-key" class="mdbl-input" style="width:100%" placeholder="API Key"></div>`}
        
        <div style="opacity:0.7; font-size:0.8em; margin-bottom:5px">SOURCES (Drag to reorder)</div>
        <div id="mdbl-src-list"></div>
        <hr>
        
        <div style="opacity:0.7; font-size:0.8em; margin-bottom:5px">DISPLAY</div>
        ${row('Color Numbers', `<input type="checkbox" id="chk_num" ${CFG.display.colorNumbers?'checked':''}>`)}
        ${row('Color Icons', `<input type="checkbox" id="chk_ico" ${CFG.display.colorIcons?'checked':''}>`)}
        ${row('Show %', `<input type="checkbox" id="chk_pct" ${CFG.display.showPercentSymbol?'checked':''}>`)}
        ${row('24h Time', `<input type="checkbox" id="chk_24h" ${CFG.display.endsAt24h?'checked':''}>`)}
        
        <div class="mdbl-row wide"><span>X</span><input type="range" min="-1000" max="1000" id="rng_x" value="${CFG.display.posX}"><input type="number" class="mdbl-input" id="num_x" value="${CFG.display.posX}"></div>
        <div class="mdbl-row wide"><span>Y</span><input type="range" min="-1000" max="1000" id="rng_y" value="${CFG.display.posY}"><input type="number" class="mdbl-input" id="num_y" value="${CFG.display.posY}"></div>
        
        <hr>
        ${paletteRow('red', 'Rating', 'red')}
        ${paletteRow('orange', 'Rating', 'orange')}
        ${paletteRow('yg', 'Rating', 'yg')}
        <div class="mdbl-row"><label>Top Tier (≥ ${CFG.display.colorBands.ygMax+1}%)</label><div><span class="mdbl-swatch" id="sw_mg" style="background:${SWATCHES.mg[CFG.display.colorChoice.mg]}"></span><select id="col_mg" class="mdbl-input">${PALETTE_NAMES.mg.map((n,i)=>`<option value="${i}" ${CFG.display.colorChoice.mg===i?'selected':''}>${n}</option>`).join('')}</select></div></div>
        
        <hr>
        <div style="display:flex">
            <button id="btn-reset" class="mdbl-btn">Reset</button>
            <button id="btn-save" class="mdbl-btn mdbl-primary">Save</button>
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
        
        // Drag events
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
    
    on('chk_num', e => { CFG.display.colorNumbers = e.target.checked; refreshDomElements(); });
    on('chk_ico', e => { CFG.display.colorIcons = e.target.checked; refreshDomElements(); });
    on('chk_pct', e => { CFG.display.showPercentSymbol = e.target.checked; refreshDomElements(); });
    on('chk_24h', e => { CFG.display.endsAt24h = e.target.checked; updateEndsAt(); });

    const updPos = (a, v) => { CFG.display[a] = parseInt(v); document.getElementById(`rng_${a === 'posX' ? 'x':'y'}`).value = v; document.getElementById(`num_${a === 'posX' ? 'x':'y'}`).value = v; updateStyles(); };
    on('rng_x', e => updPos('posX', e.target.value)); on('num_x', e => updPos('posX', e.target.value));
    on('rng_y', e => updPos('posY', e.target.value)); on('num_y', e => updPos('posY', e.target.value));

    // Color logic
    const updCol = () => {
        CFG.display.colorBands.redMax = parseInt(document.getElementById('th_red').value);
        CFG.display.colorBands.orangeMax = parseInt(document.getElementById('th_orange').value);
        CFG.display.colorBands.ygMax = parseInt(document.getElementById('th_yg').value);
        ['red','orange','yg','mg'].forEach(k => {
             const idx = document.getElementById(`col_${k}`).value;
             CFG.display.colorChoice[k] = idx;
             document.getElementById(`sw_${k}`).style.background = SWATCHES[k][idx];
        });
        refreshDomElements();
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
