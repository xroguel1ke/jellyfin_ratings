# 🌟 Jellyfin Ratings

**Jellyfin Ratings** allows you to display diverse, customizable ratings directly on your Jellyfin movie and TV show pages. It seamlessly injects ratings from sources like **IMDb, TMDb, Rotten Tomatoes, Metacritic, Trakt, Letterboxd**, and more without modifying core server files.

---

## ✨ Features

* **📊 Comprehensive Sources:** Supports ratings from:
    * IMDb
    * TMDb
    * Trakt
    * Letterboxd
    * Rotten Tomatoes (Critics & Audience)
    * Metacritic (Critics & Users)
    * Roger Ebert
    * AniList & MyAnimeList
* **🔗 Clickable Icons:** Clicking any rating icon (e.g., IMDb, TMDb) opens the specific page for that title on the source website.
* **⭐ Master Rating:** Calculates the average score of all active sources for a quick quality overview.
    * **Smart Wiki Link:** Clicking the Master Rating star performs an "I'm Feeling Lucky" search to take you directly to the English **Wikipedia** article for the title.
* **🎨 Highly Customizable:**
    * **Toggle & Reorder:** Enable only the sources you trust and drag-and-drop them in the settings menu to change their order.
    * **Visual Styles:** Choose between raw numbers or percentages, color-coded scores (Red/Orange/Green).
* **🛡️ Robust Loading:** Uses a resilient injection method that handles network timeouts and caching issues effectively.
* **⚡ Lightweight:** Runs entirely client-side within the browser; no heavy server-side processes required.

---

## 📸 Screenshots

![Item Detail View](assets/screenshots/item_details_page.png)
*Ratings displayed on a movie page, including the Master Rating star.*

![Settings Menu](assets/screenshots/settings_menu.png)
*The configuration menu allows for easy toggling and reordering.*

---

## 🚀 Installation

### Prerequisites
1.  **Jellyfin Server** (recommended version 10.8.0 or newer).
2.  **[Jellyfin JavaScript Injector Plugin](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector)** installed on your server.
3.  A free **[MDBList API Key](https://mdblist.com/preferences)**.

### Step-by-Step Guide

1.  Open your Jellyfin Dashboard and navigate to **Plugins** > **JavaScript Injector**.
2.  Add a new script and paste the following **Robust Loader Code** into the Javascript section:

```javascript
/* ================= Jellyfin Ratings — Robust Injector (v10.2.0) =================
   Features: Timeout, Auto-Retry, Sync Execution & Clean Config.
=============================================================================== */

const CONFIG = {
    // Toggle between development (true) and production/release (false)
    isDevelopment: false, 
    
    // Your API Key (REQUIRED)
    apiKey: 'YOUR-MDBLIST-API-KEY-HERE',
    
    // Source URLs
    urls: {
        dev: '[https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js](https://raw.githubusercontent.com/xroguel1ke/jellyfin_ratings/refs/heads/main/ratings.js)',
        prod: '[https://cdn.jsdelivr.net/gh/xroguel1ke/jellyfin_ratings@main/ratings.js](https://cdn.jsdelivr.net/gh/xroguel1ke/jellyfin_ratings@main/ratings.js)'
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
            if (attempts > 1) console.log(`[Jellyfin Ratings] Retry attempt ${attempts}/${CONFIG.maxRetries}...`);
            
            const res = await fetchWithTimeout(targetUrl, { cache: 'no-store', mode: 'cors' });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const code = await res.text();
            
            // Execute synchronously
            try { new Function(code)(); } catch (e) { (0, eval)(code); }
            
            console.log('[Jellyfin Ratings] Script loaded & executed successfully.');
            success = true;

        } catch (err) {
            console.warn(`[Jellyfin Ratings] Fetch failed (Attempt ${attempts}):`, err.message);
            if (attempts < CONFIG.maxRetries) await sleep(1000); 
        }
    }

    if (!success) {
        console.error('[Jellyfin Ratings] FATAL: Could not load script after multiple attempts.');
    }
})();
`````

⚠️ IMPORTANT: Replace 'YOUR-MDBLIST-API-KEY-HERE' in the code above with your actual MDBList API key.

    Click Save.

    Reload your Jellyfin browser tab (Ctrl+F5) to see the ratings appear.

⚙️ Configuration & Usage

You can configure the script directly inside the Jellyfin web UI without editing any files.

Opening the Menu

    Navigate to any movie or TV show detail page.

    Look for the "Ends at..." time (located next to the runtime/year).

    Click the small Gear Icon (⚙️) next to the time to open the Settings Menu.

Settings Options

    Sources: Toggle individual rating sources on or off.

    Ordering: Drag and drop sources in the list to change their display order.

    Display:

        Color numbers: Colors the text based on the score.

        Show %: Toggles the percentage symbol.

    Colors: Customize the thresholds for Red, Orange, and Green ratings.

Usage

    Source Links: Click on any rating icon (e.g., IMDb logo) to open the corresponding page on the source website in a new tab.

    Wikipedia Link: Click on the Master Rating (⭐ icon) to open a new tab searching for the movie/show on Wikipedia (English). It uses a smart redirect to find the correct article automatically.


🤝 Acknowledgments

    Powered by the amazing MDBList API.

    Built for the Jellyfin community.
