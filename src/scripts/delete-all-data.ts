import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { FITMENT_MODULE } from "../modules/fitment";

export default async function deleteAllData({ container }: ExecArgs) {
  const fitmentService = container.resolve(FITMENT_MODULE) as any;
  const productService = container.resolve(Modules.PRODUCT);
  const query = container.resolve("query");

  // Count before deletion
  const fitments = await fitmentService.listFitments({}, { take: null });
  const vehicles = await fitmentService.listVehicles({}, { take: null });
  const { data: products } = await query.graph({ entity: "product", fields: ["id"] });
  const { data: categories } = await query.graph({ entity: "product_category", fields: ["id"] });

  console.log("=== BEFORE DELETION ===");
  console.log("Fitments:", fitments.length);
  console.log("Vehicles:", vehicles.length);
  console.log("Products:", products.length);
  console.log("Categories:", categories.length);

  // Delete fitments first (depends on vehicles)
  if (fitments.length > 0) {
    await fitmentService.deleteFitments(fitments.map((f: any) => f.id));
    console.log("Deleted fitments");
  }

  // Delete vehicles
  if (vehicles.length > 0) {
    await fitmentService.deleteVehicles(vehicles.map((v: any) => v.id));
    console.log("Deleted vehicles");
  }

  // Delete products
  if (products.length > 0) {
    await productService.deleteProducts(products.map((p: any) => p.id));
    console.log("Deleted products");
  }

  // Delete categories
  if (categories.length > 0) {
    await productService.deleteProductCategories(categories.map((c: any) => c.id));
    console.log("Deleted categories");
  }

  // Delete vehicle models
  const models = await fitmentService.listVehicleModels({}, { take: null });
  if (models.length > 0) {
    await fitmentService.deleteVehicleModels(models.map((m: any) => m.id));
    console.log("Deleted vehicle models:", models.length);
  }

  // Delete vehicle makes
  const makes = await fitmentService.listVehicleMakes({}, { take: null });
  if (makes.length > 0) {
    await fitmentService.deleteVehicleMakes(makes.map((m: any) => m.id));
    console.log("Deleted vehicle makes:", makes.length);
  }

  console.log("=== DONE ===");
}
