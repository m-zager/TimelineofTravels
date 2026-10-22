"use client";

import { useEffect, useState } from "react";
import { getPhotos, listTrips, type Trip } from "@/lib/db";
import TravelGlobe from "@/components/TravelGlobe";
import TripList from "@/components/TripList";

export type TripWithCover = Trip & { coverUrl: string | null };

// Loads saved trips (with their first photo as a cover) for the globe and the list.
export default function HomeTrips() {
  const [trips, setTrips] = useState<TripWithCover[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const coverUrls: string[] = [];

    (async () => {
      const saved = await listTrips();
      const withCovers = await Promise.all(
        saved.map(async (trip) => {
          const [cover] = await getPhotos(trip.id);
          const coverUrl = cover ? URL.createObjectURL(cover.blob) : null;
          if (coverUrl) coverUrls.push(coverUrl);
          return { ...trip, coverUrl };
        }),
      );
      if (cancelled) {
        coverUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      // After saving a trip we land here with ?focus=<id>; consume it so a reload doesn't refocus.
      const focus = new URLSearchParams(window.location.search).get("focus");
      if (focus) window.history.replaceState(null, "", window.location.pathname);
      setFocusId(withCovers.some((trip) => trip.id === focus) ? focus : null);
      setTrips(withCovers);
    })();

    return () => {
      cancelled = true;
      coverUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return (
    <>
      <TravelGlobe trips={trips ?? []} focusId={focusId} />
      <p className="hint">Drag to spin the globe. Click a spot to add a trip, or a photo pin to open one.</p>
      <TripList trips={trips} />
    </>
  );
}
