import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260122210309 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "fitment" drop column if exists "features";`);

    this.addSql(`alter table if exists "fitment" add column if not exists "variables_raw" text null, add column if not exists "conditions" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "fitment" drop column if exists "variables_raw", drop column if exists "conditions";`);

    this.addSql(`alter table if exists "fitment" add column if not exists "features" jsonb not null default '[]';`);
  }

}
