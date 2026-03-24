import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260131152226 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier" add column if not exists "default_markup" real not null default 30;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "supplier" drop column if exists "default_markup";`);
  }

}
