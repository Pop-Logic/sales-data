// Pure delivery-assignment logic — no I/O, safe to import from both the
// server (the real persisted assignment run) and the client (live "would
// this place?" status in the due-date queue, computed against current
// config before anyone clicks Run Assignment).

export type PendingDeliveryOrder = {
  orderId: string;
  storeId: string | null;
  zip: string | null;
  total: number;
  slaDeadline: string; // YYYY-MM-DD
  acceptedDays: number[]; // store's own accepted weekdays, already defaulted upstream
};

export type ScheduleSlotInput = {
  id: string;
  weekday: number; // 1 (Mon) - 7 (Sun)
  regionId: string | null;
  maxStores: number | null;
  maxDollarValue: number | null;
  active: boolean;
};

export type RegionInput = {
  id: string;
  zipCodes: string[];
};

export type ExistingAssignment = {
  slotId: string;
  scheduledDate: string;
  orderTotal: number;
};

export type AssignmentResult = {
  orderId: string;
  slotId: string;
  scheduledDate: string;
};

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDaysUtc(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Strips a timestamp (or already-bare date) down to its YYYY-MM-DD portion.
export function dateOnly(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

// Next calendar date >= fromDate whose weekday matches targetWeekday. A
// weekday recurs at most once inside a 7-day SLA window, so this is the only
// candidate date that slot can offer this particular order.
function nextOccurrence(fromDate: string, targetWeekday: number): string {
  const delta = (targetWeekday - isoWeekday(fromDate) + 7) % 7;
  return addDaysUtc(fromDate, delta);
}

export function computeDeliveryAssignments({
  today,
  orders,
  slots,
  regions,
  existingAssignments
}: {
  today: string;
  orders: PendingDeliveryOrder[];
  slots: ScheduleSlotInput[];
  regions: RegionInput[];
  existingAssignments: ExistingAssignment[];
}): { assignments: AssignmentResult[]; unschedulable: string[] } {
  const regionIdsByZip = new Map<string, string[]>();
  regions.forEach((region) => {
    region.zipCodes.forEach((zip) => {
      const list = regionIdsByZip.get(zip) || [];
      list.push(region.id);
      regionIdsByZip.set(zip, list);
    });
  });

  const activeSlots = slots.filter((slot) => slot.active);

  // slot+date capacity tallies, seeded from already-committed assignments so
  // a re-run never double-books on top of a prior run.
  const storeCounts = new Map<string, number>();
  const dollarTotals = new Map<string, number>();
  const tallyKey = (slotId: string, date: string) => `${slotId}|${date}`;
  existingAssignments.forEach((assignment) => {
    const key = tallyKey(assignment.slotId, assignment.scheduledDate);
    storeCounts.set(key, (storeCounts.get(key) || 0) + 1);
    dollarTotals.set(key, (dollarTotals.get(key) || 0) + assignment.orderTotal);
  });

  const sortedOrders = [...orders].sort((left, right) => left.slaDeadline.localeCompare(right.slaDeadline));

  const assignments: AssignmentResult[] = [];
  const unschedulable: string[] = [];

  sortedOrders.forEach((order) => {
    if (!order.zip || !order.storeId) {
      unschedulable.push(order.orderId);
      return;
    }
    const regionIds = new Set(regionIdsByZip.get(order.zip) || []);
    if (!regionIds.size) {
      unschedulable.push(order.orderId);
      return;
    }

    // Not filtered to <= slaDeadline — an order that's already missed its
    // window should still go out on the soonest available route rather than
    // being permanently stuck. slaDeadline drives sort priority above (most
    // urgent gets first pick of capacity); "Overdue" in the queue is the
    // signal that it missed its window, independent of whether it now has a
    // route.
    const candidates = activeSlots
      .filter((slot) => slot.regionId && regionIds.has(slot.regionId) && order.acceptedDays.includes(slot.weekday))
      .map((slot) => ({ slot, date: nextOccurrence(today, slot.weekday) }))
      .sort((left, right) => left.date.localeCompare(right.date));

    for (const { slot, date } of candidates) {
      const key = tallyKey(slot.id, date);
      const currentStores = storeCounts.get(key) || 0;
      const currentDollars = dollarTotals.get(key) || 0;
      if (slot.maxStores != null && currentStores >= slot.maxStores) {
        continue;
      }
      if (slot.maxDollarValue != null && currentDollars + order.total > slot.maxDollarValue) {
        continue;
      }
      storeCounts.set(key, currentStores + 1);
      dollarTotals.set(key, currentDollars + order.total);
      assignments.push({ orderId: order.orderId, slotId: slot.id, scheduledDate: date });
      return;
    }
    unschedulable.push(order.orderId);
  });

  return { assignments, unschedulable };
}
