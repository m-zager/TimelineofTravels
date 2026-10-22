import type { Metadata } from "next";
import { Suspense } from "react";
import TripEditor from "@/components/TripEditor";

export const metadata: Metadata = { title: "Trip · Timeline of Travels" };

export default function TripPage({ params }: PageProps<"/trips/[id]">) {
  // Keyed by id so switching trips never shows the previous trip's preserved state.
  return <Suspense>{params.then(({ id }) => <TripEditor key={id} tripId={id} />)}</Suspense>;
}
