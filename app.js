/* =====================================================================
 * Consumer Debt Defense Firm — Strategic Analysis Dashboard
 * ---------------------------------------------------------------------
 * Data flow:
 *   1. Load all 5 JSONs from /data via fetch().
 *   2. State object holds the global filters: { state, courtDistrict,
 *      competitorSearch, competitorFilters[], competitorSort,
 *      caseLawState, openAssumptions: Set }.
 *   3. setFilter() mutates state then calls render(), which delegates to
 *      renderOverview / renderAssumptions / renderCompetitors /
 *      renderCaseLaw / renderProjections.
 *   4. Each render function reads from state + DATA and rebuilds its
 *      DOM subtree. D3 used for choropleth + bar charts.
 *   5. Court district filter only affects renderCompetitors().
 * =====================================================================*/

// ----- Constants -----
const TARGET_STATES = ['CA', 'FL', 'WA', 'NY'];
const STATE_FIPS = { CA: '06', FL: '12', WA: '53', NY: '36' };
const FIPS_TO_STATE = { '06': 'CA', '12': 'FL', '53': 'WA', '36': 'NY' };
const STATE_NAMES = { CA: 'California', FL: 'Florida', WA: 'Washington', NY: 'New York' };

const FIVE_CORRECTIONS = [
  {
    title: "Direct mail conversion is the single most consequential overstatement",
    body: "Plan models 3–5% retainer conversion on served defendants; midline reality is 1.5–3.5% on a full 5-touch sequence. At 2% conversion, CAC rises from ~$100 to ~$185 — still beats paid search, but the docket engine is no longer one-third the cost."
  },
  {
    title: "$3.75M Year 1 revenue requires best-execution across every lever",
    body: "Counterclaim recoveries take 6–18 months; Tier 3 cases opened mid-Year 1 settle in Year 2. Midline Year 1 base is $2.7M–$3.1M with $325K–$475K of counterclaim revenue, not $700K–$1.4M."
  },
  {
    title: "Monthly burn at scale is $240K–$285K, not $217.8K",
    body: "Paralegal compensation (BLS/NALA blended four-state) loaded fully is $81K–$87.5K — versus the plan's implied $60K. Multi-state malpractice for a TCPA/FDCPA practice runs $15K–$25K/year. Compliance counsel is also light."
  },
  {
    title: "New York is the plan's most important market and its most fragile assumption",
    body: "CCFA's 3-year SOL and chain-of-title rules are real. But major debt buyers (Midland, Portfolio Recovery, LVNV) have had three years to retool. The post-2022 pleading-failure dismissal rate has already declined from its initial spike."
  },
  {
    title: "Florida Bar 4-7.18 creates an operational constraint on the docket engine",
    body: "Every substantively different mailer requires Bar pre-filing 20 days before first use at $150/filing. The 'personalized within 1–2 days' value prop requires a pre-approved template library in FL. CA, WA, NY do not impose the same constraint."
  }
];

const DOCTRINE_DESCRIPTIONS = {
  standing: "Defenses arising from a plaintiff's failure to prove it is the real party in interest — the assignee with the right to sue.",
  chain_of_title: "Each assignment from original creditor to current plaintiff must be documented; gaps are fatal to standing.",
  hearsay_business_records: "Plaintiff's documentary evidence must satisfy the business-records exception; declarant must have personal knowledge of the original creditor's record-keeping.",
  pleading_requirements: "State-specific complaint and exhibit requirements (CCFA in NY, FL 1.130, CCP 425.10 in CA, CR 8 in WA).",
  sol: "Statute of limitations defenses — three to six years depending on state and contract type.",
  fdcpa_leverage: "Federal Fair Debt Collection Practices Act counterclaims and §1692k statutory damages + fees.",
  state_counterclaim: "State analogs — Rosenthal Act (CA), FCCPA (FL), WCPA (WA), GBL §349 (NY) — that often allow treble damages, punitives, or higher fee shifts.",
  default_vacatur: "Standards and procedures for vacating default judgments; CCFA strengthens the defendant's position in NY.",
  fee_shifting: "Statutory fee-shifting provisions that convert a successful defense into a fee award against the plaintiff."
};

// ----- State -----
const state = {
  filters: {
    state: 'ALL',
    courtDistrict: 'ALL',
    competitorSearch: '',
    competitorFilters: new Set(),
    competitorSort: { col: 'est_revenue_mid', dir: 'desc' },
    caseLawState: 'CA',
  },
  openAssumptions: new Set(),
  openDoctrines: new Set(),
};

const DATA = {};

// ----- Formatters -----
const fmtUSD = (v, opts = {}) => {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return '$' + (v / 1e9).toFixed(opts.precise ? 2 : 1) + 'B';
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(opts.precise ? 2 : 1) + 'M';
  if (abs >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(v).toLocaleString();
};
const fmtUSDFull = v => '$' + Math.round(v).toLocaleString();
const fmtNum = v => (v == null || isNaN(v)) ? '—' : Math.round(v).toLocaleString();
const fmtPct = (v, digits = 0) => (v * 100).toFixed(digits) + '%';
const truncate = (s, n) => !s ? '' : (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
const escapeHtml = s => !s ? '' : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Parse markdown-style link list "[Name](url); [Name](url)" -> array of {name, url}
function parseSources(sourceStr) {
  if (!sourceStr || typeof sourceStr !== 'string') return [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(sourceStr)) !== null) {
    out.push({ name: m[1].trim(), url: m[2].trim() });
  }
  return out;
}

function parseCourtDistricts(s) {
  if (!s || typeof s !== 'string') return [];
  return s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

// ----- Init -----
async function init() {
  const [competitors, caseLawFlat, caseLawSurvey, audit, projections] = await Promise.all([
    fetch('data/competitors.json').then(r => r.json()),
    fetch('data/case_law_flat.json').then(r => r.json()),
    fetch('data/case_law_survey.json').then(r => r.json()),
    fetch('data/assumptions_audit.json').then(r => r.json()),
    fetch('data/projections.json').then(r => r.json()),
  ]);
  DATA.competitors = competitors;
  DATA.caseLawFlat = caseLawFlat;
  DATA.caseLawSurvey = caseLawSurvey;
  DATA.audit = audit;
  DATA.projections = projections;

  // Load US TopoJSON for map
  try {
    DATA.us = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then(r => r.json());
  } catch (err) {
    console.warn('US topo fetch failed', err);
    DATA.us = null;
  }

  bindGlobalEvents();
  render();
}

function bindGlobalEvents() {
  // State chips
  document.querySelectorAll('#state-chips .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      setStateFilter(btn.dataset.state);
    });
  });

  // Court district select
  document.getElementById('court-district-select').addEventListener('change', e => {
    state.filters.courtDistrict = e.target.value;
    renderCompetitors();
  });

  // Competitor search
  document.getElementById('competitor-search').addEventListener('input', e => {
    state.filters.competitorSearch = e.target.value.toLowerCase();
    renderCompetitorTable();
  });

  // Competitor filter chips
  document.querySelectorAll('#competitor-filters .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      if (state.filters.competitorFilters.has(f)) {
        state.filters.competitorFilters.delete(f);
        btn.classList.remove('is-active');
      } else {
        state.filters.competitorFilters.add(f);
        btn.classList.add('is-active');
      }
      renderCompetitorTable();
    });
  });

  // Sortable columns
  document.querySelectorAll('#competitor-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.filters.competitorSort.col === col) {
        state.filters.competitorSort.dir = state.filters.competitorSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        state.filters.competitorSort.col = col;
        state.filters.competitorSort.dir = ['attorney_count_est', 'est_revenue_mid'].includes(col) ? 'desc' : 'asc';
      }
      renderCompetitorTable();
    });
  });

  // Case law tabs
  document.querySelectorAll('#caselaw-tabs .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filters.caseLawState = btn.dataset.clState;
      renderCaseLaw();
    });
  });

  // Print
  document.getElementById('print-caselaw').addEventListener('click', () => {
    // Expand all doctrines temporarily
    const wasOpen = new Set(state.openDoctrines);
    state.openDoctrines = new Set(Object.keys(DOCTRINE_DESCRIPTIONS));
    renderCaseLaw();
    window.print();
    state.openDoctrines = wasOpen;
    renderCaseLaw();
  });

  // Drawer close
  document.querySelectorAll('[data-drawer-close]').forEach(el => {
    el.addEventListener('click', closeDrawer);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer();
  });
}

