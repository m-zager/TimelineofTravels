import { getTrip, getPhotos, saveTrip, deleteTrip } from "./db.js";

const FIELDS = ["name", "place"];
const EARLIEST_YEAR = 1950;

const form = document.getElementById("trip-form");
const title = document.getElementById("page-title");
const coords = document.getElementById("coords");
const photoInput = document.getElementById("photo-input");
const dropzone = document.getElementById("dropzone");
const grid = document.getElementById("photo-grid");
const errorBox = document.getElementById("form-error");
const saveBtn = document.getElementById("save-btn");
const deleteBtn = document.getElementById("delete-btn");
const viewer = document.getElementById("viewer");

let trip = null;
// Saved photos carry storedId; photos added on this page carry file until the trip is saved.
let photos = [];
const removedIds = new Set();

function formatCoords({ lat, lon }) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

function populateMonthYear() {
  const { month, year } = form.elements;
  for (let i = 1; i <= 12; i++) {
    const label = new Date(2000, i - 1, 1).toLocaleDateString(undefined, { month: "long" });
    month.append(new Option(label, String(i).padStart(2, "0")));
  }
  for (let y = new Date().getFullYear(); y >= EARLIEST_YEAR; y--) {
    year.append(new Option(y, y));
  }
}

async function init() {
  populateMonthYear();
  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (id) {
    trip = await getTrip(id);
    if (!trip) return location.replace("index.html");
    title.textContent = trip.name;
    document.title = `${trip.name} · Timeline of Travels`;
    FIELDS.forEach((field) => (form.elements[field].value = trip[field] ?? ""));
    if (trip.month) {
      [form.elements.year.value, form.elements.month.value] = trip.month.split("-");
    }
    deleteBtn.hidden = false;
    photos = (await getPhotos(id)).map((photo) => ({
      name: photo.name,
      url: URL.createObjectURL(photo.blob),
      storedId: photo.id,
    }));
  } else {
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (!params.has("lat") || !params.has("lon") || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return location.replace("index.html");
    }
    trip = { id: crypto.randomUUID(), lat, lon, createdAt: new Date().toISOString() };
  }

  coords.textContent = formatCoords(trip);
  renderPhotos();
}

function renderPhotos() {
  grid.replaceChildren(
    ...photos.map((photo) => {
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = "";
      img.loading = "lazy";

      const view = document.createElement("button");
      view.type = "button";
      view.className = "photo-view";
      view.setAttribute("aria-label", `View ${photo.name}`);
      view.append(img);
      view.addEventListener("click", () => openViewer(photo));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${photo.name}`);
      remove.addEventListener("click", () => removePhoto(photo));

      const item = document.createElement("li");
      item.className = "photo";
      item.append(view, remove);
      return item;
    }),
  );
}

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    photos.push({ name: file.name, url: URL.createObjectURL(file), file });
  }
  renderPhotos();
}

function removePhoto(photo) {
  photos = photos.filter((p) => p !== photo);
  if (photo.storedId) removedIds.add(photo.storedId);
  URL.revokeObjectURL(photo.url);
  renderPhotos();
}

function openViewer(photo) {
  const img = viewer.querySelector("img");
  img.src = photo.url;
  img.alt = photo.name;
  viewer.showModal();
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

photoInput.addEventListener("change", () => {
  addFiles(photoInput.files);
  photoInput.value = "";
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragging");
  addFiles(e.dataTransfer.files);
});

// Clicking the dimmed backdrop (outside the image) closes the viewer.
viewer.addEventListener("click", (e) => {
  if (e.target === viewer) viewer.close();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.hidden = true;

  const data = new FormData(form);
  const updated = { ...trip, updatedAt: new Date().toISOString() };
  FIELDS.forEach((field) => (updated[field] = String(data.get(field) ?? "").trim()));
  updated.month = `${data.get("year")}-${data.get("month")}`;

  if (!updated.name) return showError("Give your trip a name.");

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    await saveTrip(updated, {
      add: photos.filter((p) => p.file).map((p) => p.file),
      remove: [...removedIds],
    });
    location.href = `index.html?focus=${encodeURIComponent(updated.id)}`;
  } catch (err) {
    showError(`Couldn't save this trip: ${err.message}`);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save trip";
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete "${trip.name}" and all its photos? This can't be undone.`)) return;
  await deleteTrip(trip.id);
  location.href = "index.html";
});

init();
