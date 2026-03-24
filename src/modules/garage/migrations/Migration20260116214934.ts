import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260116214934 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "garage_vehicle" ("id" text not null, "vehicle_id" text not null, "label" text null, "is_default" boolean not null default false, "last_used_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "garage_vehicle_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_garage_vehicle_deleted_at" ON "garage_vehicle" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_garage_vehicle_vehicle_id" ON "garage_vehicle" ("vehicle_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_garage_vehicle_last_used_at" ON "garage_vehicle" ("last_used_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "garage_vehicle" cascade;`);
  }

}
