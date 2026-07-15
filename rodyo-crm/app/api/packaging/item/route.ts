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

type ItemPayload = {
  id?: string;
  name?: string;
  vendor?: string | null;
  leadTimeDays?: number;
  reorderQty?: number | null;
  parOverride?: number | null;
  onOrderQty?: number | null;
  onOrderEta?: string | null;
  notes?: string | null;
  active?: boolean;
};

export async function POST(request: Request) {
  let payload: ItemPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const name = String(payload.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Item name is required." }, { status: 400 });

  const record = {
    name,
    vendor: payload.vendor ? String(payload.vendor).trim() || null : null,
    lead_time_days: Math.max(1, Math.round(Number(payload.leadTimeDays ?? 14)) || 14),
    reorder_qty: payload.reorderQty != null ? Number(payload.reorderQty) : null,
    par_override: payload.parOverride != null ? Number(payload.parOverride) : null,
    on_order_qty: payload.onOrderQty != null ? Number(payload.onOrderQty) : null,
    on_order_eta: payload.onOrderEta || null,
    notes: payload.notes ? String(payload.notes).trim() || null : null,
    active: payload.active ?? true
  };

  try {
    const supabase = createSupabaseAdminClient();
    const query = payload.id
      ? supabase.from("packaging_items").update(record).eq("id", payload.id)
      : supabase.from("packaging_items").insert(record);
    const { data, error } = await query.select("id").single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save packaging item." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ id: data.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save packaging item." },
      { status: 500 }
    );
  }
}
