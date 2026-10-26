'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  X,
  Search,
  Users,
  Gauge,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Filter,
  RotateCcw,
  Zap,
  Clock,
  Navigation,
  MoreVertical,
} from 'lucide-react';
import { Customer, OverduePeriodFilter, OutstandingAmountFilter, DTCCodeOption } from '@/types';
import { customerService } from '@/services/customerService';
import { formatCurrency, matchCustomerFilters } from '@/utils/formatters';

export type StatusCategoryCode = 'NC' | 'TD' | 'PD' | 'BUR' | 'DIS';

export const STATUS_OPTIONS: {
  code: StatusCategoryCode;
  label: string;
  fullName: string;
  badgeClass: string;
  hoverClass: string;
}[] = [
  {
    code: 'NC',
    label: 'NC',
    fullName: 'NC (Normally Collected)',
    badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    hoverClass: 'hover:bg-cyan-50 hover:text-cyan-800',
  },
  {
    code: 'TD',
    label: 'TD',
    fullName: 'TD (Temporary Disconnect)',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    hoverClass: 'hover:bg-amber-50 hover:text-amber-800',
  },
  {
    code: 'PD',
    label: 'PD',
    fullName: 'PD (Permanent Disconnect)',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    hoverClass: 'hover:bg-rose-50 hover:text-rose-800',
  },
  {
    code: 'BUR',
    label: 'BUR',
    fullName: 'BUR (Bill Under Review)',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    hoverClass: 'hover:bg-orange-50 hover:text-orange-800',
  },
  {
    code: 'DIS',
    label: 'DIS',
    fullName: 'DIS (Dispute)',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    hoverClass: 'hover:bg-indigo-50 hover:text-indigo-800',
  },
];

export function getCustomerCategoryCode(cus: Customer): StatusCategoryCode {
  const ds = String(cus.disconnection_status || '').toUpperCase().trim();
  const st = String(cus.status || '').toUpperCase().trim();
  if (ds.includes('TD') || st.includes('TD')) return 'TD';
  if (ds.includes('PD') || st.includes('PD')) return 'PD';
  if (ds.includes('BUR') || st.includes('BUR')) return 'BUR';
  if (ds.includes('DIS') || st.includes('DIS')) return 'DIS';
  return 'NC';
}

interface AssignedCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilter?: 'all' | 'pending' | 'completed' | string;
}

