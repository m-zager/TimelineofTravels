"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GlobeInstance } from "globe.gl";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { formatCoords, formatMonth } from "@/lib/format";
import type { TripWithCover } from "@/components/HomeTrips";
import { createDottedLand, type DottedLand } from "@/components/dottedLand";

const DEFAULT_VIEW = { lat: 25, lng: -30, altitude: 2.3 };
const FOCUS_ALTITUDE = 1.4;
const MIN_ALTITUDE = 0.7;
const MAX_ALTITUDE = 3.5;
const SPIN_SPEED = 0.5;
const RESUME_SPIN_MS = 500;
const LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json";

type Spot = { lat: number; lon: number };
type Marker = Spot & { el: HTMLElement };

// Markers are plain DOM elements because globe.gl positions them itself. It sets an inline
// transform on the outer .marker, so hover effects go on the .pin inside.
function tripMarker(trip: TripWithCover, isNew: boolean, onOpen: (href: string) => void, onHover: () => void) {
  const href = `/trips/${encodeURIComponent(trip.id)}`;
  const description = [trip.name, formatMonth(trip.month)].filter(Boolean);

  const pin = document.createElement("a");
  pin.className = "pin";
  pin.href = href;
  pin.setAttribute("aria-label", description.join(", "));
  if (isNew) pin.classList.add("pin--new");

  if (trip.coverUrl) {
    const img = document.createElement("img");
    img.src = trip.coverUrl;
    img.alt = "";
    pin.append(img);
  } else {
    pin.classList.add("pin--no-photo");
  }

  const label = document.createElement("span");
  label.className = "pin-label";
  label.textContent = description.join(" · ");
  pin.append(label);

  pin.addEventListener("pointerenter", onHover);
  pin.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(href);
  });

  const marker = document.createElement("div");
  marker.className = "marker";
  marker.append(pin);
  return marker;
}

function pendingMarker() {
  const marker = document.createElement("div");
  marker.className = "marker";
  marker.innerHTML = '<span class="pin-pending" aria-hidden="true"></span>';
  return marker;
}

