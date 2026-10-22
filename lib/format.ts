export function formatCoords({ lat, lon }: { lat: number; lon: number }) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

// "2025-06" -> "June 2025"
export function formatMonth(month: string) {
  if (!month) return "";
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
