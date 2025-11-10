// ==UserScript==
// @name         Jellyfin Ratings (v6.4.1 — RT deep-link + Fallback)
// @namespace    https://mdblist.com
// @version      6.4.1
// @description  Unified ratings for Jellyfin 10.11.x (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, RT critic+audience, Roger Ebert, Metacritic critic+user). Normalized 0–100, colorized; inline “Ends at …”; parental badge to start; single observer; cached lookups; settings panel. RT icons deep-link via Wikidata.
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
  colorNumbers:true,     // number coloring
  colorIcons:false,      // icon glow
  align:'left',
  endsAtFormat:'24h',    // '24h' | '12h'
  endsAtBullet:false,    // always off
  // New: adjustable color bands & palette selection
  colorBands:{ redMax:50, orangeMax:69, ygMax:79 },
  colorChoice:{ red:0, orange:2, yg:3, mg:0 }
,
  compactLevel:0
};

// === New color swatches & helper ===
const COLOR_SWATCHES = {
  red:    ['#e53935','#f44336','#d32f2f','#c62828'],            // poor
  orange: ['#fb8c00','#f39c12','#ffa726','#ef6c00'],            // okay
  yg:     ['#9ccc65','#c0ca33','#aeea00','#cddc39'],            // orangy‑green (decent)
  mg:     ['#43a047','#66bb6a','#388e3c','#81c784']             // medium green (good+)
};
function getRatingColor(bands, choice, r){
  bands  = bands  || { redMax:50, orangeMax:69, ygMax:79 };
  choice = choice || { red:0,  orange:0,     yg:0,    mg:0 };
  let band;
  if (r <= bands.redMax) band='red';
  else if (r <= bands.orangeMax) band='orange';
  else if (r <= bands.ygMax) band='yg';
  else band='mg';
  const i = Math.max(0, Math.min(3, (choice[band]|0)));
  return COLOR_SWATCHES[band][i];
}

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

const CACHE_DURATION  = 7*24*60*60*1000; // 7 days
const NS              = 'mdbl_';

const ICON_BASE = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/assets/icons';
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

/* ---------- Merge injector config & keys ---------- */
const __CFG__ = (typeof window!=='undefined' && window.MDBL_CFG) ? window.MDBL_CFG : {};
const ENABLE_SOURCES  = Object.assign({}, DEFAULT_ENABLE_SOURCES, __CFG__.sources   || {});
const DISPLAY         = Object.assign({}, DEFAULT_DISPLAY,        __CFG__.display   || {});
const SPACING         = Object.assign({}, DEFAULT_SPACING,        __CFG__.spacing   || {});
const RATING_PRIORITY = Object.assign({}, DEFAULT_PRIORITIES,     __CFG__.priorities|| {});

const INJ_KEYS     = (window.MDBL_KEYS||{});
const LS_KEYS_JSON = localStorage.getItem(`${NS}keys`);
const LS_KEYS      = LS_KEYS_JSON ? (JSON.parse(LS_KEYS_JSON)||{}) : {};
const MDBLIST_API_KEY = String(INJ_KEYS.MDBLIST || LS_KEYS.MDBLIST || 'hehfnbo9y8blfyqm1d37ikubl');

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

/* Primary row helpers */
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
  const content=`Ends at ${timeStr}`;
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

/* Containers + scan */
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
  if (DISPLAY.colorNumbers || DISPLAY.colorIcons){
    const col = getRatingColor(DISPLAY.colorBands, DISPLAY.colorChoice, r);
    if (DISPLAY.colorNumbers) s.style.color=col;
    if (DISPLAY.colorIcons)   img.style.filter=`drop-shadow(0 0 3px ${col})`;
  }


  wrap.append(a,s); container.append(wrap);
  // sort by configured priority
  [...container.children]
    .sort((a,b)=>(RATING_PRIORITY[a.dataset.source]??999)-(RATING_PRIORITY[b.dataset.source]??999))
    .forEach(el=>container.appendChild(el));
}

