import { v } from "convex/values";

/**
 * Convex validators for the 65 Prisma enums.
 *
 * Generated from prisma/schema.prisma (Phase 1 of the Convex migration).
 * Reused as field validators in convex/schema.ts and as mutation arg validators
 * in the per-domain function files (Phase 2). Keep in sync with the Prisma enums.
 */

export const SSOApprovalStatus = v.union(
  v.literal("PENDING"),
  v.literal("APPROVED"),
  v.literal("REJECTED"),
);
export const AssetType = v.union(
  v.literal("SERIALIZED"),
  v.literal("BULK"),
);
export const AssetStatus = v.union(
  v.literal("AVAILABLE"),
  v.literal("CHECKED_OUT"),
  v.literal("IN_MAINTENANCE"),
  v.literal("RETIRED"),
  v.literal("LOST"),
  v.literal("RESERVED"),
);
export const AssetCondition = v.union(
  v.literal("NEW"),
  v.literal("GOOD"),
  v.literal("FAIR"),
  v.literal("POOR"),
  v.literal("DAMAGED"),
);
export const BulkAssetStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("LOW_STOCK"),
  v.literal("OUT_OF_STOCK"),
  v.literal("RETIRED"),
);
export const LocationType = v.union(
  v.literal("WAREHOUSE"),
  v.literal("VENUE"),
  v.literal("VEHICLE"),
  v.literal("OFFSITE"),
);
export const MaintenanceType = v.union(
  v.literal("REPAIR"),
  v.literal("PREVENTATIVE"),
  v.literal("TEST_AND_TAG"),
  v.literal("INSPECTION"),
  v.literal("CLEANING"),
  v.literal("FIRMWARE_UPDATE"),
);
export const MaintenanceStatus = v.union(
  v.literal("SCHEDULED"),
  v.literal("AWAITING_PARTS"),
  v.literal("IN_PROGRESS"),
  v.literal("QA"),
  v.literal("COMPLETED"),
  v.literal("CANCELLED"),
);
export const MaintenanceResult = v.union(
  v.literal("PASS"),
  v.literal("FAIL"),
  v.literal("CONDITIONAL"),
);
export const ClientType = v.union(
  v.literal("COMPANY"),
  v.literal("INDIVIDUAL"),
  v.literal("VENUE"),
  v.literal("PRODUCTION_COMPANY"),
);
export const ProjectStatus = v.union(
  v.literal("ENQUIRY"),
  v.literal("QUOTING"),
  v.literal("QUOTED"),
  v.literal("CONFIRMED"),
  v.literal("PREPPING"),
  v.literal("CHECKED_OUT"),
  v.literal("ON_SITE"),
  v.literal("RETURNED"),
  v.literal("COMPLETED"),
  v.literal("INVOICED"),
  v.literal("CANCELLED"),
);
export const ProjectType = v.union(
  v.literal("DRY_HIRE"),
  v.literal("WET_HIRE"),
  v.literal("INSTALLATION"),
  v.literal("TOUR"),
  v.literal("CORPORATE"),
  v.literal("THEATRE"),
  v.literal("FESTIVAL"),
  v.literal("CONFERENCE"),
  v.literal("OTHER"),
);
export const LineItemType = v.union(
  v.literal("EQUIPMENT"),
  v.literal("SERVICE"),
  v.literal("LABOUR"),
  v.literal("TRANSPORT"),
  v.literal("MISC"),
);
export const PricingType = v.union(
  v.literal("PER_DAY"),
  v.literal("PER_WEEK"),
  v.literal("FLAT"),
  v.literal("PER_HOUR"),
  v.literal("OPTIMIZED"),
);
export const RentalPeriod = v.union(
  v.literal("DAILY"),
  v.literal("WEEKLY"),
);
export const LineItemStatus = v.union(
  v.literal("QUOTED"),
  v.literal("CONFIRMED"),
  v.literal("PREPPED"),
  v.literal("CHECKED_OUT"),
  v.literal("RETURNED"),
  v.literal("CANCELLED"),
);
export const ReturnCondition = v.union(
  v.literal("GOOD"),
  v.literal("DAMAGED"),
  v.literal("MISSING"),
);
export const ScanAction = v.union(
  v.literal("CHECK_OUT"),
  v.literal("CHECK_IN"),
  v.literal("SCAN_VERIFY"),
  v.literal("TRANSFER"),
);
export const CheckItemType = v.union(
  v.literal("PASS_FAIL"),
  v.literal("NOTES"),
  v.literal("MEASUREMENT"),
  v.literal("DROPDOWN"),
);
export const CheckContext = v.union(
  v.literal("PREP"),
  v.literal("RETURN"),
  v.literal("AD_HOC"),
);
export const CheckResult = v.union(
  v.literal("PASS"),
  v.literal("FAIL"),
  v.literal("NOTES_ONLY"),
);
export const PrepStatus = v.union(
  v.literal("PENDING"),
  v.literal("PULLED"),
  v.literal("FLAGGED_FAULTY"),
  v.literal("FLAGGED_TT_OVERDUE"),
  v.literal("PACKED"),
);
export const ReturnStatus = v.union(
  v.literal("PENDING"),
  v.literal("UNPACKED"),
  v.literal("STORED"),
  v.literal("DAMAGED"),
  v.literal("LOST"),
);
export const KitStatus = v.union(
  v.literal("AVAILABLE"),
  v.literal("CHECKED_OUT"),
  v.literal("IN_MAINTENANCE"),
  v.literal("RETIRED"),
  v.literal("INCOMPLETE"),
);
export const KitPricingMode = v.union(
  v.literal("KIT_PRICE"),
  v.literal("ITEMIZED"),
);
export const LineItemChildKind = v.union(
  v.literal("KIT"),
  v.literal("ACCESSORY"),
);
export const KitCheckMode = v.union(
  v.literal("KIT_LEVEL"),
  v.literal("PER_ITEM"),
);
export const MediaType = v.union(
  v.literal("PHOTO"),
  v.literal("MANUAL"),
  v.literal("SPEC_SHEET"),
  v.literal("WIRING_DIAGRAM"),
  v.literal("DOCUMENT"),
  v.literal("OTHER"),
);
export const TestTagStatus = v.union(
  v.literal("NOT_YET_TESTED"),
  v.literal("CURRENT"),
  v.literal("DUE_SOON"),
  v.literal("OVERDUE"),
  v.literal("FAILED"),
  v.literal("RETIRED"),
);
export const EquipmentClass = v.union(
  v.literal("CLASS_I"),
  v.literal("CLASS_II"),
  v.literal("CLASS_II_DOUBLE_INSULATED"),
  v.literal("LEAD_CORD_ASSEMBLY"),
);
export const ApplianceType = v.union(
  v.literal("APPLIANCE"),
  v.literal("CORD_SET"),
  v.literal("EXTENSION_LEAD"),
  v.literal("POWER_BOARD"),
  v.literal("RCD_PORTABLE"),
  v.literal("RCD_FIXED"),
  v.literal("THREE_PHASE"),
  v.literal("MICROWAVE"),
  v.literal("OTHER"),
);
export const TestResult = v.union(
  v.literal("PASS"),
  v.literal("FAIL"),
  v.literal("NOT_APPLICABLE"),
);
export const TestMethod = v.union(
  v.literal("INSULATION_RESISTANCE"),
  v.literal("LEAKAGE_CURRENT"),
  v.literal("BOTH"),
);
export const FailureAction = v.union(
  v.literal("NONE"),
  v.literal("REPAIRED"),
  v.literal("REMOVED_FROM_SERVICE"),
  v.literal("DISPOSED"),
  v.literal("REFERRED_TO_ELECTRICIAN"),
);
export const SupplierOrderType = v.union(
  v.literal("PURCHASE"),
  v.literal("SUBHIRE"),
  v.literal("REPAIR"),
  v.literal("LABOUR"),
  v.literal("OTHER"),
);
export const SupplierOrderStatus = v.union(
  v.literal("DRAFT"),
  v.literal("ORDERED"),
  v.literal("PARTIAL"),
  v.literal("RECEIVED"),
  v.literal("CANCELLED"),
);
export const SubHirePricingMode = v.union(
  v.literal("ITEMIZED"),
  v.literal("ORDER_TOTAL"),
);
export const SubHireStatus = v.union(
  v.literal("DRAFT"),
  v.literal("CONFIRMED"),
  v.literal("ON_HIRE"),
  v.literal("RETURNED"),
  v.literal("CANCELLED"),
);
export const SubHirePaymentStatus = v.union(
  v.literal("UNPAID"),
  v.literal("PARTIALLY_PAID"),
  v.literal("PAID"),
);
export const ProjectMediaType = v.union(
  v.literal("FLOOR_PLAN"),
  v.literal("QUOTE"),
  v.literal("INVOICE"),
  v.literal("SITE_MAP"),
  v.literal("RISK_ASSESSMENT"),
  v.literal("CLIENT_BRIEF"),
  v.literal("CAD"),
  v.literal("CONTRACT"),
  v.literal("PHOTO"),
  v.literal("OTHER"),
);
export const AccessoryAllocationMode = v.union(
  v.literal("SHIPS_WITH"),
  v.literal("DEDICATED"),
);
export const DamageSeverity = v.union(
  v.literal("MINOR"),
  v.literal("MAJOR"),
  v.literal("TOTAL"),
);
export const DamageStatus = v.union(
  v.literal("OPEN"),
  v.literal("UNDER_REPAIR"),
  v.literal("RESOLVED"),
  v.literal("CHARGED_BACK"),
);
export const CrewMemberType = v.union(
  v.literal("EMPLOYEE"),
  v.literal("FREELANCER"),
  v.literal("CONTRACTOR"),
  v.literal("VOLUNTEER"),
);
export const CrewMemberStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("INACTIVE"),
  v.literal("ON_LEAVE"),
  v.literal("ARCHIVED"),
);
export const CrewRateType = v.union(
  v.literal("HOURLY"),
  v.literal("DAILY"),
  v.literal("FLAT"),
);
export const CrewCertStatus = v.union(
  v.literal("CURRENT"),
  v.literal("EXPIRING_SOON"),
  v.literal("EXPIRED"),
  v.literal("NOT_VERIFIED"),
);
export const AssignmentStatus = v.union(
  v.literal("PENDING"),
  v.literal("OFFERED"),
  v.literal("ACCEPTED"),
  v.literal("DECLINED"),
  v.literal("CONFIRMED"),
  v.literal("CANCELLED"),
  v.literal("COMPLETED"),
);
export const ProjectPhase = v.union(
  v.literal("BUMP_IN"),
  v.literal("EVENT"),
  v.literal("BUMP_OUT"),
  v.literal("DELIVERY"),
  v.literal("PICKUP"),
  v.literal("SETUP"),
  v.literal("REHEARSAL"),
  v.literal("FULL_DURATION"),
);
export const ShiftStatus = v.union(
  v.literal("SCHEDULED"),
  v.literal("IN_PROGRESS"),
  v.literal("COMPLETED"),
  v.literal("CANCELLED"),
  v.literal("NO_SHOW"),
);
export const AvailabilityType = v.union(
  v.literal("UNAVAILABLE"),
  v.literal("TENTATIVE"),
  v.literal("PREFERRED"),
);
export const TimeEntryStatus = v.union(
  v.literal("DRAFT"),
  v.literal("SUBMITTED"),
  v.literal("APPROVED"),
  v.literal("DISPUTED"),
  v.literal("EXPORTED"),
);
export const ServiceType = v.union(
  v.literal("DELIVERY"),
  v.literal("PICKUP"),
  v.literal("BUMP_IN"),
  v.literal("BUMP_OUT"),
  v.literal("LABOUR"),
  v.literal("MISC"),
);
export const ServiceStatus = v.union(
  v.literal("PLANNED"),
  v.literal("CONFIRMED"),
  v.literal("IN_PROGRESS"),
  v.literal("COMPLETED"),
  v.literal("CANCELLED"),
);
export const WooOrderLogStatus = v.union(
  v.literal("RECEIVED"),
  v.literal("PROCESSING"),
  v.literal("COMPLETED"),
  v.literal("FAILED"),
  v.literal("DUPLICATE"),
);
export const DiscordBotDesiredState = v.union(
  v.literal("RUNNING"),
  v.literal("STOPPED"),
);
export const DiscordOutboxStatus = v.union(
  v.literal("PENDING"),
  v.literal("PROCESSING"),
  v.literal("PROCESSED"),
  v.literal("FAILED"),
);
export const ScheduleFrequency = v.union(
  v.literal("DAILY"),
  v.literal("WEEKLY"),
  v.literal("MONTHLY"),
);
export const StocktakeScope = v.union(
  v.literal("FULL"),
  v.literal("CATEGORY"),
  v.literal("SPOT_CHECK"),
);
export const StocktakeStatus = v.union(
  v.literal("DRAFT"),
  v.literal("IN_PROGRESS"),
  v.literal("REVIEWING"),
  v.literal("COMPLETED"),
  v.literal("CANCELLED"),
);
export const StocktakeItemResult = v.union(
  v.literal("MATCH"),
  v.literal("MISSING"),
  v.literal("UNEXPECTED"),
  v.literal("QUANTITY_MISMATCH"),
  v.literal("WRONG_LOCATION"),
);
export const CustomFieldEntity = v.union(
  v.literal("ASSET"),
  v.literal("BULK_ASSET"),
  v.literal("KIT"),
  v.literal("PROJECT"),
);
export const CustomFieldType = v.union(
  v.literal("TEXT"),
  v.literal("NUMBER"),
  v.literal("DATE"),
  v.literal("SELECT"),
  v.literal("BOOLEAN"),
);
export const ProjectTaskStatus = v.union(
  v.literal("TODO"),
  v.literal("IN_PROGRESS"),
  v.literal("DONE"),
);
export const ProjectTaskPriority = v.union(
  v.literal("LOW"),
  v.literal("NORMAL"),
  v.literal("HIGH"),
);