export default function AssignedCustomersModal({
  isOpen,
  onClose,
  initialFilter = 'all',
}: AssignedCustomersModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Dropdown list (DD list) filter states inside the Filter Icon menu
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState<boolean>(false);
  const [overduePeriod, setOverduePeriod] = useState<OverduePeriodFilter>('all');
  const [outstandingAmount, setOutstandingAmount] = useState<OutstandingAmountFilter>('all');
  const [dtcCode, setDtcCode] = useState<string>('all');
  const [dtcList, setDtcList] = useState<DTCCodeOption[]>([]);
  const [totalMeters, setTotalMeters] = useState<number>(0);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialFilter && ['all', 'pending', 'completed'].includes(initialFilter)) {
      setFilterTab(initialFilter as any);
    } else {
      setFilterTab('all');
    }
  }, [initialFilter, isOpen]);

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

  const fetchDtcCodes = async () => {
    try {
      const res = await customerService.getDtcCodes();
      setDtcList(res.dtcs || []);
      setTotalMeters(res.total_meters || 0);
    } catch (err) {
      console.error('Failed to fetch DTC codes', err);
    }
  };

  // Status Edit popup menu state
  const [activeStatusMenu, setActiveStatusMenu] = useState<{
    customerId: string;
    customerName: string;
    currentStatus: StatusCategoryCode;
    rect: { top: number; left: number; right: number; bottom: number };
  } | null>(null);
  const [updatingCustomerId, setUpdatingCustomerId] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  // Close status edit menu when scrolling
  useEffect(() => {
    const handleScroll = () => {
      if (activeStatusMenu) {
        setActiveStatusMenu(null);
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [activeStatusMenu]);

  const handleStatusChange = async (
    customerId: string,
    newStatus: StatusCategoryCode
  ) => {
    setUpdatingCustomerId(customerId);
    try {
      // Optimistic UI update so the badge updates immediately
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.customer_id === customerId) {
            const isPending = (Number(c.pending_amount) || 0) > 0;
            return {
              ...c,
              disconnection_status: newStatus,
              status:
                c.status && ['TD', 'PD', 'BUR', 'DIS', 'NC', 'OTHER'].includes(c.status.toUpperCase().trim())
                  ? (isPending ? 'pending' : 'paid')
                  : c.status,
            };
          }
          return c;
        })
      );

      await customerService.updateCustomer(customerId, {
        disconnection_status: newStatus,
      });

      setStatusFeedback(`Status updated to ${newStatus}`);
      setTimeout(() => setStatusFeedback(null), 3000);
    } catch (err) {
      console.error('Failed to update status', err);
      fetchAssigned();
    } finally {
      setUpdatingCustomerId(null);
      setActiveStatusMenu(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchAssigned();
    fetchDtcCodes();
  }, [isOpen]);

  // Close filter dropdown menu on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Options configuration for Dropdown Lists (DD Lists)
  const overduePeriodOptions: { key: OverduePeriodFilter; label: string }[] = [
    { key: 'all', label: 'All Days Overdue' },
    { key: 'days_over_35', label: '> 35 Days Overdue' },
    { key: 'days_over_40', label: '> 40 Days Overdue' },
    { key: 'days_over_45', label: '> 45 Days Overdue' },
    { key: 'days_over_50', label: '> 50 Days Overdue' },
    { key: 'days_over_55', label: '> 55 Days Overdue' },
    { key: 'days_over_60', label: '> 60 Days Overdue' },
  ];

  const outstandingAmountOptions: { key: OutstandingAmountFilter; label: string }[] = [
    { key: 'all', label: 'All Amounts' },
    { key: 'amt_0_100', label: '₹0 – ₹100' },
    { key: 'amt_over_100', label: '> ₹100' },
    { key: 'amt_over_500', label: '> ₹500' },
    { key: 'amt_over_1000', label: '> ₹1,000' },
    { key: 'amt_over_5000', label: '> ₹5,000' },
  ];

  // Derive DTC codes from customer data if API returns empty
  const availableDtcs = useMemo(() => {
    if (dtcList.length > 0) return dtcList;
    const map = new Map<string, number>();
    customers.forEach((c) => {
      const code = c.dtc_code || c.meters?.[0]?.dtc_code;
      if (code && String(code).trim()) {
        const trimmed = String(code).trim();
        map.set(trimmed, (map.get(trimmed) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .map(([code, meter_count]) => ({ code, meter_count }))
      .sort((a, b) => b.meter_count - a.meter_count);
  }, [dtcList, customers]);

  const totalMeterCount = useMemo(() => {
    if (totalMeters > 0) return totalMeters;
    return availableDtcs.reduce((acc, d) => acc + d.meter_count, customers.length);
  }, [totalMeters, availableDtcs, customers.length]);

  const isFilterActive =
    (overduePeriod && overduePeriod !== 'all') ||
    (outstandingAmount && outstandingAmount !== 'all') ||
    (dtcCode && dtcCode !== 'all');

  const activeFilterCount =
    (overduePeriod && overduePeriod !== 'all' ? 1 : 0) +
    (outstandingAmount && outstandingAmount !== 'all' ? 1 : 0) +
    (dtcCode && dtcCode !== 'all' ? 1 : 0);

  const handleResetFilters = () => {
    setOverduePeriod('all');
    setOutstandingAmount('all');
    setDtcCode('all');
    setSearchQuery('');
  };

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

    return list.filter((c) =>
      matchCustomerFilters(c, {
        overduePeriod,
        outstandingAmount,
        dtcCode,
        searchQuery,
      })
    );
  }, [customers, filterTab, overduePeriod, outstandingAmount, dtcCode, searchQuery]);

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

        {/* Summary Metric Strip - Clickable Category Filters */}
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
              <div className="truncate">
                <span className="text-slate-600 font-semibold block truncate">All Assigned</span>
                <span className="text-[10px] font-bold text-blue-600 block">{formatCurrency(totalPendingSum + totalCollectedSum)}</span>
              </div>
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

        {/* Search Bar & Single Filter Icon Section */}
        <div ref={filterDropdownRef} className="p-3 border-b border-slate-200 bg-white relative shrink-0">
          <div className="flex items-center gap-2">
            
            {/* Search Input Box */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 shrink-0 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by customer name, customer ID, meter #, DTC, address..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Single Filter Icon Button */}
            <button
              type="button"
              onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
              className={`h-9 px-3 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer relative shrink-0 ${
                isFilterDropdownOpen || isFilterActive
                  ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
              title="Filter Options (Overdue, Amount, DTC)"
            >
              <Filter className="w-3.5 h-3.5 text-blue-600" />
              <span>Filter</span>
              {isFilterActive && (
                <span className="w-2 h-2 rounded-full bg-blue-600 absolute -top-1 -right-1 ring-2 ring-white"></span>
              )}
              {activeFilterCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-600 text-white leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Active Filter Chips Strip */}
          {isFilterActive && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-100 text-[11px] animate-in fade-in duration-100">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-0.5">
                Active:
              </span>

              {overduePeriod !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                  <Clock className="w-3 h-3 text-blue-500" />
                  <span>{overduePeriodOptions.find((o) => o.key === overduePeriod)?.label}</span>
                  <button
                    type="button"
                    onClick={() => setOverduePeriod('all')}
                    className="hover:text-blue-950 cursor-pointer ml-0.5 p-0.5 rounded-full hover:bg-blue-100"
                    title="Clear overdue filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {outstandingAmount !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <DollarSign className="w-3 h-3 text-emerald-500" />
                  <span>{outstandingAmountOptions.find((o) => o.key === outstandingAmount)?.label}</span>
                  <button
                    type="button"
                    onClick={() => setOutstandingAmount('all')}
                    className="hover:text-emerald-950 cursor-pointer ml-0.5 p-0.5 rounded-full hover:bg-emerald-100"
                    title="Clear amount filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {dtcCode !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">
                  <Zap className="w-3 h-3 text-indigo-500" />
                  <span>DTC: {dtcCode}</span>
                  <button
                    type="button"
                    onClick={() => setDtcCode('all')}
                    className="hover:text-indigo-950 cursor-pointer ml-0.5 p-0.5 rounded-full hover:bg-indigo-100"
                    title="Clear DTC filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              <button
                type="button"
                onClick={handleResetFilters}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer ml-auto transition-colors"
              >
                Reset All
              </button>
            </div>
          )}

          {/* The Single Filter Dropdown Menu containing the 3 DD Lists */}
          {isFilterDropdownOpen && (
            <div className="absolute top-full right-3 mt-1.5 z-50 w-80 bg-white border border-slate-200 rounded-2xl p-4 shadow-2xl space-y-3.5 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150">
              
              {/* Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                    Filters
                  </span>
                  {activeFilterCount > 0 && (
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                      {activeFilterCount} active
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isFilterActive && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full cursor-pointer transition-colors"
                      title="Reset all filters"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsFilterDropdownOpen(false)}
                    className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all cursor-pointer"
                    title="Close filter menu"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* DD List 1: Overdue Period */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-blue-600" />
                  <span>Overdue Period</span>
                </label>
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                    overduePeriod !== 'all'
                      ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/10'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <select
                    value={overduePeriod}
                    onChange={(e) => setOverduePeriod(e.target.value as OverduePeriodFilter)}
                    className="w-full bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
                  >
                    {overduePeriodOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DD List 2: Outstanding Amount */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="w-3 h-3 text-emerald-600" />
                  <span>Outstanding Amount</span>
                </label>
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                    outstandingAmount !== 'all'
                      ? 'bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-500/10'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <select
                    value={outstandingAmount}
                    onChange={(e) => setOutstandingAmount(e.target.value as OutstandingAmountFilter)}
                    className="w-full bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
                  >
                    {outstandingAmountOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DD List 3: DTC Code */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-amber-500" />
                  <span>DTC Code (7-Digit)</span>
                </label>
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                    dtcCode !== 'all'
                      ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-500/10'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <select
                    value={dtcCode}
                    onChange={(e) => setDtcCode(e.target.value)}
                    className="w-full bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
                  >
                    <option value="all">All DTCs ({totalMeterCount})</option>
                    {availableDtcs.map((dtc) => (
                      <option key={dtc.code} value={dtc.code}>
                        DTC {dtc.code} ({dtc.meter_count} meters)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dropdown Footer */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500">
                  {filteredCustomers.length} accounts match
                </span>
                <button
                  type="button"
                  onClick={() => setIsFilterDropdownOpen(false)}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Apply & Close
                </button>
              </div>

            </div>
          )}

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
                {searchQuery || isFilterActive
                  ? 'No accounts match the selected dropdown filters or search query. Try resetting filters.'
                  : `No records in the ${filterTab} category.`}
              </p>
              {isFilterActive && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 text-xs font-bold hover:bg-blue-100 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset All Filters</span>
                </button>
              )}
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
                    {filterTab !== 'completed' && (
                      <th className="py-3 px-4 text-center">Action</th>
                    )}
                    <th className="py-3 px-4 text-center">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredCustomers.map((cus, idx) => {
                    const currentCategory = getCustomerCategoryCode(cus);
                    const categoryOption = STATUS_OPTIONS.find((s) => s.code === currentCategory);

                    return (
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
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                                categoryOption?.badgeClass || 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              {currentCategory}
                            </span>
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

                        {/* Action: Navigate on Map (hidden in Completed Collection directory) */}
                        {filterTab !== 'completed' && (
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            <Link
                              href={`/map?customer_id=${cus.customer_id}&navigate=true`}
                              onClick={onClose}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 hover:border-blue-600 transition-all font-semibold text-[11px] shadow-2xs group/nav cursor-pointer"
                              title={`Navigate to ${cus.name} on map`}
                            >
                              <Navigation className="w-3 h-3 fill-current shrink-0" />
                              <span>Navigate</span>
                            </Link>
                          </td>
                        )}

                        {/* Edit Column: Three-dot icon for status editing */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeStatusMenu?.customerId === cus.customer_id) {
                                setActiveStatusMenu(null);
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              setActiveStatusMenu({
                                customerId: cus.customer_id,
                                customerName: cus.name,
                                currentStatus: currentCategory,
                                rect: {
                                  top: rect.top,
                                  left: rect.left,
                                  right: rect.right,
                                  bottom: rect.bottom,
                                },
                              });
                            }}
                            disabled={updatingCustomerId === cus.customer_id}
                            className="w-8 h-8 rounded-lg hover:bg-slate-100 active:bg-slate-200 text-slate-500 hover:text-slate-800 inline-flex items-center justify-center transition-colors cursor-pointer border border-transparent hover:border-slate-200 shadow-2xs"
                            title={`Edit status for ${cus.name} (Current: ${currentCategory})`}
                          >
                            {updatingCustomerId === cus.customer_id ? (
                              <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <MoreVertical className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div>
            <span>Showing <strong className="text-slate-800">{filteredCustomers.length}</strong> of <strong className="text-slate-800">{customers.length}</strong> consumer accounts</span>
            {isFilterActive && (
              <span className="ml-2 px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px] border border-blue-200">
                Filtered
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-md transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Floating 3-Dot Status Edit Dropdown Menu */}
        {activeStatusMenu && (
          <>
            {/* Click outside backdrop */}
            <div
              className="fixed inset-0 z-50 bg-black/10 backdrop-blur-[0.5px]"
              onClick={() => setActiveStatusMenu(null)}
            />

            {/* Dropdown Menu Positioned next to the clicked 3-dot button */}
            <div
              style={{
                top: `${
                  typeof window !== 'undefined' && window.innerHeight - activeStatusMenu.rect.bottom < 240
                    ? Math.max(10, activeStatusMenu.rect.top - 230)
                    : activeStatusMenu.rect.bottom + 4
                }px`,
                right: `${
                  typeof window !== 'undefined'
                    ? Math.max(16, window.innerWidth - activeStatusMenu.rect.right)
                    : 16
                }px`,
              }}
              className="fixed z-50 w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl p-2.5 space-y-2 animate-in fade-in zoom-in-95 duration-100 text-left text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1.5 border-b border-slate-100 flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">
                    Edit Meter Status
                  </span>
                  <span
                    className="text-xs font-extrabold text-slate-800 truncate block max-w-[150px]"
                    title={activeStatusMenu.customerName}
                  >
                    {activeStatusMenu.customerName}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[9px] text-slate-400 block font-bold uppercase">Current</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase border ${
                      STATUS_OPTIONS.find((s) => s.code === activeStatusMenu.currentStatus)?.badgeClass ||
                      'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {activeStatusMenu.currentStatus}
                  </span>
                </div>
              </div>

              <div className="px-2 pt-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Change status to:
              </div>

              {/* Other Options List (Excludes the current status) */}
              <div className="space-y-1">
                {STATUS_OPTIONS.filter((opt) => opt.code !== activeStatusMenu.currentStatus).map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => handleStatusChange(activeStatusMenu.customerId, opt.code)}
                    disabled={updatingCustomerId === activeStatusMenu.customerId}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl border border-transparent transition-all cursor-pointer text-left group ${opt.hoverClass}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${opt.badgeClass}`}>
                        {opt.label}
                      </span>
                      <span className="font-bold text-slate-800 text-xs group-hover:text-slate-950">
                        {opt.fullName}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Feedback notification toast */}
        {statusFeedback && (
          <div className="fixed bottom-6 right-6 z-60 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-150">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{statusFeedback}</span>
          </div>
        )}

      </div>
    </div>
  );
}
