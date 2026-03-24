import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260118172357 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vehicle" drop constraint if exists "vehicle_make_id_model_id_year_engine_trim_unique";`);
    this.addSql(`drop index if exists "IDX_vehicle_make_id_model_id_year";`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year_engine_trim_unique" ON "vehicle" ("make_id", "model_id", "year", "engine", "trim") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_vehicle_make_id_model_id_year_engine_trim_unique";`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_vehicle_make_id_model_id_year" ON "vehicle" ("make_id", "model_id", "year") WHERE deleted_at IS NULL;`);
  }

}
