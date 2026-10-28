"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getPhotos, listTrips, type Trip } from "@/lib/db";
import Timeline from "@/components/Timeline";
import TravelGlobe from "@/components/TravelGlobe";
import TripList from "@/components/TripList";

export type TripWithCover = Trip & { coverUrl: string | null; photoCount: number };

type View = "globe" | "timeline";
const VIEWS: { id: View; label: string }[] = [
  { id: "globe", label: "Globe" },
  { id: "timeline", label: "Timeline" },
];

// Loads saved trips (with their first photo as a cover) and shows them as a globe or a timeline.
export default function HomeTrips() {
  const [trips, setTrips] = useState<TripWithCover[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState<View>("globe");
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({ globe: null, timeline: null });

  useEffect(() => {
    let cancelled = false;
    const coverUrls: string[] = [];

    (async () => {
      const saved = await listTrips();
      const withCovers = await Promise.all(
        saved.map(async (trip) => {
          const photos = await getPhotos(trip.id);
          const coverUrl = photos[0] ? URL.createObjectURL(photos[0].blob) : null;
          if (coverUrl) coverUrls.push(coverUrl);
          return { ...trip, coverUrl, photoCount: photos.length };
        }),
      );
      if (cancelled) {
        coverUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      // After saving a trip we land here with ?focus=<id>; consume it so a reload doesn't refocus.
      // The globe flies to the new pin, so switch to it even if the timeline was showing (Next
      // keeps this page's state while you're away on the trip page).
      const focus = new URLSearchParams(window.location.search).get("focus");
      if (focus) window.history.replaceState(null, "", window.location.pathname);
      const focused = withCovers.some((trip) => trip.id === focus) ? focus : null;
      if (focused) setView("globe");
      setFocusId(focused);
      setTrips(withCovers);
    })();

    return () => {
      cancelled = true;
      coverUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Tabs pattern: arrow keys move between the two views.
  function onTabKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = view === "globe" ? "timeline" : "globe";
    setView(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <section id="globe-section" className="travels" aria-label="Your travels">
        <div className="view-toggle" role="tablist" aria-label="View">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              className="view-toggle-btn"
              aria-selected={view === id}
              aria-controls={`panel-${id}`}
              tabIndex={view === id ? 0 : -1}
              onClick={() => setView(id)}
              onKeyDown={onTabKeyDown}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "globe" ? (
          <div className="travels-panel" role="tabpanel" id="panel-globe" aria-labelledby="tab-globe">
            <TravelGlobe trips={trips ?? []} focusId={focusId} />
            <p className="hint">Drag to spin the globe. Click a spot to add a trip, or a photo pin to open one.</p>
          </div>
        ) : (
          <div className="travels-panel" role="tabpanel" id="panel-timeline" aria-labelledby="tab-timeline">
            <Timeline trips={trips} />
          </div>
        )}
      </section>

      {view === "globe" && <TripList trips={trips} />}
    </>
  );
}
