# Statement of Work
## SEO Recovery, GEO Optimization & Content Growth
### DandaLaw.com (Dansker & Aspromonte Associates LLP)

**Client:** Dansker & Aspromonte Associates LLP  
**Duration:** 9 weeks (April 14 – June 15, 2026)  
**Version:** 1.0 — April 7, 2026  
**Data source:** GSC Pages (28-day YOY + 90-day rolling export, April 7, 2026)

---

## 1. Executive Summary

This SOW covers a 9-week sprint to secure a compromised WordPress site, recover lost organic clicks from URL migration fallout, resolve practice area cannibalization, and improve CTR on high-impression pages.

**Strategy in four words: Secure. Redirect. Recover. Compound.**

There are two site-breaking issues before standard SEO work begins:

**Issue 1 — Site compromise.** Google has indexed at least 6 spam/gambling pages under `/pages/`. This is evidence of a WordPress file injection attack. These pages represent E-E-A-T contamination and manual action risk on a law firm domain. Nothing else in this SOW proceeds until this is resolved.

**Issue 2 — URL migration without redirects.** The site restructured blog content from root URLs to `/blog/` paths, and FAQ slugs from truncated to full versions, without implementing 301 redirects. This has split link equity and traffic across old and new URLs for ~15 page pairs, explaining the YOY click loss for many pages that appear "new" in the current period.

---

## 2. Priority Framework

| Priority | Focus | Why First |
|---|---|---|
| P0 | Security: Remove hacked spam pages | Manual action risk on a law firm domain is existential |
| P1 | Redirect cleanup: old → new URL pairs | Consolidates split impressions, recovers link equity |
| P2 | CTR recovery: title/meta rewrites | Fastest click gains on existing rankings |
| P3 | Cannibalization: practice area page consolidation | Unblocks ranking potential for highest-value pages |
| P4 | Content refresh on regression pages | Recovers traffic from pages that materially dropped |
| P5 | GEO signals + llms.txt | LLM citation and trust layer |
| P6 | Measure, retest, expand | Data-driven iteration only |

---

## 3. Primary KPIs

| Metric | Baseline | Target | By |
|---|---|---|---|
| 28-day clicks | ~400 | 800 | Wk 9 |
| Sitewide CTR | ~0.5% | 1.2% | Wk 9 |
| Spam pages deindexed | 6 indexed | 0 indexed | Wk 1 |
| 301 redirects live | 0 of 15 | 15 of 15 | Wk 2 |
| Title/meta rewrites live | 0 of 14 | 14 of 14 | Wk 4 |
| Practice area cannibalization resolved | 0 of 6 | 6 of 6 | Wk 5 |
| Regression pages recovered | 4 declining | 4 recovering | Wk 7 |
| Sources & Verification blocks | 0 | 10 pages | Wk 7 |

---

## 4. CRITICAL: Hacked Pages Registry

**These must be resolved before Week 1 closes.** Google has indexed spam/gambling pages under `/pages/` — evidence of a WordPress file injection attack. Legitimate content exists elsewhere under `/pages/`, so do NOT force a blanket 410 on the entire path. Each spam URL must be handled individually.

| Injected URL | 90d Impressions | Category |
|---|---|---|
| `/pages/white_magic_spell_to_make_someone_think_of_you.html` | 100 | Occult spam |
| `/pages/herospin_casino_registration_guide__how_to_sign_up___start_playing.html` | 32 | Casino |
| `/pages/marvelbet_bangladesh_review__mobile_app__betting_options__and_bonuses_explained.html` | 27 | Gambling |
| `/pages/pin_up_bet__a_premium_online_betting_experience.html` | 8 | Gambling |
| `/pages/glory_casino__secure_gaming_with_800__games___fast_payouts.html` | 4 | Casino |
| `/pages/a_plinko_j_t_k_el_nyei_megb_zhat__online_kaszin_kban.html` | 3 | Casino (Hungarian) |

**Required actions in order (Dev):**

