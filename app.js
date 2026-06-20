"use strict";

/* ------------------------------------------------------------------ *
 *  PINPOINT — AI geolocation
 *  Find where a photo was taken (exact GPS metadata, or an AI
 *  best-guess from visual clues) + IP / place lookup.
 *  Pure client-side. Your Gemini API key lives only in this browser.
 * ------------------------------------------------------------------ */

const store = {
  get key()        { return localStorage.getItem("pp.key") || ""; },
  set key(v)       { localStorage.setItem("pp.key", v); },
  get model()      { return localStorage.getItem("pp.model") || "gemini-2.5-pro"; },
  set model(v)     { localStorage.setItem("pp.model", v); },
  get grounding()  { return localStorage.getItem("pp.grounding") !== "off"; },
  set grounding(v) { localStorage.setItem("pp.grounding", v ? "on" : "off"); },
  get hires()      { return localStorage.getItem("pp.hires") !== "off"; },
  set hires(v)     { localStorage.setItem("pp.hires", v ? "on" : "off"); },
  get visionKey()  { return localStorage.getItem("pp.visionkey") || ""; },
  set visionKey(v) { localStorage.setItem("pp.visionkey", v); },
  get deep()       { return localStorage.getItem("pp.deep") !== "off"; },
  set deep(v)      { localStorage.setItem("pp.deep", v ? "on" : "off"); },
};

const $ = (id) => document.getElementById(id);
const els = {
  statusChip: $("statusChip"), statusText: $("statusText"),
  settingsBtn: $("settingsBtn"), closeSettings: $("closeSettings"),
  overlay: $("overlay"), settings: $("settings"), saveSettings: $("saveSettings"),
  apiKey: $("apiKey"), model: $("model"), groundingToggle: $("groundingToggle"), hiresToggle: $("hiresToggle"),
  deepToggle: $("deepToggle"), visionKey: $("visionKey"),
  tabPhoto: $("tab-photo"), tabLookup: $("tab-lookup"),
  modePhoto: $("mode-photo"), modeLookup: $("mode-lookup"),
  dropzone: $("dropzone"), fileInput: $("fileInput"), dzEmpty: $("dzEmpty"), dzPreview: $("dzPreview"),
  analyzeBtn: $("analyzeBtn"), clearBtn: $("clearBtn"), photoResults: $("photoResults"),
  lookupForm: $("lookupForm"), lookupInput: $("lookupInput"), myIpBtn: $("myIpBtn"), lookupResults: $("lookupResults"),
  map: $("map"), mapBadge: $("mapBadge"),
};

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (typeof n === "number" && isFinite(n)) ? n.toFixed(6) : "—";
const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

function setStatus(state, text) {
  els.statusChip.className = "status " + (state || "");
  els.statusText.textContent = text;
}

/* ---------- Leaflet map ---------- */
let map, markerLayer, darkLayer, satLayer;
function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
  darkLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20, subdomains: "abcd",
  }).addTo(map);
  satLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "&copy; Esri", maxZoom: 19,
  });
  L.control.layers({ "🌑 Dark": darkLayer, "🛰️ Satellite": satLayer }, null, { position: "topright" }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 200);
}
function useSatellite(on) {
  if (on && !map.hasLayer(satLayer)) { map.removeLayer(darkLayer); satLayer.addTo(map); }
  if (!on && !map.hasLayer(darkLayer)) { map.removeLayer(satLayer); darkLayer.addTo(map); }
}

function colorIcon(color) {
  return L.divIcon({
    className: "", iconSize: [22, 22], iconAnchor: [11, 11],
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};
           border:3px solid #05080c;box-shadow:0 0 0 2px ${color},0 0 12px ${color};"></div>`,
  });
}
// A big dropping pin for the dramatic photo reveal.
function dropPin(color) {
  return L.divIcon({
    className: "", iconSize: [34, 46], iconAnchor: [17, 44], popupAnchor: [0, -42],
    html: `<div class="drop-pin" style="--pin:${color}">
             <svg viewBox="0 0 34 46" width="34" height="46"><path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 15 29 15 29s15-18.5 15-29C32 7.7 25.3 1 17 1z"
               fill="${color}" stroke="#05080c" stroke-width="2"/><circle cx="17" cy="16" r="6" fill="#05080c"/></svg>
           </div>`,
  });
}
const PRECISION_ZOOM = { "exact-building": 18, street: 17, neighborhood: 15, city: 12, region: 8, country: 5, continent: 3, unknown: 4 };

