'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import MapView from '@/components/map/MapView';
import MapFilters from '@/components/map/MapFilters';
import PaymentModal from '@/components/payments/PaymentModal';
import ReceiptView from '@/components/payments/ReceiptView';


import {
  Coordinates,
  Customer,
  MapFilterState,
  MultiRouteCalculationResult,
  PaymentRecord,
} from '@/types';
import { customerService } from '@/services/customerService';
import { routeService } from '@/services/routeService';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useNavigation } from '@/hooks/useNavigation';
import { calculateHaversineDistance } from '@/utils/geo';
import { matchCustomerFilters } from '@/utils/formatters';

import { stopSpeech, setSpeechMuted } from '@/utils/speech';

function MapPageContent() {
  const searchParams = useSearchParams();
  const targetCusId = searchParams.get('customer_id');
  const autoNav = searchParams.get('navigate') === 'true';

  const { coords: officerCoords, heading: officerHeading } = useGeolocation();

  const {
    isNavigating,
    targetCustomer: navTargetCustomer,
    route: activeRoute,
    currentStepIndex,
    isOffRoute,
    isFollowing,
    setRoute: setNavigationRoute,
    startNavigation,
    stopNavigation,
    recalculateRoute,
    updateOfficerPosition,
    toggleFollow,
    disableFollow,
  } = useNavigation({ offRouteThresholdMeters: 75 });

  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState<boolean>(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Multi-stop Route State
  const [multiRoute, setMultiRoute] = useState<MultiRouteCalculationResult | null>(null);
  const [isMultiNavigating, setIsMultiNavigating] = useState<boolean>(false);
  const [currentStopIndex, setCurrentStopIndex] = useState<number>(0);
  const [isCalculatingMultiRoute, setIsCalculatingMultiRoute] = useState<boolean>(false);

  // Audio Mute State
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const handleToggleMute = React.useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      setSpeechMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    setSpeechMuted(isMuted);
  }, [isMuted]);

  const urlStatus = searchParams.get('status');
  const urlDisconn = searchParams.get('disconnection_status');
  const urlDtc = searchParams.get('dtc') || searchParams.get('dtc_code');

  const [filters, setFilters] = useState<MapFilterState>({
    status: (urlStatus as any) || 'all',
    disconnectionStatus: (urlDisconn as any) || 'all',
    dtcCode: urlDtc || 'all',
    overduePeriod: 'all',
    outstandingAmount: 'all',
    searchQuery: '',
  });

  // Payment & Receipt Modals
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [completedPayment, setCompletedPayment] = useState<PaymentRecord | null>(null);

  // Temporary removal of collected meters from map
  const [temporarilyRemovedCustomerIds, setTemporarilyRemovedCustomerIds] = useState<Set<string>>(new Set());

  // Load Customers from backend
  const loadCustomers = async () => {
    setIsLoadingCustomers(true);
    try {
      const data = await customerService.getCustomers();

      const safeData = Array.isArray(data) ? data : [];
      setAllCustomers(safeData);

      if (targetCusId) {
        const found = safeData.find((c) => c && c.customer_id === targetCusId);
        if (found) {
          setSelectedCustomer(found);
          if (autoNav && officerCoords) {
            startNavigation(found, officerCoords);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch customers', err);
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  useEffect(() => {
    loadCustomers();

    const handleCustUpdate = () => loadCustomers();
    window.addEventListener('customers-updated', handleCustUpdate);
    return () => window.removeEventListener('customers-updated', handleCustUpdate);
  }, [targetCusId]);

  // Update officer position for navigation & off-route detection
  useEffect(() => {
    if (officerCoords && isNavigating) {
      updateOfficerPosition(officerCoords);
    }
  }, [officerCoords, isNavigating, updateOfficerPosition]);

  // Filter Customers for Map Display (with temporary exclusion of collected meters)
  const filteredCustomers = useMemo(() => {
    return allCustomers
      .filter((c) => !temporarilyRemovedCustomerIds.has(c.customer_id))
      .filter((c) => {
        // Exclude collected meters (status === 'paid' or pending_amount <= 0) unless user explicitly filters for 'collected'
        const isCollected = c.status === 'paid' || (c.pending_amount !== undefined && c.pending_amount <= 0);
        if (filters.status !== 'collected' && isCollected) return false;
        return matchCustomerFilters(c, filters);
      });
  }, [allCustomers, filters, temporarilyRemovedCustomerIds]);

  // Pending meters specifically for routing: strictly pending meters only, never collected
  const pendingCustomersForRoute = useMemo(() => {
    return filteredCustomers.filter(
      (c) =>
        c.status !== 'paid' &&
        (c.pending_amount === undefined || c.pending_amount > 0) &&
        !temporarilyRemovedCustomerIds.has(c.customer_id)
    );
  }, [filteredCustomers, temporarilyRemovedCustomerIds]);

  const isDtcFiltered = !!(filters.dtcCode && filters.dtcCode !== 'all');

  // Auto-calculate multi-stop route connecting pending meters for the selected DTC or when multi-navigating
  const lastMultiRouteOfficerCoordsRef = React.useRef<Coordinates | null>(null);
  const lastFilteredCustomerIdsRef = React.useRef<string>('');

  useEffect(() => {
    const shouldCalculate = (isDtcFiltered || isMultiNavigating) && pendingCustomersForRoute.length > 0;

    if (shouldCalculate) {
      const effectiveCoords = officerCoords || { latitude: 21.1458, longitude: 79.0882 };
      const currentIdsKey = pendingCustomersForRoute.map((c) => c.customer_id).sort().join(',');
      const filtersChanged = currentIdsKey !== lastFilteredCustomerIdsRef.current;

      // If customer IDs changed (e.g. DTC filter changed), immediately reset multiRoute so old routes are erased
      if (filtersChanged) {
        setMultiRoute(null);
      }

      // Avoid recalculating multi-route on tiny GPS updates (< 500m movement) unless customer filters changed
      if (!filtersChanged && lastMultiRouteOfficerCoordsRef.current && officerCoords) {
        const distMoved = calculateHaversineDistance(
          lastMultiRouteOfficerCoordsRef.current.latitude,
          lastMultiRouteOfficerCoordsRef.current.longitude,
          officerCoords.latitude,
          officerCoords.longitude
        );
        if (distMoved < 500 && multiRoute !== null) {
          return;
        }
      }

      lastFilteredCustomerIdsRef.current = currentIdsKey;
      lastMultiRouteOfficerCoordsRef.current = effectiveCoords;
      routeService.calculateMultiRoute(effectiveCoords, pendingCustomersForRoute)
        .then((res) => {
          setMultiRoute(res);
        })
        .catch((err) => {
          console.warn('Auto multi-route calculation error for filtered DTC:', err);
        });
    } else {
      // Clear route if no DTC is filtered and not multi-navigating
      lastFilteredCustomerIdsRef.current = '';
      setMultiRoute(null);
    }
  }, [isDtcFiltered, isMultiNavigating, pendingCustomersForRoute, officerCoords]);

  // Count aggregates for filters
  const counts = useMemo(() => {
    return {
      all: allCustomers.length,
      pending: allCustomers.filter((c) => c.status !== 'paid' && (c.pending_amount || 0) > 0).length,
      overdue: allCustomers.filter((c) => (c.status === 'overdue' || c.priority === 'high' || c.priority === 'critical') && (c.pending_amount || 0) > 0).length,
      paid: allCustomers.filter((c) => c.status === 'paid' || (c.pending_amount !== undefined && c.pending_amount <= 0)).length,
    };
  }, [allCustomers]);

  // Distance & Travel Time to selected customer
  const { distanceMeters, durationSeconds } = useMemo(() => {
    if (!selectedCustomer || !officerCoords) return { distanceMeters: undefined, durationSeconds: undefined };
    const dist = calculateHaversineDistance(
      officerCoords.latitude,
      officerCoords.longitude,
      selectedCustomer.latitude,
      selectedCustomer.longitude
    );
    const durSec = (dist * 1.35) / 6.94; // riding speed estimate
    return { distanceMeters: dist, durationSeconds: durSec };
  }, [selectedCustomer, officerCoords]);

  // Navigate Single Customer — starts navigation to a specific pending customer
  const handleStartSingleNavigation = (customer: Customer) => {
    // If customer is already collected/paid, do not show route
    if (customer.status === 'paid' || (customer.pending_amount !== undefined && customer.pending_amount <= 0)) {
      return;
    }
    if (isMultiNavigating) handleStopMultiNavigation();
    setSelectedCustomer(customer);
    const effectiveCoords = officerCoords || { latitude: 21.1458, longitude: 79.0882 };
    startNavigation(customer, effectiveCoords);
  };

  // Navigate All — starts multi-stop route navigation connecting only pending meters
  const handleStartMultiNavigation = async () => {
    if (pendingCustomersForRoute.length === 0) return;
    const effectiveCoords = officerCoords || { latitude: 21.1458, longitude: 79.0882 };
    setIsCalculatingMultiRoute(true);
    try {
      const res = await routeService.calculateMultiRoute(effectiveCoords, pendingCustomersForRoute);
      setMultiRoute(res);
      setIsMultiNavigating(true);
      setCurrentStopIndex(0);

      if (res.stops && res.stops.length > 0) {
        const firstStopId = res.stops[0].customer_id;
        const firstCust = allCustomers.find((c) => c.customer_id === firstStopId) || pendingCustomersForRoute[0];
        setSelectedCustomer(firstCust);
        startNavigation(firstCust, effectiveCoords);
      }
    } catch (err) {
      console.error('Failed to calculate multi-route:', err);
      if (pendingCustomersForRoute[0]) {
        startNavigation(pendingCustomersForRoute[0], effectiveCoords);
      }
    } finally {
      setIsCalculatingMultiRoute(false);
    }
  };

  const handleStopMultiNavigation = () => {
    setIsMultiNavigating(false);
    setMultiRoute(null);
    setCurrentStopIndex(0);
    stopNavigation();
  };

  const handleSelectStopIndex = (index: number) => {
    if (!multiRoute || !multiRoute.stops[index]) return;
    setCurrentStopIndex(index);
    const stop = multiRoute.stops[index];
    const found = allCustomers.find((c) => c.customer_id === stop.customer_id);
    if (found) {
      // Do not navigate if stop is already collected
      if (found.status === 'paid' || (found.pending_amount !== undefined && found.pending_amount <= 0)) {
        return;
      }
      setSelectedCustomer(found);
      if (officerCoords) startNavigation(found, officerCoords);
    }
  };

  // Payment Collection Success Callback
  const handlePaymentSuccess = (record: PaymentRecord) => {
    setIsPaymentModalOpen(false);
    setCompletedPayment(record);

    // 1. Immediately remove collected meter from the map and route
    setTemporarilyRemovedCustomerIds((prev) => {
      const next = new Set(prev);
      next.add(record.customer_id);
      return next;
    });

    // 2. Immediately update state so allCustomers reflects paid status without delay
    setAllCustomers((prev) =>
      prev.map((c) => {
        if (c.customer_id === record.customer_id) {
          const rem = record.remaining_pending_amount ?? Math.max(0, c.pending_amount - record.amount);
          return {
            ...c,
            pending_amount: rem,
            status: rem <= 0 ? 'paid' : c.status,
          };
        }
        return c;
      })
    );

    // 3. Clear active navigation if currently navigating to this collected meter
    if (selectedCustomer?.customer_id === record.customer_id) {
      setSelectedCustomer(null);
      stopNavigation();
    }

    // 4. Update multi-navigation: advance to next pending meter or stop
    if (isMultiNavigating && multiRoute) {
      const remainingStops = multiRoute.stops.filter((s) => s.customer_id !== record.customer_id);
      if (remainingStops.length > 0 && currentStopIndex < multiRoute.stops.length - 1) {
        handleSelectStopIndex(currentStopIndex + 1);
      } else {
        handleStopMultiNavigation();
      }
    } else {
      stopNavigation();
    }

    // 5. Clear cache and refresh customers in the background
    customerService.clearCache();
    loadCustomers();
  };

  const currentNavStepInstruction = useMemo(() => {
    if (!activeRoute || !activeRoute.steps || activeRoute.steps.length <= currentStepIndex) {
      return undefined;
    }
    return activeRoute.steps[currentStepIndex].instruction;
  }, [activeRoute, currentStepIndex]);

  const navStateObj = useMemo(() => {
    if (!isNavigating || !navTargetCustomer) return undefined;
    return {
      active: true,
      destination: { lat: navTargetCustomer.latitude, lng: navTargetCustomer.longitude },
      targetCustomer: navTargetCustomer,
      distanceMeters: activeRoute?.distance_meters || distanceMeters || 0,
      durationSeconds: activeRoute?.duration_seconds || durationSeconds || 0,
      distanceText: activeRoute?.distance_text || 'Nearby',
      durationText: activeRoute?.duration_text || 'Calculating...',
      currentStepIndex,
      currentStepInstruction: currentNavStepInstruction || `Navigate to meter at ${navTargetCustomer.address}`,
      isOffRoute,
      isFollowing,
    };
  }, [
    isNavigating,
    navTargetCustomer,
    activeRoute,
    distanceMeters,
    durationSeconds,
    currentStepIndex,
    currentNavStepInstruction,
    isOffRoute,
    isFollowing,
  ]);

  const handleSelectMapCustomer = React.useCallback(
    (c: Customer | null) => {
      setSelectedCustomer(c);
      if (c && isMultiNavigating && multiRoute) {
        const stopIdx = multiRoute.stops.findIndex((s) => s.customer_id === c.customer_id);
        if (stopIdx !== -1) setCurrentStopIndex(stopIdx);
      }
    },
    [isMultiNavigating, multiRoute]
  );

  const handleCollectPaymentModalOpen = React.useCallback((customer?: Customer) => {
    if (customer) {
      setSelectedCustomer(customer);
    }
    setIsPaymentModalOpen(true);
  }, []);



  const singleNavCustomers = useMemo(() => {
    return navTargetCustomer ? [navTargetCustomer] : [];
  }, [navTargetCustomer]);

  const handleFilterChange = React.useCallback((newFilters: MapFilterState) => {
    if (newFilters.dtcCode !== filters.dtcCode || newFilters.status !== filters.status) {
      setMultiRoute(null);
      setSelectedCustomer(null);
      if (isMultiNavigating) {
        setIsMultiNavigating(false);
        setCurrentStopIndex(0);
        stopNavigation();
      }
    }
    setFilters(newFilters);
  }, [filters.dtcCode, filters.status, isMultiNavigating, stopNavigation]);

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      {/* Top Floating Map Search & Filter Bar (Matching screenshot) */}
      <div className="absolute top-4 left-4 right-4 z-30 max-w-xl mx-auto">
        <MapFilters
          filters={filters}
          onFilterChange={handleFilterChange}
          customerCounts={counts}
          selectedCustomer={selectedCustomer}
          onNavigateSelected={
            selectedCustomer ? () => handleStartSingleNavigation(selectedCustomer) : undefined
          }
          onNavigateAll={handleStartMultiNavigation}
          onStopNavigation={handleStopMultiNavigation}
          isNavigating={isNavigating || isMultiNavigating}
          isCalculatingMultiRoute={isCalculatingMultiRoute}
          filteredCount={filteredCustomers.length}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
        />
      </div>

      {/* Main Interactive Map Canvas */}
      <div className="flex-1 w-full min-h-0 relative">
        <MapView
          customers={filteredCustomers}
          officerCoords={officerCoords}
          officerHeading={officerHeading}
          selectedCustomer={selectedCustomer}
          route={activeRoute}
          multiRoute={(isMultiNavigating || isDtcFiltered) ? multiRoute : null}
          activeStopIndex={currentStopIndex}
          navState={navStateObj}
          onSelectCustomer={handleSelectMapCustomer}
          onExitNavigation={handleStopMultiNavigation}
          onCollectPayment={handleCollectPaymentModalOpen}
          onToggleFollow={toggleFollow}
          onDisableFollow={disableFollow}
          onDirectionsCalculated={setNavigationRoute}
          onSelectStopIndex={handleSelectStopIndex}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
        />

        {/* Temporary Removed Meters Indicator */}
        {temporarilyRemovedCustomerIds.size > 0 && (
          <div className="absolute bottom-4 left-4 z-20 bg-slate-900/90 text-white backdrop-blur-md px-3 py-1.5 rounded-full shadow-lg border border-slate-700 flex items-center gap-2 text-xs animate-in fade-in slide-in-from-bottom-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-semibold">{temporarilyRemovedCustomerIds.size} collected meter{temporarilyRemovedCustomerIds.size > 1 ? 's' : ''} removed from map</span>
            <button
              type="button"
              onClick={() => setTemporarilyRemovedCustomerIds(new Set())}
              className="text-[11px] font-bold text-sky-400 hover:text-sky-300 underline cursor-pointer ml-1"
            >
              Restore
            </button>
          </div>
        )}
      </div>

      {/* Payment Collection Modal */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        customer={selectedCustomer || navTargetCustomer}
        officerCoords={officerCoords}
        onClose={() => setIsPaymentModalOpen(false)}
        onSuccess={handlePaymentSuccess}
      />

      {/* Digital Receipt View Modal */}
      <ReceiptView
        isOpen={!!completedPayment}
        paymentRecord={completedPayment}
        onClose={() => setCompletedPayment(null)}
      />
    </div>
  );
}

export default function MapPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
        </div>
      }
    >
      <MapPageContent />
    </React.Suspense>
  );
}