1. Audit the `/pages/` directory — identify all files, separate legitimate from injected
2. Run Wordfence or Sucuri full site scan for malware and injected files
3. Delete only the 6 spam files above (and any additional injected files found in step 1)
4. Force 410 Gone response on each deleted URL individually — do NOT use 301
5. Submit all 6 URLs for removal in GSC (Removals tool → Request removal)
6. Change all WordPress admin passwords, API keys, FTP credentials, and hosting panel passwords
7. Review GSC → Manual Actions tab for existing penalties
8. Audit WordPress plugins for outdated/vulnerable versions — update or remove
9. Scan theme files and `wp-content/uploads` for additional injected content

**Chuck's actions:**

- Flag urgently to Dev with this list
- Confirm completion before Week 2 begins
- Check GSC Manual Actions tab after Dev confirms clean

**QA:** All 6 URLs return 410. GSC removal requests submitted. Recheck for new injected pages weekly throughout the sprint.

---

## 5. URL Redirect Registry (15 pairs)

### A. Blog Content Migration — 6 Redirects

These pages lived at root-level URLs in March 2025 and had organic traffic. Content was intentionally moved to `/blog/` paths but without 301 redirects, causing complete traffic loss on the old URLs.

| Redirect FROM | Redirect TO | Prior Yr Clicks Lost |
|---|---|---|
| `/man-survives-fall-from-new-yorks-iconic-empire-state-building/` | `/blog/man-survives-fall-from-new-yorks-iconic-empire-state-building/` | 38 |
| `/college-scholarships-for-students-affected-by-personal-injuries/` | `/blog/college-scholarships-for-students-affected-by-personal-injuries/` | 22 |
| `/reporting-a-dog-bite-in-new-york/` | `/blog/reporting-a-dog-bite-in-new-york/` | 12 |
| `/the-most-common-defense-arguments-in-personal-injury-cases/` | `/blog/the-most-common-defense-arguments-in-personal-injury-cases/` | 11 |
| `/property-owner-liability-vs-occupier-liability/` | `/blog/property-owner-liability-vs-occupier-liability/` | 11 |
| `/does-a-liability-waiver-mean-you-cant-recover-for-your-injuries-in-new-york/` | `/blog/does-a-liability-waiver-mean-you-cant-recover-for-your-injuries-in-new-york` | 8 |

### B. Structural / Navigation Moves — 2 Redirects

| Redirect FROM | Redirect TO | Prior Yr Clicks Lost |
|---|---|---|
| `/attorneys/` | `/about/attorneys/` | 8 |
| `/new-york-premises-liability-lawyer/school-accidents/` | `/practice-areas/new-york-school-injuries-lawyer/` | 10 |

### C. Truncated FAQ Slugs → Full Slugs — 7 Redirects

FAQs were republished with full-length slugs without redirecting the truncated originals. Both versions appear in GSC, splitting residual ranking signals.

| Redirect FROM (truncated) | Redirect TO (full) | Notes |
|---|---|---|
| `/faqs/can-i-sue-mechanic-auto-repair-shop-for-negligen/` | `/faqs/can-i-sue-mechanic-auto-repair-shop-for-negligence/` | 20 prior yr clicks |
| `/faqs/who-is-at-fault-in-backing-up-car-accident/` | Full slug version (confirm in WP) | 13 prior yr clicks |
| `/faqs/how-often-do-construction-workers-die/` | Full slug version | 12 prior yr clicks |
| `/faqs/can-you-sue-a-bouncer-for-liability-in-a-persona/` | `/faqs/can-you-sue-a-bouncer-for-liability-in-a-personal-injury-case/` | 9 prior yr clicks |
| `/faqs/negligent-hiring-negligent-supervision-and-negli/` | `/faqs/negligent-hiring-negligent-supervision-and-negligent-retention/` | 1,408 imp |
| `/faqs/get-surveillance-camera-footage-of-auto-accident/` | `/faqs/get-surveillance-camera-footage-of-auto-accident-in/` | 4 prior yr clicks |
| `/faqs/what-can-bar-club-owners-be-held-liable-for-in-a/` | `/faqs/what-can-bar-club-owners-be-held-liable-for-in-a-personal-injury-case/` | 4 prior yr clicks |

