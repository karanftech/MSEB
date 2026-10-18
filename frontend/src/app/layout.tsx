import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import AppLayout from '@/components/layout/AppLayout';

export const metadata: Metadata = {
  title: 'Mahavitaran - Field Officer Electricity Bill Collection & Navigation System',
  description: 'GIS map-based field collection, route navigation, and payment management for Mahavitaran electricity department field officers.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen flex flex-col font-sans">
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