/* points: [{lat,lng,color,label,popup,radius_m}] */
function plot(points, badge) {
  markerLayer.clearLayers();
  const valid = points.filter((p) => isFinite(p.lat) && isFinite(p.lng));
  if (!valid.length) return;
  const latlngs = [];
  for (const p of valid) {
    L.marker([p.lat, p.lng], { icon: colorIcon(p.color) })
      .addTo(markerLayer)
      .bindPopup(p.popup || p.label || "");
    latlngs.push([p.lat, p.lng]);
    if (p.radius_m && p.radius_m > 0) {
      L.circle([p.lat, p.lng], {
        radius: p.radius_m, color: p.color, weight: 1, opacity: .5,
        fillColor: p.color, fillOpacity: .10,
      }).addTo(markerLayer);
    }
  }
  if (valid.length === 1 && !valid[0].radius_m) {
    map.setView(latlngs[0], 15);
  } else {
    map.fitBounds(L.latLngBounds(latlngs).pad(0.4), { maxZoom: 16 });
  }
  if (badge) { els.mapBadge.textContent = badge; els.mapBadge.hidden = false; }
  else els.mapBadge.hidden = true;
  setTimeout(() => map.invalidateSize(), 100);
}

/* Rainbolt-style reveal: spin the globe, fly to the spot, drop the pin. */
function revealLocation(primary, alternates, badge) {
  markerLayer.clearLayers();
  if (!primary || !isFinite(primary.lat) || !isFinite(primary.lng)) return;
  els.mapBadge.hidden = true;
  useSatellite(true);
  // start from a wide world view for the "zoom from space" effect
  map.setView([primary.lat, Math.max(-160, Math.min(160, primary.lng))], 2, { animate: false });
  const zoom = PRECISION_ZOOM[primary.precision] || 12;

  // Drop the pin once we arrive — but never depend solely on the animation
  // firing (background tabs / throttled rAF can stall flyTo), so guard with a
  // fallback timer that lands the pin regardless.
  let placed = false;
  const place = () => {
    if (placed) return; placed = true;
    const m = L.marker([primary.lat, primary.lng], { icon: dropPin(primary.color), zIndexOffset: 1000 })
      .addTo(markerLayer).bindPopup(primary.popup || "");
    setTimeout(() => m.openPopup(), 450);
    if (primary.radius_m > 0) L.circle([primary.lat, primary.lng], {
      radius: primary.radius_m, color: primary.color, weight: 1, opacity: .6, fillColor: primary.color, fillOpacity: .12,
    }).addTo(markerLayer);
    (alternates || []).forEach((a) => {
      if (isFinite(a.lat) && isFinite(a.lng))
        L.marker([a.lat, a.lng], { icon: colorIcon("#57b6ff") }).addTo(markerLayer).bindPopup(a.popup || "");
    });
    if (badge) { els.mapBadge.textContent = badge; els.mapBadge.hidden = false; }
  };

  setTimeout(() => {
    map.flyTo([primary.lat, primary.lng], zoom, { duration: 2.4, easeLinearity: 0.25 });
    map.once("moveend", place);
    // Fallback: if the fly animation never completes (throttled rAF / background
    // tab), snap to the target and drop the pin anyway.
    setTimeout(() => { if (!placed) { map.setView([primary.lat, primary.lng], zoom, { animate: false }); place(); } }, 2900);
  }, 350);
  setTimeout(() => map.invalidateSize(), 100);
}

/* ---------- Tabs ---------- */
function switchMode(mode) {
  const photo = mode === "photo";
  els.tabPhoto.classList.toggle("active", photo);
  els.tabLookup.classList.toggle("active", !photo);
  els.modePhoto.classList.toggle("hidden", !photo);
  els.modeLookup.classList.toggle("hidden", photo);
  setTimeout(() => map && map.invalidateSize(), 50);
}
els.tabPhoto.addEventListener("click", () => switchMode("photo"));
els.tabLookup.addEventListener("click", () => switchMode("lookup"));

/* ================================================================== *
 *  PHOTO MODE
 * ================================================================== */
let currentFile = null;

function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    els.photoResults.innerHTML = `<div class="card error-card">That doesn't look like an image file.</div>`;
    return;
  }
  currentFile = file;
  els.dzPreview.src = URL.createObjectURL(file);
  els.dzPreview.hidden = false;
  els.dzEmpty.hidden = true;
  els.analyzeBtn.disabled = false;
  els.clearBtn.disabled = false;
  els.photoResults.innerHTML = `<p class="placeholder">Ready. Press <b>Pinpoint location</b> to read the metadata and run AI analysis.</p>`;
}

els.fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));
els.dropzone.addEventListener("dragover", (e) => { e.preventDefault(); els.dropzone.classList.add("dragover"); });
els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("dragover"));
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault(); els.dropzone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
// Paste an image straight from the clipboard
window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) { switchMode("photo"); loadFile(item.getAsFile()); }
});