function setStateFilter(s) {
  state.filters.state = s;
  state.filters.courtDistrict = 'ALL';
  // If state filter set, default the case law tab to that state too
  if (TARGET_STATES.includes(s)) {
    state.filters.caseLawState = s;
  }
  document.querySelectorAll('#state-chips .chip').forEach(b => {
    b.classList.toggle('is-active', b.dataset.state === s);
  });
  render();
}

// ----- Filtered selectors -----
function selectedCompetitors() {
  let arr = DATA.competitors;
  if (state.filters.state !== 'ALL') {
    arr = arr.filter(c => c.target_state === state.filters.state);
  }
  return arr;
}

function filteredCompetitorsForTable() {
  let arr = selectedCompetitors();

  if (state.filters.courtDistrict !== 'ALL') {
    arr = arr.filter(c => parseCourtDistricts(c.active_court_districts).includes(state.filters.courtDistrict));
  }

  if (state.filters.competitorFilters.size) {
    arr = arr.filter(c => {
      for (const f of state.filters.competitorFilters) {
        if (f === 'threat-high' && c.threat_level !== 'High') return false;
        if (f === 'counterclaims' && !['yes', 'partial'].includes(c.takes_counterclaims_norm)) return false;
        if (f === 'google-ads' && c.google_ads_norm !== 'yes') return false;
        if (f === 'spanish' && !['yes', 'partial'].includes(c.spanish_norm)) return false;
      }
      return true;
    });
  }

  const q = state.filters.competitorSearch.trim();
  if (q) {
    arr = arr.filter(c => {
      const hay = (c.firm_name + ' ' + (c.hq_city || '') + ' ' + (c.primary_practice_focus || '')).toLowerCase();
      return hay.includes(q);
    });
  }

  const { col, dir } = state.filters.competitorSort;
  arr = [...arr].sort((a, b) => {
    let av = a[col]; let bv = b[col];
    if (col === 'attorney_count_est' || col === 'est_revenue_mid') {
      av = av == null ? -Infinity : +av;
      bv = bv == null ? -Infinity : +bv;
      return dir === 'desc' ? bv - av : av - bv;
    }
    if (col === 'threat_level') {
      const order = { High: 3, Medium: 2, Low: 1, Unknown: 0 };
      av = order[av] || 0; bv = order[b.threat_level] || 0;
      return dir === 'desc' ? bv - av : av - bv;
    }
    av = (av || '').toString().toLowerCase();
    bv = (bv || '').toString().toLowerCase();
    if (av < bv) return dir === 'desc' ? 1 : -1;
    if (av > bv) return dir === 'desc' ? -1 : 1;
    return 0;
  });

  return arr;
}

// ===== Render dispatch =====
function render() {
  renderOverview();
  renderAssumptions();
  renderCompetitors();
  renderCaseLaw();
  renderProjections();
}

// ===== OVERVIEW =====
function renderOverview() {
  const p = DATA.projections;
  const compsAll = DATA.competitors;
  const comps = selectedCompetitors();
  const stateLabel = state.filters.state === 'ALL'
    ? 'all 4 target states'
    : STATE_NAMES[state.filters.state];

  document.getElementById('overview-lede').textContent =
    `Midline reality-check of the Year 1 financial picture and the competitive surface across ${stateLabel}. ` +
    `Plan v2.0 figures shown for delta.`;

  const planRev = p.scenarios.base_plan.year1_revenue;
  const midRev = p.scenarios.midline.year1_revenue;
  const revDelta = (midRev - planRev) / planRev;

  const planBurn = p.monthly_burn.plan;
  const midBurn = p.monthly_burn.midline;
  const burnDelta = (midBurn - planBurn) / planBurn;

  const kpis = [
    {
      label: 'Year 1 Revenue · Midline',
      value: fmtUSD(midRev, { precise: true }),
      delta: `${(revDelta * 100).toFixed(0)}% vs plan`,
      baseline: `Plan ${fmtUSD(planRev, { precise: true })}`,
      tone: revDelta < 0 ? 'down' : 'up',
    },
    {
      label: 'Monthly Burn · Midline',
      value: fmtUSD(midBurn),
      delta: `+${(burnDelta * 100).toFixed(0)}% vs plan`,
      baseline: `Plan ${fmtUSD(planBurn)}`,
      tone: 'warn',
    },
    {
      label: 'Capital Runway Required',
      value: fmtUSD(p.capital_runway.midline_recommendation_usd, { precise: true }),
      delta: `${p.capital_runway.runway_months_at_midline_burn.toFixed(1)} months @ midline burn`,
      baseline: `Plan ${fmtUSD(p.capital_runway.plan_recommendation_usd, { precise: true })}`,
      tone: 'neutral',
    },
    {
      label: state.filters.state === 'ALL' ? 'Competitors Tracked' : `Competitors · ${state.filters.state}`,
      value: comps.length.toString(),
      delta: state.filters.state === 'ALL'
        ? `${compsAll.filter(c => c.threat_level === 'High').length} high threat`
        : `${comps.filter(c => c.threat_level === 'High').length} high threat`,
      baseline: `Across ${state.filters.state === 'ALL' ? 'CA · FL · WA · NY' : STATE_NAMES[state.filters.state]}`,
      tone: 'neutral',
    },
  ];

  document.getElementById('overview-kpis').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi__label">${escapeHtml(k.label)}</div>
      <div class="kpi__value">${escapeHtml(k.value)}</div>
      <div class="kpi__delta kpi__delta--${k.tone}">
        ${escapeHtml(k.delta)}
        <span class="kpi__delta-baseline">· ${escapeHtml(k.baseline)}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('corrections').innerHTML = FIVE_CORRECTIONS.map(c => `
    <li>
      <div>
        <div class="corrections__title">${escapeHtml(c.title)}</div>
        <div class="corrections__body">${escapeHtml(c.body)}</div>
      </div>
    </li>
  `).join('');

  renderChoropleth();
}

