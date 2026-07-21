import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAL_DOCUMENTS,
  LEGAL_EMAIL,
  LEGAL_OPERATOR,
  LEGAL_VERSION,
  legalAcceptanceMetadata,
} from "./legalDocuments";

test("legal documents identify the operator, contact, and current version", () => {
  assert.equal(LEGAL_OPERATOR, "FlowLedger-Algo LLC");
  assert.equal(LEGAL_EMAIL, "Flowledger-algo@gmail.com");
  assert.match(LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  for (const document of Object.values(LEGAL_DOCUMENTS)) {
    const text = document.sections.flatMap(section => section.paragraphs).join(" ");
    assert.match(text, /FlowLedger-Algo LLC/);
    assert.match(text, /Flowledger-algo@gmail.com/);
  }
});

test("terms cover the material service and dispute risks", () => {
  const text = LEGAL_DOCUMENTS.terms.sections.flatMap(section => [section.title, ...section.paragraphs]).join(" ");
  for (const required of ["Plaid", "artificial intelligence", "not a bank", "binding individual arbitration", "CLASS", "$100"]) {
    assert.ok(text.toLowerCase().includes(required.toLowerCase()), `missing terms topic: ${required}`);
  }
});

test("privacy policy describes actual processors, child profiles, and user choices", () => {
  const text = LEGAL_DOCUMENTS.privacy.sections.flatMap(section => [section.title, ...section.paragraphs]).join(" ");
  for (const required of ["Supabase", "Vercel", "Plaid", "OpenAI", "child profile", "delete", "do not sell"]) {
    assert.ok(text.toLowerCase().includes(required.toLowerCase()), `missing privacy topic: ${required}`);
  }
});

test("acceptance metadata records both documents at the same instant", () => {
  const acceptedAt = "2026-07-21T12:00:00.000Z";
  assert.deepEqual(legalAcceptanceMetadata(acceptedAt), {
    terms_version: LEGAL_VERSION,
    terms_accepted_at: acceptedAt,
    privacy_version: LEGAL_VERSION,
    privacy_acknowledged_at: acceptedAt,
  });
});