els.clearBtn.addEventListener("click", () => {
  currentFile = null;
  els.dzPreview.hidden = true; els.dzEmpty.hidden = false; els.fileInput.value = "";
  els.analyzeBtn.disabled = true; els.clearBtn.disabled = true;
  els.photoResults.innerHTML = `<p class="placeholder">Photos with GPS metadata resolve to <b>exact</b> coordinates. Otherwise the AI reads signs, architecture, plates &amp; terrain to make its best guess.</p>`;
  useSatellite(false);
  plot([]);
});

/* ---- read EXIF GPS from the original file ---- */
async function readExif(file) {
  try {
    const data = await exifr.parse(file, { gps: true, tiff: true, exif: true, ifd0: true });
    if (!data) return null;
    const lat = data.latitude, lng = data.longitude;
    return {
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      direction: data.GPSImgDirection ?? null,
      altitude: data.GPSAltitude ?? null,
      taken: data.DateTimeOriginal || data.CreateDate || null,
      camera: [data.Make, data.Model].filter(Boolean).join(" ") || null,
    };
  } catch { return null; }
}

/* ---- downscale for the AI call (preserves legibility of signs) ---- */
function fileToAIImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      URL.revokeObjectURL(img.src);
      resolve({ mimeType: "image/jpeg", data: dataUrl.split(",")[1] });
    };
    img.onerror = () => reject(new Error("Could not read the image (HEIC may need conversion)."));
    img.src = URL.createObjectURL(file);
  });
}

const GEO_PROMPT = `You are a world-champion GeoGuessr player and OSINT investigator — think Rainbolt. Pinpoint where this photo was taken, fast and confident, but back every call with evidence.

Spot the "metas" like a pro:
1. TRANSCRIBE all readable text: shop/business names, street & road signs, license plates, phone area codes, posters, brand logos, graffiti. Even partial text is gold.
2. Script & language, region-specific spellings, domain suffixes (.br, .ng…), phone formats.
3. Driving side, road-line colour & pattern, bollards, chevrons, traffic-signal & sign design.
4. Utility/power poles, guardrails, license-plate shape & colour.
5. Architecture, building materials, roofing, urban vs rural layout.
6. Vegetation, soil/terrain colour, climate cues, sun position & shadow direction (hemisphere).
7. Landmarks, mountain silhouettes, coastlines, skylines.

Then triangulate to the most specific location the evidence supports.

CRITICAL FOR ACCURACY: your recalled latitude/longitude will be imprecise (you remember places, not exact coordinates). So put your real effort into "address_query" — the most specific geocodable string you can build from what you ACTUALLY see (a street name, a named business/shop you read off a sign, a landmark, a transit stop), qualified with city and country. A geocoder will convert that string into exact coordinates, so a precise NAME beats a precise-looking number. If you can read a street or business name, you can often nail it to within a block.

Return ONLY strict JSON (no markdown, no prose outside JSON):
{
  "verdict": "ONE punchy, confident sentence naming the place and the killer clue — in the voice of a cocky world-class GeoGuessr pro (e.g. \\"Yeah that's southern Brazil — the yellow centre lines and the .br plate sealed it.\\")",
  "country": "country name",
  "country_code": "ISO 3166-1 alpha-2, UPPERCASE (e.g. JP, BR, US)",
  "address_query": "the MOST specific geocodable string the evidence supports, ordered specific→general, e.g. 'Gare de Lyon, Paris, France' or 'Avenida Paulista 1500, São Paulo, Brazil' or 'Shibuya Crossing, Tokyo, Japan'. Build it from text/landmarks you actually read. Omit parts you cannot justify; if you only know the country, just give the country.",
  "candidates": ["up to 4 DISTINCT geocodable strings, ranked best-first — alternative specific guesses for where this is (e.g. a business name + city, a street + city, a landmark + city). These get geocoded and cross-checked, so favour specific, real, named places over vague areas."],
  "best_guess": {
    "place": "human-readable, as specific as the evidence allows",
    "latitude": number,
    "longitude": number,
    "precision": "exact-building" | "street" | "neighborhood" | "city" | "region" | "country" | "continent" | "unknown",
    "confidence": integer 0-100,
    "radius_m": integer (estimated error radius in metres)
  },
  "reasoning": "2-4 sentences walking through the deduction",
  "readable_text": ["each distinct piece of text you could actually read"],
  "meta_clues": [
    { "category": "Language" | "Road" | "Plates" | "Bollards" | "Poles" | "Architecture" | "Vegetation" | "Climate" | "Landmark" | "Other",
      "detail": "what you see AND what it tells you" }
  ],
  "alternatives": [ { "place": "...", "latitude": number, "longitude": number, "confidence": integer } ]
}
Be confident but honest: if clues are thin, lower the confidence and widen precision/radius. NEVER invent text you cannot actually read, and never fabricate coordinates you can't justify.`;