function renderChoropleth() {
  const wrap = document.getElementById('choropleth');
  wrap.innerHTML = '';
  if (!DATA.us) {
    wrap.innerHTML = '<div style="padding:24px;font-size:13px;color:var(--text-muted)">Map could not be loaded.</div>';
    return;
  }

  // Build state stats
  const byState = {};
  TARGET_STATES.forEach(s => {
    const comps = DATA.competitors.filter(c => c.target_state === s);
    const topFirms = [...comps].sort((a, b) => (b.est_revenue_mid || 0) - (a.est_revenue_mid || 0)).slice(0, 3);
    const filings = DATA.projections.filing_volumes_by_state[s].estimated_annual_filings;
    byState[s] = { count: comps.length, topFirms, filings };
  });

  const counts = TARGET_STATES.map(s => byState[s].count);
  const color = d3.scaleLinear()
    .domain([d3.min(counts), d3.max(counts)])
    .range(['#C8D7DC', '#0F4C5C'])
    .interpolate(d3.interpolateRgb);

  const width = wrap.clientWidth || 600;
  const height = Math.round(width * 0.625);
  const svg = d3.select(wrap)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const states = topojson.feature(DATA.us, DATA.us.objects.states).features;
  const projection = d3.geoAlbersUsa().fitSize([width, height], { type: 'FeatureCollection', features: states });
  const path = d3.geoPath().projection(projection);

  // tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'map-tooltip';
  wrap.appendChild(tooltip);

  svg.append('g')
    .selectAll('path')
    .data(states)
    .join('path')
      .attr('d', path)
      .attr('class', d => {
        const sa = FIPS_TO_STATE[d.id];
        const cls = ['map-state'];
        if (sa) cls.push('is-target'); else cls.push('is-other');
        if (sa && state.filters.state === sa) cls.push('is-active');
        return cls.join(' ');
      })
      .attr('fill', d => {
        const sa = FIPS_TO_STATE[d.id];
        if (!sa) return '#F4F2EC';
        return color(byState[sa].count);
      })
      .on('mousemove', function(event, d) {
        const sa = FIPS_TO_STATE[d.id];
        if (!sa) { tooltip.classList.remove('is-visible'); return; }
        const s = byState[sa];
        const rect = wrap.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        tooltip.style.left = Math.min(x + 14, rect.width - 240) + 'px';
        tooltip.style.top = Math.max(y - 10, 0) + 'px';
        tooltip.classList.add('is-visible');
        tooltip.innerHTML = `
          <div class="map-tooltip__title">${STATE_NAMES[sa]}</div>
          <div class="map-tooltip__row"><span>Firms tracked</span><span>${s.count}</span></div>
          <div class="map-tooltip__row"><span>Est. annual filings</span><span>${fmtNum(s.filings)}</span></div>
          <div class="map-tooltip__firms">
            <div style="margin-bottom:2px;color:#FAFAF7;font-weight:600;">Top by est. revenue</div>
            ${s.topFirms.map(f => `<div class="map-tooltip__firm">${escapeHtml(f.firm_name)} · ${fmtUSD(f.est_revenue_mid)}</div>`).join('')}
          </div>
        `;
      })
      .on('mouseleave', () => tooltip.classList.remove('is-visible'))
      .on('click', function(event, d) {
        const sa = FIPS_TO_STATE[d.id];
        if (!sa) return;
        // toggle: if already active, return to all
        const next = state.filters.state === sa ? 'ALL' : sa;
        setStateFilter(next);
      });

  // legend annotation - state labels
  states.forEach(d => {
    const sa = FIPS_TO_STATE[d.id];
    if (!sa) return;
    const c = path.centroid(d);
    if (!c || isNaN(c[0])) return;
    svg.append('text')
      .attr('x', c[0])
      .attr('y', c[1])
      .attr('text-anchor', 'middle')
      .attr('dy', '0.32em')
      .attr('fill', '#FAFAF7')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .attr('pointer-events', 'none')
      .text(`${sa} · ${byState[sa].count}`);
  });

  // legend bar
  const legend = document.getElementById('map-legend');
  legend.innerHTML = `
    <span>Firms tracked</span>
    <span>${d3.min(counts)}</span>
    <div class="map-legend__bar"></div>
    <span>${d3.max(counts)}</span>
  `;
}

// ===== ASSUMPTIONS =====
function renderAssumptions() {
  const audit = DATA.audit.assumptions;
  const summary = {
    supported: audit.filter(a => a.verdict === 'supported').length,
    overstated: audit.filter(a => a.verdict === 'overstated').length,
    understated: audit.filter(a => a.verdict === 'understated').length,
    unverifiable: audit.filter(a => a.verdict === 'unverifiable').length,
  };
  document.getElementById('audit-summary').innerHTML = `
    <div class="audit-summary__cell"><div class="audit-summary__count" style="color:var(--olive)">${summary.supported}</div><div class="audit-summary__label">Supported — pass-through to plan</div></div>
    <div class="audit-summary__cell"><div class="audit-summary__count" style="color:var(--amber)">${summary.overstated}</div><div class="audit-summary__label">Overstated — revise downward</div></div>
    <div class="audit-summary__cell"><div class="audit-summary__count" style="color:var(--terra)">${summary.understated}</div><div class="audit-summary__label">Understated — revise upward</div></div>
    <div class="audit-summary__cell"><div class="audit-summary__count" style="color:var(--text-2)">${summary.unverifiable}</div><div class="audit-summary__label">Unverifiable — flag for monitoring</div></div>
  `;

  const cats = ['market_size', 'unit_economics', 'conversion', 'compliance', 'financial'];
  const catLabels = {
    market_size: 'Market size',
    unit_economics: 'Unit economics',
    conversion: 'Conversion & acquisition',
    compliance: 'Compliance & regulatory',
    financial: 'Financial model',
  };

  const container = document.getElementById('audit-table');
  let html = '';

  cats.forEach(cat => {
    const rows = audit.filter(a => a.category === cat);
    if (!rows.length) return;
    html += `<div class="audit-cat-header">${catLabels[cat]} · ${rows.length}</div>`;
    rows.forEach(a => {
      const open = state.openAssumptions.has(a.id);
      const verdictClass = `badge--${a.verdict}`;
      html += `
        <div class="audit-row" data-aid="${a.id}">
          <div class="audit-row__claim">${escapeHtml(a.claim_in_plan)}</div>
          <div class="audit-row__cat">${escapeHtml(catLabels[a.category])}</div>
          <div><span class="badge ${verdictClass}">${escapeHtml(a.verdict)}</span></div>
          <div class="audit-row__midline midline-cell">${escapeHtml(truncate(a.midline_estimate, 180))}</div>
          <div class="audit-row__impact">${escapeHtml(truncate(a.impact_if_wrong, 140))}</div>
          ${open ? `
            <div class="audit-detail">
              <div class="audit-detail__section">
                <div class="audit-detail__section-title">Midline estimate</div>
                <div>${escapeHtml(a.midline_estimate)}</div>
              </div>
              <div class="audit-detail__section">
                <div class="audit-detail__section-title">Justification</div>
                <div>${escapeHtml(a.justification)}</div>
              </div>
              <div class="audit-detail__section">
                <div class="audit-detail__section-title">Impact if wrong</div>
                <div>${escapeHtml(a.impact_if_wrong)}</div>
              </div>
              <div class="audit-detail__section">
                <div class="audit-detail__section-title">Evidence (${a.evidence.length})</div>
                <div class="audit-detail__evidence">
                  ${a.evidence.map(ev => `
                    <div class="audit-detail__evidence-row">
                      <div>${ev.url ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener">${escapeHtml(ev.source)}</a>` : escapeHtml(ev.source)}</div>
                      <div style="color:var(--text-2);">${escapeHtml(ev.data_point || '')}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    });
  });
  container.innerHTML = html;

  container.querySelectorAll('.audit-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.aid;
      if (state.openAssumptions.has(id)) state.openAssumptions.delete(id);
      else state.openAssumptions.add(id);
      renderAssumptions();
    });
  });
}

