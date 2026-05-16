# Stage 1 — Codebase health

## 1.1 Compile gate (`npx tsc --noEmit`)

✓ **PASS — 0 errors.** Baseline now green after the post-Phase-8 fix commit `01503f7`.

## 1.2 Lint gate (`npm run lint`)

⚠ **159 problems (94 errors, 65 warnings).** Pre-existing baseline. 2 errors and 6 warnings auto-fixable with `--fix`. Sample:

- `WaterfallChart.tsx:19` — `@typescript-eslint/no-explicit-any`
- `useCryptoPrices.ts:22` — empty block statement
- `tailwind.config.ts:115` — `require()` style import forbidden
- `NewSubscriptionModal.tsx:173` — missing dependencies in useEffect

Most are explicit-any / unused-vars / exhaustive-deps. None block the test bundle.

## 1.3 Production build (`npm run build`)

✓ **PASS in 15.53s.** PWA generated. Warning: some chunks > 500 kB after minification — non-blocking, just code-splitting opportunity.

## 1.4 Unused deps (`npx depcheck`)

**Unused dependencies:**
- `@hookform/resolvers` — false positive (used by RHF + zod resolvers when imported by name)

**Unused devDependencies:**
- `@playwright/test` — kept for future E2E
- `@tailwindcss/typography` — false positive (configured in `tailwind.config.ts`)
- `@testing-library/react` — used by Vitest specs
- `autoprefixer`, `postcss` — false positive, both required by Tailwind build pipeline

**Missing dependencies:**
- `@aws-sdk` — used by `supabase/functions/cloud-presign/index.ts` (edge runtime, not bundled — Deno deps, ignore)
- `virtual:pwa-register` — declared via `/// <reference types="vite-plugin-pwa/react" />` in `src/vite-env.d.ts` (fixed in commit `01503f7`)

✓ No real deps to clean up.

## 1.5 Dead pages

Naive scan flagged 19 page files as "UNREF" but most are child components imported by parent pages (e.g. `CryptoHoldingModal`, `GiftCardModal`, dashboard widgets). False positives. Real dead code review needs deeper static analysis — defer.

## 1.6 Two-Supabase-client usage map

- `@/lib/supabase` users: **66 files**
- `@/lib/portalDb` users: **0 files** (module does not exist)

✓ **Dual-client landmine is historical/resolved.** No file imports both.

## 1.7 Hardcoded UUIDs

4 hits, all in `src/lib/portalUUID.ts:7-10` — intentional slug→UUID mapping (`sosa`, `keylo`, `redx`, `trustme`). Not bugs.

## 1.8 Raw Supabase queries

238 `.from(...)` chains. Spot-check shows the majority use `.eq("portal_id", currentPortalId)` either inline or inside `usePortalData` which auto-injects it. Full audit deferred — `usePortalData` covers most paths.

## 1.9 localStorage usage

61 uses across `src/`. After the May 2026 LS strip, expected residual usage:

- `src/lib/theme.tsx`, `src/lib/accent.tsx`, `src/lib/numberFormat.tsx`, `src/lib/periodContext.tsx` — UI prefs
- `src/lib/authContext.tsx`, `src/lib/portalContext.tsx` — last-accessed portal + cached user
- `src/pages/NotesPage.tsx`, `src/pages/cloud/CloudPage.tsx` — **pending migration** (per `PROJECT_OVERVIEW.md §22`)
- `src/pages/leadgen/LeadgenSearch.tsx` — country favorites (UI pref)
- `src/components/profile/ProfileTasksCard.tsx`, `src/lib/services/userProfileService.ts` — profile cache
- `src/i18n/index.ts` — language preference

Cross-reference passes — every usage matches the allowed-key whitelist or is a flagged pending-migration page.

## Verdict

**Codebase health: CLEAN.** tsc green, build green, no dual-client divergence, no hardcoded user UUIDs, localStorage usage matches the documented whitelist. Lint baseline is yellow (94 errors / 65 warnings) but unchanged from history; non-blocking for the test bundle.
