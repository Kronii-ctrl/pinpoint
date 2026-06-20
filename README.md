# 📍 Pinpoint — AI Geolocation

Find **where a photo was taken**, and look up any IP or place — all in a single
client-side web page. Your Gemini API key never leaves your browser.

## Two ways to locate

### 📷 Photo
Drop, paste, or pick a photo. Pinpoint runs **two paths**:

1. **Exact — GPS metadata.** If the photo still carries EXIF GPS data (most
   straight-from-the-camera-roll shots do), you get the **real coordinates the
   camera recorded** — accurate to a few metres — plus the direction it was
   facing, altitude, timestamp and camera model.
2. **AI best-guess.** When there's no metadata (screenshots and social-media
   images are usually stripped), Gemini vision plays GeoGuessr/OSINT: it reads
   every legible sign, plate and shop name, weighs architecture, road markings,
   vegetation, terrain and sun position, and returns a best guess **with a
   confidence score, precision level, error radius, the clues it used, and
   alternative candidates** — all plotted on the map.

> ⚠️ **Honest accuracy note.** Metadata = genuinely pinpoint. No metadata = a
> best *guess* from pixels: often city/landmark-accurate, sometimes street-exact,
> rarely GPS-exact. The confidence score and error radius tell you how much to
> trust it. No tool can reliably extract meter-level coordinates from a picture
> that has no identifiable clues.

### 🔎 IP / Place
Type an IP address (city-level geolocation via [ipwho.is](https://ipwho.is)) or a
place name (geocoded via OpenStreetMap), or hit **Use my current IP**.

## Accuracy tips (for the AI path)
- Use **gemini-2.5-pro** (default) — it reasons hardest over subtle clues.
- Keep **high-resolution** on so tiny street signs / plates stay legible.
- Keep **Google Search grounding** on so the model can verify landmarks instead
  of guessing.
- Photos with **readable text** (signs, business names, license plates) pinpoint
  far better than empty landscapes.

## Setup
1. Get a free Gemini API key → https://aistudio.google.com/app/apikey
2. Open the app, click **⚙**, paste the key, **Save**.
3. That's it — the key lives only in your browser's `localStorage`.

## Tech
Pure HTML/CSS/JS, no build step. [Leaflet](https://leafletjs.com) + CARTO/OSM
tiles for the map (no key), [exifr](https://github.com/MikeKovarik/exifr) for
metadata, Google Gemini for vision. Deploys as static files (e.g. GitHub Pages).

## Privacy
Everything runs in your browser. Photos are sent **only** to Google's Gemini API
for the AI analysis (and never when a photo resolves purely from its GPS
metadata, if you skip analysis). The API key is never uploaded or committed.
