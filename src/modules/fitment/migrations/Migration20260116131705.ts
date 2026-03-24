import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260116131705 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vehicle_model" drop constraint if exists "vehicle_model_make_id_name_unique";`);
    this.addSql(`alter table if exists "vehicle_make" drop constraint if exists "vehicle_make_name_unique";`);
    this.addSql(`create table if not exists "fitment" ("id" text not null, "vehicle_id" text not null, "notes" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fitment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fitment_vehicle_id" ON "fitment" ("vehicle_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fitment_deleted_at" ON "fitment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vehicle" ("id" text not null, "make_id" text not null, "model_id" text not null, "year" integer not null, "engine" text null, "trim" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_deleted_at" ON "vehicle" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year" ON "vehicle" ("make_id", "model_id", "year") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vehicle_make" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_make_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_make_name_unique" ON "vehicle_make" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_make_deleted_at" ON "vehicle_make" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "vehicle_model" ("id" text not null, "make_id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_model_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_model_make_id" ON "vehicle_model" ("make_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_model_deleted_at" ON "vehicle_model" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_model_make_id_name_unique" ON "vehicle_model" ("make_id", "name") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "fitment" cascade;`);

    this.addSql(`drop table if exists "vehicle" cascade;`);

    this.addSql(`drop table if exists "vehicle_make" cascade;`);

    this.addSql(`drop table if exists "vehicle_model" cascade;`);
  }

}
