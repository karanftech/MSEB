'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Customer,
  Coordinates,
  RouteCalculationResult,
  MultiRouteCalculationResult,
  MapLayerType,
  NavigationState,
} from '@/types';
import MapControls from '@/components/map/MapControls';
import NavigationPanel from '@/components/map/NavigationPanel';
import { speakInstruction, stopSpeech } from '@/utils/speech';

interface MapViewProps {
  customers: Customer[];
  officerCoords: Coordinates | null;
  officerHeading?: number | null;
  selectedCustomer: Customer | null;
  route: RouteCalculationResult | null;
  multiRoute?: MultiRouteCalculationResult | null;
  activeStopIndex?: number;
  navState?: NavigationState;
  onSelectCustomer: (customer: Customer | null) => void;
  onExitNavigation?: () => void;
  onCollectPayment?: (customer?: Customer) => void;
  onToggleFollow?: () => void;
  onDisableFollow?: () => void;
  onDirectionsCalculated?: (result: RouteCalculationResult) => void;
  onSelectStopIndex?: (index: number) => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
}

// ─── SVG Marker Builders ────────────────────────────────────────────────────────

function buildConsumerMarkerHtml(
  status: string,
  priority: string | undefined,
  isSelected: boolean,
  sequence?: number,
  meterNumber?: string,
  markerStyle: 'dot' | 'pin' = 'dot'
): string {
  const colorMap: Record<string, string> = {
    overdue: '#ef4444',
    pending: '#f59e0b',
    partially_paid: '#3b82f6',
    paid: '#22c55e',
  };
  const priorityColor = priority === 'critical' ? '#dc2626' : priority === 'high' ? '#f97316' : null;
  const baseColor = isSelected ? '#0284c7' : priorityColor || colorMap[status] || '#f59e0b';

  // 1. Google Maps Minimalist Dot Marker (Matches Google Maps clean aesthetic)
  if (markerStyle === 'dot') {
    return `
      <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        ${isSelected ? `<div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: ${baseColor}; opacity: 0.35; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>` : ''}
        <div style="width: 20px; height: 20px; border-radius: 50%; background: ${baseColor}; border: 3px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.38); display: flex; align-items: center; justify-content: center; transition: transform 0.2s ease-out; ${isSelected ? 'transform: scale(1.25);' : ''}">
          ${sequence !== undefined ? `<span style="color: #ffffff; font-size: 10px; font-weight: 900; font-family: system-ui, sans-serif; line-height: 1;">${sequence}</span>` : ''}
        </div>
      </div>
    `;
  }

  // 2. Full Classic Meter Pin with Badge
  const meterText = meterNumber
    ? meterNumber.startsWith('MTR') ? meterNumber : `MTR-${meterNumber.slice(-6)}`
    : '';

  const pinInner = sequence !== undefined
    ? `<text x="17" y="23" text-anchor="middle" fill="#FFF" font-size="13" font-weight="900" font-family="system-ui, sans-serif">${sequence}</text>`
    : `<circle cx="17" cy="17" r="9" fill="#0F172A"/><path d="M16 9L11 18H16L15 25L21 15H16L17 9Z" fill="${baseColor}"/>`;

  const badgeSvg = meterText
    ? `<rect x="2" y="39" width="70" height="16" rx="4" fill="#0F172A" stroke="#FFF" stroke-width="1.5"/>
       <text x="37" y="50.5" text-anchor="middle" fill="#FFF" font-size="8.5" font-weight="800" font-family="system-ui, sans-serif" letter-spacing="0.2">${meterText}</text>`
    : '';

  const totalH = meterText ? 56 : 40;
  return `
    <div style="position: relative; width: 74px; height: ${totalH}px; cursor: pointer; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">
      <svg width="74" height="${totalH}" viewBox="0 0 74 ${totalH}" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(20,0)">
          <path d="M17 0C7.611 0 0 7.611 0 17C0 29.75 17 38 17 38C17 38 34 29.75 34 17C34 7.611 26.389 0 17 0Z" fill="${baseColor}" stroke="#FFF" stroke-width="2"/>
          ${pinInner}
        </g>
        ${badgeSvg}
      </svg>
    </div>
  `;
}

function buildOfficerMarkerHtml(heading: number | null | undefined): string {
  const rotDeg = heading !== null && heading !== undefined ? heading : 0;
  return `
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <!-- Pulsing Beacon Wave -->
      <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(14, 165, 233, 0.25); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      
      <!-- Directional Arrow / Compass Cone -->
      <div style="position: absolute; width: 48px; height: 48px; transform: rotate(${rotDeg}deg); transition: transform 0.2s ease-out;">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polygon points="24,2 29,14 19,14" fill="#0284c7" stroke="#ffffff" stroke-width="1.5" />
        </svg>
      </div>

      <!-- Center Officer Badge -->
      <div style="position: relative; width: 26px; height: 26px; border-radius: 50%; background: #0284c7; border: 3px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff;"></div>
      </div>
    </div>
  `;
}

