import { createHash } from "node:crypto";
import {
  captureSqliteNativeRuntimeAdmission,
  requireNodeSqlite,
} from "../infra/sqlite-native-runtime.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_SQL } from "./omnipolymath-agent-schema.js";
import {
  OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
  OMNIPOLYMATH_STATE_SCHEMA_VERSION,
} from "./omnipolymath-schema-versions.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "./omnipolymath-state-schema.js";

// Advance for code-only migrations, validation rules, or serialized fact changes.
const integrityPolicyRevision = 3;

export function sqliteDatabaseSealSchemaFor(kind: "agent" | "state" | "other") {
  requireNodeSqlite();
  const native = captureSqliteNativeRuntimeAdmission();
  const storageIdentity = native?.storageIdentity;
  if (!native || !storageIdentity) {
    return undefined;
  }
  const runtime = [native.runtime.nodeVersion, native.runtime.bunVersion ?? null];
  // Keep the exact old tuple for seals that predate decomposed library identity.
  const legacyStorageIdentity = JSON.stringify([
    native.version,
    storageIdentity.sourceId,
    storageIdentity.compileOptions,
    ...runtime,
  ]);
  const hash = createHash("sha256").update(
    JSON.stringify([integrityPolicyRevision, legacyStorageIdentity, kind]),
  );
  const schema = createHash("sha256").update(kind);
  if (kind !== "state") {
    hash.update(String(OMNIPOLYMATH_AGENT_SCHEMA_VERSION));
    hash.update(OMNIPOLYMATH_AGENT_SCHEMA_SQL);
    schema.update(String(OMNIPOLYMATH_AGENT_SCHEMA_VERSION));
    schema.update(OMNIPOLYMATH_AGENT_SCHEMA_SQL);
  }
  if (kind !== "agent") {
    hash.update(String(OMNIPOLYMATH_STATE_SCHEMA_VERSION));
    hash.update(OMNIPOLYMATH_STATE_SCHEMA_SQL);
    schema.update(String(OMNIPOLYMATH_STATE_SCHEMA_VERSION));
    schema.update(OMNIPOLYMATH_STATE_SCHEMA_SQL);
  }
  return {
    schemaIdentity: hash.digest("hex"),
    identity: {
      runtime: JSON.stringify(runtime),
      sqlite: {
        version: native.version,
        sourceId: storageIdentity.sourceId,
        // SQLite's COMPILER entry reports toolchain identity, not a feature.
        compileOptions: storageIdentity.compileOptions
          .split(",")
          .filter((option) => !option.startsWith("COMPILER="))
          .join(","),
      },
      schema: schema.digest("hex"),
      policy: integrityPolicyRevision,
    },
  };
}
