# Anime Mine browser extension

Clickable Japanese subtitles on Netflix, YouTube and Crunchyroll. Lookups and Anki mining go through the Anime Mine desktop app.

**Chrome:** open `chrome://extensions`, enable Developer mode, click Load unpacked, and pick this `extension/` folder.

**Firefox:** open `about:debugging`, choose This Firefox, click Load Temporary Add-on, and pick `manifest.json` in this folder.

**Connect:** in Anime Mine, open Settings -> Browser extension to copy the port and token. Paste them into the extension popup and click Test connection.

**Other sites:** click Enable on this site in the popup to run captions on the current page. The browser asks for permission for the site's domains, so approve it to continue.
Enabling is per site. The top-level site is enabled by default; tick an embedded frame's host in the popup if the video player lives on another site. The bar's Jimaku button fetches subtitles for the current episode, and a video page with a recognised episode label and no subtitles loaded fetches them automatically; both need the Jimaku API key set in Anime Mine settings.

**Sites:** Netflix and YouTube use their own caption DOM. Crunchyroll has no site-specific selectors yet and relies on the generic `<video>` text track fallback, which is unverified there.

**Limits:**
- Netflix audio is recorded from your Mac's system audio by the Anime Mine app (last ~30 s kept in memory only, never saved to disk). macOS asks for Screen Recording permission for Anime Mine the first time; the screenshot may still be black on DRM video.
- Crunchyroll caption detection is unverified.
- Netflix Japanese subtitles must be switched on in the player.
- The generic fallback only handles text tracks that are enabled on the video.

**Shortcuts:** with the card open, press M to mine the word, S to mine the sentence, Esc to close.
