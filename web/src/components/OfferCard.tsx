import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import type { Offer } from "../api";
import { discountPercent, formatDate, formatPrice, initials, retailerColor } from "../format";

export function OfferCard({ offer, sortBy }: { offer: Offer; sortBy?: string }) {
  const discount = discountPercent(offer);
  const saving = offer.old_price && offer.old_price > offer.price ? offer.old_price - offer.price : null;
  const productUrl = offer.product_id ? `/products/${offer.product_id}` : null;

  return (
    <article className="surface group relative flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-lift">
      <div className="relative flex h-40 items-center justify-center bg-surface2 p-3">
        {offer.image_url ? (
          <img
            src={offer.image_url}
            alt={offer.title}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-16 w-16 place-items-center rounded-2xl bg-surface font-display text-xl text-muted/70 shadow-card"
          >
            {initials(offer.title)}
          </span>
        )}
        {discount !== null && (
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold text-white ${
              sortBy === "discount" ? "bg-danger" : "bg-danger/80"
            }`}
          >
            −{discount}%
          </span>
        )}
        {offer.source === "kaufda" && (
          <span className="absolute right-3 top-3 rounded-full bg-surface/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Prospekt
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          <span
            aria-hidden
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md text-[8px] font-bold text-white"
            style={{ backgroundColor: retailerColor(offer.retailer_slug) }}
          >
            {initials(offer.retailer_name)}
          </span>
          {offer.retailer_name}
        </div>

        <h3 className="line-clamp-2 text-sm font-semibold leading-snug group-hover:text-accenttext">
          {/* Der Overlay-Link unten macht die ganze Karte klickbar. */}
          {offer.title}
        </h3>
        {offer.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted">{offer.description}</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">{formatPrice(offer.price)}</span>
              {offer.old_price && (
                <span className="text-xs text-muted line-through">{formatPrice(offer.old_price)}</span>
              )}
            </div>
            {offer.base_price && <div className="text-[11px] text-muted">{offer.base_price}</div>}
          </div>
          <span className="text-[11px] text-muted">bis {formatDate(offer.valid_to)}</span>
        </div>

        {saving !== null && (
          <div
            className={
              sortBy === "saving"
                ? "text-[12px] font-bold text-accenttext"
                : "text-[11px] font-semibold text-muted"
            }
          >
            Du sparst {formatPrice(saving)}
          </div>
        )}

        {offer.url && (
          <a
            href={offer.url}
            target="_blank"
            rel="noreferrer"
            className="relative z-10 mt-1 inline-flex w-fit items-center gap-1 rounded-md text-[11px] font-medium text-muted transition hover:text-accent"
          >
            Zum Prospekt <ArrowUpRight size={12} />
          </a>
        )}
      </div>

      {productUrl && (
        <Link
          to={productUrl}
          aria-label={`Details zu ${offer.title}`}
          className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="sr-only">Details öffnen</span>
        </Link>
      )}
    </article>
  );
}
