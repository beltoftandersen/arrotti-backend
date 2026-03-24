import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226172851 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "quote" add column if not exists "price_list_id" text null, add column if not exists "customer_group_id" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "quote" drop column if exists "price_list_id", drop column if exists "customer_group_id";`);
  }

}
