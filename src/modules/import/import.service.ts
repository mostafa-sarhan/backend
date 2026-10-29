import { Request } from "express";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { Order, freeBarcodes, generateTrackingId } from "../orders/order.model";
import { Merchant } from "../merchants/merchant.model";
import { AuditEvent } from "../audit/auditEvent.model";
import { auditEvent } from "../audit/audit.service";
import { statusEvent } from "../orders/orders.service";
import { assertOrderQuota } from "../tenants/tenants.service";
import { AppError } from "../../lib/errors";
import { scope } from "../../lib/scope";
import { withTransaction } from "../../lib/transaction";
import { config } from "../../config";
import { importRow, ImportRow, HEADER_ALIASES, TEMPLATE_HEADERS } from "./import.schemas";

type RowError = { row: number; field: string; message: string };
type Parsed = { row: number; data: ImportRow; merchantId: mongoose.Types.ObjectId };

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toEnglishDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

// ExcelJS cell values can be numbers, dates, rich text, hyperlinks or formula results.
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String(value.text);
    if (value instanceof Date) return value.toISOString();
  }
  return String(value).trim();
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

async function readSheet(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new AppError(400, "INVALID_FILE", "The file could not be read as .xlsx");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError(400, "INVALID_FILE", "The file has no sheets");

  // Map column numbers to fields from the header row.
  const columns = new Map<number, keyof ImportRow>();
  sheet.getRow(1).eachCell((cell, col) => {
    const header = normalizeHeader(cellText(cell.value));
    const field = (Object.keys(HEADER_ALIASES) as (keyof ImportRow)[]).find((f) => HEADER_ALIASES[f].some((a) => normalizeHeader(a) === header));
    if (field) columns.set(col, field);
  });
  const missing = (["fullName", "phone", "address", "cost", "merchant"] as const).filter((f) => ![...columns.values()].includes(f));
  if (missing.length) throw new AppError(400, "INVALID_FILE", "Missing required columns", missing.map((f) => ({ field: f, accepted: HEADER_ALIASES[f] })));

  const rows: { row: number; raw: Record<string, string> }[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const raw: Record<string, string> = {};
    for (const [col, field] of columns) raw[field] = cellText(row.getCell(col).value);
    if (Object.values(raw).some((v) => v !== "")) rows.push({ row: number, raw });
  });
  if (rows.length > config.import.maxRows) throw new AppError(400, "INVALID_FILE", `At most ${config.import.maxRows} rows per file`);
  if (!rows.length) throw new AppError(400, "INVALID_FILE", "The file has no data rows");
  return rows;
}

// Validates every row; collects all problems instead of stopping at the first.
async function validate(req: Request, buffer: Buffer) {
  const rows = await readSheet(buffer);
  const merchants = await Merchant.find(scope(req)).select("name").lean();
  const merchantByName = new Map(merchants.map((m) => [m.name.trim().toLowerCase(), m._id]));

  const errors: RowError[] = [];
  const parsed: Parsed[] = [];
  const refsInFile = new Map<string, number>();

  for (const { row, raw } of rows) {
    const input = {
      ...raw,
      phone: toEnglishDigits(raw.phone ?? "").replace(/[\s-]/g, ""),
      cost: toEnglishDigits(raw.cost ?? ""),
      description: raw.description || undefined,
      reference: raw.reference || undefined,
    };
    const result = importRow.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) errors.push({ row, field: String(issue.path[0] ?? ""), message: issue.message });
      continue;
    }
    const merchantId = merchantByName.get(result.data.merchant.trim().toLowerCase());
    if (!merchantId) {
      errors.push({ row, field: "merchant", message: `Unknown merchant "${result.data.merchant}"` });
      continue;
    }
    if (result.data.reference) {
      const key = `${merchantId}:${result.data.reference}`;
      if (refsInFile.has(key)) errors.push({ row, field: "reference", message: `Duplicate reference (also row ${refsInFile.get(key)})` });
      refsInFile.set(key, row);
    }
    parsed.push({ row, data: result.data, merchantId });
  }

  // References already used by earlier orders of the same merchant.
  const withRef = parsed.filter((p) => p.data.reference);
  if (withRef.length) {
    const refs = withRef.map((p) => p.data.reference!);
    const existing = await Order.find({ ...scope(req), merchantRef: { $in: refs } }, { merchant: 1, merchantRef: 1 }).lean();
    const used = new Set(existing.map((o) => `${o.merchant}:${o.merchantRef}`));
    for (const p of withRef) {
      if (used.has(`${p.merchantId}:${p.data.reference}`)) errors.push({ row: p.row, field: "reference", message: "Reference already used by an existing order" });
    }
  }

  errors.sort((a, b) => a.row - b.row);
  return { totalRows: rows.length, parsed, errors };
}

const preview = (parsed: Parsed[]) => parsed.slice(0, 10).map((p) => ({ row: p.row, ...p.data }));

export async function dryRun(req: Request, buffer: Buffer) {
  const { totalRows, parsed, errors } = await validate(req, buffer);
  const badRows = new Set(errors.map((e) => e.row));
  return { totalRows, validRows: totalRows - badRows.size, errors, preview: preview(parsed.filter((p) => !badRows.has(p.row))) };
}

// All-or-nothing: any invalid row and nothing is saved; otherwise one transaction inserts
// every order and its audit event.
export async function commit(req: Request, buffer: Buffer) {
  const { totalRows, parsed, errors } = await validate(req, buffer);
  if (errors.length) throw new AppError(409, "IMPORT_INVALID", "The file has errors; nothing was imported", { totalRows, errors });
  await assertOrderQuota(req.tenant!, parsed.length);

  return withTransaction(async () => {
    const tenantId = req.tenant!._id;
    const barcodes = await freeBarcodes(tenantId, parsed.length);
    const docs = parsed.map((p, i) => ({
      tenantId,
      fullName: p.data.fullName,
      phone: p.data.phone,
      address: p.data.address,
      cost: p.data.cost,
      description: p.data.description,
      merchant: p.merchantId,
      merchantRef: p.data.reference,
      status: "pending",
      barcode: barcodes[i],
      trackingId: generateTrackingId(),
      statusHistory: [statusEvent(req, "pending")],
    }));
    const orders = await Order.insertMany(docs);
    await AuditEvent.insertMany(
      orders.map((o) => auditEvent(req, { entity: "order", entityId: o._id, action: "CREATE", label: o.barcode, changes: { status: { from: null, to: "pending" }, source: { from: null, to: "import" } } }))
    );
    return { created: orders.length };
  });
}

export async function template() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("orders", { views: [{ rightToLeft: true }] });
  sheet.addRow(TEMPLATE_HEADERS).font = { bold: true };
  sheet.addRow(["أحمد محمد", "01001234567", "القاهرة - مدينة نصر", 250, "اسم التاجر كما في النظام", "اتصل قبل الوصول", "ORD-1001"]);
  sheet.columns.forEach((c) => (c.width = 22));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