// Tile Layer URLs - Google Maps Base Layers with OpenStreetMap Fallback
const TILE_LAYERS: Record<MapLayerType, { url: string; options: any }> = {
  roadmap: {
    url: 'https://{s}.google.com/vt/lyrs=m&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 6,
      updateWhenZooming: false,
    },
  },
  satellite: {
    url: 'https://{s}.google.com/vt/lyrs=s&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 6,
      updateWhenZooming: false,
    },
  },
  hybrid: {
    url: 'https://{s}.google.com/vt/lyrs=y&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 6,
      updateWhenZooming: false,
    },
  },
  terrain: {
    url: 'https://{s}.google.com/vt/lyrs=p&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 6,
      updateWhenZooming: false,
    },
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      keepBuffer: 6,
      updateWhenZooming: false,
    },
  },
};

export default function MapView({
  customers,
  officerCoords,
  officerHeading = null,
  selectedCustomer,
  route,
  multiRoute,
  activeStopIndex = 0,
  navState,
  onSelectCustomer,
  onExitNavigation,
  onCollectPayment,
  onToggleFollow,
  onDisableFollow,
  onDirectionsCalculated,
  onSelectStopIndex,
  isMuted: isMutedProp,
  onToggleMute: onToggleMuteProp,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Leaflet Map & Layer Instances
  const leafletMapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const officerMarkerRef = useRef<any>(null);
  const customerMarkersRef = useRef<Map<string, any>>(new Map());
  const routePolylineCasingRef = useRef<any>(null);
  const routePolylineRef = useRef<any>(null);
  const routeRendererRef = useRef<any>(null);
  const syncRouteRef = useRef<(() => void) | null>(null);
  const lastBearingSyncRef = useRef<number>(0);
  const lastDrawnRouteKeyRef = useRef<string>('');
  const LRef = useRef<any>(null);

  const [mapReady, setMapReady] = useState<boolean>(false);
  const [currentLayer, setCurrentLayer] = useState<MapLayerType>('roadmap');
  const [markerStyle, setMarkerStyle] = useState<'dot' | 'pin'>('dot');
  const [isFollowingInternal, setIsFollowingInternal] = useState<boolean>(false);
  const [currentBearing, setCurrentBearing] = useState<number>(officerHeading || 0);
  const [isMutedInternal, setIsMutedInternal] = useState<boolean>(false);

  const isMuted = isMutedProp !== undefined ? isMutedProp : isMutedInternal;
  const isFollowing = navState?.isFollowing ?? isFollowingInternal;

  const onCollectPaymentRef = useRef(onCollectPayment);
  onCollectPaymentRef.current = onCollectPayment;

  const customersRef = useRef(customers);
  customersRef.current = customers;

  const selectedCustomerRef = useRef(selectedCustomer);
  selectedCustomerRef.current = selectedCustomer;

  const findCustomer = React.useCallback((idOrCustId?: string | null): Customer | undefined => {
    if (!idOrCustId) return selectedCustomerRef.current || undefined;
    const targetId = String(idOrCustId).trim();
    return (
      customersRef.current.find(
        (c) =>
          String(c.customer_id).trim() === targetId ||
          String(c.id).trim() === targetId ||
          String(c.meter_number).trim() === targetId
      ) ||
      selectedCustomerRef.current ||
      undefined
    );
  }, []);

  // Global & Delegated listener for Leaflet popup Collect Payment button
  useEffect(() => {
    (window as any).__mvCollectPayment = (customerId?: string) => {
      const cust = findCustomer(customerId);
      if (cust && onCollectPaymentRef.current) {
        onCollectPaymentRef.current(cust);
      }
    };

    const handleContainerCollectClick = (e: MouseEvent | TouchEvent) => {
      const target = (e.target as HTMLElement)?.closest('[data-collect-customer-id], .leaflet-collect-btn');
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        const customerId = target.getAttribute('data-collect-customer-id') || target.getAttribute('data-meter-number');
        if ((window as any).__mvCollectPayment) {
          (window as any).__mvCollectPayment(customerId || undefined);
        }
      }
    };

    document.addEventListener('click', handleContainerCollectClick, true);
    document.addEventListener('touchend', handleContainerCollectClick, true);
    return () => {
      document.removeEventListener('click', handleContainerCollectClick, true);
      document.removeEventListener('touchend', handleContainerCollectClick, true);
    };
  }, [findCustomer]);

  const handleToggleMute = () => {
    if (onToggleMuteProp) {
      onToggleMuteProp();
    } else {
      setIsMutedInternal((prev) => {
        if (!prev) stopSpeech();
        return !prev;
      });
    }
  };

  // ── 1. Initialize Leaflet 1.9.4 + Leaflet-Rotate 0.2.8 with 2-Finger Touch Rotation ─
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;
    let isMounted = true;
    let cleanUpTouchListeners: (() => void) | null = null;

    async function initLeaflet() {
      try {
        const leafletModule = await import('leaflet');
        const L = (leafletModule as any).default || leafletModule;
        LRef.current = L;

        // Ensure L is globally bound for leaflet-rotate plugin
        if (typeof window !== 'undefined') {
          (window as any).L = L;
        }

        // Load leaflet-rotate plugin
        try {
          if (typeof (L.Map.prototype as any).setBearing !== 'function') {
            await import('leaflet-rotate');
          }
        } catch (rotErr) {
          console.warn('leaflet-rotate dynamic import note:', rotErr);
        }

        // Fallback: If ESM import did not attach setBearing, load pre-bundled UMD script
        if (typeof (L.Map.prototype as any).setBearing !== 'function') {
          try {
            await new Promise<void>((resolve) => {
              const script = document.createElement('script');
              script.src = '/leaflet-rotate.js';
              script.onload = () => resolve();
              script.onerror = () => resolve();
              document.head.appendChild(script);
            });
          } catch (scriptErr) {
            console.warn('leaflet-rotate script note:', scriptErr);
          }
        }

        // ── Patch leaflet-rotate's TouchGestures with rock-solid Math.atan2 math ──
        // This permanently eliminates leaflet-rotate's 180° flip singularity when fingers
        // cross horizontal, allowing silky-smooth 360° two-finger rotation & pinch-zoom simultaneously.
        if ((L.Map as any).TouchGestures) {
          const TGProto = (L.Map as any).TouchGestures.prototype;

          TGProto._onTouchStart = function (e: TouchEvent) {
            const map = this._map;
            if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming || this._rotating) {
              return;
            }

            const p1 = map.mouseEventToContainerPoint(e.touches[0]);
            const p2 = map.mouseEventToContainerPoint(e.touches[1]);

            this._centerPoint = map.getSize()._divideBy(2);
            this._startLatLng = map.containerPointToLatLng(this._centerPoint);

            if (this.zoom) {
              if (map.options.touchZoom !== 'center') {
                this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
              }
              this._startDist = p1.distanceTo(p2);
              this._startZoom = map.getZoom();
              this._zooming = true;
            } else {
              this._zooming = false;
            }

            if (this.rotate) {
              this._startAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
              this._startBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
              this._hasRotatedPastDeadband = false;
              this._rotating = true;
            } else {
              this._rotating = false;
            }

            this._moved = false;
            map._stop();

            L.DomEvent.on(document as any, 'touchmove', this._onTouchMove, this).on(
              document as any,
              'touchend touchcancel',
              this._onTouchEnd,
              this
            );

            L.DomEvent.preventDefault(e);
          };

          TGProto._onTouchMove = function (e: TouchEvent) {
            if (!e.touches || e.touches.length !== 2 || !(this._zooming || this._rotating)) {
              return;
            }

            const map = this._map;
            const p1 = map.mouseEventToContainerPoint(e.touches[0]);
            const p2 = map.mouseEventToContainerPoint(e.touches[1]);
            const scale = p1.distanceTo(p2) / (this._startDist || 1);

            let newBearing: number | null = null;
            if (this._rotating && typeof map.setBearing === 'function') {
              const currentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
              let angleDelta = currentAngle - this._startAngle;
              if (angleDelta > 180) angleDelta -= 360;
              if (angleDelta < -180) angleDelta += 360;

              // 1.0 degree deadband: ensures pure pinch-zoom gestures don't micro-wobble the map angle
              if (!this._hasRotatedPastDeadband) {
                if (Math.abs(angleDelta) > 1.0) {
                  this._hasRotatedPastDeadband = true;
                }
              }
              if (this._hasRotatedPastDeadband) {
                newBearing = this._startBearing + angleDelta;
              }
            }

            if (this._zooming) {
              this._zoom = map.getScaleZoom(scale, this._startZoom);
              if (
                !map.options.bounceAtZoomLimits &&
                ((this._zoom < map.getMinZoom() && scale < 1) || (this._zoom > map.getMaxZoom() && scale > 1))
              ) {
                this._zoom = map._limitZoom(this._zoom);
              }

              if (map.options.touchZoom === 'center') {
                this._center = this._startLatLng;
                if (scale === 1 && newBearing === null) return;
              } else {
                const delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
                if (scale === 1 && delta.x === 0 && delta.y === 0 && newBearing === null) return;
                const currentMapBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
                const alpha = -(newBearing !== null ? newBearing : currentMapBearing) * (L as any).DomUtil.DEG_TO_RAD;
                this._center = map.unproject(map.project(this._pinchStartLatLng).subtract(delta.rotate(alpha)));
              }
            }

            if (!this._moved) {
              map._moveStart(true, false);
              this._moved = true;
            }

            (L as any).Util.cancelAnimFrame(this._animRequest);
            const moveFn = () => {
              if (newBearing !== null && typeof map.setBearing === 'function') {
                map.setBearing(newBearing);
              }
              map._move(this._center, this._zoom, { pinch: true, round: false }, undefined);
            };
            this._animRequest = (L as any).Util.requestAnimFrame(moveFn, this, true);

            L.DomEvent.preventDefault(e);
          };

          TGProto._onTouchEnd = function () {
            if (!this._moved || !(this._zooming || this._rotating)) {
              this._zooming = false;
              this._rotating = false;
              return;
            }

            this._zooming = false;
            this._rotating = false;
            (L as any).Util.cancelAnimFrame(this._animRequest);

            L.DomEvent.off(document as any, 'touchmove', this._onTouchMove, this).off(
              document as any,
              'touchend touchcancel',
              this._onTouchEnd,
              this
            );

            if (this.zoom) {
              if (this._map.options.zoomAnimation) {
                this._map._animateZoom(this._center, this._map._limitZoom(this._zoom), true, this._map.options.zoomSnap);
              } else {
                this._map._resetView(this._center, this._map._limitZoom(this._zoom));
              }
            }
          };
        }

        // Patch L.Renderer._updateTransform so SVG route polylines scale smoothly without drift during zoom animation
        if (L && (L as any).Renderer) {
          const rendererProto = (L as any).Renderer.prototype;
          if (rendererProto) {
            rendererProto._updateTransform = function (center: any, zoom: number) {
              if (!this._map) return;
              const scale = this._map.getZoomScale(zoom, this._zoom);
              const position = (L as any).DomUtil.getPosition(this._container) || new (L as any).Point(0, 0);
              (L as any).DomUtil.setTransform(this._container, position, scale);
            };
          }
        }

        // ── Circumscribed Tile Bounds (Eliminates Blank Corners on Rotated Maps) ──
        // When a map is rotated, the viewport's corners reach out to the diagonal circle D = sqrt(w^2 + h^2).
        // By default, Leaflet only requests an upright W x H tile box, which leaves rotated corners blank!
        // We compute the circumscribed square with 1.25 overscan so 100% of the screen is covered at any angle.
        if (L && (L as any).GridLayer) {
          const gridLayerProto = (L as any).GridLayer.prototype;
          gridLayerProto._getTiledPixelBounds = function (center: any) {
            const map = this._map;
            if (!map) return new (L as any).Bounds([0, 0], [0, 0]);

            center = center || map.getCenter();
            const mapZoom = map._animatingZoom ? Math.max(map._animateToZoom, map.getZoom()) : map.getZoom();
            const scale = map.getZoomScale(mapZoom, this._tileZoom);
            const pixelCenter = map.project(center, this._tileZoom).floor();
            const size = map.getSize();

            const diagonal = Math.sqrt(size.x * size.x + size.y * size.y);
            const halfDim = Math.ceil(((diagonal / 2) * 1.25) / (scale || 1));
            const halfSize = new (L as any).Point(halfDim, halfDim);

            return new (L as any).Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize));
          };
        }

        // Patch Map._getNewPixelBounds and center-pivot coordinate transforms
        if (L && (L.Map as any).prototype) {
          const mapProto = (L.Map as any).prototype;
          mapProto._getNewPixelBounds = function (center: any, zoom: number) {
            center = center || this.getCenter();
            zoom = zoom || this.getZoom();
            const mapZoom = this._animatingZoom ? Math.max(this._animateToZoom, this.getZoom()) : this.getZoom();
            const scale = this.getZoomScale(mapZoom, zoom);
            const pixelCenter = this.project(center, zoom).floor();
            const size = this.getSize();
            const diagonal = Math.sqrt(size.x * size.x + size.y * size.y);
            const halfDim = Math.ceil(((diagonal / 2) * 1.25) / (scale || 1));
            const halfSize = new (L as any).Point(halfDim, halfDim);

            return new (L as any).Bounds(pixelCenter.subtract(halfSize), pixelCenter.add(halfSize));
          };

          const origContainerToLayer = mapProto.containerPointToLayerPoint;
          const origLayerToContainer = mapProto.layerPointToContainerPoint;

          mapProto.containerPointToLayerPoint = function (point: any) {
            if (!this._rotate || !this._bearing) {
              return origContainerToLayer ? origContainerToLayer.apply(this, arguments) : point;
            }
            const pt = (L as any).point(point);
            const mapPanePos = typeof this._getMapPanePos === 'function' ? this._getMapPanePos() : new (L as any).Point(0, 0);
            const center = typeof this._getPixelCenter === 'function' ? this._getPixelCenter() : this.getSize().divideBy(2);
            return pt.subtract(mapPanePos).subtract(center).rotate(-this._bearing).add(center);
          };

          mapProto.layerPointToContainerPoint = function (point: any) {
            if (!this._rotate || !this._bearing) {
              return origLayerToContainer ? origLayerToContainer.apply(this, arguments) : point;
            }
            const pt = (L as any).point(point);
            const mapPanePos = typeof this._getMapPanePos === 'function' ? this._getMapPanePos() : new (L as any).Point(0, 0);
            const center = typeof this._getPixelCenter === 'function' ? this._getPixelCenter() : this.getSize().divideBy(2);
            return pt.subtract(center).rotate(this._bearing).add(center).add(mapPanePos);
          };
        }

        if (!isMounted || !mapContainerRef.current || leafletMapRef.current) return;

        const defaultLat = officerCoords?.latitude ?? 21.1458;
        const defaultLng = officerCoords?.longitude ?? 79.0882;

        // Initialize Leaflet map with continuous 360° rotation and fluid non-quantized zoom
        const map = (L as any).map(mapContainerRef.current, {
          center: [defaultLat, defaultLng],
          zoom: 16,
          rotate: true,
          bearing: officerHeading || 0,
          touchRotate: true,
          touchZoom: true,
          zoomSnap: 0, // Continuous fractional zoom - eliminates chunky integer snapping
          zoomDelta: 0.5, // Refined 0.5 zoom steps for + / - buttons
          wheelPxPerZoomLevel: 120, // Gentle, controlled trackpad & wheel zooming
          zoomAnimation: true, // Hardware-accelerated CSS tile scaling during zoom
          zoomAnimationThreshold: 4,
          fadeAnimation: true,
          markerZoomAnimation: true,
          shiftKeyRotate: true,
          rotateControl: false,
          zoomControl: false,
          attributionControl: false,
        });

        // Initialize the renderer used for route polylines.
        // SVG (not Canvas) is deliberate: the SVG root lives in the rotated overlayPane and its
        // geometry is expressed in layer coordinates, so it inherits the exact same CSS transform
        // as the tiles. A Canvas renderer instead bakes rotation into its own b.min/ctx.translate
        // bookkeeping, which is what let the route drift away from the roads on zoom.
        routeRendererRef.current = (L as any).svg({ padding: 0.5 });

        // Keep routes locked to the tiles. leaflet-rotate only ever emits `rotate`
        // (there is no `rotateend` in v0.2.8), so sync on `rotate` + the usual move/zoom events.
        let lastSyncTime = 0;
        const syncRoute = () => {
          const now = performance.now();
          if (now - lastSyncTime < 32) return;
          lastSyncTime = now;
          if (routePolylineRef.current && typeof routePolylineRef.current.redraw === 'function') {
            routePolylineRef.current.redraw();
          }
          if (routePolylineCasingRef.current && typeof routePolylineCasingRef.current.redraw === 'function') {
            routePolylineCasingRef.current.redraw();
          }
        };

        const syncRouteImmediate = () => {
          if (routePolylineRef.current && typeof routePolylineRef.current.redraw === 'function') {
            routePolylineRef.current.redraw();
          }
          if (routePolylineCasingRef.current && typeof routePolylineCasingRef.current.redraw === 'function') {
            routePolylineCasingRef.current.redraw();
          }
        };

        map.on('rotate', syncRoute);
        map.on('zoomend', syncRouteImmediate);
        map.on('moveend', syncRouteImmediate);
        map.on('viewreset', syncRouteImmediate);
        syncRouteRef.current = syncRouteImmediate;

        // Set tile layer
        const layerConfig = TILE_LAYERS['roadmap'];
        tileLayerRef.current = L.tileLayer(layerConfig.url, layerConfig.options).addTo(map);

        // Sync bearing state so the compass stays accurate.
        // The plugin emits `rotate` on every setBearing() call, so throttle the React state
        // update to keep the UI responsive during a continuous LERP rotation.
        map.on('rotate', () => {
          const now = performance.now();
          if (now - lastBearingSyncRef.current < 100) return;
          lastBearingSyncRef.current = now;
          const bearing = typeof (map as any).getBearing === 'function' ? (map as any).getBearing() : 0;
          setCurrentBearing(bearing);
        });

        map.on('dragstart', () => {
          if (onDisableFollow) onDisableFollow();
          setIsFollowingInternal(false);
        });

        // Direct Leaflet map event binding for Collect Payment popup button
        map.on('popupopen', (e: any) => {
          const popupElement = e.popup?.getElement();
          if (!popupElement) return;

          const btn = popupElement.querySelector('.leaflet-collect-btn, [data-collect-customer-id]');
          if (btn) {
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.disableScrollPropagation(btn);

            const handleBtnAction = (ev: Event) => {
              L.DomEvent.stopPropagation(ev);
              L.DomEvent.preventDefault(ev);
              const custId = btn.getAttribute('data-collect-customer-id') || btn.getAttribute('data-meter-number');
              const cust = findCustomer(custId);
              if (cust && onCollectPaymentRef.current) {
                onCollectPaymentRef.current(cust);
              }
            };

            L.DomEvent.off(btn, 'click', handleBtnAction);
            L.DomEvent.on(btn, 'click', handleBtnAction);
            L.DomEvent.off(btn, 'touchend', handleBtnAction);
            L.DomEvent.on(btn, 'touchend', handleBtnAction);
          }
        });

        // ── Desktop Shift+Drag or Alt+Drag smooth rotate ──
        const container = mapContainerRef.current;
        let isShiftDragging = false;
        let lastShiftX = 0;
        let shiftTargetBearing = 0;
        let shiftRenderBearing = 0;
        let shiftRafId: number | null = null;
        let lastShiftUiSync = 0;

        const stepShiftRotation = () => {
          let diff = shiftTargetBearing - shiftRenderBearing;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;

          if (!isShiftDragging && Math.abs(diff) < 0.2) {
            shiftRenderBearing = shiftTargetBearing;
            if (typeof map.setBearing === 'function') {
              map.setBearing(shiftRenderBearing);
            }
            shiftRafId = null;
            return;
          }

          shiftRenderBearing = (shiftRenderBearing + diff * 0.42 + 360) % 360;
          if (typeof map.setBearing === 'function') {
            map.setBearing(shiftRenderBearing);
          }

          shiftRafId = requestAnimationFrame(stepShiftRotation);
        };

        const handleMouseDown = (e: MouseEvent) => {
          if (e.shiftKey || e.altKey) {
            isShiftDragging = true;
            lastShiftX = e.clientX;
            const liveBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
            shiftTargetBearing = liveBearing;
            shiftRenderBearing = liveBearing;
            e.preventDefault();
          }
        };

        const handleMouseMove = (e: MouseEvent) => {
          if (isShiftDragging) {
            const dx = e.clientX - lastShiftX;
            lastShiftX = e.clientX;
            shiftTargetBearing = (shiftTargetBearing + dx * 0.45 + 360) % 360;

            if (!shiftRafId) {
              shiftRafId = requestAnimationFrame(stepShiftRotation);
            }

            const now = performance.now();
            if (now - lastShiftUiSync > 100) {
              lastShiftUiSync = now;
              setCurrentBearing(shiftTargetBearing);
            }
          }
        };

        const handleMouseUp = () => {
          if (isShiftDragging) {
            isShiftDragging = false;
            const finalBearing = typeof map.getBearing === 'function' ? map.getBearing() : shiftTargetBearing;
            setCurrentBearing(finalBearing);
          }
        };

        if (container) {
          container.addEventListener('mousedown', handleMouseDown);
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);

          cleanUpTouchListeners = () => {
            container.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
          };
        }

        leafletMapRef.current = map;
        setMapReady(true);
      } catch (err) {
        console.error('Failed to initialize Leaflet Map:', err);
      }
    }

    initLeaflet();

    return () => {
      isMounted = false;
      if (cleanUpTouchListeners) cleanUpTouchListeners();
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  // ── 2. Handle Layer Switching ────────────────────────────────────────────────
  const handleSelectLayer = (layer: MapLayerType) => {
    setCurrentLayer(layer);
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const cfg = TILE_LAYERS[layer] || TILE_LAYERS['roadmap'];
    tileLayerRef.current = L.tileLayer(cfg.url, cfg.options).addTo(map);
  };

  // ── 3. Reset North (0° Bearing) ──────────────────────────────────────────────
  const handleResetNorth = () => {
    const map = leafletMapRef.current;
    if (!map) return;
    if (typeof (map as any).setBearing === 'function') {
      const pane = mapContainerRef.current?.querySelector('.leaflet-rotate-pane');
      if (pane) {
        pane.classList.add('leaflet-rotating-smooth');
      }
      (map as any).setBearing(0);
      setCurrentBearing(0);
      setTimeout(() => {
        pane?.classList.remove('leaflet-rotating-smooth');
      }, 400);
    }
  };

  // ── 4. Zoom Controls ─────────────────────────────────────────────────────────
  const handleZoomIn = () => leafletMapRef.current?.zoomIn();
  const handleZoomOut = () => leafletMapRef.current?.zoomOut();

  // ── 5. Fit All Assigned Meters ───────────────────────────────────────────────
  const handleFitBounds = useCallback(() => {
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L || !customers.length) return;

    const latLngs = customers
      .filter((c) => c.latitude && c.longitude && !isNaN(c.latitude) && !isNaN(c.longitude))
      .map((c) => [c.latitude, c.longitude]);

    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      if (officerCoords) {
        bounds.extend([officerCoords.latitude, officerCoords.longitude]);
      }
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [customers, officerCoords]);

  // ── 6. Update Officer GPS Marker & Follow-Me with 360° Rotation ──────────────
  useEffect(() => {
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L || !officerCoords) return;

    const pos: [number, number] = [officerCoords.latitude, officerCoords.longitude];

    const officerIcon = L.divIcon({
      html: buildOfficerMarkerHtml(officerHeading),
      className: 'officer-marker-div',
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    if (!officerMarkerRef.current) {
      officerMarkerRef.current = L.marker(pos, { icon: officerIcon, zIndexOffset: 2000 }).addTo(map);
    } else {
      officerMarkerRef.current.setLatLng(pos);
      officerMarkerRef.current.setIcon(officerIcon);
    }

    // Follow-Me & 360° Rotate bearing update
    if (isFollowing) {
      map.panTo(pos, { animate: true, duration: 0.5 });
      if (typeof (map as any).setBearing === 'function' && officerHeading !== null && officerHeading !== undefined) {
        (map as any).setBearing(officerHeading);
        setCurrentBearing(officerHeading);
      }
    }
  }, [mapReady, officerCoords, officerHeading, isFollowing]);

  // ── 7. Render Consumer Markers & Popups ───────────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L) return;

    const currentIds = new Set(customers.map((c) => c.customer_id));

    // Remove stale markers
    customerMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        customerMarkersRef.current.delete(id);
      }
    });

    customers.forEach((customer) => {
      if (!customer.latitude || !customer.longitude) return;

      const isSelected = selectedCustomer?.customer_id === customer.customer_id;
      const multiStop = multiRoute?.stops?.find((s) => s.customer_id === customer.customer_id);
      const isCurrentStop = multiStop && (multiStop.sequence - 1) === activeStopIndex;
      const isDot = markerStyle === 'dot';

      const markerHtml = buildConsumerMarkerHtml(
        customer.status,
        customer.priority,
        isSelected || !!isCurrentStop,
        multiStop?.sequence,
        customer.meter_number,
        markerStyle
      );

      const icon = L.divIcon({
        html: markerHtml,
        className: 'customer-marker-div',
        iconSize: isDot ? [32, 32] : [74, customer.meter_number ? 56 : 40],
        iconAnchor: isDot ? [16, 16] : [37, 38],
      });

      const pos: [number, number] = [customer.latitude, customer.longitude];
      let marker = customerMarkersRef.current.get(customer.customer_id);

      const rawPendingDays = customer.pending_days ?? (customer as any)['pending days'] ?? (customer as any).days;
      const daysText = rawPendingDays !== undefined && rawPendingDays !== null ? `${rawPendingDays} Days` : '-';
      const isHighPending = Number(rawPendingDays) > 30;

      const safeId = String(customer.customer_id || customer.id || customer.meter_number || '').replace(/['"\\`]/g, '');

      const popupHtml = `
        <div style="min-width: 210px; max-width: 250px; padding: 12px; font-family: system-ui, sans-serif;">
          <div style="margin-bottom: 6px;">
            <div style="font-weight: 800; font-size: 13px; color: #f8fafc; line-height: 1.2;">${customer.name}</div>
            <div style="font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 2px;">
              Meter: <span style="color: #38bdf8; font-family: monospace; font-weight: 800;">${customer.meter_number}</span>
            </div>
            ${customer.dtc_code ? `<div style="font-size: 10px; color: #cbd5e1;">DTC: <span style="color: #fbbf24; font-weight: 700;">${customer.dtc_code}</span></div>` : ''}
          </div>

          <div style="margin: 6px 0; padding: 6px 8px; background: ${isHighPending ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)'}; border: 1px solid ${isHighPending ? '#ef4444' : '#22c55e'}; border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 9.5px; color: #e2e8f0; font-weight: 800; text-transform: uppercase;">Pending Days</span>
            <span style="font-size: 12px; font-weight: 900; color: ${isHighPending ? '#f87171' : '#4ade80'};">${daysText}</span>
          </div>

          <div style="margin: 6px 0 8px; padding: 6px 8px; background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 9.5px; color: #fde68a; font-weight: 800; text-transform: uppercase;">Outstanding</span>
            <span style="font-size: 13px; font-weight: 900; color: #fbbf24;">₹${customer.pending_amount.toLocaleString('en-IN')}</span>
          </div>

          <button
            id="leaflet-collect-btn-${safeId}"
            class="leaflet-collect-btn"
            data-collect-customer-id="${customer.customer_id || customer.id || customer.meter_number}"
            data-meter-number="${customer.meter_number || ''}"
            type="button"
            onclick="if (event) { event.preventDefault(); event.stopPropagation(); } if (window.__mvCollectPayment) { window.__mvCollectPayment('${safeId}'); }"
            style="width: 100%; padding: 8px 10px; background: #059669; color: #ffffff; border: none; border-radius: 6px; font-weight: 800; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: background 0.2s; -webkit-tap-highlight-color: transparent;"
            onmouseover="this.style.background='#047857'"
            onmouseout="this.style.background='#059669'"
          >
            Collect Payment
          </button>
        </div>
      `;

      if (marker) {
        marker.setLatLng(pos);
        marker.setIcon(icon);
        marker.setZIndexOffset(isSelected || isCurrentStop ? 1000 : 100);
        marker.getPopup()?.setContent(popupHtml);

        // Immediately re-bind direct click handler if popup is already open
        setTimeout(() => {
          const btn = document.getElementById(`leaflet-collect-btn-${safeId}`);
          if (btn) {
            btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onCollectPaymentRef.current) onCollectPaymentRef.current(customer);
            };
          }
        }, 0);
      } else {
        marker = L.marker(pos, { icon, zIndexOffset: isSelected || isCurrentStop ? 1000 : 100 }).addTo(map);

        const popup = L.popup({
          offset: isDot ? [0, -14] : [0, -32],
          closeButton: true,
          className: 'leaflet-custom-popup',
        }).setContent(popupHtml);

        marker.bindPopup(popup);

        marker.on('click', () => {
          onSelectCustomer(customer);
          speakInstruction(customer.name, isMuted);
        });

        marker.on('popupopen', () => {
          setTimeout(() => {
            const btn = document.getElementById(`leaflet-collect-btn-${safeId}`);
            if (btn) {
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onCollectPaymentRef.current) onCollectPaymentRef.current(customer);
              };
            }
          }, 0);
        });

        customerMarkersRef.current.set(customer.customer_id, marker);
      }

      if (isSelected) {
        marker.openPopup();
      }
    });
  }, [mapReady, customers, selectedCustomer, multiRoute, activeStopIndex, isMuted, onSelectCustomer, onCollectPayment, markerStyle]);

  // ── 8. Draw OSRM Polyline Routes on Leaflet (Flicker-Free & Glitch-Free) ─────
  useEffect(() => {
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L) return;

    const activePath = multiRoute?.coordinates_path?.length
      ? multiRoute.coordinates_path
      : route?.coordinates_path?.length
      ? route.coordinates_path
      : null;

    if (!activePath || activePath.length < 2) {
      if (routePolylineCasingRef.current) {
        map.removeLayer(routePolylineCasingRef.current);
        routePolylineCasingRef.current = null;
      }
      if (routePolylineRef.current) {
        map.removeLayer(routePolylineRef.current);
        routePolylineRef.current = null;
      }
      lastDrawnRouteKeyRef.current = '';
      return;
    }

    const routeKey = `${activePath.length}_${activePath[0]?.latitude.toFixed(5)}_${activePath[activePath.length - 1]?.latitude.toFixed(5)}`;
    const latLngs = activePath.map((p) => [p.latitude, p.longitude]);

    // If the exact same route is already rendered, do nothing (never delete/recreate during rotation)
    if (routePolylineRef.current && routePolylineCasingRef.current && routeKey === lastDrawnRouteKeyRef.current) {
      return;
    }

    const isNewRoute = routeKey !== lastDrawnRouteKeyRef.current;
    lastDrawnRouteKeyRef.current = routeKey;

    if (routePolylineRef.current && routePolylineCasingRef.current) {
      // Update coordinates on existing layers without DOM teardown
      routePolylineCasingRef.current.setLatLngs(latLngs);
      routePolylineRef.current.setLatLngs(latLngs);
      if (typeof routePolylineRef.current.redraw === 'function') {
        routePolylineRef.current.redraw();
      }
      if (typeof routePolylineCasingRef.current.redraw === 'function') {
        routePolylineCasingRef.current.redraw();
      }
    } else {
      if (!routeRendererRef.current && L) {
        routeRendererRef.current = (L as any).svg({ padding: 0.5 });
      }

      // Create new polyline layers sharing one SVG renderer bound to the rotated overlay pane
      routePolylineCasingRef.current = L.polyline(latLngs, {
        color: '#0284c7',
        weight: 8,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
        renderer: routeRendererRef.current,
      }).addTo(map);

      routePolylineRef.current = L.polyline(latLngs, {
        color: '#38bdf8',
        weight: 4.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        renderer: routeRendererRef.current,
      }).addTo(map);
    }

    // Auto-fit bounds ONLY once when a new route is received, never during rotation or dragging
    if (isNewRoute) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
    }
  }, [mapReady, route, multiRoute]);

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden bg-slate-950">
      {/* Leaflet Map Canvas with 360° Two-Finger Rotation */}
      <div
        ref={mapContainerRef}
        className="w-full h-full z-0 outline-none select-none"
        style={{ touchAction: 'none' }}
        tabIndex={0}
      />

      {/* Floating 360° Compass & Map Controls */}
      <div className="absolute right-4 bottom-6 z-20 flex flex-col items-end gap-2">
        <MapControls
          currentLayer={currentLayer}
          markerStyle={markerStyle}
          onToggleMarkerStyle={() => setMarkerStyle((prev) => (prev === 'dot' ? 'pin' : 'dot'))}
          isFollowing={isFollowing}
          officerHeading={currentBearing}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          onToggleFollow={onToggleFollow || (() => setIsFollowingInternal((prev) => !prev))}
          onSelectLayer={handleSelectLayer}
          onFitBounds={handleFitBounds}
          onResetNorth={handleResetNorth}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      </div>

      {/* Active Navigation Panel (Turn-by-turn guidance from OSRM) */}
      {navState && navState.active && (
        <div className="absolute bottom-6 left-4 right-4 md:left-6 md:right-auto md:w-96 z-30 animate-in slide-in-from-bottom-4 duration-300">
          <NavigationPanel
            navState={navState}
            onExitNavigation={onExitNavigation || (() => {})}
            onCollectPayment={() => onCollectPayment && onCollectPayment(navState.targetCustomer)}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
          />
        </div>
      )}
    </div>
  );
}
