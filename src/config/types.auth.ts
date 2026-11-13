import type { z } from "zod";
import type { OmnipolymathSchemaShape } from "./zod-schema.root-shape.js";

export type AuthConfig = NonNullable<z.input<typeof OmnipolymathSchemaShape.auth>>;
export type AuthProfileConfig = NonNullable<AuthConfig["profiles"]>[string];
