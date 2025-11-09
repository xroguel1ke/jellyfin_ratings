// ==UserScript==
// @name         Jellyfin Ratings (v6.3.8 — RT via MDBList + Fallback)
// @namespace    https://mdblist.com
// @version      6.3.8
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). Normalized 0–100, colorized; inline “Ends at …”; parental badge to start; single observer; cached lookups; settings panel.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

/* ---------- Defaults (overridable via window.MDBL_CFG) ---------- */
const DEFAULT_ENABLE_SOURCES = {
  imdb: true, tmdb: true, trakt: true, letterboxd: true,
  rotten_tomatoes_critic: true, rotten_tomatoes_audience: true,
  metacritic_critic: true, metacritic_user: true,
  roger_ebert: true, anilist: true, myanimelist: true
};
const DEFAULT_DISPLAY = {
  showPercentSymbol: true,
  colorizeRatings:   true,   // master
  colorNumbers:      true,   // numbers color
  colorIcons:        false,  // icon glow
  align:             'left',
  endsAtFormat:      '24h',
  endsAtBullet:      true
};
const DEFAULT_SPACING   = { ratingsTopGapPx: 8 };
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
const CACHE_DURATION  = 7*24*60*60*1000; // 7 days
const NS = 'mdbl_';

const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
  imdb: `${ICON_BASE}/IMDb.png`,
  tmdb: `${ICON_BASE}/TMDB.png`,
  trakt: `${ICON_BASE}/Trakt.png`,
  letterboxd: `${ICON_BASE}/letterboxd.png`,
  anilist: `${ICON_BASE}/anilist.png`,
  myanimelist: `${ICON_BASE}/mal.png`,
  roger: `${ICON_BASE}/Roger_Ebert.png`,
  tomatoes: `${ICON_BASE}/Rotten_Tomatoes.png`,
  audience: `${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
  metacritic: `${ICON_BASE}/Metacritic.png`,
  metacritic_user: `${ICON_BASE}/mus2.png`,
};

/* ---------- Merge injector config ---------- */
const __CFG__ = (typeof window !== 'undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES  = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources   || {});
const DISPLAY         = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display   || {});
const SPACING         = Object.assign({}, DEFAULT_SPACING,        __CFG__.spacing   || {});
const RATING_PRIORITY = Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities|| {});

/* ---------- GM_xmlhttpRequest polyfill (when absent) ---------- */
if (typeof GM_xmlhttpRequest === 'undefined') {
  const PROXIES=['https://api.allorigins.win/raw?url=','https://api.codetabs.com/v1/proxy?quest='];
  const DIRECT =['api.mdblist.com','graphql.anilist.co','query.wikidata.org','api.themoviedb.org'];
  window.GM_xmlhttpRequest=({method='GET',url,headers={},data,onload,onerror})=>{
    const isDirect=DIRECT.some(d=>url.includes(d));
    const proxy=PROXIES[Math.floor(Math.random()*PROXIES.length)];
    const sep=url.includes('?')?'&':'?';
    const final=isDirect?url:(proxy+encodeURIComponent(url+sep+`_=${Date.now()}`));
    fetch(final,{method,headers,body:data,cache:'no-store'})
      .then(r=>r.text().then(t=>onload&&onload({status:r.status,responseText:t})))
      .catch(e=>onerror&&onerror(e));
  };
}

/* ---------- Helpers ---------- */
const Util = {
  pad:n=>String(n).padStart(2,'0'),
  num:v=>parseFloat(v),
  ok:v=>!isNaN(parseFloat(v)),
  round:v=>Math.round(parseFloat(v)),
  normalize:(v,src)=>{ const m=SCALE_MULTIPLIER[(src||'').toLowerCase()]||1, x=parseFloat(v); return isNaN(x)?null:x*m; },
  slug:t=>(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
};

(function ensureStyleTag(){
  if (document.getElementById('mdblist-styles')) return;
  const style=document.createElement('style');
  style.id='mdblist-styles';
  style.textContent=`.mdblist-rating-container{}`;
  document.head.appendChild(style);
})();

/* ======================================================
   CORE
====================================================== */
(function(){
'use strict';

let currentImdbId=null;

/* Remove Jellyfin "Ends at" rows, keep ours */
function removeBuiltInEndsAt(){
  document.querySelectorAll('.itemMiscInfo-secondary').forEach(r=>{
    if (/\bends\s+at\b/i.test(r.textContent||'')) r.remove();
  });
  const ours=document.getElementById('customEndsAt');
  document.querySelectorAll('.itemMiscInfo span, .itemMiscInfo div').forEach(el=>{
    if (el===ours || (ours && ours.contains(el))) return;
    if (/\bends\s+at\b/i.test((el.textContent||''))) el.remove();
  });
}

/* Clone parental rating to start */
function ensureInlineBadge(){
  const primary=findPrimaryRow(); if(!primary) return;
  const ratingValue=readAndHideOriginalBadge(); if(!ratingValue) return;
  if (primary.querySelector('#mdblistInlineParental')) return;
  const before=findYearChip(primary)||primary.firstChild;
  const badge=document.createElement('span');
  badge.id='mdblistInlineParental'; badge.textContent=ratingValue;
  Object.assign(badge.style,{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'2px 6px',borderRadius:'6px',
    fontWeight:'600',fontSize:'0.9em',lineHeight:'1',background:'var(--theme-primary-color, rgba(255,255,255,0.12))',
    color:'var(--theme-text-color,#ddd)',marginRight:'10px',whiteSpace:'nowrap',flex:'0 0 auto',verticalAlign:'middle'});
  (before&&before.parentNode)?before.parentNode.insertBefore(badge,before):primary.insertBefore(badge,primary.firstChild);
}
const findPrimaryRow=()=>document.querySelector('.itemMiscInfo.itemMiscInfo-primary')||document.querySelector('.itemMiscInfo-primary')||document.querySelector('.itemMiscInfo');
function findYearChip(primary){
  for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')){
    const t=(el.textContent||'').trim(); if (/^\d{4}$/.test(t)) return el;
  } return null;
}
function readAndHideOriginalBadge(){
  let original=document.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')
     || document.querySelector('.mediaInfoItem.mediaInfoText[data-type="officialRating"]');
  if(!original){
    original=[...document.querySelectorAll('.itemMiscInfo .mediaInfoItem, .itemMiscInfo .mediaInfoText, .itemMiscInfo span')]
      .find(el=>{ const t=(el.textContent||'').trim(); return /^[A-Z0-9][A-Z0-9\-+]{0,5}$/.test(t)&&!/^\d{4}$/.test(t); })||null;
  }
  if(!original) return null;
  const v=(original.textContent||'').trim(); original.style.display='none'; return v||null;
}

/* Inline Ends at … */
function ensureEndsAtInline(){
  const primary=findPrimaryRow(); if(!primary) return;
  const {node,minutes}=findRuntimeNode(primary); if(!node||!minutes) return;
  const end=new Date(Date.now()+minutes*60000);
  const timeStr=(DISPLAY.endsAtFormat==='12h')?(()=>{
    let h=end.getHours(); const m=Util.pad(end.getMinutes()), suf=h>=12?'PM':'AM'; h=h%12||12; return `${h}:${m} ${suf}`;
  })():`${Util.pad(end.getHours())}:${Util.pad(end.getMinutes())}`;
  const content=`${DISPLAY.endsAtBullet?' • ':''}Ends at ${timeStr}`;
  let span=primary.querySelector('#customEndsAt');
  if(!span){
    span=document.createElement('span'); span.id='customEndsAt';
    Object.assign(span.style,{marginLeft:'6px',color:'inherit',opacity:'1',fontSize:'inherit',fontWeight:'inherit',whiteSpace:'nowrap',display:'inline'});
    (node.nextSibling)?node.parentNode.insertBefore(span,node.nextSibling):node.parentNode.appendChild(span);
  }
  span.textContent=content;
}
function findRuntimeNode(primary){
  for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')){
    const mins=parseRuntimeToMinutes((el.textContent||'').trim()); if (mins>0) return {node:el, minutes:mins};
  }
  const mins=parseRuntimeToMinutes((primary.textContent||'').trim());
  return mins>0?{node:primary, minutes:mins}:{node:null, minutes:0};
}
function parseRuntimeToMinutes(text){
  if(!text) return 0;
  const m=text.match(/(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
  if(!m) return 0; const h=parseInt(m[1]||'0',10), min=parseInt(m[2]||'0',10);
  if(h===0&&min===0){ const only=text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i); return only?parseInt(only[1],10):0; }
  return h*60+min;
}

/* Containers + scan */
function hideDefaultRatingsOnce(){
  document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box=>{
    box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el=>el.style.display='none');
  });
}
function scanLinks(){
  document.querySelectorAll('a.emby-button[href*="imdb.com/title/"]').forEach(a=>{
    if(a.dataset.mdblSeen==='1') return; a.dataset.mdblSeen='1';
    const m=a.href.match(/imdb\.com\/title\/(tt\d+)/); if(!m) return;
    const id=m[1]; if(id!==currentImdbId){ document.querySelectorAll('.mdblist-rating-container').forEach(el=>el.remove()); currentImdbId=id; }
  });
  [...document.querySelectorAll('a.emby-button[href*="themoviedb.org/"]')].forEach(a=>{
    if(a.dataset.mdblProc==='1') return; const m=a.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/); if(!m) return;
    a.dataset.mdblProc='1'; const type=m[1]==='tv'?'show':'movie', tmdbId=m[2];
    document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(b=>{
      const ref=b.querySelector('.mediaInfoItem.mediaInfoText.mediaInfoOfficialRating')||b.querySelector('.mediaInfoItem:last-of-type'); if(!ref) return;
      if (ref.nextElementSibling && ref.nextElementSibling.classList?.contains('mdblist-rating-container')) return;
      const div=document.createElement('div'); div.className='mdblist-rating-container';
      const justify = DISPLAY.align==='center'?'center':DISPLAY.align==='left'?'flex-start':'flex-end';
      const paddingRight = DISPLAY.align==='right'?'6px':'0';
      div.style=`display:flex;flex-wrap:wrap;align-items:center;justify-content:${justify};width:calc(100% + 6px);margin-left:-6px;margin-top:${SPACING.ratingsTopGapPx}px;padding-right:${paddingRight};box-sizing:border-box;`;
      Object.assign(div.dataset,{type, tmdbId, mdblFetched:'0'}); ref.insertAdjacentElement('afterend',div);
    });
  });
  hideDefaultRatingsOnce();
}
function updateRatings(){
  document.querySelectorAll('.mdblist-rating-container').forEach(c=>{
    if(c.dataset.mdblFetched==='1') return; const type=c.dataset.type||'movie', tmdbId=c.dataset.tmdbId; if(!tmdbId) return;
    c.dataset.mdblFetched='1'; fetchRatings(tmdbId,currentImdbId,c,type);
  });
}

/* Render one badge — icon links out (with tooltip), number opens settings */
function appendRating(container, logo, val, title, key, link, count, kind){
  if(!Util.ok(val)) return;
  const n=Util.normalize(val,key); if(!Util.ok(n)) return;
  const r=Util.round(n), disp=DISPLAY.showPercentSymbol?`${r}%`:`${r}`;
  if(container.querySelector(`[data-source="${key}"]`)) return;

  const wrap=document.createElement('div');
  wrap.dataset.source=key;
  wrap.style='display:inline-flex;align-items:center;margin:0 6px;gap:6px;';

  // icon (external link)
  const a=document.createElement('a'); a.href=link||'#'; if(link&&link!=='#') a.target='_blank'; a.style.textDecoration='none';
  const img=document.createElement('img'); img.src=logo; img.alt=title; img.style='height:1.3em;vertical-align:middle;';
  const labelCount=(typeof count==='number'&&isFinite(count))?`${count.toLocaleString()} ${kind|| (key==='rotten_tomatoes_critic'?'Reviews':'Votes')}`:'';
  img.title=labelCount?`${title} — ${labelCount}`:title;
  a.appendChild(img);

  // number (opens settings)
  const s=document.createElement('span'); s.textContent=disp; s.title='Open settings';
  s.style='font-size:1em;vertical-align:middle;cursor:pointer;';
  s.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); if(window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS(); });

  // coloring
  if (DISPLAY.colorizeRatings){
    const col=r>=COLOR_THRESHOLDS.green?COLOR_VALUES.green:r>=COLOR_THRESHOLDS.orange?COLOR_VALUES.orange:COLOR_VALUES.red;
    if (DISPLAY.colorNumbers) s.style.color=col;
    if (DISPLAY.colorIcons)   img.style.filter=`drop-shadow(0 0 3px ${col})`;
  }

  wrap.append(a,s); container.append(wrap);

  // sort by priority
  [...container.children]
    .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
    .forEach(el=>container.appendChild(el));
}

/* Fetch ratings (MDBList + extras) */
function fetchRatings(tmdbId, imdbId, container, type='movie'){
  GM_xmlhttpRequest({
    method:'GET',
    url:`https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
    onload:r=>{
      if(r.status!==200) return;
      let d; try{ d=JSON.parse(r.responseText); }catch{ return; }
      const title=d.title||''; const slug=Util.slug(title);

      d.ratings?.forEach(rr=>{
        const s=(rr.source||'').toLowerCase(), v=rr.value;
        const cnt=rr.votes||rr.count||rr.reviewCount||rr.ratingCount;
        if (s.includes('imdb') && ENABLE_SOURCES.imdb)
          appendRating(container,LOGO.imdb,v,'IMDb','imdb',`https://www.imdb.com/title/${imdbId}/`,cnt,'Votes');
        else if (s.includes('tmdb') && ENABLE_SOURCES.tmdb)
          appendRating(container,LOGO.tmdb,v,'TMDb','tmdb',`https://www.themoviedb.org/${type}/${tmdbId}`,cnt,'Votes');
        else if (s.includes('trakt') && ENABLE_SOURCES.trakt)
          appendRating(container,LOGO.trakt,v,'Trakt','trakt',`https://trakt.tv/search/imdb/${imdbId}`,cnt,'Votes');
        else if (s.includes('letterboxd') && ENABLE_SOURCES.letterboxd)
          appendRating(container,LOGO.letterboxd,v,'Letterboxd','letterboxd',`https://letterboxd.com/imdb/${imdbId}/`,cnt,'Votes');
        else if ((s==='tomatoes'||s.includes('rotten_tomatoes')) && ENABLE_SOURCES.rotten_tomatoes_critic){
          const rtSearch=title?`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`:'#';
          appendRating(container,LOGO.tomatoes,v,'RT Critic','rotten_tomatoes_critic',rtSearch,cnt,'Reviews');
        }
        else if ((s.includes('popcorn')||s.includes('audience')) && ENABLE_SOURCES.rotten_tomatoes_audience){
          const rtSearch=title?`https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`:'#';
          appendRating(container,LOGO.audience,v,'RT Audience','rotten_tomatoes_audience',rtSearch,cnt,'Votes');
        }
        else if (s==='metacritic' && ENABLE_SOURCES.metacritic_critic){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container,LOGO.metacritic,v,'Metacritic (Critic)','metacritic_critic',link,cnt,'Reviews');
        }
        else if (s.includes('metacritic')&&s.includes('user') && ENABLE_SOURCES.metacritic_user){
          const seg=(container.dataset.type==='show')?'tv':'movie';
          const link=slug?`https://www.metacritic.com/${seg}/${slug}`:`https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
          appendRating(container,LOGO.metacritic_user,v,'Metacritic (User)','metacritic_user',link,cnt,'Votes');
        }
        else if (s.includes('roger') && ENABLE_SOURCES.roger_ebert)
          appendRating(container,LOGO.roger,v,'Roger Ebert','roger_ebert',`https://www.rogerebert.com/reviews/${slug}`,cnt);
      });

      if (ENABLE_SOURCES.anilist)     fetchAniList(imdbId, container);
      if (ENABLE_SOURCES.myanimelist) fetchMAL(imdbId, container);
      if (ENABLE_SOURCES.rotten_tomatoes_critic || ENABLE_SOURCES.rotten_tomatoes_audience) fetchRT(imdbId, container);
    }
  });
}

