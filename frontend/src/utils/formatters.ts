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

export function getOverdueDays(customerOrDueDate?: any): number {
  if (!customerOrDueDate) return 0;

  // 1. If an object/customer was passed, prioritize customer.pending_days
  if (typeof customerOrDueDate === 'object') {
    const rawDays =
      customerOrDueDate.pending_days ??
      customerOrDueDate.pendingDays ??
      customerOrDueDate['pending days'] ??
      customerOrDueDate.days;

    if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
      const parsed = parseInt(String(rawDays).trim(), 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    customerOrDueDate = customerOrDueDate.due_date;
  }

  if (typeof customerOrDueDate === 'number') {
    return isNaN(customerOrDueDate) ? 0 : Math.max(0, customerOrDueDate);
  }

  if (typeof customerOrDueDate === 'string') {
    const trimmed = customerOrDueDate.trim();
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    try {
      const due = new Date(trimmed);
      if (!isNaN(due.getTime())) {
        const today = new Date();
        due.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const diffTime = today.getTime() - due.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
      }
    } catch {
      return 0;
    }
  }
  return 0;
}

export function matchCustomerFilters(
  customer: {
    pending_amount: number;
    due_date?: string;
    pending_days?: number | string;
    disconnection_status?: string;
    status: string;
    priority?: string;
    name: string;
    customer_id: string;
    meter_number: string;
    address: string;
    phone?: string;
    dtc_code?: string;
  },
  filters: {
    overduePeriod?: string;
    outstandingAmount?: string;
    disconnectionStatus?: string;
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

  // 2. Disconnection Status / Action Mode Filter (TD, PD, BUR, DIS, OTHER)
  if (filters.disconnectionStatus && filters.disconnectionStatus !== 'all') {
    const filterKey = filters.disconnectionStatus.toLowerCase().trim();
    const custDisconn = String(customer.disconnection_status || '').toLowerCase().trim();
    const custStatus = String(customer.status || '').toLowerCase().trim();

    if (filterKey === 'other') {
      const isStandard = ['td', 'pd', 'bur', 'dis'].some(k => custDisconn.includes(k) || custStatus.includes(k));
      if (isStandard) return false;
    } else {
      if (!custDisconn.includes(filterKey) && !custStatus.includes(filterKey)) return false;
    }
  }

  // 3. Overdue Period Filter (Days overdue - checks pending_days first)
  if (filters.overduePeriod && filters.overduePeriod !== 'all') {
    const days = getOverdueDays(customer);
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

  // 4. Outstanding Amount Filter
  if (filters.outstandingAmount && filters.outstandingAmount !== 'all') {
    const amt = typeof customer.pending_amount === 'number'
      ? customer.pending_amount
      : parseFloat(String(customer.pending_amount || 0)) || 0;

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

  // 5. Status Filter (compatibility)
  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'pending' && customer.status === 'paid') return false;
    if (filters.status === 'overdue' && customer.status !== 'overdue' && customer.priority !== 'high' && customer.priority !== 'critical') return false;
    if (filters.status === 'collected' && customer.status !== 'paid') return false;
  }

  // 6. Search Query
  if (filters.searchQuery && filters.searchQuery.trim()) {
    const q = filters.searchQuery.toLowerCase().trim();
    const matchName = (customer.name || '').toLowerCase().includes(q);
    const matchId = (customer.customer_id || '').toLowerCase().includes(q);
    const matchMeter = (customer.meter_number || '').toLowerCase().includes(q);
    const matchAddr = (customer.address || '').toLowerCase().includes(q);
    const matchPhone = (customer.phone || '').toLowerCase().includes(q);
    const matchDtc = (customer.dtc_code || '').toLowerCase().includes(q);
    if (!matchName && !matchId && !matchMeter && !matchAddr && !matchDtc && !matchPhone) return false;
  }

  return true;
}

/**
 * Determines whether a customer belongs to a specific disconnection/action status category.
 * Priority order: TD -> PD -> BUR -> DIS -> OTHER (Normally Connected)
 */
export function isCustomerInStatusCategory(
  customer: { disconnection_status?: string | null; status?: string | null },
  category: 'TD' | 'PD' | 'BUR' | 'DIS' | 'OTHER' | string
): boolean {
  const cat = (category || '').toUpperCase().trim();
  const custDisconn = String(customer.disconnection_status || '').toUpperCase().trim();
  const custStatus = String(customer.status || '').toUpperCase().trim();

  const isTD = custDisconn.includes('TD') || custStatus.includes('TD');
  const isPD = !isTD && (custDisconn.includes('PD') || custStatus.includes('PD'));
  const isBUR = !isTD && !isPD && (custDisconn.includes('BUR') || custStatus.includes('BUR'));
  const isDIS = !isTD && !isPD && !isBUR && (
    custDisconn.includes('DIS') || custDisconn.includes('DISPUT') ||
    custStatus.includes('DIS') || custStatus.includes('DISPUT')
  );
  const isOTHER = !isTD && !isPD && !isBUR && !isDIS;

  if (cat === 'TD') return isTD;
  if (cat === 'PD') return isPD;
  if (cat === 'BUR') return isBUR;
  if (cat === 'DIS') return isDIS;
  if (cat === 'OTHER' || cat === 'NORMAL' || cat === 'NC') return isOTHER;
  return false;
}

/**
 * Accurately extracts the collected amount for a customer by checking direct collected_amount
 * or mapping against the payments dictionary.
 */
export function getCustomerCollectedAmount(
  customer: { customer_id: string; meter_number?: string | null; collected_amount?: number },
  paymentsMap: Record<string, number> = {}
): number {
  const direct = Number(customer.collected_amount || 0);
  const fromPmt = Number(
    paymentsMap[customer.customer_id] ||
    (customer.meter_number ? paymentsMap[customer.meter_number] : 0) ||
    0
  );
  return direct > 0 ? direct : fromPmt;
}

export default {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  getOverdueDays,
  matchCustomerFilters,
  isCustomerInStatusCategory,
  getCustomerCollectedAmount,
};

