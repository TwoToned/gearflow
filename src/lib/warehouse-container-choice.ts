/**
 * What the warehouse packer has chosen as the active packing container.
 *
 * Three states, and the difference matters to the server
 * (`resolveContainerForWrite`, convex/lib/fulfillment.ts):
 *  - `undefined`: nothing chosen. Send NO `containerId`, so a new unit packs
 *    into the line's `plannedContainerId` (the PM's plan).
 *  - `null`: Loose deliberately picked. Send `containerId: null`, which
 *    overrides the plan.
 *  - `string`: a real container id. Always wins over the plan.
 */
export type ContainerChoice = string | null | undefined;

/** The one rule for the rail: Loose is highlighted ONLY when deliberately
 *  picked, never when nothing is chosen (the plan applies then). */
export function isLooseChosen(choice: ContainerChoice): boolean {
  return choice === null;
}

/** The `containerId` fragment of a prep write for a choice. The key is OMITTED
 *  when nothing is chosen, so the server falls back to the plan; `null` and an
 *  id are sent as given. Spread it into the write, or read `.containerId`. */
export function containerArgs(choice: ContainerChoice): { containerId?: string | null } {
  return choice === undefined ? {} : { containerId: choice };
}
