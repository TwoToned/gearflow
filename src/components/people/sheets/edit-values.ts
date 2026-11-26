import type { ClientDoc } from "@/hooks/use-clients";
import type { ClientFormValues } from "@/lib/validations/client";
import type { SupplierFormValues } from "@/lib/validations/supplier";
import type { CrewMemberFormValues } from "@/lib/validations/crew";
import type { SupplierOrderFormValues } from "@/lib/validations/supplier-order";

/**
 * A stored record as its edit sheet's form values. The sheet opens with EVERY stored field the form holds, so a save
 * never blanks one it did not show. Pure: the hosts read the record, these shape it.
 */
export function clientToFormValues(c: ClientDoc): ClientFormValues & { id: string } {
  return {
    id: c.id,
    name: c.name,
    type: c.type ?? "COMPANY",
    contactName: c.contactName || "",
    contactEmail: c.contactEmail || "",
    contactPhone: c.contactPhone || "",
    billingAddress: c.billingAddress || "",
    billingLatitude: c.billingLatitude ?? null,
    billingLongitude: c.billingLongitude ?? null,
    shippingAddress: c.shippingAddress || "",
    shippingLatitude: c.shippingLatitude ?? null,
    shippingLongitude: c.shippingLongitude ?? null,
    taxId: c.taxId || "",
    taxExempt: c.taxExempt ?? false,
    taxExemptReason: c.taxExemptReason || "",
    paymentTerms: c.paymentTerms || "",
    defaultDiscount: c.defaultDiscount ?? undefined,
    paymentProfile: c.paymentProfile ?? "FULL_UPFRONT",
    profileDepositPercent: c.profileDepositPercent ?? undefined,
    notes: c.notes || "",
    tags: c.tags ?? [],
    isActive: c.isActive ?? true,
  };
}

type SupplierSource = {
  id: string; name: string; contactName?: string | null; email?: string | null; phone?: string | null; website?: string | null;
  address?: string | null; latitude?: number | null; longitude?: number | null; notes?: string | null; accountNumber?: string | null;
  paymentTerms?: string | null; defaultLeadTime?: string | null; tags?: string[] | null; isActive?: boolean | null;
};

export function supplierToFormValues(s: SupplierSource): SupplierFormValues & { id: string } {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contactName || "",
    email: s.email || "",
    phone: s.phone || "",
    website: s.website || "",
    address: s.address || "",
    latitude: s.latitude ?? null,
    longitude: s.longitude ?? null,
    notes: s.notes || "",
    accountNumber: s.accountNumber || "",
    paymentTerms: s.paymentTerms || "",
    defaultLeadTime: s.defaultLeadTime || "",
    tags: s.tags || [],
    isActive: s.isActive ?? true,
  };
}

type CrewSource = {
  firstName: string; lastName: string; email?: string | null; phone?: string | null; type?: CrewMemberFormValues["type"]; status?: CrewMemberFormValues["status"];
  department?: string | null; crewRoleId?: string | null; defaultDayRate?: number | null; defaultHourlyRate?: number | null; overtimeMultiplier?: number | null;
  currency?: string | null; address?: string | null; addressLatitude?: number | null; addressLongitude?: number | null;
  emergencyContactName?: string | null; emergencyContactPhone?: string | null; dateOfBirth?: string | number | null; abnOrGst?: string | null;
  notes?: string | null; tags?: string[] | null; userId?: string | null; isActive?: boolean | null;
};

const num = (n: number | null | undefined) => (n != null ? String(n) : "");

export function crewToFormValues(id: string, m: CrewSource): CrewMemberFormValues & { id: string } {
  return {
    id,
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email || "",
    phone: m.phone || "",
    type: m.type,
    status: m.status,
    department: m.department || "",
    crewRoleId: m.crewRoleId || "",
    defaultDayRate: num(m.defaultDayRate),
    defaultHourlyRate: num(m.defaultHourlyRate),
    overtimeMultiplier: num(m.overtimeMultiplier),
    currency: m.currency || "",
    address: m.address || "",
    addressLatitude: m.addressLatitude ?? null,
    addressLongitude: m.addressLongitude ?? null,
    emergencyContactName: m.emergencyContactName || "",
    emergencyContactPhone: m.emergencyContactPhone || "",
    dateOfBirth: m.dateOfBirth ? new Date(m.dateOfBirth).toISOString().split("T")[0] : "",
    abnOrGst: m.abnOrGst || "",
    notes: m.notes || "",
    tags: m.tags || [],
    userId: m.userId || "",
    isActive: m.isActive ?? true,
  };
}

const day = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export function orderToFormValues(o: {
  id: string; supplierId: string; orderNumber: string; type: SupplierOrderFormValues["type"]; status: SupplierOrderFormValues["status"];
  orderDate?: number | null; expectedDate?: number | null; notes?: string | null;
}): SupplierOrderFormValues & { id: string } {
  return { id: o.id, supplierId: o.supplierId, orderNumber: o.orderNumber, type: o.type, status: o.status, orderDate: day(o.orderDate), expectedDate: day(o.expectedDate), notes: o.notes ?? "" };
}
