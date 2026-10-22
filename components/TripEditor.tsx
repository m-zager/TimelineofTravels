"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { deleteTrip, getPhotos, getTrip, saveTrip, type Trip } from "@/lib/db";
import { formatCoords } from "@/lib/format";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const EARLIEST_YEAR = 1950;

// Saved photos carry storedId; photos added on this page carry file until the trip is saved.
type EditorPhoto = { key: string; name: string; url: string; storedId?: string; file?: File };

type Props = { tripId: string } | { lat: number; lon: number };

export default function TripEditor(props: Props) {
  const router = useRouter();
  const existingId = "tripId" in props ? props.tripId : null;
  const newSpot = "tripId" in props ? null : { lat: props.lat, lon: props.lon };

  const [trip, setTrip] = useState<Trip | null>(null);
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [photos, setPhotos] = useState<EditorPhoto[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<EditorPhoto | null>(null);
  const viewerRef = useRef<HTMLDialogElement>(null);

  const location = trip ?? newSpot;
  const years = Array.from({ length: new Date().getFullYear() - EARLIEST_YEAR + 1 }, (_, i) =>
    String(new Date().getFullYear() - i),
  );

  // Load the trip being edited, or start a new one at the picked spot.
  useEffect(() => {
    if (!existingId) {
      if (!newSpot || !Number.isFinite(newSpot.lat) || !Number.isFinite(newSpot.lon)) router.replace("/");
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const saved = await getTrip(existingId);
      if (cancelled) return;
      if (!saved) {
        router.replace("/");
        return;
      }
      const stored = await getPhotos(existingId);
      if (cancelled) return;
      setTrip(saved);
      setName(saved.name);
      setPlace(saved.place);
      if (saved.month) {
        const [y, m] = saved.month.split("-");
        setYear(y);
        setMonth(m);
      }
      setPhotos(
        stored.map((photo) => {
          const url = URL.createObjectURL(photo.blob);
          urls.push(url);
          return { key: photo.id, name: photo.name, url, storedId: photo.id };
        }),
      );
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
    // newSpot is derived from props; existingId captures whether we're editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingId, router]);

  useEffect(() => {
    document.title = `${trip?.name || "New trip"} · Timeline of Travels`;
  }, [trip]);

  useEffect(() => {
    if (viewing) viewerRef.current?.showModal();
  }, [viewing]);

  function addFiles(files: FileList | null) {
    const added = [...(files ?? [])]
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({ key: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), file }));
    setPhotos((current) => [...current, ...added]);
  }

  function removePhoto(photo: EditorPhoto) {
    setPhotos((current) => current.filter((p) => p !== photo));
    if (photo.storedId) setRemovedIds((ids) => [...ids, photo.storedId!]);
    URL.revokeObjectURL(photo.url);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!location) return;
    if (!name.trim()) return setError("Give your trip a name.");

    const now = new Date().toISOString();
    const updated: Trip = {
      id: trip?.id ?? crypto.randomUUID(),
      createdAt: trip?.createdAt ?? now,
      updatedAt: now,
      lat: location.lat,
      lon: location.lon,
      name: name.trim(),
      place: place.trim(),
      month: `${year}-${month}`,
    };

    setSaving(true);
    try {
      await saveTrip(updated, {
        add: photos.flatMap((p) => (p.file ? [p.file] : [])),
        remove: removedIds,
      });
      // Next keeps this page mounted (hidden) after navigating away, so clear the form now
      // or going back would show a stale draft stuck on "Saving…". Edits reload on return.
      setSaving(false);
      setRemovedIds([]);
      if (!trip) {
        setName("");
        setPlace("");
        setMonth("");
        setYear("");
        setPhotos([]);
      }
      router.push(`/?focus=${encodeURIComponent(updated.id)}`);
    } catch (err) {
      setError(`Couldn't save this trip: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!trip || !confirm(`Delete "${trip.name}" and all its photos? This can't be undone.`)) return;
    await deleteTrip(trip.id);
    router.push("/");
  }

  return (
    <main className="trip-page">
      <Link className="back-link" href="/">
        ← Back to globe
      </Link>
      <h1>{trip?.name || "New trip"}</h1>
      <p className="coords muted">{location ? formatCoords(location) : ""}</p>

      <form className="trip-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Trip name</span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Summer in Lisbon"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Place</span>
          <input
            name="place"
            maxLength={120}
            placeholder="Lisbon, Portugal"
            autoComplete="off"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Month</span>
            <select name="month" required value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Select month</option>
              {MONTHS.map((label, i) => (
                <option key={label} value={String(i + 1).padStart(2, "0")}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Year</span>
            <select name="year" required value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Select year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="photos">
          <legend>Photos</legend>
          <label
            className={`dropzone${dragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span>
              Drop photos here or <u>choose files</u>
            </span>
          </label>
          <ul className="photo-grid">
            {photos.map((photo) => (
              <li key={photo.key} className="photo">
                <button
                  type="button"
                  className="photo-view"
                  aria-label={`View ${photo.name}`}
                  onClick={() => setViewing(photo)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
                  <img src={photo.url} alt="" loading="lazy" />
                </button>
                <button
                  type="button"
                  className="photo-remove"
                  aria-label={`Remove ${photo.name}`}
                  onClick={() => removePhoto(photo)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save trip"}
          </button>
          <Link href="/" className="btn">
            Cancel
          </Link>
          {trip && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              Delete trip
            </button>
          )}
        </div>
      </form>

      <p className="storage-note muted small">Trips and photos are saved in this browser only.</p>

      <dialog
        ref={viewerRef}
        className="viewer"
        onClose={() => setViewing(null)}
        // Clicking the dimmed backdrop (outside the image) closes the viewer.
        onClick={(e) => e.target === e.currentTarget && viewerRef.current?.close()}
      >
        {viewing && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={viewing.url} alt={viewing.name} />
            <form method="dialog">
              <button className="btn">Close</button>
            </form>
          </>
        )}
      </dialog>
    </main>
  );
}
