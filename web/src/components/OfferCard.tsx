import { ArrowUpRight, Store } from "lucide-react";
import { Link } from "react-router-dom";

import type { Offer } from "../api";
import { discountPercent, formatDate, formatPrice, initials } from "../format";

export function OfferCard({ offer }: { offer: Offer }) {
  const discount = discountPercent(offer);
  const productUrl = offer.product_id ? `/products/${offer.product_id}` : null;

  return (
    <article className="surface group flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-ink/20">
      <div className="relative flex h-40 items-center justify-center bg-[#f4f0e9] p-3 dark:bg-[#211f1c]">
        {offer.image_url ? (
          <img
            src={offer.image_url}
            alt={offer.title}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="font-display text-3xl text-muted/60">{initials(offer.title)}</span>
        )}
        {discount !== null && (
          <span className="absolute left-3 top-3 rounded-full bg-danger px-2.5 py-1 text-[11px] font-bold text-white">
            −{discount}%
          </span>
        )}
        {offer.source === "kaufda" && (
          <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Prospekt
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          <Store size={12} />
          {offer.retailer_name}
        </div>
        {productUrl ? (
          <Link to={productUrl} className="line-clamp-2 text-sm font-semibold leading-snug hover:text-accent">
            {offer.title}
          </Link>
        ) : (
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{offer.title}</h3>
        )}
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

        {offer.url && (
          <a
            href={offer.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted transition hover:text-accent"
          >
            Zum Prospekt <ArrowUpRight size={12} />
          </a>
        )}
      </div>
    </article>
  );
}
