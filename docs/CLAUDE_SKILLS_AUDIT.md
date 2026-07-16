# Claude Skills Audit — July 16, 2026

Audit of the 16 custom claude.ai skills on this account (built-in Anthropic skills — docx, xlsx, pptx, pdf, skill-creator — were excluded; they are maintained by Anthropic).

**Scope note:** this session can read each skill's *description* (the frontmatter text that controls when the skill triggers) via the skill registry, but not the SKILL.md bodies, which are hosted on claude.ai and not mounted in this environment. The description layer is where routing bugs live, so that is what was audited.

**How to apply the fixes:** run the skills-manager tool in [`tools/skills-manager/`](../tools/skills-manager/) — `python skills_manager.py apply-audit` updates all 9 skills through the Anthropic Skills API (the fixes ship in its `audit_fixes.json`). The copy-paste texts below remain the fallback for applying by hand in claude.ai → Settings → Capabilities → Skills.

## Scorecard

| Skill | Chars (limit 1024) | Verdict |
|---|---|---|
| proposal-builder | 1006 | ✅ Clean — well-scoped, cross-references siblings both ways |
| ai-visibility-trends | 873 | ✅ Clean — clear collected-vs-new-data boundary |
| diagnostic-builder | 873 | ✅ Clean — prospect/retained boundary explicit |
| csuite-report | 782 | 🟡 Minor fix — vague "Do NOT" clause |
| io-generator | 852 | ✅ Clean — excludes all three SOW builders by name |
| scored-eval | 977 | ✅ Clean |
| fable-method | 641 | 🔴 Fix — over-triggers on everything |
| ppc-sow-builder | 862 | 🟡 Minor fix — missing io-generator exclusion |
| entitymap-generator | 855 | ✅ Clean |
| sitebulb-sow-builder | 849 | 🟡 Fix — internally contradictory trigger |
| gsc-sow-builder | 777 | 🟠 Fix — no exclusions for sibling skills |
| social-performance-review | 788 | 🟡 Fix — one over-generic trigger phrase |
| social-ai-team | 881 | ✅ Clean |
| wp-classic-designer | 952 | 🟡 Fix — collides with legal-page-rewrite on landing pages |
| legal-page-rewrite | 981 | 🔴 Fix — fires on non-legal pages |
| geo-master-blueprint | 942 | 🟡 Fix — claims legal content with no boundary |

All 16 descriptions are within the 1024-character limit, including after the fixes below. No dead cross-references were found: every skill named inside another skill's description exists and is enabled.

---

## Findings

### F1 — HIGH: `fable-method` triggers on nearly every request the other 15 skills handle

Its triggers are "any audit, review, critique, rewrite, SOW, technical document, analysis, comparison," "any work product where accuracy matters more than speed," "any multi-step deliverable in legal, YMYL, SEO/GEO, or client-facing contexts," and "facts about the present-day world." Every diagnostic, SOW, IO, report, and legal rewrite in your suite is a client-facing multi-step deliverable, so this description competes with the correct specialist skill on essentially every request. The description also never says whether it *replaces* or *accompanies* a specialist skill.

**Failure scenario:** "Build the August IO for Acme" matches both io-generator and fable-method; if fable-method wins routing, you get a rigor method with no IO template.

**Fix:** reframe it explicitly as a companion method that loads alongside specialists, narrow the blanket triggers to explicit invocation plus genuinely high-stakes work, and add a negative trigger. (Replacement text in the Fixed Descriptions section.)

### F2 — HIGH: `legal-page-rewrite` claims bare "rewrite this page" / "audit this page" with no legal qualifier

The sentence 'Trigger even if the user says "rewrite this page," "audit this page," or "run the legal critique"' makes the first two phrases unconditional. A user dropping any non-legal page and saying "audit this page" can pull a YMYL legal-critique engine.

**Fix:** condition the bare phrases on a legal context, and add negative triggers toward geo-master-blueprint (legal *articles*) and wp-classic-designer (HTML builds).

### F3 — MEDIUM: GSC-export requests route ambiguously between `gsc-sow-builder` and `io-generator`