function webHintsBlock(web) {
  if (!web) return "";
  let s = "\n\nREVERSE-IMAGE-SEARCH HINTS (strong leads from running this exact photo through Google Vision — treat as evidence, but VERIFY against the actual pixels, they can be wrong):";
  if (web.bestGuess) s += `\n- Best-guess label: ${web.bestGuess}`;
  if (web.entities?.length) s += `\n- Web entities: ${web.entities.slice(0, 8).join(", ")}`;
  if (web.landmarks?.length) s += `\n- Landmark match: ${web.landmarks.map((l) => `${l.name} (${l.lat.toFixed(4)}, ${l.lng.toFixed(4)})`).join("; ")}`;
  return s;
}

async function callGemini(image, web) {
  const key = store.key.trim();
  if (!key) throw new Error("No API key. Open settings (⚙) and add your Gemini API key.");

  const body = {
    contents: [{ role: "user", parts: [{ text: GEO_PROMPT + webHintsBlock(web) }, { inlineData: image }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };
  if (store.grounding) body.tools = [{ google_search: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${store.model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    if (res.status === 400 && /API key/i.test(detail)) throw new Error("Invalid API key — check it in settings.");
    if (res.status === 404) throw new Error(`Model "${store.model}" unavailable for this key. Pick another in settings.`);
    if (res.status === 429) throw new Error("Rate limit reached. Wait a moment and retry.");
    throw new Error(detail || `Request failed (HTTP ${res.status}).`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
  if (!text) throw new Error("The model returned no answer. Try another image or model.");

  // Strip code fences / surrounding prose, then parse the JSON object.
  let cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s !== -1 && e !== -1) cleaned = cleaned.slice(s, e + 1);
  try { return JSON.parse(cleaned); }
  catch { throw new Error("Couldn't parse the model's response. Try again, or switch to gemini-2.5-pro."); }
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=en`, { headers: { "Accept": "application/json" } });
    const j = await r.json();
    return j?.display_name || null;
  } catch { return null; }
}

/* ---- accuracy booster: turn the model's named place into precise coords ---- */
function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function radiusToPrecision(m) {
  if (m < 250) return "exact-building";
  if (m < 1200) return "street";
  if (m < 4000) return "neighborhood";
  if (m < 25000) return "city";
  if (m < 150000) return "region";
  return "country";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- reverse image search via Google Vision (optional, needs a Vision key) ---- */
async function visionDetect(image) {
  const key = store.visionKey.trim();
  if (!key) return null;
  const body = { requests: [{ image: { content: image.data }, features: [
    { type: "LANDMARK_DETECTION", maxResults: 5 }, { type: "WEB_DETECTION", maxResults: 10 },
  ] }] };
  const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    let d = ""; try { d = (await r.json())?.error?.message || ""; } catch {}
    throw new Error("Vision API: " + (d || `HTTP ${r.status}`));
  }
  const resp = (await r.json())?.responses?.[0] || {};
  const landmarks = (resp.landmarkAnnotations || [])
    .map((l) => ({ name: l.description, score: l.score, lat: l.locations?.[0]?.latLng?.latitude, lng: l.locations?.[0]?.latLng?.longitude }))
    .filter((l) => isFinite(l.lat) && isFinite(l.lng));
  const wd = resp.webDetection || {};
  const entities = (wd.webEntities || []).filter((e) => e.description && (e.score || 0) > 0.3).map((e) => e.description);
  const bestGuess = wd.bestGuessLabels?.[0]?.label || "";
  return { landmarks, entities, bestGuess };
}

/* ---- geocode a list of candidate place strings → precise coords ---- */
async function geocodeCandidates(queries) {
  const seen = new Set(), out = [];
  for (const q0 of queries) {
    const q = (q0 || "").trim();
    if (q.length < 3) continue;
    const k = q.toLowerCase();
    if (seen.has(k)) continue; seen.add(k);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(q)}`, { headers: { "Accept": "application/json" } });
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) {
        const h = arr[0], lat = parseFloat(h.lat), lng = parseFloat(h.lon);
        if (isFinite(lat) && isFinite(lng)) {
          let radius = 8000; const bb = h.boundingbox?.map(Number);
          if (bb && bb.length === 4 && bb.every(isFinite)) radius = Math.max(60, Math.min(300000, haversine(bb[0], bb[2], bb[1], bb[3]) / 2));
          out.push({ query: q, display: h.display_name, lat, lng, radius_m: Math.round(radius), precision: radiusToPrecision(radius) });
        }
      }
    } catch { /* skip */ }
    if (out.length >= 5) break;
    await sleep(1100); // Nominatim asks for ≤1 req/sec
  }
  return out;
}

/* ---- pass 2: show the image + geocoded candidates and let the model pick ---- */
async function verifyCandidates(image, cands, g) {
  const key = store.key.trim();
  if (!key) return null;
  const list = cands.map((c, i) => `${i}. ${c.display} [${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}]`).join("\n");
  const prompt = `You are verifying the location of this photo. You earlier read: ${JSON.stringify(g.readable_text || [])} and noted: ${(g.meta_clues || []).map((m) => m.detail).join(" | ")}.
Here are geocoded candidate locations (number. resolved address [lat, lng]):
${list}

Look again at the IMAGE and choose the SINGLE candidate whose real-world location is most consistent with every visible clue. Return ONLY JSON: {"index": <candidate number, or -1 if none truly fit>, "confidence": 0-100, "place": "final human-readable place", "note": "one short sentence on why"}.`;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: image }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 600 } };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${store.model}:generateContent?key=${encodeURIComponent(key)}`;
  let r; try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch { return null; }
  if (!r.ok) return null;
  const t = (await r.json())?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") || "";
  let c = t.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  if (s !== -1 && e !== -1) c = c.slice(s, e + 1);
  try { return JSON.parse(c); } catch { return null; }
}

const HYPE_LINES = [
  "Scanning the horizon…", "Reverse image searching…", "Reading the road lines…",
  "Checking the bollards…", "Inspecting the license plates…", "Identifying the script…",
  "Reading every sign…", "Clocking the architecture…", "Cross-checking the map…",
  "Geocoding the candidates…", "Verifying the match…", "Triangulating the spot…",
  "Narrowing it down…", "Calling it…",
];
function startHype(el) {
  let i = 0; if (el) el.innerHTML = HYPE_LINES[0];
  const t = setInterval(() => { i = (i + 1) % HYPE_LINES.length; if (el) el.innerHTML = HYPE_LINES[i]; }, 1050);
  return () => clearInterval(t);
}

let analyzing = false;
els.analyzeBtn.addEventListener("click", async () => {
  if (!currentFile || analyzing) return;
  analyzing = true;
  els.analyzeBtn.disabled = true;
  setStatus("busy", "Analyzing");

  // 1) EXACT path — GPS embedded in the photo (the truth, if present).
  els.photoResults.innerHTML = `<div class="card"><span class="spinner"></span>Reading metadata…</div>`;
  const exif = await readExif(currentFile);
  let exactPoint = null, exactCard = "";
  if (exif && exif.lat != null && exif.lng != null) {
    const addr = await reverseGeocode(exif.lat, exif.lng);
    exactPoint = { lat: exif.lat, lng: exif.lng, color: "#5ef38c", radius_m: 12, precision: "exact-building",
      popup: `<b>📍 Exact — photo GPS</b><br>${esc(addr || "")}<br>${fmt(exif.lat)}, ${fmt(exif.lng)}` };
    exactCard = `
      <div class="card exact">
        <span class="card-tag tag-exact">● Exact · photo GPS metadata</span>
        <p class="place-name">${esc(addr || "Embedded GPS coordinates")}</p>
        <div class="coords"><a href="${mapsLink(exif.lat, exif.lng)}" target="_blank" rel="noopener">${fmt(exif.lat)}, ${fmt(exif.lng)} ↗</a></div>
        <dl class="meta-grid">
          ${exif.direction != null ? `<dt>Facing</dt><dd>${Math.round(exif.direction)}° ${compass(exif.direction)}</dd>` : ""}
          ${exif.altitude != null ? `<dt>Altitude</dt><dd>${Math.round(exif.altitude)} m</dd>` : ""}
          ${exif.taken ? `<dt>Taken</dt><dd>${esc(formatDate(exif.taken))}</dd>` : ""}
          ${exif.camera ? `<dt>Camera</dt><dd>${esc(exif.camera)}</dd>` : ""}
        </dl>
        <p class="note">The location the camera actually recorded — accurate to a few metres. Green pin on the map.</p>
      </div>`;
  }

  // 2) AI visual read — always run (it's the Rainbolt part; also a cross-check when GPS exists).
  els.photoResults.innerHTML = `<div class="card hype"><span class="spinner"></span><span id="hypeLine">Scanning the horizon…</span></div>` + exactCard;
  const stopHype = startHype($("hypeLine"));

  let guessCard = "", aiBest = null, alts = [];
  try {
    const image = await fileToAIImage(currentFile, store.hires ? 3072 : 1280);

    // Stage A — reverse image search (optional; only if a Vision key is set).
    let web = null;
    const meta = { steps: [] };
    if (store.visionKey.trim()) {
      try { web = await visionDetect(image); if (web) meta.web = web; }
      catch (err) { meta.webError = err.message; }
    }

    // Stage 1 — Gemini vision read → clues + candidate place names.
    const g = await callGemini(image, web);

    // Stage 2 — geocode every candidate string (model's + vision's) on the map.
    const queries = [];
    if (g.address_query) queries.push(g.address_query);
    (g.candidates || []).forEach((c) => queries.push(c));
    if (web?.bestGuess) queries.push(web.bestGuess);
    (web?.entities || []).slice(0, 3).forEach((e) => queries.push(e));
    if (g.best_guess?.place) queries.push(g.best_guess.place);
    const geo = await geocodeCandidates(queries);
    // Vision landmarks come with coordinates already — add them as top candidates.
    (web?.landmarks || []).forEach((l) => geo.unshift({ query: l.name, display: l.name + " (Vision landmark)", lat: l.lat, lng: l.lng, radius_m: 200, precision: "exact-building", vision: true }));

    // Keep only candidates near the model's coarse read (guards against bad geocodes).
    const mLat = g.best_guess?.latitude, mLng = g.best_guess?.longitude;
    const near = (isFinite(mLat) && isFinite(mLng)) ? geo.filter((c) => haversine(mLat, mLng, c.lat, c.lng) <= 800000) : geo;
    const pool = near.length ? near : geo;
    meta.candidateCount = pool.length;

    // Stage 3 — verify: let the model pick the best candidate against the image.
    let chosen = null;
    if (store.deep && pool.length >= 2) {
      const v = await verifyCandidates(image, pool, g).catch(() => null);
      if (v && v.index >= 0 && pool[v.index]) { chosen = pool[v.index]; meta.verifyNote = v.note || ""; if (v.place) chosen.label = v.place; if (isFinite(v.confidence)) meta.verifyConf = v.confidence; }
    }
    if (!chosen && pool.length) chosen = pool.slice().sort((a, b) => a.radius_m - b.radius_m)[0]; // most specific
    if (chosen) {
      g.best_guess = g.best_guess || {};
      g.best_guess.latitude = chosen.lat; g.best_guess.longitude = chosen.lng;
      g.best_guess.radius_m = chosen.radius_m; g.best_guess.precision = chosen.precision;
      g.geocode_match = chosen.label || chosen.display;
    }

    const bg = g.best_guess || {};
    if (isFinite(bg.latitude) && isFinite(bg.longitude)) {
      aiBest = { lat: bg.latitude, lng: bg.longitude, color: "#ffb648", radius_m: bg.radius_m || 0, precision: bg.precision,
        popup: `<b>${esc(g.country || "AI guess")} ${countryFlag(g.country_code)}</b><br>${esc(bg.place || "")}<br>${fmt(bg.latitude)}, ${fmt(bg.longitude)}` };
    }
    // Other geocoded candidates become blue cross-check pins.
    alts = pool.filter((c) => c !== chosen).slice(0, 4)
      .map((c) => ({ lat: c.lat, lng: c.lng, popup: `<b>Candidate:</b> ${esc(c.display)}` }));
    (g.alternatives || []).filter((a) => isFinite(a.latitude) && isFinite(a.longitude))
      .forEach((a) => alts.push({ lat: a.latitude, lng: a.longitude, popup: `<b>Alt:</b> ${esc(a.place || "")}` }));

    guessCard = renderGuess(g, meta);
  } catch (err) {
    guessCard = `<div class="card error-card">AI analysis failed: ${esc(err.message)}</div>`;
  }
  stopHype();

  els.photoResults.innerHTML = guessCard + exactCard;
  wireAltClicks(alts);

  // Reveal: fly to the exact spot if we have it, otherwise the AI's call.
  const primary = exactPoint || aiBest;
  if (primary) {
    const badge = exactPoint ? "📍 Exact GPS from metadata" : "🤖 AI best-guess — verify before trusting";
    const others = exactPoint && aiBest ? [aiBest, ...alts] : alts;
    revealLocation(primary, others, badge);
  }
  setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
  els.analyzeBtn.disabled = false;
  analyzing = false;
});

const META_ICON = { Language: "🔤", Road: "🛣️", Plates: "🚗", Bollards: "🚧", Poles: "⚡", Architecture: "🏛️", Vegetation: "🌿", Climate: "☀️", Landmark: "🗼", Other: "🔎" };
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n || 0)));
function countryFlag(cc) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
function metaClues(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return `<div class="section-title">🔍 Metas spotted</div><div class="metas">` +
    arr.map((c) => `<div class="meta-row"><span class="meta-ico">${META_ICON[c.category] || "🔎"}</span>
      <span class="meta-cat">${esc(c.category || "")}</span><span class="meta-det">${esc(c.detail || "")}</span></div>`).join("") + `</div>`;
}
function pipelineBlock(meta) {
  if (!meta) return "";
  const rows = [];
  if (meta.web) {
    const bits = [];
    if (meta.web.bestGuess) bits.push(`“${esc(meta.web.bestGuess)}”`);
    if (meta.web.landmarks?.length) bits.push(`${meta.web.landmarks.length} landmark match${meta.web.landmarks.length > 1 ? "es" : ""}`);
    rows.push(`<div class="pipe-row"><span>🔁 Reverse image search</span><span>${bits.join(" · ") || "no strong match"}</span></div>`);
  } else if (meta.webError) {
    rows.push(`<div class="pipe-row warn"><span>🔁 Reverse image search</span><span>${esc(meta.webError)}</span></div>`);
  }
  if (meta.candidateCount != null)
    rows.push(`<div class="pipe-row"><span>🗺️ Map cross-check</span><span>${meta.candidateCount} candidate${meta.candidateCount === 1 ? "" : "s"} geocoded</span></div>`);
  if (meta.verifyNote)
    rows.push(`<div class="pipe-row"><span>✅ AI verify${meta.verifyConf != null ? ` · ${clamp(meta.verifyConf)}%` : ""}</span><span>${esc(meta.verifyNote)}</span></div>`);
  return rows.length ? `<div class="section-title">🔬 How it was pinned</div><div class="pipeline">${rows.join("")}</div>` : "";
}
function renderGuess(g, meta) {
  const bg = g.best_guess || {};
  const conf = clamp(bg.confidence);
  const hasCoords = isFinite(bg.latitude) && isFinite(bg.longitude);
  const flag = countryFlag(g.country_code);
  return `
    <div class="card reveal">
      <div class="reveal-head">
        <div class="flag">${flag || "🌍"}</div>
        <div class="reveal-co">
          <div class="reveal-country">${esc(g.country || bg.place || "Unknown")}</div>
          <div class="reveal-sub">AI best-guess · ${esc((bg.precision || "unknown").toUpperCase())}</div>
        </div>
        <div class="reveal-conf"><div class="rc-num">${conf}<span>%</span></div><div class="rc-lbl">certainty</div></div>
      </div>
      ${g.verdict ? `<p class="verdict">“${esc(g.verdict)}”</p>` : ""}
      ${bg.place ? `<p class="place-name small">${esc(bg.place)}</p>` : ""}
      ${hasCoords ? `<div class="coords"><a href="${mapsLink(bg.latitude, bg.longitude)}" target="_blank" rel="noopener">${fmt(bg.latitude)}, ${fmt(bg.longitude)} ↗</a>${bg.radius_m ? ` · ±${fmtDist(bg.radius_m)}` : ""}</div>` : ""}
      ${g.geocode_match ? `<p class="refined">🎯 Snapped to <b>${esc(g.geocode_match)}</b> via geocoding</p>` : ""}
      <div class="conf-track big"><div class="conf-fill" style="width:${conf}%"></div></div>
      ${pipelineBlock(meta)}
      ${metaClues(g.meta_clues)}
      ${g.reasoning ? `<div class="section-title">🧠 The read</div><p class="reasoning">${esc(g.reasoning)}</p>` : ""}
      ${list("📝 Text spotted", g.readable_text, "text-chip")}
      ${alts(g.alternatives)}
    </div>`;
}
function list(title, arr, cls) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return `<div class="section-title">${title}</div><div class="chip-list">${arr.map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join("")}</div>`;
}
function alts(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return `<div class="section-title">Other candidates</div>${arr.map((a, i) =>
    `<div class="alt-item" data-alt="${i}"><span class="alt-name">${esc(a.place || "?")}</span><span class="alt-conf">${a.confidence != null ? a.confidence + "%" : ""} ↗</span></div>`).join("")}`;
}
function wireAltClicks(points) {
  // alt markers are the blue ones, in order, after best-guess
  document.querySelectorAll(".alt-item").forEach((el) => {
    el.addEventListener("click", () => {
      const alt = points.find((p) => p.color === "#57b6ff" && p.popup.includes(el.querySelector(".alt-name").textContent));
      if (alt) map.setView([alt.lat, alt.lng], 12);
    });
  });
}

/* ---------- small formatters ---------- */
function compass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + " km" : Math.round(m) + " m"; }
function formatDate(d) { try { return new Date(d).toLocaleString(); } catch { return String(d); } }

/* ================================================================== *
 *  IP / PLACE LOOKUP MODE
 * ================================================================== */
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

// Primary: ipapi.co (sharper, city-level). Fallback: geojs.io (coarser, very generous).
async function lookupIp(ip) {
  // --- try ipapi.co ---
  try {
    const r = await fetch(`https://ipapi.co/${ip ? encodeURIComponent(ip) + "/" : ""}json/`);
    const j = await r.json();
    if (!j.error && isFinite(j.latitude) && isFinite(j.longitude)) {
      return {
        place: [j.city, j.region, j.country_name].filter(Boolean).join(", "),
        lat: j.latitude, lng: j.longitude,
        meta: { IP: j.ip, ISP: j.org, ASN: j.asn, "Time zone": j.timezone, Postal: j.postal, Type: j.version },
      };
    }
  } catch { /* fall through */ }

  // --- fallback: geojs.io ---
  const r = await fetch(`https://get.geojs.io/v1/ip/geo${ip ? "/" + encodeURIComponent(ip) : ""}.json`);
  if (!r.ok) throw new Error("IP lookup failed (both providers).");
  const j = await r.json();
  const lat = parseFloat(j.latitude), lng = parseFloat(j.longitude);
  if (!isFinite(lat) || !isFinite(lng)) throw new Error(`Couldn't geolocate "${ip || "your IP"}".`);
  return {
    place: [j.city, j.region, j.country].filter(Boolean).join(", "),
    lat, lng,
    meta: { IP: j.ip, ISP: j.organization_name, ASN: j.asn ? "AS" + j.asn : null, "Time zone": j.timezone },
  };
}
async function lookupPlace(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { "Accept": "application/json" } });
  const arr = await r.json();
  if (!arr.length) throw new Error(`No place found for "${q}".`);
  const p = arr[0];
  return { place: p.display_name, lat: parseFloat(p.lat), lng: parseFloat(p.lon), meta: { Type: p.type, Category: p.category } };
}

