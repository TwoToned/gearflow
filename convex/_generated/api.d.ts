/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLog from "../activityLog.js";
import type * as activityLogWrites from "../activityLogWrites.js";
import type * as assetBulkChildren from "../assetBulkChildren.js";
import type * as assetDetail from "../assetDetail.js";
import type * as assetMedia from "../assetMedia.js";
import type * as assetScanLogs from "../assetScanLogs.js";
import type * as assetWrites from "../assetWrites.js";
import type * as assets from "../assets.js";
import type * as availabilityCheck from "../availabilityCheck.js";
import type * as brandTemplates from "../brandTemplates.js";
import type * as bulkAssets from "../bulkAssets.js";
import type * as categories from "../categories.js";
import type * as categorySlots from "../categorySlots.js";
import type * as checkItems from "../checkItems.js";
import type * as checkRecordOps from "../checkRecordOps.js";
import type * as checkRecords from "../checkRecords.js";
import type * as clientMedia from "../clientMedia.js";
import type * as clients from "../clients.js";
import type * as collaboration from "../collaboration.js";
import type * as crewAssignments from "../crewAssignments.js";
import type * as crewAvailabilities from "../crewAvailabilities.js";
import type * as crewMembers from "../crewMembers.js";
import type * as crewRoles from "../crewRoles.js";
import type * as crewShifts from "../crewShifts.js";
import type * as crewSkills from "../crewSkills.js";
import type * as crewTimeEntries from "../crewTimeEntries.js";
import type * as crewWrites from "../crewWrites.js";
import type * as customFieldDefinitions from "../customFieldDefinitions.js";
import type * as customRoles from "../customRoles.js";
import type * as dashboardActivity from "../dashboardActivity.js";
import type * as dashboardCounters from "../dashboardCounters.js";
import type * as dashboardLists from "../dashboardLists.js";
import type * as dashboardStats from "../dashboardStats.js";
import type * as dashboardSubHire from "../dashboardSubHire.js";
import type * as documentTemplates from "../documentTemplates.js";
import type * as emailActions from "../emailActions.js";
import type * as emails from "../emails.js";
import type * as equipmentTab from "../equipmentTab.js";
import type * as fileUploads from "../fileUploads.js";
import type * as groupTemplateItems from "../groupTemplateItems.js";
import type * as groupTemplates from "../groupTemplates.js";
import type * as kitBulkItems from "../kitBulkItems.js";
import type * as kitCheckItems from "../kitCheckItems.js";
import type * as kitDetail from "../kitDetail.js";
import type * as kitMedia from "../kitMedia.js";
import type * as kitSerializedItems from "../kitSerializedItems.js";
import type * as kitWrites from "../kitWrites.js";
import type * as kits from "../kits.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bulkCheckin from "../lib/bulkCheckin.js";
import type * as lib_fulfillment from "../lib/fulfillment.js";
import type * as lib_inventory from "../lib/inventory.js";
import type * as lib_lineItemUnits from "../lib/lineItemUnits.js";
import type * as lib_permissionsCore from "../lib/permissionsCore.js";
import type * as lib_recalc from "../lib/recalc.js";
import type * as lib_testtag from "../lib/testtag.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lineItemMergeMaps from "../lineItemMergeMaps.js";
import type * as lineItemWrites from "../lineItemWrites.js";
import type * as locationMedia from "../locationMedia.js";
import type * as locations from "../locations.js";
import type * as maintenanceRecordAssets from "../maintenanceRecordAssets.js";
import type * as maintenanceRecords from "../maintenanceRecords.js";
import type * as members from "../members.js";
import type * as modelBulkAccessories from "../modelBulkAccessories.js";
import type * as modelCheckItems from "../modelCheckItems.js";
import type * as modelMedia from "../modelMedia.js";
import type * as models from "../models.js";
import type * as notificationDismissals from "../notificationDismissals.js";
import type * as notificationEmailLogs from "../notificationEmailLogs.js";
import type * as overbooking from "../overbooking.js";
import type * as parity from "../parity.js";
import type * as projectCategories from "../projectCategories.js";
import type * as projectDetail from "../projectDetail.js";
import type * as projectEquipment from "../projectEquipment.js";
import type * as projectGroups from "../projectGroups.js";
import type * as projectLineItemUnits from "../projectLineItemUnits.js";
import type * as projectLineItems from "../projectLineItems.js";
import type * as projectManagers from "../projectManagers.js";
import type * as projectMedia from "../projectMedia.js";
import type * as projectNumberSequences from "../projectNumberSequences.js";
import type * as projectServices from "../projectServices.js";
import type * as projectTasks from "../projectTasks.js";
import type * as projectWrites from "../projectWrites.js";
import type * as projects from "../projects.js";
import type * as purgeRemovedTables from "../purgeRemovedTables.js";
import type * as savedTableViews from "../savedTableViews.js";
import type * as sectionPresets from "../sectionPresets.js";
import type * as serviceTemplates from "../serviceTemplates.js";
import type * as siteSettings from "../siteSettings.js";
import type * as subHireGroups from "../subHireGroups.js";
import type * as subHireItems from "../subHireItems.js";
import type * as subHireMedia from "../subHireMedia.js";
import type * as subHires from "../subHires.js";
import type * as subTestRecords from "../subTestRecords.js";
import type * as supplierModelRates from "../supplierModelRates.js";
import type * as supplierOrderItems from "../supplierOrderItems.js";
import type * as supplierOrders from "../supplierOrders.js";
import type * as suppliers from "../suppliers.js";
import type * as testProfiles from "../testProfiles.js";
import type * as testTagAssets from "../testTagAssets.js";
import type * as testTagAuditorTokens from "../testTagAuditorTokens.js";
import type * as testTagRecords from "../testTagRecords.js";
import type * as userNotificationPreferences from "../userNotificationPreferences.js";
import type * as users from "../users.js";
import type * as warehouseCloses from "../warehouseCloses.js";
import type * as warehouseDashboardTokens from "../warehouseDashboardTokens.js";
import type * as warehouseDetail from "../warehouseDetail.js";
import type * as warehouseList from "../warehouseList.js";
import type * as warehouseOps from "../warehouseOps.js";
import type * as wooCommerceIntegrations from "../wooCommerceIntegrations.js";
import type * as wooCommerceOrderLogs from "../wooCommerceOrderLogs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLog: typeof activityLog;
  activityLogWrites: typeof activityLogWrites;
  assetBulkChildren: typeof assetBulkChildren;
  assetDetail: typeof assetDetail;
  assetMedia: typeof assetMedia;
  assetScanLogs: typeof assetScanLogs;
  assetWrites: typeof assetWrites;
  assets: typeof assets;
  availabilityCheck: typeof availabilityCheck;
  brandTemplates: typeof brandTemplates;
  bulkAssets: typeof bulkAssets;
  categories: typeof categories;
  categorySlots: typeof categorySlots;
  checkItems: typeof checkItems;
  checkRecordOps: typeof checkRecordOps;
  checkRecords: typeof checkRecords;
  clientMedia: typeof clientMedia;
  clients: typeof clients;
  collaboration: typeof collaboration;
  crewAssignments: typeof crewAssignments;
  crewAvailabilities: typeof crewAvailabilities;
  crewMembers: typeof crewMembers;
  crewRoles: typeof crewRoles;
  crewShifts: typeof crewShifts;
  crewSkills: typeof crewSkills;
  crewTimeEntries: typeof crewTimeEntries;
  crewWrites: typeof crewWrites;
  customFieldDefinitions: typeof customFieldDefinitions;
  customRoles: typeof customRoles;
  dashboardActivity: typeof dashboardActivity;
  dashboardCounters: typeof dashboardCounters;
  dashboardLists: typeof dashboardLists;
  dashboardStats: typeof dashboardStats;
  dashboardSubHire: typeof dashboardSubHire;
  documentTemplates: typeof documentTemplates;
  emailActions: typeof emailActions;
  emails: typeof emails;
  equipmentTab: typeof equipmentTab;
  fileUploads: typeof fileUploads;
  groupTemplateItems: typeof groupTemplateItems;
  groupTemplates: typeof groupTemplates;
  kitBulkItems: typeof kitBulkItems;
  kitCheckItems: typeof kitCheckItems;
  kitDetail: typeof kitDetail;
  kitMedia: typeof kitMedia;
  kitSerializedItems: typeof kitSerializedItems;
  kitWrites: typeof kitWrites;
  kits: typeof kits;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/bulkCheckin": typeof lib_bulkCheckin;
  "lib/fulfillment": typeof lib_fulfillment;
  "lib/inventory": typeof lib_inventory;
  "lib/lineItemUnits": typeof lib_lineItemUnits;
  "lib/permissionsCore": typeof lib_permissionsCore;
  "lib/recalc": typeof lib_recalc;
  "lib/testtag": typeof lib_testtag;
  "lib/validators": typeof lib_validators;
  lineItemMergeMaps: typeof lineItemMergeMaps;
  lineItemWrites: typeof lineItemWrites;
  locationMedia: typeof locationMedia;
  locations: typeof locations;
  maintenanceRecordAssets: typeof maintenanceRecordAssets;
  maintenanceRecords: typeof maintenanceRecords;
  members: typeof members;
  modelBulkAccessories: typeof modelBulkAccessories;
  modelCheckItems: typeof modelCheckItems;
  modelMedia: typeof modelMedia;
  models: typeof models;
  notificationDismissals: typeof notificationDismissals;
  notificationEmailLogs: typeof notificationEmailLogs;
  overbooking: typeof overbooking;
  parity: typeof parity;
  projectCategories: typeof projectCategories;
  projectDetail: typeof projectDetail;
  projectEquipment: typeof projectEquipment;
  projectGroups: typeof projectGroups;
  projectLineItemUnits: typeof projectLineItemUnits;
  projectLineItems: typeof projectLineItems;
  projectManagers: typeof projectManagers;
  projectMedia: typeof projectMedia;
  projectNumberSequences: typeof projectNumberSequences;
  projectServices: typeof projectServices;
  projectTasks: typeof projectTasks;
  projectWrites: typeof projectWrites;
  projects: typeof projects;
  purgeRemovedTables: typeof purgeRemovedTables;
  savedTableViews: typeof savedTableViews;
  sectionPresets: typeof sectionPresets;
  serviceTemplates: typeof serviceTemplates;
  siteSettings: typeof siteSettings;
  subHireGroups: typeof subHireGroups;
  subHireItems: typeof subHireItems;
  subHireMedia: typeof subHireMedia;
  subHires: typeof subHires;
  subTestRecords: typeof subTestRecords;
  supplierModelRates: typeof supplierModelRates;
  supplierOrderItems: typeof supplierOrderItems;
  supplierOrders: typeof supplierOrders;
  suppliers: typeof suppliers;
  testProfiles: typeof testProfiles;
  testTagAssets: typeof testTagAssets;
  testTagAuditorTokens: typeof testTagAuditorTokens;
  testTagRecords: typeof testTagRecords;
  userNotificationPreferences: typeof userNotificationPreferences;
  users: typeof users;
  warehouseCloses: typeof warehouseCloses;
  warehouseDashboardTokens: typeof warehouseDashboardTokens;
  warehouseDetail: typeof warehouseDetail;
  warehouseList: typeof warehouseList;
  warehouseOps: typeof warehouseOps;
  wooCommerceIntegrations: typeof wooCommerceIntegrations;
  wooCommerceOrderLogs: typeof wooCommerceOrderLogs;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
