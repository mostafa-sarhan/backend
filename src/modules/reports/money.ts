// Settlement rules. Commissions come from the fee snapshot stored on each delivered order
// (or count × a "what-if" fee an admin enters). Which commissions are deducted from the
// merchant is the tenant setting `merchantDeductions` (default: company fee only).
//   merchant net = delivered total − deducted commissions
//   after courier = delivered total − courier commission (what the company keeps before paying itself)
export type MerchantDeduction = "company" | "courier";
export const DEFAULT_MERCHANT_DEDUCTIONS: readonly MerchantDeduction[] = ["company"];

export interface Commissions {
  courier: number;
  company: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function settlement(deliveredCount: number, deliveredTotal: number, commissions: Commissions, deductions: readonly MerchantDeduction[] = DEFAULT_MERCHANT_DEDUCTIONS) {
  const courierCommission = round2(commissions.courier);
  const companyCommission = round2(commissions.company);
  const deducted = (deductions.includes("company") ? companyCommission : 0) + (deductions.includes("courier") ? courierCommission : 0);
  return {
    deliveredCount,
    deliveredTotal: round2(deliveredTotal),
    courierCommission,
    companyCommission,
    afterCourier: round2(deliveredTotal - courierCommission),
    merchantNet: round2(deliveredTotal - deducted),
  };
}

export type StatusRow = { status: string; count: number; amount: number; courierFees?: number; companyFees?: number };
export type StatusTotals = Record<string, { count: number; amount: number }>;

// What-if fees replace the snapshots: count × fee.
export type FeeOverrides = { courierFee?: number; companyFee?: number };

// Totals by status plus the settlement for the delivered orders.
export function summarize(rows: StatusRow[], deductions: readonly MerchantDeduction[] = DEFAULT_MERCHANT_DEDUCTIONS, overrides: FeeOverrides = {}) {
  const byStatus: StatusTotals = {};
  let count = 0;
  let amount = 0;
  for (const r of rows) {
    byStatus[r.status] = { count: r.count, amount: round2(r.amount) };
    count += r.count;
    amount += r.amount;
  }
  const delivered = rows.find((r) => r.status === "delivered") ?? { count: 0, amount: 0, courierFees: 0, companyFees: 0 };
  const commissions = {
    courier: overrides.courierFee !== undefined ? delivered.count * overrides.courierFee : delivered.courierFees ?? 0,
    company: overrides.companyFee !== undefined ? delivered.count * overrides.companyFee : delivered.companyFees ?? 0,
  };
  return { total: { count, amount: round2(amount) }, byStatus, money: settlement(delivered.count, delivered.amount, commissions, deductions) };
}