// ===== COMPETITIVE =====
function renderCompetitors() {
  const comps = selectedCompetitors();
  const stateLabel = state.filters.state === 'ALL' ? 'all 4 target states' : STATE_NAMES[state.filters.state];

  document.getElementById('competitive-lede').textContent =
    `${comps.length} firms tracked across ${stateLabel}. Counts and revenue update with the state filter; court-district filter narrows the table.`;

  // KPI cards
  const highCount = comps.filter(c => c.threat_level === 'High').length;
  const totalRev = d3.sum(comps, c => c.est_revenue_mid || 0);
  const withAttys = comps.filter(c => c.attorney_count_est != null);
  const avgAttys = withAttys.length ? d3.mean(withAttys, c => c.attorney_count_est) : 0;

  const kpis = [
    { label: 'Firms tracked', value: comps.length.toString(), delta: state.filters.state === 'ALL' ? 'Across CA · FL · WA · NY' : STATE_NAMES[state.filters.state], baseline: '', tone: 'neutral' },
    { label: 'High threat', value: highCount.toString(), delta: `${(highCount / Math.max(comps.length, 1) * 100).toFixed(0)}% of tracked`, baseline: '', tone: highCount >= 3 ? 'warn' : 'neutral' },
    { label: 'Combined est. revenue', value: fmtUSD(totalRev, { precise: true }), delta: 'Midline of public estimates', baseline: '', tone: 'neutral' },
    { label: 'Avg attorneys / firm', value: avgAttys.toFixed(1), delta: `Sample n=${withAttys.length}`, baseline: '', tone: 'neutral' },
  ];

  document.getElementById('competitive-kpis').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi__label">${escapeHtml(k.label)}</div>
      <div class="kpi__value">${escapeHtml(k.value)}</div>
      <div class="kpi__delta kpi__delta--${k.tone}">${escapeHtml(k.delta)}</div>
    </div>
  `).join('');

  // Populate court districts dropdown
  const sel = document.getElementById('court-district-select');
  const districts = new Set();
  comps.forEach(c => parseCourtDistricts(c.active_court_districts).forEach(d => districts.add(d)));
  const sortedDistricts = [...districts].sort();
  const currentVal = state.filters.courtDistrict;
  sel.innerHTML = `<option value="ALL">All districts</option>` +
    sortedDistricts.map(d => `<option value="${escapeHtml(d)}" ${d === currentVal ? 'selected' : ''}>${escapeHtml(truncate(d, 80))}</option>`).join('');
  if (currentVal !== 'ALL' && !sortedDistricts.includes(currentVal)) {
    state.filters.courtDistrict = 'ALL';
    sel.value = 'ALL';
  }

  renderTopRevenueChart();
  renderThreatStackedChart();
  renderCompetitorTable();
}

function renderTopRevenueChart() {
  const wrap = document.getElementById('top-revenue-chart');
  wrap.innerHTML = '';
  const comps = selectedCompetitors()
    .filter(c => c.est_revenue_mid != null && c.est_revenue_mid > 0)
    .sort((a, b) => b.est_revenue_mid - a.est_revenue_mid)
    .slice(0, 15);

  document.getElementById('top-revenue-sub').textContent =
    `${comps.length} firms shown. State: ${state.filters.state === 'ALL' ? 'all four' : STATE_NAMES[state.filters.state]}.`;

  if (!comps.length) {
    wrap.innerHTML = '<div style="padding:24px;font-size:13px;color:var(--text-muted)">No revenue estimates available.</div>';
    return;
  }

  const width = wrap.clientWidth || 600;
  const rowHeight = 22;
  const height = comps.length * rowHeight + 40;
  const margin = { top: 8, right: 60, bottom: 24, left: 200 };

  const svg = d3.select(wrap)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const x = d3.scaleLinear()
    .domain([0, d3.max(comps, c => c.est_revenue_mid)])
    .range([0, width - margin.left - margin.right])
    .nice();

  const y = d3.scaleBand()
    .domain(comps.map(c => c.firm_name))
    .range([0, height - margin.top - margin.bottom])
    .padding(0.25);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // gridlines
  g.append('g').attr('class', 'chart-grid')
    .selectAll('line')
    .data(x.ticks(5))
    .join('line')
      .attr('x1', d => x(d))
      .attr('x2', d => x(d))
      .attr('y1', 0)
      .attr('y2', height - margin.top - margin.bottom);

  // bars
  g.selectAll('.chart-bar')
    .data(comps)
    .join('rect')
      .attr('class', 'chart-bar')
      .attr('x', 0)
      .attr('y', d => y(d.firm_name))
      .attr('width', d => x(d.est_revenue_mid))
      .attr('height', y.bandwidth())
      .attr('rx', 2)
      .attr('fill', d => {
        if (d.threat_level === 'High') return '#9C4221';
        if (d.threat_level === 'Medium') return '#0F4C5C';
        return '#9A968D';
      });

  // labels right
  g.selectAll('.bar-label')
    .data(comps)
    .join('text')
      .attr('class', 'bar-label chart-label-num')
      .attr('x', d => x(d.est_revenue_mid) + 6)
      .attr('y', d => y(d.firm_name) + y.bandwidth() / 2)
      .attr('dy', '0.34em')
      .text(d => fmtUSD(d.est_revenue_mid));

  // firm names left
  g.selectAll('.firm-name')
    .data(comps)
    .join('text')
      .attr('x', -8)
      .attr('y', d => y(d.firm_name) + y.bandwidth() / 2)
      .attr('dy', '0.34em')
      .attr('text-anchor', 'end')
      .attr('fill', '#1A1812')
      .attr('font-size', 11.5)
      .text(d => truncate(d.firm_name, 30));

  // axis
  const axis = d3.axisBottom(x).ticks(5).tickFormat(d => fmtUSD(d));
  const axisG = g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${height - margin.top - margin.bottom})`)
    .call(axis);
  axisG.select('.domain').remove();
}