**QA:** Test each redirect with `curl -I`. Verify clean 301, correct Location header. No redirect chains. Retest weekly for 4 weeks.

---

## 6. Weekly Sprint Breakdown

### Week 1: April 14–20 — Security + Baseline

**Goal:** Eliminate hacked pages and capture baseline before any changes go live.

| Task | Owner | Done |
|---|---|---|
| Run Wordfence/Sucuri full scan; audit `/pages/` directory; delete 6 spam files; force 410 on each individually | Dev | ☐ |
| Submit all 6 spam URLs for GSC removal | Dev | ☐ |
| Change all WP admin, FTP, hosting passwords | Dev | ☐ |
| Review GSC Manual Actions tab | Chuck | ☐ |
| Confirm Dev completion before Week 2 begins | Chuck | ☐ |
| Pull GSC + SERP baseline snapshots before any other changes | Chuck | ☐ |

**Acceptance:** Zero spam pages indexed. GSC Manual Actions clean. Baseline snapshots saved.

---

### Week 2: April 21–27 — Redirect Cleanup

**Goal:** Implement all 15 redirects. Zero redirect chains.

| Task | Owner | Done |
|---|---|---|
| Implement 6 blog content migration redirects (Section 5A) via WordPress Redirection plugin CSV import | Chuck | ☐ |
| Implement 2 structural move redirects (Section 5B) | Chuck | ☐ |
| Implement 7 truncated FAQ slug redirects (Section 5C) | Chuck | ☐ |
| Verify all 15 return clean 301 via `curl -I`; confirm no chains | Claude + Chuck | ☐ |
| Scan GSC for additional duplicate URL pairs not in this registry | Claude | ☐ |

**Acceptance:** All 15 redirects live. Clean 301, no chains. GSC supplemental scan complete.

---

### Week 3: April 28–May 4 — CTR Wave, Batch 1

**Goal:** Rewrite titles and meta descriptions for the 7 highest-opportunity pages by impression × CTR gap.

| Task | Page | 90d Imp | Pos | Actual CTR | Owner | Done |
|---|---|---|---|---|---|---|
| Title/meta rewrite | `/blog/new-york-serious-injury-threshold-the-9-categories-to-qualify-for-a-lawsuit/` | 12,313 | 6.9 | 0.28% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/faqs/can-you-fully-recover-from-traumatic-brain-injury/` | 14,254 | 4.3 | **0.51% — worst CTR/position ratio on site** | Claude + Chuck | ☐ |
| Title/meta rewrite | `/blog/defective-roadway-claims-nyc/` | 12,081 | 8.43 | 0.24% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/faqs/can-you-sue-a-bouncer-for-liability-in-a-personal-injury-case/` | 6,351 | 4.26 | 0.38% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/blog/nyc-building-security-negligence-tenant-rights-landlord-liability/` | 10,376 | 7.89 | 0.55% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/blog/property-owner-liability-vs-occupier-liability/` | 5,783 | 7.25 | 0.52% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/faqs/who-is-at-fault-when-hitting-a-parked-car/` | 21,608 | 8.73 | 1.22% — top page, compounding the win | Claude + Chuck | ☐ |

**Acceptance:** 7 rewrites live. Baseline CTR saved for each. No rewrite changes page H1 without approval.

---

### Week 4: May 5–11 — CTR Wave, Batch 2

**Goal:** Complete the CTR rewrite wave.

| Task | Page | 90d Imp | Pos | Actual CTR | Owner | Done |
|---|---|---|---|---|---|---|
| Title/meta rewrite | `/faqs/how-long-to-settle-car-accident-case-ny/` | 14,417 | 14.06 | 0.42% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/faqs/how-to-obtain-a-car-accident-report-in-new-york-city/` | 11,327 | 12.24 | 0.30% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/faqs/can-i-sue-mechanic-auto-repair-shop-for-negligence/` | 10,499 | 12.09 | 0.38% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/blog/nyc-tenant-rights-know-your-rights-responsibilities-as-a-tenant/` | 6,555 | 21 | 0.23% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/faqs/negligent-hiring-negligent-supervision-and-negligent-retention/` | 4,708 | 13.2 | 0.36% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/blog/can-a-head-injury-cause-epilepsy/` | 5,752 | 10.57 | 0.12% | Claude + Chuck | ☐ |
| Title/meta rewrite | `/blog/how-to-pass-your-teen-drivers-license-test/` | 5,797 | 8.51 | **0.07% — extremely low for pos 8.5** | Claude + Chuck | ☐ |

