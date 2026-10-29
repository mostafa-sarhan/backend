import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, { IMPORT_MAX_BYTES: "60000", IMPORT_MAX_ROWS: "20", RATE_LIMIT_IMPORT_USER_PER_HOUR: "1000" });
});

import ExcelJS from "exceljs";
import { useDb, loginAs, seedRefs, createTenant, UNSCOPED } from "./helpers";
import { Order } from "../src/modules/orders/order.model";
import { AuditEvent } from "../src/modules/audit/auditEvent.model";
import { TRACKING_ID_PATTERN } from "../src/modules/orders/order.model";

useDb();

const HEADERS = ["اسم العميل", "رقم الهاتف", "العنوان", "المبلغ", "الشركة", "ملاحظات", "المرجع"];

async function xlsx(rows: unknown[][], headers = HEADERS) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("orders");
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const upload = (agent: Awaited<ReturnType<typeof loginAs>>, file: Buffer, mode = "dry-run", name = "orders.xlsx", contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") =>
  agent.post("/orders/import").query({ mode }).attach("file", file, { filename: name, contentType });

const good = [
  ["أحمد", "٠١٠٠١٢٣٤٥٦٧", "القاهرة", "١٥٠", "Acme", "اتصل أولًا", "R-1"],
  ["منى", "01112223334", "الجيزة", 99.5, "acme", "", ""],
  ["Omar", "+201234567890", "Alex", 0, "Acme", "", "R-2"],
];

describe("Excel import", () => {
  it("template downloads as xlsx with the expected headers", async () => {
    const admin = await loginAs("admin");
    const res = await admin.get("/orders/import/template").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.headers["content-disposition"]).toMatch(/orders-template\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets[0].getRow(1).values).toEqual([undefined, ...HEADERS]);
  });

  it("dry run validates and saves nothing (Arabic digits normalised, merchant matched case-insensitively)", async () => {
    await seedRefs();
    const admin = await loginAs("admin");
    const res = await upload(admin, await xlsx(good));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalRows: 3, validRows: 3, errors: [] });
    expect(res.body.data.preview[0]).toMatchObject({ row: 2, phone: "01001234567", cost: 150, merchant: "Acme" });
    expect(await Order.countDocuments().setOptions(UNSCOPED)).toBe(0);
  });

  it("reports every problem with its row number", async () => {
    await seedRefs();
    const admin = await loginAs("admin");
    await upload(admin, await xlsx([["Old", "01000000000", "x", 1, "Acme", "", "USED"]]), "commit");
    const res = await upload(
      admin,
      await xlsx([
        ["", "01001234567", "x", 10, "Acme"], // row 2: no name
        ["B", "123", "x", 10, "Acme"], // row 3: bad phone
        ["C", "01001234567", "x", "abc", "Acme"], // row 4: bad cost
        ["D", "01001234567", "x", 10, "Nobody"], // row 5: unknown merchant
        ["E", "01001234567", "x", 10, "Acme", "", "DUP"], // row 6
        ["F", "01001234567", "x", 10, "Acme", "", "DUP"], // row 7: duplicate in file
        ["G", "01001234567", "x", 10, "Acme", "", "USED"], // row 8: already used
        ["H", "01001234567", "x", 10, "Acme"], // row 9: fine
      ])
    );
    const errors = res.body.data.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`);
    expect(errors).toEqual(["2:fullName", "3:phone", "4:cost", "5:merchant", "7:reference", "8:reference"]);
    expect(res.body.data).toMatchObject({ totalRows: 8, validRows: 2 });
  });

  it("commit creates every order in one go, with barcodes, tracking ids, timeline and audit", async () => {
    await seedRefs();
    const admin = await loginAs("admin");
    const res = await upload(admin, await xlsx(good), "commit");
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ created: 3 });

    const orders = await Order.find().setOptions(UNSCOPED).lean();
    expect(new Set(orders.map((o) => o.barcode)).size).toBe(3);
    for (const o of orders) {
      expect(o.trackingId).toMatch(TRACKING_ID_PATTERN);
      expect(o.statusHistory[0]).toMatchObject({ status: "pending" });
    }
    expect(orders.map((o) => o.merchantRef).sort()).toEqual([undefined, "R-1", "R-2"].sort());
    expect(await AuditEvent.countDocuments({ action: "CREATE" }).setOptions(UNSCOPED)).toBe(3);
  });

  it("commit with any invalid row saves nothing", async () => {
    await seedRefs();
    const admin = await loginAs("admin");
    const res = await upload(admin, await xlsx([...good, ["Bad", "1", "x", 1, "Acme"]]), "commit");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IMPORT_INVALID");
    expect(res.body.error.details.errors[0]).toMatchObject({ row: 5, field: "phone" });
    expect(await Order.countDocuments().setOptions(UNSCOPED)).toBe(0);
  });

  it("checks extension, MIME type and file signature", async () => {
    const admin = await loginAs("admin");
    const file = await xlsx(good);
    expect((await upload(admin, file, "dry-run", "orders.csv")).body.error.code).toBe("INVALID_FILE");
    expect((await upload(admin, file, "dry-run", "orders.xlsx", "text/plain")).body.error.code).toBe("INVALID_FILE");
    expect((await upload(admin, Buffer.from("not a zip at all"), "dry-run", "orders.xlsx")).body.error.code).toBe("INVALID_FILE");
    expect((await upload(admin, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]), "dry-run", "orders.xlsx")).body.error.code).toBe("INVALID_FILE");
    expect((await admin.post("/orders/import")).body.error.code).toBe("INVALID_FILE"); // no file
  });

  it("enforces max file size and max rows", async () => {
    await seedRefs();
    const admin = await loginAs("admin");
    const big = Buffer.concat([await xlsx(good), Buffer.alloc(70_000)]);
    const tooBig = await upload(admin, big);
    expect(tooBig.status).toBe(413);
    const many = Array.from({ length: 21 }, (_, i) => [`N${i}`, "01001234567", "x", 1, "Acme"]);
    expect((await upload(admin, await xlsx(many))).body.error.message).toMatch(/At most 20 rows/);
  });

  it("requires the core columns", async () => {
    const admin = await loginAs("admin");
    const res = await upload(admin, await xlsx([["a", "b"]], ["الاسم", "something"]));
    expect(res.body.error.code).toBe("INVALID_FILE");
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(["phone", "address", "cost", "merchant"]);
  });

  it("respects the monthly order quota", async () => {
    const tenant = await createTenant("Tiny", { limits: { maxOrdersPerMonth: 2 } });
    await seedRefs(tenant);
    const admin = await loginAs("admin", "a@tiny.test", tenant);
    const res = await upload(admin, await xlsx(good), "commit");
    expect(res.body.error.code).toBe("PLAN_LIMIT_REACHED");
    expect(await Order.countDocuments({ tenantId: tenant._id })).toBe(0);
  });

  it("merchants are matched within the tenant only", async () => {
    const other = await createTenant("Other");
    await seedRefs(other); // has "Acme" in another tenant
    const admin = await loginAs("admin"); // default tenant has no merchants
    const res = await upload(admin, await xlsx(good));
    expect(res.body.data.errors.every((e: { field: string }) => e.field === "merchant")).toBe(true);
  });
});
