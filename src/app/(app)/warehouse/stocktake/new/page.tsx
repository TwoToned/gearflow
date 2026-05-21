"use client";

import { StocktakeForm } from "@/components/stocktake/stocktake-form";

export default function NewStocktakePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Stocktake</h1>
        <p className="text-muted-foreground">
          Create a new inventory verification for a location.
        </p>
      </div>
      <StocktakeForm />
    </div>
  );
}
