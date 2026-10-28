# Flo answers without Sources & details

The owner requested removing the Sources & details panel so Flo shows the answer directly. The disclosure, source links, repeated coverage/caveat metadata and related expansion state/styles were removed from the reply component. The answer itself and its meaningful warnings remain. Existing creation receipts, Open actions, proposal review and follow-up actions remain available. Backend grounding and financial behavior are unchanged.

Verification: 52 targeted Flo/UI tests passed, including answer rendering with populated metadata and creation lifecycle coverage. Independent review passed with 16 focused tests. Mobile TypeScript, web export and release artifact checks passed. Candidate: `entry-b3b6be230c4d6fe385a5f65e08825571.js`, SHA-256 `776ed8a590302fe4ae6d29f633cf061d2d11520c2482e3b6af78f9fff4e776b3`. Candidate browser verification passed at widths 390 and 1,200 with populated source metadata: no disclosure, record links or repeated metadata appeared; no automatic question was sent, and existing income Saved/Open worked. Zero browser errors or overflow. This change was published with the subsequent creation-form overlay; the final live candidate and postflight are recorded in `flo-creation-form-2026-10-28.md`.

Rollback: `rollback/prod-before-flo-answer-only-20261028-1609`, remotely verified at source `7b63ff67020fc82b2cfbdff6132d1c72a4020672`, exact prior production deployment `dpl_HqK35nQA7bJRzEvGQ77hSXnWdiQX`. Backend versions remain flo-chat v41 and flo-chat-v4 v8.

Published source: `799b6cf4b4d4b60c899674f095faa13220f65eda`; READY deployment `dpl_4R6mfzrqCFckoV3gvD3tzN9YoV8b`. The final bundle digest is `da2e9248d74b3c6c5eae4bec127c3fcae4e4a3984ac68135a947de0bc05e09ca`.
