import math
import httpx
import logging
from typing import Dict, Any, List, Tuple
from app.config import settings
from app.schemas.route import (
    RouteCalculationResponse,
    Coordinates,
    RouteStep,
    MultiRouteCustomerInput,
    MultiRouteStop,
    MultiRouteCalculationResponse
)

logger = logging.getLogger("uvicorn.error")

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two lat/lng coordinates."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def encode_polyline(points: List[Tuple[float, float]]) -> str:
    """Simple polyline encoder for fallbacks."""
    result = []
    prev_lat = 0
    prev_lng = 0
    for lat, lng in points:
        late5 = int(round(lat * 1e5))
        lnge5 = int(round(lng * 1e5))

        dlat = late5 - prev_lat
        dlng = lnge5 - prev_lng

        prev_lat = late5
        prev_lng = lnge5

        for val in (dlat, dlng):
            val = ~(val << 1) if val < 0 else (val << 1)
            while val >= 0x20:
                result.append(chr((0x20 | (val & 0x1f)) + 63))
                val >>= 5
            result.append(chr(val + 63))
    return "".join(result)

def decode_polyline(polyline_str: str) -> List[Coordinates]:
    """Decode a Google encoded polyline string into a list of Coordinates."""
    if not polyline_str:
        return []
    index, lat, lng = 0, 0, 0
    coordinates = []
    length = len(polyline_str)
    while index < length:
        # Decode Latitude
        shift, result = 0, 0
        while True:
            if index >= length:
                break
            byte = ord(polyline_str[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        # Decode Longitude
        shift, result = 0, 0
        while True:
            if index >= length:
                break
            byte = ord(polyline_str[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        coordinates.append(Coordinates(latitude=lat * 1e-5, longitude=lng * 1e-5))
    return coordinates

class MapsService:

    @staticmethod
    async def calculate_route(
        origin_lat: float, origin_lng: float,
        dest_lat: float, dest_lng: float
    ) -> RouteCalculationResponse:
        """
        Calculate route using OSRM (Open Source Routing Machine)
        for exact real-road street geometry & turn steps.
        """
        # 1. Primary Routing Engine: OSRM (Open Source Routing Machine) API v1
        try:
            base_url = settings.OSRM_BASE_URL.rstrip('/')
            osrm_url = f"{base_url}/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}?overview=full&geometries=geojson&steps=true"
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(osrm_url)
                if res.status_code == 200:
                    data = res.json()
                    if data.get("code") == "Ok" and data.get("routes"):
                        osrm_route = data["routes"][0]
                        dist_m = float(osrm_route.get("distance", 0))
                        dur_s = float(osrm_route.get("duration", 0))

                        # Extract real street coordinates from GeoJSON
                        geo_coords = osrm_route.get("geometry", {}).get("coordinates", [])
                        coords_path = [
                            Coordinates(latitude=pt[1], longitude=pt[0])
                            for pt in geo_coords
                        ]

                        # Extract turn-by-turn steps
                        steps: List[RouteStep] = []
                        legs = osrm_route.get("legs", [])
                        if legs:
                            for step in legs[0].get("steps", []):
                                name = step.get("name", "")
                                maneuver = step.get("maneuver", {})
                                m_type = maneuver.get("type", "")
                                modifier = maneuver.get("modifier", "")

                                instruction = f"{m_type.capitalize()} {modifier}".strip()
                                if name:
                                    instruction += f" onto {name}"
                                if not instruction or instruction == "Depart":
                                    instruction = f"Head along {name if name else 'street'} towards meter"

                                s_dist = step.get("distance", 0)
                                s_dur = step.get("duration", 0)

                                steps.append(RouteStep(
                                    instruction=instruction,
                                    distance_text=f"{s_dist / 1000.0:.1f} km" if s_dist >= 1000 else f"{int(s_dist)} m",
                                    duration_text=f"{int(s_dur // 60)} min" if s_dur >= 60 else f"{int(s_dur)} sec",
                                    start_location=Coordinates(latitude=origin_lat, longitude=origin_lng),
                                    end_location=Coordinates(latitude=dest_lat, longitude=dest_lng)
                                ))

                        dist_formatted = f"{dist_m / 1000.0:.2f} km" if dist_m >= 1000 else f"{int(dist_m)} m"
                        dur_formatted = f"{int(dur_s // 60)} min" if dur_s >= 60 else "< 1 min"

                        return RouteCalculationResponse(
                            distance_meters=round(dist_m, 1),
                            distance_text=dist_formatted,
                            duration_seconds=round(dur_s, 1),
                            duration_text=dur_formatted,
                            start_address=f"Officer Location ({origin_lat:.4f}, {origin_lng:.4f})",
                            end_address=f"Meter Location ({dest_lat:.4f}, {dest_lng:.4f})",
                            encoded_polyline="",
                            coordinates_path=coords_path if coords_path else [
                                Coordinates(latitude=origin_lat, longitude=origin_lng),
                                Coordinates(latitude=dest_lat, longitude=dest_lng)
                            ],
                            steps=steps if steps else [
                                RouteStep(
                                    instruction="Proceed along main road to electricity meter",
                                    distance_text=dist_formatted,
                                    duration_text=dur_formatted,
                                    start_location=Coordinates(latitude=origin_lat, longitude=origin_lng),
                                    end_location=Coordinates(latitude=dest_lat, longitude=dest_lng)
                                )
                            ]
                        )
        except Exception as e:
            logger.warning(f"OSRM API v1 driving router call failed: {e}")

        # 2. Secondary Fallback: Public OSRM routing endpoint
        try:
            osrm_url = f"https://router.project-osrm.org/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}?overview=full&geometries=geojson&steps=true"
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(osrm_url)
                if res.status_code == 200:
                    data = res.json()
                    if data.get("code") == "Ok" and data.get("routes"):
                        osrm_route = data["routes"][0]
                        dist_m = float(osrm_route.get("distance", 0))
                        dur_s = float(osrm_route.get("duration", 0))

                        # Extract real street coordinates from GeoJSON
                        geo_coords = osrm_route.get("geometry", {}).get("coordinates", [])
                        coords_path = [
                            Coordinates(latitude=pt[1], longitude=pt[0])
                            for pt in geo_coords
                        ]

                        # Extract turn-by-turn steps
                        steps: List[RouteStep] = []
                        legs = osrm_route.get("legs", [])
                        if legs:
                            for step in legs[0].get("steps", []):
                                name = step.get("name", "")
                                maneuver = step.get("maneuver", {})
                                m_type = maneuver.get("type", "")
                                modifier = maneuver.get("modifier", "")

                                instruction = f"{m_type.capitalize()} {modifier}".strip()
                                if name:
                                    instruction += f" onto {name}"
                                if not instruction or instruction == "Depart":
                                    instruction = f"Head along {name if name else 'street'} towards meter"

                                s_dist = step.get("distance", 0)
                                s_dur = step.get("duration", 0)

                                steps.append(RouteStep(
                                    instruction=instruction,
                                    distance_text=f"{s_dist / 1000.0:.1f} km" if s_dist >= 1000 else f"{int(s_dist)} m",
                                    duration_text=f"{int(s_dur // 60)} min" if s_dur >= 60 else f"{int(s_dur)} sec",
                                    start_location=Coordinates(latitude=origin_lat, longitude=origin_lng),
                                    end_location=Coordinates(latitude=dest_lat, longitude=dest_lng)
                                ))

                        dist_formatted = f"{dist_m / 1000.0:.2f} km" if dist_m >= 1000 else f"{int(dist_m)} m"
                        dur_formatted = f"{int(dur_s // 60)} min" if dur_s >= 60 else "< 1 min"

                        return RouteCalculationResponse(
                            distance_meters=round(dist_m, 1),
                            distance_text=dist_formatted,
                            duration_seconds=round(dur_s, 1),
                            duration_text=dur_formatted,
                            start_address=f"Officer Location ({origin_lat:.4f}, {origin_lng:.4f})",
                            end_address=f"Meter Location ({dest_lat:.4f}, {dest_lng:.4f})",
                            encoded_polyline="",
                            coordinates_path=coords_path if coords_path else [
                                Coordinates(latitude=origin_lat, longitude=origin_lng),
                                Coordinates(latitude=dest_lat, longitude=dest_lng)
                            ],
                            steps=steps if steps else [
                                RouteStep(
                                    instruction="Proceed along main road to electricity meter",
                                    distance_text=dist_formatted,
                                    duration_text=dur_formatted,
                                    start_location=Coordinates(latitude=origin_lat, longitude=origin_lng),
                                    end_location=Coordinates(latitude=dest_lat, longitude=dest_lng)
                                )
                            ]
                        )
        except Exception as e:
            logger.warning(f"OSRM Routing failed, using Haversine calculation: {e}")

        # 3. Last Resort Fallback Calculation using Haversine + Manhattan street grid simulation
        air_distance = haversine_distance(origin_lat, origin_lng, dest_lat, dest_lng)
        urban_distance = air_distance * 1.35
        duration_sec = urban_distance / 6.94

        points = [
            (origin_lat, origin_lng),
            (dest_lat, dest_lng)
        ]
        
        encoded_poly = encode_polyline(points)

        coords_path = [
            Coordinates(latitude=origin_lat, longitude=origin_lng),
            Coordinates(latitude=dest_lat, longitude=dest_lng)
        ]

        steps = [
            RouteStep(
                instruction="Proceed directly towards consumer meter location",
                distance_text=f"{urban_distance / 1000.0:.1f} km",
                duration_text=f"{int(duration_sec // 60)} min",
                start_location=Coordinates(latitude=origin_lat, longitude=origin_lng),
                end_location=Coordinates(latitude=dest_lat, longitude=dest_lng)
            )
        ]

        dist_formatted = f"{urban_distance / 1000.0:.2f} km" if urban_distance >= 1000 else f"{int(urban_distance)} m"
        dur_formatted = f"{int(duration_sec // 60)} min" if duration_sec >= 60 else "< 1 min"

        return RouteCalculationResponse(
            distance_meters=round(urban_distance, 1),
            distance_text=dist_formatted,
            duration_seconds=round(duration_sec, 1),
            duration_text=dur_formatted,
            start_address=f"Officer Location ({origin_lat:.4f}, {origin_lng:.4f})",
            end_address=f"Meter Location ({dest_lat:.4f}, {dest_lng:.4f})",
            encoded_polyline=encoded_poly,
            coordinates_path=coords_path,
            steps=steps
        )

    @staticmethod
    async def calculate_multi_route(
        origin_lat: float,
        origin_lng: float,
        customers: List[MultiRouteCustomerInput]
    ) -> MultiRouteCalculationResponse:
        if not customers:
            return MultiRouteCalculationResponse(
                total_distance_meters=0,
                total_distance_text="0 m",
                total_duration_seconds=0,
                total_duration_text="0 min",
                coordinates_path=[],
                stops=[]
            )

        # 1. TSP Nearest-Neighbor Algorithm starting from Origin
        unvisited = list(range(len(customers)))
        tour = []
        curr_lat, curr_lng = origin_lat, origin_lng

        while unvisited:
            best_idx = unvisited[0]
            best_dist = float('inf')
            for idx in unvisited:
                c = customers[idx]
                d = haversine_distance(curr_lat, curr_lng, c.latitude, c.longitude)
                if d < best_dist:
                    best_dist = d
                    best_idx = idx
            tour.append(best_idx)
            unvisited.remove(best_idx)
            curr_lat, curr_lng = customers[best_idx].latitude, customers[best_idx].longitude

        # 2. 2-Opt Optimization for TSP
        def get_tour_distance(t):
            dist = 0.0
            prev_lat, prev_lng = origin_lat, origin_lng
            for i in t:
                c = customers[i]
                dist += haversine_distance(prev_lat, prev_lng, c.latitude, c.longitude)
                prev_lat, prev_lng = c.latitude, c.longitude
            return dist

        improved = True
        while improved:
            improved = False
            best_d = get_tour_distance(tour)
            for i in range(len(tour) - 1):
                for j in range(i + 1, len(tour)):
                    new_tour = tour[:i] + tour[i:j+1][::-1] + tour[j+1:]
                    new_d = get_tour_distance(new_tour)
                    if new_d < best_d - 1.0:
                        tour = new_tour
                        best_d = new_d
                        improved = True
                        break
                if improved:
                    break

        # Build Waypoint Sequence: [Origin, Stop 1, Stop 2, ..., Stop N]
        points = [(origin_lat, origin_lng)] + [
            (customers[idx].latitude, customers[idx].longitude) for idx in tour
        ]

        total_distance = 0.0
        total_duration = 0.0
        full_coords_path: List[Coordinates] = []
        stops: List[MultiRouteStop] = []

        base = settings.OSRM_BASE_URL.rstrip('/')
        configured_srv = f"{base}/route/v1/driving" if not base.endswith("/route/v1/driving") else base

        osrm_servers = [
            "https://routing.openstreetmap.de/routed-car/route/v1/driving",
            configured_srv,
            "https://router.project-osrm.org/route/v1/driving",
        ]

        batch_size = 25
        async with httpx.AsyncClient(timeout=10.0) as client:
            for b in range(0, len(points) - 1, batch_size - 1):
                batch_points = points[b:b + batch_size]
                if len(batch_points) < 2:
                    break

                coords_param = ";".join(f"{p[1]},{p[0]}" for p in batch_points)
                batch_done = False

                for srv in osrm_servers:
                    try:
                        url = f"{srv}/{coords_param}?overview=full&geometries=geojson&steps=false"
                        res = await client.get(url)
                        if res.status_code == 200:
                            data = res.json()
                            if data.get("code") == "Ok" and data.get("routes"):
                                r = data["routes"][0]
                                total_distance += float(r.get("distance", 0))
                                total_duration += float(r.get("duration", 0))

                                geo_coords = r.get("geometry", {}).get("coordinates", [])
                                for pt in geo_coords:
                                    c = Coordinates(latitude=pt[1], longitude=pt[0])
                                    if not full_coords_path or full_coords_path[-1].latitude != c.latitude or full_coords_path[-1].longitude != c.longitude:
                                        full_coords_path.append(c)

                                legs = r.get("legs", [])
                                for leg_i, leg in enumerate(legs):
                                    stop_idx = b + leg_i
                                    if stop_idx < len(tour):
                                        cust = customers[tour[stop_idx]]
                                        ldist = float(leg.get("distance", 0))
                                        ldur = float(leg.get("duration", 0))
                                        d_text = f"{ldist / 1000.0:.2f} km" if ldist >= 1000 else f"{int(ldist)} m"
                                        dur_text = f"{int(ldur // 60)} min" if ldur >= 60 else "< 1 min"
                                        stops.append(
                                            MultiRouteStop(
                                                sequence=stop_idx + 1,
                                                customer_id=cust.customer_id,
                                                name=cust.name or "Consumer",
                                                meter_number=cust.meter_number or "",
                                                pending_amount=float(cust.pending_amount or 0.0),
                                                address=cust.address or "",
                                                latitude=cust.latitude,
                                                longitude=cust.longitude,
                                                distance_from_prev_meters=round(ldist, 1),
                                                distance_from_prev_text=d_text,
                                                duration_from_prev_text=dur_text
                                            )
                                        )
                                batch_done = True
                                break
                    except Exception as e:
                        logger.warning(f"OSRM batch query on {srv} failed: {e}")

                if not batch_done:
                    # Fallback corridor interpolation for this batch
                    for pt_i in range(len(batch_points) - 1):
                        p1 = batch_points[pt_i]
                        p2 = batch_points[pt_i + 1]
                        stop_idx = b + pt_i
                        air_d = haversine_distance(p1[0], p1[1], p2[0], p2[1]) * 1.35
                        dur = air_d / 6.94
                        total_distance += air_d
                        total_duration += dur

                        interp_coords = [
                            Coordinates(latitude=p1[0], longitude=p1[1]),
                            Coordinates(latitude=round(p1[0] + (p2[0] - p1[0]) * 0.5, 6), longitude=round(p1[1] + (p2[1] - p1[1]) * 0.5, 6)),
                            Coordinates(latitude=p2[0], longitude=p2[1])
                        ]
                        for c in interp_coords:
                            if not full_coords_path or full_coords_path[-1].latitude != c.latitude or full_coords_path[-1].longitude != c.longitude:
                                full_coords_path.append(c)

                        if stop_idx < len(tour):
                            cust = customers[tour[stop_idx]]
                            d_text = f"{air_d / 1000.0:.2f} km" if air_d >= 1000 else f"{int(air_d)} m"
                            dur_text = f"{int(dur // 60)} min" if dur >= 60 else "< 1 min"
                            stops.append(
                                MultiRouteStop(
                                    sequence=stop_idx + 1,
                                    customer_id=cust.customer_id,
                                    name=cust.name or "Consumer",
                                    meter_number=cust.meter_number or "",
                                    pending_amount=float(cust.pending_amount or 0.0),
                                    address=cust.address or "",
                                    latitude=cust.latitude,
                                    longitude=cust.longitude,
                                    distance_from_prev_meters=round(air_d, 1),
                                    distance_from_prev_text=d_text,
                                    duration_from_prev_text=dur_text
                                )
                            )

        # Ensure all stops from the tour are populated and path connects to each
        existing_stops_map = {s.customer_id: s for s in stops}
        final_stops: List[MultiRouteStop] = []

        for idx_in_tour, cust_idx in enumerate(tour):
            cust = customers[cust_idx]
            prev_lat = origin_lat if idx_in_tour == 0 else customers[tour[idx_in_tour - 1]].latitude
            prev_lng = origin_lng if idx_in_tour == 0 else customers[tour[idx_in_tour - 1]].longitude
            air_d = haversine_distance(prev_lat, prev_lng, cust.latitude, cust.longitude) * 1.35
            d_text = f"{air_d / 1000.0:.2f} km" if air_d >= 1000 else f"{int(air_d)} m"

            existing_stop = existing_stops_map.get(cust.customer_id)
            if existing_stop:
                existing_stop.sequence = idx_in_tour + 1
                final_stops.append(existing_stop)
            else:
                total_distance += air_d
                total_duration += (air_d / 6.94)
                interp_c = Coordinates(latitude=cust.latitude, longitude=cust.longitude)
                if not full_coords_path or full_coords_path[-1].latitude != interp_c.latitude or full_coords_path[-1].longitude != interp_c.longitude:
                    full_coords_path.append(interp_c)

                final_stops.append(
                    MultiRouteStop(
                        sequence=idx_in_tour + 1,
                        customer_id=cust.customer_id,
                        name=cust.name or "Consumer",
                        meter_number=cust.meter_number or "",
                        pending_amount=float(cust.pending_amount or 0.0),
                        address=cust.address or "",
                        latitude=cust.latitude,
                        longitude=cust.longitude,
                        distance_from_prev_meters=round(air_d, 1),
                        distance_from_prev_text=d_text,
                        duration_from_prev_text="< 1 min"
                    )
                )

        total_dist_text = f"{total_distance / 1000.0:.2f} km" if total_distance >= 1000 else f"{int(total_distance)} m"
        total_dur_text = f"{int(total_duration // 60)} min" if total_duration >= 60 else "< 1 min"

        return MultiRouteCalculationResponse(
            total_distance_meters=round(total_distance, 1),
            total_distance_text=total_dist_text,
            total_duration_seconds=round(total_duration, 1),
            total_duration_text=total_dur_text,
            coordinates_path=full_coords_path if full_coords_path else [Coordinates(latitude=origin_lat, longitude=origin_lng)],
            stops=final_stops
        )