/* -------- RT Direct Link Resolver (Wikidata P1258) -------- */
function fetchRTDirectLink(imdbId, cb){
  const key = `${NS}rturl_${imdbId}`;
  const cache = localStorage.getItem(key);
  if (cache){ try { return cb(JSON.parse(cache)); } catch {} }
  const q=`SELECT ?rtid WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtid . } LIMIT 1`;
  GM_xmlhttpRequest({
    method:'GET',
    url:'https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),
    onload:r=>{
      try{
        const val = JSON.parse(r.responseText).results.bindings[0]?.rtid?.value || '';
        const url = val ? ('https://www.rottentomatoes.com/' + val.replace(/^https?:\/\/(?:www\.)?rottentomatoes\.com\//,'')) : '';
        if (url) localStorage.setItem(key, JSON.stringify(url));
        cb(url || '');
      }catch{ cb(''); }
    },
    onerror:()=>cb('')
  });
}

/* -------- Fetch ratings (MDBList + extras; RT deep-link + fallback) -------- */
function fetchRatings(tmdbId, imdbId, container, type='movie'){
  GM_xmlhttpRequest({
    method:'GET',
    url:`https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
    onload:r=>{
      if(r.status!==200) return;
      let d; try{ d=JSON.parse(r.responseText); }catch{ return; }
      const title=d.title||''; const slug=Util.slug(title);

      // Collect RT from MDBList first; append after we resolve direct link
      let rtCriticVal=null, rtCriticCnt=null;
      let rtAudienceVal=null, rtAudienceCnt=null;

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

        // Capture RT from MDBList; we'll add after direct-link resolution
        else if ((s==='tomatoes' || s.includes('rotten_tomatoes'))) {
          rtCriticVal = v; rtCriticCnt = cnt;
        }
        else if ((s.includes('popcorn') || s.includes('audience'))) {
          rtAudienceVal = v; rtAudienceCnt = cnt;
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

      const hasMDBL_RT = (rtCriticVal!=null) || (rtAudienceVal!=null);
      if (hasMDBL_RT){
        fetchRTDirectLink(imdbId, (rtUrl)=>{
          const link = rtUrl || (title ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}` : '#');
          if (ENABLE_SOURCES.rotten_tomatoes_critic && rtCriticVal!=null)
            appendRating(container, LOGO.tomatoes, rtCriticVal, 'RT Critic', 'rotten_tomatoes_critic', link, rtCriticCnt, 'Reviews');
          if (ENABLE_SOURCES.rotten_tomatoes_audience && rtAudienceVal!=null)
            appendRating(container, LOGO.audience, rtAudienceVal, 'RT Audience', 'rotten_tomatoes_audience', link, rtAudienceCnt, 'Votes');
        });
      }

      // Extra sources and RT HTML fallback only if MDBList had no RT
      if (ENABLE_SOURCES.anilist)     fetchAniList(imdbId, container);
      if (ENABLE_SOURCES.myanimelist) fetchMAL(imdbId, container);
      if (!hasMDBL_RT && (ENABLE_SOURCES.rotten_tomatoes_critic || ENABLE_SOURCES.rotten_tomatoes_audience))
        fetchRT_HTMLFallback(imdbId, container);
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

/* RT HTML Fallback (parse page) */
function fetchRT_HTMLFallback(imdbId, container){
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

/* ======================================================
   SETTINGS (numbers open this panel)
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

  const DEFAULTS={ sources:deepClone(ENABLE_SOURCES), display:deepClone(DEFAULT_DISPLAY), priorities:deepClone(RATING_PRIORITY) };

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
  :root { --mdbl-right-col: 48px; --mdbl-right-col-wide: 200px; }
  #mdbl-panel{position:fixed;right:16px;bottom:70px;width:480px;max-height: 90vh;overflow:auto;border-radius:14px;
    border:1px solid rgba(255,255,255,0.15);background:rgba(22,22,26,0.94);backdrop-filter:blur(8px);
    color:#eaeaea;z-index:99999;box-shadow:0 20px 40px rgba(0,0,0,0.45);display:none}
  #mdbl-panel header{position:sticky;top:0;background:rgba(22,22,26,0.96);padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08);
    display:flex;align-items:center;gap:8px;cursor:move; z-index:999;background:rgba(22,22,26,0.98);backdrop-filter:blur(8px);}
  #mdbl-panel header h3{margin:0;font-size:15px;font-weight:700;flex:1}
  #mdbl-close{border:none;background:transparent;color:#aaa;font-size:18px;cursor:pointer;padding:4px;border-radius:8px}
  #mdbl-close:hover{background:rgba(255,255,255,0.06);color:#fff}
  #mdbl-panel .mdbl-section{padding:12px 16px;display:flex;flex-direction:column;gap:10px}
  #mdbl-panel .mdbl-subtle{color:#9aa0a6;font-size:12px}

  /* unified two-column grid for perfect checkbox alignment */
  #mdbl-panel .mdbl-row,
  #mdbl-panel .mdbl-source{
    display:grid;grid-template-columns: 1fr var(--mdbl-right-col);
    align-items:center;gap:10px;padding:8px 10px;border-radius:12px
  }
  #mdbl-panel .mdbl-row{background:transparent;border:1px solid rgba(255,255,255,0.06)}
  #mdbl-panel .mdbl-row.wide{ grid-template-columns: 1fr var(--mdbl-right-col-wide); }
  #mdbl-panel input[type="checkbox"]{transform:scale(1.1);justify-self:end}

  /* inputs/selects */
  #mdbl-panel input[type="text"]{width:100%;padding:10px 0;border:0;background:transparent;color:#eaeaea;font-size:14px;outline:none}
  #mdbl-panel select{padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#121317;color:#eaeaea;justify-self:end}
  #mdbl-panel .mdbl-select{width:200px}

  /* actions */
  #mdbl-panel .mdbl-actions{position:sticky;bottom:0;background:rgba(22,22,26,0.96);display:flex;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08)}
  #mdbl-panel button{padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:#1b1c20;color:#eaeaea;cursor:pointer}
  #mdbl-panel button.primary{background:#2a6df4;border-color:#2a6df4;color:#fff}

  /* sources list + boxes */
  #mdbl-sources{display:flex;flex-direction:column;gap:8px}
  .mdbl-source{background:#0f1115;border:1px solid rgba(255,255,255,0.1)}
  .mdbl-src-left{display:flex;align-items:center;gap:10px}
  .mdbl-src-left img{height:18px;width:auto}
  .mdbl-src-left .name{font-size:13px}
  .mdbl-drag-handle{justify-self:start;opacity:0.6;cursor:grab}

  /* API key box styled like a source row (single clean box) */
  #mdbl-key-box{background:#0f1115;border:1px solid rgba(255,255,255,0.1);padding:10px;border-radius:12px}
  
  .mdbl-grid{display:grid;grid-template-columns:1fr;gap:10px;}
  .mdbl-grid .grid-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:12px;}
  @media (max-width: 420px){ .mdbl-grid .grid-row{grid-template-columns:1fr;} }
  .grid-right{display:flex;align-items:center;gap:8px;justify-content:flex-end;}
  .mdbl-num{width:5ch;text-align:right;margin-left:6px;}
  .sw{display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);}

  .mdbl-grid .mdbl-select{min-width:var(--mdbl-right-col-wide);}
  #mdbl-panel ul, #mdbl-panel li{list-style:none;margin:0;padding:0;}
  #mdbl-panel *::marker{content:none;}
  #mdbl-panel hr{border:0;border-top:1px solid rgba(255,255,255,0.08);margin:10px 0;}
