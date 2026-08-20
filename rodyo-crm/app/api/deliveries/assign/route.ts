import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { DASHBOARD_DATA_TAG } from "@/lib/dashboard-data";
import { addDaysUtc, computeDeliveryAssignments, dateOnly, type PendingDeliveryOrder } from "@/lib/delivery-scheduling";
import { DELIVERY_QUEUE_CUTOFF } from "@/lib/rules";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

const DEFAULT_ACCEPTED_DAYS = [1, 2, 3, 4, 5];

export async function POST() {
  try {
    const supabase = createSupabaseAdminClient();
    const today = dateOnly(new Date().toISOString()) as string;

    const [
      { data: storeRows, error: storeError },
      { data: orderRows, error: orderError },
      { data: existingRows, error: existingError },
      { data: regionRows, error: regionError },
      { data: slotRows, error: slotError }
    ] = await Promise.all([
      supabase.from("crm_store_rollup").select("store_id, zip, delivery_accepted_days"),
      supabase
        .from("orders")
        .select("id, store_id, submitted_at, transfer_date, order_items(line_total)")
        .not("submitted_at", "is", null),
      supabase.from("order_deliveries").select("order_id, slot_id, scheduled_date, order_total"),
      supabase.from("regions").select("id, zip_codes"),
      supabase.from("driver_schedule_slots").select("id, weekday, region_id, max_stores, max_dollar_value, active")
    ]);

    if (storeError || orderError || existingError || regionError || slotError) {
      const error = storeError || orderError || existingError || regionError || slotError;
      return NextResponse.json({ error: error?.message || "Could not load scheduling data." }, { status: 500 });
    }

    const storesById = new Map(
      (storeRows || []).map((row) => [
        String(row.store_id),
        {
          zip: row.zip ? String(row.zip) : null,
          acceptedDays: Array.isArray(row.delivery_accepted_days) && row.delivery_accepted_days.length
            ? row.delivery_accepted_days.map((day: unknown) => Number(day))
            : DEFAULT_ACCEPTED_DAYS
        }
      ])
    );

    const alreadyAssignedOrderIds = new Set((existingRows || []).map((row) => String(row.order_id)));

    const pendingOrders: PendingDeliveryOrder[] = (orderRows || [])
      .filter((row) => {
        const submittedDate = dateOnly(row.submitted_at as string | null);
        return !row.transfer_date
          && !alreadyAssignedOrderIds.has(String(row.id))
          && submittedDate
          && submittedDate >= DELIVERY_QUEUE_CUTOFF;
      })
      .map((row) => {
        const store = row.store_id ? storesById.get(String(row.store_id)) : undefined;
        const submittedDate = dateOnly(row.submitted_at as string | null);
        const items = Array.isArray(row.order_items) ? row.order_items : [];
        const total = items.reduce((sum, item) => sum + Number(item?.line_total ?? 0), 0);
        return {
          orderId: String(row.id),
          storeId: row.store_id ? String(row.store_id) : null,
          zip: store?.zip ?? null,
          total,
          slaDeadline: submittedDate ? addDaysUtc(submittedDate, 7) : today,
          acceptedDays: store?.acceptedDays ?? DEFAULT_ACCEPTED_DAYS
        };
      })
      .filter((order) => order.total > 0);

    const regions = (regionRows || []).map((row) => ({
      id: String(row.id),
      zipCodes: Array.isArray(row.zip_codes) ? row.zip_codes.map((zip: unknown) => String(zip)) : []
    }));

    const slots = (slotRows || []).map((row) => ({
      id: String(row.id),
      weekday: Number(row.weekday),
      regionId: row.region_id ? String(row.region_id) : null,
      maxStores: row.max_stores != null ? Number(row.max_stores) : null,
      maxDollarValue: row.max_dollar_value != null ? Number(row.max_dollar_value) : null,
      active: Boolean(row.active ?? true)
    }));

    const existingAssignments = (existingRows || []).map((row) => ({
      slotId: String(row.slot_id),
      scheduledDate: String(row.scheduled_date),
      orderTotal: Number(row.order_total ?? 0)
    }));

    const { assignments, unschedulable } = computeDeliveryAssignments({
      today,
      orders: pendingOrders,
      slots,
      regions,
      existingAssignments
    });

    if (assignments.length) {
      const orderTotalById = new Map(pendingOrders.map((order) => [order.orderId, order.total]));
      const rows = assignments.map((assignment) => ({
        order_id: assignment.orderId,
        slot_id: assignment.slotId,
        scheduled_date: assignment.scheduledDate,
        order_total: orderTotalById.get(assignment.orderId) ?? 0
      }));
      const { error: insertError } = await supabase.from("order_deliveries").insert(rows);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    revalidateTag(DASHBOARD_DATA_TAG, "max");

    return NextResponse.json({
      considered: pendingOrders.length,
      assigned: assignments.length,
      unschedulable: unschedulable.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not run delivery assignment." },
      { status: 500 }
    );
  }
}
