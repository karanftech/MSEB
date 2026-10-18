/**
 * OpenStreetMap & Coordinates Geocoding Utility
 * Replaces legacy Google Maps geocoding with zero external Google dependencies.
 */

export const loadGoogleMapsScript = async (): Promise<void> => {
  // No-op: Google Maps completely removed in favor of Leaflet & OpenStreetMap
  return Promise.resolve();
};

export const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
  return `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
};