function renderThreatStackedChart() {
  const wrap = document.getElementById('threat-stacked-chart');
  wrap.innerHTML = '';

  const stateScope = state.filters.state === 'ALL' ? TARGET_STATES : [state.filters.state];

  const data = stateScope.map(s => {
    const comps = DATA.competitors.filter(c => c.target_state === s);
    return {
      state: s,
      High: comps.filter(c => c.threat_level === 'High').length,
      Medium: comps.filter(c => c.threat_level === 'Medium').length,
      Low: comps.filter(c => c.threat_level === 'Low').length,
      total: comps.length,
    };
  });

  const width = wrap.clientWidth || 480;
  const height = 320;
  const margin = { top: 10, right: 80, bottom: 30, left: 36 };

  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const x = d3.scaleBand()
    .domain(data.map(d => d.state))
    .range([0, width - margin.left - margin.right])
    .padding(0.35);

  const maxY = d3.max(data, d => d.total);
  const y = d3.scaleLinear()
    .domain([0, maxY])
    .range([height - margin.top - margin.bottom, 0])
    .nice();

  const colors = { High: '#9C4221', Medium: '#B45309', Low: '#6B6863' };
  const stackOrder = ['Low', 'Medium', 'High'];

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g').attr('class', 'chart-grid')
    .selectAll('line')
    .data(y.ticks(4))
    .join('line')
      .attr('x1', 0).attr('x2', width - margin.left - margin.right)
      .attr('y1', d => y(d)).attr('y2', d => y(d));

  // bars stacked
  data.forEach(row => {
    let cum = 0;
    stackOrder.forEach(level => {
      const v = row[level];
      if (!v) return;
      g.append('rect')
        .attr('class', 'chart-bar')
        .attr('x', x(row.state))
        .attr('y', y(cum + v))
        .attr('width', x.bandwidth())
        .attr('height', y(cum) - y(cum + v))
        .attr('fill', colors[level]);
      // label inside if tall enough
      const segHeight = y(cum) - y(cum + v);
      if (segHeight > 14) {
        g.append('text')
          .attr('x', x(row.state) + x.bandwidth() / 2)
          .attr('y', y(cum + v) + segHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('dy', '0.34em')
          .attr('fill', '#FAFAF7')
          .attr('font-size', 11)
          .attr('font-weight', 600)
          .text(v);
      }
      cum += v;
    });
    // total on top
    g.append('text')
      .attr('x', x(row.state) + x.bandwidth() / 2)
      .attr('y', y(row.total) - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', '#1A1812')
      .attr('font-size', 11.5)
      .attr('font-weight', 600)
      .text(row.total);
  });

  // x axis
  const axisX = d3.axisBottom(x).tickSize(0).tickPadding(8);
  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${height - margin.top - margin.bottom})`)
    .call(axisX)
    .select('.domain').remove();

  // y axis
  const axisY = d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6);
  g.append('g').attr('class', 'chart-axis').call(axisY).select('.domain').remove();

  // legend
  const legend = svg.append('g').attr('transform', `translate(${width - margin.right + 8},${margin.top + 4})`);
  stackOrder.slice().reverse().forEach((level, i) => {
    legend.append('rect').attr('x', 0).attr('y', i * 22).attr('width', 12).attr('height', 12).attr('fill', colors[level]).attr('rx', 2);
    legend.append('text').attr('x', 18).attr('y', i * 22 + 9).attr('font-size', 11.5).attr('fill', '#1A1812').text(level);
  });
}

function renderCompetitorTable() {
  const arr = filteredCompetitorsForTable();
  const tbody = document.getElementById('competitor-tbody');

  const yesIcon = '<span class="icon-yes" title="Yes">✓</span>';
  const noIcon = '<span class="icon-no" title="No or unknown">·</span>';
  const partialIcon = '<span class="icon-partial" title="Partial">~</span>';
  const iconFor = v => v === 'yes' ? yesIcon : v === 'partial' ? partialIcon : noIcon;

  tbody.innerHTML = arr.map((c, i) => `
    <tr data-idx="${DATA.competitors.indexOf(c)}">
      <td>
        <div class="firm-name">${escapeHtml(truncate(c.firm_name, 50))}</div>
        <div class="firm-sub">${escapeHtml(truncate(c.primary_practice_focus || '', 70))}</div>
      </td>
      <td>${escapeHtml(c.target_state)}</td>
      <td class="city-cell">${escapeHtml(truncate(c.hq_city || '—', 26))}</td>
      <td class="num">${c.attorney_count_est == null ? '—' : c.attorney_count_est}</td>
      <td class="num">${c.est_revenue_mid == null ? '—' : fmtUSD(c.est_revenue_mid)}</td>
      <td class="fee-cell">${escapeHtml(truncate(c.fee_structure || '—', 90))}</td>
      <td class="center">${iconFor(c.takes_counterclaims_norm)}</td>
      <td class="center">${iconFor(c.spanish_norm)}</td>
      <td class="center">${iconFor(c.google_ads_norm)}</td>
      <td><span class="threat-badge threat-badge--${(c.threat_level || 'unknown').toLowerCase()}">${escapeHtml(c.threat_level || 'Unknown')}</span></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = +tr.dataset.idx;
      openDrawer(DATA.competitors[idx]);
    });
  });

  document.getElementById('competitor-table-foot').textContent =
    `${arr.length} of ${selectedCompetitors().length} firms shown.` +
    (state.filters.courtDistrict !== 'ALL' ? ` Court district: ${truncate(state.filters.courtDistrict, 80)}.` : '') +
    (state.filters.competitorFilters.size ? ` Active filters: ${[...state.filters.competitorFilters].join(', ')}.` : '');

  // header sort indicators
  document.querySelectorAll('#competitor-table thead th').forEach(th => {
    th.removeAttribute('aria-sort');
    if (th.dataset.sort === state.filters.competitorSort.col) {
      th.setAttribute('aria-sort', state.filters.competitorSort.dir);
    }
  });
}

