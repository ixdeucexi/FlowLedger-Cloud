export type LegalDocumentId = "terms" | "privacy";

export interface LegalSection {
  title: string;
  paragraphs: readonly string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  summary: string;
  sections: readonly LegalSection[];
}

export const LEGAL_VERSION = "2026-07-21";
export const LEGAL_EFFECTIVE_DATE = "July 21, 2026";
export const LEGAL_OPERATOR = "FlowLedger-Algo LLC";
export const LEGAL_EMAIL = "Flowledger-algo@gmail.com";
export const LEGAL_MAILING_ADDRESS = "P.O. Box 1234, Madison County, Alabama";

const termsSections: readonly LegalSection[] = [
  {
    title: "1. Agreement and eligibility",
    paragraphs: [
      `These Terms of Service (\"Terms\") are a binding agreement between you and ${LEGAL_OPERATOR} (\"FlowLedger,\" \"we,\" \"us,\" or \"our\") governing your access to FlowLedger Algo and related websites, software, features, content, and services (collectively, the \"Service\"). By creating an account, clicking to accept, or using the Service, you agree to these Terms and the Privacy Policy.`,
      "You must be at least 18 years old and legally capable of entering a contract. The Service is intended for personal and household use in the United States. If you use it for another person or organization, you represent that you have authority to do so.",
    ],
  },
  {
    title: "2. What FlowLedger provides",
    paragraphs: [
      "FlowLedger provides budgeting, cash-flow forecasting, calendar planning, transaction review, category planning, savings-goal, debt-payoff, household-sharing, notification, and AI-assisted explanation tools. Features may be labeled Basic, Pro, preview, beta, demo, or early access and may change or be discontinued.",
      "FlowLedger is not a bank, lender, credit counselor, investment adviser, broker, tax preparer, law firm, fiduciary, payment processor, or money transmitter. FlowLedger does not hold funds, initiate bank transfers, make payments, stop payments, negotiate debts, or guarantee that a bill, deposit, transfer, or transaction will occur.",
    ],
  },
  {
    title: "3. No financial, legal, tax, or investment advice",
    paragraphs: [
      "The Service provides educational information, estimates, and organizational tools—not individualized financial, legal, tax, accounting, credit, or investment advice. Flo and other automated features may be incomplete, delayed, or wrong.",
      "You are solely responsible for checking account balances, transaction status, due dates, interest rates, income, tax consequences, creditor requirements, and payment instructions with the relevant institution or professional before acting. Never rely on FlowLedger for an emergency, overdraft prevention, minimum-payment compliance, filing deadline, investment decision, or other time-sensitive obligation.",
    ],
  },
  {
    title: "4. Forecasts, calculations, and notifications",
    paragraphs: [
      "Forecasts and recommendations depend on the information available at the time, including data you enter and data received from third parties. Pending transactions may change, disappear, duplicate temporarily, post for a different amount or date, or arrive late. Account balances may differ from available balances or the financial institution’s records.",
      "Notifications are a convenience only. Delivery is not guaranteed and may be delayed or blocked by a browser, device, network, provider, or user setting. You remain responsible for monitoring your financial accounts and obligations directly.",
    ],
  },
  {
    title: "5. Bank connections and third-party financial data",
    paragraphs: [
      "If you connect an account, Plaid and your financial institution facilitate the connection. Your use of Plaid is also subject to Plaid’s applicable terms and privacy policy. FlowLedger does not receive your bank password, but it receives tokens and financial data authorized through Plaid, which may include institution, account, balance, transaction, merchant, category, date, pending status, and related metadata.",
      "You authorize FlowLedger and its providers to retrieve, store, refresh, normalize, and use that data to provide the Service until the connection is disabled or access otherwise ends. Disconnecting a bank stops future retrieval but may not automatically delete data already imported into FlowLedger. You may request deletion as described in the Privacy Policy.",
      "Third-party data may be unavailable, inaccurate, delayed, or duplicated. FlowLedger is not responsible for acts, omissions, outages, security practices, or data supplied by Plaid, a bank, or another third party.",
    ],
  },
  {
    title: "6. Flo and artificial intelligence",
    paragraphs: [
      "Flo uses automated systems and third-party AI services to explain information from your FlowLedger account. When you use Flo, your message and relevant account context may be processed to generate a response. AI output is probabilistic and can misunderstand context, omit facts, or produce inaccurate statements.",
      "Flo cannot authorize payments, change bank records, replace professional judgment, or guarantee an outcome. You must review and confirm any proposed action inside the Service before relying on it.",
    ],
  },
  {
    title: "7. Accounts, security, and household sharing",
    paragraphs: [
      "You must provide accurate information, protect your credentials and devices, and promptly report suspected unauthorized access. You are responsible for activity performed through your account unless applicable law provides otherwise.",
      "Household owners control invitations and roles. Information in a shared household may be viewed or changed by members according to their permissions. Only invite people you trust. You are responsible for having authority to add shared financial information and for removing access when it is no longer appropriate.",
      "Child profiles are parent- or guardian-managed planning records. Children may not create accounts or independently use the Service. An adult who creates a child profile represents that they are the child’s parent or legal guardian, or otherwise have lawful authority to provide and manage that information.",
    ],
  },
  {
    title: "8. Your content and permissions",
    paragraphs: [
      "You retain ownership of information you submit, import, or create. You grant FlowLedger a limited, nonexclusive license to host, process, transmit, reproduce, and display that information only as reasonably necessary to operate, secure, support, and improve the Service, comply with law, and enforce these Terms.",
      "You represent that you have the rights and permissions needed to provide the information. Do not submit another person’s financial or personal information without lawful authority.",
    ],
  },
  {
    title: "9. Acceptable use",
    paragraphs: [
      "You may not use the Service unlawfully; access another person’s account or household without permission; probe, bypass, or defeat security or access controls; introduce malware; scrape or overload the Service; reverse engineer except where law expressly permits; use automated output to deceive or harm; or use the Service to violate financial, privacy, intellectual-property, or consumer-protection laws.",
      "You may not request or expose credentials, access tokens, private prompts, source code, administrative data, or another user’s information. We may investigate misuse and suspend or terminate access when reasonably necessary to protect users, FlowLedger, or third parties.",
    ],
  },
  {
    title: "10. Plans, billing, and promotional access",
    paragraphs: [
      "Some features may require a paid plan in the future. Prices, billing period, renewal terms, trial terms, and cancellation instructions will be shown before a charge is authorized. Taxes may apply. Unless required by law, fees are nonrefundable after the applicable service period begins.",
      "Grandfathered, complimentary, preview, tester, or administrative access is promotional, nontransferable, has no cash value, and may be modified or withdrawn unless FlowLedger expressly promises otherwise in writing. Preview controls do not change a household’s actual entitlement or backend security.",
    ],
  },
  {
    title: "11. Ownership and feedback",
    paragraphs: [
      "The Service, software, design, branding, algorithms, documentation, and other FlowLedger materials are owned by FlowLedger or its licensors and are protected by law. These Terms grant only a limited, revocable, nontransferable right to use the Service for its intended purpose.",
      "If you submit ideas or feedback, you grant FlowLedger a perpetual, worldwide, royalty-free right to use, modify, and incorporate it without compensation or obligation, while personal information within feedback remains subject to the Privacy Policy.",
    ],
  },
  {
    title: "12. Service changes, suspension, and termination",
    paragraphs: [
      "We may maintain, modify, limit, suspend, or discontinue any part of the Service. We do not promise uninterrupted or error-free availability. You may stop using the Service at any time. We may suspend or terminate access for material breach, security risk, legal requirement, nonpayment, abuse, or conduct that could harm the Service or others.",
      "Provisions that by their nature should survive— including ownership, disclaimers, liability limits, indemnity, dispute terms, and accrued obligations—remain effective after termination.",
    ],
  },
  {
    title: "13. Disclaimer of warranties",
    paragraphs: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE.\" FLOWLEDGER AND ITS OFFICERS, MEMBERS, EMPLOYEES, CONTRACTORS, LICENSORS, AND PROVIDERS DISCLAIM ALL EXPRESS, IMPLIED, AND STATUTORY WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, AVAILABILITY, SECURITY, AND RESULTS.",
      "FLOWLEDGER DOES NOT WARRANT THAT DATA, FORECASTS, ALERTS, MATCHES, CATEGORIES, AI OUTPUT, OR THIRD-PARTY CONNECTIONS WILL BE COMPLETE, CURRENT, ACCURATE, SECURE, OR ERROR-FREE. Some jurisdictions do not allow certain disclaimers, so some of this section may not apply to you.",
    ],
  },
  {
    title: "14. Limitation of liability",
    paragraphs: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, FLOWLEDGER AND ITS OFFICERS, MEMBERS, EMPLOYEES, CONTRACTORS, LICENSORS, AND PROVIDERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES; LOST PROFITS, SAVINGS, DATA, OR GOODWILL; OVERDRAFTS, LATE FEES, INTEREST, TAXES, MISSED PAYMENTS, CREDIT EFFECTS, OR FINANCIAL LOSSES; OR UNAUTHORIZED ACCESS, SERVICE INTERRUPTION, OR THIRD-PARTY CONDUCT, EVEN IF ADVISED OF THE POSSIBILITY.",
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, THEIR TOTAL AGGREGATE LIABILITY ARISING FROM OR RELATING TO THE SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID FLOWLEDGER DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM OR (B) $100. These limits apply to all theories of liability and do not limit liability that cannot lawfully be limited.",
    ],
  },
  {
    title: "15. Indemnification",
    paragraphs: [
      "To the extent permitted by law, you will defend, indemnify, and hold harmless FlowLedger and its officers, members, employees, contractors, licensors, and providers from third-party claims, losses, liabilities, costs, and reasonable attorneys’ fees arising from your unlawful use, your content, your breach of these Terms, or your violation of another person’s rights. This does not require indemnification for FlowLedger’s own unlawful conduct where prohibited by law.",
    ],
  },
  {
    title: "16. Disputes, arbitration, and class-action waiver",
    paragraphs: [
      `Before filing a formal claim, you and ${LEGAL_OPERATOR} agree to send written notice describing the dispute and requested relief to ${LEGAL_EMAIL} and allow 30 days for a good-faith resolution.`,
      "Except for an eligible individual claim in small-claims court or a request for temporary injunctive relief involving misuse, security, or intellectual property, any dispute arising from these Terms or the Service will be resolved by binding individual arbitration under the Federal Arbitration Act and the then-current AAA Consumer Arbitration Rules. Arbitration may occur by video, telephone, documents, or in Madison County, Alabama, as the arbitrator permits.",
      "YOU AND FLOWLEDGER WAIVE THE RIGHT TO A JURY TRIAL AND TO PARTICIPATE IN A CLASS, COLLECTIVE, CONSOLIDATED, OR REPRESENTATIVE ACTION. The arbitrator may award relief only to the individual claimant and only as necessary for that claim. If this class waiver is unenforceable as to a particular claim, that claim must proceed in court and not arbitration.",
      `You may opt out of arbitration by emailing ${LEGAL_EMAIL} within 30 days after you first accept these Terms. Include your name, account email, and an unmistakable statement that you opt out of arbitration. Opting out will not affect your access to the Service.`,
    ],
  },
  {
    title: "17. Governing law and general terms",
    paragraphs: [
      "Alabama law governs these Terms without regard to conflict-of-law rules, except that the Federal Arbitration Act governs arbitration. Any claim permitted to proceed in court must be brought exclusively in the state or federal courts serving Madison County, Alabama, and each party consents to their jurisdiction, except where consumer law requires otherwise.",
      "These Terms and the Privacy Policy are the entire agreement regarding the Service. If a provision is unenforceable, it will be narrowed to the minimum extent necessary and the remainder will stay effective. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our consent; we may assign them in connection with a reorganization, financing, merger, acquisition, or sale. We are not liable for delay caused by events outside our reasonable control.",
      "We may update these Terms. We will post the revised version and effective date and provide additional notice or request renewed acceptance when legally required. Continued use after the effective date constitutes acceptance where permitted by law.",
    ],
  },
  {
    title: "18. Contact",
    paragraphs: [
      `Questions or legal notices may be sent to ${LEGAL_EMAIL} or ${LEGAL_OPERATOR}, ${LEGAL_MAILING_ADDRESS}. Electronic communications satisfy written-notice requirements where permitted by law.`,
    ],
  },
];

