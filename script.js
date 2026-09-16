/* ============================================================
   Weather Now — Application Logic
   Data: Open-Meteo (forecast + geocoding), BigDataCloud (reverse)
   ============================================================ */

"use strict";

/* ---------- Config ---------- */
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

const POPULAR = ["London", "New York", "Tokyo", "Paris", "Dubai", "Sydney", "Mumbai", "Singapore"];

/* ---------- WMO weather code map ---------- */
const WMO = {
  0:  { label: "Clear sky",            icon: "☀️",  group: "clear" },
  1:  { label: "Mainly clear",         icon: "🌤️", group: "clear" },
  2:  { label: "Partly cloudy",        icon: "⛅",  group: "cloudy" },
  3:  { label: "Overcast",             icon: "☁️",  group: "cloudy" },
  45: { label: "Fog",                  icon: "🌫️", group: "cloudy" },
  48: { label: "Depositing rime fog",  icon: "🌫️", group: "cloudy" },
  51: { label: "Light drizzle",        icon: "🌦️", group: "rainy" },
  53: { label: "Moderate drizzle",     icon: "🌦️", group: "rainy" },
  55: { label: "Dense drizzle",        icon: "🌧️", group: "rainy" },
  56: { label: "Light freezing drizzle", icon: "🌧️", group: "rainy" },
  57: { label: "Dense freezing drizzle", icon: "🌧️", group: "rainy" },
  61: { label: "Slight rain",          icon: "🌦️", group: "rainy" },
  63: { label: "Moderate rain",        icon: "🌧️", group: "rainy" },
  65: { label: "Heavy rain",           icon: "🌧️", group: "rainy" },
  66: { label: "Light freezing rain",  icon: "🌧️", group: "rainy" },
  67: { label: "Heavy freezing rain",  icon: "🌧️", group: "rainy" },
  71: { label: "Slight snow",          icon: "🌨️", group: "snow" },
  73: { label: "Moderate snow",        icon: "🌨️", group: "snow" },
  75: { label: "Heavy snow",           icon: "❄️",  group: "snow" },
  77: { label: "Snow grains",          icon: "🌨️", group: "snow" },
  80: { label: "Slight rain showers",  icon: "🌦️", group: "rainy" },
  81: { label: "Moderate rain showers", icon: "🌧️", group: "rainy" },
  82: { label: "Violent rain showers", icon: "⛈️",  group: "rainy" },
  85: { label: "Slight snow showers",  icon: "🌨️", group: "snow" },
  86: { label: "Heavy snow showers",   icon: "❄️",  group: "snow" },
  95: { label: "Thunderstorm",         icon: "⛈️",  group: "thunder" },
  96: { label: "Thunderstorm w/ hail", icon: "⛈️",  group: "thunder" },
  99: { label: "Thunderstorm w/ heavy hail", icon: "⛈️", group: "thunder" }
};

function wmo(code) {
  return WMO[code] || { label: "Unknown", icon: "🌡️", group: "cloudy" };
}

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");
const locBtn = $("locBtn");
const suggestions = $("suggestions");
const chips = $("chips");
const result = $("result");
const toast = $("toast");
const themeToggle = $("themeToggle");
const themeKnob = $("themeKnob");

/* ---------- Helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayName(iso, i) {
  if (i === 0) return "Today";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString([], { weekday: "short" });
}

function dayDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

let toastTimer;
function showToast(msg, isErr) {
  toast.textContent = msg;
  toast.classList.toggle("err", !!isErr);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const dark = theme === "dark";
  themeToggle.setAttribute("aria-checked", String(dark));
  themeKnob.textContent = dark ? "🌙" : "☀️";
  try { localStorage.setItem("weather-theme", theme); } catch (e) {}
}

themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  applyTheme(cur === "dark" ? "light" : "dark");
});

/* ---------- States ---------- */
function showLoading() {
  result.innerHTML = `
    <div class="state">
      <div class="spinner"></div>
      <h2>Fetching weather…</h2>
      <p>Getting the latest conditions for you.</p>
    </div>`;
}

function showError(title, msg) {
  result.innerHTML = `
    <div class="state">
      <div class="big">🌧️</div>
      <h2>${esc(title)}</h2>
      <p>${esc(msg)}</p>
    </div>`;
}

function showWelcome() {
  result.innerHTML = `
    <div class="state">
      <div class="big">🌍</div>
      <h2>Search for a city</h2>
      <p>Type a location above or tap “My Location” to see real-time temperature, humidity, conditions and rain probability.</p>
    </div>`;
}

