import { describe, it, expect } from "vitest";
import { settlement, summarize } from "../src/modules/reports/money";

describe("settlement formula", () => {
  it("deducts only the company fee from the merchant by default", () => {
    expect(settlement(3, 450, { courier: 60, company: 30 })).toEqual({
      deliveredCount: 3,
      deliveredTotal: 450,
      courierCommission: 60,
      companyCommission: 30,
      afterCourier: 390,
      merchantNet: 420,
    });
  });

  it("follows the tenant's deduction setting", () => {
    expect(settlement(3, 450, { courier: 60, company: 30 }, ["company", "courier"]).merchantNet).toBe(360);
    expect(settlement(3, 450, { courier: 60, company: 30 }, []).merchantNet).toBe(450);
  });

  it("is all zero with nothing delivered", () => {
    expect(settlement(0, 0, { courier: 0, company: 0 }).merchantNet).toBe(0);
  });

  it("rounds to 2 decimals", () => {
    const s = settlement(3, 100.1 + 0.2, { courier: 0.1 + 0.2, company: 0 });
    expect(s.deliveredTotal).toBe(100.3);
    expect(s.courierCommission).toBe(0.3);
  });

  it("uses the stored fee snapshots, or count × what-if fees", () => {
    const rows = [
      { status: "delivered", count: 2, amount: 300, courierFees: 40, companyFees: 25 }, // e.g. 10 + 15 company fees
      { status: "returned", count: 1, amount: 80, courierFees: 0, companyFees: 0 },
      { status: "pending", count: 4, amount: 400, courierFees: 0, companyFees: 0 },
    ];
    const r = summarize(rows);
    expect(r.total).toEqual({ count: 7, amount: 780 });
    expect(r.byStatus.returned).toEqual({ count: 1, amount: 80 });
    expect(r.money).toMatchObject({ courierCommission: 40, companyCommission: 25, merchantNet: 275 });

    expect(summarize(rows, ["company"], { companyFee: 50 }).money).toMatchObject({ companyCommission: 100, merchantNet: 200 });
  });
});
