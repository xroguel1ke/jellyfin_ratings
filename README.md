# Jellyfin Ratings

Add clean, clickable ratings to Jellyfin item pages (movies, shows, and anime) from popular sites. Configure everything from a small gear icon in the bottom‑right corner of the item page — no server restart needed.

---

## Features

* Adds rating badges to item pages with links back to the source.
* Works for movies, series, and anime.
* Turn individual sources on/off.
* **Drag & drop** to reorder which ratings appear first (from the in‑app menu).
* Lightweight; loads only when needed in the web UI.

### Available rating sources

* IMDb
* TMDb
* Trakt
* Letterboxd
* Rotten Tomatoes (Critics)
* Rotten Tomatoes (Audience)
* Roger Ebert
* Metacritic (Critics)
* Metacritic (Users)
* AniList
* MyAnimeList

---

## Requirements

* JavaScript Injector Plugin (required)
* MDBList API key (required)

---

## Quick start (JavaScript Injector)

1. Install a JavaScript‑injector method for Jellyfin (e.g., the **JavaScript Injector** plugin).
2. Paste the contents of JS-Injector-code.js into the injector plugin:

   ```html
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
   ```
3. Save and refresh Jellyfin in your browser

---

## Configure

1. Open any movie/series/anime item page in Jellyfin.
2. Click the rating **number** to open the Settings panel. Clicking a rating **icon** opens its source page (IMDb, TMDb, etc.).
3. Paste your **MDBList API Key** and **Save**.
4. Toggle the sources you want.
5. Use **drag & drop** in the menu to reorder how the ratings appear.

---

## FAQ

**Do I need a TMDb key?**
No. Only an **MDBList** key is required.

**Where do I get the MDBList key?**
Create an account at mdblist and generate an API key, then paste it into the gear‑menu input.

**It doesn’t load on first visit.**
Make sure your injector snippet points to the correct `ratings.js` URL in your GitHub repo and that the file is public. Hard‑refresh the page to bust cache if you just updated the script.

---

## Contributing

Issues and pull requests are welcome. Please keep changes focused and include a short description of what’s improved.

---

## License

MIT License

You can include this standard MIT notice in a `LICENSE` file:

```
MIT License

Copyright (c) YEAR YOUR NAME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Acknowledgments

Thanks to the Jellyfin community and the rating providers listed above.
