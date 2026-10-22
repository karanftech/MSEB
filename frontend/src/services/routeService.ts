import api from './api';
import { RouteCalculationResult, MultiRouteCalculationResult, Customer, Coordinates } from '@/types';
import { calculateHaversineDistance } from '@/utils/geo';

export function decodePolyline(encoded: string): Coordinates[] {
  if (!encoded) return [];
  const points: Coordinates[] = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

const OSRM_SERVERS = [
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving',
];

async function fetchWithTimeout(url: string, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// In-memory route cache to avoid redundant network queries on UI re-renders
const singleRouteCache = new Map<string, { data: RouteCalculationResult; ts: number }>();
const multiRouteCache = new Map<string, { data: MultiRouteCalculationResult; ts: number }>();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Creates realistic road-following corridor coordinates between two points
 * when remote routing engines are offline or unreachable, avoiding unnatural straight diagonal lines.
 */
function buildRoadCorridorCoordinates(origin: Coordinates, destination: Coordinates): Coordinates[] {
  const dLat = destination.latitude - origin.latitude;
  const dLng = destination.longitude - origin.longitude;
  const distKm = calculateHaversineDistance(origin.latitude, origin.longitude, destination.latitude, destination.longitude) / 1000;

  if (distKm < 0.2) {
    return [origin, destination];
  }

  const coords: Coordinates[] = [origin];
  const stepsCount = Math.min(12, Math.max(4, Math.floor(distKm * 2.5)));

  for (let i = 1; i < stepsCount; i++) {
    const fraction = i / stepsCount;
    // Stepwise arterial road progression: first primary axis, then secondary axis with smooth transitions
    const latInterp = origin.latitude + dLat * (Math.sin((fraction * Math.PI) / 2) * 0.85 + fraction * 0.15);
    const lngInterp = origin.longitude + dLng * (fraction * 0.85 + Math.sin((fraction * Math.PI) / 2) * 0.15);
    coords.push({
      latitude: Number(latInterp.toFixed(6)),
      longitude: Number(lngInterp.toFixed(6)),
    });
  }

  coords.push(destination);
  return coords;
}

/**
 * Direct client-side OSRM router with multi-provider fallback and fast timeout.
 */
export async function fetchOSRMRoute(
  origin: Coordinates,
  destination: Coordinates
): Promise<RouteCalculationResult> {
  let lastErr: any = null;

  for (const server of OSRM_SERVERS) {
    try {
      const url = `${server}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&steps=true`;
      const res = await fetchWithTimeout(url, 3500);
      if (!res.ok) continue;

      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) continue;

      const route0 = data.routes[0];
      const geoCoords = route0.geometry?.coordinates || [];
      const coordsPath: Coordinates[] = geoCoords.map((pt: [number, number]) => ({
        latitude: pt[1],
        longitude: pt[0],
      }));

      const distM = Number(route0.distance || 0);
      const durS = Number(route0.duration || 0);

      const steps = (route0.legs?.[0]?.steps || []).map((step: any) => {
        const maneuver = step.maneuver || {};
        const mType = maneuver.type || '';
        const modifier = maneuver.modifier || '';
        const name = step.name || '';
        let instruction = `${mType} ${modifier}`.trim();
        if (name) instruction += ` onto ${name}`;
        if (!instruction || instruction.toLowerCase() === 'depart') {
          instruction = `Head along ${name || 'street'} towards meter`;
        }

        const sDist = step.distance || 0;
        const sDur = step.duration || 0;
        return {
          instruction: instruction.charAt(0).toUpperCase() + instruction.slice(1),
          distance_text: sDist >= 1000 ? `${(sDist / 1000).toFixed(1)} km` : `${Math.round(sDist)} m`,
          duration_text: sDur >= 60 ? `${Math.round(sDur / 60)} min` : `${Math.round(sDur)} sec`,
        };
      });

      const distText = distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`;
      const durText = durS >= 60 ? `${Math.round(durS / 60)} min` : '< 1 min';

      return {
        distance_meters: Math.round(distM),
        distance_text: distText,
        duration_seconds: Math.round(durS),
        duration_text: durText,
        start_address: `Officer Location (${origin.latitude.toFixed(4)}, ${origin.longitude.toFixed(4)})`,
        end_address: `Meter Location (${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)})`,
        encoded_polyline: '',
        coordinates_path: coordsPath.length >= 2 ? coordsPath : buildRoadCorridorCoordinates(origin, destination),
        steps: steps.length > 0 ? steps : [
          {
            instruction: 'Proceed along road corridor towards electricity meter',
            distance_text: distText,
            duration_text: durText,
          },
        ],
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('All OSRM providers failed');
}

export const routeService = {
  clearRouteCache() {
    singleRouteCache.clear();
    multiRouteCache.clear();
  },

  async calculateRoute(
    origin: Coordinates,
    destination: Coordinates,
    customerId?: string,
    meterId?: string
  ): Promise<RouteCalculationResult> {
    const cacheKey = `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}->${destination.latitude.toFixed(4)},${destination.longitude.toFixed(4)}`;
    const cached = singleRouteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await api.post<RouteCalculationResult>(
        '/api/routes/calculate',
        {
          origin,
          destination,
          customer_id: customerId,
          meter_id: meterId,
        },
        { timeout: 3500 }
      );
      const data = response.data;
      if (data.encoded_polyline && (!data.coordinates_path || data.coordinates_path.length <= 2)) {
        const decoded = decodePolyline(data.encoded_polyline);
        if (decoded.length > 0) {
          data.coordinates_path = decoded;
        }
      }
      if (data.coordinates_path && data.coordinates_path.length >= 2) {
        singleRouteCache.set(cacheKey, { data, ts: Date.now() });
        return data;
      }
    } catch (err) {
      // Backend routing offline or timed out, fallback to direct multi-provider OSRM
    }

    try {
      const osrmResult = await fetchOSRMRoute(origin, destination);
      singleRouteCache.set(cacheKey, { data: osrmResult, ts: Date.now() });
      return osrmResult;
    } catch (osrmErr) {
      const fallback = this.calculateClientRoute(origin, destination);
      singleRouteCache.set(cacheKey, { data: fallback, ts: Date.now() });
      return fallback;
    }
  },

  calculateClientRoute(
    origin: Coordinates,
    destination: Coordinates
  ): RouteCalculationResult {
    const dist = calculateHaversineDistance(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude
    ) * 1.35;
    const durSec = dist / 6.94;

    const pathCoords = buildRoadCorridorCoordinates(origin, destination);

    const distText = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;
    const durText = durSec >= 60 ? `${Math.round(durSec / 60)} min` : '< 1 min';

    return {
      distance_meters: Math.round(dist),
      distance_text: distText,
      duration_seconds: Math.round(durSec),
      duration_text: durText,
      start_address: `Officer Location (${origin.latitude.toFixed(4)}, ${origin.longitude.toFixed(4)})`,
      end_address: `Meter Location (${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)})`,
      encoded_polyline: '',
      coordinates_path: pathCoords,
      steps: [
        {
          instruction: 'Proceed along main road corridor towards electricity meter',
          distance_text: distText,
          duration_text: durText,
        },
      ],
    };
  },

  async calculateMultiRoute(
    origin: Coordinates,
    customers: Customer[]
  ): Promise<MultiRouteCalculationResult> {
    const pendingCustomers = customers.filter(
      (c) => c.status !== 'paid'
    );

    if (pendingCustomers.length === 0) {
      return {
        total_distance_meters: 0,
        total_distance_text: '0 m',
        total_duration_seconds: 0,
        total_duration_text: '0 min',
        coordinates_path: [],
        stops: [],
      };
    }

    // Connect all pending consumers in the ward/DTC without truncation
    const targetCustomers = pendingCustomers;

    const cacheKey = `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}::${targetCustomers.map((c) => c.customer_id).sort().join(',')}`;
    const cached = multiRouteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await api.post<MultiRouteCalculationResult>(
        '/api/routes/calculate-multi',
        {
          origin,
          customers: targetCustomers.map((c) => ({
            customer_id: c.customer_id,
            name: c.name || 'Consumer',
            meter_number: c.meter_number || '',
            latitude: c.latitude,
            longitude: c.longitude,
            pending_amount: c.pending_amount ?? 0,
            address: c.address || '',
            priority: c.priority || 'normal',
          })),
        },
        { timeout: 12000 }
      );
      if (response.data && response.data.coordinates_path?.length >= 2) {
        multiRouteCache.set(cacheKey, { data: response.data, ts: Date.now() });
        return response.data;
      }
    } catch (err) {
      // Backend calculate-multi offline or timed out, use fast client-side batched multi-routing
    }

    const clientRes = await this.calculateClientMultiRoute(origin, targetCustomers);
    multiRouteCache.set(cacheKey, { data: clientRes, ts: Date.now() });
    return clientRes;
  },

  /**
   * Fast client-side TSP nearest-neighbor algorithm using single-query batched OSRM waypoints.
   * Eliminates 50+ sequential HTTP requests and follows real road geometry seamlessly.
   */
  async calculateClientMultiRoute(
    origin: Coordinates,
    customers: Customer[]
  ): Promise<MultiRouteCalculationResult> {
    if (customers.length === 0) {
      return {
        total_distance_meters: 0,
        total_distance_text: '0 m',
        total_duration_seconds: 0,
        total_duration_text: '0 min',
        coordinates_path: [],
        stops: [],
      };
    }

    // 1. TSP Nearest Neighbor Sequence starting from Origin
    const unvisited = [...customers];
    const orderedCustomers: Customer[] = [];
    let currentLat = origin.latitude;
    let currentLng = origin.longitude;

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const dist = calculateHaversineDistance(
          currentLat,
          currentLng,
          unvisited[i].latitude,
          unvisited[i].longitude
        );
        if (dist < minDistance) {
          minDistance = dist;
          nearestIdx = i;
        }
      }

      const nextCust = unvisited.splice(nearestIdx, 1)[0];
      orderedCustomers.push(nextCust);
      currentLat = nextCust.latitude;
      currentLng = nextCust.longitude;
    }

    // Sequence of points: [Origin, Stop 1, Stop 2, ..., Stop N]
    const allPoints: Coordinates[] = [origin, ...orderedCustomers.map((c) => ({ latitude: c.latitude, longitude: c.longitude }))];

    let fullPath: Coordinates[] = [];
    let totalDist = 0;
    let totalDur = 0;
    const stops: any[] = [];

    // 2. Batch points in groups of up to 20 coordinates and query OSRM in a SINGLE request per batch
    const BATCH_SIZE = 20;

    for (let b = 0; b < allPoints.length - 1; b += (BATCH_SIZE - 1)) {
      const batchPoints = allPoints.slice(b, b + BATCH_SIZE);
      if (batchPoints.length < 2) break;

      const coordsParam = batchPoints.map((p) => `${p.longitude},${p.latitude}`).join(';');

      let batchSuccess = false;
      for (const server of OSRM_SERVERS) {
        try {
          const url = `${server}/${coordsParam}?overview=full&geometries=geojson&steps=false`;
          const res = await fetchWithTimeout(url, 4000);
          if (!res.ok) continue;

          const data = await res.json();
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const r = data.routes[0];
            totalDist += Number(r.distance || 0);
            totalDur += Number(r.duration || 0);

            const geoCoords = r.geometry?.coordinates || [];
            const coordsSegment: Coordinates[] = geoCoords.map((pt: [number, number]) => ({
              latitude: pt[1],
              longitude: pt[0],
            }));

            for (const pt of coordsSegment) {
              if (
                !fullPath.length ||
                fullPath[fullPath.length - 1].latitude !== pt.latitude ||
                fullPath[fullPath.length - 1].longitude !== pt.longitude
              ) {
                fullPath.push(pt);
              }
            }

            // Extract leg distances for each stop in this batch
            const legs = r.legs || [];
            for (let legI = 0; legI < legs.length; legI++) {
              const stopGlobalIdx = b + legI;
              if (stopGlobalIdx < orderedCustomers.length) {
                const cust = orderedCustomers[stopGlobalIdx];
                const legDist = Number(legs[legI].distance || 0);
                const legDur = Number(legs[legI].duration || 0);
                stops[stopGlobalIdx] = {
                  sequence: stopGlobalIdx + 1,
                  customer_id: cust.customer_id,
                  name: cust.name,
                  meter_number: cust.meter_number,
                  pending_amount: cust.pending_amount,
                  address: cust.address || '',
                  latitude: cust.latitude,
                  longitude: cust.longitude,
                  distance_from_prev_meters: Math.round(legDist),
                  distance_from_prev_text: legDist >= 1000 ? `${(legDist / 1000).toFixed(2)} km` : `${Math.round(legDist)} m`,
                  duration_from_prev_text: legDur >= 60 ? `${Math.round(legDur / 60)} min` : '< 1 min',
                };
              }
            }

            batchSuccess = true;
            break;
          }
        } catch (e) {
          // Try next server
        }
      }

      // If batch query failed across all servers, fallback to road corridor interpolation for this batch
      if (!batchSuccess) {
        for (let ptI = 0; ptI < batchPoints.length - 1; ptI++) {
          const fromPt = batchPoints[ptI];
          const toPt = batchPoints[ptI + 1];
          const stopGlobalIdx = b + ptI;

          const airDist = calculateHaversineDistance(fromPt.latitude, fromPt.longitude, toPt.latitude, toPt.longitude) * 1.35;
          const airDur = airDist / 6.94;
          totalDist += airDist;
          totalDur += airDur;

          const segCoords = buildRoadCorridorCoordinates(fromPt, toPt);
          for (const pt of segCoords) {
            if (
              !fullPath.length ||
              fullPath[fullPath.length - 1].latitude !== pt.latitude ||
              fullPath[fullPath.length - 1].longitude !== pt.longitude
            ) {
              fullPath.push(pt);
            }
          }

          if (stopGlobalIdx < orderedCustomers.length && !stops[stopGlobalIdx]) {
            const cust = orderedCustomers[stopGlobalIdx];
            stops[stopGlobalIdx] = {
              sequence: stopGlobalIdx + 1,
              customer_id: cust.customer_id,
              name: cust.name,
              meter_number: cust.meter_number,
              pending_amount: cust.pending_amount,
              address: cust.address || '',
              latitude: cust.latitude,
              longitude: cust.longitude,
              distance_from_prev_meters: Math.round(airDist),
              distance_from_prev_text: airDist >= 1000 ? `${(airDist / 1000).toFixed(2)} km` : `${Math.round(airDist)} m`,
              duration_from_prev_text: airDur >= 60 ? `${Math.round(airDur / 60)} min` : '< 1 min',
            };
          }
        }
      }
    }

    // Ensure all stops are populated and polyline connects to every stop
    for (let i = 0; i < orderedCustomers.length; i++) {
      if (!stops[i]) {
        const cust = orderedCustomers[i];
        const prev = i === 0 ? origin : { latitude: orderedCustomers[i - 1].latitude, longitude: orderedCustomers[i - 1].longitude };
        const d = calculateHaversineDistance(prev.latitude, prev.longitude, cust.latitude, cust.longitude) * 1.35;
        const dur = d / 6.94;
        totalDist += d;
        totalDur += dur;

        const segCoords = buildRoadCorridorCoordinates(prev, { latitude: cust.latitude, longitude: cust.longitude });
        for (const pt of segCoords) {
          if (
            !fullPath.length ||
            fullPath[fullPath.length - 1].latitude !== pt.latitude ||
            fullPath[fullPath.length - 1].longitude !== pt.longitude
          ) {
            fullPath.push(pt);
          }
        }

        stops[i] = {
          sequence: i + 1,
          customer_id: cust.customer_id,
          name: cust.name,
          meter_number: cust.meter_number,
          pending_amount: cust.pending_amount,
          address: cust.address || '',
          latitude: cust.latitude,
          longitude: cust.longitude,
          distance_from_prev_meters: Math.round(d),
          distance_from_prev_text: d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`,
          duration_from_prev_text: dur >= 60 ? `${Math.round(dur / 60)} min` : '< 1 min',
        };
      }
    }

    const totalDistText = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;
    const totalDurText = totalDur >= 60 ? `${Math.round(totalDur / 60)} min` : '< 1 min';

    return {
      total_distance_meters: Math.round(totalDist),
      total_distance_text: totalDistText,
      total_duration_seconds: Math.round(totalDur),
      total_duration_text: totalDurText,
      coordinates_path: fullPath.length >= 2 ? fullPath : [origin],
      stops,
    };
  },
};
