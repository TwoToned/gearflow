"use client";

import { Controller } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressInput } from "@/components/ui/address-input";
import { useOrgCountry } from "@/lib/use-org-country";
import type { PlaceResult } from "@/lib/address-autocomplete";
import { SERVICE_TYPE_LABELS } from "@/lib/constants/services";
import { serviceKind, type ServiceKind } from "./service-form";
import type { ServiceSheetState } from "./use-service-sheet";

export function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h4 className="t-overline text-muted">{title}</h4>
      {hint && <span className="text-caption text-muted">{hint}</span>}
    </div>
  );
}

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

const TRUCK_LABEL: Record<string, string> = {
  DELIVERY: "Truck arrives",
  PICKUP: "Truck collects",
  CLIENT_PICKUP: "Client collects at",
  CLIENT_DROPOFF: "Client drops off at",
};

const TIME_HINT: Record<string, string> = {
  DELIVERY: "When gear lands. The crew window above is when people work.",
  PICKUP: "When the truck collects. The crew window above is when people work.",
  CLIENT_PICKUP: "When the client is due. The crew window above is who staffs the counter.",
  CLIENT_DROPOFF: "When the client is due. The crew window above is who staffs the counter.",
};

function DateFields({ s, kind }: { s: ServiceSheetState; kind: ServiceKind }) {
  const { form } = s;
  const multi = kind === "multiDay";
  const date = form.watch("date") as unknown as string;
  return (
    <div className={multi ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "grid grid-cols-2 gap-3 sm:grid-cols-3"}>
      <Field label={multi ? "Start date" : "Date"}>
        <Input
          type="date"
          aria-label={multi ? "Start date" : "Date"}
          {...form.register("date")}
          onChange={(e) => {
            form.setValue("date", e.target.value as never);
            const end = form.getValues("endDate") as unknown as string;
            if (!multi || !end || end < e.target.value) form.setValue("endDate", e.target.value as never);
          }}
        />
      </Field>
      {multi && (
        <Field label="End date">
          <Input type="date" aria-label="End date" min={date || undefined} {...form.register("endDate")} />
        </Field>
      )}
      <Field label="Start">
        <Input type="time" aria-label="Start time" {...form.register("startTime")} />
      </Field>
      <Field label="End">
        <Input type="time" aria-label="End time" {...form.register("endTime")} />
      </Field>
    </div>
  );
}

export function WhenSection({ s }: { s: ServiceSheetState }) {
  const kind = serviceKind(s.form.watch("type"));
  const type = s.form.watch("type");
  const truck = kind === "transport" || kind === "client";
  return (
    <section className="space-y-3" aria-label="When">
      <SectionHead title="When" />
      <DateFields s={s} kind={kind} />
      {truck && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
          <Field label={TRUCK_LABEL[type]}>
            <Input type="time" aria-label={TRUCK_LABEL[type]} {...s.form.register("scheduledTime")} />
          </Field>
          <p className="text-caption text-muted">{TIME_HINT[type]}</p>
        </div>
      )}
      <p className="text-caption text-muted">Moving the date or time re-times every crew call on this service.</p>
    </section>
  );
}

function VenueAddress({ s, label, venue }: { s: ServiceSheetState; label: string; venue: string }) {
  const { form } = s;
  const country = useOrgCountry();
  return (
    <Field label={label}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <AddressInput
            value={(form.watch("address") as string) || ""}
            onChange={(v) => form.setValue("address", v)}
            onPlaceSelect={(p: PlaceResult | null) => {
              form.setValue("latitude", p?.latitude ?? null);
              form.setValue("longitude", p?.longitude ?? null);
            }}
            initialCoordinates={
              form.getValues("latitude") != null
                ? { latitude: form.getValues("latitude") as number, longitude: form.getValues("longitude") as number }
                : undefined
            }
            countryCode={country}
          />
        </div>
        {venue && (
          <Button type="button" variant="line" size="sm" className="touch-target" onClick={() => form.setValue("address", venue)}>
            Use venue
          </Button>
        )}
      </div>
    </Field>
  );
}

function VehicleFields({ s, vehicles }: { s: ServiceSheetState; vehicles: string[] }) {
  const { form } = s;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Vehicle">
        <Input list="service-sheet-vehicles" placeholder="e.g. 3-tonne truck" {...form.register("vehicleDescription")} />
        <datalist id="service-sheet-vehicles">
          {vehicles.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </Field>
      <Field label="Trips">
        <Input type="number" min={1} placeholder="1" {...form.register("numberOfTrips")} />
      </Field>
    </div>
  );
}

/** Client pick up / drop off: our counter, and who comes to it (replaces Where). */
function ClientHandover({ s, siteContact }: { s: ServiceSheetState; siteContact: { name: string; phone: string } }) {
  const { form } = s;
  const type = form.watch("type");
  const collects = type === "CLIENT_PICKUP";
  const counter = (form.watch("address") as string) || "";
  return (
    <section className="space-y-3" aria-label={collects ? "Who collects" : "Who drops off"}>
      <SectionHead title={collects ? "Who collects" : "Who drops off"} />
      <p className="text-caption text-muted">
        {counter ? `At our warehouse counter: ${counter}.` : "Set a warehouse location so the counter address fills in."}{" "}
        {collects
          ? "Gear checks out at the counter when they sign."
          : "Gear checks back in at the counter."}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input placeholder={siteContact.name} {...form.register("clientContactName")} /></Field>
        <Field label="Phone"><Input type="tel" placeholder={siteContact.phone} {...form.register("clientContactPhone")} /></Field>
        <Field label="Their vehicle and rego"><Input placeholder="e.g. Van CXQ 412" {...form.register("clientVehicle")} /></Field>
      </div>
      {(siteContact.name || siteContact.phone) && (
        <Button
          type="button"
          variant="line"
          size="sm"
          onClick={() => {
            form.setValue("clientContactName", siteContact.name);
            form.setValue("clientContactPhone", siteContact.phone);
          }}
        >
          Use the site contact
        </Button>
      )}
    </section>
  );
}

export function WhereSection(props: {
  s: ServiceSheetState;
  venue: string;
  vehicles: string[];
  siteContact: { name: string; phone: string };
}) {
  const { s, venue, vehicles, siteContact } = props;
  const type = s.form.watch("type");
  const kind = serviceKind(type);
  if (kind === "client") return <ClientHandover s={s} siteContact={siteContact} />;
  if (kind === "multiDay") return null;
  const label = type === "DELIVERY" ? "Deliver to" : type === "PICKUP" ? "Collect from" : "Address";
  return (
    <section className="space-y-3" aria-label="Where">
      <SectionHead title="Where" />
      <VenueAddress s={s} label={label} venue={venue} />
      {kind === "transport" && <VehicleFields s={s} vehicles={vehicles} />}
    </section>
  );
}

export function TypeOverline({ s }: { s: ServiceSheetState }) {
  return <Controller control={s.form.control} name="type" render={({ field }) => <span className="t-overline text-muted">{SERVICE_TYPE_LABELS[field.value]}</span>} />;
}
