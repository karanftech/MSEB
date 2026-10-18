import api from './api';
import { Customer, NearbyCustomer, DTCCodesResponse } from '@/types';

interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

const CACHE_TTL_MS = 30000; // 30 seconds short-lived memory cache
const cacheStore = new Map<string, CacheEntry<any>>();

if (typeof window !== 'undefined') {
  window.addEventListener('customers-updated', () => {
    cacheStore.clear();
  });
}

export const customerService = {
  clearCache() {
    cacheStore.clear();
  },

  async getCustomers(params?: {
    area?: string;
    dtc_code?: string;
    status?: string;
    min_amount?: number;
    max_amount?: number;
    assigned_officer_id?: string;
    all_officers?: boolean;
    search?: string;
    limit?: number;
  }): Promise<Customer[]> {
    const key = `customers:${JSON.stringify(params || {})}`;
    const cached = cacheStore.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const response = await api.get<Customer[]>('/api/customers', {
      params: { limit: 1000, ...params },
    });

    cacheStore.set(key, { timestamp: Date.now(), data: response.data });
    return response.data;
  },

  async getDtcCodes(all_officers: boolean = false): Promise<DTCCodesResponse> {
    const key = `dtc_codes:${all_officers}`;
    const cached = cacheStore.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const response = await api.get<DTCCodesResponse>('/api/customers/dtc-codes', {
      params: { all_officers },
    });

    cacheStore.set(key, { timestamp: Date.now(), data: response.data });
    return response.data;
  },

  async getNearbyCustomers(
    latitude: number,
    longitude: number,
    radius: number = 5000,
    status?: string
  ): Promise<NearbyCustomer[]> {
    const response = await api.get<NearbyCustomer[]>('/api/customers/nearby', {
      params: { latitude, longitude, radius, status },
    });
    return response.data;
  },

  async getCustomerById(id: string): Promise<Customer> {
    const response = await api.get<Customer>(`/api/customers/${id}`);
    return response.data;
  },

  async createCustomer(data: Partial<Customer>): Promise<Customer> {
    const response = await api.post<Customer>('/api/customers', data);
    this.clearCache();
    return response.data;
  },

  async uploadCustomers(file: File, replaceAll: boolean = true): Promise<{
    success: boolean;
    filename: string;
    total_processed: number;
    inserted_count: number;
    updated_count: number;
    deleted_count: number;
    errors: string[];
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post(`/api/customers/upload?replace_all=${replaceAll}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    this.clearCache();
    return response.data;
  },
};

