/* =========================================================
   Jellyfin Ratings — Minimal Injector
   ---------------------------------------------------------
   What this loads:
     • A single userscript from your GitHub that adds unified ratings
       (IMDb, TMDb, Trakt, Letterboxd, AniList, MAL, Metacritic critic/user,
       Rotten Tomatoes critic/audience, Roger Ebert) to Jellyfin item pages.
     • A built-in Settings panel (click any rating number) with:
       - Source toggles + drag-to-reorder
       - Display options (colors, %, align, “Ends at” format/bullet)
       - Local MDBList API key input
       - Save & Apply (hard refresh)

   How to use:
     1) Paste THIS injector snippet into the Jellyfin JS Injector.
     2) (Optional) Put your MDBList key below. Keys set here override any local key.
     3) Visit an item page; click any rating number to open Settings.

   Notes:
     • Your key never goes in GitHub; it stays client-side in the injector/localStorage.
     • You can leave CONFIG empty—use the in-app menu for tweaks.
========================================================= */

/* 1) (Optional) Provide only what you want to pre-set.
      You can omit the whole block and rely on the Settings panel instead. */
window.MDBL_CFG = {
  // Example initial overrides (everything is also adjustable in Settings):
  // display: { align: 'left', endsAtFormat: '24h', endsAtBullet: false },
  // sources: { imdb: true, tmdb: true, trakt: true },
  // priorities: { imdb:1, tmdb:2, trakt:3 }
};

/* 2) Keys (client-side only). MDBList is the only required one. */
window.MDBL_KEYS = {
  MDBLIST: 'YOUR-API-KEY-HERE'
};
// Mirror for reloads (harmless if blocked).
try { localStorage.setItem('mdbl_keys', JSON.stringify(window.MDBL_KEYS)); } catch {}

/* 3) Loader — fetch your GitHub script and run it (cache-busted). */
(async () => {
  const RAW_URL = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js';
  try {
    const res  = await fetch(`${RAW_URL}?t=${Date.now()}`, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    try { new Function(code)(); } catch { (0, eval)(code); }
  } catch (err) {
    console.error('[Jellyfin Ratings] loader failed:', err);
  }
})();
