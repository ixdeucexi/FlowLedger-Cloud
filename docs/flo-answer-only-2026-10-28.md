# Flo answers without Sources & details

The owner requested removing the Sources & details panel so Flo shows the answer directly. The disclosure, source links, repeated coverage/caveat metadata and related expansion state/styles were removed from the reply component. The answer itself and its meaningful warnings remain. Existing creation receipts, Open actions, proposal review and follow-up actions remain available. Backend grounding and financial behavior are unchanged.

Verification: 52 targeted Flo/UI tests passed, including answer rendering with populated metadata and creation lifecycle coverage. Independent review passed with 16 focused tests. Mobile TypeScript, web export and release artifact checks passed. Candidate: `entry-b3b6be230c4d6fe385a5f65e08825571.js`, SHA-256 `776ed8a590302fe4ae6d29f633cf061d2d11520c2482e3b6af78f9fff4e776b3`. Candidate browser verification passed at widths 390 and 1,200 with populated source metadata: no disclosure, record links or repeated metadata appeared; no automatic question was sent, and existing income Saved/Open worked. Zero browser errors or overflow. Production postflight is pending while the owner's subsequent creation-form overlay request is implemented in the same release.

Rollback: `rollback/prod-before-flo-answer-only-20261028-1609`, remotely verified at source `7b63ff67020fc82b2cfbdff6132d1c72a4020672`, exact prior production deployment `dpl_HqK35nQA7bJRzEvGQ77hSXnWdiQX`. Backend versions remain flo-chat v41 and flo-chat-v4 v8.

Release source and deployment: pending.
