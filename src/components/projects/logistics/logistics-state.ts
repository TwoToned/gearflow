"use client";

import * as React from "react";

import type { Lane } from "@/lib/logistics-model";
import type { LogisticsView } from "./lane-bar";

/** Every piece of UI state the tab owns (view, lane, day, which dialog is open). State only, no logic. */
export function useLogisticsState() {
  const [view, setView] = React.useState<LogisticsView>("timeline");
  const [lane, setLane] = React.useState<Lane>("all");
  const [day, setDay] = React.useState("");
  const [showCost, setShowCost] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [pickId, setPickId] = React.useState<string | null>(null);
  const [assignmentId, setAssignmentId] = React.useState<string | null>(null);
  const [offerIds, setOfferIds] = React.useState<string[] | null>(null);
  const [datesOpen, setDatesOpen] = React.useState(false);
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [callSheetOpen, setCallSheetOpen] = React.useState(false);
  const [messageOpen, setMessageOpen] = React.useState(false);
  const [availOpen, setAvailOpen] = React.useState(false);
  const [messageTarget, setMessageTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [bulkDelete, setBulkDelete] = React.useState<"services" | "crew" | null>(null);
  const [orderId, setOrderId] = React.useState<string | null>(null);
  return {
    orderId, setOrderId,
    view, setView, lane, setLane, day, setDay, showCost, setShowCost,
    editId, setEditId, pickId, setPickId, assignmentId, setAssignmentId, offerIds, setOfferIds,
    datesOpen, setDatesOpen, cloneOpen, setCloneOpen, callSheetOpen, setCallSheetOpen,
    messageOpen, setMessageOpen, availOpen, setAvailOpen, messageTarget, setMessageTarget,
    bulkDelete, setBulkDelete,
  };
}

export type LogisticsState = ReturnType<typeof useLogisticsState>;
