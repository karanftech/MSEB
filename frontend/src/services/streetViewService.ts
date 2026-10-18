/**
 * Street View Service (Deprecated)
 * Google Maps Street View removed in favor of OpenStreetMap & Leaflet.
 */

export interface StreetViewCheckResult {
  available: boolean;
  panoId?: string;
  lat?: number;
  lng?: number;
  message?: string;
}

export const checkStreetViewAvailability = async (
  _lat: number,
  _lng: number,
  _radiusMeters: number = 50
): Promise<StreetViewCheckResult> => {
  return { available: false, message: 'Street View service has been removed.' };
};
