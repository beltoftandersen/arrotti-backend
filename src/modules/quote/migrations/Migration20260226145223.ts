import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226145223 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "quote" ("id" text not null, "product_id" text not null, "variant_id" text null, "customer_id" text not null, "quantity" integer not null default 1, "notes" text null, "status" text check ("status" in ('pending', 'quoted', 'accepted', 'rejected', 'expired', 'ordered')) not null default 'pending', "quoted_price" integer null, "currency_code" text not null default 'usd', "admin_notes" text null, "expires_at" timestamptz null, "accepted_at" timestamptz null, "ordered_at" timestamptz null, "order_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "quote_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_QUOTE_PRODUCT_ID" ON "quote" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_QUOTE_CUSTOMER_ID" ON "quote" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_quote_deleted_at" ON "quote" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_QUOTE_STATUS" ON "quote" ("status") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "quote" cascade;`);
  }

}
