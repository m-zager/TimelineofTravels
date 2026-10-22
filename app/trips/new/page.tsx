import type { Metadata } from "next";
import { Suspense } from "react";
import TripEditor from "@/components/TripEditor";

export const metadata: Metadata = { title: "New trip · Timeline of Travels" };

// /trips/new?lat=..&lon=.. — the spot picked on the globe. Keyed by the spot so each new
// spot gets a fresh form (Next preserves page state across navigations).
export default function NewTripPage({ searchParams }: PageProps<"/trips/new">) {
  return (
    <Suspense>
      {searchParams.then(({ lat, lon }) => (
        <TripEditor key={`${lat},${lon}`} lat={Number(lat)} lon={Number(lon)} />
      ))}
    </Suspense>
  );
}
