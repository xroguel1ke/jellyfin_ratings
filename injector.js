/* ================= Jellyfin Ratings — Robust Injector (v10.2.0) =================
   Features: Timeout, Auto-Retry, Sync Execution & Clean Config.
=============================================================================== */

const CONFIG = {
    // Toggle between development (true) and production/release (false)
    isDevelopment: true, 
    
    // Your API Key
    apiKey: 'YOUR-MDBLIST-API-KEY-HERE',
    
    // Source URLs
    urls: {
        dev: 'https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js',
        prod: 'https://cdn.jsdelivr.net/gh/xroguel1ke/jellyfin_ratings@main/ratings.js'
    },
    
    // Resilience settings
    timeoutMs: 5000, // Abort fetch after 5 seconds
    maxRetries: 3    // Retry up to 3 times if network fails
};

/* Expose Key */
window.MDBL_KEYS = { MDBLIST: CONFIG.apiKey };
try { localStorage.setItem('mdbl_keys', JSON.stringify(window.MDBL_KEYS)); } catch {}

/* Helper: Fetch with Timeout */
const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

/* Helper: Sleep for Retry */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* Main Loader Logic */
(async () => {
    let targetUrl = CONFIG.isDevelopment 
        ? `${CONFIG.urls.dev}?t=${Date.now()}` 
        : CONFIG.urls.prod;
        
    let attempts = 0;
    let success = false;

    console.log(`[Jellyfin Ratings] Loader initializing... Mode: ${CONFIG.isDevelopment ? 'DEV' : 'PROD'}`);

    while (attempts < CONFIG.maxRetries && !success) {
        attempts++;
        try {
            // Attempt 1, 2, 3...
            if (attempts > 1) console.log(`[Jellyfin Ratings] Retry attempt ${attempts}/${CONFIG.maxRetries}...`);
            
            // Fetch script content (cors mode required for GitHub Raw)
            const res = await fetchWithTimeout(targetUrl, { cache: 'no-store', mode: 'cors' });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const code = await res.text();
            
            // Execute synchronously in current scope (safest for Jellyfin UI)
            try { new Function(code)(); } catch (e) { (0, eval)(code); }
            
            console.log('[Jellyfin Ratings] Script loaded & executed successfully.');
            success = true;

        } catch (err) {
            console.warn(`[Jellyfin Ratings] Fetch failed (Attempt ${attempts}):`, err.message);
            
            // Wait 1 second before next retry, but only if we have retries left
            if (attempts < CONFIG.maxRetries) await sleep(1000); 
        }
    }

    if (!success) {
        console.error('[Jellyfin Ratings] FATAL: Could not load script after multiple attempts.');
    }
})();
