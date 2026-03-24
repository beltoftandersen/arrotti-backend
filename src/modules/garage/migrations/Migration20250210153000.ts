import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20250210153000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "garage_vehicle" add column if not exists "make" text null;`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" add column if not exists "model" text null;`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" add column if not exists "year" integer null;`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" add column if not exists "engine" text null;`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" add column if not exists "trim" text null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "garage_vehicle" drop column if exists "make";`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" drop column if exists "model";`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" drop column if exists "year";`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" drop column if exists "engine";`
    )
    this.addSql(
      `alter table if exists "garage_vehicle" drop column if exists "trim";`
    )
  }
}
