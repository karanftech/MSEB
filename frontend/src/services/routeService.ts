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

/**
 * Direct client-side OSRM API v1 driving router.
 * Used when backend routing proxy is unreachable or client fallback is required.
 */
export async function fetchOSRMRoute(
  origin: Coordinates,
  destination: Coordinates
): Promise<RouteCalculationResult> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OSRM API responded with status ${res.status}`);
  }
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('OSRM returned no driving route');
  }

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
    coordinates_path: coordsPath.length >= 2 ? coordsPath : [origin, destination],
    steps: steps.length > 0 ? steps : [
      {
        instruction: 'Proceed along route towards electricity meter',
        distance_text: distText,
        duration_text: durText,
      },
    ],
  };
}

export const routeService = {
  clearRouteCache() {
    // No-op
  },

  async calculateRoute(
    origin: Coordinates,
    destination: Coordinates,
    customerId?: string,
    meterId?: string
  ): Promise<RouteCalculationResult> {
    try {
      const response = await api.post<RouteCalculationResult>('/api/routes/calculate', {
        origin,
        destination,
        customer_id: customerId,
        meter_id: meterId,
      });
      const data = response.data;
      if (data.encoded_polyline && (!data.coordinates_path || data.coordinates_path.length <= 2)) {
        const decoded = decodePolyline(data.encoded_polyline);
        if (decoded.length > 0) {
          data.coordinates_path = decoded;
        }
      }
      return data;
    } catch (err) {
      console.warn('Backend calculate route API offline, using direct OSRM API v1:', err);
      try {
        return await fetchOSRMRoute(origin, destination);
      } catch (osrmErr) {
        console.warn('Direct OSRM route fallback:', osrmErr);
        return this.calculateClientRoute(origin, destination);
      }
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

    const midLat = (origin.latitude + destination.latitude) / 2;
    const midLng = (origin.longitude + destination.longitude) / 2;

    const pathCoords: Coordinates[] = [
      { latitude: origin.latitude, longitude: origin.longitude },
      { latitude: midLat, longitude: origin.longitude },
      { latitude: destination.latitude, longitude: destination.longitude },
    ];

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
          instruction: 'Proceed along main road towards electricity meter',
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
      (c) => c.status !== 'paid' && (c.pending_amount === undefined || c.pending_amount > 0)
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

    try {
      const response = await api.post<MultiRouteCalculationResult>('/api/routes/calculate-multi', {
        origin,
        customers: pendingCustomers.map((c) => ({
          customer_id: c.customer_id,
          name: c.name,
          meter_number: c.meter_number,
          latitude: c.latitude,
          longitude: c.longitude,
          pending_amount: c.pending_amount,
          address: c.address,
          priority: c.priority,
        })),
      });
      return response.data;
    } catch (err) {
      console.warn('Backend calculate-multi offline, performing client-side TSP + OSRM routing:', err);
      return this.calculateClientMultiRoute(origin, pendingCustomers);
    }
  },

  // Client-side TSP nearest-neighbor algorithm with OSRM legs
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

    let totalDist = 0;
    let totalDur = 0;
    const path: Coordinates[] = [{ latitude: origin.latitude, longitude: origin.longitude }];

    let prevLat = origin.latitude;
    let prevLng = origin.longitude;

    const stops = [];
    for (let idx = 0; idx < orderedCustomers.length; idx++) {
      const cust = orderedCustomers[idx];
      let legDist = 0;
      let legDur = 0;
      let legCoords: Coordinates[] = [];

      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${prevLng},${prevLat};${cust.longitude},${cust.latitude}?overview=full&geometries=geojson`;
        const res = await fetch(osrmUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const r = data.routes[0];
            legDist = r.distance || 0;
            legDur = r.duration || 0;
            const geo = r.geometry?.coordinates || [];
            legCoords = geo.map((pt: [number, number]) => ({ latitude: pt[1], longitude: pt[0] }));
          }
        }
      } catch (e) {
        // Fallback
      }

      if (!legCoords || legCoords.length < 2) {
        legDist = calculateHaversineDistance(prevLat, prevLng, cust.latitude, cust.longitude) * 1.35;
        legDur = legDist / 6.94;
        legCoords = [
          { latitude: prevLat, longitude: prevLng },
          { latitude: cust.latitude, longitude: cust.longitude },
        ];
      }

      totalDist += legDist;
      totalDur += legDur;

      for (const pt of legCoords) {
        if (!path.length || path[path.length - 1].latitude !== pt.latitude || path[path.length - 1].longitude !== pt.longitude) {
          path.push(pt);
        }
      }

      prevLat = cust.latitude;
      prevLng = cust.longitude;

      const legDistText = legDist >= 1000 ? `${(legDist / 1000).toFixed(2)} km` : `${Math.round(legDist)} m`;
      const legDurText = legDur >= 60 ? `${Math.round(legDur / 60)} min` : '< 1 min';

      stops.push({
        sequence: idx + 1,
        customer_id: cust.customer_id,
        name: cust.name,
        meter_number: cust.meter_number,
        pending_amount: cust.pending_amount,
        address: cust.address || '',
        latitude: cust.latitude,
        longitude: cust.longitude,
        distance_from_prev_meters: Math.round(legDist),
        distance_from_prev_text: legDistText,
        duration_from_prev_text: legDurText,
      });
    }

    const totalDistText = totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)} km` : `${Math.round(totalDist)} m`;
    const totalDurText = totalDur >= 60 ? `${Math.round(totalDur / 60)} min` : '< 1 min';

    return {
      total_distance_meters: Math.round(totalDist),
      total_distance_text: totalDistText,
      total_duration_seconds: Math.round(totalDur),
      total_duration_text: totalDurText,
      coordinates_path: path,
      stops,
    };
  },
};
