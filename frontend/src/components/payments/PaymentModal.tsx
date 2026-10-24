'use client';

import React, { useState } from 'react';
import { CreditCard, CheckCircle2, AlertCircle, RefreshCw, Clock, AlertTriangle, X, ChevronDown } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { Customer, PaymentRecord } from '@/types';
import { formatCurrency, formatDate, getOverdueDays } from '@/utils/formatters';
import { paymentService } from '@/services/paymentService';
import { offlineService } from '@/services/offlineService';
import { useOffline } from '@/hooks/useOffline';

interface PaymentModalProps {
  isOpen: boolean;
  customer: Customer | null;
  officerCoords?: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onSuccess: (paymentRecord: PaymentRecord) => void;
}

export type PaymentMethodType = 'td' | 'pd' | 'bur' | 'dis' | 'other';

export default function PaymentModal({
  isOpen,
  customer,
  officerCoords,
  onClose,
  onSuccess,
}: PaymentModalProps) {
  const { isOnline, refreshQueueCount } = useOffline();

  const [collectedAmount, setCollectedAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('other');
  const [remarks, setRemarks] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill collected amount with customer's pending amount by default
  React.useEffect(() => {
    if (customer && isOpen) {
      setCollectedAmount(
        customer.pending_amount !== undefined && customer.pending_amount !== null
          ? customer.pending_amount.toString()
          : ''
      );
      setError(null);
      setRemarks('');
      setPaymentMethod('other');
      setIsConfirmOpen(false);
    }
  }, [customer, isOpen]);

  if (!customer) return null;

  const overdueDays = getOverdueDays(customer.due_date);
  const rawPendingDays =
    customer.pending_days !== undefined && customer.pending_days !== null && customer.pending_days !== ''
      ? customer.pending_days
      : (customer as any)['pending days'] !== undefined && (customer as any)['pending days'] !== null && (customer as any)['pending days'] !== ''
      ? (customer as any)['pending days']
      : (customer as any).days !== undefined && (customer as any).days !== null && (customer as any).days !== ''
      ? (customer as any).days
      : overdueDays > 0
      ? overdueDays
      : 0;

  const paymentMethodsList = [
    { key: 'other' as const, label: 'NC', desc: 'Normally Collected,},
    { key: 'td' as const, label: 'TD', desc: 'Temporary Disconnection' },
    { key: 'pd' as const, label: 'PD', desc: 'Permanent Disconnection' },
    { key: 'bur' as const, label: 'BUR', desc: 'Bill Under Review' },
    { key: 'dis' as const, label: 'DIS', desc: 'Dispute' },
  ];

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amt = parseFloat(collectedAmount);
    const isStatusMode = ['td', 'pd', 'bur', 'dis', 'other'].includes(paymentMethod);

    if (isNaN(amt) || (isStatusMode ? amt < 0 : amt <= 0)) {
      setError(isStatusMode ? 'Please enter a valid amount (>= 0).' : 'Please enter a valid collection amount greater than 0.');
      return;
    }

    if (amt > customer.pending_amount) {
      setError(`Collected amount (₹${amt}) cannot exceed pending amount (₹${customer.pending_amount}).`);
      return;
    }

    // Open confirmation popup
    setIsConfirmOpen(true);
  };

  const executeCollection = async () => {
    setError(null);
    setIsSubmitting(true);

    const amt = parseFloat(collectedAmount) || 0;

    const payload = {
      customer_id: customer.customer_id,
      meter_id: customer.meters?.[0]?.meter_id,
      amount: amt,
      payment_method: paymentMethod as any,
      disconnection_status: ['td', 'pd', 'bur', 'dis', 'other'].includes(paymentMethod) ? paymentMethod.toUpperCase() : undefined,
      remarks: remarks.trim() || undefined,
      collection_latitude: officerCoords?.latitude,
      collection_longitude: officerCoords?.longitude,
    };

    try {
      if (!isOnline) {
        // Enqueue payment locally when offline
        offlineService.enqueuePayment(payload);
        refreshQueueCount();
        
        // Construct offline placeholder payment record for immediate receipt display
        const offlineRecord: PaymentRecord = {
          id: `OFFLINE-${Date.now()}`,
          receipt_number: `REC-OFFLINE-${Math.floor(Math.random() * 900000 + 100000)}`,
          payment_id: `PAY-OFFLINE`,
          customer_id: customer.customer_id,
          customer_name: customer.name,
          meter_number: customer.meter_number,
          officer_id: customer.assigned_officer_id || 'OFF-1001',
          officer_name: 'Field Officer (Offline Queue)',
          amount: amt,
          payment_method: paymentMethod.toUpperCase(),
          disconnection_status: payload.disconnection_status,
          remarks: remarks || 'Collected in offline mode',
          previous_pending_amount: customer.pending_amount,
          remaining_pending_amount: Math.max(0, customer.pending_amount - amt),
          bill_status: customer.pending_amount - amt <= 0 ? 'paid' : 'partially_paid',
          created_at: new Date().toISOString(),
        };

        setIsSubmitting(false);
        setIsConfirmOpen(false);
        onSuccess(offlineRecord);
        return;
      }

      // Online collection via FastAPI backend — send backend-mapped method
      const result = await paymentService.collectPayment(payload);

      setIsSubmitting(false);
      setIsConfirmOpen(false);
      window.dispatchEvent(new Event('customers-updated'));
      onSuccess(result);
    } catch (err: any) {
      setIsSubmitting(false);
      setIsConfirmOpen(false);
      const msg = err.response?.data?.detail || err.message || 'Failed to process payment collection.';
      setError(msg);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Collect Electricity Bill">
      <form onSubmit={handlePreSubmit} className="space-y-4 text-xs">
        {/* Customer Summary Banner */}
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-bold text-slate-900 text-sm">{customer.name}</p>
              <p className="text-slate-500 text-[11px]">
                Customer ID: <span className="text-slate-800 font-semibold">{customer.customer_id}</span>
              </p>
            </div>
            <div className="text-right">
              <span className="text-amber-700 font-extrabold text-base block">{formatCurrency(customer.pending_amount)}</span>
              <span className="text-[10px] text-slate-400 font-semibold uppercase">Pending Dues</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-slate-600 text-[11px] pt-1 border-t border-slate-200">
            <p>
              Meter #: <span className="text-slate-900 font-bold font-mono">{customer.meter_number}</span>
            </p>
            {customer.dtc_code && (
              <p>
                DTC: <span className="text-blue-700 font-bold font-mono">{customer.dtc_code}</span>
              </p>
            )}
          </div>

          {/* Pending Days Banner Display */}
          <div className={`p-2.5 rounded-lg border flex items-center gap-2 text-xs ${
            Number(rawPendingDays) > 30
              ? 'bg-red-50 text-red-700 border-red-200'
              : Number(rawPendingDays) > 0
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}>
            <Clock className="w-4 h-4 shrink-0 text-amber-600" />
            <span className="font-bold text-slate-700">Pending Days:</span>
            <span className="font-black text-sm text-slate-900">
              {rawPendingDays} {Number(rawPendingDays) === 1 ? 'Day' : 'Days'}
            </span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-2.5 rounded-md border border-red-200 flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Amount Collected Input */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="font-semibold text-slate-700 block">
              Amount Collected (₹) *
            </label>
            {customer.pending_amount !== undefined && (
              <button
                type="button"
                onClick={() => setCollectedAmount(customer.pending_amount.toString())}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                Auto-fill Due (₹{customer.pending_amount})
              </button>
            )}
          </div>
          <input
            type="number"
            step="0.01"
            value={collectedAmount}
            onChange={(e) => setCollectedAmount(e.target.value)}
            placeholder="Enter collected amount"
            className="w-full bg-white border border-slate-300 text-slate-900 font-bold text-base rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

        {/* Action / Status Mode Dropdown */}
        <div>
          <label htmlFor="action-status-mode-select" className="font-semibold text-slate-700 block mb-1.5">
            Action / Status Mode *
          </label>
          <div className="relative">
            <select
              id="action-status-mode-select"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodType)}
              className="w-full appearance-none bg-white border border-slate-300 hover:border-slate-400 text-slate-900 font-bold text-sm rounded-lg px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors shadow-2xs cursor-pointer"
              required
            >
              {paymentMethodsList.map((method) => (
                <option key={method.key} value={method.key} className="py-1 font-semibold text-slate-800">
                  {method.label} – {method.desc}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
          {paymentMethod === 'dis' && (
            <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2.5 py-1.5 mt-2 font-medium">
              Dispute mode: You can enter consumer dispute observations in the Remarks field below.
            </p>
          )}
        </div>

        {/* Remarks Input */}
        <div>
          <label className="font-semibold text-slate-700 block mb-1">Remarks / Officer Notes</label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional collection note or meter action observation"
            className="w-full bg-white border border-slate-300 text-slate-900 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Submit & Confirm Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full mt-2 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Proceed & Confirm Collection</span>
        </button>
      </form>

      {/* Confirmation Popup Modal */}
      {isConfirmOpen && (
        <div
          className="fixed inset-0 z-[10000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4 border border-slate-200 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="font-extrabold text-sm text-slate-900">Confirm Payment Collection</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-full cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to collect and confirm this payment for the consumer below?
            </p>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Consumer:</span>
                <span className="font-bold text-slate-900">{customer.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Customer ID:</span>
                <span className="font-mono font-semibold text-slate-800">{customer.customer_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Meter Number:</span>
                <span className="font-mono font-semibold text-slate-800">{customer.meter_number}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="text-slate-500 font-medium">Collected Amount:</span>
                <span className="font-black text-sm text-emerald-700">
                  {formatCurrency(parseFloat(collectedAmount) || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Mode / Status:</span>
                <span className="font-extrabold text-blue-700 uppercase bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {paymentMethod.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between text-[11px] font-bold">
                <span className="text-slate-500 font-medium">Pending Days:</span>
                <span className={Number(rawPendingDays) > 0 ? 'text-amber-700 font-extrabold' : 'text-emerald-700'}>
                  {rawPendingDays} {Number(rawPendingDays) === 1 ? 'Day' : 'Days'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                Cancel / Edit
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={executeCollection}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-extrabold text-xs shadow-md flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Yes, Confirm Collection</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
