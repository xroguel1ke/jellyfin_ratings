console.info('[Jellyfin Ratings] ratings.core.js boot');
window.MDBL_STATUS = Object.assign({ version: 'core' }, window.MDBL_STATUS || {});

// ==UserScript==
// @name         Jellyfin Ratings — Core (v6.4.0)
// @namespace    https://mdblist.com
// @version      6.4.0
// @description  Core runtime: ratings, fetching, rendering, and number-click hook that lazy-loads the Settings panel (menu.js).
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// ==/UserScript>

/* ---------- Defaults (overridable via window.MDBL_CFG) ---------- */
const DEFAULT_ENABLE_SOURCES = {
  imdb:true, tmdb:true, trakt:true, letterboxd:true,
  rotten_tomatoes_critic:true, rotten_tomatoes_audience:true,
  metacritic_critic:true, metacritic_user:true,
  roger_ebert:true, anilist:true, myanimelist:true
};
const DEFAULT_DISPLAY = {
  showPercentSymbol:true,
  colorizeRatings:true,
  colorNumbers:true,
  colorIcons:false,
  align:'left',
  endsAtFormat:'24h',
  endsAtBullet:true
};
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
const CACHE_DURATION   = 7*24*60*60*1000;
const NS               = 'mdbl_';
const ICON_BASE        = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
const LOGO = {
  imdb:`${ICON_BASE}/IMDb.png`, tmdb:`${ICON_BASE}/TMDB.png`,
  trakt:`${ICON_BASE}/Trakt.png`, letterboxd:`${ICON_BASE}/letterboxd.png`,
  anilist:`${ICON_BASE}/anilist.png`, myanimelist:`${ICON_BASE}/mal.png`,
  roger:`${ICON_BASE}/Roger_Ebert.png`,
  tomatoes:`${ICON_BASE}/Rotten_Tomatoes.png`,
  audience:`${ICON_BASE}/Rotten_Tomatoes_positive_audience.png`,
  metacritic:`${ICON_BASE}/Metacritic.png`,
  metacritic_user:`${ICON_BASE}/mus2.png`,
};

/* ---------- Config merge ---------- */
const __CFG__ = (typeof window!=='undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES  = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources   || {});
const DISPLAY         = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display   || {});
const RATING_PRIORITY = Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities|| {});
const MDBLIST_API_KEY = (window.MDBL_KEYS&&window.MDBL_KEYS.MDBLIST) ? String(window.MDBL_KEYS.MDBLIST) : 'hehfnbo9y8blfyqm1d37ikubl';

/* ---------- Polyfill ---------- */
if (typeof GM_xmlhttpRequest==='undefined'){
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

/* ---------- Status (for injector console ping) ---------- */
window.MDBL_STATUS = { version:'6.4.0', keys:{ MDBLIST: !!MDBLIST_API_KEY } };

/* ---------- Lazy menu loader hook ---------- */
(function initLazyMenu(){
  let loading = false, loaded = false, queue = [];
  async function ensureMenuLoaded(){
    if (loaded) return;
    if (loading) return new Promise(r=>queue.push(r));
    loading = true;
    const url = window.MDBL_MENU_URL || 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/menu.js';
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src = `${url}?t=${Date.now()}`; s.async=true; s.onload=()=>resolve(); s.onerror=reject;
      document.head.appendChild(s);
    }).catch(e=>console.error('[Jellyfin Ratings] menu load failed:', e));
    loaded = true; loading = false; queue.splice(0).forEach(fn=>fn());
  }
  window.MDBL_OPEN_SETTINGS = async () => {
    await ensureMenuLoaded();
    if (typeof window.__MDBL_showMenu==='function') window.__MDBL_showMenu();
  };
})();

/* ---------- Tiny style tag placeholder ---------- */
(function ensureStyleTag(){
  if (document.getElementById('mdblist-styles')) return;
  const style=document.createElement('style'); style.id='mdblist-styles'; style.textContent=`.mdblist-rating-container{}`;
  document.head.appendChild(style);
})();

