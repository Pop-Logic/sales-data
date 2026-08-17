import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

type LedgerPayload = {
  packagingItemId?: string;
  entryType?: string;
  qty?: number;
  note?: string | null;
  initials?: string | null;
  loggedAt?: string | null;
  // Order date, passed only by the Order Received flow — used to compute
  // and store the realized lead time alongside this receive entry.
  orderedAt?: string | null;
  clearOnOrder?: boolean;
  // Set only by the Order Received flow (PackagingOrderForm), which is
  // always receiving against a specific tracked order. The plain "Received
  // shipment" manual log entry (PackagingLedgerForm) never sets this, since
  // it's a freeform stock addition with no order to require.
  requireActiveOrder?: boolean;
};

// Manual ledger entries only — 'consume' is reserved for the automatic
// batch-driven depletion and cannot be posted through this route.
const MANUAL_TYPES = new Set(["count", "receive", "adjust"]);

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Falls back to today rather than rejecting, same as the contact-logs route —
// a blank/garbled date shouldn't block saving the entry itself.
function cleanLoggedAt(value: unknown) {
  const cleaned = String(value ?? "").trim() || localDateValue();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return localDateValue();
  }
  const parsed = new Date(`${cleaned}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? localDateValue() : cleaned;
}

// Optional and stricter than cleanLoggedAt — an invalid orderedAt just means
// no lead time gets recorded, it shouldn't get silently coerced to today.
function cleanOrderedAt(value: unknown) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned || !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return null;
  }
  const parsed = new Date(`${cleaned}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : cleaned;
}

function leadTimeDaysBetween(orderedAt: string, loggedAt: string) {
  const ordered = new Date(`${orderedAt}T00:00:00Z`).getTime();
  const delivered = new Date(`${loggedAt}T00:00:00Z`).getTime();
  const days = Math.round((delivered - ordered) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export async function POST(request: Request) {
  let payload: LedgerPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const packagingItemId = String(payload.packagingItemId ?? "").trim();
  const entryType = String(payload.entryType ?? "").trim();
  const qty = Number(payload.qty);
  const loggedAt = cleanLoggedAt(payload.loggedAt);
  const orderedAt = cleanOrderedAt(payload.orderedAt);
  const leadTimeDays = orderedAt ? leadTimeDaysBetween(orderedAt, loggedAt) : null;

  if (!packagingItemId) return NextResponse.json({ error: "Missing packagingItemId." }, { status: 400 });
  if (!MANUAL_TYPES.has(entryType)) {
    return NextResponse.json({ error: "entryType must be count, receive, or adjust." }, { status: 400 });
  }
  if (!Number.isFinite(qty)) return NextResponse.json({ error: "qty must be a number." }, { status: 400 });
  if (entryType === "count" && qty < 0) {
    return NextResponse.json({ error: "A count cannot be negative." }, { status: 400 });
  }
  if (entryType === "receive" && qty <= 0) {
    return NextResponse.json({ error: "Received quantity must be positive." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    // The Order Received flow atomically claims the item's open order before
    // any ledger row is written. This is what stops the same shipment from
    // being received twice (double-click, a stale tab, two people scanning
    // the same box) — the claim can only succeed once, so a second attempt
    // finds on_order_qty already null (or ordered_at already moved on) and is
    // rejected instead of double-crediting on-hand. The plain "Received
    // shipment" manual log entry has no order to claim, so it skips this and
    // just opportunistically clears an on-order flag if one happens to be set.
    if (entryType === "receive" && payload.requireActiveOrder) {
      let claimQuery = supabase
        .from("packaging_items")
        .update({ on_order_qty: null, on_order_eta: null })
        .eq("id", packagingItemId)
        .not("on_order_qty", "is", null);
      if (orderedAt) {
        claimQuery = claimQuery.eq("on_order_eta", orderedAt);
      }
      const { data: claimed, error: claimError } = await claimQuery.select("id");
      if (claimError) {
        return NextResponse.json({ error: claimError.message }, { status: 500 });
      }
      if (!claimed || claimed.length === 0) {
        return NextResponse.json(
          { error: "This shipment has already been received. Refresh the page to see the current status." },
          { status: 409 }
        );
      }
    } else if (entryType === "receive" && payload.clearOnOrder !== false) {
      await supabase
        .from("packaging_items")
        .update({ on_order_qty: null, on_order_eta: null })
        .eq("id", packagingItemId)
        .not("on_order_qty", "is", null);
    }

    const baseRow = {
      packaging_item_id: packagingItemId,
      entry_type: entryType,
      qty,
      note: payload.note ? String(payload.note).trim() || null : null,
      initials: payload.initials ? String(payload.initials).trim().toUpperCase() || null : null,
      // Noon UTC so the date displays correctly regardless of viewer
      // timezone (formatShortDate always renders in UTC).
      created_at: `${loggedAt}T12:00:00.000Z`
    };

    let { data, error } = await supabase
      .from("packaging_ledger")
      .insert({ ...baseRow, ordered_at: orderedAt, lead_time_days: leadTimeDays })
      .select("id")
      .single();

    // ordered_at/lead_time_days columns may not exist yet in this
    // environment — fall back to the base row so the receive itself (and the
    // on-hand/on-order update below) still goes through.
    if (error) {
      ({ data, error } = await supabase.from("packaging_ledger").insert(baseRow).select("id").single());
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save ledger entry." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ id: data.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save ledger entry." },
      { status: 500 }
    );
  }
}
