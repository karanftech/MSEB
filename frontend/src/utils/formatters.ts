export function formatCurrency(amount?: number | null): string {
  const val = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

export function formatDate(dateString?: string | null): string {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString?: string | null): string {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return dateString;
  }
}

export function formatDistance(meters?: number | null): string {
  if (meters === undefined || meters === null || isNaN(meters)) return '0 m';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '0 mins';
  const mins = Math.round(seconds / 60);
  if (mins < 60) {
    return `${mins} min${mins === 1 ? '' : 's'}`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs} hr ${remMins} min`;
}

export function getOverdueDays(dueDateString?: string | null): number {
  if (!dueDateString) return 0;
  try {
    const due = new Date(dueDateString);
    if (isNaN(due.getTime())) return 0;
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - due.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  } catch {
    return 0;
  }
}

export function matchCustomerFilters(
  customer: {
    pending_amount: number;
    due_date?: string;
    status: string;
    priority?: string;
    name: string;
    customer_id: string;
    meter_number: string;
    address: string;
    dtc_code?: string;
  },
  filters: {
    overduePeriod?: string;
    outstandingAmount?: string;
    status?: string;
    dtcCode?: string;
    searchQuery?: string;
  }
): boolean {
  // 1. DTC Code Filter
  if (filters.dtcCode && filters.dtcCode !== 'all') {
    const filterDtc = String(filters.dtcCode).trim().toUpperCase();
    const custDtc = String(customer.dtc_code || '').trim().toUpperCase();
    const meters = (customer as any).meters;
    const meterDtcMatch = Array.isArray(meters) && meters.some((m: any) => String(m.dtc_code || '').trim().toUpperCase() === filterDtc);

    if (custDtc !== filterDtc && !meterDtcMatch) return false;
  }

  // 2. Overdue Period Filter (Days overdue)
  if (filters.overduePeriod && filters.overduePeriod !== 'all') {
    const days = getOverdueDays(customer.due_date);
    if (filters.overduePeriod === 'days_over_35' && days <= 35) return false;
    if (filters.overduePeriod === 'days_over_40' && days <= 40) return false;
    if (filters.overduePeriod === 'days_over_45' && days <= 45) return false;
    if (filters.overduePeriod === 'days_over_50' && days <= 50) return false;
    if (filters.overduePeriod === 'days_over_55' && days <= 55) return false;
    if (filters.overduePeriod === 'days_over_60' && days <= 60) return false;

    // Legacy period filters
    if (filters.overduePeriod === 'less_15' && days >= 15) return false;
    if (filters.overduePeriod === '15_30' && (days < 15 || days > 30)) return false;
    if (filters.overduePeriod === 'over_30' && days <= 30) return false;
    if (filters.overduePeriod === 'over_60' && days <= 60) return false;
    if (filters.overduePeriod === 'over_120' && days <= 120) return false;
  }

  // 3. Outstanding Amount Filter
  if (filters.outstandingAmount && filters.outstandingAmount !== 'all') {
    const amt = customer.pending_amount || 0;
    if (filters.outstandingAmount === 'amt_0_100' && (amt < 0 || amt > 100)) return false;
    if (filters.outstandingAmount === 'amt_over_100' && amt <= 100) return false;
    if (filters.outstandingAmount === 'amt_over_500' && amt <= 500) return false;
    if (filters.outstandingAmount === 'amt_over_1000' && amt <= 1000) return false;
    if (filters.outstandingAmount === 'amt_over_5000' && amt <= 5000) return false;

    // Legacy amount filters
    if (filters.outstandingAmount === 'less_500' && amt >= 500) return false;
    if (filters.outstandingAmount === 'over_500' && amt <= 500) return false;
    if (filters.outstandingAmount === 'over_5000' && amt <= 5000) return false;
    if (filters.outstandingAmount === 'over_10000' && amt <= 10000) return false;
  }

  // 4. Status Filter (compatibility)
  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'pending' && customer.status === 'paid') return false;
    if (filters.status === 'overdue' && customer.status !== 'overdue' && customer.priority !== 'high' && customer.priority !== 'critical') return false;
    if (filters.status === 'collected' && customer.status !== 'paid') return false;
  }

  // 5. Search Query
  if (filters.searchQuery && filters.searchQuery.trim()) {
    const q = filters.searchQuery.toLowerCase();
    const matchName = customer.name.toLowerCase().includes(q);
    const matchId = customer.customer_id.toLowerCase().includes(q);
    const matchMeter = customer.meter_number.toLowerCase().includes(q);
    const matchAddr = customer.address.toLowerCase().includes(q);
    const matchDtc = (customer.dtc_code || '').toLowerCase().includes(q);
    if (!matchName && !matchId && !matchMeter && !matchAddr && !matchDtc) return false;
  }

  return true;
}

export default {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  getOverdueDays,
  matchCustomerFilters,
};