/* === Compact toggle layout (buttons left, toggle right) === */
#mdbl-panel .mdbl-actions{ display:flex; align-items:center; gap:8px; }
#mdbl-panel .mdbl-actions .mdbl-grow{ flex:1; }
#mdbl-panel .mdbl-actions .mdbl-compact{ display:inline-flex; align-items:center; gap:6px; opacity:0.95; }
#mdbl-panel .mdbl-actions .mdbl-compact input{ margin:0; }

/* === Content-only compact mode (plus slightly narrower panel) === */
#mdbl-panel[data-compact="1"]{
  --mdbl-right-col:44px; --mdbl-right-col-wide:180px;
  width:440px;
}
#mdbl-panel[data-compact="1"] header{ padding:8px 12px; }
#mdbl-panel[data-compact="1"] header h3{ font-size:14px; }
#mdbl-panel[data-compact="1"] .mdbl-section{ padding:8px 12px; gap:6px; }
#mdbl-panel[data-compact="1"] .mdbl-row,
#mdbl-panel[data-compact="1"] .mdbl-source{ gap:6px; padding:5px 6px; border-radius:10px; }
#mdbl-panel[data-compact="1"] .mdbl-row.wide{ grid-template-columns: 1fr var(--mdbl-right-col-wide); }
#mdbl-panel[data-compact="1"] input[type="checkbox"]{ transform:scale(1.0); }
#mdbl-panel[data-compact="1"] .mdbl-src-left img{ height:16px; }
#mdbl-panel[data-compact="1"] .mdbl-src-left .name{ font-size:12.5px; }
#mdbl-panel[data-compact="1"] .mdbl-actions{ padding:6px 10px; }
#mdbl-panel[data-compact="1"] button{ padding:8px 10px; font-size:13px; }
#mdbl-panel[data-compact="1"] .mdbl-grid{ gap:6px; }
#mdbl-panel[data-compact="1"] .mdbl-grid .grid-row{ gap:8px; }
#mdbl-panel[data-compact="1"] .grid-right{ gap:6px; }
#mdbl-panel[data-compact="1"] .mdbl-num{ width:4ch; font-size:13px; }
#mdbl-panel[data-compact="1"] .sw{ width:16px; height:16px; }

