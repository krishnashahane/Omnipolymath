import { describe, expect, it } from "vitest";
import { resolveOmnipolymathIdClientChannel } from "./channel.js";

describe("Omnipolymath ID client channel", () => {
  it("treats only handshake-attested direct loopback as the local operator", () => {
    expect(resolveOmnipolymathIdClientChannel({ internal: { isLocalClient: true } })).toBe(
      "local_operator",
    );
    expect(resolveOmnipolymathIdClientChannel({ internal: {} })).toBeUndefined();
    expect(resolveOmnipolymathIdClientChannel(undefined)).toBeUndefined();
  });

  // Spec section 11 #7: relayed traffic arrives on the local host but is never direct loopback.
  it("never lets a relayed client act as the local operator", () => {
    expect(
      resolveOmnipolymathIdClientChannel({
        internal: { isLocalClient: true, omnipolymathIdPeerKey: `iroh:${"ab".repeat(32)}` },
      }),
    ).toBe("tunnel");
  });
});