/* ======================================================
   CORE RUNTIME (same behavior as before)
====================================================== */
(function(){
'use strict';

let currentImdbId=null;

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

/* Ends at */
function parseRuntimeToMinutes(text){
  if(!text) return 0;
  const m=text.match(/(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
  if(!m) return 0; const h=parseInt(m[1]||'0',10), min=parseInt(m[2]||'0',10);
  if(h===0&&min===0){ const only=text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i); return only?parseInt(only[1],10):0; }
  return h*60+min;
}
function findRuntimeNode(primary){
  for (const el of primary.querySelectorAll('.mediaInfoItem, .mediaInfoText, span, div')){
    const mins=parseRuntimeToMinutes((el.textContent||'').trim()); if (mins>0) return {node:el, minutes:mins};
  }
  const mins=parseRuntimeToMinutes((primary.textContent||'').trim());
  return mins>0?{node:primary, minutes:mins}:{node:null, minutes:0};
}
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

/* Hide default */
function hideDefaultRatingsOnce(){
  document.querySelectorAll('.itemMiscInfo.itemMiscInfo-primary').forEach(box=>{
    box.querySelectorAll('.starRatingContainer,.mediaInfoCriticRating').forEach(el=>el.style.display='none');
  });
}

/* Scan/containers */
let currentImdbId = null;
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
      div.style=`display:flex;flex-wrap:wrap;align-items:center;justify-content:${justify};width:calc(100% + 6px);margin-left:-6px;margin-top:8px;padding-right:${paddingRight};box-sizing:border-box;`;
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

/* Append rating (icon links out; number opens settings) */
function appendRating(container, logo, val, title, key, link, count, kind){
  if(!Util.ok(val)) return; const n=Util.normalize(val,key); if(!Util.ok(n)) return;
  const r=Util.round(n), disp=DISPLAY.showPercentSymbol?`${r}%`:`${r}`;
  if(container.querySelector(`[data-source="${key}"]`)) return;

  const wrap=document.createElement('div');
  wrap.dataset.source=key; wrap.style='display:inline-flex;align-items:center;margin:0 6px;gap:6px;';

  const a=document.createElement('a'); a.href=link||'#'; if(link&&link!=='#') a.target='_blank'; a.style.textDecoration='none';
  const img=document.createElement('img'); img.src=logo; img.alt=title; img.style='height:1.3em;vertical-align:middle;';
  const labelCount=(typeof count==='number'&&isFinite(count))?`${count.toLocaleString()} ${kind|| (key==='rotten_tomatoes_critic'?'Reviews':'Votes')}`:'';
  img.title=labelCount?`${title} — ${labelCount}`:title;
  a.appendChild(img);

  const s=document.createElement('span'); s.textContent=disp; s.title='Open settings';
  s.style='font-size:1em;vertical-align:middle;cursor:pointer;';
  s.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); if(window.MDBL_OPEN_SETTINGS) window.MDBL_OPEN_SETTINGS(); });

  if (DISPLAY.colorizeRatings){
    const col=r>=COLOR_THRESHOLDS.green?COLOR_VALUES.green:r>=COLOR_THRESHOLDS.orange?COLOR_VALUES.orange:COLOR_VALUES.red;
    if (DISPLAY.colorNumbers) s.style.color=col;
    if (DISPLAY.colorIcons)   img.style.filter=`drop-shadow(0 0 3px ${col})`;
  }

  wrap.append(a,s); container.append(wrap);
  [...container.children]
    .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
    .forEach(el=>container.appendChild(el));
}

/* Fetch (MDBList + extras + RT fallback) */
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

/* RT fallback */
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
  }catch{}
}
const MDbl={debounceTimer:null};
MDbl.debounce=(fn,wait=150)=>{ clearTimeout(MDbl.debounceTimer); MDbl.debounceTimer=setTimeout(fn,wait); };
(new MutationObserver(()=>MDbl.debounce(updateAll,150))).observe(document.body,{childList:true,subtree:true});
updateAll();

})();
