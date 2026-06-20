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
};

const $ = (id) => document.getElementById(id);
const els = {
  statusChip: $("statusChip"), statusText: $("statusText"),
  settingsBtn: $("settingsBtn"), closeSettings: $("closeSettings"),
  overlay: $("overlay"), settings: $("settings"), saveSettings: $("saveSettings"),
  apiKey: $("apiKey"), model: $("model"), groundingToggle: $("groundingToggle"), hiresToggle: $("hiresToggle"),
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
let map, markerLayer;
function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20, subdomains: "abcd",
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 200);
}

function colorIcon(color) {
  return L.divIcon({
    className: "", iconSize: [22, 22], iconAnchor: [11, 11],
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};
           border:3px solid #05080c;box-shadow:0 0 0 2px ${color},0 0 12px ${color};"></div>`,
  });
}

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

const GEO_PROMPT = `You are an elite geolocation analyst — a world-champion GeoGuessr player combined with an OSINT investigator. Determine, as PRECISELY as possible, where this photograph was taken.

Work methodically:
1. TRANSCRIBE every piece of readable text: shop/business names, street & road signs, license plates, phone numbers, posters, brand logos. Read even partially-visible text. Text is the single highest-value clue.
2. Identify the script/language and region-specific spellings or area codes.
3. Note driving side, road markings, bollards, traffic-signal style, utility poles, license-plate format & colours.
4. Note architecture, building materials, roofing, signage style, urban vs rural layout.
5. Note vegetation, terrain, geology, climate cues, sun position & shadow direction.
6. Identify any recognizable landmark, mountain silhouette, coastline, or skyline.
7. Triangulate to the most specific location the evidence supports.

Return ONLY strict JSON (no markdown, no prose outside JSON):
{
  "best_guess": {
    "place": "human-readable, as specific as the evidence allows",
    "latitude": number,
    "longitude": number,
    "precision": "exact-building" | "street" | "neighborhood" | "city" | "region" | "country" | "continent" | "unknown",
    "confidence": integer 0-100,
    "radius_m": integer (estimated error radius in metres)
  },
  "reasoning": "2-4 sentences on how you reached it",
  "readable_text": ["each distinct piece of text you could actually read"],
  "clues": ["the specific visual clues you used"],
  "alternatives": [ { "place": "...", "latitude": number, "longitude": number, "confidence": integer } ]
}
Be honest: if there are few geographic clues, give low confidence and coarse precision. NEVER invent text you cannot actually read, and never fabricate coordinates you can't justify.`;

