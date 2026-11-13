// Static JavaScript fixtures; never execute these functions.
function bulkSkillEnvironment(config) {
  // ruleid: omnipolymath-skill-env-host-injection
  Object.assign(process.env, config.skills.entries.example.env);
}
function hostAlias(config) {
  const host = process.env;
  const entry = resolveSkillConfig(config, "example");
  // ruleid: omnipolymath-skill-env-host-injection
  host.EXAMPLE = entry.apiKey;
}
function hostAliasBulk(config) {
  const host = process.env;
  const entry = resolveSkillConfig(config, "example");
  // ruleid: omnipolymath-skill-env-host-injection
  Object.assign(host, entry.env);
}
function replacingEnvironment(config) {
  const env = config.skills.entries.example.env;
  // ruleid: omnipolymath-skill-env-host-injection
  process.env = { ...process.env, ...env };
}
function safeJavaScript(config) {
  const sanitized = sanitizeSkillEnvOverrides({ overrides: config.skills.entries.example.env });
  // ok: omnipolymath-skill-env-host-injection
  Object.assign(process.env, sanitized.allowed);
}
function trustedJavaScript(service) {
  // ok: omnipolymath-skill-env-host-injection
  Object.assign(process.env, service.environment);
}