**Acceptance:** 14 total rewrites live across Weeks 3–4. Each page has a saved pre/post CTR snapshot.

---

### Week 5: May 12–18 — Practice Area Cannibalization Cleanup

**Goal:** Each major practice area has two competing URLs splitting impressions. `/practice-areas/` is the canonical path. Redirect all `/new-york-X-lawyer/` variants to their `/practice-areas/` equivalents.

> **Note:** Several non-canonical URLs currently show higher impressions than their `/practice-areas/` counterparts (e.g. `/new-york/wrongful-death-lawyer/` has 13,844 imp vs 10,074). This is expected — it means external backlinks or internal links are pointing to the non-canonical URLs. After redirecting, those impressions consolidate onto `/practice-areas/` and should produce a ranking lift.

| Redirect FROM (non-canonical) | Redirect TO (canonical) | Combined Imp Split |
|---|---|---|
| `/new-york/wrongful-death-lawyer/` | `/practice-areas/new-york-wrongful-death-lawyer/` | 23,918 |
| `/new-york-construction-accident-lawyer/` | `/practice-areas/new-york-construction-accident-lawyer/` | 16,549 |
| `/new-york-nursing-home-abuse-lawyer/` | `/practice-areas/new-york-nursing-home-abuse-lawyer/` | 16,221 |
| `/new-york-bus-accident-lawyer/` | `/practice-areas/new-york-bus-accident-lawyer/` | 15,312 |
| `/new-york-car-accident-lawyer/` | `/practice-areas/new-york-car-accidents-lawyer/` | 13,770 |
| Brain injury: audit both URLs, confirm canonical | TBD | ~18,000 |

| Task | Owner | Done |
|---|---|---|
| Audit internal links across site for each cluster — update all to point to `/practice-areas/` URL before redirecting | Claude + Chuck | ☐ |
| Implement 5 confirmed practice area 301 redirects | Chuck | ☐ |
| Audit brain injury cluster, confirm canonical, redirect | Claude + Chuck | ☐ |
| Verify no redirect chains created with Week 2 redirects | Chuck | ☐ |

**Acceptance:** 6 practice area clusters each have one canonical URL. All internal links updated. No chains.

---

### Week 6: May 19–25 — Regression Recovery

**Goal:** Recover the 4 highest-priority pages that materially lost clicks YOY.

| Task | Owner | Done |
|---|---|---|
| **Full refresh: `/faqs/what-is-the-definition-of-a-car-accident/`** — was 50 clicks, now 1. Impressions collapsed from 23,604 to 4,223 — this is a content or canonicalization issue, not just a ranking drop. Rewrite as a direct-answer definitional page. Add FAQ block for related definitional queries. Check for duplicate content competing with this URL. | Claude + Chuck | ☐ |
| **Full refresh: `/faqs/who-is-at-fault-when-hitting-a-parked-car/`** — was 115 clicks, now 86 despite position improving from 20.3 → 6.9. Position gain should have tripled clicks; the fact it didn't means the content is losing to SERP features. Add: fault determination framework, insurer reporting flow, hit-and-run scenario, FAQ block. | Claude + Chuck | ☐ |
| **Refresh: `/faqs/who-is-at-fault-in-backing-up-car-accident/`** — was 13 clicks, now 0. Position improved (24.6 → 13.6) but clicks disappeared entirely. Clear title/intent mismatch — needs new title and stronger quick-answer block. | Claude + Chuck | ☐ |
| **Refresh: `/faqs/how-often-do-construction-workers-die/`** — was 12 clicks, now 0. Position improved (12.1 → 11.1), same pattern. Informational intent; needs stronger quick-answer block and FAQ schema. | Claude + Chuck | ☐ |

