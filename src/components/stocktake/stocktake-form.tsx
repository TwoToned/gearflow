"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  createStocktakeSchema,
  type CreateStocktakeValues,
} from "@/lib/validations/stocktake";
import { createStocktake, updateStocktake } from "@/server/stocktake";
import { useLocations } from "@/hooks/use-locations";
import { useCategories } from "@/hooks/use-categories";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface StocktakeFormProps {
  initialData?: CreateStocktakeValues & { id: string };
}

export function StocktakeForm({ initialData }: StocktakeFormProps) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isEditing = !!initialData?.id;

  // Reactive location list from Convex.
  const locations = useLocations(orgId) ?? [];

  // Reactive categories (Convex) → sorted by sortOrder then name.
  const categoriesDocs = useCategories(orgId);
  const categories = useMemo(
    () =>
      [...(categoriesDocs ?? [])].sort((a, b) => {
        const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        return so !== 0 ? so : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }),
    [categoriesDocs],
  );

  const form = useForm<CreateStocktakeValues>({
    resolver: zodResolver(createStocktakeSchema),
    defaultValues: initialData ?? {
      name: "",
      locationId: "",
      scope: "FULL",
      categoryId: undefined,
      notes: "",
    },
  });

  const scope = form.watch("scope");

  const mutation = useMutation({
    mutationFn: (data: CreateStocktakeValues) =>
      isEditing ? updateStocktake(initialData!.id, data) : createStocktake(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Stocktake updated" : "Stocktake created");
      const id = isEditing ? initialData!.id : (result as { id: string }).id;
      router.push(`/warehouse/stocktake/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });


  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6 space-y-4">
        <h3 className="t-heading text-fg">Stocktake Details</h3>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g. Q1 2026 Full Stocktake"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="locationId">Location</Label>
            <select
              id="locationId"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none"
              {...form.register("locationId")}
            >
              <option value="">Select a location...</option>
              {(Array.isArray(locations) ? locations : []).map(
                (loc: { id: string; name: string }) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ),
              )}
            </select>
            {form.formState.errors.locationId && (
              <p className="text-sm text-destructive">
                {form.formState.errors.locationId.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <div className="flex gap-2">
              {(
                [
                  { value: "FULL", label: "Full Warehouse" },
                  { value: "CATEGORY", label: "Category" },
                  { value: "SPOT_CHECK", label: "Spot Check" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    scope === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input hover:bg-accent"
                  }`}
                  onClick={() => form.setValue("scope", opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {scope === "CATEGORY" && (
            <div className="space-y-2">
              <Label htmlFor="categoryId">Category</Label>
              <select
                id="categoryId"
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none"
                {...form.register("categoryId")}
              >
                <option value="">Select a category...</option>
                {(Array.isArray(categories) ? categories : []).map(
                  (cat: { id: string; name: string }) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ),
                )}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes about this stocktake..."
              {...form.register("notes")}
            />
          </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {isEditing ? "Save Changes" : "Create Stocktake"}
        </Button>
      </div>
    </form>
  );
}
