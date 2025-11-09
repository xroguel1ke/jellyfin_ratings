console.info('[Jellyfin Ratings] menu.js loaded');

// Jellyfin Ratings — Settings Menu (lazy-loaded)

/* Reuse globals from core */
(function(){
  const NS='mdbl_';

  /* small helpers */
  const deepClone=o=>JSON.parse(JSON.stringify(o));
  const loadPrefs=()=>{ try{ return JSON.parse(localStorage.getItem(`${NS}prefs`)||'{}'); }catch{ return {}; } };
  const savePrefs=p=>{ try{ localStorage.setItem(`${NS}prefs`, JSON.stringify(p||{})); }catch{} };

  /* panel CSS (same look as before) */
  const css=`
  :root { --mdbl-right-col:48px; --mdbl-right-col-wide:200px; }
  #mdbl-panel{position:fixed;right:16px;bottom:70px;width:480px;max-height:88vh;overflow:auto;border-radius:14px;
    border:1px solid rgba(255,255,255,0.15);background:rgba(22,22,26,0.94);backdrop-filter:blur(8px);
    color:#eaeaea;z-index:99999;box-shadow:0 20px 40px rgba(0,0,0,0.45);display:none}
  #mdbl-panel header{position:sticky;top:0;background:rgba(22,22,26,0.96);padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08);
    display:flex;align-items:center;gap:8px;cursor:move}
  #mdbl-panel header h3{margin:0;font-size:15px;font-weight:700;flex:1}
  #mdbl-close{border:none;background:transparent;color:#aaa;font-size:18px;cursor:pointer;padding:4px;border-radius:8px}
  #mdbl-close:hover{background:rgba(255,255,255,0.06);color:#fff}
  #mdbl-panel .mdbl-section{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  #mdbl-panel .mdbl-subtle{color:#9aa0a6;font-size:12px}
  #mdbl-panel .mdbl-row, #mdbl-panel .mdbl-source{
    display:grid;grid-template-columns:1fr var(--mdbl-right-col);
    align-items:center;gap:10px;padding:8px 10px;border-radius:12px
  }
  #mdbl-panel .mdbl-row{background:transparent;border:1px solid rgba(255,255,255,0.06)}
  #mdbl-panel .mdbl-row.wide{grid-template-columns:1fr var(--mdbl-right-col-wide)}
  #mdbl-panel input[type="checkbox"]{transform:scale(1.1);justify-self:end}
  #mdbl-panel input[type="text"]{width:100%;padding:10px 0;border:0;background:transparent;color:#eaeaea;font-size:14px;outline:none}
  #mdbl-panel select{padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#121317;color:#eaeaea;justify-self:end}
  #mdbl-panel .mdbl-select{width:200px}
  #mdbl-panel .mdbl-actions{position:sticky;bottom:0;background:rgba(22,22,26,0.96);display:flex;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08)}
  #mdbl-panel button{padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#1b1c20;color:#eaeaea;cursor:pointer}
  #mdbl-panel button.primary{background:#2a6df4;border-color:#2a6df4;color:#fff}
  #mdbl-sources{display:flex;flex-direction:column;gap:8px}
  .mdbl-source{background:#0f1115;border:1px solid rgba(255,255,255,0.1)}
  .mdbl-src-left{display:flex;align-items:center;gap:10px}
  .mdbl-src-left img{height:18px;width:auto}
  .mdbl-src-left .name{font-size:13px}
  .mdbl-drag-handle{justify-self:start;opacity:0.6;cursor:grab}
  #mdbl-key-box{background:#0f1115;border:1px solid rgba(255,255,255,0.1);padding:10px;border-radius:12px}
  `;
  if (!document.getElementById('mdbl-settings-css')){
    const style=document.createElement('style'); style.id='mdbl-settings-css'; style.textContent=css; document.head.appendChild(style);
  }

  const ICON_BASE='https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
  const LOGO={ imdb:`${ICON_BASE}/IMDb.png`, tmdb:`${ICON_BASE}/TMDB.png`, trakt:`${ICON_BASE}/Trakt.png`, letterboxd:`${ICON_BASE}/letterboxd.png`,
               anilist:`${ICON_BASE}/anilist.png`, myanimelist:`${ICON_BASE}/mal.png`, roger:`${ICON_BASE}/Roger_Ebert.png`,
               tomatoes:`${ICON_BASE}/Rotten_Tomatoes.png`, audience:`${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
               metacritic:`${ICON_BASE}/Metacritic.png`, metacritic_user:`${ICON_BASE}/mus2.png` };

  const LABEL={ imdb:'IMDb', tmdb:'TMDb', trakt:'Trakt', letterboxd:'Letterboxd',
    rotten_tomatoes_critic:'Rotten Tomatoes (Critic)', rotten_tomatoes_audience:'Rotten Tomatoes (Audience)',
    metacritic_critic:'Metacritic (Critic)', metacritic_user:'Metacritic (User)',
    roger_ebert:'Roger Ebert', anilist:'AniList', myanimelist:'MyAnimeList' };

  const panel=document.createElement('div'); panel.id='mdbl-panel';
  panel.innerHTML=`
    <header id="mdbl-drag-handle"><h3>Jellyfin Ratings — Settings</h3><button id="mdbl-close" aria-label="Close">✕</button></header>
    <div class="mdbl-section" id="mdbl-sec-keys"></div>
    <div class="mdbl-section" id="mdbl-sec-sources"></div>
    <div class="mdbl-section" id="mdbl-sec-display"></div>
    <div class="mdbl-actions"><button id="mdbl-btn-reset">Reset</button><button id="mdbl-btn-save" class="primary">Save & Apply</button></div>
  `;
  document.body.appendChild(panel);

  const ENABLE_SOURCES = window.ENABLE_SOURCES;
  const DISPLAY        = window.DISPLAY;
  const RATING_PRIORITY= window.RATING_PRIORITY;

  function getInjectorKey(){ try{ return (window.MDBL_KEYS&&window.MDBL_KEYS.MDBLIST)?String(window.MDBL_KEYS.MDBLIST):''; }catch{ return ''; } }
  function getStoredKeys(){ try{ return JSON.parse(localStorage.getItem(`${NS}keys`)||'{}'); }catch{ return {}; } }
  function setStoredKey(newKey){
    const obj=Object.assign({},getStoredKeys(),{MDBLIST:newKey||''});
    try{ localStorage.setItem(`${NS}keys`, JSON.stringify(obj)); }catch{}
    if(!getInjectorKey()){ if(!window.MDBL_KEYS||typeof window.MDBL_KEYS!=='object') window.MDBL_KEYS={}; window.MDBL_KEYS.MDBLIST=newKey||''; }
    if(window.MDBL_STATUS&&window.MDBL_STATUS.keys){ window.MDBL_STATUS.keys.MDBLIST=!!(getInjectorKey()||newKey); }
  }

  const DEFAULTS={ sources:JSON.parse(JSON.stringify(ENABLE_SOURCES)),
                   display:JSON.parse(JSON.stringify(DISPLAY)),
                   priorities:JSON.parse(JSON.stringify(RATING_PRIORITY)) };

  /* drag helpers */
  function enableDnD(container){
    let dragging=null;
    container.addEventListener('dragstart',e=>{
      const t=e.target.closest('.mdbl-source'); if(!t) return; dragging=t; t.style.opacity='0.6'; e.dataTransfer.effectAllowed='move';
    });
    container.addEventListener('dragover',e=>{
      if(!dragging) return; e.preventDefault();
      const after=getAfter(container,e.clientY);
      (after==null)?container.appendChild(dragging):container.insertBefore(dragging,after);
    });
    ['drop','dragend'].forEach(evt=>container.addEventListener(evt,()=>{ if(dragging) dragging.style.opacity=''; dragging=null; }));
    function getAfter(container,y){
      const els=[...container.querySelectorAll('.mdbl-source:not([style*="opacity: 0.6"])')];
      return els.reduce((c,ch)=>{ const box=ch.getBoundingClientRect(), off=y-box.top-box.height/2; return (off<0&&off>c.offset)?{offset:off,element:ch}:c; }, {offset:-1e9}).element;
    }
  }

  function orderFromPriorities(){
    return Object.keys(RATING_PRIORITY).filter(k=>k in ENABLE_SOURCES)
      .sort((a,b)=>(RATING_PRIORITY[a]??999)-(RATING_PRIORITY[b]??999))
      .map(k=>({k, icon:LOGO[k]||'', label:LABEL[k]||k.replace(/_/g,' ')}));
  }
  function makeSourceRow(item){
    const key=item.k, checked=!!ENABLE_SOURCES[key];
    const row=document.createElement('div'); row.className='mdbl-source'; row.dataset.k=key; row.draggable=true;
    row.innerHTML=`
      <div class="mdbl-src-left">
        <span class="mdbl-drag-handle" title="Drag to reorder">⋮⋮</span>
        ${item.icon?`<img src="${item.icon}" alt="">`:''}
        <span class="name">${item.label}</span>
      </div>
      <input type="checkbox" ${checked?'checked':''} data-toggle="${key}">
    `;
    return row;
  }

  function render(){
    /* Key box */
    const kWrap=panel.querySelector('#mdbl-sec-keys');
    const injKey=getInjectorKey(); const stored=getStoredKeys().MDBLIST||'';
    const value=injKey?injKey:(stored||''); const readonly=injKey?'readonly':'';
    kWrap.innerHTML=`<div id="mdbl-key-box" class="mdbl-source"><input type="text" id="mdbl-key-mdb" ${readonly} placeholder="MDBList API key" value="${value}"></div>`;

    /* Sources */
    const sWrap=panel.querySelector('#mdbl-sec-sources');
    sWrap.innerHTML=`<div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div>`;
    const sList=sWrap.querySelector('#mdbl-sources');
    orderFromPriorities().forEach(item=>sList.appendChild(makeSourceRow(item)));
    enableDnD(sList);

    /* Display */
    const dWrap=panel.querySelector('#mdbl-sec-display');
    dWrap.innerHTML=`
      <div class="mdbl-subtle">Display</div>
      <div class="mdbl-row"><span>Colorize ratings</span><input type="checkbox" id="d_colorize" ${DISPLAY.colorizeRatings?'checked':''}></div>
      <div class="mdbl-row"><span>Color numbers</span><input type="checkbox" id="d_colorNumbers" ${DISPLAY.colorNumbers?'checked':''}></div>
      <div class="mdbl-row"><span>Color icons</span><input type="checkbox" id="d_colorIcons" ${DISPLAY.colorIcons?'checked':''}></div>
      <div class="mdbl-row"><span>Show %</span><input type="checkbox" id="d_showPercent" ${DISPLAY.showPercentSymbol?'checked':''}></div>
      <div class="mdbl-row"><span>Show bullet before “Ends at”</span><input type="checkbox" id="d_endsBullet" ${DISPLAY.endsAtBullet?'checked':''}></div>
      <div class="mdbl-row wide"><span>Align</span>
        <select id="d_align" class="mdbl-select">
          <option value="left" ${DISPLAY.align==='left'?'selected':''}>left</option>
          <option value="center" ${DISPLAY.align==='center'?'selected':''}>center</option>
          <option value="right" ${DISPLAY.align==='right'?'selected':''}>right</option>
        </select>
      </div>
      <div class="mdbl-row wide"><span>Ends at format</span>
        <select id="d_endsFmt" class="mdbl-select">
          <option value="24h" ${DISPLAY.endsAtFormat==='24h'?'selected':''}>24h</option>
          <option value="12h" ${DISPLAY.endsAtFormat==='12h'?'selected':''}>12h</option>
        </select>
      </div>
    `;
  }

  function show(){ panel.style.display='block'; }
  function hide(){ panel.style.display='none'; }

  // draggable header
  (function makePanelDraggable(){
    const header=panel.querySelector('#mdbl-drag-handle'); let drag=false,sx=0,sy=0,sl=0,st=0;
    header.addEventListener('mousedown', e=>{
      if(e.target.id==='mdbl-close') return;
      drag=true; const rect=panel.getBoundingClientRect();
      panel.style.left=rect.left+'px'; panel.style.top=rect.top+'px'; panel.style.right='auto'; panel.style.bottom='auto';
      sx=e.clientX; sy=e.clientY; sl=rect.left; st=rect.top;
      const move=e2=>{ if(!drag) return; panel.style.left=Math.max(0, sl+(e2.clientX-sx))+'px'; panel.style.top=Math.max(0, st+(e2.clientY-sy))+'px'; };
      const up=()=>{ drag=false; document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
      document.addEventListener('mousemove',move); document.addEventListener('mouseup',up); e.preventDefault();
    });
  })();

  // outside click closes
  document.addEventListener('mousedown', e=>{ if(panel.style.display!=='block') return; if(!panel.contains(e.target)) hide(); });
  panel.addEventListener('click', e=>{ if(e.target.id==='mdbl-close') hide(); });

  // buttons
  panel.querySelector('#mdbl-btn-reset').addEventListener('click', ()=>{
    Object.assign(ENABLE_SOURCES, deepClone(DEFAULTS.sources));
    Object.assign(DISPLAY,        deepClone(DEFAULTS.display));
    Object.assign(RATING_PRIORITY,deepClone(DEFAULTS.priorities));
    savePrefs({});
    render();
    if(window.MDBL_API?.refresh) window.MDBL_API.refresh();
  });
  panel.querySelector('#mdbl-btn-save').addEventListener('click', ()=>{
    const prefs={sources:{},display:{},priorities:{}};
    [...panel.querySelectorAll('#mdbl-sources .mdbl-source')].forEach((el,i)=>{ prefs.priorities[el.dataset.k]=i+1; });
    panel.querySelectorAll('#mdbl-sources input[type="checkbox"][data-toggle]').forEach(cb=>{ prefs.sources[cb.dataset.toggle]=cb.checked; });
    prefs.display.colorizeRatings   = panel.querySelector('#d_colorize').checked;
    prefs.display.colorNumbers      = panel.querySelector('#d_colorNumbers').checked;
    prefs.display.colorIcons        = panel.querySelector('#d_colorIcons').checked;
    prefs.display.showPercentSymbol = panel.querySelector('#d_showPercent').checked;
    prefs.display.endsAtBullet      = panel.querySelector('#d_endsBullet').checked;
    prefs.display.align             = panel.querySelector('#d_align').value;
    prefs.display.endsAtFormat      = panel.querySelector('#d_endsFmt').value;

    savePrefs(prefs);
    // apply in-place
    Object.assign(ENABLE_SOURCES, prefs.sources);
    Object.assign(DISPLAY,        prefs.display);
    Object.assign(RATING_PRIORITY,prefs.priorities);

    const injKey = (window.MDBL_KEYS&&window.MDBL_KEYS.MDBLIST) ? String(window.MDBL_KEYS.MDBLIST) : '';
    const keyInput=panel.querySelector('#mdbl-key-mdb');
    if(keyInput && !injKey) setStoredKey((keyInput.value||'').trim());

    if(window.MDBL_API?.refresh) window.MDBL_API.refresh();
    location.reload();
  });

  // expose for core
  window.__MDBL_showMenu = function(){ render(); show(); };

})();
