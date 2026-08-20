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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// A dispatcher override — no region/capacity/accepted-day checks, unlike the
// real assignment run. If the automated engine won't place an order (or
// places it somewhere the dispatcher doesn't want), this puts it directly on
// a chosen vehicle-day.
export async function POST(request: Request) {
  let payload: { orderId?: string; slotId?: string; scheduledDate?: string; orderTotal?: number };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const orderId = String(payload.orderId ?? "").trim();
  const slotId = String(payload.slotId ?? "").trim();
  const scheduledDate = String(payload.scheduledDate ?? "").trim();
  if (!orderId || !slotId) {
    return NextResponse.json({ error: "Missing orderId or slotId." }, { status: 400 });
  }
  if (!DATE_PATTERN.test(scheduledDate)) {
    return NextResponse.json({ error: "scheduledDate must be YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();

    let orderTotal = Number(payload.orderTotal);
    if (!Number.isFinite(orderTotal)) {
      const { data: items } = await supabase.from("order_items").select("line_total").eq("order_id", orderId);
      orderTotal = (items || []).reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
    }

    const { data, error } = await supabase
      .from("order_deliveries")
      .upsert(
        { order_id: orderId, slot_id: slotId, scheduled_date: scheduledDate, order_total: orderTotal },
        { onConflict: "order_id" }
      )
      .select("order_id, slot_id, scheduled_date, order_total")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Could not save assignment." }, { status: 500 });
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({
      orderId: data.order_id,
      slotId: data.slot_id,
      scheduledDate: data.scheduled_date,
      orderTotal: Number(data.order_total ?? 0)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save assignment." },
      { status: 500 }
    );
  }
}

// Removes an order from whatever route it's on (e.g. undoing a mis-assign),
// dropping it back into the due-date queue as unscheduled.
export async function DELETE(request: Request) {
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("order_deliveries").delete().eq("order_id", orderId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove assignment." },
      { status: 500 }
    );
  }
}
