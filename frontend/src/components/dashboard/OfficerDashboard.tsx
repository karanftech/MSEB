'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, DollarSign, FileText, CheckCircle2, Target, Navigation, Clock, ChevronRight, Zap, Upload, AlertTriangle, ShieldAlert, Flame, PowerOff } from 'lucide-react';
import { OfficerDashboardMetrics, NearbyCustomer, Customer, PaymentRecord } from '@/types';
import { formatCurrency, formatDistance, formatDuration } from '@/utils/formatters';
import api from '@/services/api';
import { useGeolocation } from '@/hooks/useGeolocation';

import BulkUploadModal from '@/components/customers/BulkUploadModal';
import AssignedCustomersModal from '@/components/dashboard/AssignedCustomersModal';
import StatusCustomersModal from '@/components/dashboard/StatusCustomersModal';
import PaymentModal from '@/components/payments/PaymentModal';
import ReceiptView from '@/components/payments/ReceiptView';

export default function OfficerDashboard() {
  const { coords, loading: geoLoading } = useGeolocation();
  const [metrics, setMetrics] = useState<OfficerDashboardMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isAssignedModalOpen, setIsAssignedModalOpen] = useState<boolean>(false);
  const [statusModalType, setStatusModalType] = useState<'TD' | 'PD' | 'BUR' | 'DIS' | null>(null);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [receiptRecord, setReceiptRecord] = useState<PaymentRecord | null>(null);

  // Memoize GPS coords to a rounded grid (~500m precision) to avoid refetching on tiny GPS jitter
  const coordKey = React.useMemo(() => {
    if (!coords) return 'default';
    const lat = Math.round(coords.latitude * 100) / 100;
    const lng = Math.round(coords.longitude * 100) / 100;
    return `${lat},${lng}`;
  }, [coords]);

  const hasFetched = React.useRef(false);
  const isFetchingRef = React.useRef(false);

  const fetchDashboard = async (showFullLoader = false, targetCoords = coords) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (showFullLoader) setLoading(true);
    setError(null);
    try {
      const response = await api.get<OfficerDashboardMetrics>('/api/dashboard/officer', {
        params: {
          latitude: targetCoords?.latitude || 21.1458,
          longitude: targetCoords?.longitude || 79.0882,
        },
      });
      setMetrics(response.data);
    } catch (err: any) {
      console.error('Failed to load officer dashboard metrics', err);
      setError(err?.response?.data?.detail || 'Failed to connect to backend server. Make sure backend service is running.');
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    // If geolocation is still in its initial loading state, allow a brief 300ms window
    // to obtain the actual GPS position before firing the initial API call.
    if (geoLoading && !hasFetched.current) {
      const timer = setTimeout(() => {
        if (!hasFetched.current) {
          hasFetched.current = true;
          fetchDashboard(true, coords);
        }
      }, 300);
      return () => clearTimeout(timer);
    }

    const showLoader = !hasFetched.current;
    hasFetched.current = true;
    fetchDashboard(showLoader, coords);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordKey, geoLoading]);

  useEffect(() => {
    const handleUpdate = () => fetchDashboard(false, coords);
    window.addEventListener('customers-updated', handleUpdate);
    return () => window.removeEventListener('customers-updated', handleUpdate);
  }, [coords]);

  if (loading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-20 bg-slate-200 rounded-lg w-full"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="h-24 bg-slate-200 rounded-lg"></div>
          <div className="h-24 bg-slate-200 rounded-lg"></div>
          <div className="h-24 bg-slate-200 rounded-lg"></div>
          <div className="h-24 bg-slate-200 rounded-lg"></div>
        </div>
        <div className="h-48 bg-slate-200 rounded-lg w-full"></div>
      </div>
    );
  }


  if (error || !metrics) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4 text-center">
        <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-lg shadow-sm space-y-3">
          <p className="font-semibold text-base">Unable to load Dashboard Metrics</p>
          <p className="text-xs text-red-600 max-w-lg mx-auto">{error || 'Could not retrieve metric details.'}</p>
          <button
            onClick={() => fetchDashboard(true)}
            className="px-4 py-2 bg-red-600 text-white font-medium text-xs rounded-md shadow-sm hover:bg-red-700 transition-colors"
          >
            Retry Loading Dashboard
          </button>
        </div>
      </div>
    );
  }

  const targetProgress = Math.min(100, Math.round((metrics.todays_collected_amount / (metrics.todays_collection_target || 1)) * 100));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Bulk Upload Modal */}
      <BulkUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => {
          fetchDashboard();
        }}
      />

      {/* Assigned Customers Modal */}
      <AssignedCustomersModal
        isOpen={isAssignedModalOpen}
        onClose={() => setIsAssignedModalOpen(false)}
      />

      {/* Specific Status Category Customers List Modal (TD, PD, BUR, DIS) */}
      <StatusCustomersModal
        isOpen={!!statusModalType}
        onClose={() => setStatusModalType(null)}
        statusType={statusModalType}
        onCollectPayment={(cust) => {
          setPaymentCustomer(cust);
        }}
      />

      {/* Collect Payment Modal if triggered from status list */}
      <PaymentModal
        isOpen={!!paymentCustomer}
        customer={paymentCustomer}
        officerCoords={coords}
        onClose={() => setPaymentCustomer(null)}
        onSuccess={(rec) => {
          setPaymentCustomer(null);
          setReceiptRecord(rec);
          fetchDashboard();
        }}
      />

      {/* Digital Receipt View if payment collected from status list */}
      {receiptRecord && (
        <ReceiptView
          isOpen={!!receiptRecord}
          onClose={() => setReceiptRecord(null)}
          paymentRecord={receiptRecord}
        />
      )}

      {/* Header Greeting */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-lg shadow-sm">
        <div>
          <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-xs border border-blue-200 inline-block mb-1.5">
            Field Officer Portal
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Today's Collection Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Locate meters, navigate routes, and collect pending electricity bills.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto shrink-0 mt-1 sm:mt-0">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="h-9 px-3.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-all cursor-pointer w-full sm:w-auto"
          >
            <Upload className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Upload Data (CSV/Excel)</span>
          </button>

          <Link
            href="/map"
            className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-all cursor-pointer w-full sm:w-auto"
          >
            <Zap className="w-4 h-4 fill-current shrink-0" />
            <span>Open Interactive Map</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1: Total Assigned (Clickable) */}
        <button
          onClick={() => setIsAssignedModalOpen(true)}
          className="bg-white border border-slate-200 hover:border-blue-500 p-4 rounded-lg shadow-xs hover:shadow-md transition-all active:scale-[0.98] cursor-pointer text-left space-y-1 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="Click to view all assigned customers & meter details"
        >
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded bg-blue-50 group-hover:bg-blue-600 text-blue-600 group-hover:text-white transition-colors flex items-center justify-center mb-1">
              <Users className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 group-hover:bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200 transition-colors flex items-center gap-0.5 shrink-0 whitespace-nowrap">
              View <ChevronRight className="w-3 h-3 inline" />
            </span>
          </div>
          <p className="text-[11px] text-slate-500 group-hover:text-blue-900 uppercase font-semibold transition-colors">
            Assigned Customers
          </p>
          <p className="text-2xl font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors">
            {metrics.total_assigned_customers}
          </p>
        </button>

        {/* Card 2: Total Pending Amount */}
        <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
          <div className="w-8 h-8 rounded bg-amber-50 text-amber-600 flex items-center justify-center mb-1">
            <DollarSign className="w-4 h-4" />
          </div>
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Pending Amount</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(metrics.total_pending_amount)}</p>
        </div>

        {/* Card 3: Pending Customers (Static Display) */}
        <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
          <div className="w-8 h-8 rounded bg-red-50 text-red-600 flex items-center justify-center mb-1">
            <FileText className="w-4 h-4" />
          </div>
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Pending Customers</p>
          <p className="text-2xl font-extrabold text-red-600">
            {metrics.number_of_pending_bills}
          </p>
        </div>

        {/* Card 4: Completed Collections (Static Display) */}
        <div className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm space-y-1">
          <div className="w-8 h-8 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center mb-1">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Completed Collections</p>
          <p className="text-2xl font-extrabold text-emerald-600">
            {metrics.number_of_completed_collections}
          </p>
        </div>
      </div>

      {/* Meter & Disconnection Status Cards: TD, PD, BUR, DIS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            <h3 className="font-extrabold text-slate-900 text-sm uppercase tracking-wide">
              Meter Status & Disconnection Action Cards
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 hidden sm:inline">
            Click any card to open its specific consumer list
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: TD (Temporary Disconnect) */}
          <button
            type="button"
            onClick={() => setStatusModalType('TD')}
            className="bg-white border border-amber-200/90 hover:border-amber-400 p-4 rounded-xl shadow-2xs hover:shadow-md transition-all active:scale-[0.98] cursor-pointer text-left space-y-1.5 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-amber-500"
            title="Click to view all Temporary Disconnect (TD) consumers"
          >
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-amber-50 group-hover:bg-amber-600 text-amber-600 group-hover:text-white transition-colors flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-extrabold text-amber-700 bg-amber-50 group-hover:bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200 transition-colors flex items-center gap-0.5">
                View List <ChevronRight className="w-3 h-3 inline" />
              </span>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 group-hover:text-amber-900 font-bold uppercase transition-colors">
                TD (Temporary Disconnect)
              </p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-slate-900 group-hover:text-amber-700 transition-colors">
                  {metrics.td_customers_count || 0}
                </span>
                <span className="text-xs font-extrabold text-amber-600">
                  {formatCurrency(metrics.td_pending_amount || 0)}
                </span>
              </div>
            </div>
          </button>

          {/* Card 2: PD (Permanent Disconnect) */}
          <button
            type="button"
            onClick={() => setStatusModalType('PD')}
            className="bg-white border border-rose-200/90 hover:border-rose-400 p-4 rounded-xl shadow-2xs hover:shadow-md transition-all active:scale-[0.98] cursor-pointer text-left space-y-1.5 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-rose-500"
            title="Click to view all Permanent Disconnect (PD) consumers"
          >
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-rose-50 group-hover:bg-rose-600 text-rose-600 group-hover:text-white transition-colors flex items-center justify-center">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-extrabold text-rose-700 bg-rose-50 group-hover:bg-rose-100 px-2 py-0.5 rounded-full border border-rose-200 transition-colors flex items-center gap-0.5">
                View List <ChevronRight className="w-3 h-3 inline" />
              </span>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 group-hover:text-rose-900 font-bold uppercase transition-colors">
                PD (Permanent Disconnect)
              </p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-slate-900 group-hover:text-rose-700 transition-colors">
                  {metrics.pd_customers_count || 0}
                </span>
                <span className="text-xs font-extrabold text-rose-600">
                  {formatCurrency(metrics.pd_pending_amount || 0)}
                </span>
              </div>
            </div>
          </button>

          {/* Card 3: BUR (Bill Under Review) */}
          <button
            type="button"
            onClick={() => setStatusModalType('BUR')}
            className="bg-white border border-orange-200/90 hover:border-orange-400 p-4 rounded-xl shadow-2xs hover:shadow-md transition-all active:scale-[0.98] cursor-pointer text-left space-y-1.5 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-orange-500"
            title="Click to view all Bill Under Review (BUR) consumers"
          >
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-orange-50 group-hover:bg-orange-600 text-orange-600 group-hover:text-white transition-colors flex items-center justify-center">
                <FileText className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-extrabold text-orange-700 bg-orange-50 group-hover:bg-orange-100 px-2 py-0.5 rounded-full border border-orange-200 transition-colors flex items-center gap-0.5">
                View List <ChevronRight className="w-3 h-3 inline" />
              </span>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 group-hover:text-orange-900 font-bold uppercase transition-colors">
                BUR (Bill Under Review)
              </p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-slate-900 group-hover:text-orange-700 transition-colors">
                  {metrics.bur_customers_count || 0}
                </span>
                <span className="text-xs font-extrabold text-orange-600">
                  {formatCurrency(metrics.bur_pending_amount || 0)}
                </span>
              </div>
            </div>
          </button>

          {/* Card 4: DIS (Disconnected) */}
          <button
            type="button"
            onClick={() => setStatusModalType('DIS')}
            className="bg-white border border-indigo-200/90 hover:border-indigo-400 p-4 rounded-xl shadow-2xs hover:shadow-md transition-all active:scale-[0.98] cursor-pointer text-left space-y-1.5 group relative overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500"
            title="Click to view all Disconnected (DIS) consumers"
          >
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 group-hover:bg-indigo-600 text-indigo-600 group-hover:text-white transition-colors flex items-center justify-center">
                <PowerOff className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-50 group-hover:bg-indigo-100 px-2 py-0.5 rounded-full border border-indigo-200 transition-colors flex items-center gap-0.5">
                View List <ChevronRight className="w-3 h-3 inline" />
              </span>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 group-hover:text-indigo-900 font-bold uppercase transition-colors">
                DIS (Disconnected)
              </p>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-slate-900 group-hover:text-indigo-700 transition-colors">
                  {metrics.dis_customers_count || 0}
                </span>
                <span className="text-xs font-extrabold text-indigo-600">
                  {formatCurrency(metrics.dis_pending_amount || 0)}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>


      {/* Nearby Pending Customers Section */}
      <div className="bg-white border border-slate-200 p-5 rounded-lg shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-base">Nearby Pending Customers</h3>
          </div>
          <Link href="/map" className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
            <span>View All on Map</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {metrics.nearby_pending_customers.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            No nearby pending customers found within 5 km radius.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {metrics.nearby_pending_customers.map((cus, idx) => (
              <div
                key={cus.customer_id}
                className="bg-slate-50 p-3.5 rounded-md border border-slate-200 hover:border-slate-300 transition-colors flex justify-between items-center"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{cus.name}</h4>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatDistance(cus.distance_meters)} • Est. {cus.estimated_duration_mins ? `${Math.round(cus.estimated_duration_mins)} min` : '1 min'} travel
                  </p>
                  <p className="text-xs font-bold text-amber-600">{formatCurrency(cus.pending_amount)} pending</p>
                </div>

                <Link
                  href={`/map?customer_id=${cus.customer_id}&navigate=true`}
                  className="py-1.5 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1 shadow-sm transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Navigate</span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
