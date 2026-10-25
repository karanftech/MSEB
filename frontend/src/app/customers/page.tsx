'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, MapPin, Navigation, Phone, ChevronRight, UserPlus, Filter, Upload, Zap } from 'lucide-react';
import { Customer, DTCCodeOption } from '@/types';
import { customerService } from '@/services/customerService';
import { formatCurrency, formatDate } from '@/utils/formatters';
import StatusBadge from '@/components/ui/Badge';
import BulkUploadModal from '@/components/customers/BulkUploadModal';
import AddCustomerModal from '@/components/customers/AddCustomerModal';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dtcFilter, setDtcFilter] = useState<string>('');
  const [dtcList, setDtcList] = useState<DTCCodeOption[]>([]);
  const [totalMeters, setTotalMeters] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  // Debounce search input to avoid hitting API on every keystroke
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchDtcCodes = async () => {
    try {
      const res = await customerService.getDtcCodes();
      setDtcList(res.dtcs || []);
      setTotalMeters(res.total_meters || 0);
    } catch (err) {
      console.error('Failed to fetch DTC codes list', err);
    }
  };

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const data = await customerService.getCustomers({
        search: debouncedSearch.trim() || undefined,
        status: statusFilter || undefined,
        dtc_code: dtcFilter || undefined,
      });
      setCustomers(data);
    } catch (err) {
      console.error('Failed to load customers list', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDtcCodes();
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [debouncedSearch, statusFilter, dtcFilter]);

  useEffect(() => {
    const handleUpdate = () => {
      fetchDtcCodes();
      fetchCustomers();
    };
    window.addEventListener('customers-updated', handleUpdate);
    return () => window.removeEventListener('customers-updated', handleUpdate);
  }, [debouncedSearch, statusFilter, dtcFilter]);

  const handleUploadSuccess = () => {
    customerService.clearCache();
    fetchDtcCodes();
    fetchCustomers();
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-lg shadow-sm">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Electricity Consumers & Meters</h1>
          <p className="text-xs text-slate-500 mt-0.5">Directory of registered consumers, electricity meters, pending balances, DTC codes, and field assignments.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-md shadow-xs transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            Add Consumer
          </button>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-md shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Upload CSV / Excel
          </button>
        </div>
      </div>


      {/* Filter Controls */}
      <div className="bg-white border border-slate-200 p-3.5 rounded-lg shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, customer ID, meter #, DTC..."
            className="w-full bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs rounded-md pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto text-xs">
          {/* DTC Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-300 px-3 py-1.5 rounded-md">
            <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="font-bold text-[11px] text-slate-600 uppercase">DTC:</span>
            <select
              value={dtcFilter}
              onChange={(e) => setDtcFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="">All DTCs ({totalMeters})</option>
              {dtcList.map((dtc) => (
                <option key={dtc.code} value={dtc.code}>
                  {dtc.code} ({dtc.meter_count})
                </option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-slate-300 hidden sm:block"></div>

          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          {['', 'pending', 'overdue', 'paid'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-md font-medium text-xs uppercase transition-colors shrink-0 border ${
                statusFilter === st
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {st === '' ? 'All Status' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Customers Table / Grid */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 text-xs">Loading consumers directory...</div>
      ) : customers.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-lg text-slate-500 text-sm shadow-sm">
          No consumers matching search criteria.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[850px] text-left text-xs text-slate-700">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Consumer & Meter #</th>
                  <th className="p-3.5">DTC Code</th>
                  <th className="p-3.5">Address & Area</th>
                  <th className="p-3.5">Pending Amount</th>
                  <th className="p-3.5">Due Date</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Assigned Officer</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {customers.map((c) => (
                  <tr key={c.customer_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5">
                      <div>
                        <Link href={`/customers/${c.customer_id}`} className="font-bold text-slate-900 hover:text-blue-600 text-sm">
                          {c.name}
                        </Link>
                        <p className="text-[11px] text-slate-500">
                          ID: <span className="text-slate-800 font-medium">{c.customer_id}</span> • Meter: <span className="text-slate-800 font-medium">{c.meter_number}</span>
                        </p>
                      </div>
                    </td>

                    <td className="p-3.5">
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                        {c.dtc_code || 'N/A'}
                      </span>
                    </td>

                    <td className="p-3.5 max-w-xs">
                      <div className="flex items-start gap-1.5 text-slate-600">
                        <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                        <span className="line-clamp-2 text-xs">{c.address}</span>
                      </div>
                    </td>

                    <td className="p-3.5 font-bold text-amber-600 text-sm">{formatCurrency(c.pending_amount)}</td>

                    <td className="p-3.5 font-medium text-slate-700">{formatDate(c.due_date)}</td>

                    <td className="p-3.5">
                      <StatusBadge status={c.status} priority={c.priority} />
                    </td>

                    <td className="p-3.5 font-medium text-slate-600">{c.assigned_officer_name || 'Unassigned'}</td>

                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/map?customer_id=${c.customer_id}&navigate=true`}
                          className="px-2.5 py-1.5 rounded-full bg-[#1a73e8] hover:bg-[#1557b0] text-white font-bold text-[11px] shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center gap-1"
                          title="Start Navigation on Map"
                        >
                          <Navigation className="w-3 h-3 fill-white stroke-none" />
                          <span>Start</span>
                        </Link>
                        <Link
                          href={`/customers/${c.customer_id}`}
                          className="p-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 font-medium border border-slate-300 transition-colors"
                          title="View Details"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Consumer Modal */}
      <AddCustomerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={fetchCustomers}
      />

      {/* Bulk Upload Modal */}
      <BulkUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={fetchCustomers}
      />
    </div>
  );
}

