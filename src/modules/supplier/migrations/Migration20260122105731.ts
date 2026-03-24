import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260122105731 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier" drop constraint if exists "supplier_code_unique";`);
    this.addSql(`create table if not exists "supplier" ("id" text not null, "name" text not null, "code" text not null, "contact_name" text null, "email" text null, "phone" text null, "address" text null, "website" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_code_unique" ON "supplier" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_deleted_at" ON "supplier" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "supplier" cascade;`);
  }

}
