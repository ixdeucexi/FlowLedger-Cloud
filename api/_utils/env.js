const PLAID_ENVIRONMENTS = new Set(["production", "development", "sandbox"]);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const error = new Error(`Missing required server environment variable: ${name}`);
    error.code = "SERVER_CONFIGURATION_MISSING";
    throw error;
  }
  return value;
}

function optional(name) {
  const value = String(process.env[name] || "").trim();
  return value || null;
}

function plaidEnvironment() {
  const value = (optional("PLAID_ENV") || "production").toLowerCase();
  if (!PLAID_ENVIRONMENTS.has(value)) {
    const error = new Error("PLAID_ENV must be production, development, or sandbox.");
    error.code = "PLAID_ENV_INVALID";
    throw error;
  }
  // Plaid's SDK uses sandbox for the development environment.
  return value === "development" ? "sandbox" : value;
}

function validateHttpsUrl(value, name) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch {
    const error = new Error(`${name} must be a valid HTTPS URL.`);
    error.code = "SERVER_CONFIGURATION_INVALID";
    throw error;
  }
  if (parsed.protocol !== "https:" || parsed.hash) {
    const error = new Error(`${name} must use HTTPS and must not contain a URL fragment.`);
    error.code = "SERVER_CONFIGURATION_INVALID";
    throw error;
  }
  return parsed.toString().replace(/\/$/, "");
}

function plaidConfig() {
  return {
    clientId: required("PLAID_CLIENT_ID"),
    secret: required("PLAID_SECRET"),
    environment: plaidEnvironment(),
    redirectUri: validateHttpsUrl(optional("PLAID_REDIRECT_URI"), "PLAID_REDIRECT_URI"),
    webhookUrl: validateHttpsUrl(optional("PLAID_WEBHOOK_URL"), "PLAID_WEBHOOK_URL"),
  };
}

function supabaseConfig() {
  const url = required("SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  return { url, serviceRoleKey };
}

module.exports = { required, optional, plaidConfig, supabaseConfig };