async function callGemini(image) {
  const key = store.key.trim();
  if (!key) throw new Error("No API key. Open settings (⚙) and add your Gemini API key.");

  const body = {
    contents: [{ role: "user", parts: [{ text: GEO_PROMPT }, { inlineData: image }] }],
    generationConfig: { temperature: 0.25, maxOutputTokens: 2048 },
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
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`, { headers: { "Accept": "application/json" } });
    const j = await r.json();
    return j?.display_name || null;
  } catch { return null; }
}

let analyzing = false;
els.analyzeBtn.addEventListener("click", async () => {
  if (!currentFile || analyzing) return;
  analyzing = true;
  els.analyzeBtn.disabled = true;
  setStatus("busy", "Analyzing");
  els.photoResults.innerHTML = `<div class="card"><span class="spinner"></span>Reading metadata…</div>`;

  const points = [];
  let html = "";

  // 1) EXACT path — GPS embedded in the photo.
  const exif = await readExif(currentFile);
  if (exif && exif.lat != null && exif.lng != null) {
    const addr = await reverseGeocode(exif.lat, exif.lng);
    points.push({ lat: exif.lat, lng: exif.lng, color: "#5ef38c", radius_m: 12,
      popup: `<b>Exact — photo GPS</b><br>${esc(addr || "")}<br>${fmt(exif.lat)}, ${fmt(exif.lng)}` });
    html += `
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
        <p class="note">This is the location the camera actually recorded — accurate to a few metres.</p>
      </div>`;
  } else {
    html += `<div class="card"><p class="note">No GPS metadata in this photo (common for screenshots & social-media images). Falling back to AI visual analysis…</p></div>`;
  }

  // 2) AI visual best-guess (always run — useful even when GPS exists, as a cross-check).
  els.photoResults.innerHTML = html + `<div class="card"><span class="spinner"></span>AI is reading the scene${store.grounding ? " &amp; verifying landmarks online" : ""}… (pro can take ~15–30s)</div>`;
  try {
    const image = await fileToAIImage(currentFile, store.hires ? 2048 : 1024);
    const g = await callGemini(image);
    const bg = g.best_guess || {};
    if (isFinite(bg.latitude) && isFinite(bg.longitude)) {
      points.push({ lat: bg.latitude, lng: bg.longitude, color: "#ffb648", radius_m: bg.radius_m || 0,
        popup: `<b>AI guess</b><br>${esc(bg.place || "")}<br>${fmt(bg.latitude)}, ${fmt(bg.longitude)}` });
    }
    (g.alternatives || []).forEach((a) => {
      if (isFinite(a.latitude) && isFinite(a.longitude))
        points.push({ lat: a.latitude, lng: a.longitude, color: "#57b6ff", popup: `<b>Alt:</b> ${esc(a.place || "")}` });
    });
    html += renderGuess(g);
  } catch (err) {
    html += `<div class="card error-card">AI analysis failed: ${esc(err.message)}</div>`;
  }

  els.photoResults.innerHTML = html;
  wireAltClicks(points);
  const badge = points.length ? (points[0].color === "#5ef38c" ? "📍 Exact GPS from metadata" : "🤖 AI best-guess — verify before trusting") : null;
  plot(points, badge);
  setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
  els.analyzeBtn.disabled = false;
  analyzing = false;
});

function renderGuess(g) {
  const bg = g.best_guess || {};
  const conf = Math.max(0, Math.min(100, Math.round(bg.confidence ?? 0)));
  const hasCoords = isFinite(bg.latitude) && isFinite(bg.longitude);
  return `
    <div class="card guess">
      <span class="card-tag tag-guess">◎ AI best-guess · visual analysis</span>
      <p class="place-name">${esc(bg.place || "Undetermined")}</p>
      ${hasCoords ? `<div class="coords"><a href="${mapsLink(bg.latitude, bg.longitude)}" target="_blank" rel="noopener">${fmt(bg.latitude)}, ${fmt(bg.longitude)} ↗</a></div>` : ""}
      <div class="conf">
        <div class="conf-row"><span>Confidence</span><span>${conf}% · ${esc(bg.precision || "unknown")}${bg.radius_m ? " · ±" + fmtDist(bg.radius_m) : ""}</span></div>
        <div class="conf-track"><div class="conf-fill" style="width:${conf}%"></div></div>
      </div>
      ${g.reasoning ? `<p class="reasoning">${esc(g.reasoning)}</p>` : ""}
      ${list("Readable text", g.readable_text, "text-chip")}
      ${list("Clues used", g.clues, "")}
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
  els.settings.hidden = false; els.overlay.hidden = false;
}
function closeSettings() { els.settings.hidden = true; els.overlay.hidden = true; }
els.settingsBtn.addEventListener("click", openSettings);
els.closeSettings.addEventListener("click", closeSettings);
els.overlay.addEventListener("click", closeSettings);
els.saveSettings.addEventListener("click", () => {
  store.key = els.apiKey.value.trim(); store.model = els.model.value;
  store.grounding = els.groundingToggle.checked; store.hires = els.hiresToggle.checked;
  closeSettings();
  setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
});

/* ---------- Boot ---------- */
initMap();
setStatus(store.key ? "online" : "", store.key ? "Ready" : "No key");
