import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveSupabaseRuntimeConfig } from "./supabaseRuntimeConfig";

test("missing public Supabase values fail closed without a production fallback", () => {
  const missing = resolveSupabaseRuntimeConfig(undefined, undefined);
  assert.equal(missing.configured, false);
  assert.equal(missing.url, "https://configuration.invalid");
  assert.equal(missing.anonKey, "configuration-missing");
  assert.match(missing.error ?? "", /missing/i);
});
test("only a complete Supabase project URL and key are accepted", () => {
  assert.equal(
    resolveSupabaseRuntimeConfig("https://example.supabase.co", "public-key")
      .configured,
    true,
  );
  for (const value of [
    "http://example.supabase.co",
    "https://example.invalid",
    "https://example.supabase.co/rest",
    "https://user@example.supabase.co",
  ]) {
    assert.equal(resolveSupabaseRuntimeConfig(value, "public-key").configured, false);
  }
});

test("the client source contains no embedded project reference or publishable key", () => {
  const source = readFileSync("lib/supabase.ts", "utf8");
  assert.doesNotMatch(source, /[a-z]{20}\.supabase\.co/);
  assert.doesNotMatch(source, /sb_publishable_[A-Za-z0-9_-]+/);
  assert.match(source, /resolveSupabaseRuntimeConfig/);
});
