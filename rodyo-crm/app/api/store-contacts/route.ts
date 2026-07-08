import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";

function cleanOptionalText(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned ? cleaned : null;
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  }

  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId")?.trim();

  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("store_contacts")
      .select("id, contact_name, phone_number, email, role")
      .eq("store_id", storeId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      contacts: (data || []).map((row) => ({
        id: row.id,
        contactName: row.contact_name,
        phoneNumber: row.phone_number,
        email: row.email,
        role: row.role
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load contacts." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let payload: {
    storeId?: string;
    id?: string | null;
    contactName?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
    role?: string | null;
  };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const storeId = cleanOptionalText(payload.storeId);
  if (!storeId) {
    return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const contactId = cleanOptionalText(payload.id);
    const fields = {
      contact_name: cleanOptionalText(payload.contactName),
      phone_number: cleanOptionalText(payload.phoneNumber),
      email: cleanOptionalText(payload.email),
      role: cleanOptionalText(payload.role),
      updated_at: new Date().toISOString()
    };

    let data, error;

    if (contactId) {
      ({ data, error } = await supabase
        .from("store_contacts")
        .update(fields)
        .eq("id", contactId)
        .eq("store_id", storeId)
        .select("id, contact_name, phone_number, email, role")
        .single());
    } else {
      ({ data, error } = await supabase
        .from("store_contacts")
        .insert({ store_id: storeId, ...fields })
        .select("id, contact_name, phone_number, email, role")
        .single());
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save buyer contact." },
        { status: 500 }
      );
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({
      contact: {
        id: data.id,
        contactName: data.contact_name,
        phoneNumber: data.phone_number,
        email: data.email,
        role: data.role
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save buyer contact." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  let payload: { id?: string; storeId?: string };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const id = cleanOptionalText(payload.id);
  const storeId = cleanOptionalText(payload.storeId);

  if (!id || !storeId) {
    return NextResponse.json({ error: "Missing id or storeId." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("store_contacts")
      .delete()
      .eq("id", id)
      .eq("store_id", storeId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete contact." },
      { status: 500 }
    );
  }
}
