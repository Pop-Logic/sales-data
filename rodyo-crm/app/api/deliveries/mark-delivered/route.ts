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

// Manual delivered-confirmation, stored separately from Cultivera's
// transfer_date so it survives the next sync instead of being overwritten.
export async function POST(request: Request) {
  let payload: { orderId?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const orderId = String(payload.orderId ?? "").trim();
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("orders")
      .update({ manual_delivered_at: new Date().toISOString() })
      .eq("id", orderId)
      .select("id, manual_delivered_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Could not mark delivered." }, { status: 500 });
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ orderId: data.id, manualDeliveredAt: data.manual_delivered_at });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not mark delivered." },
      { status: 500 }
    );
  }
}

// Undo — clears the manual mark (e.g. it was set by mistake).
export async function DELETE(request: Request) {
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("orders").update({ manual_delivered_at: null }).eq("id", orderId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not undo delivered mark." },
      { status: 500 }
    );
  }
}
