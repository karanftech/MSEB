'use client';

export const createConsumerMarkerIcon = (
  L: any,
  status: string,
  priority?: string,
  isSelected: boolean = false,
  sequence?: number,
  meterNumber?: string
) => {
  // Pin color: in route overview (like Image 2), sequence pins use vibrant emerald green (#16a34a)
  // unless overdue/critical (#ef4444) or selected (#0284c7)
  const pinFill = isSelected
    ? '#0284c7'
    : (status === 'overdue' || priority === 'high' || priority === 'critical')
    ? '#ef4444'
    : (status === 'pending' && sequence === undefined)
    ? '#f59e0b'
    : '#16a34a';

  // Inner content shows sequence number (e.g., 1, 2, 3... 116)
  const pinInnerContent = sequence !== undefined
    ? `<text x="17" y="22" text-anchor="middle" fill="#FFFFFF" font-size="12.5" font-weight="900" font-family="system-ui, sans-serif">${sequence}</text>`
    : `<circle cx="17" cy="17" r="10" fill="#0F172A"/><path d="M16 9L11 18H16L15 25L21 15H16L17 9Z" fill="${pinFill}"/>`;

  // Meter badge shown below the pin
  const meterText = meterNumber
    ? (meterNumber.startsWith('MTR') || meterNumber.startsWith('#') ? meterNumber : `MTR-${meterNumber.slice(-6)}`)
    : '';

  const badgeSvg = meterText
    ? `
      <rect x="2" y="38" width="70" height="16" rx="4" fill="#0F172A" stroke="#FFFFFF" stroke-width="1.5"/>
      <text x="37" y="49.5" text-anchor="middle" fill="#FFFFFF" font-size="8.5" font-weight="800" font-family="system-ui, sans-serif" letter-spacing="0.2">${meterText}</text>
    `
    : '';

  const totalHeight = meterText ? 56 : 40;
  const pinSvg = `
    <svg width="74" height="${totalHeight}" viewBox="0 0 74 ${totalHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(20, 0)">
        <path d="M17 0C7.61116 0 0 7.61116 0 17C0 29.75 17 38 17 38C17 38 34 29.75 34 17C34 7.61116 26.3888 0 17 0Z" fill="${pinFill}" stroke="#FFFFFF" stroke-width="2"/>
        ${pinInnerContent}
      </g>
      ${badgeSvg}
    </svg>
  `;

  if (!L || !L.divIcon) return null;
  return L.divIcon({
    html: pinSvg,
    className: 'leaflet-custom-marker',
    iconSize: [isSelected ? 84 : 74, isSelected ? totalHeight + 10 : totalHeight],
    iconAnchor: [isSelected ? 42 : 37, isSelected ? 48 : 38],
    popupAnchor: [0, -30],
  });
};