/* AniList */
function fetchAniList(imdbId, container){
  const q=`SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id=JSON.parse(r.responseText).results.bindings[0]?.anilist?.value; if(!id) return;
        const gql='query($id:Int){ Media(id:$id,type:ANIME){ id meanScore } }';
        GM_xmlhttpRequest({
          method:'POST', url:'https://graphql.anilist.co', headers:{'Content-Type':'application/json'},
          data:JSON.stringify({query:gql,variables:{id:parseInt(id,10)}}),
          onload:rr=>{
            try{
              const m=JSON.parse(rr.responseText).data?.Media;
              if(Util.ok(m?.meanScore)) appendRating(container,LOGO.anilist,m.meanScore,'AniList','anilist',`https://anilist.co/anime/${id}`);
            }catch{}
          }
        });
      }catch{}
    }
  });
}

/* MAL */
function fetchMAL(imdbId, container){
  const q=`SELECT ?mal WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P4086 ?mal . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id=JSON.parse(r.responseText).results.bindings[0]?.mal?.value; if(!id) return;
        GM_xmlhttpRequest({
          method:'GET', url:`https://api.jikan.moe/v4/anime/${id}`,
          onload:rr=>{
            try{
              const d=JSON.parse(rr.responseText).data;
              if(Util.ok(d.score)){
                const count=(typeof d.scored_by==='number')?d.scored_by:undefined;
                appendRating(container,LOGO.myanimelist,d.score,'MyAnimeList','myanimelist',`https://myanimelist.net/anime/${id}`,count,'Votes');
              }
            }catch{}
          }
        });
      }catch{}
    }
  });
}