const privacySections: readonly LegalSection[] = [
  {
    title: "1. Scope and controller",
    paragraphs: [
      `${LEGAL_OPERATOR} (\"FlowLedger,\" \"we,\" \"us,\" or \"our\") provides this Privacy Policy to explain how we collect, use, disclose, retain, and protect personal information through FlowLedger Algo and related services. FlowLedger-Algo LLC is responsible for the practices described here.`,
      "This Policy covers FlowLedger’s handling of information. Third parties such as Plaid, financial institutions, OpenAI, Supabase, Vercel, device platforms, and browsers may process information under their own terms and privacy policies.",
    ],
  },
  {
    title: "2. Information we collect",
    paragraphs: [
      "Account and identity information: email address, authentication provider, user ID, profile information, account dates, household membership, roles, invitations, plan level, settings, and consent records.",
      "Financial and planning information: account names and types, current and historical balances, bills, debts, interest rates, income, transactions, merchants, dates, categories, pending or posted status, goals, budgets, spending buckets, forecasts, calendar entries, reconciliations, allocations, and information you enter or import from files.",
      "Connected-account information: institution identifiers, account identifiers and masks, account metadata, balances, transaction data, connection status, sync history, and encrypted connection tokens received through Plaid. FlowLedger does not receive or store the username and password you enter into Plaid’s connection experience.",
      "Communications and support information: Flo conversations and responses, feedback, ratings, support messages, screenshots or details you choose to provide, and whether you permit follow-up contact.",
      "Child-profile information: a parent- or guardian-entered name or nickname, allowance, savings goal, current savings, spending limit, and related progress. Child profiles do not create login accounts.",
      "Technical information: IP address and request metadata processed by hosting and security providers, browser or device type, operating system, app version, push-notification endpoint and keys, notification preferences, diagnostic events, error details, timestamps, and locally stored settings needed for authentication and app operation.",
    ],
  },
  {
    title: "3. Sources of information",
    paragraphs: [
      "We receive information directly from you; from household owners and members; from financial institutions and Plaid when you authorize a connection; automatically from the app, browser, device, and infrastructure; and from service providers that help authenticate users, host the Service, deliver notifications, generate Flo responses, prevent abuse, or provide support.",
    ],
  },
  {
    title: "4. How we use information",
    paragraphs: [
      "We use information to create and secure accounts; connect and refresh financial data; display balances and activity; produce budgets, forecasts, matches, categories, reminders, reports, debt-payoff views, and goals; operate household sharing; generate Flo responses; deliver requested notifications; provide support; process feedback; troubleshoot and improve reliability; prevent fraud and abuse; enforce our agreements; comply with law; and protect users, FlowLedger, and others.",
      "We may create aggregated or de-identified information that cannot reasonably identify you and use it for analytics, reliability, research, and product improvement. We do not attempt to reidentify properly de-identified information except to test whether de-identification is effective.",
    ],
  },
  {
    title: "5. Plaid and connected financial accounts",
    paragraphs: [
      "When you choose to connect a financial account, Plaid collects information needed to establish that connection and provides authorized financial data to FlowLedger. Plaid’s collection and use are described in its End User Privacy Policy. Depending on the institution and accounts you select, information may include checking, savings, credit, loan, and transaction data accessible through the connection.",
      "FlowLedger uses connected financial data only to provide, secure, support, and improve the financial-management features you request; comply with law; and protect against fraud or misuse. We do not use connected financial data for targeted advertising, sell it to data brokers, or use it to determine eligibility for credit, employment, housing, insurance, or another legally significant decision.",
      "You may disconnect an institution in Bank connections. This stops future FlowLedger retrieval through that connection but does not necessarily delete information already imported or data Plaid retains under its own policy. Contact us to request deletion of retained FlowLedger data.",
    ],
  },
  {
    title: "6. Flo and AI processing",
    paragraphs: [
      "When you ask Flo a question, FlowLedger may send your message, recent private chat context, calculated account snapshot, and relevant read-only household records to OpenAI to generate a response. Relevant records can include balances, transactions, bills, debts, income, budgets, goals, planned decisions, household roles, and bank-connection status. We limit the context and instruct the service not to expose credentials, private prompts, other households, or administrative data.",
      "Flo conversations and generated responses may be stored in your private conversation history. Do not enter Social Security numbers, full account numbers, bank credentials, medical information, or other information that is unnecessary for your budgeting question.",
    ],
  },
  {
    title: "7. How we disclose information",
    paragraphs: [
      "Service providers: we disclose information as needed to providers that supply authentication, database, hosting, security, bank connectivity, AI processing, notifications, and technical support. Current core providers include Supabase, Vercel, Plaid, OpenAI, and web-push or device-platform services.",
      "Household members: information assigned to a shared household is available to authorized members according to their role. Private Flo conversations remain limited to their creator unless a feature clearly states otherwise.",
      "Legal and safety reasons: we may disclose information when reasonably necessary to comply with law or valid legal process, enforce agreements, investigate fraud or misuse, protect security and rights, or respond to an emergency involving risk of harm.",
      "Business changes: information may be transferred in a financing, merger, acquisition, reorganization, bankruptcy, or sale of assets, subject to appropriate confidentiality and applicable law.",
      "At your direction: we disclose information when you request or consent to it. We do not sell personal information for money, and we do not share personal information for cross-context behavioral advertising. FlowLedger does not display third-party behavioral ads.",
    ],
  },
  {
    title: "8. Cookies, local storage, and device permissions",
    paragraphs: [
      "FlowLedger and its providers use cookies, browser storage, and similar technology for authentication, security, route recovery, household and display preferences, demo or preview settings, and core app operation. We do not currently use them for third-party behavioral advertising.",
      "If you enable notifications, we store the notification subscription needed to deliver them. You can disable notifications in FlowLedger and in your browser or device settings. Device and browser controls may not delete information already stored in your account.",
    ],
  },
  {
    title: "9. Retention and deletion",
    paragraphs: [
      "We retain account and financial information while your account or household is active and as reasonably needed to provide the Service. Retention also depends on the type of record, household membership, backup cycles, dispute and fraud prevention, legal obligations, and legitimate business needs. Diagnostic, security, support, and consent records may be kept after account data is removed when needed to document compliance, prevent abuse, or resolve disputes.",
      "Deleted transactions may remain temporarily in Recently deleted so they can be restored. Removing a household member ends that member’s access but does not delete household records owned by the household. Disconnecting a bank does not automatically erase imported transactions. Backups and logs may retain residual copies for a limited period until overwritten or no longer required.",
      `To request access, correction, export, or deletion, use Help & feedback in the app or email ${LEGAL_EMAIL}. We may verify your identity and authority before acting. We may retain information when required or permitted by law, and we will explain material limitations that apply to a request.`,
    ],
  },
  {
    title: "10. Security",
    paragraphs: [
      "We use administrative, technical, and organizational safeguards designed for the sensitivity of the information, including authenticated access, household permissions, encrypted transport, restricted service credentials, row-level database controls, and encryption of Plaid access tokens. No system is completely secure, and we cannot guarantee that unauthorized access, loss, or misuse will never occur.",
      `Protect your password and devices and notify us promptly at ${LEGAL_EMAIL} if you suspect unauthorized access.`,
    ],
  },
  {
    title: "11. Your choices and privacy rights",
    paragraphs: [
      "You can edit many budgeting records and settings in the app, manage household members if authorized, disable notifications, disconnect bank connections, clear Flo history where offered, and remove parent-managed child profiles.",
      `Depending on where you live, you may have rights to know or access personal information; correct inaccuracies; delete information; obtain a portable copy; opt out of sale, targeted advertising, or certain profiling; limit certain sensitive-data uses; or appeal a denied request. Submit a request through Help & feedback or ${LEGAL_EMAIL}. We will not discriminate against you for exercising a privacy right. Authorized agents must provide proof of authority, and we may need to verify the consumer’s identity directly.`,
      "FlowLedger does not currently sell personal information, share it for cross-context behavioral advertising, or use it for targeted advertising, so there is no separate sale or targeted-advertising opt-out needed for current practices. If those practices change, we will update this Policy and provide legally required choices before the change applies.",
    ],
  },
  {
    title: "12. Children’s privacy",
    paragraphs: [
      "The Service is for adults and is not directed to children under 13 or designed for independent use by anyone under 18. We do not knowingly allow a child to create an account or knowingly collect personal information directly from a child.",
      `A parent or guardian may create a limited child profile for household money teaching. The adult controls the profile and may review, edit, or delete it. Do not enter a child’s full legal name or other unnecessary identifying information. If you believe information was collected directly from a child without appropriate authorization, email ${LEGAL_EMAIL} so we can investigate and delete it as required.`,
    ],
  },
  {
    title: "13. United States processing",
    paragraphs: [
      "FlowLedger is operated in the United States, and information may be processed and stored in the United States and other locations used by our service providers. Laws in those locations may differ from the laws where you live. The current Service is intended for U.S. users.",
    ],
  },
  {
    title: "14. Changes to this Policy",
    paragraphs: [
      "We may update this Policy when features, providers, or laws change. We will post the updated version and effective date and provide additional notice or request consent when required. Material changes apply prospectively unless law permits otherwise.",
    ],
  },
  {
    title: "15. Contact us",
    paragraphs: [
      `Privacy questions and requests may be sent to ${LEGAL_EMAIL} or ${LEGAL_OPERATOR}, ${LEGAL_MAILING_ADDRESS}. Include enough information for us to understand and verify the request, but do not email bank passwords, full account numbers, Social Security numbers, or other unnecessary sensitive information.`,
    ],
  },
];

export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocumentId, LegalDocument>> = {
  terms: {
    id: "terms",
    title: "Terms of Service",
    summary: "Rules for using FlowLedger, important financial disclaimers, and how disputes are handled.",
    sections: termsSections,
  },
  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    summary: "What FlowLedger collects, why it is used, who receives it, and the choices available to you.",
    sections: privacySections,
  },
};

export function legalDocumentById(id: LegalDocumentId): LegalDocument {
  return LEGAL_DOCUMENTS[id];
}

export function legalAcceptanceMetadata(acceptedAt = new Date().toISOString()) {
  return {
    terms_version: LEGAL_VERSION,
    terms_accepted_at: acceptedAt,
    privacy_version: LEGAL_VERSION,
    privacy_acknowledged_at: acceptedAt,
  } as const;
}
