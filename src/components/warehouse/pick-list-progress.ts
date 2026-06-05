// Pure pick-list helpers — no React or server imports, so they unit-test
// without dragging in the page's server action / auth / prisma chain.

/**
 * Accessories permanently attached to an asset (childKind === "ACCESSORY")
 * travel with their parent line. Unlike kit members they hang off a normal
 * top-level asset row, so we render them indented underneath it.
 */
export function getAccessoryChildren(item: Record<string, unknown>): Array<Record<string, unknown>> {
  const children = (item.childLineItems || []) as Array<Record<string, unknown>>;
  return children.filter((c) => c.childKind === "ACCESSORY");
}

/**
 * Compute pick-list progress totals. Pure so it can be unit-tested without
 * rendering: a kit contributes its header + each member (qty>1 fans out per
 * unit); a plain asset contributes itself + each attached accessory (also
 * qty-fanned). Keys mirror the render (`kit-<id>`, `<id>`, `<id>-<i>`).
 */
export function pickListProgress(
  allGroups: Array<{ items: Array<Record<string, unknown>> }>,
  checked: Set<string>,
): { totalItems: number; checkedItems: number } {
  let totalItems = 0;
  let checkedItems = 0;
  const countRows = (id: string, quantity: number) => {
    if (quantity > 1) {
      for (let i = 0; i < quantity; i++) {
        totalItems++;
        if (checked.has(`${id}-${i}`)) checkedItems++;
      }
    } else {
      totalItems++;
      if (checked.has(id)) checkedItems++;
    }
  };
  for (const group of allGroups) {
    for (const item of group.items) {
      const isGroup = !!item.kitId && !item.isKitChild;
      if (isGroup) {
        // Kit header itself
        totalItems++;
        if (checked.has(`kit-${item.id}`)) checkedItems++;
        const children = (item.childLineItems || []) as Array<Record<string, unknown>>;
        for (const child of children) {
          countRows(child.id as string, child.quantity as number);
        }
      } else {
        countRows(item.id as string, item.quantity as number);
        // Accessories that travel with this asset are pickable in their own right
        for (const child of getAccessoryChildren(item)) {
          countRows(child.id as string, child.quantity as number);
        }
      }
    }
  }
  return { totalItems, checkedItems };
}
