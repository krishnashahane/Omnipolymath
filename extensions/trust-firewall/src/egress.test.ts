import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { egressHosts, hostAllowed, isHardBlockedHost } from "./egress.js";
import { TrustFirewall } from "./firewall.js";

describe("egress hosts", () => {
  it("finds hosts in URL parameters and shell commands", () => {
    expect(egressHosts({ url: "https://Example.com:8443/a?b=1" })).toEqual(["example.com"]);
    expect(egressHosts({ urls: ["http://a.dev/x", "https://b.dev"] })).toEqual(["a.dev", "b.dev"]);
    expect(egressHosts({}, "curl -s https://api.github.com/repos && echo ok")).toEqual([
      "api.github.com",
    ]);
    expect(egressHosts({}, "curl 169.254.169.254/latest/meta-data/")).toContain("169.254.169.254");
    expect(egressHosts({}, "ls -la && git status")).toEqual([]);
  });
  it("hard-blocks cloud metadata and link-local destinations", () => {
    for (const host of [
      "169.254.169.254",
      "metadata.google.internal",
      "100.100.100.200",
      "2852039166",
      "0xa9fea9fe",
      "[fe80::1]",
      "fd00:ec2::254",
    ]) {
      expect(isHardBlockedHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "10.0.0.5", "127.0.0.1", "api.openai.com"]) {
      expect(isHardBlockedHost(host), host).toBe(false);
    }
  });
  it("matches exact hosts and wildcard subdomains", () => {
    expect(hostAllowed("api.github.com", ["*.github.com"])).toBe(true);
    expect(hostAllowed("github.com", ["*.github.com"])).toBe(false);
    expect(hostAllowed("github.com", ["github.com"])).toBe(true);
    expect(hostAllowed("evilgithub.com", ["*.github.com"])).toBe(false);
  });
});

describe("egress policy in the firewall", () => {
  it("blocks shell and tool calls to metadata endpoints in every mode", () => {
    const fw = new TrustFirewall(parseConfig(undefined));
    const shell = fw.beforeToolCall({
      toolName: "exec",
      params: { command: "curl -s http://169.254.169.254/latest/meta-data/iam/" },
      runId: "e1",
    });
    expect(shell.kind).toBe("block");
    const tool = fw.beforeToolCall({
      toolName: "http_request",
      params: { url: "http://metadata.google.internal/computeMetadata/v1/" },
      runId: "e1",
    });
    expect(tool.kind).toBe("block");
    const off = new TrustFirewall(parseConfig({ egress: { blockMetadata: false } }));
    expect(
      off.beforeToolCall({ toolName: "web_fetch", params: { url: "http://169.254.169.254/" } })
        .kind,
    ).toBe("allow");
  });
  it("asks before new hosts in approve-new mode and remembers approvals", () => {
    const fw = new TrustFirewall(
      parseConfig({ egress: { mode: "approve-new", allowedHosts: ["*.github.com"] } }),
    );
    const call = (url: string) =>
      fw.beforeToolCall({ toolName: "web_fetch", params: { url }, runId: "e2" }, url);
    expect(call("https://api.github.com/x").kind).toBe("allow");
    expect(call("http://localhost:3000/").kind).toBe("allow");
    const first = call("https://example.org/page");
    expect(first.kind).toBe("approve");
    if (first.kind === "approve") {
      expect(first.description).toContain("not approved yet");
      fw.resolveApproval(first.entry, "allow-once");
    }
    expect(call("https://example.org/other").kind).toBe("allow");
    const denied = call("https://other.example.net/");
    expect(denied.kind).toBe("approve");
    if (denied.kind === "approve") {
      fw.resolveApproval(denied.entry, "deny");
    }
    expect(call("https://other.example.net/").kind).toBe("approve");
  });
});

describe("postures", () => {
  it("restricted asks before outbound actions, new hosts and every unsandboxed command", () => {
    const c = parseConfig({ posture: "restricted" });
    expect(c.approveTiers).toEqual(["external", "spend", "irreversible"]);
    expect(c.egress.mode).toBe("approve-new");
    expect(c.unsandboxedShell).toBe("approve-all");
    expect(c.skills.blockHighRisk).toBe(true);
  });
  it("personal relaxes tainted-run writes; explicit fields still win", () => {
    const c = parseConfig({ posture: "personal", taintedApproveTiers: ["write", "external"] });
    expect(c.taintedApproveTiers).toEqual(["write", "external"]);
    expect(parseConfig({ posture: "personal" }).taintedApproveTiers).toEqual(["external"]);
    expect(parseConfig(undefined).posture).toBe("balanced");
  });
  it("rejects unknown values", () => {
    expect(() => parseConfig({ posture: "yolo" })).toThrow(/posture/);
    expect(() => parseConfig({ egress: { mode: "open" } })).toThrow(/egress.mode/);
  });
  it("hardens the exec environment by default", () => {
    expect(parseConfig(undefined).execEnv.disableCloudMetadata).toBe(true);
    expect(
      parseConfig({ execEnv: { disableCloudMetadata: false } }).execEnv.disableCloudMetadata,
    ).toBe(false);
  });
});
