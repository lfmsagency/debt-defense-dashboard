# Consumer Debt Defense Firm — Strategic Analysis Dashboard

Interactive partner-meeting dashboard for the Consumer Debt Defense Firm launch (sister brand to Ticket Crushers Law). Built for Adam Cohen, Christopher D'Anjou, and Jesse Dean-Kluger.

**Live site:** https://lfmsagency.github.io/debt-defense-dashboard/

---

## What's in the dashboard

A single-page, vanilla HTML/CSS/JS application (no build step) with five integrated sections driven by a global state filter cascade.

| Section | Purpose |
| --- | --- |
| **Overview** | Four headline KPIs (Year 1 Revenue, Monthly Burn, Capital Runway, Competitors Tracked), D3 Albers-USA choropleth of the four launch states colored by competitor density, and the five most important course-corrections from the audit. |
| **Assumptions Audit** | All 21 load-bearing assumptions from Business Plan v2.0, grouped by category, color-coded by verdict. Click any row to expand the full justification, midline estimate, impact-if-wrong, and evidence sources. |
| **Competitive Landscape** | 87 firms across CA (22), FL (22), WA (20), NY (23). State-reactive KPIs, top-15-by-revenue bar chart, threat distribution by state, sortable/searchable firm table with additive filter chips and a court-district dropdown. Row click opens a side drawer with the full firm profile and source links. |
| **Case Law** | 63 controlling cases across CA / FL / WA / NY, organized by nine doctrines (standing, chain of title, hearsay & business records, SOL, default vacatur, pleading requirements, FDCPA leverage, state counterclaim, fee shifting). Per-state "Print this state's case law brief" buttons with print-only CSS. |
| **Projections** | Scenario chart (Bear / Plan / Midline / Bull), Year 1 quarterly build (plan vs midline), monthly burn breakdown by line item, filing volumes + default-judgment rates per state, TAM funnel, and five ranked risks with mitigants. |

---

## Top-line findings

- **Year 1 revenue midline: $2.85M** vs Plan v2.0's $3.75M (-24%)
- **Monthly burn midline: $253K** vs Plan's $218K (+16%)
- **Capital runway required: $2.75M** for ~11 months at midline burn
- **Competitor density:** 87 firms tracked, 11 rated high threat (Kazerouni, Loan Lawyers, The Langel Firm, Bromberg, Anderson Santiago, Washington Debt Law, and others)
- **Highest-impact corrections:**
  1. Docket-engine direct-mail conversion: model on 2%, not 4%
  2. Counterclaim recoveries are a Year 2 story ($325K–$475K in Year 1, not $700K–$1.4M)
  3. Raise $2.75M, not $2M
  4. Florida Bar 4-7.18 requires a 20-day pre-filing on every direct-mail variant
  5. New York's CCFA advantage is real but eroding

---

## Architecture

```
dashboard/
├── index.html       # Single-page layout with sticky nav and filter bar
├── styles.css       # Design system: warm off-white surfaces, deep teal accent
├── app.js           # Filter cascade, D3 charts, render functions per section
└── data/
    ├── competitors.json            # 87 firms with full Ticket Crushers framework fields
    ├── case_law_flat.json          # 63 cases, flat structure for the case law browser
    ├── case_law_survey.json        # Same data nested by state → doctrine
    ├── assumptions_audit.json      # 21 assumptions with evidence and citations
    └── projections.json            # Midline financial recast: scenarios, burn, TAM, risks
```

**Stack:** Vanilla HTML/CSS/JS, D3 v7 (CDN), us-atlas TopoJSON, Inter from Google Fonts. No build step, no framework, no dependencies to install.

---

## Design system

- Background: `#FAFAF7` (warm off-white)
- Surface: `#FFFFFF`
- Primary accent: `#0F4C5C` (deep teal — legal/serious)
- Semantic colors: `#3F6212` (supported), `#B45309` (overstated), `#9C4221` (understated)
- Typography: Inter 400/600/700 with `font-variant-numeric: tabular-nums lining-nums` on all figures
- WCAG AA contrast throughout; no decorative imagery

---

## Running locally

```bash
git clone https://github.com/lfmsagency/debt-defense-dashboard.git
cd debt-defense-dashboard
python3 -m http.server 8080
# Open http://localhost:8080
```

Or any static server. The data files are loaded via `fetch()` so the page must be served (not opened directly via `file://`).

---

## Methodology

- **Assumptions audit:** Each of the 21 claims in Business Plan v2.0 was cross-checked against primary sources (Judicial Council of California, Florida Courts Annual Report, NY OCA filing statistics, CFPB Consumer Credit Outlook, Pew Charitable Trusts default-judgment research, NCLC, ACA International). Verdicts are "midline" — not conservative, not liberal.
- **Competitive landscape:** Each of the 87 firms was researched via firm websites, Avvo / Justia / Super Lawyers / FindLaw profiles, LinkedIn, Google Business Profile, BBB, NACA member directory, news articles, and court records. Estimated revenue uses attorney headcount × industry-standard revenue-per-attorney ($350K–$650K for boutique consumer-law firms).
- **Case law:** 63 controlling cases selected from state high courts, intermediate appellate courts, and the relevant federal circuits (9th for CA/WA, 11th for FL, 2nd for NY). All citations verified; all cases confirmed still good law as of May 2026.
- **Projections:** Midline financial recast derived from the assumptions audit, applied to the plan's Year 1 build structure.

---

## License

MIT — see [LICENSE](LICENSE).

---

*Generated May 2026 for the Consumer Debt Defense Firm partner strategy session. Plan v2.0 is the underlying source document; this dashboard is the analytical layer on top of it.*