#mdbl-panel[data-compact="1"] hr{ margin:6px 0; }
`;
  if (!document.getElementById('mdbl-settings-css')){
    const style=document.createElement('style'); style.id='mdbl-settings-css'; style.textContent=css; document.head.appendChild(style);
    try{ ensureStyleLast && ensureStyleLast(); }catch{}
  }

  const panel=document.createElement('div'); panel.id='mdbl-panel';
  panel.innerHTML=`
    <header id="mdbl-drag-handle">
      <h3>Jellyfin Ratings — Settings</h3>
      <button id="mdbl-close" aria-label="Close">✕</button>
    </header>

    <div class="mdbl-section" id="mdbl-sec-keys"></div>
    <hr>
    <div class="mdbl-section" id="mdbl-sec-sources"></div>
    <hr>
    <div class="mdbl-section" id="mdbl-sec-display"></div>

    <div class="mdbl-actions">
      <button id="mdbl-btn-reset">Reset</button>
      <button id="mdbl-btn-save" class="primary">Save & Apply</button>
      <div class="mdbl-grow"></div>
      <label class="mdbl-compact" for="mdbl-compact-toggle">
        <span>Compact</span>
        <input type="checkbox" id="mdbl-compact-toggle">
      </label>
    </div>
  `;
  document.body.appendChild(panel);
  // --- Compact toggle wiring (binary: 0=normal, 1=compact) ---
  (function(){
    try{
      const prefs0 = Object.assign({}, DEFAULTS, loadPrefs()||{});
      let cl = 0;
      if (prefs0 && prefs0.display && typeof prefs0.display.compactLevel !== 'undefined') {
        cl = +prefs0.display.compactLevel || 0;
      }
      if (cl > 1) cl = 1;
      if (cl < 0) cl = 0;
      const chk = panel.querySelector('#mdbl-compact-toggle');
      if (chk){
        chk.checked = !!cl;
        panel.setAttribute('data-compact', chk.checked ? '1':'0');
        chk.addEventListener('change', ()=> {
          panel.setAttribute('data-compact', chk.checked ? '1':'0');
        });
        // Persist after any Save (run after other handlers)
        document.addEventListener('click', function(ev){
          const t = ev.target;
          if (t && t.id === 'mdbl-btn-save'){
            setTimeout(()=>{
              const p = (loadPrefs() || {});
              p.display = Object.assign({}, DEFAULT_DISPLAY, p.display||{});
              p.display.compactLevel = chk.checked ? 1 : 0;
              try{ localStorage.setItem(`${NS}prefs`, JSON.stringify(p)); }catch{}
            }, 0);
          }
        });
        // Reset behavior: enforce normal mode visually + in prefs
        document.addEventListener('click', function(ev){
          const t = ev.target;
          if (t && t.id === 'mdbl-btn-reset'){
            setTimeout(()=>{
              const p = (loadPrefs() || {});
              p.display = Object.assign({}, DEFAULT_DISPLAY, p.display||{});
              p.display.compactLevel = 0;
              try{ localStorage.setItem(`${NS}prefs`, JSON.stringify(p)); }catch{}
              chk.checked = false;
              panel.setAttribute('data-compact','0');
            }, 0);
          }
        });
      }
    }catch(e){}
  })();


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
    function mdblUpdateSwatches(){
      const map={red:'col_red',orange:'col_orange',yg:'col_yg',mg:'col_mg'};
      Object.keys(map).forEach(k=>{
        const sel = panel.querySelector('#'+map[k]);
        const sw  = panel.querySelector('#sw_'+k);
        if(sel && sw){
          const idx = +(sel.value||0);
          sw.style.background = COLOR_SWATCHES[k][Math.max(0, Math.min(3, parseInt(sel.value||'0',10) || 0))];
        }
      });
    }

    // Keys: single clean box, input without inner border; shows key if present
    const kWrap=panel.querySelector('#mdbl-sec-keys');
    const injKey=getInjectorKey(); const stored=getStoredKeys().MDBLIST||'';
    const value=injKey?injKey:(stored||'');
    const readonly=injKey?'readonly':'';
    const hasKey=!!(injKey || stored);
    if(hasKey){
      kWrap.innerHTML=`
        <div id="mdbl-key-box" class="mdbl-source">
          <div class="mdbl-key-stored">MDBList API key is stored</div>
        </div>
      `;
    }else{
      kWrap.innerHTML=`
        <div id="mdbl-key-box" class="mdbl-source">
          <input type="text" id="mdbl-key-mdb" placeholder="MDBList API key" value="">
        </div>
      `;
    }
// Sources
    const sWrap=panel.querySelector('#mdbl-sec-sources');
    sWrap.innerHTML=`<div class="mdbl-subtle">Sources (drag to reorder)</div><div id="mdbl-sources"></div>`;
    const sList=sWrap.querySelector('#mdbl-sources');
    orderFromPriorities().forEach(item=>sList.appendChild(makeSourceRow(item)));
    enableDnD(sList);

    // Display — checkbox rows align; dropdown rows get wide right column
    const dWrap=panel.querySelector('#mdbl-sec-display');
    dWrap.innerHTML=`
      <div class="mdbl-subtle">Display</div>
      <div class="mdbl-row"><span>Color numbers</span><input type="checkbox" id="d_colorNumbers" ${DISPLAY.colorNumbers?'checked':''}></div>
      <div class="mdbl-row"><span>Color icons</span><input type="checkbox" id="d_colorIcons" ${DISPLAY.colorIcons?'checked':''}></div>
      <div class="mdbl-row"><span>Show %</span><input type="checkbox" id="d_showPercent" ${DISPLAY.showPercentSymbol?'checked':''}></div>
      <div class="mdbl-row wide">
        <span>Align</span>
        <select id="d_align" class="mdbl-select">
          <option value="left" ${DISPLAY.align==='left'?'selected':''}>left</option>
          <option value="center" ${DISPLAY.align==='center'?'selected':''}>center</option>
          <option value="right" ${DISPLAY.align==='right'?'selected':''}>right</option>
        </select>
      </div>
      <div class="mdbl-row wide">
        <span>Ends at format</span>
        <select id="d_endsFmt" class="mdbl-select">
          <option value="24h" ${DISPLAY.endsAtFormat==='24h'?'selected':''}>24h</option>
          <option value="12h" ${DISPLAY.endsAtFormat==='12h'?'selected':''}>12h</option>
        </select>
      </div>

      <hr>

      <div class="mdbl-subtle">Color bands &amp; palette</div>
      <div class="mdbl-grid">
        <div class="grid-row">
          <label>Rating ≤ <input id="th_red" type="number" min="0" max="100" value="${(DISPLAY.colorBands&&DISPLAY.colorBands.redMax)!=null?DISPLAY.colorBands.redMax:50}" class="mdbl-num"> %</label>
          <div class="grid-right">
            <span class="sw" id="sw_red" title="Current color"></span>
            <select id="col_red" class="mdbl-select">
              <option value="0" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.red===0)?'selected':''}>Alert Red (#e53935)</option>
              <option value="1" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.red===1)?'selected':''}>Tomato (#f44336)</option>
              <option value="2" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.red===2)?'selected':''}>Crimson (#d32f2f)</option>
              <option value="3" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.red===3)?'selected':''}>Deep Red (#c62828)</option>
            </select>
          </div>
        </div>

        <div class="grid-row">
          <label>Rating ≤ <input id="th_orange" type="number" min="0" max="100" value="${(DISPLAY.colorBands&&DISPLAY.colorBands.orangeMax)!=null?DISPLAY.colorBands.orangeMax:69}" class="mdbl-num"> %</label>
          <div class="grid-right">
            <span class="sw" id="sw_orange" title="Current color"></span>
            <select id="col_orange" class="mdbl-select">
              <option value="0" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.orange===0)?'selected':''}>Amber (#fb8c00)</option>
              <option value="1" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.orange===1)?'selected':''}>Signal Orange (#f39c12)</option>
              <option value="2" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.orange===2)?'selected':''}>Apricot (#ffa726)</option>
              <option value="3" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.orange===3)?'selected':''}>Burnt Orange (#ef6c00)</option>
            </select>
          </div>
        </div>

        <div class="grid-row">
          <label>Rating ≤ <input id="th_yg" type="number" min="0" max="100" value="${(DISPLAY.colorBands&&DISPLAY.colorBands.ygMax)!=null?DISPLAY.colorBands.ygMax:79}" class="mdbl-num"> %</label>
          <div class="grid-right">
            <span class="sw" id="sw_yg" title="Current color"></span>
            <select id="col_yg" class="mdbl-select">
              <option value="0" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.yg===0)?'selected':''}>Lime Leaf (#9ccc65)</option>
              <option value="1" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.yg===1)?'selected':''}>Citrus (#c0ca33)</option>
              <option value="2" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.yg===2)?'selected':''}>Chartreuse (#aeea00)</option>
              <option value="3" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.yg===3)?'selected':''}>Soft Lime (#cddc39)</option>
            </select>
          </div>
        </div>

        <div class="grid-row">
          <label id="label_top_tier">Top tier (≥ ${(((DISPLAY.colorBands&&DISPLAY.colorBands.ygMax)!=null?DISPLAY.colorBands.ygMax:79)+1)}%)</label>
          <div class="grid-right">
            <span class="sw" id="sw_mg" title="Current color"></span>
            <select id="col_mg" class="mdbl-select">
              <option value="0" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.mg===0)?'selected':''}>Emerald (#43a047)</option>
              <option value="1" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.mg===1)?'selected':''}>Leaf Green (#66bb6a)</option>
              <option value="2" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.mg===2)?'selected':''}>Forest (#388e3c)</option>
              <option value="3" ${(DISPLAY.colorChoice&&DISPLAY.colorChoice.mg===3)?'selected':''}>Mint (#81c784)</option>
            </select>
          </div>
        </div>
      </div>
    `;
  
    
    const _ygInput = panel.querySelector('#th_yg');
    const _labelTop  = panel.querySelector('#label_top_tier');
    if(_ygInput && _labelTop){
      const upd=()=>{
        const v=parseInt(_ygInput.value||'79',10);
        const x=isNaN(v)?80:(v+1);
        _labelTop.textContent=`Top tier (≥ ${x}%)`;
      };
      _ygInput.addEventListener('input', upd);
      upd();
    }['#col_red','#col_orange','#col_yg','#col_mg'].forEach(id=>{
      const el = panel.querySelector(id);
      if(el) el.addEventListener('change', mdblUpdateSwatches);
    });
    mdblUpdateSwatches();}

  function show(){ panel.style.display='block'; }
  function hide(){ panel.style.display='none'; }
  window.MDBL_OPEN_SETTINGS=()=>{ render(); show(); };
  panel.addEventListener('click', e=>{ if(e.target.id==='mdbl-close') hide(); });
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
    prefs.display.colorNumbers      = panel.querySelector('#d_colorNumbers').checked;
    prefs.display.colorIcons        = panel.querySelector('#d_colorIcons').checked;
    prefs.display.showPercentSymbol = panel.querySelector('#d_showPercent').checked;    // color bands
    let _r = parseInt(panel.querySelector('#th_red')?.value||'50',10);
    let _o = parseInt(panel.querySelector('#th_orange')?.value||'69',10);
    let _y = parseInt(panel.querySelector('#th_yg')?.value||'79',10);
    if(!isFinite(_r)) _r=50; if(!isFinite(_o)) _o=69; if(!isFinite(_y)) _y=79;
    _r=Math.max(0,Math.min(100,_r));
    _o=Math.max(0,Math.min(100,_o));
    _y=Math.max(0,Math.min(100,_y));
    if(!(_r<_o && _o<_y)){ _o=Math.max(_r+1,_o); _y=Math.max(_o+1,_y); _y=Math.min(100,_y); }
    prefs.display.colorBands = { redMax:_r, orangeMax:_o, ygMax:_y };
    // palette choice
    prefs.display.colorChoice = {
      red: +(panel.querySelector('#col_red')?.value||0),
      orange: +(panel.querySelector('#col_orange')?.value||0),
      yg: +(panel.querySelector('#col_yg')?.value||0),
      mg: +(panel.querySelector('#col_mg')?.value||0)
    };

    prefs.display.align             = panel.querySelector('#d_align').value;
    prefs.display.endsAtFormat      = panel.querySelector('#d_endsFmt').value;

    savePrefs(prefs); applyPrefs(prefs);

    // keys (only if no injector key)
    const injKey=getInjectorKey(); const keyInput=panel.querySelector('#mdbl-key-mdb');
    if(keyInput && !injKey) setStoredKey((keyInput.value||'').trim());

    if(window.MDBL_API?.refresh) window.MDBL_API.refresh();
    location.reload();
  });
} )();



/* === MDBList Ratings — Uniform UI Patch (non-destructive) === */
(function(){
  const STYLE_ID = 'mdbl-uniform-ui';
  // Keep our style after the core settings CSS for guaranteed precedence
  function ensureStyleLast(){
    const my = document.getElementById(STYLE_ID);
    const core = document.getElementById('mdbl-settings-css');
    if (my && core && my.previousSibling !== core){
      try{ core.after(my); }catch{}
    }
  }
  const headObserver = new MutationObserver((ms)=>{
    for(const m of ms){
      for(const n of m.addedNodes){
        if(n && n.nodeType===1 && n.id==='mdbl-settings-css'){ ensureStyleLast(); }
      }
    }
  });
  try{ headObserver.observe(document.head||document.documentElement, {childList:true, subtree:true}); }catch{}
  setTimeout(ensureStyleLast, 0);

  function addStyles(){
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #mdbl-panel{ --mdbl-font-ui:14px; --mdbl-font-body:14px; }
      #mdbl-panel, #mdbl-panel .mdbl-section, #mdbl-panel label, #mdbl-panel .mdbl-subtle, #mdbl-panel .mdbl-src-left .name{ font-size: var(--mdbl-font-body); }
      #mdbl-panel select,
      #mdbl-panel input[type="text"],
      #mdbl-panel input[type="number"],
      #mdbl-panel button{ font-size: var(--mdbl-font-ui); }

      /* Numeric threshold inputs look like selects */
      #mdbl-panel input[type="number"].mdbl-select{
        width:64px;
        padding:8px 10px;
        border-radius:10px;
        border:1px solid rgba(255,255,255,0.15);
        background:#121317;
        color:#eaeaea;
        outline:none;
      }
      #mdbl-panel input[type="number"].mdbl-select:focus{
        border-color:rgba(255,255,255,0.25);
        box-shadow:0 0 0 3px rgba(42,109,244,0.2);
      }

      /* Prevent compact mode from shrinking font sizes */
      #mdbl-panel[data-compact="1"] .mdbl-src-left .name,
      #mdbl-panel[data-compact="1"] button,
      #mdbl-panel[data-compact="1"] .mdbl-num{ font-size: inherit !important; }
    
      /* Uniform height for selects and numeric inputs */
      #mdbl-panel select.mdbl-select,
      #mdbl-panel input[type="number"].mdbl-select{
        min-height:40px !important;
        height:40px !important;
        padding:0 10px !important;
        border-radius:10px !important;
        background:#121317 !important;
        color:#eaeaea !important;
        border:1px solid rgba(255,255,255,0.15) !important;
        box-sizing:border-box !important;
      }
      #mdbl-panel select.mdbl-select:focus,
      #mdbl-panel input[type="number"].mdbl-select:focus{
        border-color:rgba(255,255,255,0.25);
        box-shadow:0 0 0 3px rgba(42,109,244,0.2);
        outline:none;
      }
      /* Ensure the two specific boxes match the same height */
      #mdbl-panel #d_align.mdbl-select,
      #mdbl-panel #d_endsFmt.mdbl-select{ height:40px !important; }
`;
    const style=document.createElement('style'); style.id=STYLE_ID; style.textContent=css; document.head.appendChild(style);
    try{ ensureStyleLast && ensureStyleLast(); }catch{}
  }
  function patchInputs(root=document){
    ['th_red','th_orange','th_yg'].forEach(id=>{
      const el = root.querySelector ? root.querySelector('#'+id) : null;
      if (el && !el.classList.contains('mdbl-select')) el.classList.add('mdbl-select');
    });
  }
  // Observe for settings panel injection
  const observer = new MutationObserver((mutations)=>{
    for(const m of mutations){
      for(const node of m.addedNodes){
        if(node && node.nodeType===1){
          const panel = node.id==='mdbl-panel' ? node : (node.querySelector ? node.querySelector('#mdbl-panel') : null);
          if(panel){
            addStyles();
            // wait a tick for innerHTML to populate
            setTimeout(()=>patchInputs(panel), 0);
          }
        }
      }
    }
  });
  try{ observer.observe(document.documentElement, {childList:true, subtree:true}); }catch{}
  // In case panel is already there
  addStyles(); patchInputs();
})();



