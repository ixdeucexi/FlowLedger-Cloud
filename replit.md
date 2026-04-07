# Budget Tracker

## Overview

A mobile budgeting and payment tracker app built with Expo (React Native). Replicates and improves a Google Sheets budgeting system with a clean mobile-native interface.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mobile framework**: Expo (React Native)
- **API framework**: Express 5
- **Database**: AsyncStorage (local persistence on device)
- **State management**: React Context
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Features

- **Dashboard**: Summary stats (total bills, paid, remaining, progress), monthly expense bar chart, category donut chart
- **Payment Schedule (Bills tab)**: Master bill list with CRUD operations, categories, priorities
- **Monthly View**: Month/year selector, view bills per month, editable due dates, mark bills as paid, progress tracking
- **Extra Payments**: Snowball method (smallest balance first) or priority-based extra payment allocation
- **Import/Export**: CSV import via document picker, CSV export via sharing
- **Dark mode**: Automatic based on system theme

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## App Structure

```
artifacts/mobile/
├── app/
│   ├── _layout.tsx          # Root layout with providers
│   └── (tabs)/
│       ├── _layout.tsx      # Tab bar configuration
│       ├── index.tsx        # Dashboard screen
│       ├── bills.tsx        # Payment schedule CRUD
│       ├── monthly.tsx      # Monthly view with entries
│       └── more.tsx         # Import/export settings
├── components/
│   ├── AddBillModal.tsx     # Add/edit bill form
│   ├── BillRow.tsx          # Bill list item
│   ├── EmptyState.tsx       # Empty state display
│   ├── ExtraPaymentModal.tsx # Extra payment form
│   ├── MiniChart.tsx        # Bar and donut charts
│   ├── MonthPicker.tsx      # Month/year selector
│   └── StatCard.tsx         # Dashboard stat cards
├── context/
│   └── BudgetContext.tsx    # All state management
└── constants/
    └── colors.ts            # Theme colors (light + dark)
```

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
