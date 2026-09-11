# X API feasibility study: an organic content and analytics application

Reviewed 11 September 2026. This is a documentation-based feasibility study and proposed product experiment, not a report of an observed account-growth campaign.

## Decision

You can build a useful tool for creators, professionals, and businesses to plan original posts, publish with their permission, and learn from their results. You cannot promise rapid follower growth or guarantee that an account will never be suspended. API access provides capabilities, not distribution or immunity from enforcement.

Position the product as a content planning and analytics studio. Avoid selling followers or claiming that automation will deliver them. X's automation rules specifically prohibit applications that claim to get users more followers. [X automation rules](https://help.x.com/en/rules-and-policies/x-automation)

## What the platform makes possible

| Product function | API or implementation | Practical boundary |
|---|---|---|
| Connect an account | OAuth 2.0 authorization code with PKCE | Each account owner authorizes the app; never request their password. |
| Read the connected profile | `GET /2/users/me` | Use user context; an application-only token cannot substitute for the account owner's permission. |
| Review recent performance | `GET /2/users/{id}/tweets` with `created_at,public_metrics` | Missing metrics stay unavailable; never replace them with invented values. |
| Publish original text | `POST /2/tweets` | Require review of the exact account and text; validate the response before declaring success. |
| Plan publication dates | Application database | A calendar is application functionality. Background publication additionally needs a durable scheduler. |
| Discover relevant discussions | Recent search, optional future feature | Reading a relevant post does not grant permission for an automated reply. |

Sources: [OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [token exchange and renewal](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token), [user lookup](https://docs.x.com/x-api/users/lookup/introduction), [user posts](https://docs.x.com/x-api/users/get-posts), [create posts](https://docs.x.com/x-api/posts/create-post).

## Boundaries that determine the product

Automated likes are prohibited. Bulk, aggressive, or indiscriminate follow/unfollow activity is prohibited. Unsolicited automated replies, mentions, and bulk DMs are not a permissible acquisition strategy. A follow does not by itself constitute permission for an automated message. AI reply bots require prior written, explicit approval from X, even when a reply could be helpful. [Automation rules](https://help.x.com/en/rules-and-policies/x-automation)

X also prohibits duplicative cross-account publishing, artificial engagement, trend manipulation, rate-limit circumvention, and non-API automation. Automated accounts have disclosure requirements. A generic multi-profile product should serve distinct legitimate accounts with separate consent and account-specific content. [Developer guidelines](https://docs.x.com/developer-guidelines)

No published posting frequency makes all behavior safe. Rate limits describe technical throughput; account enforcement also depends on behavior and content. The app should respect reset headers, stop on authorization failures, and never rotate accounts or credentials to bypass a restriction. [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)

## Current economics

X currently documents pay-per-use credits. Listed prices include $0.005 per post resource read, $0.010 per user resource read, $0.015 per ordinary post creation, and $0.200 per post creation containing a URL. Eligible Owned Reads cost $0.001 per resource, but the authenticated account must also own the developer app. Do not assume this discount for customers authorizing a shared SaaS app. Verify current rates in the developer console. [Pricing](https://docs.x.com/x-api/getting-started/pricing)

Illustrative monthly workload, calculated from those rates:

| Billed activity | Quantity | Cost |
|---|---:|---:|
| Post resources read | 900 | $4.50 |
| Profile resources read | 30 | $0.30 |
| Ordinary posts created | 30 | $0.45 |
| Total | | **$5.25** |

Thirty URL posts instead of ordinary posts make this example **$10.80**. These calculations exclude connection-time reads, other endpoints, hosting, taxes, and any text-generation service. They are workload examples, not subscription quotes. Deduplication and actual resource counts may change billing.

## Proposed four-week experiment

These are product hypotheses and editorial suggestions, not proven growth claims or X-endorsed thresholds.

1. **Define the account.** Choose an audience, a concrete problem you can help with, and three topics supported by your experience. Improve the bio so a visitor can tell what you offer. Record the starting follower count.
2. **Create a manageable cadence.** Start with three original posts per week if that is sustainable. Rotate a practical lesson, a behind-the-scenes example, and a specific question. Treat this as a workload choice, not a safe posting limit.
3. **Participate personally.** Read relevant discussions and reply when you have something useful to contribute. Keep discovery separate from automated outreach.
4. **Review weekly.** Compare like, reply, repost, quote, and impression counts when available. Use `(likes + replies + reposts + quotes) / impressions` as an explicitly defined interaction rate. This is not a unique-user rate and does not measure every engagement type.
5. **Change one thing.** Try a different opening, topic, or publishing time. Compare several posts; a single outlier does not prove causation. Measure profile-level follower change separately rather than attributing it to a particular post without evidence.

Success means an improvement in useful conversations, qualified profile visits when measurable, and repeatable publishing. Follower growth may follow but is not guaranteed. Organic growth has no reliable fixed timeline.

## Application delivered in this workspace

The implementation provides persistent drafts and a date-based publication plan, customizable audience/topic settings, writing prompts, account connections, and user-triggered API publishing and analytics. Planning dates are reminders: the app does not send posts automatically in the background. Writing prompts are editorial templates, not AI-generated content or claims of predictive performance.

Its architecture uses a private authenticated workspace, owner-scoped D1 records, server-side OAuth, encrypted tokens, and a separate connection for each X profile. Draft publication requires confirmation; atomic state transitions prevent concurrent duplicate submissions. A timeout or unclear upstream response is treated as an uncertain outcome, requiring the user to check X instead of blindly retrying. API spend is conservatively estimated and bounded inside the app, while the developer-console spending limit remains authoritative.

The app deliberately does not contain auto-follow, auto-like, bulk DM, unsolicited-reply, engagement-trading, browser-scraping, or ban-evasion features. Live X functionality requires your approved developer app, OAuth credentials, credits, and authorization of an account. No live X account has been tested or grown as part of this documentation study.

## Before opening a commercial service

Complete a real-account integration test, obtain appropriate X access, publish the service's own privacy and deletion policies, and validate retention/deletion handling. X's guidelines set deletion requirements for removed or requested content. This MVP avoids durable storage of fetched post text and offers account disconnection and workspace deletion. [Data handling guidance](https://docs.x.com/developer-guidelines)

For a public SaaS launch, add appropriate public access and onboarding, durable scheduled execution if desired, per-customer quotas plus a developer-wide budget, usage reconciliation, operational alerts, and tested token/key rotation. Validate paid demand before adding expensive search or high-frequency analytics. The private first version is a foundation for that validation, not evidence of follower growth or a certification from X.
