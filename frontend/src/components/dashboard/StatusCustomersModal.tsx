'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  X,
  Search,
  Navigation,
  CreditCard,
  Phone,
  MapPin,
  Clock,
  RotateCcw,
  Zap,
  AlertTriangle,
  FileText,
  ShieldAlert,
  PowerOff,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { Customer } from '@/types';
import { customerService } from '@/services/customerService';
import { formatCurrency, formatDate, getOverdueDays } from '@/utils/formatters';

interface StatusCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
  statusType: 'TD' | 'PD' | 'BUR' | 'DIS' | null;
  onCollectPayment?: (customer: Customer) => void;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; fullTitle: string; color: string; bg: string; border: string; icon: any }
> = {
  TD: {
    label: 'TD',
    fullTitle: 'Temporary Disconnect (TD) Meters',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    icon: AlertTriangle,
  },
  PD: {
    label: 'PD',
    fullTitle: 'Permanent Disconnect (PD) Meters',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-300',
    icon: ShieldAlert,
  },
  BUR: {
    label: 'BUR',
    fullTitle: 'Bill Under Review (BUR) Consumers',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-300',
    icon: FileText,
  },
  DIS: {
    label: 'DIS',
    fullTitle: 'Normal Disconnected (DIS) Meters',
    color: 'text-indigo-700',
    bg: 'bg-indigo-50',
    border: 'border-indigo-300',
    icon: PowerOff,
  },
};

export default function StatusCustomersModal({
  isOpen,
  onClose,
  statusType,
  onCollectPayment,
}: StatusCustomersModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const config = statusType && STATUS_CONFIG[statusType] ? STATUS_CONFIG[statusType] : {
    label: statusType || 'Status',
    fullTitle: `${statusType || ''} Meters List`,
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: Zap,
  };

  const IconComponent = config.icon;

  const loadCategoryCustomers = async () => {
    if (!statusType) return;
    setLoading(true);
    try {
      // Fetch all customers for officer and filter by disconnection_status or status
      const data = await customerService.getCustomers();
      const safeData = Array.isArray(data) ? data : [];
      const filtered = safeData.filter((c) => {
        const ds = (c.disconnection_status || '').toUpperCase().trim();
        const st = (c.status || '').toUpperCase().trim();
        const target = statusType.toUpperCase().trim();
        return ds === target || st === target;
      });
      setCustomers(filtered);
    } catch (err) {
      console.error('Failed to load status customers', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && statusType) {
      setSearchQuery('');
      loadCategoryCustomers();
    }
  }, [isOpen, statusType]);

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase().trim();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.customer_id.toLowerCase().includes(q) ||
        c.meter_number.toLowerCase().includes(q) ||
        (c.address && c.address.toLowerCase().includes(q)) ||
        (c.dtc_code && c.dtc_code.toLowerCase().includes(q))
    );
  }, [customers, searchQuery]);

  const totalAmount = useMemo(() => {
    return filteredList.reduce((acc, c) => acc + (c.pending_amount || 0), 0);
  }, [filteredList]);

  if (!isOpen || !statusType) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={config.fullTitle} maxWidth="max-w-3xl">
      <div className="space-y-4">
        {/* Banner with Category Specs */}
        <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${config.bg} ${config.border}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-white shadow-2xs flex items-center justify-center shrink-0 ${config.color}`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider bg-white border ${config.border} ${config.color}`}>
                  {statusType} List
                </span>
                <span className="text-xs font-bold text-slate-700">
                  {filteredList.length} Consumer{filteredList.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Special action category for collection and field meter verification.
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Outstanding</span>
            <span className={`text-xl font-extrabold ${config.color}`}>
              {formatCurrency(totalAmount)}
            </span>
          </div>
        </div>

        {/* Search & Actions Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${statusType} consumers by name, meter #, DTC, address...`}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={loadCategoryCustomers}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 transition-colors cursor-pointer shrink-0"
            title="Refresh list"
          >
            <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>

        {/* Consumers List Container */}
        {loading ? (
          <div className="py-12 text-center space-y-2">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-500 font-semibold">Loading {statusType} customer list...</p>
          </div>
        ) : filteredList.length === 0 ? (
          <div className="py-12 text-center bg-slate-50 rounded-xl border border-slate-200 space-y-2 p-6">
            <IconComponent className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-700 text-sm">No {statusType} customers found</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchQuery
                ? `No results matching "${searchQuery}". Try a different keyword.`
                : `Currently there are no consumers marked as ${statusType}. You can mark meters as ${statusType} via Collect Payment.`}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
            {filteredList.map((cus) => {
              const overdueDays = getOverdueDays(cus.due_date);
              return (
                <div
                  key={cus.customer_id}
                  className="bg-white p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${config.bg} ${config.color} ${config.border}`}>
                        {statusType}
                      </span>
                      <h4 className="font-extrabold text-slate-900 text-sm">{cus.name}</h4>
                      <span className="text-[11px] font-mono text-slate-500">({cus.customer_id})</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-slate-600 text-[11px]">
                      <p>
                        Meter #: <span className="font-bold text-slate-900 font-mono">{cus.meter_number}</span>
                      </p>
                      {cus.dtc_code && (
                        <p>
                          DTC: <span className="font-bold text-blue-700 font-mono">{cus.dtc_code}</span>
                        </p>
                      )}
                      {cus.phone && (
                        <p className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{cus.phone}</span>
                        </p>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate max-w-md">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>{cus.address}</span>
                    </p>

                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="font-black text-amber-700 text-xs">
                        {formatCurrency(cus.pending_amount)} Pending
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Due: {formatDate(cus.due_date)}</span>
                      </span>
                      {overdueDays > 0 && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                          {overdueDays}d overdue
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Link
                      href={`/map?customer_id=${cus.customer_id}&navigate=true`}
                      className="px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs flex items-center gap-1.5 transition-colors"
                      title="Navigate to meter on interactive map"
                    >
                      <Navigation className="w-3.5 h-3.5 fill-blue-700 stroke-none" />
                      <span>Map</span>
                    </Link>

                    {onCollectPayment && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onCollectPayment(cus);
                        }}
                        className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Collect / Action</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