async function runLookup(query, forceIp) {
  useSatellite(false);
  setStatus("busy", "Locating");
  els.lookupResults.innerHTML = `<div class="card"><span class="spinner"></span>Locating…</div>`;
  try {
    const q = (query || "").trim();
    const isIp = forceIp || IPV4.test(q) || (q.includes(":") && IPV6.test(q));
    const r = (forceIp || isIp) ? await lookupIp(q) : await lookupPlace(q);
    const color = isIp || forceIp ? "#57b6ff" : "#5ef38c";
    const metaRows = Object.entries(r.meta).filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    els.lookupResults.innerHTML = `
      <div class="card ${isIp || forceIp ? "" : "exact"}">
        <span class="card-tag ${isIp || forceIp ? "tag-guess" : "tag-exact"}">${isIp || forceIp ? "◎ IP geolocation (approximate)" : "● Place match"}</span>
        <p class="place-name">${esc(r.place)}</p>
        <div class="coords"><a href="${mapsLink(r.lat, r.lng)}" target="_blank" rel="noopener">${fmt(r.lat)}, ${fmt(r.lng)} ↗</a></div>
        ${metaRows ? `<dl class="meta-grid">${metaRows}</dl>` : ""}
        ${isIp || forceIp ? `<p class="note">IP geolocation points to the network/ISP region — typically city-level, not the device.</p>` : ""}
      </div>`;
    plot([{ lat: r.lat, lng: r.lng, color, radius_m: isIp || forceIp ? 12000 : 0, popup: `<b>${esc(r.place)}</b>` }],
         isIp || forceIp ? "🌐 IP region — approximate" : null);
    setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
  } catch (err) {
    els.lookupResults.innerHTML = `<div class="card error-card">${esc(err.message)}</div>`;
    setStatus("error", "Error");
  }
}
els.lookupForm.addEventListener("submit", (e) => { e.preventDefault(); if (els.lookupInput.value.trim()) runLookup(els.lookupInput.value); });
els.myIpBtn.addEventListener("click", () => runLookup("", true));

/* ================================================================== *
 *  SETTINGS
 * ================================================================== */
function openSettings() {
  els.apiKey.value = store.key; els.model.value = store.model;
  els.groundingToggle.checked = store.grounding; els.hiresToggle.checked = store.hires;
  els.deepToggle.checked = store.deep; els.visionKey.value = store.visionKey;
  els.settings.hidden = false; els.overlay.hidden = false;
}
function closeSettings() { els.settings.hidden = true; els.overlay.hidden = true; }
els.settingsBtn.addEventListener("click", openSettings);
els.closeSettings.addEventListener("click", closeSettings);
els.overlay.addEventListener("click", closeSettings);
els.saveSettings.addEventListener("click", () => {
  store.key = els.apiKey.value.trim(); store.model = els.model.value;
  store.grounding = els.groundingToggle.checked; store.hires = els.hiresToggle.checked;
  store.deep = els.deepToggle.checked; store.visionKey = els.visionKey.value.trim();
  closeSettings();
  setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
});

/* ---------- Boot ---------- */
initMap();
setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
