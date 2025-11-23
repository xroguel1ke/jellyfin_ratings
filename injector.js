/* ================= Jellyfin Ratings — Minimal Injector (v10.1.1) =================
   Optimierter Loader mit sauberer Trennung zwischen Dev- und Release-Modus.
============================================================================ */

/* 0) Development/Production Mode: 
   - true: Nutzt GitHub Raw + Cache Buster (Gut zum Testen).
   - false: Nutzt jsDelivr (Gut für Endnutzer: schneller & korrekte Header).
*/
const IS_DEVELOPMENT = true; 

/* 1) Your MDBList API key (required) */
const MDBLIST_KEY = 'MDBLIST-API-KEY-HERE'; 

/* Expose key + mirror to localStorage */
window.MDBL_KEYS = { MDBLIST: MDBLIST_KEY };
try { localStorage.setItem('mdbl_keys', JSON.stringify(window.MDBL_KEYS)); } catch {}

/* 2) Loader Logic */
(async () => {
  const GITHUB_URL = 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js';
  const JSDELIVR_URL = 'https://cdn.jsdelivr.net/gh/xroguel1ke/jellyfin_ratings@main/ratings.js';
  
  let finalUrl, debugInfo;

  if (IS_DEVELOPMENT) {
    // Im Dev-Modus: Cache-Buster erzwingen
    finalUrl = `${GITHUB_URL}?t=${Date.now()}`;
    debugInfo = 'Development Mode (GitHub Raw + Cache Buster)';
  } else {
    // Im Prod-Modus: Stabile jsDelivr-URL verwenden
    finalUrl = JSDELIVR_URL;
    debugInfo = 'Production Mode (jsDelivr)';
  }

  console.log(`[Jellyfin Ratings] Loader starting (${debugInfo}) from: ${finalUrl.split('?')[0]}`);

  try {
    const res = await fetch(finalUrl, { cache: 'no-store', mode: 'cors' });
    
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}. Could not fetch script.`);
    }

    const code = await res.text();
    
    // ZUVERLÄSSIGE AUSFÜHRUNG: Eval/Function-Konstrukt
    try { 
      new Function(code)(); 
    } catch (e) { 
      // Fallback für strikte Umgebungen, fängt aber keine Syntaxfehler
      (0, eval)(code); 
    } 

    console.log('[Jellyfin Ratings] Script executed successfully.');

  } catch (err) {
    console.error(`[Jellyfin Ratings] FATAL LOADER ERROR:`, err);
    if (!IS_DEVELOPMENT) {
      console.warn('[Jellyfin Ratings] TIP: If this is a new version, jsDelivr caching may take up to 15 minutes.');
    }
  }
})();
