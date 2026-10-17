import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/$/, '');
export const apiEnabled = Boolean(apiBaseUrl);
const tokenKey = 'azad-dairy-session-token';

export type ApiAddress = {
  id: string;
  label: 'Home' | 'Office' | 'Other';
  recipientName?: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
};

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'customer' | 'admin';
  status: 'active' | 'disabled';
  addresses: ApiAddress[];
};

export type ApiProduct = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  unit: string;
  price: number;
  originalPrice: number;
  mrp: number;
  stock: number;
  image: string;
  images: string[];
  tags: string[];
  rating: number;
  subscriptionAllowed: boolean;
  active: boolean;
  discountAmount: number;
};

export type ApiSubscription = {
  id: string;
  productId: string;
  product: { id: string; name: string; image: string; unit: string; price: number };
  plan: 'Daily' | 'Weekly' | 'Alternate' | 'Monthly';
  quantity: number;
  deliveryDays: string[];
  startDate: string;
  endDate: string | null;
  status: 'scheduled' | 'active' | 'expired' | 'cancelled';
};

export type ApiOrder = {
  id: string;
  orderNumber: string;
  status: string;
  items: { product: string; name: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  productDiscount: number;
  couponDiscount: number;
  deliveryFee: number;
  total: number;
  couponCode?: string;
  subscriptionSnapshot?: {
    productName: string;
    plan: string;
    quantity: number;
    deliveryDays: string[];
    startDate: string;
    endDate: string | null;
    status: string;
  };
  createdAt: string;
};

export async function getAuthToken(): Promise<string | null> {
  try {
    return Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(tokenKey) ?? null
      : await SecureStore.getItemAsync(tokenKey);
  } catch {
    return null;
  }
}

export async function saveAuthToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(tokenKey, token);
    return;
  }
  await SecureStore.setItemAsync(tokenKey, token);
}

export async function removeAuthToken(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(tokenKey);
    return;
  }
  await SecureStore.deleteItemAsync(tokenKey);
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  if (!apiEnabled) throw new Error('Connect the app to the admin API by setting EXPO_PUBLIC_API_URL.');
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), { ...options, headers });
  } catch {
    throw new Error('Could not reach the store service. Check the API URL and network connection.');
  }
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Store service returned ${response.status}.`);
  return payload;
}
