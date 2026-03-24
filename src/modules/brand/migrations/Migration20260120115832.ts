import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260120115832 extends Migration {

  override async up(): Promise<void> {
    // Add column as nullable first
    this.addSql(`alter table if exists "brand" add column if not exists "handle" text;`);

    // Generate handles from name for existing rows (lowercase, replace spaces/special chars with hyphens)
    this.addSql(`update "brand" set "handle" = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) where "handle" is null;`);

    // Remove trailing hyphens
    this.addSql(`update "brand" set "handle" = regexp_replace("handle", '-+$', '') where "handle" like '%-';`);

    // Make column not null
    this.addSql(`alter table if exists "brand" alter column "handle" set not null;`);

    // Add unique constraint
    this.addSql(`alter table if exists "brand" drop constraint if exists "brand_handle_unique";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_brand_handle_unique" ON "brand" ("handle") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_brand_handle_unique";`);
    this.addSql(`alter table if exists "brand" drop column if exists "handle";`);
  }

}
