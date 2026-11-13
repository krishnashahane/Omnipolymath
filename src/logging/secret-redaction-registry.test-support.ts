import "./secret-redaction-registry.js";

type SecretRedactionRegistryTestApi = {
  resetSecretRedactionRegistryForTest(): void;
};

function getTestApi(): SecretRedactionRegistryTestApi {
  return (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("omnipolymath.secretRedactionRegistryTestApi")
  ] as SecretRedactionRegistryTestApi;
}

export function resetSecretRedactionRegistryForTest(): void {
  getTestApi().resetSecretRedactionRegistryForTest();
}
