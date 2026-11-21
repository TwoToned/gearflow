"use client";

import { toast } from "sonner";

import type { CrewRoleDoc } from "@/hooks/use-crew";
import { useCrewRoleWrites } from "@/hooks/use-crew-role-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import type { CrewRoleFormValues } from "@/lib/validations/crew";

/**
 * Full field set for an update (`updateNative` is a full patch, so every
 * caller resends every field). Also the Undo snapshot of an edit.
 */
export function roleFormValues(r: CrewRoleDoc): CrewRoleFormValues {
  return {
    name: r.name,
    description: r.description || "",
    department: r.department || "",
    color: r.color || "",
    defaultRate: r.defaultRate ?? undefined,
    rateType: r.rateType || "",
    chargeRate: r.chargeRate ?? undefined,
    sortOrder: r.sortOrder ?? 0,
    isActive: r.isActive ?? true,
  };
}

const opposite = (d: "up" | "down"): "up" | "down" => (d === "up" ? "down" : "up");

/**
 * The roles sheet's writes (§9h.5). Every one toasts; the reversible ones get
 * Undo from ONE closure: a move → the opposite move (one atomic `moveNative`
 * each way), archive ↔ restore, an edit → its snapshot replayed.
 */
export function useRoleSheetWrites() {
  const w = useCrewRoleWrites();

  async function move(role: CrewRoleDoc, direction: "up" | "down") {
    try {
      const res = await w.move(role.id, direction);
      if (!res.moved) return;
      announceListWrite({
        title: `Moved ${role.name} ${direction}`,
        undoneTitle: "Undone · order restored",
        performUndo: async () => {
          await w.move(role.id, opposite(direction));
        },
      });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not reorder" });
    }
  }

  async function setActive(role: CrewRoleDoc, isActive: boolean): Promise<boolean> {
    try {
      await w.archive(role.id, isActive);
    } catch (e) {
      showError(e, { fallbackTitle: isActive ? "Could not restore the role" : "Could not archive the role" });
      return false;
    }
    announceListWrite({
      title: `${role.name} ${isActive ? "restored" : "archived"}`,
      undoneTitle: `Undone · ${role.name} ${isActive ? "archived again" : "restored"}`,
      performUndo: async () => {
        await w.archive(role.id, !isActive);
      },
    });
    return true;
  }

  async function save(role: CrewRoleDoc | null, values: CrewRoleFormValues): Promise<boolean> {
    try {
      if (!role) {
        await w.create(values);
        toast.success(`${values.name} added`);
        return true;
      }
      const snapshot = roleFormValues(role);
      await w.update(role.id, values);
      announceListWrite({
        title: `${values.name} updated · new calls use the new rate`,
        undoneTitle: `Undone · ${role.name} restored`,
        performUndo: async () => {
          await w.update(role.id, snapshot);
        },
      });
      return true;
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the role" });
      return false;
    }
  }

  return { move, setActive, save };
}
