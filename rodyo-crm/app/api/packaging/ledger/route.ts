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
  clearOnOrder?: boolean;
};

// Manual ledger entries only — 'consume' is reserved for the automatic
// batch-driven depletion and cannot be posted through this route.
const MANUAL_TYPES = new Set(["count", "receive", "adjust"]);

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
    const { data, error } = await supabase
      .from("packaging_ledger")
      .insert({
        packaging_item_id: packagingItemId,
        entry_type: entryType,
        qty,
        note: payload.note ? String(payload.note).trim() || null : null
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save ledger entry." },
        { status: 500 }
      );
    }

    // Receiving a shipment clears the on-order flag unless told otherwise
    if (entryType === "receive" && payload.clearOnOrder !== false) {
      await supabase
        .from("packaging_items")
        .update({ on_order_qty: null, on_order_eta: null })
        .eq("id", packagingItemId);
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
