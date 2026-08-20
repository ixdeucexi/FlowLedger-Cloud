import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAL_DOCUMENTS,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_EMAIL,
  LEGAL_OPERATOR,
  LEGAL_VERSION,
  legalAcceptanceMetadata,
} from "./legalDocuments";

test("legal documents identify the operator, contact, and current version", () => {
  assert.equal(LEGAL_OPERATOR, "FlowLedger-Algo LLC");
  assert.equal(LEGAL_EMAIL, "Flowledger-algo@gmail.com");
  assert.equal(LEGAL_VERSION, "2026-08-20");
  assert.equal(LEGAL_EFFECTIVE_DATE, "August 20, 2026");
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

test("legal documents permit minors with guardian permission and contain no 18-plus requirement", () => {
  const text = Object.values(LEGAL_DOCUMENTS)
    .flatMap(document => document.sections.flatMap(section => section.paragraphs))
    .join(" ")
    .toLowerCase();

  for (const forbidden of [
    "at least 18",
    "18 years old",
    "under 18",
    "service is for adults",
    "children may not create accounts",
    "independently use the service",
  ]) {
    assert.ok(!text.includes(forbidden), `unexpected age restriction: ${forbidden}`);
  }
  assert.match(
    text,
    /age of legal majority may use the service with permission and supervision from a parent or legal guardian/,
  );
  assert.match(text, /not directed to children under 13/);
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