**Acceptance:** 4 pages refreshed and resubmitted in GSC. Each has a direct-answer block in first 150 words.

---

### Week 7: May 26–June 1 — GEO Signals + Schema + llms.txt

**Goal:** Build the trust/citation layer and create llms.txt from scratch.

| Task | Owner | Done |
|---|---|---|
| Add Sources & Verification blocks to 10 highest-impression pages, citing NY statutes, case law, or NYPD/DOT sources where applicable: `/faqs/who-is-at-fault-when-hitting-a-parked-car/`, `/faqs/can-you-fully-recover-from-traumatic-brain-injury/`, `/faqs/how-long-to-settle-car-accident-case-ny/`, `/blog/new-york-serious-injury-threshold.../`, `/blog/defective-roadway-claims-nyc/`, `/faqs/can-i-sue-mechanic-auto-repair-shop-for-negligence/`, `/blog/nyc-building-security-negligence.../`, `/faqs/how-to-obtain-a-car-accident-report-in-new-york-city/`, `/blog/nyc-tenant-rights.../`, `/blog/can-a-head-injury-cause-epilepsy/` | Claude + Chuck | ☐ |
| **Create** `llms.txt` + `llms-full.txt` from scratch — top 25 URLs with title, attorney author, date, 2–3 sentence summaries | Claude + Chuck | ☐ |
| Add Person schema for each named attorney: Dansker, Aspromonte, Hoffer, Maceira — include description, jobTitle, knowsAbout | Claude + Chuck | ☐ |
| Add FAQ schema to all refreshed/rewritten pages from Weeks 3–6 (target: 12+ pages) | Claude + Chuck | ☐ |
| Confirm WebSite schema name = "Dansker & Aspromonte Associates LLP" | Chuck | ☐ |
| Audit Organization schema — verify logo, address, phone, sameAs links | Chuck | ☐ |
| Submit all new/revised URLs in GSC | Chuck | ☐ |

**Acceptance:** Sources blocks live on 10 pages. `llms.txt` and `llms-full.txt` deployed. Attorney schemas validated. FAQ schema count ≥ 12 pages.

---

### Weeks 8–9: June 2–15 — Measurement & Retest

**Goal:** Data collection and iteration only. No new content.

| Task | Owner | Done |
|---|---|---|
| Every Monday: Export GSC Pages + Queries. Compare CTR, clicks, position vs baseline. Flag losers for retest. | Chuck | ☐ |
| Title/meta with no CTR lift after 14 days → test second variant | Claude + Chuck | ☐ |
| Regression page not improving after 3 weeks → deepen content, recheck internal competition | Claude + Chuck | ☐ |
| Any redirect chain appears → fix same week | Chuck | ☐ |
| Confirm all 6 spam pages remain deindexed | Chuck | ☐ |
| Confirm no new injected pages have appeared under `/pages/` or elsewhere | Chuck | ☐ |

---

## 7. Explicitly Deprioritized

| Item | Reason |
|---|---|
| Borough-specific page expansion (Bronx, Brooklyn, Queens, etc.) | Wait for practice area cannibalization cleanup first or borough pages will inherit the same split |
| Spanish/Chinese content optimization | Core English pages take priority in this sprint |
| New blog content | No new pages until redirects and CTR issues are resolved |
| Backlink acquisition | On-page recovery first |
| Deep GMB optimization | GMB UTM tracking is working and driving clicks; defer |
| Speakable schema | Not a ranking factor in this sprint window |
| Additional FAQ pages | Only after regression recovery confirms ROI from existing FAQs |

---

## 8. Confirmed Decisions

| Question | Answer |
|---|---|
| Who manages WordPress security? | Dev |
| Was the `/blog/` migration intentional? | Yes — old root URLs should 301 to `/blog/` versions |
| Which practice area URL is canonical? | `/practice-areas/` |
| Does `llms.txt` exist currently? | No — create from scratch |
| Is there legitimate content under `/pages/`? | Yes — handle spam pages individually, not with a blanket 410 |
