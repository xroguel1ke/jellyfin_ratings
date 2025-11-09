// ==UserScript==
// @name         Jellyfin Ratings (v6.3.4 — SPA wait + DE runtime + robust badge)
// @namespace    https://mdblist.com
// @version      6.3.4
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). Normalized 0–100; inline “Ends at …” (12h/24h + bullet toggle); parental rating cloned to start; SPA-safe waiting; single MutationObserver; namespaced caches.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

/* ================== DEFAULT CONFIG (overridable via window.MDBL_CFG) ================== */
const DEFAULT_ENABLE_SOURCES = {
  imdb:true, tmdb:true, trakt:true, letterboxd:true, rotten_tomatoes:true, roger_ebert:true,
  anilist:true, myanimelist:true, metacritic_critic:true, metacritic_user:true
};
const DEFAULT_DISPLAY = {
  showPercentSymbol:true, colorizeRatings:true, colorizeNumbersOnly:true,
  align:'left', endsAtFormat:'24h', endsAtBullet:true
};
const DEFAULT_SPACING = { ratingsTopGapPx:8 };
const DEFAULT_PRIORITIES = {
  imdb:1, tmdb:2, trakt:3, letterboxd:4,
  rotten_tomatoes_critic:5, rotten_tomatoes_audience:6,
  roger_ebert:7, metacritic_critic:8, metacritic_user:9,
  anilist:10, myanimelist:11
};
const SCALE_MULTIPLIER = {
  imdb:10, tmdb:1, trakt:1, letterboxd:20, roger_ebert:25,
  metacritic_critic:1, metacritic_user:10, myanimelist:10, anilist:1,
  rotten_tomatoes_critic:1, rotten_tomatoes_audience:1
};
const COLOR_THRESHOLDS = { green:75, orange:50, red:0 };
const COLOR_VALUES     = { green:'limegreen', orange:'orange', red:'crimson' };

const MDBLIST_API_KEY = 'hehfnbo9y8blfyqm1d37ikubl';
const CACHE_DURATION  = 7*24*60*60*1000;
const NS              = 'mdbl_';

