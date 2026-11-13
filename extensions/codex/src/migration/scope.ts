import type { MigrationProviderContext } from "omnipolymath/plugin-sdk/plugin-entry";

export function isOnlyMigrationKind(
  { itemKinds }: MigrationProviderContext,
  kind: "memory" | "auth",
): boolean {
  return Boolean(itemKinds?.length && itemKinds.every((itemKind) => itemKind === kind));
}
