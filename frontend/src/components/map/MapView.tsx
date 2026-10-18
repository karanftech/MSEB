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
    },
  },
  satellite: {
    url: 'https://{s}.google.com/vt/lyrs=s&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
    },
  },
  hybrid: {
    url: 'https://{s}.google.com/vt/lyrs=y&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
    },
  },
  terrain: {
    url: 'https://{s}.google.com/vt/lyrs=p&hl=en-IN&gl=IN&x={x}&y={y}&z={z}',
    options: {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
    },
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
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

        // ── Ultra-Smooth 2-Finger Touch Rotation (Google Maps LERP Pipeline) ──
        const container = mapContainerRef.current;
        let isTwoFingerRotating = false;
        let hasRotatedPastThreshold = false;
        let lastTouchAngle = 0;
        let accumulatedDiff = 0;
        let targetBearing = officerHeading || 0;
        let currentRenderBearing = targetBearing;
        let touchRafId: number | null = null;
        let lastTouchUiSync = 0;

        const calcTouchAngle = (t1: Touch, t2: Touch): number => {
          const dx = t2.clientX - t1.clientX;
          const dy = t2.clientY - t1.clientY;
          return Math.atan2(dy, dx) * (180 / Math.PI);
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
            isTwoFingerRotating = true;
            hasRotatedPastThreshold = false;
            accumulatedDiff = 0;
            lastTouchAngle = calcTouchAngle(e.touches[0], e.touches[1]);
            const liveBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0;
            targetBearing = liveBearing;
            currentRenderBearing = liveBearing;
          } else {
            isTwoFingerRotating = false;
            hasRotatedPastThreshold = false;
          }
        };

        const handleTouchMove = (e: TouchEvent) => {
          if (isTwoFingerRotating && e.touches.length === 2) {
            // Prevent default browser viewport zoom/pan gesture conflict
            if (e.cancelable) {
              e.preventDefault();
            }

            const currentAngle = calcTouchAngle(e.touches[0], e.touches[1]);
            let delta = currentAngle - lastTouchAngle;

            // Normalize delta to [-180, 180] degrees (eliminates any 180/-180 wrap-around jump)
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            lastTouchAngle = currentAngle;

            // Small 1.5° deadzone: distinguishes intentional rotation from accidental pinch tremor
            if (!hasRotatedPastThreshold) {
              accumulatedDiff += delta;
              if (Math.abs(accumulatedDiff) >= 1.5) {
                hasRotatedPastThreshold = true;
                if (map.dragging && map.dragging.enabled()) {
                  map.dragging.disable();
                }
              } else {
                return;
              }
            }

            // Rotate clockwise when fingers move/twist to the right
            targetBearing = (targetBearing + delta + 360) % 360;

            if (!touchRafId) {
              touchRafId = requestAnimationFrame(stepRotation);
            }

            // Throttle React state updates to 100ms so UI never lags
            const now = performance.now();
            if (now - lastTouchUiSync > 100) {
              lastTouchUiSync = now;
              setCurrentBearing(targetBearing);
            }
          }
        };

        const handleTouchEnd = (e: TouchEvent) => {
          if (e.touches.length < 2) {
            if (isTwoFingerRotating) {
              isTwoFingerRotating = false;
              hasRotatedPastThreshold = false;
              if (map.dragging && !map.dragging.enabled()) {
                map.dragging.enable();
              }
              const finalBearing = typeof map.getBearing === 'function' ? map.getBearing() : targetBearing;
              setCurrentBearing(finalBearing);
            }
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
      // Update coordinates on existing SVG layers without DOM teardown
      routePolylineCasingRef.current.setLatLngs(latLngs);
      routePolylineRef.current.setLatLngs(latLngs);
    } else {
      // Create new polyline layers if not existing
      routePolylineCasingRef.current = L.polyline(latLngs, {
        color: '#0284c7',
        weight: 8,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      routePolylineRef.current = L.polyline(latLngs, {
        color: '#38bdf8',
        weight: 4.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
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
