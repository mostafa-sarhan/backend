import type { Role } from "../users/user.model";

// Stored as English codes; the frontend maps them to Arabic labels.
export const ORDER_STATUSES = ["pending", "with_courier", "delivered", "returned", "exchanged", "refused"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Final statuses close the order: they set `deliveredAt` and start the archive countdown.
export const FINAL_STATUSES: OrderStatus[] = ["delivered", "returned", "refused"];
export const isFinal = (s: string) => FINAL_STATUSES.includes(s as OrderStatus);

// Normal flow, allowed for every role.
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["with_courier"],
  with_courier: ["delivered", "returned", "refused", "exchanged", "pending"],
  exchanged: ["with_courier", "returned"],
  delivered: [],
  returned: [],
  refused: [],
};

// Corrections of closed orders, admins only.
const ADMIN_CORRECTIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  delivered: ["with_courier"],
  returned: ["with_courier", "pending"],
  refused: ["with_courier", "pending"],
};

// Couriers only report delivery outcomes; they can't send an order back to the warehouse.
const COURIER_OUTCOMES: OrderStatus[] = ["delivered", "returned", "refused", "exchanged"];

export function allowedTransitions(from: OrderStatus, role: Role): OrderStatus[] {
  if (role === "courier") return from === "with_courier" ? COURIER_OUTCOMES : [];
  if (role === "merchant") return [];
  return [...TRANSITIONS[from], ...(role === "admin" || role === "owner" ? ADMIN_CORRECTIONS[from] ?? [] : [])];
}

export const canTransition = (from: OrderStatus, to: OrderStatus, role: Role) =>
  allowedTransitions(from, role).includes(to);

// Old Arabic values -> codes (used by the migration).
export const LEGACY_STATUS_MAP: Record<string, OrderStatus> = {
  "قيد التنفيذ": "pending",
  "مع المندوب": "with_courier",
  "تم التسليم": "delivered",
  "مرتجع": "returned",
  "استبدال": "exchanged",
  "مرفوض": "refused",
};
