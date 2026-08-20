import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  }
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function cleanTime(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return TIME_PATTERN.test(cleaned) ? cleaned : null;
}

function cleanDays(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const days = [...new Set(value.map((day) => Number(day)))]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);
  return days;
}

export async function POST(request: Request) {
  let payload: { storeId?: string; acceptedDays?: unknown; windowStart?: unknown; windowEnd?: unknown };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const storeId = String(payload.storeId ?? "").trim();
  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  }

  const acceptedDays = cleanDays(payload.acceptedDays);
  if (!acceptedDays) {
    return NextResponse.json({ error: "acceptedDays must be an array of weekday numbers (1-7)." }, { status: 400 });
  }

  const windowStart = cleanTime(payload.windowStart);
  const windowEnd = cleanTime(payload.windowEnd);
  if (!windowStart || !windowEnd) {
    return NextResponse.json({ error: "windowStart/windowEnd must be HH:MM times." }, { status: 400 });
  }
  if (windowEnd <= windowStart) {
    return NextResponse.json({ error: "windowEnd must be after windowStart." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("stores")
      .update({
        delivery_accepted_days: acceptedDays,
        delivery_window_start: windowStart,
        delivery_window_end: windowEnd
      })
      .eq("id", storeId)
      .select("id, delivery_accepted_days, delivery_window_start, delivery_window_end")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save delivery window." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({
      storeId: data.id,
      acceptedDays: data.delivery_accepted_days,
      windowStart: data.delivery_window_start ? String(data.delivery_window_start).slice(0, 5) : null,
      windowEnd: data.delivery_window_end ? String(data.delivery_window_end).slice(0, 5) : null
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save delivery window." },
      { status: 500 }
    );
  }
}