export default function TravelGlobe({ trips, focusId }: { trips: TripWithCover[]; focusId: string | null }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const spinRef = useRef({ pause: () => {}, resume: (delay?: number) => void delay });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Spot | null>(null);

  // Create the globe once. globe.gl touches `window` on import, so it's loaded here.
  useEffect(() => {
    const container = containerRef.current!;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let land: DottedLand | undefined;
    // The globe spins unless the pointer is over it, so whatever is under the pointer holds still.
    let hovering = false;
    const onPointerEnter = () => {
      hovering = true;
      spinRef.current.pause();
    };
    const onPointerLeave = () => {
      hovering = false;
      spinRef.current.resume();
      land?.release();
    };
    // The dotted land doesn't take pointer events (it would block clicks and drags on the
    // globe), so pointer moves over the globe are passed to it here.
    const onPointerMove = (e: PointerEvent) => land?.pointer(e.clientX, e.clientY);

    import("globe.gl").then(({ default: Globe }) => {
      if (disposed) return;
      const styles = getComputedStyle(document.documentElement);
      const cssVar = (name: string) => styles.getPropertyValue(name).trim();

      const globe = new Globe(container, { animateIn: !reduceMotion })
        .backgroundColor("rgba(0, 0, 0, 0)")
        .showAtmosphere(false)
        .showGraticules(false)
        .htmlLat("lat")
        .htmlLng("lon")
        .htmlAltitude(0.01)
        .htmlElement((marker) => (marker as Marker).el)
        .onGlobeClick(({ lat, lng }, event) => {
          land?.shockwave(event.clientX, event.clientY);
          setPending({ lat, lon: lng });
        })
        .pointOfView(DEFAULT_VIEW);

      // No ocean: only the land dots show. The sphere stays, fully transparent, because it's
      // what clicks between the continents land on.
      const material = globe.globeMaterial() as unknown as { transparent: boolean; opacity: number; depthWrite: boolean };
      material.transparent = true;
      material.opacity = 0;
      material.depthWrite = false;

      // Zooming is on the buttons only, so scrolling the page never gets caught by the globe.
      const controls = globe.controls();
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.autoRotateSpeed = SPIN_SPEED;
      controls.autoRotate = !reduceMotion;

      spinRef.current = {
        pause() {
          clearTimeout(resumeTimer);
          controls.autoRotate = false;
        },
        // Spins again after `delay`, unless the pointer is over the globe by then.
        resume(delay = RESUME_SPIN_MS) {
          clearTimeout(resumeTimer);
          if (reduceMotion) return;
          resumeTimer = setTimeout(() => {
            if (!hovering) controls.autoRotate = true;
          }, delay);
        },
      };

      container.addEventListener("pointerenter", onPointerEnter);
      container.addEventListener("pointerleave", onPointerLeave);
      container.addEventListener("pointermove", onPointerMove);
      resizeObserver = new ResizeObserver(() => {
        globe.width(container.clientWidth).height(container.clientHeight);
      });
      resizeObserver.observe(container);

      fetch(LAND_URL)
        .then((res) => res.json())
        .then((topo: Topology<{ land: GeometryCollection }>) => {
          if (disposed) return;
          land = createDottedLand(globe, feature(topo, topo.objects.land), {
            color: cssVar("--land"),
            outline: cssVar("--charcoal"),
            still: reduceMotion,
          });
        });

      globeRef.current = globe;
      setReady(true);
    });

    return () => {
      disposed = true;
      clearTimeout(resumeTimer);
      resizeObserver?.disconnect();
      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointermove", onPointerMove);
      land?.destroy();
      globeRef.current?._destructor();
      globeRef.current = null;
      container.replaceChildren();
    };
  }, []);

  // Keep markers in sync with trips and the spot picked for a new trip.
  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe) return;
    const markers: Marker[] = trips.map((trip) => ({
      lat: trip.lat,
      lon: trip.lon,
      el: tripMarker(
        trip,
        trip.id === focusId,
        (href) => router.push(href),
        () => spinRef.current.pause(),
      ),
    }));
    if (pending) markers.push({ ...pending, el: pendingMarker() });
    globe.htmlElementsData(markers);
  }, [ready, trips, focusId, pending, router]);

  // A picked spot is transient: clear it when Next hides this page on navigation, so coming
  // back doesn't show a stale marker and "Add trip here" bar.
  useLayoutEffect(() => () => setPending(null), []);

  // Escape cancels a picked spot. (The globe keeps spinning with a spot picked; its marker
  // turns with it.)
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPending(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending]);

  // After saving a trip: bring the globe into view and fly to its pin.
  useEffect(() => {
    const globe = globeRef.current;
    const focused = trips.find((trip) => trip.id === focusId);
    if (!ready || !globe || !focused) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("globe-section")?.scrollIntoView({ block: "center" });
    spinRef.current.pause();
    globe.pointOfView({ lat: focused.lat, lng: focused.lon, altitude: FOCUS_ALTITUDE }, reduceMotion ? 0 : 1500);
    spinRef.current.resume(5000);
  }, [ready, trips, focusId]);

  function zoom(factor: number) {
    const globe = globeRef.current;
    if (!globe) return;
    const { altitude } = globe.pointOfView();
    const next = Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, altitude * factor));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    globe.pointOfView({ altitude: next }, reduceMotion ? 0 : 400);
  }

  return (
    <section className="globe-card" aria-label="Globe of your trips">
      <div ref={containerRef} className="globe" />

      <div className="globe-zoom">
        <button type="button" className="globe-zoom-btn" aria-label="Zoom in" onClick={() => zoom(0.7)}>
          +
        </button>
        <button type="button" className="globe-zoom-btn" aria-label="Zoom out" onClick={() => zoom(1 / 0.7)}>
          −
        </button>
      </div>

      {pending && (
        <div className="new-trip-bar">
          <span className="new-trip-text">
            New trip at <strong>{formatCoords(pending)}</strong>
          </span>
          <Link
            className="btn btn-primary"
            href={`/trips/new?lat=${pending.lat.toFixed(4)}&lon=${pending.lon.toFixed(4)}`}
          >
            Add trip here
          </Link>
          <button type="button" className="btn" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
