'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Crosshair, Layers, Maximize2, Plus, Minus, Check, Menu, X, Volume2, VolumeX, Compass, Box } from 'lucide-react';
import { MapLayerType } from '@/types';

interface MapControlsProps {
  currentLayer: MapLayerType;
  isFollowing: boolean;
  is3D?: boolean;
  officerHeading?: number | null;
  isMuted?: boolean;
  onToggleMute?: () => void;
  onToggleFollow: () => void;
  onSelectLayer: (layer: MapLayerType) => void;
  onFitBounds: () => void;
  onResetNorth?: () => void;
  onToggle3D?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

export default function MapControls({
  currentLayer,
  isFollowing,
  is3D,
  officerHeading,
  isMuted,
  onToggleMute,
  onToggleFollow,
  onSelectLayer,
  onFitBounds,
  onResetNorth,
  onToggle3D,
  onZoomIn,
  onZoomOut,
}: MapControlsProps) {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsLayerMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const layerOptions: { type: MapLayerType; label: string }[] = [
    { type: 'roadmap', label: 'Default Map' },
    { type: 'satellite', label: 'Satellite' },
    { type: 'hybrid', label: 'Hybrid' },
    { type: 'terrain', label: 'Terrain' },
  ];

  // List of separate action controls (ordered top-to-bottom)
  const actions = [
    {
      id: 'layers',
      node: (
        <div className="relative">
          <button
            onClick={() => setIsLayerMenuOpen((prev) => !prev)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer shadow-lg border ${
              isLayerMenuOpen || currentLayer !== 'roadmap'
                ? 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-400/50'
                : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-blue-600'
            }`}
            title="Switch Map Layer"
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* Smooth Layer Popup */}
          {isLayerMenuOpen && (
            <div className="absolute right-12 bottom-0 w-40 bg-white/95 backdrop-blur-md border border-slate-200 text-slate-800 rounded-2xl shadow-xl p-2 z-50 animate-in fade-in zoom-in-95 slide-in-from-right-2 duration-200">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-slate-400 px-2.5 py-1">
                Map Layer
              </p>
              <div className="space-y-1">
                {layerOptions.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => {
                      onSelectLayer(opt.type);
                      setIsLayerMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      currentLayer === opt.type
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {currentLayer === opt.type && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'recenter',
      node: (
        <button
          onClick={onToggleFollow}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer shadow-lg border ${
            isFollowing
              ? 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-400/50 animate-pulse'
              : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-blue-600'
          }`}
          title={isFollowing ? 'Follow-Me Camera ON' : 'Recenter Camera'}
        >
          <Crosshair className="w-4 h-4" />
        </button>
      ),
    },
    {
      id: 'fitBounds',
      node: (
        <button
          onClick={onFitBounds}
          className="w-10 h-10 rounded-full bg-white/95 text-slate-700 hover:bg-slate-50 hover:text-blue-600 border border-slate-200 shadow-lg flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer"
          title="Fit All Assigned Meters"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      ),
    },
    ...(onResetNorth
      ? [
          {
            id: 'compass',
            node: (
              <button
                onClick={onResetNorth}
                className="w-10 h-10 rounded-full bg-white/95 text-slate-700 hover:bg-slate-50 border border-slate-200 shadow-lg flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer group"
                title={`Reset to True North (Current: ${Math.round(officerHeading || 0)}°)`}
              >
                <Compass
                  className="w-5 h-5 text-red-500 transition-transform duration-75 ease-out"
                  style={{ transform: `rotate(${-(officerHeading || 0)}deg)` }}
                />
              </button>
            ),
          },
        ]
      : []),
    ...(onToggle3D
      ? [
          {
            id: 'toggle3D',
            node: (
              <button
                onClick={onToggle3D}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer shadow-lg border text-xs font-black ${
                  is3D
                    ? 'bg-blue-600 text-white border-blue-500 ring-2 ring-blue-400/50'
                    : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-blue-600'
                }`}
                title={is3D ? 'Switch to 2D View' : 'Switch to 3D Perspective Tilt'}
              >
                {is3D ? '2D' : '3D'}
              </button>
            ),
          },
        ]
      : []),
    ...(onToggleMute
      ? [
          {
            id: 'mute',
            node: (
              <button
                onClick={onToggleMute}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer shadow-lg border ${
                  isMuted
                    ? 'bg-white/95 text-rose-500 border-slate-200 hover:bg-slate-50'
                    : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-blue-600'
                }`}
                title={isMuted ? 'Unmute Navigation Audio' : 'Mute Navigation Audio'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            ),
          },
        ]
      : []),
    ...(onZoomIn
      ? [
          {
            id: 'zoomIn',
            node: (
              <button
                onClick={onZoomIn}
                className="w-10 h-10 rounded-full bg-white/95 text-slate-700 hover:bg-slate-50 hover:text-blue-600 border border-slate-200 shadow-lg flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer"
                title="Zoom In"
              >
                <Plus className="w-4 h-4" />
              </button>
            ),
          },
        ]
      : []),
    ...(onZoomOut
      ? [
          {
            id: 'zoomOut',
            node: (
              <button
                onClick={onZoomOut}
                className="w-10 h-10 rounded-full bg-white/95 text-slate-700 hover:bg-slate-50 hover:text-blue-600 border border-slate-200 shadow-lg flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 cursor-pointer"
                title="Zoom Out"
              >
                <Minus className="w-4 h-4" />
              </button>
            ),
          },
        ]
      : []),
  ];

  // Total count for calculating reverse bottom-to-top animation delays
  const totalActions = actions.length;

  return (
    <div ref={menuRef} className="fixed bottom-20 right-4 md:bottom-6 md:right-6 flex flex-col items-center gap-2.5 z-[60] select-none">
      
      {/* 1. Staggered Floating Circular Icons Stack (Shoots Upward Separately) */}
      <div className="flex flex-col items-center gap-2">
        {actions.map((action, idx) => {
          // Calculate reverse delay so lower items pop out first from the trigger button
          const reverseIndex = totalActions - 1 - idx;
          const delay = isMenuOpen ? reverseIndex * 40 : idx * 30;

          return (
            <div
              key={action.id}
              style={{
                transitionDelay: `${delay}ms`,
              }}
              className={`transition-all duration-300 ease-out transform ${
                isMenuOpen
                  ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
                  : 'opacity-0 translate-y-8 scale-50 pointer-events-none'
              }`}
            >
              {action.node}
            </div>
          );
        })}
      </div>

      {/* 2. Master 3-Line Menu Trigger Button */}
      <button
        onClick={() => setIsMenuOpen((prev) => !prev)}
        className={`w-12 h-12 rounded-full shadow-xl border flex items-center justify-center transition-all duration-300 ease-out hover:scale-105 active:scale-95 cursor-pointer ${
          isMenuOpen
            ? 'bg-slate-900 text-white border-slate-800 ring-2 ring-slate-900/30'
            : 'bg-white text-slate-800 border-slate-200/90 hover:bg-slate-50'
        }`}
        title={isMenuOpen ? 'Close Controls Menu' : 'Open Map Controls Menu'}
      >
        {isMenuOpen ? (
          <X className="w-5 h-5 transition-transform duration-300 rotate-90" />
        ) : (
          <Menu className="w-5 h-5 text-slate-800 transition-transform duration-300" />
        )}
      </button>

    </div>
  );
}
