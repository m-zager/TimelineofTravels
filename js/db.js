// Trips and photos live in this browser's IndexedDB.
// trips:  { id, name, place, lat, lon, month: "YYYY-MM", createdAt, updatedAt }
// photos: { id, tripId, name, type, blob, addedAt }

const DB_NAME = "timeline-of-travels";
const DB_VERSION = 1;

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("trips", { keyPath: "id" });
      db.createObjectStore("photos", { keyPath: "id" }).createIndex("tripId", "tripId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// Trips saved before the month field existed had start/end dates and notes.
function normalize(trip) {
  if (!trip) return trip;
  const { startDate, endDate, notes, ...rest } = trip;
  return { ...rest, month: trip.month ?? startDate?.slice(0, 7) ?? "" };
}

export async function listTrips() {
  const db = await openDb();
  const trips = await request(db.transaction("trips").objectStore("trips").getAll());
  const sortKey = (trip) => trip.month || trip.createdAt;
  return trips.map(normalize).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

export async function getTrip(id) {
  const db = await openDb();
  return normalize(await request(db.transaction("trips").objectStore("trips").get(id)));
}

export async function getPhotos(tripId) {
  const db = await openDb();
  const photos = await request(
    db.transaction("photos").objectStore("photos").index("tripId").getAll(tripId),
  );
  return photos.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

// Saves the trip, adds the given File objects as photos, and deletes photos by id,
// all in one transaction so a failure leaves nothing half-saved.
export async function saveTrip(trip, { add = [], remove = [] } = {}) {
  const db = await openDb();
  const tx = db.transaction(["trips", "photos"], "readwrite");
  tx.objectStore("trips").put(trip);
  const photos = tx.objectStore("photos");
  add.forEach((file, i) => {
    photos.put({
      id: crypto.randomUUID(),
      tripId: trip.id,
      name: file.name,
      type: file.type,
      blob: file,
      // Offset by index so photos added together keep their order.
      addedAt: new Date(Date.now() + i).toISOString(),
    });
  });
  remove.forEach((id) => photos.delete(id));
  await complete(tx);
}

export async function deleteTrip(id) {
  const db = await openDb();
  const tx = db.transaction(["trips", "photos"], "readwrite");
  tx.objectStore("trips").delete(id);
  const photos = tx.objectStore("photos");
  const photoIds = await request(photos.index("tripId").getAllKeys(id));
  photoIds.forEach((photoId) => photos.delete(photoId));
  await complete(tx);
}
