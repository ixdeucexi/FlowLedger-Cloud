const { createClient } = require("@supabase/supabase-js");
const { supabaseConfig } = require("./env");

let serviceClient;

function serviceSupabase() {
  if (serviceClient) return serviceClient;
  const { url, serviceRoleKey } = supabaseConfig();
  serviceClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}

function bearerToken(req) {
  const header = req && req.headers ? (req.headers.authorization || req.headers.Authorization || "") : "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

async function authenticatedUser(req) {
  const token = bearerToken(req);
  if (!token) return { user: null, error: "AUTH_HEADER_MISSING" };
  const { data, error } = await serviceSupabase().auth.getUser(token);
  if (error || !data.user) {
    return { user: null, error: "AUTH_TOKEN_INVALID", details: error || null };
  }
  return { user: data.user, error: null };
}

function safeError(error, fallback = "Request failed.") {
  if (!error) return fallback;
  const message = String(error.message || fallback);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

module.exports = { serviceSupabase, bearerToken, authenticatedUser, safeError };
