"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { matchSlashCommands, extractEntityId, SLASH_COMMANDS, type SlashCommand } from "@/lib/slash-commands";
import { signOut } from "@/lib/auth-client";
import type { PaletteRow, PaletteSection } from "@/lib/palette/model";
import type { Resource } from "@/lib/permissions";

type Permissions = Partial<Record<Resource, readonly string[]>> | null;

/** Run one slash command's action (kept from the live palette). */
function runAction(cmd: SlashCommand, pathname: string, push: (href: string) => void): void {
  const entityId = extractEntityId(pathname);
  const a = cmd.action;
  switch (a.type) {
    case "navigate":
      push(a.path.replace(":id", entityId || ""));
      return;
    case "navigate_section":
      document.getElementById(a.hash)?.scrollIntoView({ behavior: "smooth" });
      return;
    case "open_dialog":
      window.dispatchEvent(new CustomEvent("slash-command", { detail: { dialog: a.dialog } }));
      return;
    case "generate_document":
      if (entityId) window.open(`/api/documents/${entityId}?type=${a.docType}`, "_blank");
      return;
    case "trigger":
      if (a.event === "logout") void signOut();
      else window.dispatchEvent(new CustomEvent("slash-command", { detail: { event: a.event } }));
  }
}

function slashRow(cmd: SlashCommand): PaletteRow {
  return { id: `slash-${cmd.id}`, title: cmd.label, subtitle: cmd.description, icon: cmd.icon, hint: `/${cmd.command}`, action: { kind: "slash", commandId: cmd.id } };
}

/**
 * `/` mode (kept from live): this page's actions first, then Global. Also the
 * one runner for every slash action the palette offers (the empty state's
 * Actions and `On #…` rows are slash commands too).
 */
export function useSlashMode(query: string, pathname: string, permissions: Permissions, drilling: boolean) {
  const router = useRouter();
  const active = query.startsWith("/") && !drilling;
  const slashQuery = active ? query.slice(1) : "";

  const sections = useMemo((): PaletteSection[] => {
    if (!active) return [];
    const matches = matchSlashCommands(slashQuery, pathname, permissions);
    const page = matches.filter((m) => m.isPageSpecific).map((m) => slashRow(m.command));
    const global = matches.filter((m) => !m.isPageSpecific).map((m) => slashRow(m.command));
    return [
      { key: "page-actions", label: "Page actions", rows: page },
      { key: "global", label: "Global", rows: global },
    ].filter((s) => s.rows.length > 0);
  }, [active, slashQuery, pathname, permissions]);

  const run = useCallback(
    (commandId: string) => {
      const cmd = SLASH_COMMANDS.find((c) => c.id === commandId);
      if (cmd) runAction(cmd, pathname, (href) => router.push(href));
    },
    [pathname, router],
  );

  return { active, slashQuery, sections, run };
}
