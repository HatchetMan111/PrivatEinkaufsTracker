export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatWeek(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `Woche ab ${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long" }).format(date)}`;
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks === 1 ? "vor 1 Woche" : `vor ${weeks} Wochen`;
  return formatDate(value);
}

export function discountPercent(offer: { price: number; old_price: number | null }): number | null {
  if (!offer.old_price || offer.old_price <= offer.price) return null;
  return Math.round((1 - offer.price / offer.old_price) * 100);
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/* Gedämpfte Palette passend zum warmen Themen-Look; Zuweisung per
   deterministischem Hash, damit jeder Händler immer dieselbe Farbe bekommt. */
const RETAILER_PALETTE = [
  "#1f5f4a",
  "#b4442f",
  "#3b6ea5",
  "#946200",
  "#7d5ba6",
  "#8c4a5e",
  "#4e6b51",
  "#a05a2c",
] as const;

export function retailerColor(slugOrName: string): string {
  const key = slugOrName.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return RETAILER_PALETTE[hash % RETAILER_PALETTE.length];
}