Four skills accept GSC data (diagnostic-builder, gsc-sow-builder, csuite-report, io-generator). Three of the four disambiguate by naming their siblings in "Do NOT" clauses — but gsc-sow-builder excludes only "social content, keyword research without CSVs, or general SEO questions." A retained client's monthly GSC drop with "build me a work plan" is claimed by gsc-sow-builder ("generate a work plan from GSC data") *and* io-generator ("monthly work plan"); io-generator yields correctly in one direction, gsc-sow-builder never yields back.

**Fix:** add explicit exclusions to gsc-sow-builder for diagnostic-builder (prospects), io-generator (retained engagement context), and csuite-report (executive summaries).

### F4 — MEDIUM: `wp-classic-designer` vs `legal-page-rewrite` collide on "build me a landing page"

A law-firm landing page on WordPress matches both. The real boundary — wp-classic-designer builds the HTML shell, legal-page-rewrite writes the content and strategy — is stated in neither description.

**Fix:** add the boundary to wp-classic-designer's "Do NOT" clause (and to legal-page-rewrite per F2).

### F5 — MEDIUM: `social-performance-review` claims the generic phrase "content performance review"

That phrase also describes reviewing article/GEO content performance (GSC/GA4 territory). **Fix:** qualify it as "social content performance review" and add a one-line negative trigger.

### F6 — LOW: `sitebulb-sow-builder` is internally contradictory

It triggers on "any request that combines a crawl tool output with a handoff deliverable" (which includes Screaming Frog, Ahrefs Site Audit) while its own "Do NOT" line says "audits that are not from Sitebulb." **Fix:** scope the broad trigger to Sitebulb output and name the excluded tools.

### F7 — LOW: `geo-master-blueprint` claims legal content with no boundary against `legal-page-rewrite`

It "handles editorial, legal, healthcare..." content types. The actual boundary (articles vs. landing/practice-area pages) is unstated on both sides. **Fix:** add a negative trigger each way.

### F8 — LOW: `ppc-sow-builder` doesn't exclude `io-generator`

io-generator excludes "standalone PPC work orders (ppc-sow-builder)" but ppc-sow-builder doesn't yield back for monthly IOs on retained PPC engagements. **Fix:** add the exclusion.

### F9 — LOW: `csuite-report`'s "Do NOT" clause trails off vaguely

"...technical audits — those are a different deliverable" names no skill. **Fix:** name sitebulb-sow-builder and gsc-sow-builder, and state the reports-vs-plans boundary.

### What's working well (keep as-is)

- **proposal-builder → io-generator → csuite-report pipeline:** every stage names its upstream and downstream skill in both positive and negative triggers. This is the pattern the weaker skills should copy.
- **ai-visibility-trends** draws a crisp "analyzes collected data / does not run new checks" boundary and names its consumers (io-generator section E, csuite-report).
- **social-ai-team ↔ social-performance-review** form a clean create/review loop via best-performers.md.
- **diagnostic-builder** disambiguates on prospect-vs-retained, which resolves what would otherwise be a four-way GSC collision.

---

## Fixed descriptions (copy-paste ready)

Replace the description field of each skill below with the text in its block. Character counts verified ≤ 1024. Skills not listed here need no changes.

### fable-method (831 chars) — fixes F1

> High-rigor verification method that runs ALONGSIDE other skills, not instead of them — it governs HOW the work is done (claim verification, source checking, self-audit passes), while a specialist skill (diagnostic-builder, legal-page-rewrite, gsc-sow-builder, etc.) governs WHAT is produced. Trigger on explicit invocation — "fable method," "fable mode," "high rigor," "verify this," "audit this," "be thorough" — or when the deliverable is high-stakes: legal/YMYL content, client-facing documents, or work that states present-day facts (prices, versions, model IDs, laws, product features) that must be verified. When a specialist skill also matches the request, load both and apply this method to that skill's workflow. Do NOT load for routine drafts, brainstorming, or quick questions where speed matters more than verification.

### legal-page-rewrite (1021 chars) — fixes F2, F4, F7

