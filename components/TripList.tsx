import Link from "next/link";
import { formatMonth } from "@/lib/format";
import type { Trip } from "@/lib/db";

// trips is null until they've loaded, so the empty message doesn't flash first.
export default function TripList({ trips }: { trips: Trip[] | null }) {
  return (
    <section className="trips" aria-labelledby="trips-heading">
      <h2 id="trips-heading">Your trips</h2>
      <ul className="trip-list">
        {trips?.map((trip) => (
          <li key={trip.id}>
            <Link href={`/trips/${encodeURIComponent(trip.id)}`}>
              <span className="trip-name">{trip.name}</span>
              <span className="trip-meta">
                {[trip.place, formatMonth(trip.month)].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {trips?.length === 0 && (
        <p className="muted">No trips yet. Click a spot on the globe to add your first one.</p>
      )}
    </section>
  );
}