/* RT fallback (HTML parse) */
function fetchRT(imdbId, container){
  const key=`${NS}rt_${imdbId}`;
  const cache=localStorage.getItem(key);
  if(cache){
    try{ const j=JSON.parse(cache); if(Date.now()-j.time<CACHE_DURATION){ addRT(container,j.scores); return; } }catch{}
  }
  const q=`SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const id=JSON.parse(r.responseText).results.bindings[0]?.rtid?.value; if(!id) return;
        const url=`https://www.rottentomatoes.com/${id.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'')}`;
        GM_xmlhttpRequest({
          method:'GET', url,
          onload:rr=>{
            try{
              const m=rr.responseText.match(/<script\s+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/);
              if(!m) return;
              const d=JSON.parse(m[1]);
              const critic=Util.num(d.criticsScore?.score);
              const cCount=(typeof d.criticsScore?.reviewCount==='number')?d.criticsScore.reviewCount:undefined;
              const audience=Util.num(d.audienceScore?.score);
              const aCount=(typeof d.audienceScore?.ratingCount==='number')?d.audienceScore.ratingCount:undefined;
              const scores={critic,audience,link:url,cCount,aCount};
              addRT(container,scores);
              localStorage.setItem(key,JSON.stringify({time:Date.now(),scores}));
            }catch(e){ console.error('RT parse error',e); }
          }
        });
      }catch(e){ console.error(e); }
    }
  });

  function addRT(c,s){
    if(Util.ok(s.critic) && ENABLE_SOURCES.rotten_tomatoes_critic)
      appendRating(c,LOGO.tomatoes,s.critic,'RT Critic','rotten_tomatoes_critic',s.link||'#',s.cCount,'Reviews');
    if(Util.ok(s.audience) && ENABLE_SOURCES.rotten_tomatoes_audience)
      appendRating(c,LOGO.audience,s.audience,'RT Audience','rotten_tomatoes_audience',s.link||'#',s.aCount,'Votes');
  }
}

