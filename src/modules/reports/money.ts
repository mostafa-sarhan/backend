// The one settlement formula (fees per delivered order).
//   courier commission = delivered × courier fee   (the shipping company's own cost)
//   company commission = delivered × company fee   (what the merchant pays for shipping)
//   merchant net       = delivered total − the deducted commissions
// Which commissions are deducted from the merchant becomes a per-tenant setting in Phase C;
// the default deducts the company fee only.
export interface Fees {
  courier: number;
  company: number;
}

export type MerchantDeduction = "company" | "courier";
export const DEFAULT_MERCHANT_DEDUCTIONS: readonly MerchantDeduction[] = ["company"];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function settlement(
  deliveredCount: number,
  deliveredTotal: number,
  fees: Fees,
  deductions: readonly MerchantDeduction[] = DEFAULT_MERCHANT_DEDUCTIONS
) {
  const courierCommission = round2(deliveredCount * fees.courier);
  const companyCommission = round2(deliveredCount * fees.company);
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

export type StatusTotals = Record<string, { count: number; amount: number }>;

// Turns [{ status, count, amount }] rows into totals by status plus the settlement.
export function summarize(rows: { status: string; count: number; amount: number }[], fees: Fees) {
  const byStatus: StatusTotals = {};
  let count = 0;
  let amount = 0;
  for (const r of rows) {
    byStatus[r.status] = { count: r.count, amount: round2(r.amount) };
    count += r.count;
    amount += r.amount;
  }
  const delivered = byStatus.delivered ?? { count: 0, amount: 0 };
  return { total: { count, amount: round2(amount) }, byStatus, money: settlement(delivered.count, delivered.amount, fees) };
}
