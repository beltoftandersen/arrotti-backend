import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260122105717 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vehicle" drop constraint if exists "vehicle_make_id_model_id_year_start_year_end_unique";`);
    this.addSql(`drop table if exists "vehicle_engine" cascade;`);

    this.addSql(`alter table if exists "fitment" add column if not exists "submodels" jsonb not null default '[]', add column if not exists "features" jsonb not null default '[]';`);

    this.addSql(`drop index if exists "IDX_vehicle_make_id_model_id_year_engine_unique";`);
    this.addSql(`alter table if exists "vehicle" drop column if exists "engine";`);

    // Add year_end column as nullable first, then populate from existing year, then make NOT NULL
    this.addSql(`alter table if exists "vehicle" add column if not exists "year_end" integer;`);
    this.addSql(`update "vehicle" set "year_end" = "year" where "year_end" is null;`);
    this.addSql(`alter table if exists "vehicle" alter column "year_end" set not null;`);
    this.addSql(`alter table if exists "vehicle" rename column "year" to "year_start";`);

    // Delete duplicate vehicles (keep the one with earliest created_at), update fitments to point to kept vehicle
    this.addSql(`
      WITH duplicates AS (
        SELECT id, make_id, model_id, year_start, year_end,
               ROW_NUMBER() OVER (PARTITION BY make_id, model_id, year_start, year_end ORDER BY created_at) as rn
        FROM vehicle
        WHERE deleted_at IS NULL
      ),
      to_delete AS (
        SELECT d.id as delete_id, k.id as keep_id
        FROM duplicates d
        JOIN duplicates k ON d.make_id = k.make_id AND d.model_id = k.model_id
                          AND d.year_start = k.year_start AND d.year_end = k.year_end
                          AND k.rn = 1 AND d.rn > 1
      )
      UPDATE fitment SET vehicle_id = to_delete.keep_id
      FROM to_delete WHERE fitment.vehicle_id = to_delete.delete_id;
    `);
    this.addSql(`
      DELETE FROM vehicle WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY make_id, model_id, year_start, year_end ORDER BY created_at) as rn
          FROM vehicle WHERE deleted_at IS NULL
        ) sub WHERE rn > 1
      );
    `);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year_start_year_end_unique" ON "vehicle" ("make_id", "model_id", "year_start", "year_end") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table if not exists "vehicle_engine" ("id" text not null, "name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vehicle_engine_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_engine_name_unique" ON "vehicle_engine" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_engine_deleted_at" ON "vehicle_engine" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "fitment" drop column if exists "submodels", drop column if exists "features";`);

    this.addSql(`drop index if exists "IDX_vehicle_make_id_model_id_year_start_year_end_unique";`);
    this.addSql(`alter table if exists "vehicle" drop column if exists "year_end";`);

    this.addSql(`alter table if exists "vehicle" add column if not exists "engine" text null;`);
    this.addSql(`alter table if exists "vehicle" rename column "year_start" to "year";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year_engine_unique" ON "vehicle" ("make_id", "model_id", "year", "engine") WHERE deleted_at IS NULL;`);
  }

}
