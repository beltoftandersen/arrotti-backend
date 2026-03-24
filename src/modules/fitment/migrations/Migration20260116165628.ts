import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260116165628 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vin_decode_cache" drop constraint if exists "vin_decode_cache_vin_unique";`);
    this.addSql(`create table if not exists "vin_decode_cache" ("id" text not null, "vin" text not null, "provider" text not null default 'vpic', "decoded_json" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vin_decode_cache_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vin_decode_cache_vin_unique" ON "vin_decode_cache" ("vin") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vin_decode_cache_deleted_at" ON "vin_decode_cache" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "vin_decode_cache" cascade;`);
  }

}
