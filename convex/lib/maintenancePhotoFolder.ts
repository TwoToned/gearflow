/**
 * The upload folder the maintenance photo picker sends (`PhotoGridInput folder`) and the maintenance writes require
 * (`lib/maintenancePhotos.ts`). A plain module with no imports so the browser form can read it (the one definition,
 * R-3.1) without pulling the server-side proof into the client bundle.
 */
export const MAINTENANCE_PHOTO_FOLDER = "maintenance-photos";
