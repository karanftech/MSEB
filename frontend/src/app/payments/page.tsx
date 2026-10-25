'use client';

import React, { useEffect, useState } from 'react';
import { CreditCard, Search, FileText, Printer, CheckCircle2 } from 'lucide-react';
import { PaymentRecord } from '@/types';
import { paymentService } from '@/services/paymentService';
import { formatCurrency, formatDate } from '@/utils/formatters';
import ReceiptView from '@/components/payments/ReceiptView';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [search, setSearch] = useState<string>('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const data = await paymentService.getPayments();
      setPayments(data);
    } catch (err) {
      console.error('Failed to fetch collection logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();

    const handleUpdate = () => fetchPayments();
    window.addEventListener('customers-updated', handleUpdate);
    return () => window.removeEventListener('customers-updated', handleUpdate);
  }, []);

  const filteredPayments = payments.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.receipt_number.toLowerCase().includes(q) ||
      p.customer_id.toLowerCase().includes(q) ||
      (p.customer_name && p.customer_name.toLowerCase().includes(q)) ||
      (p.payment_method && p.payment_method.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-lg shadow-sm">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Payment Collection Logs</h1>
          <p className="text-xs text-slate-500 mt-0.5">Audit transaction logs, verified digital receipts, and field officer collections.</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 p-3.5 rounded-lg shadow-sm">
        <div className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt #, customer ID, officer name..."
            className="w-full bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs rounded-md pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Payment Records Table */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 text-xs">Loading collection logs...</div>
      ) : filteredPayments.length === 0 ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-lg text-slate-500 text-sm shadow-sm">
          No payment collection records found.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[750px] text-left text-xs text-slate-700">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3.5">Receipt #</th>
                  <th className="p-3.5">Consumer</th>
                  <th className="p-3.5">Collected Amount</th>
                  <th className="p-3.5">Payment Method</th>
                  <th className="p-3.5">Collected By</th>
                  <th className="p-3.5">Timestamp</th>
                  <th className="p-3.5 text-right">Digital Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3.5 font-mono font-bold text-slate-900">{p.receipt_number}</td>

                    <td className="p-3.5">
                      <div>
                        <p className="font-semibold text-slate-900">{p.customer_name || p.customer_id}</p>
                        <p className="text-[10px] text-slate-500">ID: {p.customer_id}</p>
                      </div>
                    </td>

                    <td className="p-3.5 font-bold text-emerald-600 text-sm">{formatCurrency(p.amount)}</td>

                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold uppercase text-[10px] border border-slate-200">
                        {p.payment_method}
                      </span>
                    </td>

                    <td className="p-3.5 font-medium text-slate-700">{p.officer_name || p.officer_id}</td>

                    <td className="p-3.5 text-slate-500">{formatDate(p.created_at)}</td>

                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => setSelectedPayment(p)}
                        className="py-1 px-2.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 font-medium text-xs border border-slate-300 flex items-center gap-1 ml-auto transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>View Receipt</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Digital Receipt Modal */}
      <ReceiptView
        isOpen={!!selectedPayment}
        paymentRecord={selectedPayment}
        onClose={() => setSelectedPayment(null)}
      />
    </div>
  );
}
