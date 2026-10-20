'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, Printer, Search, ChevronDown, CheckCircle, XCircle, PhoneCall, AlertCircle, HelpCircle, FileText } from 'lucide-react';
import api from '@/services/api';
import { formatCurrency, formatDate, formatDateTime } from '@/utils/formatters';

interface FieldVisit {
  visit_id: string;
  date_time: string;
  consumer_id: string;
  consumer_name?: string;
  meter_id: string;
  status: string;
  amount_collected: number;
  officer_remarks: string;
  gps_position: string;
}

interface ReportResponse {
  ward_name?: string;
  kpis: {
    consumers_visited_count: number;
    total_assigned_consumers: number;
    unvisited_consumers_remaining: number;
    total_recovered: number;
    outstanding_balance: number;
    recovery_rate: number;
  };
  breakdown: Record<string, number>;
  visits: FieldVisit[];
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('All Statuses');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const response = await api.get<ReportResponse>('/api/reports/field-performance', {
        params: {
          search: debouncedSearch || undefined,
          status_filter: statusFilter !== 'All Statuses' ? statusFilter : undefined,
        },
      });
      setData(response.data);
    } catch (err) {
      console.error('Failed to load field performance report', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [statusFilter, debouncedSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReportData();
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const statusOptions = [
    'All Statuses',
    'Payment Recovered',
    'Not Recovered',
    'Contacted',
    'Unavailable',
    'Meter Issue',
    'Other / Followup',
  ];

  return (
    <div id="printable-report" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto font-sans bg-slate-50/50 min-h-screen">
      {/* Top Action Bar */}
      <div className="print:hidden flex items-center justify-end gap-2.5 w-full">
        <button
          onClick={fetchReportData}
          disabled={loading}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Report</span>
        </button>

        <button
          onClick={handlePrint}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5 text-slate-300" />
          <span>Print Report</span>
        </button>
      </div>

      {/* Print-Only Official Report Header */}
      <div className="hidden print:block border-b-2 border-slate-900 pb-4 mb-4 text-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight uppercase">MAHAVITARAN</h1>
            <p className="text-[11px] font-semibold text-slate-700">Maharashtra State Electricity Distribution Co. Ltd.</p>
            <h2 className="text-sm font-bold text-slate-900 mt-2">Field Visit & Collection History Report</h2>
          </div>
          <div className="text-right text-[11px] space-y-0.5">
            <p><span className="font-semibold text-slate-600">Ward:</span> <span className="font-bold">{data?.ward_name || 'Thote & Thakre Ward'}</span></p>
            <p><span className="font-semibold text-slate-600">Report Date:</span> <span className="font-bold">{(typeof formatDateTime === 'function' ? formatDateTime : formatDate)(new Date().toISOString())}</span></p>
            <p><span className="font-semibold text-slate-600">Total Visits:</span> <span className="font-bold">{data?.visits?.length ?? 0}</span></p>
            <p><span className="font-semibold text-slate-600">Total Recovered:</span> <span className="font-bold text-emerald-800">{formatCurrency(data?.kpis?.total_recovered ?? 0)}</span></p>
          </div>
        </div>
      </div>

      {/* Top 4 KPI Metrics Grid (Screen Only) */}
      <div className="print:hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Consumers Visited */}
        <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-600 tracking-tight">Consumers Visited</p>
            {data?.kpis?.total_visits_count !== undefined && data.kpis.total_visits_count > (data?.kpis?.consumers_visited_count ?? 0) && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200" title="Total visit events logged across all consumers">
                {data.kpis.total_visits_count} Visits
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-slate-900">
              {data?.kpis.consumers_visited_count ?? 0}
            </span>
            <span className="text-slate-400 text-base font-semibold">
              / {data?.kpis.total_assigned_consumers ?? 0}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium">
            {data?.kpis.unvisited_consumers_remaining ?? 0} unvisited consumers remaining
          </p>
        </div>

        {/* KPI 2: Total Recovered */}
        <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-2xs space-y-2">
          <p className="text-xs font-bold text-slate-600 tracking-tight">Total Recovered</p>
          <p className="text-3xl font-black text-emerald-600">
            {formatCurrency(data?.kpis.total_recovered ?? 0)}
          </p>
          <p className="text-xs text-slate-400 font-medium">Total payment collected</p>
        </div>

        {/* KPI 3: Outstanding Balance */}
        <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-2xs space-y-2">
          <p className="text-xs font-bold text-slate-600 tracking-tight">Outstanding Balance</p>
          <p className="text-3xl font-black text-rose-600">
            {formatCurrency(data?.kpis.outstanding_balance ?? 0)}
          </p>
          <p className="text-xs text-slate-400 font-medium">Pending recovery in ward</p>
        </div>

        {/* KPI 4: Recovery Rate */}
        <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-2xs space-y-2">
          <p className="text-xs font-bold text-slate-600 tracking-tight">Recovery Rate</p>
          <p className="text-3xl font-black text-blue-600">
            {data?.kpis.recovery_rate ?? 0}%
          </p>
          <p className="text-xs text-slate-400 font-medium">Collection efficiency</p>
        </div>
      </div>

      {/* Field Visit Outcome Breakdown Section (Screen Only) */}
      <div className="print:hidden bg-white border border-slate-200/80 p-5 rounded-xl shadow-2xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Field Visit Outcome Breakdown</h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Payment Recovered */}
          <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-4 text-center space-y-1">
            <span className="text-2xl font-black text-emerald-700">
              {data?.breakdown?.['Payment Recovered'] ?? 0}
            </span>
            <p className="text-xs font-bold text-emerald-800">Payment Recovered</p>
          </div>

          {/* Not Recovered */}
          <div className="bg-rose-50/60 border border-rose-200/80 rounded-xl p-4 text-center space-y-1">
            <span className="text-2xl font-black text-rose-600">
              {data?.breakdown?.['Not Recovered'] ?? 0}
            </span>
            <p className="text-xs font-bold text-rose-700">Not Recovered</p>
          </div>

          {/* Contacted */}
          <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-4 text-center space-y-1">
            <span className="text-2xl font-black text-blue-600">
              {data?.breakdown?.['Contacted'] ?? 0}
            </span>
            <p className="text-xs font-bold text-blue-700">Contacted</p>
          </div>

          {/* Unavailable */}
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-4 text-center space-y-1">
            <span className="text-2xl font-black text-amber-600">
              {data?.breakdown?.['Unavailable'] ?? 0}
            </span>
            <p className="text-xs font-bold text-amber-700">Unavailable</p>
          </div>

          {/* Meter Issue */}
          <div className="bg-purple-50/60 border border-purple-200/80 rounded-xl p-4 text-center space-y-1">
            <span className="text-2xl font-black text-purple-600">
              {data?.breakdown?.['Meter Issue'] ?? 0}
            </span>
            <p className="text-xs font-bold text-purple-700">Meter Issue</p>
          </div>

          {/* Other / Followup */}
          <div className="bg-slate-100/70 border border-slate-200 rounded-xl p-4 text-center space-y-1">
            <span className="text-2xl font-black text-slate-600">
              {data?.breakdown?.['Other / Followup'] ?? 0}
            </span>
            <p className="text-xs font-bold text-slate-700">Other / Followup</p>
          </div>
        </div>
      </div>

      {/* Field Visit History Table Container */}
      <div className="bg-white border border-slate-200/80 rounded-xl shadow-2xs overflow-hidden">
        {/* Table Header Controls */}
        <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Field Visit History ({data?.visits?.length ?? 0})
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Chronological log of visits performed in {data?.ward_name || 'Thote & Thakre Ward (Godhani-Koradi)'}.
            </p>
          </div>

          {/* Controls: Search and Status Dropdown */}
          <div className="print:hidden flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
            <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:w-64">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Consumer ID, Meter No..."
                className="w-full pl-3.5 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              <button type="submit" className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer">
                <Search className="w-3.5 h-3.5" />
              </button>
            </form>

            <div className="relative w-full sm:w-auto shrink-0">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full sm:w-auto min-w-[130px] appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 pr-8 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer transition-all"
              >
                {statusOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[850px] text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-5">DATE & TIME</th>
                <th className="py-3 px-5">CONSUMER NAME & METER ID</th>
                <th className="py-3 px-5">STATUS</th>
                <th className="py-3 px-5">AMOUNT COLLECTED</th>
                <th className="py-3 px-5">OFFICER REMARKS</th>
                <th className="py-3 px-5">GPS POSITION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.visits && data.visits.length > 0 ? (
                data.visits.map((visit) => {
                  const isRecovered = visit.status === 'Payment Recovered';
                  return (
                    <tr key={visit.visit_id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Date & Time */}
                      <td className="py-3.5 px-5 text-slate-500 font-medium whitespace-nowrap">
                        {formatDateTime(visit.date_time)}
                      </td>

                      {/* Consumer Name & Meter ID */}
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <p className="font-extrabold text-slate-900 text-xs">{visit.consumer_name || visit.consumer_id}</p>
                        <p className="text-[10.5px] text-slate-500 font-mono">
                          Meter: <span className="font-semibold text-slate-700">{visit.meter_id}</span>
                        </p>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        {isRecovered ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Payment Recovered
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            Not Recovered
                          </span>
                        )}
                      </td>

                      {/* Amount Collected */}
                      <td className="py-3.5 px-5 font-bold whitespace-nowrap">
                        {visit.amount_collected > 0 ? (
                          <span className="text-emerald-700">{formatCurrency(visit.amount_collected)}</span>
                        ) : (
                          <span className="text-slate-400 font-normal">—</span>
                        )}
                      </td>

                      {/* Officer Remarks */}
                      <td className="py-3.5 px-5 text-slate-600 max-w-xs truncate">
                        {visit.officer_remarks || '—'}
                      </td>

                      {/* GPS Position */}
                      <td className="py-3.5 px-5 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {visit.gps_position}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-medium">
                    No field visit records found matching your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