/* === your own icons in your repo === */
const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
  imdb:`${ICON_BASE}/IMDb.png`,
  tmdb:`${ICON_BASE}/TMDB.png`,
  trakt:`${ICON_BASE}/Trakt.png`,
  letterboxd:`${ICON_BASE}/letterboxd.png`,
  anilist:`${ICON_BASE}/anilist.png`,
  myanimelist:`${ICON_BASE}/mal.png`,
  roger:`${ICON_BASE}/Roger_Ebert.png`,
  tomatoes:`${ICON_BASE}/Rotten_Tomatoes.png`,
  audience:`${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
  metacritic:`${ICON_BASE}/Metacritic.png`,
  metacritic_user:`${ICON_BASE}/mus2.png`,
};

/* ===== merge external overrides ===== */
const __CFG__=(typeof window!=='undefined'&&window.MDBL_CFG)?window.MDBL_CFG:{};
const ENABLE_SOURCES = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources||{});
const DISPLAY        = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display||{});
const SPACING        = Object.assign({}, DEFAULT_SPACING,        __CFG__.spacing||{});
const RATING_PRIORITY= Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities||{});

/* ================== GM_xmlhttpRequest polyfill (optional proxy) ================== */
if (typeof GM_xmlhttpRequest === 'undefined') {
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
  ];
  const DIRECT = ['api.mdblist.com','graphql.anilist.co','query.wikidata.org','api.themoviedb.org'];
  window.GM_xmlhttpRequest = ({ method='GET', url, headers={}, data, onload, onerror }) => {
    const isDirect = DIRECT.some(d=>url.includes(d));
    const proxy = PROXIES[Math.floor(Math.random()*PROXIES.length)];
    const sep = url.includes('?') ? '&' : '?';
    const final = isDirect ? url : (proxy + encodeURIComponent(url + sep + `_=${Date.now()}`));
    fetch(final,{method,headers,body:data,cache:'no-store'})
      .then(r=>r.text().then(t=>onload&&onload({status:r.status,responseText:t})))
      .catch(e=>onerror&&onerror(e));
  };
}

/* ================== helpers ================== */
const Util = {
  pad:n=>String(n).padStart(2,'0'),
  validNumber:v=>!isNaN(parseFloat(v)),
  round:v=>Math.round(parseFloat(v)),
  normalize(v,src){ const m=SCALE_MULTIPLIER[(src||'').toLowerCase()]||1; const x=parseFloat(v); return isNaN(x)?null:x*m; },
  slug:t=>(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
};
(function ensureStyle(){ if(document.getElementById('mdblist-styles'))return;
  const s=document.createElement('style'); s.id='mdblist-styles';
  s.textContent='.mdblist-rating-container{}'; document.head.appendChild(s);
})();

/* ================== core ================== */
(function(){
'use strict';

let currentImdbId=null;

/* ---------- SPA route change + “wait until ready” ---------- */
let __warmupTimer=null, __warmupUntil=0;
function scheduleWarmup(ms=4500){ __warmupUntil=Date.now()+ms;
  if(__warmupTimer) return;
  __warmupTimer=setInterval(()=>{ try{ ensureFirstLineNow(); updateAll(); }catch{} if(Date.now()>__warmupUntil){ clearInterval(__warmupTimer); __warmupTimer=null;} },250);
}
(function hookNav(){
  let last=location.href;
  const fire=()=>{ if(location.href!==last){ last=location.href; currentImdbId=null; scheduleWarmup(5000); } };
  const p=history.pushState, r=history.replaceState;
  history.pushState=function(){const out=p.apply(this,arguments);fire();return out;};
  history.replaceState=function(){const out=r.apply(this,arguments);fire();return out;};
  window.addEventListener('popstate',fire);
})();

/* ---------- robust wait for first line + do inserts immediately ---------- */
async function waitForPrimaryRow(timeoutMs=10000){
  const start=performance.now();
  for(;;){
    const row=findPrimaryRow();
    if(row && row.offsetParent!==null && row.textContent.trim().length>0) return row;
    if(performance.now()-start>timeoutMs) return null;
    await new Promise(r=>requestAnimationFrame(r));
  }
}
function ensureFirstLineNow(){
  const row=findPrimaryRow(); if(!row) return;
  // badge, then ends-at
  ensureInlineBadge();
  ensureEndsAtInline();
  removeBuiltInEndsAt();
}

/* ---------- finders / transforms ---------- */
function findPrimaryRow(){
  return document.querySelector('.itemMiscInfo.itemMiscInfo-primary')
      || document.querySelector('.itemMiscInfo-primary')
      || document.querySelector('.itemMiscInfo');
}
function findYearChip(primary){
  const chips=primary.querySelectorAll('.mediaInfoItem,.mediaInfoText,span,div');
  for(const el of chips){ const t=(el.textContent||'').trim(); if(/^\d{4}$/.test(t)) return el; }
  return null;
}

/* broaden official rating detection (FSK, TV-MA, etc.) + clone at start */
function readAndHideOriginalBadge(){
  let original = document.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')
               || document.querySelector('.mediaInfoItem.mediaInfoText[data-type="officialRating"]')
               || [...document.querySelectorAll('.itemMiscInfo .mediaInfoItem,.itemMiscInfo .mediaInfoText,.itemMiscInfo span')]
                    .find(el=>{
                      const t=(el.textContent||'').trim();
                      return (
                        /^[A-Z0-9][A-Z0-9\-\+]{0,6}$/.test(t) ||    // G, PG-13, TV-MA, R18+
                        /^FSK\s*\d{1,2}$/.test(t) ||                 // German FSK 6/12/16/18
                        /^USK\s*\d{1,2}$/.test(t)                    // (rare in movies)
                      ) && !/^\d{4}$/.test(t);
                    }) || null;
  if(!original) return null;
  const value=(original.textContent||'').trim();
  original.style.display='none';
  return value||null;
}
function ensureInlineBadge(){
  const primary=findPrimaryRow(); if(!primary) return;
  const ratingValue=readAndHideOriginalBadge(); if(!ratingValue) return;
  if(primary.querySelector('#mdblistInlineParental')) return;

  const badge=document.createElement('span');
  badge.id='mdblistInlineParental';
  badge.textContent=ratingValue;
  Object.assign(badge.style,{
    display:'inline-flex',alignItems:'center',justifyContent:'center',
    padding:'2px 6px',borderRadius:'6px',fontWeight:'600',fontSize:'0.9em',lineHeight:'1',
    background:'var(--theme-primary-color,rgba(255,255,255,0.12))',color:'var(--theme-text-color,#ddd)',
    marginRight:'10px',whiteSpace:'nowrap',flex:'0 0 auto',verticalAlign:'middle'
  });
  // insert before the first real element (avoids text node surprises)
  primary.insertBefore(badge, primary.firstElementChild || primary.firstChild);
}

/* localized runtime → minutes (English + German) */
function parseRuntimeToMinutes(text){
  if(!text) return 0;
  const t=text.toLowerCase().replace(/\u00A0/g,' ').trim();
  // English patterns
  let m = t.match(/(?:(\d+)\s*(?:h|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?/i);
  // German fallback (Std., Stunden, Min., Minuten)
  if(!m || (!m[1] && !m[2])){
    m = t.match(/(?:(\d+)\s*(?:std\.?|stunden?))?\s*(?:(\d+)\s*(?:min\.?|minuten?))?/i);
  }
  if(!m) return 0;
  const hh=parseInt(m[1]||'0',10);
  const mm=parseInt(m[2]||'0',10);
  if(hh===0 && mm===0){
    const onlyM = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes|min\.?|minuten?)/i);
    return onlyM ? parseInt(onlyM[1],10) : 0;
  }
  return hh*60+mm;
}
function findRuntimeNode(primary){
  const nodes=primary.querySelectorAll('.mediaInfoItem,.mediaInfoText,span,div');
  for(const el of nodes){
    const mins=parseRuntimeToMinutes((el.textContent||'').trim());
    if(mins>0) return {node:el,minutes:mins};
  }
  const mins=parseRuntimeToMinutes((primary.textContent||'').trim());
  return mins>0 ? {node:primary,minutes:mins} : {node:null,minutes:0};
}
function formatEndTime(d){
  if(DISPLAY.endsAtFormat==='12h'){
    let h=d.getHours(); const m=Util.pad(d.getMinutes()); const suf=h>=12?'PM':'AM'; h=h%12||12; return `${h}:${m} ${suf}`;
  }
  return `${Util.pad(d.getHours())}:${Util.pad(d.getMinutes())}`;
}
function ensureEndsAtInline(){
  const primary=findPrimaryRow(); if(!primary) return;
  const r=findRuntimeNode(primary); if(!r.node || !r.minutes) return;
  const end=new Date(Date.now()+r.minutes*60000);
  const prefix=DISPLAY.endsAtBullet?' • ':'';
  const content=`${prefix}Ends at ${formatEndTime(end)}`;

  let span=primary.querySelector('#customEndsAt');
  if(!span){
    span=document.createElement('span'); span.id='customEndsAt';
    span.style.marginLeft='6px'; span.style.whiteSpace='nowrap'; span.style.display='inline';
    // append immediately after runtime node
    if(r.node.nextSibling) r.node.parentNode.insertBefore(span, r.node.nextSibling);
    else r.node.parentNode.appendChild(span);
  }
  span.textContent=content;
}
/* strip any other “Ends at …” line Jellyfin/plugins might add */
function removeBuiltInEndsAt(){
  document.querySelectorAll('.itemMiscInfo-secondary').forEach(row=>{
    if(/\bends\s+at\b/i.test(row.textContent||'')) row.remove();
  });
  const ours=document.getElementById('customEndsAt');
  document.querySelectorAll('.itemMiscInfo span,.itemMiscInfo div').forEach(el=>{
    if(el===ours || (ours&&ours.contains(el))) return;
    if(/\bends\s+at\b/i.test(el.textContent||'')) el.remove();
  });
}

/* ---------- ratings row ---------- */
function hideDefaultRatingsOnce(){
  document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box=>{
    box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el=>{ el.style.display='none'; });
  });
}
function scanLinks(){
  document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a=>{
    if(a.dataset.mdblSeen==='1') return; a.dataset.mdblSeen='1';
    const m=a.href.match(/imdb\.com\/title\/(tt\d+)/); if(!m) return;
    const id=m[1]; if(id!==currentImdbId){ document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove()); currentImdbId=id; }
  });
  [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].forEach(a=>{
    if(a.dataset.mdblProc==='1') return;
    const m=a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/); if(!m) return;
    a.dataset.mdblProc='1';
    const type=m[1]==='tv'?'show':'movie', tmdbId=m[2];

    document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b=>{
      const ref=b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')||b.querySelector('.mediaInfoItem:last-of-type');
      if(!ref) return;
      if(ref.nextElementSibling && ref.nextElementSibling.classList?.contains('mdblist-rating-container')) return;

      const div=document.createElement('div');
      div.className='mdblist-rating-container';
      const justify=DISPLAY.align==='center'?'center':DISPLAY.align==='left'?'flex-start':'flex-end';
      const paddingRight=DISPLAY.align==='right'?'6px':'0';
      div.style=`
        display:flex; flex-wrap:wrap; align-items:center;
        justify-content:${justify}; width:calc(100% + 6px);
        margin-left:-6px; margin-top:${SPACING.ratingsTopGapPx}px;
        padding-right:${paddingRight}; box-sizing:border-box;
      `;
      div.dataset.type=type; div.dataset.tmdbId=tmdbId; div.dataset.mdblFetched='0';
      ref.insertAdjacentElement('afterend',div);
    });
  });
  hideDefaultRatingsOnce();
}
function updateRatings(){
  document.querySelectorAll('.mdblist-rating-container').forEach(c=>{
    if(c.dataset.mdblFetched==='1') return;
    const type=c.dataset.type||'movie', tmdbId=c.dataset.tmdbId; if(!tmdbId) return;
    c.dataset.mdblFetched='1'; fetchRatings(tmdbId,currentImdbId,c,type);
  });
}
function appendRating(container,logo,val,title,key,link){
  if(!Util.validNumber(val)) return; const n=Util.normalize(val,key); if(!Util.validNumber(n)) return;
  const r=Util.round(n); const disp=DISPLAY.showPercentSymbol?`${r}%`:`${r}`;
  if(container.querySelector(`[data-source="${key}"]`)) return;
  const wrap=document.createElement('div'); wrap.dataset.source=key; wrap.style='display:inline-flex;align-items:center;margin:0 6px;';
  const a=document.createElement('a'); a.href=link; a.target='_blank'; a.style.textDecoration='none;';
  const img=document.createElement('img'); img.src=logo; img.alt=title; img.title=`${title}: ${disp}`; img.style='height:1.3em;margin-right:3px;vertical-align:middle;';
  const s=document.createElement('span'); s.textContent=disp; s.style='font-size:1em;vertical-align:middle;';
  if(DISPLAY.colorizeRatings){ let col = (r>=COLOR_THRESHOLDS.green)?COLOR_VALUES.green:(r>=COLOR_THRESHOLDS.orange)?COLOR_VALUES.orange:COLOR_VALUES.red;
    if(DISPLAY.colorizeNumbersOnly) s.style.color=col; else { s.style.color=col; img.style.filter=`drop-shadow(0 0 3px ${col})`; } }
  a.append(img,s); wrap.append(a); container.append(wrap);
  [...container.children].sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999)).forEach(el=>container.appendChild(el));
}

/* ---------- fetchers ---------- */
function fetchRatings(tmdbId,imdbId,container,type='movie'){
  GM_xmlhttpRequest({method:'GET',url:`https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
    onload:r=>{
      if(r.status!==200) return; let d; try{ d=JSON.parse(r.responseText);}catch{return;}
      const title=d.title||''; const slug=Util.slug(title);
      d.ratings?.forEach(rr=>{
        const s=(rr.source||'').toLowerCase(); const v=rr.value;
        if(s.includes('imdb') && ENABLE_SOURCES.imdb) appendRating(container,LOGO.imdb,v,'IMDb','imdb',`https://www.imdb.com/title/${imdbId}/`);
        else if(s.includes('tmdb') && ENABLE_SOURCES.tmdb) appendRating(container,LOGO.tmdb,v,'TMDb','tmdb',`https://www.themoviedb.org/${type}/${tmdbId}`);
        else if(s.includes('trakt') && ENABLE_SOURCES.trakt) appendRating(container,LOGO.trakt,v,'Trakt','trakt',`https://trakt.tv/search/imdb/${imdbId}`);
        else if(s.includes('letterboxd') && ENABLE_SOURCES.letterboxd) appendRating(container,LOGO.letterboxd,v,'Letterboxd','letterboxd',`https://letterboxd.com/imdb/${imdbId}/`);
        // RT direct from MDBList (critic/audience)
        else if((s==='tomatoes' || s.includes('rotten_tomatoes')) && ENABLE_SOURCES.rotten_tomatoes){
          const rtSearch=title?`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`:'#';
          appendRating(container,LOGO.tomatoes,v,'RT Critic','rotten_tomatoes_critic',rtSearch);
        } else if((s.includes('popcorn')||s.includes('audience')) && ENABLE_SOURCES.rotten_tomatoes){
          const rtSearch=title?`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`:'#';
          appendRating(container,LOGO.audience,v,'RT Audience','rotten_tomatoes_audience',rtSearch);
        }
        else if(s==='metacritic' && ENABLE_SOURCES.metacritic_critic){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container,LOGO.metacritic,v,'Metacritic (Critic)','metacritic_critic',link);
        } else if(s.includes('metacritic') && s.includes('user') && ENABLE_SOURCES.metacritic_user){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container,LOGO.metacritic_user,v,'Metacritic (User)','metacritic_user',link);
        } else if(s.includes('roger') && ENABLE_SOURCES.roger_ebert){
          appendRating(container,LOGO.roger,v,'Roger Ebert','roger_ebert',`https://www.rogerebert.com/reviews/${slug}`);
        }
      });
      if(ENABLE_SOURCES.anilist) fetchAniList(imdbId,container);
      if(ENABLE_SOURCES.myanimelist) fetchMAL(imdbId,container);
      if(ENABLE_SOURCES.rotten_tomatoes) fetchRT(imdbId,container); // fallback
    }
  });
}
function fetchAniList(imdbId,container){
  const q=`SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
  GM_xmlhttpRequest({method:'GET',url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{ try{
      const id=JSON.parse(r.responseText).results.bindings[0]?.anilist?.value; if(!id) return;
      const gql='query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
      GM_xmlhttpRequest({method:'POST',url:'https://graphql.anilist.co',headers:{'Content-Type':'application/json'},
        data:JSON.stringify({query:gql,variables:{id:parseInt(id,10)}}),
        onload:rr=>{ try{
          const m=JSON.parse(rr.responseText).data?.Media; if(Util.validNumber(m?.meanScore))
            appendRating(container,LOGO.anilist,m.meanScore,'AniList','anilist',`https://anilist.co/anime/${id}`);
        }catch{} }
      });
    }catch{} }
  });
}
function fetchMAL(imdbId,container){
  const q=`SELECT ?mal WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P4086 ?mal . } LIMIT 1`;
  GM_xmlhttpRequest({method:'GET',url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{ try{
      const id=JSON.parse(r.responseText).results.bindings[0]?.mal?.value; if(!id) return;
      GM_xmlhttpRequest({method:'GET',url:`https://api.jikan.moe/v4/anime/${id}`,
        onload:rr=>{ try{
          const d=JSON.parse(rr.responseText).data; if(Util.validNumber(d.score))
            appendRating(container,LOGO.myanimelist,d.score,'MyAnimeList','myanimelist',`https://myanimelist.net/anime/${id}`);
        }catch{} }
      });
    }catch{} }
  });
}
function fetchRT(imdbId,container){
  const key=`${NS}rt_${imdbId}`; const cache=localStorage.getItem(key);
  if(cache){ try{ const j=JSON.parse(cache); if(Date.now()-j.time<CACHE_DURATION){ addRT(container,j.scores); return; } }catch{} }
  const q=`SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
  GM_xmlhttpRequest({method:'GET',url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{ try{
      const id=JSON.parse(r.responseText).results.bindings[0]?.rtid?.value; if(!id) return;
      const path=id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,''); const url=`https://www.rottentomatoes.com/${path}`;
      GM_xmlhttpRequest({method:'GET',url,
        onload:rr=>{ try{
          const m=rr.responseText.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/); if(!m) return;
          const d=JSON.parse(m[1]); const critic=parseFloat(d.criticsScore?.score); const audience=parseFloat(d.audienceScore?.score);
          const scores={critic,audience,link:url}; addRT(container,scores); localStorage.setItem(key,JSON.stringify({time:Date.now(),scores}));
        }catch(e){ console.error('RT parse error',e);} }
      });
    }catch(e){ console.error(e);} }
  });
  function addRT(c,s){ if(Util.validNumber(s.critic)) appendRating(c,LOGO.tomatoes,s.critic,'RT Critic','rotten_tomatoes_critic',s.link||'#');
                      if(Util.validNumber(s.audience)) appendRating(c,LOGO.audience,s.audience,'RT Audience','rotten_tomatoes_audience',s.link||'#'); }
}

/* ---------- pipeline ---------- */
async function updateAll(){
  try{
    // ensure the first line exists; if not yet, wait (once per call)
    const row = await waitForPrimaryRow(3000);
    if(row){ ensureInlineBadge(); ensureEndsAtInline(); removeBuiltInEndsAt(); }
    scanLinks(); updateRatings(); hideDefaultRatingsOnce();
  }catch{}
}

/* ---------- observe ---------- */
const MDbl={ debounceTimer:null };
MDbl.debounce=(fn,wait=150)=>{ clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer=setTimeout(fn,wait); };

(function observePage(){
  const obs=new MutationObserver(()=>MDbl.debounce(updateAll,150));
  obs.observe(document.body,{childList:true,subtree:true});
  scheduleWarmup(5000); // initial SPA warmup
  updateAll();          // initial pass
})();

})();
