import api from './api';
import { User } from '@/types';

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

const TOKEN_KEY = 'mv_token';
const USER_KEY = 'mv_user';

function saveSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (typeof window !== 'undefined') {
    const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `mv_token=${token}; path=/; max-age=86400; SameSite=Lax${secureFlag}`;
    window.dispatchEvent(new Event('auth-change'));
  }
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Also clear any old keys from previous implementation
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  if (typeof window !== 'undefined') {
    document.cookie = 'mv_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    window.dispatchEvent(new Event('auth-change'));
  }
}

export const authService = {
  async register(data: {
    full_name: string;
    email: string;
    password: string;
    phone?: string;
    assigned_area?: string;
  }): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/register', data);
    if (response.data.access_token) {
      saveSession(response.data.access_token, response.data.user);
    }
    return response.data;
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/login', { email, password });
    if (response.data.access_token) {
      saveSession(response.data.access_token, response.data.user);
    }
    return response.data;
  },

  async logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Ignore network failures on logout
    } finally {
      clearSession();
    }
  },

  async getMe(): Promise<User> {
    const response = await api.get<User>('/api/auth/me');
    localStorage.setItem(USER_KEY, JSON.stringify(response.data));
    return response.data;
  },

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  getCurrentUser(): User | null {
    if (typeof window === 'undefined') return null;

    const token = localStorage.getItem(TOKEN_KEY);
    const userStr = localStorage.getItem(USER_KEY);
    if (!token || !userStr) return null;

    try {
      // Check client-side JWT token expiration
      const tokenParts = token.split('.');
      if (tokenParts.length === 3) {
        let base64 = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4 !== 0) base64 += '=';
        const payload = JSON.parse(
          decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          )
        );
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          clearSession();
          return null;
        }
      }
      return JSON.parse(userStr);
    } catch {
      // Token decode failed but userStr may still be valid — return it
      try {
        return JSON.parse(userStr);
      } catch {
        clearSession();
        return null;
      }
    }
  },
};
