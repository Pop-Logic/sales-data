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

type SlotPayload = {
  id?: string;
  weekday?: number;
  vehicleLabel?: string;
  regionId?: string | null;
  maxStores?: number | null;
  maxDollarValue?: number | null;
  active?: boolean;
};

export async function POST(request: Request) {
  let payload: SlotPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const weekday = Number(payload.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return NextResponse.json({ error: "weekday must be an integer 1-7 (Mon-Sun)." }, { status: 400 });
  }

  const vehicleLabel = String(payload.vehicleLabel ?? "").trim();
  if (!vehicleLabel) {
    return NextResponse.json({ error: "Vehicle label is required." }, { status: 400 });
  }

  const record = {
    weekday,
    vehicle_label: vehicleLabel,
    region_id: payload.regionId || null,
    max_stores: payload.maxStores != null && payload.maxStores !== undefined
      ? Math.max(0, Math.round(Number(payload.maxStores))) : null,
    max_dollar_value: payload.maxDollarValue != null ? Number(payload.maxDollarValue) : null,
    active: payload.active ?? true
  };

  try {
    const supabase = createSupabaseAdminClient();
    const query = payload.id
      ? supabase.from("driver_schedule_slots").update(record).eq("id", payload.id)
      : supabase.from("driver_schedule_slots").insert(record);
    const { data, error } = await query
      .select("id, weekday, vehicle_label, region_id, max_stores, max_dollar_value, active")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save driver schedule slot." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({
      id: data.id,
      weekday: data.weekday,
      vehicleLabel: data.vehicle_label,
      regionId: data.region_id,
      maxStores: data.max_stores,
      maxDollarValue: data.max_dollar_value,
      active: data.active
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save driver schedule slot." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("driver_schedule_slots").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete driver schedule slot." },
      { status: 500 }
    );
  }
}