/* === MDBList Ratings — Inline Style Fallback (force visible changes) === */
(function(){
  function styleCtl(el){
    if(!el) return;
    el.classList.add('mdbl-select');
    el.style.setProperty('height','40px','important');
    el.style.setProperty('min-height','40px','important');
    el.style.setProperty('padding','0 10px','important');
    el.style.setProperty('border-radius','10px','important');
    el.style.setProperty('border','1px solid rgba(255,255,255,0.15)','important');
    el.style.setProperty('background','#121317','important');
    el.style.setProperty('color','#eaeaea','important');
    el.style.setProperty('box-sizing','border-box','important');
  }
  function patchPanel(panel){
    // Uniform heights for Align & Ends format
    styleCtl(panel.querySelector('#d_align'));
    styleCtl(panel.querySelector('#d_endsFmt'));

    // Color-band percentage inputs
    styleCtl(panel.querySelector('#th_red'));
    styleCtl(panel.querySelector('#th_orange'));
    styleCtl(panel.querySelector('#th_yg'));
  }
  function tryPatch(root=document){
    const p = root.querySelector('#mdbl-panel');
    if(p) patchPanel(p);
  }
  // Patch now and whenever panel changes
  tryPatch();
  const obs = new MutationObserver(()=>tryPatch());
  try{
    obs.observe(document.documentElement,{subtree:true,childList:true});
  }catch{}
  // Best-effort: add a spinner-hiding style (WebKit) and appearance reset
  try{
    if(!document.getElementById('mdbl-inline-fallback-style')){
      const st=document.createElement('style');
      st.id='mdbl-inline-fallback-style';
      st.textContent = `
        #mdbl-panel input[type="number"].mdbl-select::-webkit-outer-spin-button,
        #mdbl-panel input[type="number"].mdbl-select::-webkit-inner-spin-button{ -webkit-appearance: none; margin: 0; }
        #mdbl-panel input[type="number"].mdbl-select{ appearance: textfield; }`;
      (document.head||document.documentElement).appendChild(st);
    }
  }catch{}

  // Narrow the percentage inputs explicitly
  try{
    const n1 = document.querySelector('#th_red');
    const n2 = document.querySelector('#th_orange');
    const n3 = document.querySelector('#th_yg');
    [n1,n2,n3].forEach(n=>{ if(n){ n.style.setProperty('width','64px','important'); n.style.setProperty('text-align','right'); n.style.setProperty('display','inline-block'); } });
  }catch{}
})();
