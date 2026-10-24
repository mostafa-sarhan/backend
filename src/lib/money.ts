// The one settlement formula (fees per delivered order). Phase C stores fees per company.
//   courier commission = delivered × courier fee
//   company commission = delivered × company fee
//   merchant net       = delivered total − courier commission − company commission
export interface Fees {
  courier: number;
  company: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function settlement(deliveredCount: number, deliveredTotal: number, fees: Fees) {
  const courierCommission = round2(deliveredCount * fees.courier);
  const companyCommission = round2(deliveredCount * fees.company);
  return {
    deliveredCount,
    deliveredTotal: round2(deliveredTotal),
    courierCommission,
    companyCommission,
    afterCourier: round2(deliveredTotal - courierCommission),
    merchantNet: round2(deliveredTotal - courierCommission - companyCommission),
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
