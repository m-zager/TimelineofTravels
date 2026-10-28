import Link from "next/link";
import type { TripWithCover } from "@/components/HomeTrips";

const UNDATED = "Undated";

// Trips grouped by year, newest year first; trips saved without a month go last.
function byYear(trips: TripWithCover[]) {
  const groups = new Map<string, TripWithCover[]>();
  for (const trip of trips) {
    const year = trip.month ? trip.month.slice(0, 4) : UNDATED;
    groups.set(year, [...(groups.get(year) ?? []), trip]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === UNDATED ? 1 : b === UNDATED ? -1 : b.localeCompare(a)))
    .map(([year, items]) => [year, items.sort((a, b) => b.month.localeCompare(a.month))] as const);
}

// "2025-06" -> "June"
function monthName(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "long" });
}

// trips is null until they've loaded, so the empty message doesn't flash first.
export default function Timeline({ trips }: { trips: TripWithCover[] | null }) {
  if (!trips) return null;
  if (trips.length === 0) {
    return <p className="muted timeline-empty">No trips yet. Switch to the globe and click a spot to add your first one.</p>;
  }

  return (
    <div className="timeline">
      {byYear(trips).map(([year, items]) => (
        <section key={year} className="timeline-year" aria-labelledby={`year-${year}`}>
          <h2 id={`year-${year}`} className="timeline-year-label">
            {year}
          </h2>
          <ol className="timeline-list">
            {items.map((trip) => (
              <li key={trip.id} className="timeline-item">
                <Link href={`/trips/${encodeURIComponent(trip.id)}`} className="timeline-card">
                  <span className="timeline-cover">
                    {trip.coverUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- local blob URL
                      <img src={trip.coverUrl} alt="" />
                    )}
                  </span>
                  <span className="timeline-text">
                    {trip.month && <span className="timeline-month">{monthName(trip.month)}</span>}
                    <span className="timeline-name">{trip.name}</span>
                    <span className="timeline-meta">
                      {[trip.place, `${trip.photoCount} ${trip.photoCount === 1 ? "photo" : "photos"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
