import { describe, it, expect } from "vitest";
import { settlement, summarize } from "../src/lib/money";

describe("settlement formula", () => {
  it("subtracts both commissions from the delivered total", () => {
    expect(settlement(3, 450, { courier: 20, company: 10 })).toEqual({
      deliveredCount: 3,
      deliveredTotal: 450,
      courierCommission: 60,
      companyCommission: 30,
      afterCourier: 390,
      merchantNet: 360,
    });
  });

  it("is all zero with nothing delivered", () => {
    expect(settlement(0, 0, { courier: 20, company: 10 }).merchantNet).toBe(0);
  });

  it("rounds to 2 decimals", () => {
    const s = settlement(3, 100.1 + 0.2, { courier: 0.1, company: 0 });
    expect(s.deliveredTotal).toBe(100.3);
    expect(s.courierCommission).toBe(0.3);
  });

  it("only counts delivered orders toward the settlement", () => {
    const r = summarize(
      [
        { status: "delivered", count: 2, amount: 300 },
        { status: "returned", count: 1, amount: 80 },
        { status: "pending", count: 4, amount: 400 },
      ],
      { courier: 20, company: 10 }
    );
    expect(r.total).toEqual({ count: 7, amount: 780 });
    expect(r.byStatus.returned).toEqual({ count: 1, amount: 80 });
    expect(r.money.merchantNet).toBe(300 - 40 - 20);
  });
});
