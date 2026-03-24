import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260122211734 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "fitment" add column if not exists "has_notes_notice" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "fitment" drop column if exists "has_notes_notice";`);
  }

}
