export type Location = {
  id: number;
  name: string;
  zip: string;
  kaufda_slug: string | null;
  active: number;
};

export type Retailer = {
  id: number;
  name: string;
  slug: string;
  source: "marktguru" | "kaufda";
  active: number;
};

export type Offer = {
  id: number;
  title: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  price: number;
  old_price: number | null;
  base_price: string | null;
  unit: string | null;
  quantity: number | null;
  valid_from: string | null;
  valid_to: string | null;
  week_start: string;
  image_url: string | null;
  url: string | null;
  source: string;
  retailer_name: string;
  retailer_slug: string;
  product_id: number | null;
};

export type OfferSort = "discount" | "saving" | "price_asc" | "price_desc" | "title" | "newest";

export type OffersResponse = {
  week_start: string;
  total: number;
  items: Offer[];
};

export type Stats = {
  week_start: string;
  offers: number;
  retailers: number;
  discounted: number;
  new_products: number;
  price_drops: number;
  best_discount: {
    id: number;
    title: string;
    price: number;
    old_price: number;
    saving: number;
    percent: number;
    retailer_name: string;
  } | null;
};

export type Run = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "partial" | "failed";
  trigger: string;
  items_found: number;
  error: string | null;
};

export type PricePoint = {
  week_start: string;
  price: number;
  observed_at: string;
  offer_id: number;
  title: string;
  old_price: number | null;
  valid_from: string | null;
  valid_to: string | null;
  url: string | null;
  image_url: string | null;
  retailer_name: string;
};

export type Product = {
  id: number;
  canonical_name: string;
  brand: string | null;
  unit_key: string | null;
  retailer_name: string;
};

export type History = {
  product: Product;
  points: PricePoint[];
  weeks: { week_start: string; min_price: number; avg_price: number; count: number }[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  locations: () => request<Location[]>("/api/locations"),
  createLocation: (payload: { name: string; zip: string; kaufda_slug?: string | null }) =>
    request<Location>("/api/locations", { method: "POST", body: JSON.stringify(payload) }),
  updateLocation: (id: number, payload: { name: string; zip: string; kaufda_slug?: string | null }) =>
    request<Location>(`/api/locations/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteLocation: (id: number) =>
    request<{ status: string }>(`/api/locations/${id}`, { method: "DELETE" }),
  retailers: () => request<Retailer[]>("/api/retailers"),
  updateRetailer: (id: number, active: boolean) =>
    request<Retailer>(`/api/retailers/${id}`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }),
  offers: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") search.set(key, String(value));
    });
    return request<OffersResponse>(`/api/offers?${search.toString()}`);
  },
  stats: (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") search.set(key, String(value));
    });
    return request<Stats>(`/api/stats?${search.toString()}`);
  },
  runs: () => request<Run[]>("/api/runs"),
  refresh: () => request<{ status: string }>("/api/refresh", { method: "POST" }),
  products: (q: string) =>
    request<Product[]>(`/api/products?limit=20&q=${encodeURIComponent(q)}`),
  history: (id: number) => request<History>(`/api/products/${id}/history`),
  merge: (id: number, sourceIds: number[]) =>
    request<{ status: string }>(`/api/products/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ source_product_ids: sourceIds }),
    }),
  split: (id: number, offerIds: number[]) =>
    request<{ status: string; new_product_id: number }>(`/api/products/${id}/split`, {
      method: "POST",
      body: JSON.stringify({ offer_ids: offerIds }),
    }),
};
