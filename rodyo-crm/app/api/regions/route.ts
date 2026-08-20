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

type RegionPayload = {
  id?: string;
  name?: string;
  zipCodes?: unknown;
};

function cleanZipCodes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value.map((zip) => String(zip ?? "").trim()).filter(Boolean)
  )];
}

export async function POST(request: Request) {
  let payload: RegionPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const name = String(payload.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Region name is required." }, { status: 400 });
  }

  const record = {
    name,
    zip_codes: cleanZipCodes(payload.zipCodes)
  };

  try {
    const supabase = createSupabaseAdminClient();
    const query = payload.id
      ? supabase.from("regions").update(record).eq("id", payload.id)
      : supabase.from("regions").insert(record);
    const { data, error } = await query.select("id, name, zip_codes").single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save region." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ id: data.id, name: data.name, zipCodes: data.zip_codes ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save region." },
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
    // Any driver_schedule_slots pointing at this region fall back to
    // unassigned (region_id → null) via the FK's ON DELETE SET NULL, rather
    // than blocking the delete or silently orphaning a dangling reference.
    const { error } = await supabase.from("regions").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete region." },
      { status: 500 }
    );
  }
}
