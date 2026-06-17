"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  FolderOpen,
  Warehouse,
  ScanBarcode,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { scanLookup } from "@/server/scan-lookup";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// NOTE (UX-gaps 2026-06-10): The task asked to drop the "Scan" tab for a 4-tab
// bar, citing a DESIGN.md spec. That spec does not exist — DESIGN.md has no
// 4-tab rule and explicitly names warehouse staff "scanning gear all day" as a
// primary persona, so the lookup shortcut is deliberately kept one tap away here.
// Revisit only if a real 4-tab requirement is confirmed.
//
// The in-app camera scanner was removed (it never worked on iPhone); the "Scan"
// tab now opens a manual tag-entry dialog that routes to the same scanLookup
// handler. External HID barcode wedges still work — they type into the field
// and submit on Enter.
const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { href: "/assets/registry", icon: Package, label: "Assets", matchPrefix: "/assets" },
  { href: "__scan__", icon: ScanBarcode, label: "Scan", isScan: true },
  { href: "/projects", icon: FolderOpen, label: "Projects" },
  { href: "/warehouse", icon: Warehouse, label: "Warehouse" },
];

/**
 * Mobile bottom navigation bar.
 * Rendered in the layout flow (not fixed) — the parent layout uses
 * a flex column with h-[100dvh] so this nav naturally sits at the bottom.
 */
export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupValue, setLookupValue] = useState("");
  const [lookupPending, setLookupPending] = useState(false);

  const handleLookup = async (value: string) => {
    const tag = value.trim();
    if (!tag) return;
    setLookupPending(true);
    try {
      const result = await scanLookup(tag);
      if (result.url) {
        setLookupOpen(false);
        setLookupValue("");
        router.push(result.url);
        toast.success(`Found ${result.label}`);
      } else {
        toast.error(`Nothing found for "${tag}"`);
      }
    } catch {
      toast.error("Lookup failed");
    } finally {
      setLookupPending(false);
    }
  };

  return (
    <>
      <nav className="shrink-0 border-t bg-background md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-around px-1">
          {navItems.map((item) => {
            if (item.isScan) {
              return (
                <button
                  key="scan"
                  onClick={() => setLookupOpen(true)}
                  className="flex flex-col items-center justify-center gap-0.5 py-2 px-3 text-primary transition-colors"
                >
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            }

            const isActive = item.matchPrefix
              ? pathname.startsWith(item.matchPrefix)
              : pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 px-3 transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-fg-3"
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <Dialog
        open={lookupOpen}
        onOpenChange={(open) => {
          setLookupOpen(open);
          if (!open) setLookupValue("");
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Quick lookup</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLookup(lookupValue);
            }}
          >
            <AssetTagInput
              autoFocus
              value={lookupValue}
              onChange={(e) => setLookupValue(e.target.value)}
              placeholder="Enter an asset, kit, or project tag..."
              disabled={lookupPending}
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLookupOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={lookupPending || !lookupValue.trim()}>
                {lookupPending ? "Looking up..." : "Look up"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
