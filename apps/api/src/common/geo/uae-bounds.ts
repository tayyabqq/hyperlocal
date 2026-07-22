/**
 * First-pass geofence: rejects obviously-wrong coordinates (a client bug
 * sending 0,0; a spoofed location outside the launch market). Intentionally
 * generous — this is spam/bug filtering, not a legal border determination.
 */
const UAE_BOUNDS = { minLat: 22.0, maxLat: 26.5, minLng: 51.0, maxLng: 56.5 };

export function isWithinUae(latitude: number, longitude: number): boolean {
  return (
    latitude >= UAE_BOUNDS.minLat &&
    latitude <= UAE_BOUNDS.maxLat &&
    longitude >= UAE_BOUNDS.minLng &&
    longitude <= UAE_BOUNDS.maxLng
  );
}
