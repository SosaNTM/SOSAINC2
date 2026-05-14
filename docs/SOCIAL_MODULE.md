# Social Module

Multi-platform social media management module. Tracks followers, posts, engagement, audience demographics, and competitor benchmarking across 8 platforms.

---

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/:portalId/social` | — | Redirects to `/overview` |
| `/:portalId/social/overview` | `SocialOverview` | Dashboard — KPIs, growth charts, top posts, goals |
| `/:portalId/social/accounts` | `SocialAccounts` | Connect / disconnect platform accounts |
| `/:portalId/social/analytics` | `SocialAnalytics` | Per-platform deep-dive with heatmaps |
| `/:portalId/social/content` | `SocialContent` | Post feed + calendar view |
| `/:portalId/social/audience` | `SocialAudience` | Demographics, locations, active-times heatmap |
| `/:portalId/social/competitors` | `SocialCompetitors` | Competitor benchmarking |
| `/:portalId/social/oauth-callback` | `OAuthCallback` | OAuth token exchange (post-redirect) |

**Settings** (under `/:portalId/settings/social/`):

| Slug | Page | Description |
|------|------|-------------|
| `account-collegati` | `SocialAccountsSettings` | Manage connected accounts |
| `regole-pubblicazione` | `PublishingRules` | Auto-hashtags, approval requirements, watermarks |
| `categorie-contenuti` | `ContentCategories` | Post category management with frequency targets |

---

## Supported Platforms

Instagram, LinkedIn, Twitter/X, YouTube, TikTok, Facebook, Threads, Pinterest.

---

## Features

### Overview Dashboard
- KPI cards: Total Followers, Impressions, Reach, Posts Published, Avg. Likes / Comments / Shares, Engagement Rate, Profile Visits, Website Clicks
- Each KPI has a sparkline trend and drill-down modal
- Multi-platform follower growth chart (area, interactive legend)
- Engagement rate trend (line chart)
- Top posts carousel
- Monthly goals progress
- Period filter: 7d, 14d, 30d, 90d, this month, last month, quarter

### Content
- Post feed filterable by platform, status (scheduled / published / draft / failed), sort by recency / engagement / impressions
- Calendar view — posts grouped by day
- Per-post metrics: likes, comments, shares, saves, impressions, reach, clicks, engagement rate, video views
- Post detail modal

### Analytics
- Per-platform breakdown table
- Best posting times heatmap (7 days × 6 time slots)
- Content type performance breakdown

### Audience
- Age range distribution
- Gender split
- Top locations
- Active times heatmap

### Accounts
- Connect / disconnect flow with OAuth redirect
- Account status toggle (active / inactive)
- Last synced timestamp, handle, follower count

### Settings
- **Publishing Rules** — require approval toggle, auto-hashtag sets, watermark config
- **Content Categories** — name, platforms, target frequency, color, caption templates with variables
- **Caption Templates** — reusable templates per category

---

## File Structure

```
src/
  pages/social/
    SocialOverview.tsx        # Main dashboard
    SocialAccounts.tsx        # Platform connection UI
    SocialAnalytics.tsx       # Per-platform analytics
    SocialContent.tsx         # Post feed + calendar
    SocialAudience.tsx        # Demographics
    SocialCompetitors.tsx     # Competitor benchmarking
    OAuthCallback.tsx         # OAuth redirect handler

  components/social/
    SocialKpiCard.tsx         # KPI card with sparkline
    SocialKpiModal.tsx        # KPI drill-down modal
    PlatformBreakdownTable.tsx
    TopPostCard.tsx
    PostDetailModal.tsx
    SocialAnalyticsModal.tsx
    SocialAudienceModal.tsx
    SocialHeatmap.tsx
    PlatformIcon.tsx
    SocialConnections.tsx
    ConnectAccountModal.tsx
    ConnectPlatformModal.tsx
    SocialAnalyticsDashboard.tsx
    GoalsProgress.tsx

  pages/settings/social/
    SocialAccountsSettings.tsx
    PublishingRules.tsx
    ContentCategories.tsx

  lib/
    socialStore.ts            # Mock data store (accounts, posts, metrics)
    services/
      socialPostsService.ts   # Supabase CRUD for social_posts table

  types/
    database.ts               # TypeScript types for DB-backed social data
```

---

## Database Tables

| Table | Description |
|-------|-------------|
| `social_connections` | User-level OAuth connections (tokens, account metadata) |
| `social_analytics_snapshots` | Daily metrics snapshots per connection |
| `social_publishing_rules` | Portal-level publishing config |
| `hashtag_sets` | Reusable hashtag groups |
| `content_categories` | Post content categorization |
| `caption_templates` | Reusable captions with variable placeholders |
| `social_posts` | Posts (schema defined, service wired — see Status below) |

All portal-scoped tables filter by `portal_id`. Use `usePortalData("table_name")` for list queries — it auto-scopes and re-fetches on portal change.

---

## Data Status

| Area | Status | Notes |
|------|--------|-------|
| Posts | Mock | `socialPostsService.ts` exists but UI reads from `mockSocialPosts` |
| Account connections | Mock + partial | OAuth flow runs; tokens stored in `social_connections`; UI reads in-memory state (resets on reload) |
| Analytics / metrics | Mock | `mockMetrics` generated client-side with seeded growth curves |
| Goals | Mock | `mockSocialGoals` — empty, unused |
| Competitors | Mock | `mockCompetitors` — empty |
| Demographics / heatmaps | Mock | Hardcoded sample data |
| Publishing rules | Real DB | `PublishingRules.tsx` persists to Supabase |
| Content categories | Real DB | `ContentCategories.tsx` persists to Supabase |
| Caption templates | Real DB | Stored under `content_categories` |

---

## Known Issues

### Critical
- **All metrics are mock** — users cannot distinguish demo from real data.
- **Account connection state is ephemeral** — OAuth tokens may be stored in `social_connections` but `SocialAccounts.tsx` reads React state, not the DB. Reconnect required on every reload.
- **OAuth callback incomplete** — Edge function `social-oauth?action=callback` is a stub; portal ownership of connection is not persisted.

### Data
- **Hardcoded date** — `SocialOverview.tsx` uses a frozen `TODAY` constant (`2026-03-05`). All period calculations are relative to that date. Update it or replace with `new Date()`.

### Security
- **No CSRF state validation** in `OAuthCallback.tsx` — `state` parameter is not verified against a server-issued nonce.
- **Portal ID comes from client** — connection ownership can be spoofed until server-side validation is added.

---

## Adding a New Platform

1. Add the platform slug to the `Platform` type in `src/types/database.ts`.
2. Add an icon case in `src/components/social/PlatformIcon.tsx`.
3. Add OAuth config (client ID, scopes, redirect URL) to the `social-oauth` edge function.
4. Register the platform in `SocialAccounts.tsx` platform list.

---

## Permissions

| Permission | Roles |
|------------|-------|
| `social:view` | owner, admin, manager |
| `social:manage` | owner, admin |

Defined in `src/lib/permissions.ts`.