// ===== Drawer =====
function openDrawer(c) {
  const sources = parseSources(c.sources);
  const content = document.getElementById('drawer-content');

  const field = (label, value) => value && value !== 'unknown'
    ? `<div class="drawer__field"><div class="drawer__field-label">${escapeHtml(label)}</div><div class="drawer__field-value">${escapeHtml(value)}</div></div>`
    : '';

  content.innerHTML = `
    <h2 class="drawer__title">${escapeHtml(c.firm_name)}</h2>
    <p class="drawer__sub">
      ${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener">${escapeHtml(c.website.replace(/^https?:\/\//, ''))}</a> · ` : ''}
      ${escapeHtml(c.hq_city || '—')} · ${escapeHtml(c.target_state)} target
    </p>
    <div class="drawer__meta-grid">
      <div><div class="drawer__meta-label">Threat</div><div class="drawer__meta-value"><span class="threat-badge threat-badge--${(c.threat_level || 'unknown').toLowerCase()}">${escapeHtml(c.threat_level || 'Unknown')}</span></div></div>
      <div><div class="drawer__meta-label">Est. revenue</div><div class="drawer__meta-value">${c.est_revenue_mid ? fmtUSD(c.est_revenue_mid) : (c.estimated_annual_revenue_usd || '—')}</div></div>
      <div><div class="drawer__meta-label">Founded</div><div class="drawer__meta-value">${escapeHtml(c.founded_year || '—')}</div></div>
      <div><div class="drawer__meta-label">Attorneys</div><div class="drawer__meta-value">${escapeHtml(c.attorney_headcount || '—')}</div></div>
      <div><div class="drawer__meta-label">Counterclaims</div><div class="drawer__meta-value">${escapeHtml(c.takes_counterclaims || '—')}</div></div>
      <div><div class="drawer__meta-label">Spanish</div><div class="drawer__meta-value">${escapeHtml(c.spanish_language_service || '—')}</div></div>
    </div>

    ${field('Primary practice focus', c.primary_practice_focus)}
    ${field('Debt-defense share of practice', c.debt_defense_share_of_practice)}
    ${field('Fee structure', c.fee_structure)}
    ${field('Active court districts', c.active_court_districts)}
    ${field('Google Ads presence', c.google_ads_presence)}
    ${field('Key attorneys / partners', c.key_attorneys_or_partners)}
    ${field('Notable results / press', c.notable_results_or_press)}
    ${field('Competitive strengths', c.competitive_strengths)}
    ${field('Competitive weaknesses', c.competitive_weaknesses)}

    ${sources.length ? `
      <div class="drawer__field">
        <div class="drawer__field-label">Sources (${sources.length})</div>
        <div class="drawer__sources">
          ${sources.map(s => `<div class="drawer__source"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a></div>`).join('')}
        </div>
      </div>` : ''}
  `;

  document.getElementById('competitor-drawer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  document.getElementById('competitor-drawer').hidden = true;
  document.body.style.overflow = '';
}

// ===== CASE LAW =====
function renderCaseLaw() {
  const tabs = document.querySelectorAll('#caselaw-tabs .chip');
  tabs.forEach(t => t.classList.toggle('is-active', t.dataset.clState === state.filters.caseLawState));

  const stateAbbr = state.filters.caseLawState;
  const stateCases = DATA.caseLawFlat.filter(c => c.state === stateAbbr);
  const byDoctrine = {};
  stateCases.forEach(c => {
    if (!byDoctrine[c.doctrine]) byDoctrine[c.doctrine] = { label: c.doctrine_label, cases: [] };
    byDoctrine[c.doctrine].cases.push(c);
  });

  const doctrineOrder = ['standing', 'chain_of_title', 'hearsay_business_records', 'pleading_requirements', 'sol', 'fdcpa_leverage', 'state_counterclaim', 'default_vacatur', 'fee_shifting'];

  const container = document.getElementById('caselaw-doctrines');
  container.innerHTML = doctrineOrder.map(doc => {
    const d = byDoctrine[doc];
    const label = d ? d.label : (doc.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
    const cases = d ? d.cases : [];
    const isOpen = state.openDoctrines.has(doc);
    return `
      <div class="caselaw-doctrine ${isOpen ? 'is-open' : ''}" data-doc="${doc}">
        <div class="caselaw-doctrine__head">
          <div>
            <div class="caselaw-doctrine__title">${escapeHtml(label)}</div>
            <div class="caselaw-doctrine__desc">${escapeHtml(DOCTRINE_DESCRIPTIONS[doc] || '')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="caselaw-doctrine__count">${cases.length} ${cases.length === 1 ? 'case' : 'cases'}</span>
            <span class="caselaw-doctrine__caret">›</span>
          </div>
        </div>
        <div class="caselaw-doctrine__body">
          ${cases.length ? `
            <table class="case-table">
              <thead>
                <tr>
                  <th style="width:22%">Case Name</th>
                  <th style="width:18%">Citation</th>
                  <th style="width:6%">Year</th>
                  <th style="width:14%">Court</th>
                  <th>Holding for Defense</th>
                  <th>Practical Takeaway</th>
                </tr>
              </thead>
              <tbody>
                ${cases.map(cs => `
                  <tr>
                    <td><div class="case-name">${cs.url ? `<a href="${escapeHtml(cs.url)}" target="_blank" rel="noopener">${escapeHtml(cs.case_name)}</a>` : escapeHtml(cs.case_name)}</div></td>
                    <td class="case-meta">${escapeHtml(cs.citation)}</td>
                    <td class="case-meta">${cs.year || '—'}</td>
                    <td class="case-meta">${escapeHtml(cs.court || '—')}</td>
                    <td>${escapeHtml(cs.holding_for_defense)}</td>
                    <td class="case-takeaway">${escapeHtml(cs.practical_takeaway)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `<div style="padding:12px 0;font-size:13px;color:var(--text-muted);">No cases catalogued for this doctrine in ${STATE_NAMES[stateAbbr]}.</div>`}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.caselaw-doctrine__head').forEach(head => {
    head.addEventListener('click', () => {
      const doc = head.parentElement.dataset.doc;
      if (state.openDoctrines.has(doc)) state.openDoctrines.delete(doc);
      else state.openDoctrines.add(doc);
      renderCaseLaw();
    });
  });
}

// ===== PROJECTIONS =====
function renderProjections() {
  renderScenarioChart();
  renderQuarterlyChart();
  renderBurnChart();
  renderFilingsGrid();
  renderTamFunnel();
  renderRisks();
}

function renderScenarioChart() {
  const wrap = document.getElementById('scenarios-chart');
  wrap.innerHTML = '';
  const sc = DATA.projections.scenarios;
  const data = [
    { key: 'bear', label: 'Bear', value: sc.bear.year1_revenue, sub: 'Slow ramp, low conv.' },
    { key: 'midline', label: 'Midline', value: sc.midline.year1_revenue, sub: 'Audit-recalibrated', highlight: true },
    { key: 'base_plan', label: 'Plan v2.0', value: sc.base_plan.year1_revenue, sub: 'As written' },
    { key: 'bull', label: 'Bull', value: sc.bull.year1_revenue, sub: 'Best-execution' },
  ];

  const width = wrap.clientWidth || 480;
  const height = 320;
  const margin = { top: 10, right: 16, bottom: 50, left: 56 };

  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const x = d3.scaleBand().domain(data.map(d => d.label)).range([0, width - margin.left - margin.right]).padding(0.35);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.value)]).range([height - margin.top - margin.bottom, 0]).nice();

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g').attr('class', 'chart-grid').selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', 0).attr('x2', width - margin.left - margin.right).attr('y1', d => y(d)).attr('y2', d => y(d));

  g.selectAll('.chart-bar').data(data).join('rect')
    .attr('class', 'chart-bar')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', d => y(0) - y(d.value))
    .attr('rx', 2)
    .attr('fill', d => d.highlight ? '#0F4C5C' : d.key === 'base_plan' ? '#B45309' : '#9A968D');

  g.selectAll('.bar-value').data(data).join('text')
    .attr('class', 'bar-label chart-label-num')
    .attr('x', d => x(d.label) + x.bandwidth() / 2)
    .attr('y', d => y(d.value) - 6)
    .attr('text-anchor', 'middle')
    .text(d => fmtUSD(d.value, { precise: true }));

  g.selectAll('.bar-sub').data(data).join('text')
    .attr('x', d => x(d.label) + x.bandwidth() / 2)
    .attr('y', height - margin.top - margin.bottom + 28)
    .attr('text-anchor', 'middle')
    .attr('font-size', 10.5)
    .attr('fill', '#9A968D')
    .text(d => d.sub);

  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${height - margin.top - margin.bottom})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(6))
    .select('.domain').remove();

  g.append('g').attr('class', 'chart-axis')
    .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat(d => fmtUSD(d)))
    .select('.domain').remove();
}