/* Pipeline */
function updateAll(){
  try{
    removeBuiltInEndsAt();
    ensureInlineBadge();
    ensureEndsAtInline();
    removeBuiltInEndsAt();
    scanLinks();
    updateRatings();
  }catch(e){}
}

/* Observe */
const MDbl={debounceTimer:null};
MDbl.debounce=(fn,wait=150)=>{ clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer=setTimeout(fn,wait); };
(new MutationObserver(()=>MDbl.debounce(updateAll,150))).observe(document.body,{childList:true,subtree:true});
updateAll();

})();

/* ======================================================
   SETTINGS (numbers open this panel)
   - API key field: single input, shows key as value (placeholder when empty)
   - Checkboxes: all aligned to same right-hand column
   - Sources: drag to reorder
   - Click outside closes; panel draggable by header
====================================================== */
(function settingsMenu(){
  const PREFS_KEY=`${NS}prefs`;
  const LS_KEYS  =`${NS}keys`;

  const deepClone=o=>JSON.parse(JSON.stringify(o));
  const loadPrefs=()=>{ try{ return JSON.parse(localStorage.getItem(PREFS_KEY)||'{}'); }catch{ return {}; } };
  const savePrefs=p=>{ try{ localStorage.setItem(PREFS_KEY,JSON.stringify(p||{})); }catch{} };

  const ICON={ imdb:LOGO.imdb, tmdb:LOGO.tmdb, trakt:LOGO.trakt, letterboxd:LOGO.letterboxd,
    rotten_tomatoes_critic:LOGO.tomatoes, rotten_tomatoes_audience:LOGO.audience,
    metacritic_critic:LOGO.metacritic, metacritic_user:LOGO.metacritic_user,
    roger_ebert:LOGO.roger, anilist:LOGO.anilist, myanimelist:LOGO.myanimelist };
  const LABEL={ imdb:'IMDb', tmdb:'TMDb', trakt:'Trakt', letterboxd:'Letterboxd',
    rotten_tomatoes_critic:'Rotten Tomatoes (Critic)', rotten_tomatoes_audience:'Rotten Tomatoes (Audience)',
    metacritic_critic:'Metacritic (Critic)', metacritic_user:'Metacritic (User)',
    roger_ebert:'Roger Ebert', anilist:'AniList', myanimelist:'MyAnimeList' };

  const DEFAULTS={ sources:deepClone(ENABLE_SOURCES), display:deepClone(DISPLAY), priorities:deepClone(RATING_PRIORITY) };

  const getInjectorKey=()=>{ try{ return (window.MDBL_KEYS&&window.MDBL_KEYS.MDBLIST)?String(window.MDBL_KEYS.MDBLIST):''; }catch{ return ''; } };
  const getStoredKeys =()=>{ try{ return JSON.parse(localStorage.getItem(LS_KEYS)||'{}'); }catch{ return {}; } };
  const setStoredKey  =(newKey)=>{ const obj=Object.assign({},getStoredKeys(),{MDBLIST:newKey||''});
    try{ localStorage.setItem(LS_KEYS,JSON.stringify(obj)); }catch{}
    if(!getInjectorKey()){ if(!window.MDBL_KEYS||typeof window.MDBL_KEYS!=='object') window.MDBL_KEYS={}; window.MDBL_KEYS.MDBLIST=newKey||''; }
    if(window.MDBL_STATUS&&window.MDBL_STATUS.keys){ window.MDBL_STATUS.keys.MDBLIST=!!(getInjectorKey()||newKey); }
  };

  function applyPrefs(p){
    if(p.sources)    Object.keys(ENABLE_SOURCES).forEach(k=>{ if(k in p.sources) ENABLE_SOURCES[k]=!!p.sources[k]; });
    if(p.display)    Object.keys(DISPLAY).forEach(k=>{ if(k in p.display) DISPLAY[k]=p.display[k]; });
    if(p.priorities) Object.keys(p.priorities).forEach(k=>{ const v=+p.priorities[k]; if(isFinite(v)) RATING_PRIORITY[k]=v; });
  }
  const saved=loadPrefs(); if(saved && Object.keys(saved).length) applyPrefs(saved);

  /* UI / CSS */
  const css=`
  :root { --mdbl-right-col-width: 48px; }
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

  /* unified two-column grid for alignment */
  #mdbl-panel .mdbl-row,
  #mdbl-panel .mdbl-source{display:grid;grid-template-columns: 1fr var(--mdbl-right-col-width);align-items:center;gap:10px}
  #mdbl-panel input[type="checkbox"]{transform:scale(1.1);justify-self:end}

  /* inputs/selects */
  #mdbl-panel input[type="text"]{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);background:#121317;color:#eaeaea}
  #mdbl-panel select{padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#121317;color:#eaeaea;justify-self:end}
  #mdbl-panel .mdbl-select{width:200px}

  /* actions */
  #mdbl-panel .mdbl-actions{position:sticky;bottom:0;background:rgba(22,22,26,0.96);display:flex;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08)}
  #mdbl-panel button{padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#1b1c20;color:#eaeaea;cursor:pointer}
  #mdbl-panel button.primary{background:#2a6df4;border-color:#2a6df4;color:#fff}

  /* sources list */
  #mdbl-sources{display:flex;flex-direction:column;gap:8px}
  .mdbl-source{background:#0f1115;border:1px solid rgba(255,255,255,0.1);padding:8px 10px;border-radius:12px}
  .mdbl-src-left{display:flex;align-items:center;gap:10px}
  .mdbl-src-left img{height:18px;width:auto}
  .mdbl-src-left .name{font-size:13px}
  .mdbl-drag-handle{justify-self:start;opacity:0.6;cursor:grab}

  /* API key field styled like a source row, but single-column block to avoid a right column */
  #mdbl-key-box{background:#0f1115;border:1px solid rgba(255,255,255,0.1);padding:8px 10px;border-radius:12px;display:block}
  `;
  const style=document.createElement('style'); style.id='mdbl-settings-css'; style.textContent=css; document.head.appendChild(style);

  const panel=document.createElement('div'); panel.id='mdbl-panel';
  panel.innerHTML=`
    <header id="mdbl-drag-handle">
      <h3>Jellyfin Ratings — Settings</h3>
      <button id="mdbl-close" aria-label="Close">✕</button>
    </header>

    <div class="mdbl-section" id="mdbl-sec-keys"></div>
    <div class="mdbl-section" id="mdbl-sec-sources"></div>
    <div class="mdbl-section" id="mdbl-sec-display"></div>

    <div class="mdbl-actions">
      <button id="mdbl-btn-reset">Reset</button>
      <button id="mdbl-btn-save" class="primary">Save & Apply</button>
    </div>
  `;
  document.body.appendChild(panel);

  // close on outside click
  document.addEventListener('mousedown', e=>{ if(panel.style.display!=='block') return; if(!panel.contains(e.target)) hide(); });

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

  function orderFromPriorities(){
    return Object.keys(RATING_PRIORITY).filter(k=>k in ENABLE_SOURCES)
      .sort((a,b)=>(RATING_PRIORITY[a]??999)-(RATING_PRIORITY[b]??999))
      .map(k=>({k, icon:ICON[k], label:LABEL[k]||k.replace(/_/g,' ')}));
  }
  function makeSourceRow(item){
    const key=item.k, checked=!!ENABLE_SOURCES[key];
    const row=document.createElement('div'); row.className='mdbl-source'; row.dataset.k=key; row.draggable=true;
    row.innerHTML=`
      <div class="mdbl-src-left">
        <span class="mdbl-drag-handle" title="Drag to reorder">⋮⋮</span>
        <img src="${item.icon}" alt="${item.label}">
        <span class="name">${item.label}</span>
      </div>
      <input type="checkbox" ${checked?'checked':''} data-toggle="${key}">
    `;
    return row;
  }
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

  function render(){
    // Keys: single input, value shows key when present; placeholder otherwise
    const kWrap=panel.querySelector('#mdbl-sec-keys');
    const injKey=getInjectorKey(); const stored=getStoredKeys().MDBLIST||'';
    const value=injKey?injKey:(stored||'');
    const readonly=injKey?'readonly':'';
    kWrap.innerHTML=`
      <div id="mdbl-key-box">
        <input type="text" id="mdbl-key-mdb" ${readonly} placeholder="MDBList API key" value="${value}">
      </div>
    `;

    // Sources
    const sWrap=panel.querySelector('#mdbl-sec-sources');
    sWrap.innerHTML=`<div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div>`;
    const sList=sWrap.querySelector('#mdbl-sources');
    orderFromPriorities().forEach(item=>sList.appendChild(makeSourceRow(item)));
    enableDnD(sList);

    // Display — order: Colorize → Color numbers → Color icons → Show % → Show bullet → Align → Ends at format
    const dWrap=panel.querySelector('#mdbl-sec-display');
    dWrap.innerHTML=`
      <div class="mdbl-subtle">Display</div>
      <div class="mdbl-row"><span>Colorize ratings</span><input type="checkbox" id="d_colorize" ${DISPLAY.colorizeRatings?'checked':''}></div>
      <div class="mdbl-row"><span>Color numbers</span><input type="checkbox" id="d_colorNumbers" ${DISPLAY.colorNumbers?'checked':''}></div>
      <div class="mdbl-row"><span>Color icons</span><input type="checkbox" id="d_colorIcons" ${DISPLAY.colorIcons?'checked':''}></div>
      <div class="mdbl-row"><span>Show %</span><input type="checkbox" id="d_showPercent" ${DISPLAY.showPercentSymbol?'checked':''}></div>
      <div class="mdbl-row"><span>Show bullet before “Ends at”</span><input type="checkbox" id="d_endsBullet" ${DISPLAY.endsAtBullet?'checked':''}></div>
      <div class="mdbl-row">
        <span>Align</span>
        <select id="d_align" class="mdbl-select">
          <option value="left" ${DISPLAY.align==='left'?'selected':''}>left</option>
          <option value="center" ${DISPLAY.align==='center'?'selected':''}>center</option>
          <option value="right" ${DISPLAY.align==='right'?'selected':''}>right</option>
        </select>
      </div>
      <div class="mdbl-row">
        <span>Ends at format</span>
        <select id="d_endsFmt" class="mdbl-select">
          <option value="24h" ${DISPLAY.endsAtFormat==='24h'?'selected':''}>24h</option>
          <option value="12h" ${DISPLAY.endsAtFormat==='12h'?'selected':''}>12h</option>
        </select>
      </div>
    `;
  }

  function show(){ panel.style.display='block'; }
  function hide(){ panel.style.display='none'; }
  window.MDBL_OPEN_SETTINGS=()=>{ render(); show(); };
  panel.addEventListener('click', e=>{ if(e.target.id==='mdbl-close') hide(); });

  // outside click closes
  document.addEventListener('mousedown', e=>{ if(panel.style.display!=='block') return; if(!panel.contains(e.target)) hide(); });

  // Reset / Save
  panel.querySelector('#mdbl-btn-reset').addEventListener('click', ()=>{
    Object.assign(ENABLE_SOURCES,deepClone(DEFAULTS.sources));
    Object.assign(DISPLAY,        deepClone(DEFAULTS.display));
    Object.assign(RATING_PRIORITY,deepClone(DEFAULTS.priorities));
    savePrefs({});
    render();
    if(window.MDBL_API?.refresh) window.MDBL_API.refresh();
  });

  panel.querySelector('#mdbl-btn-save').addEventListener('click', ()=>{
    const prefs={sources:{},display:{},priorities:{}};

    // priorities from drag order
    [...panel.querySelectorAll('#mdbl-sources .mdbl-source')].forEach((el,i)=>{ prefs.priorities[el.dataset.k]=i+1; });

    // source toggles
    panel.querySelectorAll('#mdbl-sources input[type="checkbox"][data-toggle]').forEach(cb=>{
      prefs.sources[cb.dataset.toggle]=cb.checked;
    });

    // display toggles
    prefs.display.colorizeRatings   = panel.querySelector('#d_colorize').checked;
    prefs.display.colorNumbers      = panel.querySelector('#d_colorNumbers').checked;
    prefs.display.colorIcons        = panel.querySelector('#d_colorIcons').checked;
    prefs.display.showPercentSymbol = panel.querySelector('#d_showPercent').checked;
    prefs.display.endsAtBullet      = panel.querySelector('#d_endsBullet').checked;
    prefs.display.align             = panel.querySelector('#d_align').value;
    prefs.display.endsAtFormat      = panel.querySelector('#d_endsFmt').value;

    savePrefs(prefs); applyPrefs(prefs);

    // keys (only if no injector)
    const injKey=getInjectorKey(); const keyInput=panel.querySelector('#mdbl-key-mdb');
    if(keyInput && !injKey) setStoredKey((keyInput.value||'').trim());

    if(window.MDBL_API?.refresh) window.MDBL_API.refresh();
    location.reload();
  });

})();
