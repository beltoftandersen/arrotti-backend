import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260120134928 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "brand" add column if not exists "metadata" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "brand" drop column if exists "metadata";`);
  }

}