function renderQuarterlyChart() {
  const wrap = document.getElementById('quarterly-chart');
  wrap.innerHTML = '';
  const data = DATA.projections.year1_build_midline;

  const width = wrap.clientWidth || 480;
  const height = 320;
  const margin = { top: 10, right: 56, bottom: 50, left: 50 };

  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const x = d3.scaleBand().domain(data.map(d => d.quarter)).range([0, width - margin.left - margin.right]).padding(0.3);
  const xInner = d3.scaleBand().domain(['plan', 'midline']).range([0, x.bandwidth()]).padding(0.18);

  const yFiles = d3.scaleLinear().domain([0, d3.max(data, d => d.new_files_plan)]).range([height - margin.top - margin.bottom, 0]).nice();
  const yRev = d3.scaleLinear().domain([0, d3.max(data, d => d.revenue_plan)]).range([height - margin.top - margin.bottom, 0]).nice();

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g').attr('class', 'chart-grid').selectAll('line').data(yFiles.ticks(5)).join('line')
    .attr('x1', 0).attr('x2', width - margin.left - margin.right).attr('y1', d => yFiles(d)).attr('y2', d => yFiles(d));

  data.forEach(d => {
    g.append('rect')
      .attr('class', 'chart-bar')
      .attr('x', x(d.quarter) + xInner('plan'))
      .attr('y', yFiles(d.new_files_plan))
      .attr('width', xInner.bandwidth())
      .attr('height', yFiles(0) - yFiles(d.new_files_plan))
      .attr('fill', '#D4D1C5')
      .attr('rx', 2);
    g.append('rect')
      .attr('class', 'chart-bar')
      .attr('x', x(d.quarter) + xInner('midline'))
      .attr('y', yFiles(d.new_files_midline))
      .attr('width', xInner.bandwidth())
      .attr('height', yFiles(0) - yFiles(d.new_files_midline))
      .attr('fill', '#0F4C5C')
      .attr('rx', 2);
    g.append('text')
      .attr('x', x(d.quarter) + xInner('plan') + xInner.bandwidth() / 2)
      .attr('y', yFiles(d.new_files_plan) - 4)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#6B6863')
      .text(d.new_files_plan);
    g.append('text')
      .attr('x', x(d.quarter) + xInner('midline') + xInner.bandwidth() / 2)
      .attr('y', yFiles(d.new_files_midline) - 4)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', '#0F4C5C').attr('font-weight', 600)
      .text(d.new_files_midline);
  });

  // Revenue lines
  const linePlan = d3.line().x(d => x(d.quarter) + x.bandwidth() / 2).y(d => yRev(d.revenue_plan));
  const lineMid = d3.line().x(d => x(d.quarter) + x.bandwidth() / 2).y(d => yRev(d.revenue_midline));

  g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#B45309').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3').attr('d', linePlan);
  g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#9C4221').attr('stroke-width', 2).attr('d', lineMid);
  data.forEach(d => {
    g.append('circle').attr('cx', x(d.quarter) + x.bandwidth() / 2).attr('cy', yRev(d.revenue_midline)).attr('r', 3.5).attr('fill', '#9C4221');
  });

  // x axis
  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${height - margin.top - margin.bottom})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(6))
    .select('.domain').remove();

  // y left
  g.append('g').attr('class', 'chart-axis')
    .call(d3.axisLeft(yFiles).ticks(5).tickSize(0).tickPadding(6))
    .select('.domain').remove();
  svg.append('text').attr('x', 4).attr('y', margin.top + 8).attr('font-size', 10).attr('fill', '#9A968D').text('New files');

  // y right
  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(${width - margin.left - margin.right},0)`)
    .call(d3.axisRight(yRev).ticks(5).tickSize(0).tickPadding(6).tickFormat(d => fmtUSD(d)))
    .select('.domain').remove();
  svg.append('text').attr('x', width - margin.right + 4).attr('y', margin.top + 8).attr('font-size', 10).attr('fill', '#9A968D').text('Revenue');

  // legend
  const legend = svg.append('g').attr('transform', `translate(${margin.left},${height - 24})`);
  const items = [
    { label: 'Plan new files', color: '#D4D1C5', type: 'bar' },
    { label: 'Midline new files', color: '#0F4C5C', type: 'bar' },
    { label: 'Plan revenue', color: '#B45309', type: 'line-dash' },
    { label: 'Midline revenue', color: '#9C4221', type: 'line' },
  ];
  let off = 0;
  items.forEach(it => {
    if (it.type === 'bar') {
      legend.append('rect').attr('x', off).attr('y', -8).attr('width', 12).attr('height', 12).attr('fill', it.color).attr('rx', 2);
    } else {
      legend.append('line').attr('x1', off).attr('x2', off + 14).attr('y1', -2).attr('y2', -2).attr('stroke', it.color).attr('stroke-width', 2).attr('stroke-dasharray', it.type === 'line-dash' ? '4 3' : null);
    }
    legend.append('text').attr('x', off + 18).attr('y', 2).attr('font-size', 10.5).attr('fill', '#1A1812').text(it.label);
    off += 18 + (it.label.length * 5.5) + 14;
  });
}

function renderBurnChart() {
  const wrap = document.getElementById('burn-chart');
  wrap.innerHTML = '';
  const items = DATA.projections.monthly_burn.components
    .slice()
    .sort((a, b) => b.midline - a.midline);

  const width = wrap.clientWidth || 900;
  const rowHeight = 28;
  const height = items.length * rowHeight + 70;
  const margin = { top: 14, right: 90, bottom: 50, left: 220 };

  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const x = d3.scaleLinear()
    .domain([0, d3.max(items, d => Math.max(d.plan, d.midline))])
    .range([0, width - margin.left - margin.right])
    .nice();

  const y = d3.scaleBand().domain(items.map(d => d.category)).range([0, items.length * rowHeight]).padding(0.25);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g').attr('class', 'chart-grid').selectAll('line').data(x.ticks(5)).join('line')
    .attr('x1', d => x(d)).attr('x2', d => x(d)).attr('y1', 0).attr('y2', items.length * rowHeight);

  items.forEach(d => {
    const yPos = y(d.category);
    const halfH = y.bandwidth() / 2 - 1;
    g.append('rect').attr('x', 0).attr('y', yPos).attr('width', x(d.plan)).attr('height', halfH).attr('fill', '#D4D1C5').attr('rx', 1);
    g.append('rect').attr('x', 0).attr('y', yPos + halfH + 2).attr('width', x(d.midline)).attr('height', halfH).attr('fill', d.midline > d.plan * 1.05 ? '#9C4221' : '#0F4C5C').attr('rx', 1);
    g.append('text').attr('x', -8).attr('y', yPos + y.bandwidth() / 2).attr('dy', '0.34em').attr('text-anchor', 'end').attr('font-size', 11.5).attr('fill', '#1A1812').text(d.category);

    g.append('text').attr('x', x(d.plan) + 6).attr('y', yPos + halfH - 2).attr('font-size', 10).attr('fill', '#6B6863').text(fmtUSD(d.plan));
    g.append('text').attr('x', x(d.midline) + 6).attr('y', yPos + halfH * 2 + 4).attr('font-size', 10).attr('fill', d.midline > d.plan * 1.05 ? '#9C4221' : '#0F4C5C').attr('font-weight', 600).text(fmtUSD(d.midline));
  });

  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${items.length * rowHeight + 4})`)
    .call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(6).tickFormat(d => fmtUSD(d)))
    .select('.domain').remove();

  // legend
  const legend = svg.append('g').attr('transform', `translate(${margin.left},${height - 12})`);
  legend.append('rect').attr('width', 12).attr('height', 8).attr('fill', '#D4D1C5').attr('y', -6);
  legend.append('text').attr('x', 18).attr('y', 2).attr('font-size', 11).attr('fill', '#1A1812').text('Plan v2.0');
  legend.append('rect').attr('x', 88).attr('width', 12).attr('height', 8).attr('fill', '#0F4C5C').attr('y', -6);
  legend.append('text').attr('x', 106).attr('y', 2).attr('font-size', 11).attr('fill', '#1A1812').text('Midline (in-line)');
  legend.append('rect').attr('x', 218).attr('width', 12).attr('height', 8).attr('fill', '#9C4221').attr('y', -6);
  legend.append('text').attr('x', 236).attr('y', 2).attr('font-size', 11).attr('fill', '#1A1812').text('Midline (revised up)');
}

