import type { AcpSessionUpdateTag } from "@omnipolymath/acp-core/runtime/types";
import type { z } from "zod";
import type { OmnipolymathSchemaShape } from "./zod-schema.root-shape.js";

type SchemaAcpConfig = NonNullable<z.input<typeof OmnipolymathSchemaShape.acp>>;

export type AcpStreamConfig = Omit<NonNullable<SchemaAcpConfig["stream"]>, "tagVisibility"> & {
  tagVisibility?: Partial<Record<AcpSessionUpdateTag, boolean>>;
};
export type AcpConfig = Omit<SchemaAcpConfig, "stream"> & { stream?: AcpStreamConfig };