> Three-stage system for rewriting, executing, and auditing legal landing pages for Google rankings, LLM citations, CRO conversion, and SSIT classifier gate survival. Use this skill whenever the user asks to: rewrite a legal landing page or practice area page; run Stage 1 verification or blueprint a legal page; execute a draft from a Stage 1 blueprint (Stage 2); critique, audit, or score an existing legal landing page (Stage 3); run the AEO Verification Engine, AEO Execution Engine, or Legal Landing Page Critique; optimize a legal page for LLM citations, AEO, GEO, or AI discovery; check SSIT gate compliance or VSP readiness; or fix CRO issues on a legal landing page. Trigger on "rewrite this page," "audit this page," or "run the critique" ONLY when the page belongs to a law firm or the context is legal. All legal content is YMYL / HIGH-STAKES. Stage 3 can run standalone. Do NOT use for legal blog posts or editorial articles (geo-master-blueprint) or for building WordPress HTML sections (wp-classic-designer).

### gsc-sow-builder (924 chars) — fixes F3

> Generate a 9-week SEO/GEO recovery Statement of Work (SOW) from Google Search Console CSV exports and live Ahrefs data. Use this skill whenever the user drops in Pages.csv and/or Queries.csv exports from GSC and wants an audit, sprint plan, work plan, SOW, or prioritized recovery roadmap. Also trigger when the user says 'run the SOW builder', 'generate a work plan from GSC data', 'audit my site with GSC data', 'build me a sprint plan', or any variation of turning GSC data into a structured recovery plan. The output is a fully populated .docx SOW with KPI baselines, a redirect registry, regression page list, CTR rewrite batches, new content targets, and a week-by-week task breakdown. Do NOT use for prospect diagnostics (diagnostic-builder), monthly work plans for retained clients with an engagement context (io-generator), executive summaries (csuite-report), social content, or general SEO questions without CSVs.

### wp-classic-designer (946 chars) — fixes F4

> Use this skill whenever the user wants to design, build, or generate a webpage or landing page section for WordPress using the Classic Editor (not Gutenberg). Triggers include: 'design a page in WordPress', 'build a landing page for WordPress', 'create a hero section', 'make a features section', 'build a pricing table', 'create a CTA banner', 'FAQ section for WordPress', 'testimonials section', 'WordPress page layout', 'Classic Editor HTML', 'page template for WordPress', or any request to produce styled HTML for pasting into a WordPress page or post. Also trigger on 'copy-paste HTML for WordPress', 'WordPress-compatible HTML', or 'design a services page' / 'build me a landing page' in a WordPress context. Do NOT use for Gutenberg block development, PHP templates, WordPress plugin/theme development, or for writing/rewriting legal landing page copy and strategy (legal-page-rewrite) — this skill builds the HTML shell, not the content.

### social-performance-review (929 chars) — fixes F5

> Use this skill whenever the user wants to review, analyze, or debrief social media content performance. Triggers include: 'review my social posts', 'what worked this month', 'analyze my social performance', 'which posts did best', 'social media recap', 'social content performance review', 'update best performers', 'social audit', 'what should I post more of', 'what flopped', or any request to evaluate past social content and extract lessons for future campaigns. Also trigger when the user provides engagement numbers, screenshots, or platform analytics for social posts and wants to understand what to do differently. The output feeds directly into the social-ai-team skill's next campaign cycle via best-performers.md. Use this skill at the end of any content cycle — monthly, campaign-end, or quarter-end. Do NOT use for organic/article content performance (that is GSC/GA4 territory) — this skill is social-platform only.

### sitebulb-sow-builder (899 chars) — fixes F6

