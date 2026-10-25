'use client';

import React from 'react';
import { Printer, CheckCircle2, Zap, Share2, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { PaymentRecord } from '@/types';
import { formatCurrency, formatDate, formatDateTime } from '@/utils/formatters';

import MahavitaranLogo from '@/components/ui/MahavitaranLogo';

interface ReceiptViewProps {
  isOpen: boolean;
  paymentRecord: PaymentRecord | null;
  onClose: () => void;
}

export default function ReceiptView({ isOpen, paymentRecord, onClose }: ReceiptViewProps) {
  if (!paymentRecord) return null;

  const handlePrint = () => {
    window.print();
  };

  const rawMethod = paymentRecord.payment_method?.toLowerCase() || '';
  const formattedMethod =
    rawMethod === 'upi' ? 'UPI / ONLINE'
    : rawMethod === 'cheque' ? 'CHEQUE'
    : rawMethod === 'cash' ? 'CASH'
    : rawMethod === 'other' || rawMethod === 'nc' ? 'NC (Normally Collected)'
    : rawMethod === 'td' ? 'TD (Temporary Disconnect)'
    : rawMethod === 'pd' ? 'PD (Permanent Disconnect)'
    : rawMethod === 'bur' ? 'BUR (Bill Under Review)'
    : rawMethod === 'dis' ? 'DIS (Dispute)'
    : paymentRecord.payment_method?.toUpperCase() || 'NC (Normally Collected)';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mahavitaran Collection Receipt" maxWidth="max-w-lg">
      <div className="space-y-5 text-slate-800">
        {/* Printable Receipt Box */}
        <div id="printable-receipt" className="bg-white p-5 rounded-lg border border-slate-300 space-y-4 font-sans text-xs shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <MahavitaranLogo size="sm" showSubtitle={true} />
            </div>
            <div className="text-right">
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] border border-emerald-200">
                PAID
              </span>
            </div>
          </div>

          {/* Receipt Meta */}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-md border border-slate-200">
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Receipt No</p>
              <p className="font-mono font-bold text-slate-900">{paymentRecord.receipt_number}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Date & Time</p>
              <p className="font-semibold text-slate-800">{formatDateTime(paymentRecord.created_at)}</p>
            </div>
          </div>

          {/* Customer & Meter Details */}
          <div className="space-y-1.5 border-b border-slate-200 pb-3">
            <p className="font-bold text-slate-500 uppercase text-[10px]">Consumer Details</p>
            <div className="flex justify-between">
              <span className="text-slate-500">Customer Name:</span>
              <span className="font-bold text-slate-900">{paymentRecord.customer_name || paymentRecord.customer_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Customer ID:</span>
              <span className="font-mono font-semibold text-slate-800">{paymentRecord.customer_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Meter Number:</span>
              <span className="font-mono font-semibold text-slate-800">{paymentRecord.meter_number || 'N/A'}</span>
            </div>
          </div>

          {/* Payment Breakdown */}
          <div className="space-y-1.5 border-b border-slate-200 pb-3">
            <p className="font-bold text-slate-500 uppercase text-[10px]">Payment Summary</p>
            <div className="flex justify-between">
              <span className="text-slate-500">Previous Pending:</span>
              <span className="font-medium text-slate-800">{formatCurrency(paymentRecord.previous_pending_amount)}</span>
            </div>
            <div className="flex justify-between text-emerald-700 font-bold text-sm pt-1">
              <span>Amount Collected:</span>
              <span>{formatCurrency(paymentRecord.amount)}</span>
            </div>
            <div className="flex justify-between text-slate-800 pt-1">
              <span className="text-slate-500">Remaining Balance:</span>
              <span className="font-bold text-amber-700">{formatCurrency(paymentRecord.remaining_pending_amount)}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-slate-500">Payment Mode:</span>
              <span className="font-bold uppercase text-slate-800">{formattedMethod}</span>
            </div>
            {paymentRecord.transaction_reference && (
              <div className="flex justify-between">
                <span className="text-slate-500">Transaction Ref:</span>
                <span className="font-mono text-slate-800">{paymentRecord.transaction_reference}</span>
              </div>
            )}
          </div>

          {/* Officer Footer */}
          <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
            <div>
              <p>Collected By: <span className="font-bold text-slate-800">{paymentRecord.officer_name || paymentRecord.officer_id}</span></p>
              <p>Officer ID: <span className="font-mono text-slate-700">{paymentRecord.officer_id}</span></p>
            </div>
            <div className="text-right">
              <p className="text-emerald-700 font-semibold">Verified Digital Receipt</p>
              <p>System Generated</p>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handlePrint}
            className="py-2.5 rounded-md bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs flex items-center justify-center gap-2 border border-slate-300 transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Print Receipt</span>
          </button>
          <button
            onClick={onClose}
            className="py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Done / Next Customer</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
