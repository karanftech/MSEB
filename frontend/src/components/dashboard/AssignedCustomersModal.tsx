'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { X, Search, Users, Gauge, DollarSign, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { Customer } from '@/types';
import { customerService } from '@/services/customerService';
import { formatCurrency } from '@/utils/formatters';

interface AssignedCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilter?: 'all' | 'pending' | 'completed' | string;
}

export default function AssignedCustomersModal({ isOpen, onClose, initialFilter = 'all' }: AssignedCustomersModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (initialFilter && ['all', 'pending', 'completed'].includes(initialFilter)) {
      setFilterTab(initialFilter as any);
    } else {
      setFilterTab('all');
    }
  }, [initialFilter, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchAssigned = async () => {
      setLoading(true);
      try {
        const data = await customerService.getCustomers();
        setCustomers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load assigned customers', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAssigned();
  }, [isOpen]);

  const totalPendingSum = useMemo(() => {
    return customers.reduce((acc, c) => acc + (Number(c.pending_amount) || 0), 0);
  }, [customers]);

  const totalCollectedSum = useMemo(() => {
    return customers.reduce((acc, c) => acc + (Number(c.collected_amount) || 0), 0);
  }, [customers]);

  const pendingCount = useMemo(() => {
    return customers.filter((c) => (Number(c.pending_amount) || 0) > 0).length;
  }, [customers]);

  const completedCount = useMemo(() => {
    return customers.filter((c) => c.status === 'paid' || (Number(c.pending_amount) || 0) <= 0).length;
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    let list = customers;

    if (filterTab === 'pending') {
      list = list.filter((c) => (Number(c.pending_amount) || 0) > 0);
    } else if (filterTab === 'completed') {
      list = list.filter((c) => c.status === 'paid' || (Number(c.pending_amount) || 0) <= 0);
    }

    if (!searchQuery.trim()) return list;

    const q = searchQuery.toLowerCase().trim();
    return list.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.customer_id.toLowerCase().includes(q) ||
      (c.meter_number && c.meter_number.toLowerCase().includes(q)) ||
      (c.address && c.address.toLowerCase().includes(q)) ||
      (c.dtc_code && c.dtc_code.toLowerCase().includes(q))
    );
  }, [customers, filterTab, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-5">
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg text-white shadow-xs bg-blue-600">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-none">
                {filterTab === 'pending'
                  ? 'Pending Customers Directory'
                  : filterTab === 'completed'
                  ? 'Completed Collections Directory'
                  : 'Assigned Customers Directory'}
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {filterTab === 'pending'
                  ? `Showing ${filteredCustomers.length} accounts with unpaid electricity bills`
                  : filterTab === 'completed'
                  ? `Showing ${filteredCustomers.length} accounts with completed collections`
                  : `Total ${customers.length} consumers assigned to your jurisdiction`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Metric Strip - Clickable Filters */}
        <div className="bg-slate-100/80 border-b border-slate-200 px-2.5 sm:px-5 py-2.5 grid grid-cols-3 gap-1.5 sm:gap-3 text-[10px] sm:text-xs shrink-0">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-1 ${
              filterTab === 'all'
                ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20 shadow-xs'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="text-slate-600 font-semibold truncate">All Assigned</span>
            </div>
            <span className="font-extrabold text-slate-900">{customers.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('pending')}
            className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-1 ${
              filterTab === 'pending'
                ? 'bg-red-50 border-red-300 ring-2 ring-red-500/20 shadow-xs'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <div className="truncate">
                <span className="text-slate-600 font-semibold block truncate">Pending Dues</span>
                <span className="text-[10px] font-bold text-red-600 block">{formatCurrency(totalPendingSum)}</span>
              </div>
            </div>
            <span className="font-extrabold text-red-600">{pendingCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('completed')}
            className={`p-2 rounded-lg border text-left transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-1 ${
              filterTab === 'completed'
                ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/20 shadow-xs'
                : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <div className="truncate">
                <span className="text-slate-600 font-semibold block truncate">Completed</span>
                <span className="text-[10px] font-bold text-emerald-600 block">{formatCurrency(totalCollectedSum)}</span>
              </div>
            </div>
            <span className="font-extrabold text-emerald-600">{completedCount}</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-200 bg-white">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, customer ID, meter #, DTC, address..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50 custom-scrollbar">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-xs space-y-2">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="font-medium">Loading consumer accounts...</p>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs bg-white border border-slate-200 rounded-lg shadow-2xs p-6 space-y-2">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-1" />
              <p className="font-bold text-slate-700 text-sm">No consumer records found</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {searchQuery
                  ? `No accounts matching "${searchQuery}". Try a different keyword.`
                  : `No records in the ${filterTab} category.`}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto custom-scrollbar shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 uppercase text-[10px] font-extrabold tracking-wider whitespace-nowrap">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Meter ID / Number</th>
                    <th className="py-3 px-4">Consumer Name</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Amount / Dues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredCustomers.map((cus, idx) => (
                    <tr key={cus.customer_id} className="hover:bg-blue-50/50 transition-colors">
                      {/* Index */}
                      <td className="py-3 px-4 font-semibold text-slate-400 text-[11px]">
                        {idx + 1}
                      </td>

                      {/* Meter ID / Meter Number */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-md bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                            <Gauge className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="font-mono font-bold text-slate-900 text-xs block">
                              {cus.meter_number || 'N/A'}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ID: {cus.meters?.[0]?.meter_id || `MTR-${cus.customer_id.slice(-5)}`}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Consumer Name */}
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-bold text-slate-900 text-xs">{cus.name}</p>
                          <p className="text-[11px] text-slate-500">
                            CUS ID: <span className="font-medium text-slate-700">{cus.customer_id}</span>
                            {cus.area && <span> • {cus.area}</span>}
                          </p>
                        </div>
                      </td>

                      {/* Disconnection Status / Account Status Badge */}
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {cus.disconnection_status && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200">
                              {cus.disconnection_status}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              cus.status === 'paid'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : cus.status === 'overdue'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {cus.status || 'Pending'}
                          </span>
                        </div>
                      </td>

                      {/* Amount Details */}
                      <td className="py-3 px-4 text-right font-extrabold text-sm whitespace-nowrap">
                        {cus.pending_amount > 0 ? (
                          <div className="inline-block text-right">
                            <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 block">
                              {formatCurrency(cus.pending_amount)}
                            </span>
                            {Number(cus.collected_amount || 0) > 0 && (
                              <span className="text-[10px] font-bold text-emerald-600 block mt-0.5">
                                Col: {formatCurrency(Number(cus.collected_amount))}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="inline-block text-right">
                            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 block">
                              {Number(cus.collected_amount || 0) > 0
                                ? formatCurrency(Number(cus.collected_amount))
                                : 'Paid in Full'}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 block mt-0.5">
                              ₹0 Pending
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Showing {filteredCustomers.length} of {customers.length} consumer accounts</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-md transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
