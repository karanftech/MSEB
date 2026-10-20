'use client';

import { useState, useEffect, useCallback } from 'react';
import { Coordinates } from '@/types';

export interface ExtendedGeolocationState {
  coords: Coordinates | null;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  error: string | null;
  loading: boolean;
}

export function useGeolocation(watch: boolean = true) {
  const [state, setState] = useState<ExtendedGeolocationState>({
    coords: { latitude: 21.1458, longitude: 79.0882 }, // Default fallback to Nagpur city center
    heading: null,
    speed: null,
    accuracy: null,
    error: null,
    loading: true,
  });

  const handleSuccess = useCallback((position: GeolocationPosition) => {
    const newLat = position.coords.latitude;
    const newLng = position.coords.longitude;
    const heading = position.coords.heading;
    const speed = position.coords.speed;
    const accuracy = position.coords.accuracy;

    setState((prev) => {
      if (
        prev.coords &&
        Math.abs(prev.coords.latitude - newLat) < 0.00001 &&
        Math.abs(prev.coords.longitude - newLng) < 0.00001 &&
        prev.heading === heading
      ) {
        return prev;
      }

      return {
        coords: {
          latitude: newLat,
          longitude: newLng,
        },
        heading: heading !== null && !isNaN(heading) ? heading : prev.heading,
        speed: speed !== null && !isNaN(speed) ? speed : 0,
        accuracy: accuracy || null,
        error: null,
        loading: false,
      };
    });
  }, []);

  const handleError = useCallback((error: GeolocationPositionError) => {
    let errMsg = 'Failed to fetch GPS location.';
    if (error.code === error.PERMISSION_DENIED) {
      errMsg = 'Location permission denied by user.';
    } else if (error.code === error.POSITION_UNAVAILABLE) {
      errMsg = 'Location information is unavailable.';
    } else if (error.code === error.TIMEOUT) {
      errMsg = 'Location request timed out.';
    }
    setState((prev) => ({
      ...prev,
      error: errMsg,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation is not supported by your browser.',
        loading: false,
      }));
      return;
    }

    // Get current position initially (use recent cached position if available for instant load)
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 6000,
      maximumAge: 30000,
    });

    let watchId: number | null = null;
    if (watch) {
      watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      });
    }

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [watch, handleSuccess, handleError]);

  return state;
}