> Turn a Sitebulb audit export into an idiot-proof developer SOW with zero subjectivity. Use this skill whenever the user drops in Sitebulb CSV exports, mentions a .sbp file, or asks to turn a Sitebulb audit into a work plan, ticket list, scope of work, or dev handoff. Also trigger on phrases like "build an SOW from this audit", "convert my Sitebulb hints to tickets", "generate a developer scope from this crawl", "fix these sitebulb issues", or any request that combines Sitebulb output with a handoff deliverable. Produces a .docx SOW plus .xlsx ticket log with exact URLs, exact before/after HTML, and exact acceptance criteria. All title, meta, and H1 rewrites follow the v6.0 generator rules embedded in reference/v6_title_meta_generator.md. Do NOT trigger for generic SEO questions, strategy discussions, or crawls from other tools (Screaming Frog, Ahrefs site audit) — Sitebulb exports only.

### geo-master-blueprint (1010 chars) — fixes F7

> Execute the GEO-Master Content Blueprint v29.1 — a full end-to-end content production system for creating articles that rank in traditional search AND earn citations from LLMs (ChatGPT, Claude, Perplexity, Gemini). Use this skill whenever the user asks to: write, plan, or produce a GEO-optimized or AEO-optimized article; run the GEO blueprint or content blueprint on a topic; create citation-ready, LLM-optimized, or AEO/GEO content; execute any phase of the blueprint (Phase 0 through Phase 6); produce a content map, evidence pool, blueprint.md, article.md, schema markup, or qa_audit; do keyword + evidence research for a content production project; or build content with correction moats, atomic facts, or Citation Priority Zone optimization. Trigger on "run the blueprint on [topic]" or "write a GEO article about X." Handles editorial, legal, healthcare, e-commerce, and technical articles. Do NOT use for legal landing/practice-area page rewrites (legal-page-rewrite) or social posts (social-ai-team).

### ppc-sow-builder (907 chars) — fixes F8

> Build a client-ready PPC work order / Statement of Work (SOW) from paid-search platform exports. Use whenever the user drops Google Ads or Microsoft (Bing) Ads exports (Overview cards zip, Campaigns, Networks, Search_keywords, Searches, Auction_insights, Devices, Demographics, Day_&_hour, Biggest_changes), references a prior PPC SOW, or asks for a PPC SOW, paid search SOW, PPC work order, Google Ads work order, or Bing/Microsoft Ads work order for a client or PPC manager. Also trigger on 'build a work order from these ad exports', 'PPC SOW for [client]', or 'turn this ad data into a work order'. Works for any paid-search client; client, budgets, campaigns, standing rules, and executor are inputs, never hardcoded. Do NOT use for GSC/organic SOWs (gsc-sow-builder), Sitebulb/dev SOWs (sitebulb-sow-builder), monthly IOs for retained engagements (io-generator), or generic PPC questions with no data.

### csuite-report (861 chars) — fixes F9

> Generate the monthly C-suite executive performance report for a retained SEO/AI-visibility/PPC client — a 1-2 page plain-English brief for managing partners, CEOs, and firm owners with zero marketing vocabulary. Use this skill whenever the user asks for a C-suite report, executive summary, client monthly report, owner report, monthly performance brief, or "run the executive report for [client]", or drops GA4/GSC/SERP/PPC exports and asks for the client-facing summary. Also trigger on "is the investment working" style reporting requests and QBR or renewal-prep summaries. Works with the io-generator client profile for house rules and baselines. Do NOT use for internal marketing-team deep dives, keyword-level analysis, technical audits (sitebulb-sow-builder), or recovery work plans (gsc-sow-builder) — this skill reports outcomes, it does not plan work.

---

## Not audited (out of reach from this environment)

- **SKILL.md bodies and bundled reference files** (e.g., sitebulb-sow-builder's `reference/v6_title_meta_generator.md`, scored-eval's rubrics). To audit these, run skill-creator in a claude.ai chat, or keep skill sources in a Git repo and add it to a session.
- **Trigger accuracy in practice.** skill-creator can run description-triggering evals; the ambiguous prompts worth testing first are: "audit this page" (legal vs. non-legal), "build me a work plan from this GSC data" (retained vs. recovery), and "build me a landing page" (WP build vs. legal content).

**Recommendation:** keep the skill sources in a dedicated GitHub repo (e.g., `prowebpromo/claude-skills`) so future audits can cover the full SKILL.md bodies, diff changes, and version them alongside the deliverable templates they generate.