/* ---------- Render current + forecast ---------- */
function renderWeather(place, data) {
  const cur = data.current;
  const info = wmo(cur.weather_code);
  const isNight = cur.is_day === 0;
  const group = isNight && info.group === "clear" ? "night" : info.group;

  // Rain probability: current hour from hourly array
  const nowIdx = data.hourly.time.findIndex((t) => t.slice(0, 13) === cur.time.slice(0, 13));
  const rainNow = nowIdx >= 0 ? data.hourly.precipitation_probability[nowIdx] : 0;

  // Hourly strip (next 12 hours from now)
  const start = nowIdx >= 0 ? nowIdx : 0;
  const hours = [];
  for (let i = start; i < Math.min(start + 12, data.hourly.time.length); i++) {
    hours.push({
      time: data.hourly.time[i],
      temp: data.hourly.temperature_2m[i],
      code: data.hourly.weather_code[i],
      rain: data.hourly.precipitation_probability[i]
    });
  }

  // Daily forecast
  const days = data.daily.time.map((t, i) => ({
    time: t,
    code: data.daily.weather_code[i],
    max: data.daily.temperature_2m_max[i],
    min: data.daily.temperature_2m_min[i],
    rain: data.daily.precipitation_probability_max[i]
  }));

  const placeName = place.name || "Unknown";
  const region = [place.admin1, place.country].filter(Boolean).join(", ");

  result.innerHTML = `
    <article class="current ${group}">
      <div class="c-head">
        <div class="place">
          ${esc(placeName)}
          <small>📍 ${esc(region || "—")}</small>
        </div>
        <div class="local-time">
          🕒 ${esc(fmtTime(cur.time))}<br>
          <span style="opacity:.8">${esc(data.timezone_abbreviation || "")}</span>
        </div>
      </div>

      <div class="c-main">
        <div class="c-icon" aria-hidden="true">${info.icon}</div>
        <div>
          <div class="temp">${Math.round(cur.temperature_2m)}<sup>°C</sup></div>
          <div class="cond">${esc(info.label)}</div>
          <div class="feels">Feels like ${Math.round(cur.apparent_temperature)}°C</div>
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <div class="m-label">💧 Humidity</div>
          <div class="m-value">${cur.relative_humidity_2m}%</div>
          <div class="m-sub">Relative</div>
        </div>
        <div class="metric">
          <div class="m-label">🌬️ Wind</div>
          <div class="m-value">${Math.round(cur.wind_speed_10m)}</div>
          <div class="m-sub">km/h</div>
        </div>
        <div class="metric">
          <div class="m-label">🌡️ Feels like</div>
          <div class="m-value">${Math.round(cur.apparent_temperature)}°</div>
          <div class="m-sub">Apparent</div>
        </div>
        <div class="metric">
          <div class="m-label">🌧️ Rain now</div>
          <div class="m-value">${rainNow}%</div>
          <div class="m-sub">Probability</div>
        </div>
      </div>

      <div class="rain-bar">
        <div class="rb-top">
          <span>🌧️ Chance of rain (this hour)</span>
          <span class="pct">${rainNow}%</span>
        </div>
        <div class="rain-track"><div class="rain-fill" id="rainFill"></div></div>
      </div>
    </article>

    <h3 class="section-title"><span class="dot"></span> Next 12 hours</h3>
    <div class="hourly">
      ${hours.map((h) => {
        const hi = wmo(h.code);
        return `
          <div class="hour-card">
            <div class="h-time">${esc(fmtTime(h.time))}</div>
            <div class="h-icon" aria-hidden="true">${hi.icon}</div>
            <div class="h-temp">${Math.round(h.temp)}°</div>
            <div class="h-rain">💧 ${h.rain}%</div>
          </div>`;
      }).join("")}
    </div>

    <h3 class="section-title"><span class="dot"></span> 5-day forecast</h3>
    <div class="forecast">
      ${days.map((d, i) => {
        const di = wmo(d.code);
        return `
          <div class="day-card">
            <div class="d-name">${esc(dayName(d.time, i))}</div>
            <div class="d-date">${esc(dayDate(d.time))}</div>
            <div class="d-icon" aria-hidden="true">${di.icon}</div>
            <div class="d-temp">${Math.round(d.max)}° <span>/ ${Math.round(d.min)}°</span></div>
            <div class="d-rain">💧 ${d.rain}%</div>
          </div>`;
      }).join("")}
    </div>
  `;

  // Animate rain bar
  requestAnimationFrame(() => {
    const fill = $("rainFill");
    if (fill) fill.style.width = Math.max(2, rainNow) + "%";
  });
}

