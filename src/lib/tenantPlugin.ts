import { Schema, Query, Aggregate, MongooseQueryMiddleware } from "mongoose";

// Tenant isolation, enforced at the model layer and failing closed: every query, aggregate and
// bulk write on a tenant-owned model must filter by tenantId, or it throws before reaching MongoDB.
// The few legitimate cross-tenant lookups (login by email, API key lookup, background jobs) opt out
// explicitly with `.setOptions(UNSCOPED)` so they're easy to audit (grep UNSCOPED).

export const UNSCOPED = { skipTenantCheck: true } as const;

export class TenantScopeError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant scope missing: ${model}.${op} must filter by tenantId`);
  }
}

const hasTenant = (filter: Record<string, unknown> | undefined) => filter?.tenantId !== undefined && filter.tenantId !== null;

const QUERY_OPS: MongooseQueryMiddleware[] = [
  "countDocuments",
  "deleteMany",
  "deleteOne",
  "distinct",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
];

// Declared in each schema (so the field is typed); the plugin adds it if a schema forgot.
export const tenantIdField = { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true } as const;

export function tenantScoped(schema: Schema) {
  if (!schema.path("tenantId")) schema.add({ tenantId: tenantIdField });

  schema.pre(QUERY_OPS, function (this: Query<unknown, unknown>) {
    if ((this.getOptions() as Record<string, unknown>).skipTenantCheck) return;
    if (!hasTenant(this.getFilter())) throw new TenantScopeError(this.model.modelName, (this as unknown as { op: string }).op);
  });

  schema.pre("aggregate", function (this: Aggregate<unknown>) {
    if ((this.options as Record<string, unknown>).skipTenantCheck) return;
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!hasTenant(first?.$match)) throw new TenantScopeError(this.model()?.modelName ?? "?", "aggregate");
  });

  schema.pre("bulkWrite", function (ops) {
    for (const op of ops as unknown as Record<string, { filter?: Record<string, unknown>; document?: Record<string, unknown> }>[]) {
      const [kind, body] = Object.entries(op)[0];
      const ok = kind === "insertOne" ? hasTenant(body.document) : hasTenant(body.filter);
      if (!ok) throw new TenantScopeError(this.modelName, `bulkWrite.${kind}`);
    }
  });
}
