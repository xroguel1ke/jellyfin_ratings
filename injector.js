/* ================= Jellyfin Ratings — Minimal Injector =================
   Paste into Jellyfin’s JS Injector.
   • Set your MDBList key below (client-side only; never in GitHub).
   • Open Settings by clicking any rating number or the parental rating.
============================================================================ */

/* 0) Your MDBList API key (required) */
const MDBLIST_KEY = 'YOUR-API-KEY-HERE';

/* Expose key + mirror to localStorage (overrides any local key) */
window.MDBL_KEYS = { MDBLIST: MDBLIST_KEY };
try { localStorage.setItem('mdbl_keys', JSON.stringify(window.MDBL_KEYS)); } catch {}

/* Loader — fetch your GitHub script (cache-busted) and run it */
(async () => {
  const RAW_URL = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js';
  try {
    const res = await fetch(`${RAW_URL}?t=${Date.now()}`, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    try { new Function(code)(); } catch { (0, eval)(code); } // fallback
  } catch (err) {
    console.error('[Jellyfin Ratings] loader failed:', err);
  }
})();
