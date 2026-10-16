import { listTrips } from "./db.js";

const SPIN_DEG_PER_SEC = 8;
const DEFAULT_TILT = -18;
const PIN_RADIUS = 6;
const PIN_HIT_RADIUS = 12;
const CLICK_SLOP_PX = 5;
const FOCUS_PAUSE_MS = 3000;
const PULSE_MS = 4000;

const canvas = document.getElementById("globe");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");

const styles = getComputedStyle(document.documentElement);
const cssVar = (name) => styles.getPropertyValue(name).trim();
const colors = {
  ocean: cssVar("--ocean"),
  land: cssVar("--land"),
  graticule: cssVar("--graticule"),
  pin: cssVar("--pin"),
  pinStroke: cssVar("--pin-stroke"),
};

const projection = d3.geoOrthographic().clipAngle(90);
const path = d3.geoPath(projection, ctx);
const graticule = d3.geoGraticule10();
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let size = 0;
let land = null;
let trips = [];
let rotation = [0, DEFAULT_TILT];
let pointerOver = false;
let drag = null;
let focus = null;
let spinPausedUntil = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  size = canvas.clientWidth;
  canvas.width = canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  projection.translate([size / 2, size / 2]).scale(size / 2 - 1);
}

function isVisible(trip) {
  return d3.geoDistance([trip.lon, trip.lat], [-rotation[0], -rotation[1]]) < Math.PI / 2;
}

function draw(now) {
  projection.rotate(rotation);
  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.fillStyle = colors.ocean;
  ctx.fill();

  ctx.beginPath();
  path(graticule);
  ctx.strokeStyle = colors.graticule;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  if (land) {
    ctx.beginPath();
    path(land);
    ctx.fillStyle = colors.land;
    ctx.fill();
  }

  for (const trip of trips) {
    if (!isVisible(trip)) continue;
    const [x, y] = projection([trip.lon, trip.lat]);

    if (!reduceMotion && focus?.id === trip.id && now - focus.start < PULSE_MS) {
      const t = ((now - focus.start) % 1000) / 1000;
      ctx.beginPath();
      ctx.arc(x, y, PIN_RADIUS + t * 16, 0, 2 * Math.PI);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = colors.pin;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(x, y, PIN_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = colors.pin;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.pinStroke;
    ctx.stroke();
  }
}

// Returns [lon, lat] under the given canvas point, or null if it's off the globe.
function pointOnGlobe(x, y) {
  if (Math.hypot(x - size / 2, y - size / 2) > projection.scale()) return null;
  return projection.invert([x, y]);
}

function pinAt(x, y) {
  let nearest = null;
  let nearestDist = PIN_HIT_RADIUS;
  for (const trip of trips) {
    if (!isVisible(trip)) continue;
    const [px, py] = projection([trip.lon, trip.lat]);
    const dist = Math.hypot(px - x, py - y);
    if (dist <= nearestDist) {
      nearest = trip;
      nearestDist = dist;
    }
  }
  return nearest;
}

function updateHover(x, y) {
  const trip = pinAt(x, y);
  canvas.style.cursor = trip || pointOnGlobe(x, y) ? "pointer" : "default";
  if (!trip) return hideTooltip();
  tooltip.textContent = trip.place ? `${trip.name} · ${trip.place}` : trip.name;
  const [px, py] = projection([trip.lon, trip.lat]);
  tooltip.style.left = `${px}px`;
  tooltip.style.top = `${py}px`;
  tooltip.hidden = false;
}

function hideTooltip() {
  tooltip.hidden = true;
}

canvas.addEventListener("pointerenter", () => {
  pointerOver = true;
});

canvas.addEventListener("pointerleave", () => {
  pointerOver = false;
  hideTooltip();
});

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.offsetX, y: e.offsetY, rotation: [...rotation], moved: false };
});

canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) drag.moved = true;
    if (drag.moved) {
      const degPerPx = 90 / projection.scale();
      rotation = [
        drag.rotation[0] + dx * degPerPx,
        Math.max(-90, Math.min(90, drag.rotation[1] - dy * degPerPx)),
      ];
      canvas.style.cursor = "grabbing";
      hideTooltip();
      return;
    }
  }
  updateHover(e.offsetX, e.offsetY);
});

canvas.addEventListener("pointerup", (e) => {
  const wasClick = drag && !drag.moved;
  drag = null;
  if (!wasClick) return updateHover(e.offsetX, e.offsetY);

  const trip = pinAt(e.offsetX, e.offsetY);
  if (trip) {
    location.href = `trip.html?id=${encodeURIComponent(trip.id)}`;
    return;
  }
  const point = pointOnGlobe(e.offsetX, e.offsetY);
  if (point) {
    const [lon, lat] = point;
    location.href = `trip.html?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  }
});

canvas.addEventListener("pointercancel", () => {
  drag = null;
});

function formatMonth(month) {
  if (!month) return "";
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function renderTripList() {
  document.getElementById("trips-empty").hidden = trips.length > 0;
  document.getElementById("trip-list").replaceChildren(
    ...trips.map((trip) => {
      const name = document.createElement("span");
      name.className = "trip-name";
      name.textContent = trip.name;

      const meta = document.createElement("span");
      meta.className = "trip-meta";
      meta.textContent = [trip.place, formatMonth(trip.month)].filter(Boolean).join(" · ");

      const link = document.createElement("a");
      link.href = `trip.html?id=${encodeURIComponent(trip.id)}`;
      link.append(name, meta);

      const item = document.createElement("li");
      item.append(link);
      return item;
    }),
  );
}

new ResizeObserver(resize).observe(canvas);

fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json")
  .then((res) => res.json())
  .then((topo) => {
    land = topojson.feature(topo, topo.objects.land);
  });

listTrips().then((saved) => {
  trips = saved;
  renderTripList();

  // After saving a trip we land here with ?focus=<id>: turn the globe to the new pin.
  const focusId = new URLSearchParams(location.search).get("focus");
  const focused = trips.find((trip) => trip.id === focusId);
  if (focused) {
    rotation = [-focused.lon, -focused.lat];
    focus = { id: focused.id, start: performance.now() };
    spinPausedUntil = focus.start + FOCUS_PAUSE_MS;
    history.replaceState(null, "", location.pathname);
  }
});

let lastFrame = performance.now();
d3.timer(() => {
  const now = performance.now();
  const spinning = !reduceMotion && !pointerOver && !drag && now > spinPausedUntil;
  if (spinning) rotation[0] += ((now - lastFrame) / 1000) * SPIN_DEG_PER_SEC;
  lastFrame = now;
  draw(now);
});
