export type UserRole = 'field_officer';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone?: string;
  officer_id?: string;
  is_active: boolean;
}

export interface Meter {
  meter_id: string;
  meter_number: string;
  customer_id: string;
  latitude: number;
  longitude: number;
  dtc_code?: string;
  assigned_officer_id?: string;
  assigned_officer_name?: string;
  uploaded_by_officer_id?: string;
}


export interface Customer {
  id: string;
  customer_id: string;
  name: string;
  meter_number: string;
  phone: string;
  email?: string;
  address: string;
  area: string;
  latitude: number;
  longitude: number;
  dtc_code?: string;
  pending_amount: number;
  due_date?: string;
  pending_days?: number | string;
  disconnection_status?: string;
  status: 'pending' | 'overdue' | 'paid' | 'partially_paid';
  priority?: 'normal' | 'high' | 'critical';
  assigned_officer_id?: string;
  assigned_officer_name?: string;
  uploaded_by_officer_id?: string;
  meters: Meter[];
  distance_meters?: number;
  estimated_duration_mins?: number;
  created_at?: string;
  updated_at?: string;
}


export interface DTCCodeOption {
  code: string;
  meter_count: number;
}

export interface DTCCodesResponse {
  total_dtcs: number;
  total_meters: number;
  dtcs: DTCCodeOption[];
}


export interface NearbyCustomer extends Customer {
  distance_meters: number;
  estimated_duration_mins: number;
}

export interface Bill {
  id: string;
  bill_id: string;
  customer_id: string;
  customer_name?: string;
  meter_id: string;
  meter_number: string;
  billing_period: string;
  bill_amount: number;
  paid_amount: number;
  pending_amount: number;
  due_date: string;
  status: 'pending' | 'overdue' | 'paid' | 'partially_paid';
  assigned_officer_id?: string;
  assigned_officer_name?: string;
}

export interface PaymentCollectionPayload {
  bill_id?: string;
  customer_id: string;
  meter_id?: string;
  amount: number;
  payment_method: 'cash' | 'upi' | 'online' | 'other' | 'upi_online' | 'cheque' | 'td' | 'pd' | 'bur' | 'dis';
  disconnection_status?: string;
  transaction_reference?: string;
  remarks?: string;
  collection_latitude?: number;
  collection_longitude?: number;
}

export interface PaymentRecord {
  id: string;
  receipt_number: string;
  payment_id: string;
  bill_id?: string;
  customer_id: string;
  customer_name?: string;
  meter_id?: string;
  meter_number?: string;
  officer_id: string;
  officer_name?: string;
  amount: number;
  payment_method: string;
  disconnection_status?: string;
  transaction_reference?: string;
  remarks?: string;
  previous_pending_amount: number;
  remaining_pending_amount: number;
  bill_status: string;
  created_at: string;
}

export interface DigitalReceipt {
  organization_name: string;
  receipt_number: string;
  date_time: string;
  customer_name: string;
  customer_id: string;
  meter_number: string;
  address: string;
  collected_amount: number;
  payment_method: string;
  disconnection_status?: string;
  transaction_reference: string;
  field_officer_name: string;
  field_officer_id: string;
  previous_pending: number;
  remaining_balance: number;
  status: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteCalculationResult {
  distance_meters: number;
  distance_text: string;
  duration_seconds: number;
  duration_text: string;
  start_address: string;
  end_address: string;
  encoded_polyline: string;
  coordinates_path: Coordinates[];
  steps: {
    instruction: string;
    distance_text: string;
    duration_text: string;
    end_location?: Coordinates;
  }[];
}

export interface MultiRouteStop {
  sequence: number;
  customer_id: string;
  name: string;
  meter_number: string;
  pending_amount: number;
  address: string;
  latitude: number;
  longitude: number;
  distance_from_prev_meters: number;
  distance_from_prev_text: string;
  duration_from_prev_text: string;
}

export interface MultiRouteCalculationResult {
  total_distance_meters: number;
  total_distance_text: string;
  total_duration_seconds: number;
  total_duration_text: string;
  coordinates_path: Coordinates[];
  stops: MultiRouteStop[];
}


export interface OfficerDashboardMetrics {
  total_assigned_customers: number;
  total_pending_amount: number;
  number_of_pending_bills: number;
  number_of_completed_collections: number;
  todays_collection_target: number;
  todays_collected_amount: number;
  remaining_collections_count: number;
  remaining_collections_amount: number;
  td_customers_count?: number;
  td_pending_amount?: number;
  pd_customers_count?: number;
  pd_pending_amount?: number;
  bur_customers_count?: number;
  bur_pending_amount?: number;
  dis_customers_count?: number;
  dis_pending_amount?: number;
  nearby_pending_customers: NearbyCustomer[];
}

export type OverduePeriodFilter =
  | 'all'
  | 'days_over_35'
  | 'days_over_40'
  | 'days_over_45'
  | 'days_over_50'
  | 'days_over_55'
  | 'days_over_60'
  | 'less_15'
  | '15_30'
  | 'over_30'
  | 'over_60'
  | 'over_120';

export type OutstandingAmountFilter =
  | 'all'
  | 'amt_0_100'
  | 'amt_over_100'
  | 'amt_over_500'
  | 'amt_over_1000'
  | 'amt_over_5000'
  | 'less_500'
  | 'over_500'
  | 'over_5000'
  | 'over_10000';

export interface MapFilterState {
  status?: 'all' | 'pending' | 'overdue' | 'high_amount' | 'due_today' | 'due_week' | 'collected';
  dtcCode?: string;
  overduePeriod: OverduePeriodFilter;
  outstandingAmount: OutstandingAmountFilter;
  searchQuery: string;
}

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type MapLayerType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

export interface NavigationState {
  active: boolean;
  destination?: GeoPoint;
  targetCustomer?: Customer;
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
  currentStepIndex: number;
  currentStepInstruction: string;
  isOffRoute: boolean;
  isFollowing: boolean;
}

export interface StreetViewState {
  isOpen: boolean;
  isAvailable: boolean;
  isChecking: boolean;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  customerName?: string;
  address?: string;
}
