import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260120074229 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vehicle" drop constraint if exists "vehicle_make_id_model_id_year_engine_unique";`);
    this.addSql(`drop table if exists "vehicle_trim" cascade;`);

    this.addSql(`drop index if exists "IDX_vehicle_make_id_model_id_year_engine_trim_unique";`);
    this.addSql(`alter table if exists "vehicle" drop column if exists "trim";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year_engine_unique" ON "vehicle" ("make_id", "model_id", "year", "engine") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table if not exists "vehicle_trim" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_trim_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_trim_name_unique" ON "vehicle_trim" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_trim_deleted_at" ON "vehicle_trim" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_vehicle_make_id_model_id_year_engine_unique";`);

    this.addSql(`alter table if exists "vehicle" add column if not exists "trim" text null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year_engine_trim_unique" ON "vehicle" ("make_id", "model_id", "year", "engine", "trim") WHERE deleted_at IS NULL;`);
  }

}