/* ---------- Fetch weather ---------- */
async function fetchWeather(place) {
  showLoading();
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,is_day",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "5"
  });

  try {
    const res = await fetch(`${FORECAST_URL}?${params}`);
    if (!res.ok) throw new Error("Weather service unavailable");
    const data = await res.json();
    renderWeather(place, data);
  } catch (err) {
    showError("Couldn't load weather", "Please check your connection and try again.");
    showToast("Failed to fetch weather data", true);
  }
}

/* ---------- Geocoding search ---------- */
async function geocode(query) {
  const res = await fetch(`${GEO_URL}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`);
  if (!res.ok) throw new Error("Geocoding failed");
  const data = await res.json();
  return data.results || [];
}

async function doSearch(query) {
  const q = (query || "").trim();
  if (!q) { showToast("Please enter a city name", true); return; }
  hideSuggestions();
  showLoading();
  try {
    const list = await geocode(q);
    if (!list.length) {
      showError("Location not found", `No results for “${q}”. Try another spelling or a nearby city.`);
      return;
    }
    await fetchWeather(list[0]);
    searchInput.value = list[0].name;
  } catch (err) {
    showError("Search failed", "We couldn't reach the location service. Please try again.");
  }
}

/* ---------- Suggestions ---------- */
let sugTimer;
let activeIdx = -1;

function hideSuggestions() {
  suggestions.classList.remove("open");
  suggestions.innerHTML = "";
  activeIdx = -1;
}

function showSuggestions(list) {
  if (!list.length) { hideSuggestions(); return; }
  suggestions.innerHTML = list.map((c, i) => {
    const region = [c.admin1, c.country].filter(Boolean).join(", ");
    return `
      <li role="option" data-index="${i}" data-name="${esc(c.name)}">
        <span class="pin" aria-hidden="true">📍</span>
        <span class="s-name">${esc(c.name)}</span>
        <span class="s-region">${esc(region)}</span>
      </li>`;
  }).join("");
  suggestions.classList.add("open");
  activeIdx = -1;
}

async function updateSuggestions() {
  const q = searchInput.value.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  try {
    const list = await geocode(q);
    showSuggestions(list);
  } catch (e) { hideSuggestions(); }
}

searchInput.addEventListener("input", () => {
  clearTimeout(sugTimer);
  sugTimer = setTimeout(updateSuggestions, 260);
});

suggestions.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  const name = li.getAttribute("data-name");
  searchInput.value = name;
  doSearch(name);
});

searchInput.addEventListener("keydown", (e) => {
  const items = [...suggestions.querySelectorAll("li")];
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    activeIdx = (activeIdx + 1) % items.length;
    items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
    items[activeIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    activeIdx = (activeIdx - 1 + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
    items[activeIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIdx >= 0 && items[activeIdx]) {
      const name = items[activeIdx].getAttribute("data-name");
      searchInput.value = name;
      doSearch(name);
    } else {
      doSearch(searchInput.value);
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) hideSuggestions();
});

/* ---------- Current location ---------- */
async function useMyLocation() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by this browser", true);
    return;
  }
  showLoading();
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      let place = { name: "My Location", latitude, longitude, admin1: "", country: "" };
      try {
        const res = await fetch(`${REVERSE_URL}?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
        if (res.ok) {
          const g = await res.json();
          place.name = g.city || g.locality || g.principalSubdivision || "My Location";
          place.admin1 = g.principalSubdivision || "";
          place.country = g.countryName || "";
        }
      } catch (e) { /* keep fallback name */ }
      searchInput.value = place.name;
      await fetchWeather(place);
    },
    (err) => {
      let msg = "Unable to get your location.";
      if (err.code === 1) msg = "Location permission denied. Please allow access or search manually.";
      else if (err.code === 2) msg = "Location unavailable. Please try again.";
      else if (err.code === 3) msg = "Location request timed out.";
      showError("Location error", msg);
      showToast(msg, true);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* ---------- Chips ---------- */
function buildChips() {
  chips.innerHTML = POPULAR.map(
    (c) => `<button class="chip" type="button" data-city="${esc(c)}">${esc(c)}</button>`
  ).join("");
}
chips.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const city = btn.getAttribute("data-city");
  searchInput.value = city;
  doSearch(city);
});

/* ---------- Events ---------- */
searchBtn.addEventListener("click", () => doSearch(searchInput.value));
locBtn.addEventListener("click", useMyLocation);

/* ---------- Init ---------- */
(function init() {
  let saved = "light";
  try { saved = localStorage.getItem("weather-theme") || "light"; } catch (e) {}
  applyTheme(saved);

  buildChips();
  showWelcome();

  // Auto-load a default city for a lively first impression
  doSearch("London");
})();