function renderFilingsGrid() {
  const fv = DATA.projections.filing_volumes_by_state;
  const dj = DATA.projections.default_judgment_rates;
  const djMap = {
    CA: { rate: dj.CA_no_answer_rate, label: 'no-answer rate' },
    FL: { rate: dj.FL_default_rate, label: 'default rate' },
    WA: { rate: dj.WA_default_rate, label: 'default rate' },
    NY: { rate: dj.NY_default_rate_post_ccfa, label: 'post-CCFA default' },
  };
  const grid = document.getElementById('filings-grid');
  grid.innerHTML = TARGET_STATES.map(s => `
    <div class="filing-stat">
      <div class="filing-stat__state">${STATE_NAMES[s]} · ${s}</div>
      <div class="filing-stat__value">${fmtNum(fv[s].estimated_annual_filings)}</div>
      <div class="filing-stat__sub">consumer-debt collection filings / year</div>
      <div class="filing-stat__default">Default judgment: <strong>${djMap[s].rate}%</strong> · ${djMap[s].label}</div>
    </div>
  `).join('');
}

function renderTamFunnel() {
  const wrap = document.getElementById('tam-funnel');
  wrap.innerHTML = '';
  const t = DATA.projections.tam_serviceable;
  const stages = [
    { label: 'Total annual filings', value: t.total_annual_filings_4_states, sub: 'CA · FL · WA · NY combined' },
    { label: 'Default-eligible (70%)', value: Math.round(t.total_annual_filings_4_states * t.default_eligible_share_estimate), sub: 'Defendants who do not answer without counsel' },
    { label: 'Served & contactable', value: t.served_defendants_potentially_contactable, sub: 'Reachable via docket-driven mail/SMS' },
    { label: 'Serviceable @ 3% capture', value: t.serviceable_at_3pct_capture, sub: 'Bull case ceiling' },
    { label: 'Year 1 midline target', value: t.midline_year1_capture_target, sub: `${(t.target_share_of_serviceable_year1 * 100).toFixed(2)}% of serviceable` },
  ];

  const width = wrap.clientWidth || 480;
  const stageH = 70;
  const barH = 26;
  const height = stages.length * stageH + 12;
  const margin = { top: 8, right: 16, bottom: 8, left: 16 };

  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${width} ${height + margin.top + margin.bottom}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const maxV = stages[0].value;
  // Use log-ish scale so small stages remain visible — sqrt works well for funnels with wide ranges
  const innerW = width - margin.left - margin.right;
  const minBarW = 90;
  const xLin = d3.scaleSqrt().domain([0, maxV]).range([0, innerW]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  // Deep palette for crisp white-text contrast (WCAG AAA on every bar)
  const colors = ['#1F1D19', '#0F0E0C', '#0F4C5C', '#0B2F38', '#5A1F0C'];

  stages.forEach((s, i) => {
    const w = Math.max(xLin(s.value), minBarW);
    const offset = (innerW - w) / 2;
    const yPos = i * stageH;
    g.append('rect').attr('x', offset).attr('y', yPos).attr('width', w).attr('height', barH).attr('rx', 3).attr('fill', colors[i]);
    g.append('text')
      .attr('class', 'funnel-value')
      .attr('x', offset + w / 2).attr('y', yPos + barH / 2).attr('dy', '0.36em')
      .attr('text-anchor', 'middle')
      .attr('fill', '#FFFFFF')
      .style('fill', '#FFFFFF')
      .attr('font-size', 16).attr('font-weight', 800)
      .attr('letter-spacing', '0.04em')
      .style('font-variant-numeric', 'tabular-nums')
      .text(fmtNum(s.value));
    g.append('text').attr('x', innerW / 2).attr('y', yPos + barH + 16).attr('text-anchor', 'middle').attr('fill', '#1A1812').attr('font-size', 11.5).attr('font-weight', 600).text(s.label);
    g.append('text').attr('x', innerW / 2).attr('y', yPos + barH + 32).attr('text-anchor', 'middle').attr('fill', '#9A968D').attr('font-size', 10.5).text(s.sub);
    // arrow between stages
    if (i < stages.length - 1) {
      g.append('path')
        .attr('d', `M${innerW / 2 - 4},${yPos + stageH - 8} L${innerW / 2 + 4},${yPos + stageH - 8} L${innerW / 2},${yPos + stageH - 2} Z`)
        .attr('fill', '#D4D1C5');
    }
  });
}

function renderRisks() {
  const risks = DATA.projections.key_risks_ranked;
  document.getElementById('risks').innerHTML = risks.map(r => `
    <li>
      <div class="risk__rank">${r.rank}</div>
      <div>
        <div class="risk__title">${escapeHtml(r.risk)}</div>
        <div class="risk__mitigant"><strong>Mitigant:</strong> ${escapeHtml(r.mitigant)}</div>
      </div>
      <div class="risk__tags">
        <span class="risk__tag risk__tag--${r.impact.includes('high') ? 'high' : r.impact.includes('medium') ? 'medium' : 'low'}">Impact: ${escapeHtml(r.impact)}</span>
        <span class="risk__tag">Prob: ${escapeHtml(r.probability)}</span>
      </div>
    </li>
  `).join('');
}

// ===== Boot =====
init().catch(err => {
  console.error('Dashboard init failed', err);
  document.body.innerHTML = '<div style="padding:32px;font-family:Inter,sans-serif;color:#9C4221;">Dashboard failed to load: ' + escapeHtml(err.message) + '</div>';
});
