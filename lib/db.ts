// Trips and photos live in this browser's IndexedDB.

export type Trip = {
  id: string;
  name: string;
  place: string;
  lat: number;
  lon: number;
  /** "YYYY-MM" */
  month: string;
  createdAt: string;
  updatedAt?: string;
};

export type Photo = {
  id: string;
  tripId: string;
  name: string;
  type: string;
  blob: Blob;
  addedAt: string;
};

// Trips saved before the month field existed had start/end dates and notes.
type StoredTrip = Partial<Trip> & Pick<Trip, "id"> & {
  startDate?: string;
  endDate?: string;
  notes?: string;
};

const DB_NAME = "timeline-of-travels";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | undefined;

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

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function normalize(stored: StoredTrip): Trip {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { startDate, endDate, notes, ...rest } = stored;
  return {
    name: "",
    place: "",
    lat: 0,
    lon: 0,
    createdAt: "",
    ...rest,
    month: stored.month ?? startDate?.slice(0, 7) ?? "",
  };
}

export async function listTrips(): Promise<Trip[]> {
  const db = await openDb();
  const stored = await request<StoredTrip[]>(db.transaction("trips").objectStore("trips").getAll());
  const sortKey = (trip: Trip) => trip.month || trip.createdAt;
  return stored.map(normalize).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  const db = await openDb();
  const stored = await request<StoredTrip | undefined>(
    db.transaction("trips").objectStore("trips").get(id),
  );
  return stored && normalize(stored);
}

export async function getPhotos(tripId: string): Promise<Photo[]> {
  const db = await openDb();
  const photos = await request<Photo[]>(
    db.transaction("photos").objectStore("photos").index("tripId").getAll(tripId),
  );
  return photos.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

// Saves the trip, adds the given files as photos, and deletes photos by id,
// all in one transaction so a failure leaves nothing half-saved.
export async function saveTrip(
  trip: Trip,
  { add = [], remove = [] }: { add?: File[]; remove?: string[] } = {},
) {
  const db = await openDb();
  const tx = db.transaction(["trips", "photos"], "readwrite");
  tx.objectStore("trips").put(trip);
  const photos = tx.objectStore("photos");
  add.forEach((file, i) => {
    const photo: Photo = {
      id: crypto.randomUUID(),
      tripId: trip.id,
      name: file.name,
      type: file.type,
      blob: file,
      // Offset by index so photos added together keep their order.
      addedAt: new Date(Date.now() + i).toISOString(),
    };
    photos.put(photo);
  });
  remove.forEach((id) => photos.delete(id));
  await complete(tx);
}

export async function deleteTrip(id: string) {
  const db = await openDb();
  const tx = db.transaction(["trips", "photos"], "readwrite");
  tx.objectStore("trips").delete(id);
  const photos = tx.objectStore("photos");
  const photoIds = await request(photos.index("tripId").getAllKeys(id));
  photoIds.forEach((photoId) => photos.delete(photoId));
  await complete(tx);
}
