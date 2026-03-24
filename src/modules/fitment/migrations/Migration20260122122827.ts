import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260122122827 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "vehicle_make" add column if not exists "code" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "vehicle_make" drop column if exists "code";`);
  }

}
