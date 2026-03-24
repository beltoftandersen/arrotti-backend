import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260116144701 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vehicle_trim" drop constraint if exists "vehicle_trim_name_unique";`);
    this.addSql(`alter table if exists "vehicle_engine" drop constraint if exists "vehicle_engine_name_unique";`);
    this.addSql(`create table if not exists "vehicle_engine" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_engine_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_engine_name_unique" ON "vehicle_engine" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_engine_deleted_at" ON "vehicle_engine" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vehicle_trim" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_trim_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_trim_name_unique" ON "vehicle_trim" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_trim_deleted_at" ON "vehicle_trim" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "vehicle_engine" cascade;`);

    this.addSql(`drop table if exists "vehicle_trim" cascade;`);
  }

}
