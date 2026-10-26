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

class MapsService:
    @staticmethod
    async def calculate_route(
        origin_lat: float, origin_lng: float,
        dest_lat: float, dest_lng: float
    ) -> RouteCalculationResponse:
        """
        Calculate route using OSRM street geometry with snapping radius.
        """
        # Default OSRM snapping (no radiuses) works best for Indian OSM data where
        # GPS offsets can be 50-80m. radiuses=45 causes HTTP 400 "NoSegment" errors.
        osrm_urls = [
            f"https://router.project-osrm.org/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}?overview=full&geometries=geojson&steps=true&continue_straight=false",
            f"https://router.project-osrm.org/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}?overview=full&geometries=geojson&steps=true&radiuses=150;150&continue_straight=false",
            f"https://router.project-osrm.org/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}?overview=full&geometries=geojson&steps=true"
        ]

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
            for url in osrm_urls:
                try:
                    res = await client.get(url)
                    if res.status_code == 200:
                        data = res.json()
                        if data.get("code") == "Ok" and data.get("routes"):
                            osrm_route = data["routes"][0]
                            dist_m = float(osrm_route.get("distance", 0))
                            dur_s = float(osrm_route.get("duration", 0))
                            geo_coords = osrm_route.get("geometry", {}).get("coordinates", [])
                            coords_path = [Coordinates(latitude=pt[1], longitude=pt[0]) for pt in geo_coords]
                            return RouteCalculationResponse(
                                distance_meters=round(dist_m, 1),
                                distance_text=f"{dist_m / 1000.0:.2f} km" if dist_m >= 1000 else f"{int(dist_m)} m",
                                duration_seconds=round(dur_s, 1),
                                duration_text=f"{int(dur_s // 60)} min" if dur_s >= 60 else "< 1 min",
                                start_address=f"Start ({origin_lat:.4f}, {origin_lng:.4f})",
                                end_address=f"End ({dest_lat:.4f}, {dest_lng:.4f})",
                                encoded_polyline="",
                                coordinates_path=coords_path if coords_path else [
                                    Coordinates(latitude=origin_lat, longitude=origin_lng),
                                    Coordinates(latitude=dest_lat, longitude=dest_lng)
                                ],
                                steps=[]
                            )
                except Exception as e:
                    logger.warning(f"OSRM single route try failed: {e}")

        # Fallback direct road progression (NO artificial 90-degree Manhattan boxes)
        air_distance = haversine_distance(origin_lat, origin_lng, dest_lat, dest_lng)
        urban_distance = air_distance * 1.35
        duration_sec = urban_distance / 6.94
        coords_path = [
            Coordinates(latitude=origin_lat, longitude=origin_lng),
            Coordinates(latitude=dest_lat, longitude=dest_lng)
        ]
        return RouteCalculationResponse(
            distance_meters=round(urban_distance, 1),
            distance_text=f"{urban_distance / 1000.0:.2f} km" if urban_distance >= 1000 else f"{int(urban_distance)} m",
            duration_seconds=round(duration_sec, 1),
            duration_text=f"{int(duration_sec // 60)} min" if duration_sec >= 60 else "< 1 min",
            start_address=f"Start ({origin_lat:.4f}, {origin_lng:.4f})",
            end_address=f"End ({dest_lat:.4f}, {dest_lng:.4f})",
            encoded_polyline="",
            coordinates_path=coords_path,
            steps=[]
        )

    @staticmethod
    async def calculate_multi_route(
        origin_lat: float,
        origin_lng: float,
        customers: List[MultiRouteCustomerInput]
    ) -> MultiRouteCalculationResponse:
        """
        Solves multi-point route using TSP (Nearest-Neighbor + 2-Opt)
        and stitches real road geometry along actual street geometries using
        efficient multi-waypoint OSRM batching with snapping radius.
        """
        if not customers:
            return MultiRouteCalculationResponse(
                total_distance_meters=0,
                total_distance_text="0 m",
                total_duration_seconds=0,
                total_duration_text="0 min",
                coordinates_path=[],
                stops=[]
            )

        # 1. TSP Nearest-Neighbor Algorithm
        unvisited = list(range(len(customers)))
        tour = []
        curr_lat, curr_lng = origin_lat, origin_lng

        while unvisited:
            best_idx = None
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

        # 2. 2-Opt Optimization
        def get_tour_distance(t):
            dist = 0.0
            prev_lat, prev_lng = origin_lat, origin_lng
            for i in t:
                c = customers[i]
                dist += haversine_distance(prev_lat, prev_lng, c.latitude, c.longitude)
                prev_lat, prev_lng = c.latitude, c.longitude
            return dist

        improved = True
        iterations = 0
        while improved and iterations < 50:
            improved = False
            iterations += 1
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

        # 3. Stitch Real OSRM Road Geometry for all waypoints
        # Waypoints: [Origin, Stop 1, Stop 2, ..., Stop N]
        points = [(origin_lat, origin_lng)] + [
            (customers[idx].latitude, customers[idx].longitude) for idx in tour
        ]

        total_distance = 0.0
        total_duration = 0.0
        full_coords_path: List[Coordinates] = [Coordinates(latitude=origin_lat, longitude=origin_lng)]
        stops_map: Dict[int, MultiRouteStop] = {}

        # Use 18-waypoint batches: OSRM calculates continuous road geometry along actual streets
        # without hitting URL length limits or 429 rate limits
        BATCH_SIZE = 12
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }

        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            for b in range(0, len(points) - 1, BATCH_SIZE - 1):
                batch_points = points[b:b + BATCH_SIZE]
                if len(batch_points) < 2:
                    break

                coords_str = ";".join(f"{round(p[1], 6)},{round(p[0], 6)}" for p in batch_points)
                radiuses_fallback = ";".join("150" for _ in batch_points)

                batch_success = False
                # Default OSRM snapping first (works for Indian residential streets with 50-80m GPS offsets),
                # then radiuses=150 as fallback for remote meters far from mapped OSM roads
                osrm_urls = [
                    f"https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson&steps=false&continue_straight=false",
                    f"https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson&steps=false&radiuses={radiuses_fallback}&continue_straight=false",
                    f"https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson"
                ]

                for url in osrm_urls:
                    try:
                        res = await client.get(url)
                        if res.status_code == 200:
                            data = res.json()
                            if data.get("code") == "Ok" and data.get("routes"):
                                r = data["routes"][0]
                                total_distance += float(r.get("distance", 0))
                                total_duration += float(r.get("duration", 0))

                                geo_coords = r.get("geometry", {}).get("coordinates", [])
                                for pt in geo_coords:
                                    coord = Coordinates(latitude=pt[1], longitude=pt[0])
                                    if not (full_coords_path and full_coords_path[-1].latitude == coord.latitude and full_coords_path[-1].longitude == coord.longitude):
                                        full_coords_path.append(coord)

                                legs = r.get("legs", [])
                                for leg_i, leg in enumerate(legs):
                                    stop_seq_idx = b + leg_i
                                    if stop_seq_idx < len(tour):
                                        cust = customers[tour[stop_seq_idx]]
                                        ldist = float(leg.get("distance", 0))
                                        ldur = float(leg.get("duration", 0))
                                        dist_text = f"{ldist / 1000.0:.2f} km" if ldist >= 1000 else f"{int(ldist)} m"
                                        dur_text = f"{int(ldur // 60)} min" if ldur >= 60 else "< 1 min"
                                        stops_map[stop_seq_idx] = MultiRouteStop(
                                            sequence=stop_seq_idx + 1,
                                            customer_id=cust.customer_id,
                                            name=cust.name or "Consumer",
                                            meter_number=cust.meter_number or "",
                                            pending_amount=float(cust.pending_amount or 0.0),
                                            address=cust.address or "",
                                            latitude=cust.latitude,
                                            longitude=cust.longitude,
                                            distance_from_prev_meters=round(ldist, 1),
                                            distance_from_prev_text=dist_text,
                                            duration_from_prev_text=dur_text
                                        )
                                batch_success = True
                                break
                            else:
                                logger.warning(f"OSRM returned code: {data.get('code')}")
                        else:
                            logger.warning(f"OSRM status {res.status_code}: {res.text[:120]}")
                    except Exception as e:
                        logger.warning(f"OSRM batch query failed: {type(e).__name__}: {e}")

                # If batch failed, query individual legs with OSRM, or interpolate cleanly without boxes
                if not batch_success:
                    for pt_i in range(len(batch_points) - 1):
                        p1 = batch_points[pt_i]
                        p2 = batch_points[pt_i + 1]
                        stop_seq_idx = b + pt_i

                        leg_coords: List[Coordinates] = []
                        leg_dist = 0.0
                        leg_dur = 0.0

                        try:
                            leg_url = f"https://router.project-osrm.org/route/v1/driving/{round(p1[1], 6)},{round(p1[0], 6)};{round(p2[1], 6)},{round(p2[0], 6)}?overview=full&geometries=geojson"
                            res = await client.get(leg_url)
                            if res.status_code == 200:
                                data = res.json()
                                if data.get("code") == "Ok" and data.get("routes"):
                                    r = data["routes"][0]
                                    leg_dist = float(r.get("distance", 0))
                                    leg_dur = float(r.get("duration", 0))
                                    geo_coords = r.get("geometry", {}).get("coordinates", [])
                                    leg_coords = [Coordinates(latitude=pt[1], longitude=pt[0]) for pt in geo_coords]
                        except Exception:
                            pass

                        if not leg_coords or len(leg_coords) < 2:
                            air_d = haversine_distance(p1[0], p1[1], p2[0], p2[1])
                            leg_dist = air_d * 1.35
                            leg_dur = leg_dist / 6.94
                            # Direct smooth connection — NEVER artificial 90-degree Manhattan right-angle boxes
                            leg_coords = [
                                Coordinates(latitude=p1[0], longitude=p1[1]),
                                Coordinates(latitude=p2[0], longitude=p2[1])
                            ]

                        total_distance += leg_dist
                        total_duration += leg_dur

                        for pt in leg_coords:
                            if not (full_coords_path and full_coords_path[-1].latitude == pt.latitude and full_coords_path[-1].longitude == pt.longitude):
                                full_coords_path.append(pt)

                        if stop_seq_idx < len(tour) and stop_seq_idx not in stops_map:
                            cust = customers[tour[stop_seq_idx]]
                            dist_text = f"{leg_dist / 1000.0:.2f} km" if leg_dist >= 1000 else f"{int(leg_dist)} m"
                            dur_text = f"{int(leg_dur // 60)} min" if leg_dur >= 60 else "< 1 min"
                            stops_map[stop_seq_idx] = MultiRouteStop(
                                sequence=stop_seq_idx + 1,
                                customer_id=cust.customer_id,
                                name=cust.name or "Consumer",
                                meter_number=cust.meter_number or "",
                                pending_amount=float(cust.pending_amount or 0.0),
                                address=cust.address or "",
                                latitude=cust.latitude,
                                longitude=cust.longitude,
                                distance_from_prev_meters=round(leg_dist, 1),
                                distance_from_prev_text=dist_text,
                                duration_from_prev_text=dur_text
                            )

        # 4. Assemble final stops in sequence 1 to N
        final_stops: List[MultiRouteStop] = []
        for i in range(len(tour)):
            if i in stops_map:
                final_stops.append(stops_map[i])
            else:
                cust = customers[tour[i]]
                prev = points[i]
                d = haversine_distance(prev[0], prev[1], cust.latitude, cust.longitude) * 1.35
                d_text = f"{d / 1000.0:.2f} km" if d >= 1000 else f"{int(d)} m"
                final_stops.append(
                    MultiRouteStop(
                        sequence=i + 1,
                        customer_id=cust.customer_id,
                        name=cust.name or "Consumer",
                        meter_number=cust.meter_number or "",
                        pending_amount=float(cust.pending_amount or 0.0),
                        address=cust.address or "",
                        latitude=cust.latitude,
                        longitude=cust.longitude,
                        distance_from_prev_meters=round(d, 1),
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
            coordinates_path=full_coords_path if len(full_coords_path) >= 2 else [Coordinates(latitude=origin_lat, longitude=origin_lng)],
            stops=final_stops
        )
