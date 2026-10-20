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
import { Compass } from 'lucide-react';

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
  meterNumber?: string
): string {
  const colorMap: Record<string, string> = {
    overdue: '#ef4444',
    pending: '#f59e0b',
    partially_paid: '#3b82f6',
    paid: '#10b981',
  };
  const priorityColor = priority === 'critical' ? '#dc2626' : priority === 'high' ? '#ea580c' : null;
  const baseColor = isSelected ? '#0284c7' : priorityColor || colorMap[status] || '#64748b';

  // Highlighted Selected State (Elevated with glowing beacon halo and meter number pill badge)
  if (isSelected) {
    const meterText = meterNumber
      ? meterNumber.startsWith('MTR') ? meterNumber : `MTR-${meterNumber.slice(-6)}`
      : '';
    return `
      <div style="position: relative; width: 74px; height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; cursor: pointer;">
        <!-- Pulsing beacon halo -->
        <div style="position: absolute; top: 0px; width: 34px; height: 34px; border-radius: 50%; background: rgba(14, 165, 233, 0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
        
        <!-- Center Focus Pin -->
        <div style="position: relative; width: 28px; height: 28px; border-radius: 50%; background: #0284c7; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(14, 165, 233, 0.9), 0 3px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-family: system-ui, sans-serif; font-size: 12px;">
          ${sequence !== undefined
            ? sequence
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`}
        </div>

        ${meterText ? `
          <div style="margin-top: 3px; padding: 2px 6px; background: #0f172a; border: 1.5px solid #ffffff; border-radius: 4px; color: #ffffff; font-size: 9px; font-weight: 800; font-family: monospace; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.5); letter-spacing: 0.2px;">
            ${meterText}
          </div>
        ` : ''}
      </div>
    `;
  }

  // Small compact icon for ALL meters on the map (clean, clutter-free, high-performance)
  const isNumbered = sequence !== undefined;
  const size = isNumbered ? 22 : 18;
  return `
    <div style="position: relative; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.15s ease-out;">
      <div style="width: ${size}px; height: ${size}px; border-radius: 50%; background: ${baseColor}; border: 2px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; font-family: system-ui, sans-serif; font-size: ${isNumbered ? '10px' : '8px'};">
        ${isNumbered
          ? sequence
          : `<svg width="8" height="8" viewBox="0 0 24 24" fill="#ffffff"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`}
      </div>
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

// Tile Layer URLs (Google Maps style as requested)
const TILE_LAYERS: Record<MapLayerType, { url: string; options: any }> = {
  roadmap: {
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 2,
      updateWhenIdle: true,
      updateInterval: 150,
    },
  },
  satellite: {
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 2,
      updateWhenIdle: true,
      updateInterval: 150,
    },
  },
  hybrid: {
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 2,
      updateWhenIdle: true,
      updateInterval: 150,
    },
  },
  terrain: {
    url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3'],
      attribution: '&copy; Google Maps',
      keepBuffer: 2,
      updateWhenIdle: true,
      updateInterval: 150,
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
  const clusterMarkersRef = useRef<Map<string, any>>(new Map());
  const markerStateCacheRef = useRef<Map<string, string>>(new Map());
  const routePolylineCasingRef = useRef<any>(null);
  const routePolylineRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const [mapReady, setMapReady] = useState<boolean>(false);
  const [currentLayer, setCurrentLayer] = useState<MapLayerType>('roadmap');
  const [isFollowingInternal, setIsFollowingInternal] = useState<boolean>(false);
  const [currentBearing, setCurrentBearing] = useState<number>(officerHeading || 0);
  const [currentZoom, setCurrentZoom] = useState<number>(16);
  const [clusterTick, setClusterTick] = useState<number>(0);
  const [isMutedInternal, setIsMutedInternal] = useState<boolean>(false);

  const isMuted = isMutedProp !== undefined ? isMutedProp : isMutedInternal;
  const isFollowing = navState?.isFollowing ?? isFollowingInternal;

  const onCollectPaymentRef = useRef(onCollectPayment);
  onCollectPaymentRef.current = onCollectPayment;

  const customersRef = useRef(customers);
  customersRef.current = customers;

  // Global & Delegated listener for Leaflet popup Collect Payment button
  useEffect(() => {
    (window as any).__mvCollectPayment = (customerId: string) => {
      const cust = customersRef.current.find((c) => c.customer_id === customerId);
      if (cust && onCollectPaymentRef.current) {
        onCollectPaymentRef.current(cust);
      }
    };

    const container = mapContainerRef.current;
    if (!container) return;

    const handleContainerCollectClick = (e: MouseEvent | TouchEvent) => {
      const target = (e.target as HTMLElement)?.closest('[data-collect-customer-id]');
      if (target) {
        e.stopPropagation();
        const customerId = target.getAttribute('data-collect-customer-id');
        if (customerId && (window as any).__mvCollectPayment) {
          (window as any).__mvCollectPayment(customerId);
        }
      }
    };

    container.addEventListener('click', handleContainerCollectClick, true);
    return () => {
      container.removeEventListener('click', handleContainerCollectClick, true);
      delete (window as any).__mvCollectPayment;
    };
  }, []);

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
          await import('leaflet-rotate');
        } catch (rotErr) {
          console.warn('Leaflet-Rotate plugin note:', rotErr);
        }

        if (!isMounted || !mapContainerRef.current || leafletMapRef.current) return;

        const defaultLat = officerCoords?.latitude ?? 21.1458;
        const defaultLng = officerCoords?.longitude ?? 79.0882;

        // Initialize Leaflet map with 360° rotation enabled
        const map = (L as any).map(mapContainerRef.current, {
          center: [defaultLat, defaultLng],
          zoom: 16,
          rotate: true,
          bearing: officerHeading || 0,
          touchRotate: false, // Managed by our high-performance RAF gesture controller
          touchZoom: true,
          shiftKeyRotate: true,
          rotateControl: false,
          zoomControl: false,
          attributionControl: false,
        });

        // Set tile layer
        const layerConfig = TILE_LAYERS['roadmap'];
        tileLayerRef.current = L.tileLayer(layerConfig.url, layerConfig.options).addTo(map);

        // Sync bearing on rotateend to avoid thrashing React state on every frame
        map.on('rotateend', () => {
          const bearing = typeof (map as any).getBearing === 'function' ? (map as any).getBearing() : 0;
          setCurrentBearing(bearing);
        });

        map.on('dragstart', () => {
          if (onDisableFollow) onDisableFollow();
          setIsFollowingInternal(false);
        });

        // Track zoom and movement to dynamically compute marker clustering
        map.on('zoomend', () => {
          setCurrentZoom(map.getZoom());
          setClusterTick((t) => t + 1);
        });

        map.on('moveend', () => {
          setClusterTick((t) => t + 1);
        });

        // ── Ultra-Smooth 2-Finger Touch Rotation (Google Maps LERP Pipeline) ──
        const container = mapContainerRef.current;
        let isTwoFingerGesture = false;
        let isTwoFingerRotating = false;
        let initialDistance = 0;
        let initialAngle = 0;
        let lastTouchAngle = 0;
        let targetBearing = officerHeading || 0;
        let currentRenderBearing = targetBearing;
        let touchRafId: number | null = null;
        let lastTouchUiSync = 0;

        const calcTouchAngle = (t1: Touch, t2: Touch): number => {
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          return Math.atan2(dy, dx) * (180 / Math.PI);
        };

        const calcTouchDist = (t1: Touch, t2: Touch): number => {
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          return Math.hypot(dx, dy);
        };

        const stepRotation = () => {
          let diff = targetBearing - currentRenderBearing;
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;

          // If almost reached target and fingers lifted, snap and complete
          if (!isTwoFingerRotating && Math.abs(diff) < 0.2) {
            currentRenderBearing = targetBearing;
            if (typeof map.setBearing === 'function') {
              map.setBearing(currentRenderBearing);
            }
            touchRafId = null;
            return;
          }

          // LERP damping factor (0.42) produces continuous, fluid rotation without jitter
          currentRenderBearing = (currentRenderBearing + diff * 0.42 + 360) % 360;
          if (typeof map.setBearing === 'function') {
            map.setBearing(currentRenderBearing);
          }

          touchRafId = requestAnimationFrame(stepRotation);
        };

        const handleTouchStart = (e: TouchEvent) => {
          if (e.touches.length === 2) {
            isTwoFingerGesture = true;
            isTwoFingerRotating = false;
            initialDistance = calcTouchDist(e.touches[0], e.touches[1]);
            initialAngle = calcTouchAngle(e.touches[0], e.touches[1]);
            lastTouchAngle = initialAngle;
            const liveBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
            targetBearing = liveBearing;
            currentRenderBearing = liveBearing;
          } else {
            isTwoFingerGesture = false;
            isTwoFingerRotating = false;
          }
        };

        const handleTouchMove = (e: TouchEvent) => {
          if (isTwoFingerGesture && e.touches.length === 2) {
            const currentDist = calcTouchDist(e.touches[0], e.touches[1]);
            const currentAngle = calcTouchAngle(e.touches[0], e.touches[1]);

            let totalAngleDelta = Math.abs(currentAngle - initialAngle);
            if (totalAngleDelta > 180) totalAngleDelta = 360 - totalAngleDelta;
            const distChange = Math.abs(currentDist - initialDistance);

            // If user is pinch-zooming (finger distance changing), do NOT hijack rotation!
            // Let Leaflet touchZoom handle zoom smoothly and naturally.
            if (!isTwoFingerRotating && distChange > 16) {
              return;
            }

            // Only activate intentional two-finger twist rotation when angle changes significantly
            if (!isTwoFingerRotating) {
              if (totalAngleDelta > 12 && (totalAngleDelta > distChange * 0.2 || distChange < 25)) {
                isTwoFingerRotating = true;
                if (map.dragging && map.dragging.enabled()) {
                  map.dragging.disable();
                }
              } else {
                return;
              }
            }

            if (isTwoFingerRotating) {
              if (e.cancelable) {
                e.preventDefault();
              }

              let delta = currentAngle - lastTouchAngle;
              if (delta > 180) delta -= 360;
              if (delta < -180) delta += 360;
              lastTouchAngle = currentAngle;

              // Clockwise finger twist increases bearing (rotates right)
              targetBearing = (targetBearing + delta + 360) % 360;

              if (!touchRafId) {
                touchRafId = requestAnimationFrame(stepRotation);
              }
            }
          }
        };

        const handleTouchEnd = (e: TouchEvent) => {
          if (e.touches.length < 2) {
            if (isTwoFingerRotating) {
              isTwoFingerRotating = false;
              if (map.dragging && !map.dragging.enabled()) {
                map.dragging.enable();
              }
              let finalBearing = typeof map.getBearing === 'function' ? map.getBearing() : targetBearing;
              // Snap to North if near 0° or 360° within 4 degrees
              if (finalBearing < 4 || finalBearing > 356) {
                finalBearing = 0;
                targetBearing = 0;
                if (typeof map.setBearing === 'function') {
                  map.setBearing(0);
                }
              }
              setCurrentBearing(Math.round(finalBearing));
            }
            isTwoFingerGesture = false;
          }
        };

        // Desktop Shift+Drag or Alt+Drag smooth rotate
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
          container.addEventListener('touchstart', handleTouchStart, { passive: true });
          container.addEventListener('touchmove', handleTouchMove, { passive: false });
          container.addEventListener('touchend', handleTouchEnd, { passive: true });
          container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
          container.addEventListener('mousedown', handleMouseDown);
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);

          cleanUpTouchListeners = () => {
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
            container.removeEventListener('touchcancel', handleTouchEnd);
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
      clusterMarkersRef.current.forEach((marker) => {
        if (leafletMapRef.current) leafletMapRef.current.removeLayer(marker);
      });
      clusterMarkersRef.current.clear();
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

  // ── Recenter Camera (Smooth GPS Focus & True North 0°) ──────────────────────
  const handleRecenter = useCallback(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    if (officerCoords) {
      const pos: [number, number] = [officerCoords.latitude, officerCoords.longitude];
      const targetZoom = Math.max(map.getZoom(), 16);
      map.setView(pos, targetZoom, { animate: true });
    }

    // Always reset bearing to True North (0°) on recenter so the map is never upside down ("ulta")
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

    if (onToggleFollow) {
      onToggleFollow();
    } else {
      setIsFollowingInternal((prev) => !prev);
    }
  }, [officerCoords, onToggleFollow]);

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

  // ── 6. Update Officer GPS Marker & Follow-Me Camera Tracking ─────────────────
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

    // Follow-Me camera tracking: keep centered smoothly on officer without inverting/rotating the map
    if (isFollowing) {
      map.panTo(pos, { animate: true, duration: 0.4 });
      // NOTE: We intentionally do NOT call map.setBearing(officerHeading).
      // Sensor compasses often report south (180°) which inverts the map ("ulta"),
      // and continuous map rotations cause heavy GPU/DOM lag.
      // The officer marker's directional arrow already rotates to show the officer's heading.
    }
  }, [mapReady, officerCoords, officerHeading, isFollowing]);

  // ── 7. Render All Consumer Meters as Small Clean Icons & Popups ──────────────
  useEffect(() => {
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L) return;

    // Remove any leftover cluster markers
    clusterMarkersRef.current.forEach((marker) => {
      map.removeLayer(marker);
    });
    clusterMarkersRef.current.clear();

    // Filter valid coordinates
    const validCustomers = customers.filter(
      (c) => c.latitude && c.longitude && !isNaN(c.latitude) && !isNaN(c.longitude)
    );

    const currentIds = new Set(validCustomers.map((c) => c.customer_id));

    // Remove stale markers
    customerMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        customerMarkersRef.current.delete(id);
        markerStateCacheRef.current.delete(id);
      }
    });

    validCustomers.forEach((customer) => {
      const isSelected = selectedCustomer?.customer_id === customer.customer_id;
      const multiStop = multiRoute?.stops?.find((s) => s.customer_id === customer.customer_id);
      const isCurrentStop = multiStop && (multiStop.sequence - 1) === activeStopIndex;
      const isHighlighted = isSelected || !!isCurrentStop;
      const isNumbered = multiStop?.sequence !== undefined;
      const size = isNumbered ? 22 : 18;
      const rawPendingDays = customer.pending_days ?? (customer as any)['pending days'] ?? (customer as any).days;

      const stateKey = `${customer.customer_id}:${customer.status}:${customer.priority}:${isHighlighted}:${multiStop?.sequence}:${customer.meter_number}:${customer.pending_amount}:${rawPendingDays}`;
      let marker = customerMarkersRef.current.get(customer.customer_id);

      // Fast-path: if marker already exists and its visual state is identical, skip DOM icon rebuild
      if (marker && markerStateCacheRef.current.get(customer.customer_id) === stateKey) {
        if (isSelected && typeof marker.isPopupOpen === 'function' && !marker.isPopupOpen()) {
          marker.openPopup();
        }
        return;
      }

      markerStateCacheRef.current.set(customer.customer_id, stateKey);

      const markerHtml = buildConsumerMarkerHtml(
        customer.status,
        customer.priority,
        isHighlighted,
        multiStop?.sequence,
        customer.meter_number
      );

      const icon = L.divIcon({
        html: markerHtml,
        className: 'customer-marker-div',
        iconSize: isHighlighted ? [74, 58] : [size, size],
        iconAnchor: isHighlighted ? [37, 14] : [size / 2, size / 2],
      });

      const pos: [number, number] = [customer.latitude, customer.longitude];
      const daysText = rawPendingDays !== undefined && rawPendingDays !== null ? `${rawPendingDays} Days` : '-';
      const isHighPending = Number(rawPendingDays) > 30;

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
            id="leaflet-collect-btn-${customer.customer_id}"
            data-collect-customer-id="${customer.customer_id}"
            type="button"
            onclick="event.stopPropagation(); if (window.__mvCollectPayment) { window.__mvCollectPayment('${customer.customer_id}'); }"
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
        marker.setZIndexOffset(isHighlighted ? 1500 : 100);
        marker.getPopup()?.setContent(popupHtml);

        // Immediately re-bind direct click handler if popup is already open
        setTimeout(() => {
          const btn = document.getElementById(`leaflet-collect-btn-${customer.customer_id}`);
          if (btn) {
            btn.onclick = (e) => {
              e.stopPropagation();
              if (onCollectPayment) onCollectPayment(customer);
            };
          }
        }, 0);
      } else {
        marker = L.marker(pos, { icon, zIndexOffset: isHighlighted ? 1500 : 100 }).addTo(map);

        const popup = L.popup({
          offset: [0, -20],
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
            const btn = document.getElementById(`leaflet-collect-btn-${customer.customer_id}`);
            if (btn) {
              btn.onclick = (e) => {
                e.stopPropagation();
                if (onCollectPayment) onCollectPayment(customer);
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
  }, [mapReady, customers, selectedCustomer, multiRoute, activeStopIndex, isMuted, onSelectCustomer, onCollectPayment]);

  // ── 8. Draw OSRM Polyline Routes on Leaflet ──────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const map = leafletMapRef.current;
    if (!map || !L) return;

    // Remove existing route polylines
    if (routePolylineCasingRef.current) {
      map.removeLayer(routePolylineCasingRef.current);
      routePolylineCasingRef.current = null;
    }
    if (routePolylineRef.current) {
      map.removeLayer(routePolylineRef.current);
      routePolylineRef.current = null;
    }

    const activePath = multiRoute?.coordinates_path?.length
      ? multiRoute.coordinates_path
      : route?.coordinates_path?.length
      ? route.coordinates_path
      : null;

    if (activePath && activePath.length >= 2) {
      const latLngs = activePath.map((p) => [p.latitude, p.longitude]);

      // Outer glowing casing line
      routePolylineCasingRef.current = L.polyline(latLngs, {
        color: '#0284c7',
        weight: 8,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Inner crisp electric blue route line
      routePolylineRef.current = L.polyline(latLngs, {
        color: '#38bdf8',
        weight: 4.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // If not actively following officer GPS, auto fit to route
      if (!isFollowing) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
      }
    }
  }, [mapReady, route, multiRoute, isFollowing]);

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
        {/* Quick Reset North Compass Button: automatically appears whenever the map is rotated */}
        {Math.round(currentBearing || 0) % 360 !== 0 && (
          <button
            type="button"
            onClick={handleResetNorth}
            className="w-10 h-10 rounded-full bg-white/95 text-slate-800 border border-slate-200/90 shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer animate-in fade-in zoom-in-90"
            title={`Reset to True North (Current: ${Math.round(currentBearing)}°)`}
          >
            <Compass
              className="w-5 h-5 text-red-500 transition-transform duration-100 ease-out"
              style={{ transform: `rotate(${-(currentBearing || 0)}deg)` }}
            />
          </button>
        )}

        <MapControls
          currentLayer={currentLayer}
          isFollowing={isFollowing}
          officerHeading={currentBearing}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
          onToggleFollow={handleRecenter}
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
