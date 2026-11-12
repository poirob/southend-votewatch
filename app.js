/* =========================================================================
   SOUTHEND COUNCIL VOTEWATCH — CORE APPLICATION ENGINE (app.js)
   Includes:
   1. Over-the-Air (OTA) Version Sync & PWA Standalone Handler
   2. 4-Part Journalistic "Division Briefing" Renderer
   3. Coalition Stress Tracker, Whip Rebel Detector & Dyad Matrix
   4. StratMap Ward Vulnerability & Doorstep Briefing Exporter
   5. Minute-to-JSON Parser + Automated Web-Search Briefing Generator
   ========================================================================= */

const STORAGE_KEY_MOTIONS = "southend_votewatch_motions_v2";
const STORAGE_KEY_VERSION = "southend_votewatch_version_v2";
const STORAGE_KEY_API = "southend_votewatch_gemini_key";

let councillors = [];
let motions = [];
let cllrMap = {};
let selectedCllrId = "cllr-daniel-cowan";
let lastParsedMotionObj = null;
let lastPreAnalysisText = "";
let manualTokenOverrides = {};
let deferredInstallPrompt = null;

const PARTY_META = {
  "Labour Group": { short: "LAB", cls: "bg-lab", color: "#e4003b" },
  "Conservative Group": { short: "CON", cls: "bg-con", color: "#0087dc" },
  "Reform UK Group": { short: "REF", cls: "bg-ref", color: "#12b6cf" },
  "Liberal Democrat Group": { short: "LD", cls: "bg-ld", color: "#faa61a" },
  "Green Group": { short: "GRN", cls: "bg-grn", color: "#00b140" },
  "Rochford & Southend East Independents Group": { short: "RSE IND", cls: "bg-ind", color: "#8b5cf6" },
  "Not Aligned": { short: "IND", cls: "bg-non", color: "#64748b" }
};

/* =========================================================================
   1. INITIALIZATION, OTA DATA SYNC & PWA INSTALL HANDLER
   ========================================================================= */
function initApp() {
  setupPWA();

  councillors = [...(window.INITIAL_COUNCILLORS || [])];
  councillors.forEach(c => { cllrMap[c.id] = c; });

  // Smart Over-the-Air (OTA) Data Merge:
  // Always pulls latest official motions/briefings from data.js while keeping any custom locally parsed votes
  const savedMotionsRaw = localStorage.getItem(STORAGE_KEY_MOTIONS);
  const savedVersion = localStorage.getItem(STORAGE_KEY_VERSION);
  const officialMotions = [...(window.INITIAL_MOTIONS || [])];

  if (savedMotionsRaw) {
    try {
      const localList = JSON.parse(savedMotionsRaw);
      const officialIds = new Set(officialMotions.map(m => m.id));
      const customLocalOnly = localList.filter(m => !officialIds.has(m.id));
      motions = [...customLocalOnly, ...officialMotions];
    } catch (e) {
      motions = officialMotions;
    }
  } else {
    motions = officialMotions;
  }

  localStorage.setItem(STORAGE_KEY_MOTIONS, JSON.stringify(motions));
  localStorage.setItem(STORAGE_KEY_VERSION, window.APP_DATA_VERSION || "1.0");

  // Restore optional Gemini API key for automated web-search briefings
  const savedKey = localStorage.getItem(STORAGE_KEY_API);
  const keyInput = document.getElementById("gemini-api-key");
  if (savedKey && keyInput) keyInput.value = savedKey;

  populateDyadDropdowns();
  populateStratMapWardDropdown();
  refreshAllViews();
}

function setupPWA() {
  // Dynamically generate 192x192 Apple Touch Icon
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 192, 192);
    ctx.fillStyle = "#1e3a8a";
    ctx.fillRect(12, 12, 168, 168);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 72px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VW", 96, 86);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px Inter, sans-serif";
    ctx.fillText("SOUTHEND", 96, 145);
    const iconLink = document.getElementById("apple-touch-icon-link");
    if (iconLink) iconLink.href = canvas.toDataURL("image/png");
  } catch (e) {}

  // Hide 'Use as App' button if already launched from Home Screen
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) {
    const btn = document.getElementById("btn-install-app");
    if (btn) btn.style.display = "none";
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then(reg => {
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            const toast = document.getElementById("update-toast");
            if (toast) toast.classList.add("show");
          }
        });
      });
    }).catch(() => {});
  }
}

function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; });
  } else {
    document.getElementById("install-modal").classList.add("open");
  }
}

function toggleMobileFilters(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("open");
}

function refreshAllViews() {
  updateHeaderStats();
  renderMotions();
  renderCoalitionStressBanner();
  renderDyadComparison();
  renderRebelLeaderboard();
  renderPartyMatrix();
  renderCllrDirectory();
  renderCllrDossier(selectedCllrId);
  renderStratMapCards();
}

function switchTab(lensName, openDetailOnMobile = false) {
  document.querySelectorAll('.lens-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab, .mob-nav-btn').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-lens') === lensName);
  });
  const target = document.getElementById('lens-' + lensName);
  if (target) target.classList.add('active');

  if (lensName === 'dossiers') {
    const wrap = document.getElementById('cllr-master-detail-wrap');
    if (wrap) {
      if (openDetailOnMobile) wrap.classList.add('mobile-detail-active');
      else wrap.classList.remove('mobile-detail-active');
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function selectCouncillorFromList(cllrId) {
  selectedCllrId = cllrId;
  renderCllrDirectory();
  renderCllrDossier(cllrId);
  document.getElementById('cllr-master-detail-wrap').classList.add('mobile-detail-active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeMobileDossier() {
  document.getElementById('cllr-master-detail-wrap').classList.remove('mobile-detail-active');
}

function jumpToCouncillorDossier(cllrId) {
  selectedCllrId = cllrId;
  renderCllrDirectory();
  renderCllrDossier(cllrId);
  switchTab('dossiers', true);
}

/* =========================================================================
   2. ANALYTICAL ENGINE: PARTY WHIP PLURALITY & COALITION SPLITS
   ========================================================================= */
function computePartySplitsForMotion(motion) {
  const groupCounts = {};
  Object.keys(PARTY_META).forEach(g => {
    groupCounts[g] = { for: 0, against: 0, abstain: 0, no_vote: 0, absent: 0, activeTotal: 0, majorityVote: null, isSplit: false };
  });

  for (const [cid, vote] of Object.entries(motion.votes)) {
    const c = cllrMap[cid];
    if (!c) continue;
    const g = groupCounts[c.group];
    if (!g) continue;
    if (g[vote] !== undefined) g[vote]++;
    if (vote === "for" || vote === "against") g.activeTotal++;
  }

  for (const [groupName, stats] of Object.entries(groupCounts)) {
    if (groupName === "Not Aligned") continue;
    if (stats.for > stats.against && stats.for > 0) stats.majorityVote = "for";
    else if (stats.against > stats.for && stats.against > 0) stats.majorityVote = "against";
    else if (stats.for > 0 && stats.for === stats.against) stats.majorityVote = "tied";

    const activeDirections = [stats.for > 0, stats.against > 0, (stats.abstain > 1 && stats.activeTotal > 0)].filter(Boolean).length;
    if (activeDirections > 1 && (stats.for + stats.against) >= 2) stats.isSplit = true;
  }
  return groupCounts;
}

function isRebelVote(cllrId, motion, precomputedSplits = null) {
  const c = cllrMap[cllrId];
  if (!c || c.group === "Not Aligned") return false;
  if (cllrId === "cllr-nigel-folkard" && motion.votes[cllrId] === "abstain") return false;

  const splits = precomputedSplits || computePartySplitsForMotion(motion);
  const gStats = splits[c.group];
  if (!gStats || !gStats.majorityVote || (gStats.for + gStats.against) < 2) return false;

  const v = motion.votes[cllrId];
  if (v !== "for" && v !== "against" && v !== "abstain") return false;
  if (gStats.majorityVote === "tied") return true;
  if ((v === "for" || v === "against") && v !== gStats.majorityVote) return true;
  if (v === "abstain" && gStats.isSplit && (gStats.for + gStats.against >= 4)) return true;
  return false;
}

function updateHeaderStats() {
  const activeCount = councillors.filter(c => c.status !== "former").length;
  document.getElementById("stat-active-seats").textContent = activeCount;
  document.getElementById("stat-total-motions").textContent = motions.length;
  document.getElementById("tab-count-motions").textContent = motions.length;
  document.getElementById("tab-count-cllrs").textContent = councillors.length;

  let totalRebelInstances = 0;
  motions.forEach(m => {
    const splits = computePartySplitsForMotion(m);
    Object.keys(m.votes).forEach(cid => {
      if (isRebelVote(cid, m, splits)) totalRebelInstances++;
    });
  });
  document.getElementById("stat-rebel-count").textContent = totalRebelInstances;
}

/* =========================================================================
   3. LENS 1: VOTE EXPLORER WITH 4-PART JOURNALISTIC BRIEFINGS
   ========================================================================= */
function renderMotions() {
  const search = (document.getElementById("motion-search")?.value || "").trim().toLowerCase();
  const catFilter = document.getElementById("motion-cat-filter")?.value || "ALL";
  const outFilter = document.getElementById("motion-outcome-filter")?.value || "ALL";
  const container = document.getElementById("motions-list-container");
  if (!container) return;

  const filtered = motions.filter(m => {
    if (catFilter !== "ALL" && m.category !== catFilter) return false;
    if (outFilter === "Passed" && m.outcome !== "Passed") return false;
    if (outFilter === "Rejected" && m.outcome !== "Rejected") return false;

    const splits = computePartySplitsForMotion(m);
    const hasRebel = Object.values(splits).some(s => s.isSplit);
    if (outFilter === "REBEL" && !hasRebel) return false;

    if (search) {
      const b = m.briefing || {};
      const hay = `${m.title} ${m.summary} ${b.headline_summary || ""} ${b.core_question || ""} ${b.context_and_stakeholders || ""} ${b.political_calculus || ""} ${b.anatomy_of_split || ""} ${m.meeting_date}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="panel-card" style="text-align:center; padding:2rem; color:var(--text-muted);">No recorded divisions match your filters.</div>`;
    return;
  }

  container.innerHTML = filtered.map((m, idx) => {
    const splits = computePartySplitsForMotion(m);
    const totalSeats = (m.tally.for + m.tally.against + m.tally.abstain + m.tally.no_vote + m.tally.absent) || 51;
    const pFor = ((m.tally.for / totalSeats) * 100).toFixed(1);
    const pAgainst = ((m.tally.against / totalSeats) * 100).toFixed(1);
    const pAbstain = ((m.tally.abstain / totalSeats) * 100).toFixed(1);
    const pNoVote = ((m.tally.no_vote / totalSeats) * 100).toFixed(1);
    const pAbsent = ((m.tally.absent / totalSeats) * 100).toFixed(1);

    const b = m.briefing || {
      headline_summary: m.summary,
      core_question: m.summary,
      context_and_stakeholders: "Recorded division at Southend-on-Sea City Council.",
      political_calculus: "Standard council division under Standing Order 3.44.",
      anatomy_of_split: `Result: ${m.tally.for} For, ${m.tally.against} Against, ${m.tally.abstain} Abstain.`
    };

    const proposerObj = cllrMap[m.proposer];
    const seconderObj = cllrMap[m.seconder];

    const partyPillsHtml = Object.entries(splits)
      .filter(([_, s]) => (s.for + s.against + s.abstain + s.no_vote) > 0)
      .map(([gName, s]) => {
        const meta = PARTY_META[gName];
        const parts = [];
        if (s.for > 0) parts.push(`<span style="color:#15803d;font-weight:700;">${s.for}F</span>`);
        if (s.against > 0) parts.push(`<span style="color:#b91c1c;font-weight:700;">${s.against}A</span>`);
        if (s.abstain > 0) parts.push(`<span style="color:#b45309;font-weight:700;">${s.abstain}Abs</span>`);
        if (s.no_vote > 0) parts.push(`<span style="color:#6d28d9;font-weight:700;">${s.no_vote}NV</span>`);
        return `
          <div class="party-split-pill ${s.isSplit ? 'split-alert' : ''}">
            <span class="party-dot ${meta.cls}"></span>
            <strong>${meta.short}:</strong> ${parts.join('/')}
            ${s.isSplit ? '<span class="rebel-tag">⚡ SPLIT</span>' : ''}
          </div>
        `;
      }).join('');

    const buckets = [
      { key: "for", label: "For", count: m.tally.for, color: "#16a34a" },
      { key: "against", label: "Against", count: m.tally.against, color: "#dc2626" },
      { key: "abstain", label: "Abstain", count: m.tally.abstain, color: "#d97706" },
      { key: "no_vote", label: "No Vote", count: m.tally.no_vote, color: "#7c3aed" },
      { key: "absent", label: "Absent", count: m.tally.absent, color: "#64748b" }
    ];

    const colsHtml = buckets.filter(bk => bk.count > 0).map(bk => {
      const voters = Object.entries(m.votes)
        .filter(([_, v]) => v === bk.key)
        .map(([cid]) => cllrMap[cid] || { id: cid, name: cid, group: "Not Aligned" })
        .sort((a, bObj) => a.name.localeCompare(bObj.name));

      const listItems = voters.map(c => {
        const pMeta = PARTY_META[c.group] || PARTY_META["Not Aligned"];
        const rebel = isRebelVote(c.id, m, splits);
        return `
          <li class="voter-item" onclick="event.stopPropagation(); jumpToCouncillorDossier('${c.id}')">
            <span>
              <span class="party-dot ${pMeta.cls}" style="margin-right:4px;"></span>
              <strong>${c.name}</strong>
              ${rebel ? '<span class="rebel-tag">Rebel</span>' : ''}
            </span>
            <span style="font-size:0.7rem; color:var(--text-light);">${pMeta.short} ›</span>
          </li>
        `;
      }).join('');

      return `
        <div class="division-col">
          <h4 style="border-bottom-color:${bk.color};">
            <span>${bk.label}</span>
            <span style="font-family:'JetBrains Mono',monospace;">${bk.count}</span>
          </h4>
          <ul class="voter-list">${listItems}</ul>
        </div>
      `;
    }).join('');

    return `
      <article class="motion-card ${idx === 0 ? 'expanded' : ''}" id="card-${m.id}">
        <div class="motion-card-header" onclick="document.getElementById('card-${m.id}').classList.toggle('expanded')">
          <div class="motion-meta-row">
            <div class="motion-tags">
              <span class="tag-badge">📅 ${m.meeting_date}</span>
              <span class="tag-badge">Min ${m.minute_ref}</span>
              <span class="tag-badge">${m.category}</span>
              ${proposerObj ? `<span class="tag-badge">Prop: ${proposerObj.name}</span>` : ''}
              ${seconderObj ? `<span class="tag-badge">Sec: ${seconderObj.name}</span>` : ''}
            </div>
            <span class="outcome-badge ${m.outcome === 'Passed' ? 'outcome-passed' : 'outcome-rejected'}">
              ${m.outcome} (${m.tally.for}–${m.tally.against})
            </span>
          </div>

          <h2 class="motion-title">${m.title}</h2>
          <p class="motion-headline-hook">📰 ${b.headline_summary || m.summary}</p>

          <div class="vote-bar-wrap">
            <div class="vote-bar-labels">
              <span style="color:var(--vote-for);">For: ${m.tally.for}</span>
              <span style="color:var(--vote-against);">Against: ${m.tally.against}</span>
              <span style="color:var(--vote-abstain);">Abs: ${m.tally.abstain}</span>
              <span style="color:var(--vote-novote);">No Vote: ${m.tally.no_vote}</span>
              <span style="color:var(--vote-absent);">Absent: ${m.tally.absent}</span>
            </div>
            <div class="vote-bar-track">
              <div class="bar-seg-for" style="width:${pFor}%"></div>
              <div class="bar-seg-against" style="width:${pAgainst}%"></div>
              <div class="bar-seg-abstain" style="width:${pAbstain}%"></div>
              <div class="bar-seg-no_vote" style="width:${pNoVote}%"></div>
              <div class="bar-seg-absent" style="width:${pAbsent}%"></div>
            </div>
          </div>

          <div class="party-splits-grid">
            ${partyPillsHtml}
            <span style="margin-left:auto; font-size:0.74rem; color:var(--accent); font-weight:700; align-self:center;">
              Briefing & Full Roll Call ▾
            </span>
          </div>
        </div>

        <div class="motion-details">
          <!-- 4-Part Journalistic Division Briefing -->
          <div class="briefing-dispatch">
            <div class="briefing-dispatch-header">
              <span class="briefing-dispatch-title">📋 Division Briefing & Political Analysis</span>
              ${m.source_url ? `<a href="${m.source_url}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">🔗 Official Minutes PDF</a>` : ''}
            </div>
            <div class="briefing-grid">
              <div class="briefing-item">
                <div class="briefing-item-label">1. The Core Question</div>
                <div class="briefing-item-text">${b.core_question}</div>
              </div>
              <div class="briefing-item">
                <div class="briefing-item-label">2. Context & Stakeholders</div>
                <div class="briefing-item-text">${b.context_and_stakeholders}</div>
              </div>
              <div class="briefing-item">
                <div class="briefing-item-label">3. Political Calculus & Wedge Intent</div>
                <div class="briefing-item-text">${b.political_calculus}</div>
              </div>
              <div class="briefing-item">
                <div class="briefing-item-label">4. Anatomy of the Split</div>
                <div class="briefing-item-text">${b.anatomy_of_split}</div>
              </div>
            </div>
          </div>

          <div style="font-size:0.76rem; font-weight:700; color:var(--text-muted); margin-bottom:0.4rem;">
            Individual Councillor Roll Call (Tap any name to open their Dossier):
          </div>
          <div class="division-columns">${colsHtml}</div>
        </div>
      </article>
    `;
  }).join('');
}

/* =========================================================================
   4. LENS 2: ALIGNMENT MATRIX & COALITION STRESS TRACKER
   ========================================================================= */
function renderCoalitionStressBanner() {
  const el = document.getElementById("coalition-stress-banner");
  if (!el) return;

  let unitedCount = 0;
  let fracturedMotions = [];

  motions.forEach(m => {
    const s = computePartySplitsForMotion(m);
    const labMaj = s["Labour Group"]?.majorityVote;
    const ldMaj = s["Liberal Democrat Group"]?.majorityVote;
    const indMaj = s["Rochford & Southend East Independents Group"]?.majorityVote;

    if (labMaj && ldMaj && indMaj) {
      if (labMaj === ldMaj && labMaj === indMaj) {
        unitedCount++;
      } else {
        fracturedMotions.push(`${m.meeting_date} (${m.title.slice(0, 42)}...)`);
      }
    }
  });

  const total = unitedCount + fracturedMotions.length;
  const cohesionPct = total > 0 ? Math.round((unitedCount / total) * 100) : 100;

  el.innerHTML = `
    <div class="dyad-score-banner" style="background:#f8fafc; border-color:var(--border-strong);">
      <div>
        <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; color:var(--primary);">
          Joint Administration Coalition Cohesion Index (LAB + LD + RSE IND)
        </div>
        <div style="font-size:0.82rem; color:var(--text-muted); margin-top:0.2rem;">
          The 3 coalition groups voted as a united bloc in <strong>${unitedCount} of ${total}</strong> recorded divisions.
          ${fracturedMotions.length > 0 ? `<br><span style="color:#b91c1c; font-weight:600;">⚡ Coalition Fractures: ${fracturedMotions.join(' | ')}</span>` : ''}
        </div>
      </div>
      <div class="dyad-big-pct">${cohesionPct}%</div>
    </div>
  `;
}

function populateDyadDropdowns() {
  const selA = document.getElementById("dyad-cllr-a");
  const selB = document.getElementById("dyad-cllr-b");
  if (!selA || !selB) return;

  const sorted = [...councillors].sort((a, b) => a.name.localeCompare(b.name));
  const opts = sorted.map(c => {
    const meta = PARTY_META[c.group] || PARTY_META["Not Aligned"];
    return `<option value="${c.id}">${c.name} (${meta.short} — ${c.ward})</option>`;
  }).join('');
  selA.innerHTML = opts;
  selB.innerHTML = opts;
  selA.value = "cllr-sam-allen";
  selB.value = "cllr-paul-collins";
}

function renderDyadComparison() {
  const idA = document.getElementById("dyad-cllr-a")?.value;
  const idB = document.getElementById("dyad-cllr-b")?.value;
  const cA = cllrMap[idA];
  const cB = cllrMap[idB];
  const container = document.getElementById("dyad-results-container");
  if (!cA || !cB || !container) return;

  let bothPresent = 0, exactAgreements = 0;
  const rowsHtml = motions.map(m => {
    const vA = m.votes[idA] || "n/a";
    const vB = m.votes[idB] || "n/a";
    const activeVotes = ["for", "against", "abstain", "no_vote"];
    let statusCell = `<span style="color:var(--text-light);">—</span>`;

    if (activeVotes.includes(vA) && activeVotes.includes(vB)) {
      bothPresent++;
      if (vA === vB) {
        exactAgreements++;
        statusCell = `<span style="color:#15803d; font-weight:700;">✓ Same</span>`;
      } else {
        statusCell = `<span style="color:#b91c1c; font-weight:700;">✗ Split</span>`;
      }
    }

    return `
      <tr>
        <td><strong>${m.meeting_date}</strong><br><span style="font-size:0.7rem;color:var(--text-light);">Min ${m.minute_ref}</span></td>
        <td>${m.title}</td>
        <td><span class="vote-pill vote-${vA}">${vA.replace('_', ' ')}</span></td>
        <td><span class="vote-pill vote-${vB}">${vB.replace('_', ' ')}</span></td>
        <td>${statusCell}</td>
      </tr>
    `;
  }).join('');

  const pct = bothPresent > 0 ? Math.round((exactAgreements / bothPresent) * 100) : 0;

  container.innerHTML = `
    <div class="dyad-score-banner">
      <div>
        <div style="font-size:0.74rem; font-weight:700; text-transform:uppercase; color:var(--primary);">
          ${cA.name} vs ${cB.name}
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted);">
          Voted identically in <strong>${exactAgreements}</strong> of <strong>${bothPresent}</strong> shared divisions.
        </div>
      </div>
      <div class="dyad-big-pct">${pct}%</div>
    </div>
    <div class="matrix-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Division</th>
            <th>${cA.name}</th>
            <th>${cB.name}</th>
            <th>Match</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderRebelLeaderboard() {
  const tbody = document.querySelector("#rebel-leaderboard-table tbody");
  if (!tbody) return;
  const statsList = [];

  councillors.forEach(c => {
    if (c.group === "Not Aligned") return;
    let activeVotes = 0, rebellions = 0, rebelMotions = [];
    motions.forEach(m => {
      const v = m.votes[c.id];
      if (v === "for" || v === "against" || v === "abstain") {
        activeVotes++;
        if (isRebelVote(c.id, m)) {
          rebellions++;
          rebelMotions.push(`${m.meeting_date} (${v.toUpperCase()})`);
        }
      }
    });
    if (rebellions > 0) {
      const loyalty = activeVotes > 0 ? Math.round(((activeVotes - rebellions) / activeVotes) * 100) : 100;
      statsList.push({ cllr: c, activeVotes, rebellions, loyalty, rebelMotions });
    }
  });

  statsList.sort((a, b) => b.rebellions - a.rebellions || a.loyalty - b.loyalty);

  tbody.innerHTML = statsList.map(item => {
    const meta = PARTY_META[item.cllr.group];
    return `
      <tr style="cursor:pointer;" onclick="jumpToCouncillorDossier('${item.cllr.id}')">
        <td><strong>${item.cllr.name}</strong> <span style="font-size:0.7rem;color:var(--text-light);">(${item.cllr.ward})</span></td>
        <td><span class="party-badge ${meta.cls}">${meta.short}</span></td>
        <td style="font-family:'JetBrains Mono',monospace; font-weight:700;">${item.loyalty}%</td>
        <td><span class="rebel-tag">${item.rebellions}/${item.activeVotes}</span></td>
        <td style="font-size:0.74rem; color:var(--text-muted);">${item.rebelMotions.join(', ')}</td>
      </tr>
    `;
  }).join('');
}

function renderPartyMatrix() {
  const container = document.getElementById("party-matrix-container");
  if (!container) return;

  const groups = [
    "Labour Group",
    "Liberal Democrat Group",
    "Rochford & Southend East Independents Group",
    "Green Group",
    "Conservative Group",
    "Reform UK Group"
  ];
  const motionSplits = motions.map(m => computePartySplitsForMotion(m));

  let html = `<table class="data-table"><thead><tr><th>Group</th>`;
  groups.forEach(g => { html += `<th style="text-align:center;">${PARTY_META[g].short}</th>`; });
  html += `</tr></thead><tbody>`;

  groups.forEach(gA => {
    const metaA = PARTY_META[gA];
    html += `<tr><td><span class="party-badge ${metaA.cls}">${metaA.short}</span></td>`;
    groups.forEach(gB => {
      if (gA === gB) {
        html += `<td class="heat-cell" style="background:#f1f5f9; color:#64748b;">100%</td>`;
        return;
      }
      let shared = 0, agreed = 0;
      motionSplits.forEach(s => {
        const majA = s[gA]?.majorityVote;
        const majB = s[gB]?.majorityVote;
        if ((majA === "for" || majA === "against") && (majB === "for" || majB === "against")) {
          shared++;
          if (majA === majB) agreed++;
        }
      });
      const pct = shared > 0 ? Math.round((agreed / shared) * 100) : 0;
      const bg = pct >= 75 ? '#dcfce7' : pct >= 40 ? '#fef9c3' : '#fee2e2';
      const col = pct >= 75 ? '#166534' : pct >= 40 ? '#854d0e' : '#991b1b';
      html += `<td class="heat-cell" style="background:${bg}; color:${col};">${pct}%</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

/* =========================================================================
   5. LENS 3: COUNCILLOR DOSSIERS
   ========================================================================= */
function renderCllrDirectory() {
  const q = (document.getElementById("cllr-search")?.value || "").trim().toLowerCase();
  const partyFilter = document.getElementById("cllr-party-filter")?.value || "ALL";
  const statusFilter = document.getElementById("cllr-status-filter")?.value || "ALL";
  const listEl = document.getElementById("cllr-directory-list");
  if (!listEl) return;

  const filtered = councillors.filter(c => {
    if (partyFilter !== "ALL" && c.group !== partyFilter) return false;
    if (statusFilter === "CURRENT" && c.status === "former") return false;
    if (statusFilter === "former" && c.status !== "former") return false;
    if (q) {
      const hay = `${c.name} ${c.ward} ${c.party} ${c.roles.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  listEl.innerHTML = filtered.map(c => {
    const meta = PARTY_META[c.group] || PARTY_META["Not Aligned"];
    const isSel = c.id === selectedCllrId;
    return `
      <div class="cllr-list-item ${isSel ? 'selected' : ''}" onclick="selectCouncillorFromList('${c.id}')">
        <div class="cllr-name-block">
          <div class="name">${c.name}</div>
          <div class="sub">${c.ward} Ward • ${c.status === 'former' ? 'Former (2024–26)' : 'Up in ' + c.term_ends}</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span class="party-badge ${meta.cls}">${meta.short}</span>
          <span style="color:var(--text-light); font-weight:700;">›</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderCllrDossier(cllrId) {
  const c = cllrMap[cllrId] || councillors[0];
  const pane = document.getElementById("cllr-dossier-detail");
  if (!c || !pane) return;
  const meta = PARTY_META[c.group] || PARTY_META["Not Aligned"];

  let eligible = 0, presentCount = 0, forCount = 0, againstCount = 0, abstainCount = 0, noVoteCount = 0, absentCount = 0, rebellions = 0;

  const historyRows = motions.map(m => {
    const v = m.votes[c.id];
    if (!v) {
      return `
        <tr>
          <td>${m.meeting_date}</td>
          <td>${m.title}</td>
          <td><span class="tag-badge">Not in seat</span></td>
          <td>—</td>
        </tr>
      `;
    }
    eligible++;
    if (v === "for") { forCount++; presentCount++; }
    if (v === "against") { againstCount++; presentCount++; }
    if (v === "abstain") { abstainCount++; presentCount++; }
    if (v === "no_vote") { noVoteCount++; presentCount++; }
    if (v === "absent") { absentCount++; }

    const splits = computePartySplitsForMotion(m);
    const rebel = isRebelVote(c.id, m, splits);
    if (rebel) rebellions++;
    const grpMaj = splits[c.group]?.majorityVote;

    return `
      <tr>
        <td><strong>${m.meeting_date}</strong><br><span style="font-size:0.7rem;color:var(--text-light);">Min ${m.minute_ref}</span></td>
        <td>
          <strong>${m.title}</strong>
          <div style="font-size:0.73rem;color:var(--text-muted);">${m.category} • ${m.outcome}</div>
        </td>
        <td>
          <span class="vote-pill vote-${v}">${v.replace('_', ' ')}</span>
          ${rebel ? '<div style="margin-top:4px;"><span class="rebel-tag">⚡ Rebel</span></div>' : ''}
        </td>
        <td style="font-size:0.75rem; color:var(--text-muted);">
          ${grpMaj ? `Group: <strong>${grpMaj.toUpperCase()}</strong>` : 'Free Vote'}
        </td>
      </tr>
    `;
  }).join('');

  const attendancePct = eligible > 0 ? Math.round((presentCount / eligible) * 100) : 0;
  const activeCast = forCount + againstCount + abstainCount;
  const loyaltyPct = (c.group !== "Not Aligned" && activeCast > 0)
    ? Math.round(((activeCast - rebellions) / activeCast) * 100) + "%"
    : "N/A";

  pane.innerHTML = `
    <div class="dossier-header">
      <div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.35rem;">
          <h2 style="font-size:1.25rem; font-weight:800;">Cllr ${c.name}</h2>
          <span class="party-badge ${meta.cls}">${c.party}</span>
          <span class="status-pill status-${c.status}">${c.status}</span>
        </div>
        <div style="font-size:0.84rem; color:var(--text-muted);">
          <strong>Ward:</strong> ${c.ward} &nbsp;|&nbsp; <strong>Term Ends:</strong> ${c.term_ends} &nbsp;|&nbsp; <strong>Minutes Alias:</strong> <code>${c.minute_alias}</code>
        </div>
        ${c.roles.length > 0 ? `<div style="margin-top:0.45rem; font-size:0.8rem; color:var(--primary); font-weight:600;">🏛 ${c.roles.join(' • ')}</div>` : ''}
      </div>
      <a href="https://democracy.southend.gov.uk/mgMemberIndex.aspx?bcr=1" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
        Modern.Gov ↗
      </a>
    </div>

    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Attendance</div>
        <div class="kpi-val">${attendancePct}%</div>
        <div style="font-size:0.7rem; color:var(--text-light);">${presentCount}/${eligible} votes</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Group Loyalty</div>
        <div class="kpi-val">${loyaltyPct}</div>
        <div style="font-size:0.7rem; color:var(--text-light);">${rebellions} deviations</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">For / Against</div>
        <div class="kpi-val" style="color:#15803d;">${forCount} <span style="color:#94a3b8;">/</span> <span style="color:#b91c1c;">${againstCount}</span></div>
        <div style="font-size:0.7rem; color:var(--text-light);">Directional</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Abstain / NV</div>
        <div class="kpi-val">${abstainCount} <span style="color:#94a3b8;">/</span> ${noVoteCount}</div>
        <div style="font-size:0.7rem; color:var(--text-light);">Absent: ${absentCount}</div>
      </div>
    </div>

    <h4 style="font-size:0.8rem; text-transform:uppercase; color:var(--text-muted); margin-bottom:0.5rem;">
      Voting Record (${eligible} Tracked Divisions)
    </h4>
    <div class="matrix-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Motion</th>
            <th>Vote</th>
            <th>Whip</th>
          </tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;
}

/* =========================================================================
   6. NEW LENS 4: STRATMAP WARD VULNERABILITY & DOORSTEP BRIEFING BRIDGE
   ========================================================================= */
function populateStratMapWardDropdown() {
  const sel = document.getElementById("stratmap-ward-filter");
  if (!sel) return;
  const wards = [...new Set(councillors.filter(c => c.status !== "former").map(c => c.ward))].sort();
  sel.innerHTML = `<option value="ALL">All 17 Southend Wards</option>` +
    wards.map(w => `<option value="${w}">${w} Ward</option>`).join('');
}

function computeWardStratMapData() {
  const activeCllrs = councillors.filter(c => c.status !== "former");
  const wardNames = [...new Set(activeCllrs.map(c => c.ward))].sort();

  return wardNames.map(ward => {
    const members = activeCllrs.filter(c => c.ward === ward).sort((a, b) => a.term_ends - b.term_ends);
    const partiesInWard = [...new Set(members.map(m => m.group))];
    const isSplitWard = partiesInWard.length > 1;
    const nextUpCllr = members.find(m => m.term_ends === 2027) || members[0];

    // Check how the 3 ward councillors voted on the latest motion (e.g. Green Belt) and Main Budget
    const greenBeltMotion = motions.find(m => m.id.includes("2026-08-24")) || motions[0];
    const budgetMotion = motions.find(m => m.id.includes("min107-main")) || motions[1];

    let wardRebelCount = 0;
    let wardVotesOnLatest = new Set();

    members.forEach(c => {
      if (greenBeltMotion && greenBeltMotion.votes[c.id]) {
        wardVotesOnLatest.add(greenBeltMotion.votes[c.id]);
      }
      motions.forEach(m => {
        if (isRebelVote(c.id, m)) wardRebelCount++;
      });
    });

    const intraWardVoteClash = wardVotesOnLatest.has("for") && (wardVotesOnLatest.has("against") || wardVotesOnLatest.has("no_vote"));

    return {
      ward,
      isSplitWard,
      intraWardVoteClash,
      wardRebelCount,
      nextElectionYear: nextUpCllr ? nextUpCllr.term_ends : 2027,
      defender2027: nextUpCllr ? { id: nextUpCllr.id, name: nextUpCllr.name, party: nextUpCllr.party, group: nextUpCllr.group } : null,
      members: members.map(c => ({
        id: c.id,
        name: c.name,
        party: c.party,
        group: c.group,
        term_ends: c.term_ends,
        status: c.status,
        green_belt_vote: greenBeltMotion ? (greenBeltMotion.votes[c.id] || "n/a") : "n/a",
        budget_2026_vote: budgetMotion ? (budgetMotion.votes[c.id] || "n/a") : "n/a"
      }))
    };
  });
}

function renderStratMapCards() {
  const container = document.getElementById("stratmap-grid-container");
  if (!container) return;

  const wardFilter = document.getElementById("stratmap-ward-filter")?.value || "ALL";
  const modeFilter = document.getElementById("stratmap-year-filter")?.value || "ALL";

  const wardData = computeWardStratMapData().filter(w => {
    if (wardFilter !== "ALL" && w.ward !== wardFilter) return false;
    if (modeFilter === "SPLIT_PARTY" && !w.isSplitWard) return false;
    if (modeFilter === "VOTE_CLASH" && !w.intraWardVoteClash) return false;
    return true;
  });

  container.innerHTML = wardData.map(w => {
    const memberRows = w.members.map(m => {
      const meta = PARTY_META[m.group] || PARTY_META["Not Aligned"];
      return `
        <div class="ward-cllr-row" onclick="jumpToCouncillorDossier('${m.id}')">
          <div>
            <span class="party-dot ${meta.cls}" style="margin-right:4px;"></span>
            <strong>${m.name}</strong>
            <span style="font-size:0.7rem; color:var(--text-light);">(${meta.short} • Up ${m.term_ends})</span>
          </div>
          <div style="display:flex; gap:0.25rem;">
            <span class="vote-pill vote-${m.green_belt_vote}" title="Aug 2026 Green Belt Vote">GB: ${m.green_belt_vote.replace('_', ' ')}</span>
            <span class="vote-pill vote-${m.budget_2026_vote}" title="Feb 2026 Main Budget Vote">Bdg: ${m.budget_2026_vote.replace('_', ' ')}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="ward-card ${w.intraWardVoteClash ? 'high-tension' : ''}">
        <div class="ward-header">
          <span class="ward-title">📍 ${w.ward} Ward</span>
          <div style="display:flex; gap:0.3rem;">
            ${w.isSplitWard ? '<span class="tag-badge">Split Representation</span>' : '<span class="tag-badge">Single-Party Ward</span>'}
            ${w.intraWardVoteClash ? '<span class="rebel-tag">⚡ Ward Vote Clash</span>' : ''}
          </div>
        </div>

        <div style="font-size:0.76rem; color:var(--text-muted);">
          <strong>2027 Seat Up:</strong> ${w.defender2027 ? `Cllr ${w.defender2027.name} (${w.defender2027.party})` : 'None'}
        </div>

        <div style="display:flex; flex-direction:column; gap:0.35rem;">
          ${memberRows}
        </div>

        <div style="font-size:0.75rem; color:var(--text-muted); background:var(--surface-alt); padding:0.5rem 0.65rem; border-radius:6px; margin-top:auto;">
          <strong>Doorstep Note:</strong> ${
            w.intraWardVoteClash
              ? `Ward councillors split their votes on the Aug 2026 Green Belt motion—prime wedge issue for 2027.`
              : `All active ${w.ward} councillors voted in the same direction on the Green Belt division.`
          }
        </div>
      </div>
    `;
  }).join('');
}

function exportStratMapJSON() {
  const payload = {
    generated_at: new Date().toISOString(),
    layer_type: "southend_ward_voting_vulnerability_stratmap_v1",
    wards: computeWardStratMapData()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stratmap-ward-voting-layer-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================================
   7. LENS 5: MINUTE-TO-JSON PARSER + WEB-SEARCH JOURNALISTIC BRIEFING ENGINE
   ========================================================================= */
const PARSER_PRESETS = {
  greenbelt: {
    date: "2026-08-24",
    minref: "42",
    title: "Notice of Motion: Reaffirmation of the Existing Adopted Development Plan & Green Belt Protection",
    category: "Green Belt & Planning",
    outcome: "Passed",
    raw: `For: Councillors S W Allen, S Allen, Aylen, Badger, Berry, Bird, Campbell, Collins, Corrigan, Courtenay, Cox, Forde, Garston, Habermel, Harvey, Heaver, Darryl Jones, Longstaff, McMahon, McMullan, Mitchell, A Moyies, J Moyies, O'Rourke, Poulton, Salter, Dr Shaw, Wakefield, Warren, Watt and Woodley (31)\nAgainst: Councillors Borton, Dent, Madison Faulkner-Hatt, Gilbert, A Jones, Kinsella, Nevin, Norman, Robinson, Sadza and Webster (11)\nAbstentions: None (0)\nNo Vote: Councillors Cowan, Ferguson, Nadeem and O'Connor (4)\nAbsent for the vote: Councillors Bright, Cartey, Davidson, Richardson and Wood (5)`
  },
  simulated: {
    date: "2026-11-26",
    minref: "64",
    title: "Notice of Motion: Winter Seafront Parking Tariff Freeze & Zone 1A Review",
    category: "Highways & Transport",
    outcome: "Rejected",
    raw: `For: Councillors Aylen, Badger, Berry, Bird, Bright, Campbell, Cartey, Corrigan, Courteney, Davidson, Garston, Habermel, Harvey, Heaver, Darryl Jones, McMahon, A Moyies, J Moyies, O'Rourke, Salter, Dr Shaw, Wakefield, Warren, Watt, Wood and Woodley (26)\nAgainst: Councillors S W Allen, S Allen, Borton, Collins, Cowan, Dent, Madison Faulkner-Hatt, Ferguson, Forde, Gilbert, A Jones, Kinsella, Longstaff, McMullan, Mitchell, Nadeem, Nevin, Norman, O'Connor, Poulton, Richardson, Robinson, Sadza and Webster (24)\nAbstentions: Councillor Cox (1)\nNo Vote: None (0)\nAbsent for the vote: None (0)`
  }
};

function loadParserPreset(key) {
  const p = PARSER_PRESETS[key];
  if (!p) return;
  manualTokenOverrides = {};
  document.getElementById("parse-date").value = p.date;
  document.getElementById("parse-minref").value = p.minref;
  document.getElementById("parse-title").value = p.title;
  document.getElementById("parse-category").value = p.category;
  document.getElementById("parse-outcome").value = p.outcome;
  document.getElementById("parse-raw-text").value = p.raw;
  runMinuteParser(true);
}

function normalizeAliasToken(str) {
  return str.replace(/[’‘]/g, "'").replace(/^(Councillors|Councillor|Cllrs|Cllr)\s+/i, "").replace(/\.$/, "").trim();
}

function matchCouncillorToken(token) {
  if (manualTokenOverrides[token]) return manualTokenOverrides[token];
  const clean = normalizeAliasToken(token).toLowerCase();
  for (const c of councillors) {
    if (c.aliases.some(a => a.toLowerCase() === clean)) return c.id;
  }
  return null;
}

// Automatically drafts an initial factual briefing from the parsed mathematical splits
function generateLocalDeterministicBriefing(title, dateVal, outcome, tally, votesMap) {
  const tempMotion = { votes: votesMap };
  const splits = computePartySplitsForMotion(tempMotion);

  const groupSummaries = [];
  const rebelsList = [];
  const noVoteList = [];

  Object.entries(splits).forEach(([gName, s]) => {
    const short = PARTY_META[gName].short;
    if (s.for + s.against + s.abstain + s.no_vote > 0) {
      groupSummaries.push(`${short} (${s.for} For, ${s.against} Against, ${s.abstain} Abstain, ${s.no_vote} No Vote)`);
    }
  });

  Object.entries(votesMap).forEach(([cid, v]) => {
    const c = cllrMap[cid];
    if (!c) return;
    if (isRebelVote(cid, tempMotion, splits)) {
      rebelsList.push(`Cllr ${c.name} (${c.party}, ${c.ward}) voted ${v.toUpperCase()}`);
    }
    if (v === "no_vote") {
      noVoteList.push(`Cllr ${c.name} (${c.party})`);
    }
  });

  const labMaj = splits["Labour Group"]?.majorityVote;
  const ldMaj = splits["Liberal Democrat Group"]?.majorityVote;
  const indMaj = splits["Rochford & Southend East Independents Group"]?.majorityVote;
  const coalitionSplit = (labMaj && ldMaj && indMaj) && !(labMaj === ldMaj && labMaj === indMaj);

  lastPreAnalysisText = `Motion: "${title}" on ${dateVal} (${outcome}: ${tally.for} For, ${tally.against} Against, ${tally.abstain} Abstain, ${tally.no_vote} No Vote, ${tally.absent} Absent). Party Breakdown: ${groupSummaries.join("; ")}. Coalition Split: ${coalitionSplit ? "YES" : "NO"}. Whip Rebels: ${rebelsList.length ? rebelsList.join(", ") : "None"}. No Votes: ${noVoteList.length ? noVoteList.join(", ") : "None"}.`;

  return {
    headline_summary: `${outcome} ${tally.for}–${tally.against}${coalitionSplit ? ' as junior coalition partners diverged from Labour' : ''}${rebelsList.length > 0 ? ` with ${rebelsList.length} party whip deviation(s)` : ''}.`,
    core_question: `Whether Southend City Council should approve "${title}".`,
    context_and_stakeholders: `Recorded division held on ${dateVal}. Click "Auto-Research via Web Search" or paste local context to enrich stakeholder details.`,
    political_calculus: coalitionSplit
      ? `Exposed a division across the Joint Administration: Labour (${labMaj?.toUpperCase() || 'split'}), Lib Dems (${ldMaj?.toUpperCase() || 'split'}), and RSE Independents (${indMaj?.toUpperCase() || 'split'}).`
      : `Tested chamber alignment across administration and opposition benches (${groupSummaries.slice(0, 3).join(', ')}).`,
    anatomy_of_split: `${rebelsList.length > 0 ? `Whip deviations: ${rebelsList.join('; ')}. ` : 'Strict party discipline held across whipped groups. '}${noVoteList.length > 0 ? `Recorded No Vote: ${noVoteList.join(', ')}.` : ''}`
  };
}

function runMinuteParser(autoFillBriefing = false) {
  const raw = document.getElementById("parse-raw-text")?.value || "";
  const diagBox = document.getElementById("parser-diagnostics-box");
  const unmatchedBox = document.getElementById("parser-unmatched-box");
  const previewEl = document.getElementById("parser-json-preview");
  const saveBtn = document.getElementById("btn-save-parsed");

  if (!raw.trim()) {
    if (diagBox) diagBox.innerHTML = "";
    if (unmatchedBox) unmatchedBox.innerHTML = "";
    if (previewEl) previewEl.textContent = "// Paste minutes to generate JSON...";
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  const bucketDefs = [
    { key: "for", label: "For", regex: /^For\s*:/i },
    { key: "against", label: "Against", regex: /^Against\s*:/i },
    { key: "abstain", label: "Abstentions", regex: /^Abst(entions|ain)\s*:/i },
    { key: "no_vote", label: "No Vote", regex: /^No\s+Vote\s*:/i },
    { key: "absent", label: "Absent", regex: /^Absent(\s+for\s+the\s+vote)?\s*:/i }
  ];

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const votesMap = {};
  const tally = { for: 0, against: 0, abstain: 0, no_vote: 0, absent: 0 };
  const diagnostics = [];
  const unmatchedTokens = [];

  bucketDefs.forEach(b => {
    const line = lines.find(l => b.regex.test(l));
    if (!line) return;

    const countMatch = line.match(/\((\d+)\)\s*\.?\s*$/);
    const expectedCount = countMatch ? parseInt(countMatch[1], 10) : null;

    let body = line.replace(b.regex, "").replace(/\((\d+)\)\s*\.?\s*$/, "").trim();
    body = body.replace(/^(Councillors|Councillor|Cllrs|Cllr)\s+/i, "").trim();

    if (/^(None|Nil)\.?$/i.test(body) || body === "") {
      tally[b.key] = 0;
      diagnostics.push({ label: b.label, matched: 0, expected: expectedCount ?? 0, ok: true });
      return;
    }

    body = body.replace(/\s+and\s+/gi, ", ");
    const tokens = body.split(",").map(t => normalizeAliasToken(t)).filter(Boolean);

    let matchedInLine = 0;
    tokens.forEach(tok => {
      const cid = matchCouncillorToken(tok);
      if (cid) {
        votesMap[cid] = b.key;
        matchedInLine++;
      } else {
        unmatchedTokens.push({ token: tok, bucket: b.key });
      }
    });

    tally[b.key] = matchedInLine;
    const isOk = expectedCount === null ? unmatchedTokens.length === 0 : (matchedInLine === expectedCount);
    diagnostics.push({ label: b.label, matched: matchedInLine, expected: expectedCount, ok: isOk });
  });

  const totalMatched = Object.keys(votesMap).length;
  diagBox.innerHTML = diagnostics.map(d => `
    <div class="checksum-row ${d.ok ? 'checksum-ok' : 'checksum-warn'}">
      <span>${d.ok ? '✓' : '⚠'} <strong>${d.label}</strong></span>
      <span style="font-family:'JetBrains Mono',monospace;">${d.matched} ${d.expected !== null ? `/ (${d.expected})` : ''}</span>
    </div>
  `).join('');

  if (unmatchedTokens.length > 0) {
    const sortedCllrs = [...councillors].sort((a, b) => a.name.localeCompare(b.name));
    unmatchedBox.innerHTML = `
      <div class="unmatched-card">
        <div style="font-weight:700; color:#92400e; margin-bottom:0.4rem;">⚠ ${unmatchedTokens.length} Unrecognised Name</div>
        ${unmatchedTokens.map(u => `
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-bottom:0.4rem;">
            <code style="background:#fff; padding:0.2rem 0.4rem; border-radius:4px;">"${u.token}"</code>
            <select onchange="manualTokenOverrides['${u.token.replace(/'/g, "\\'")}'] = this.value; runMinuteParser(true);">
              <option value="">-- Match Councillor --</option>
              ${sortedCllrs.map(c => `<option value="${c.id}">${c.name} (${c.ward})</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    unmatchedBox.innerHTML = "";
  }

  const dateVal = document.getElementById("parse-date").value || "2026-10-15";
  const minRef = document.getElementById("parse-minref").value.trim() || "XX";
  const titleVal = document.getElementById("parse-title").value.trim() || "Untitled Division";
  const outcomeVal = document.getElementById("parse-outcome").value;

  const autoBrief = generateLocalDeterministicBriefing(titleVal, dateVal, outcomeVal, tally, votesMap);

  if (autoFillBriefing || !document.getElementById("parse-headline").value) {
    document.getElementById("parse-headline").value = autoBrief.headline_summary;
    document.getElementById("parse-core-q").value = autoBrief.core_question;
    document.getElementById("parse-context").value = autoBrief.context_and_stakeholders;
    document.getElementById("parse-calculus").value = autoBrief.political_calculus;
    document.getElementById("parse-split").value = autoBrief.anatomy_of_split;
  }

  const briefingObj = {
    headline_summary: document.getElementById("parse-headline").value.trim() || autoBrief.headline_summary,
    core_question: document.getElementById("parse-core-q").value.trim() || autoBrief.core_question,
    context_and_stakeholders: document.getElementById("parse-context").value.trim() || autoBrief.context_and_stakeholders,
    political_calculus: document.getElementById("parse-calculus").value.trim() || autoBrief.political_calculus,
    anatomy_of_split: document.getElementById("parse-split").value.trim() || autoBrief.anatomy_of_split
  };

  lastParsedMotionObj = {
    id: `motion-${dateVal}-min${minRef.replace(/\W+/g, '').toLowerCase()}`,
    meeting_date: dateVal,
    meeting_type: "Council",
    minute_ref: minRef,
    title: titleVal,
    category: document.getElementById("parse-category").value,
    proposer: "",
    seconder: "",
    outcome: outcomeVal,
    source_url: "https://democracy.southend.gov.uk/",
    summary: briefingObj.headline_summary,
    briefing: briefingObj,
    tally,
    votes: votesMap
  };

  previewEl.textContent = JSON.stringify(lastParsedMotionObj, null, 2);
  saveBtn.disabled = totalMatched === 0 || unmatchedTokens.length > 0;
}

// Option A: Live In-App Gemini API + Google Search Grounding Briefing Generator
async function generateBriefingWithWebSearch() {
  runMinuteParser(false);
  const apiKey = document.getElementById("gemini-api-key")?.value.trim();
  const statusEl = document.getElementById("ai-briefing-status");

  if (!apiKey) {
    statusEl.innerHTML = `<span style="color:#b45309;">⚠ No Gemini API key entered. Either paste a free Gemini API key above for 1-click Google Search grounding, or click <strong>"Copy Research Prompt"</strong> next to it to run in chat!</span>`;
    return;
  }

  localStorage.setItem(STORAGE_KEY_API, apiKey);
  statusEl.innerHTML = `<span style="color:var(--accent);">🔎 Searching Southend Council reports & local news via Google Search grounding...</span>`;

  const prompt = `You are a British local government political journalist covering Southend-on-Sea City Council.
Use Google Search to find any relevant local context (Southend Echo, democracy.southend.gov.uk, local petitions, or national policy context) for this recorded council division and combine it with the exact mathematical voting breakdown below:
${lastPreAnalysisText}

Return ONLY a valid JSON object with these 5 exact keys (concise, objective journalistic British English, no markdown fences):
{
  "headline_summary": "1-sentence punchy summary of outcome and key split",
  "core_question": "Plain-English explanation of what voting For or Against practically meant",
  "context_and_stakeholders": "Local background, triggers, and affected resident/stakeholder groups",
  "political_calculus": "Why this motion/amendment was tabled and any wedge tactics involved",
  "anatomy_of_split": "Specific breakdown of party blocs, coalition fractures, whip rebels, and cabinet No Votes"
}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }]
      })
    });

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse JSON from response.");

    const parsedBrief = JSON.parse(jsonMatch[0]);
    document.getElementById("parse-headline").value = parsedBrief.headline_summary || "";
    document.getElementById("parse-core-q").value = parsedBrief.core_question || "";
    document.getElementById("parse-context").value = parsedBrief.context_and_stakeholders || "";
    document.getElementById("parse-calculus").value = parsedBrief.political_calculus || "";
    document.getElementById("parse-split").value = parsedBrief.anatomy_of_split || "";

    runMinuteParser(false);
    statusEl.innerHTML = `<span style="color:#15803d; font-weight:700;">✓ Web-searched journalistic briefing generated and populated into JSON!</span>`;
  } catch (err) {
    statusEl.innerHTML = `<span style="color:#b91c1c;">⚠ API Error: ${err.message}. You can use "Copy Research Prompt" instead.</span>`;
  }
}

// Option B: Zero-Key One-Click Research Prompt Copier
function copyWebResearchPrompt() {
  runMinuteParser(false);
  const promptText = `Search Southend City Council minutes and local news for this recorded vote and write our 4-part journalistic briefing JSON (headline_summary, core_question, context_and_stakeholders, political_calculus, anatomy_of_split) using these exact parsed division numbers:\n\n${lastPreAnalysisText}`;
  navigator.clipboard.writeText(promptText);
  const statusEl = document.getElementById("ai-briefing-status");
  if (statusEl) {
    statusEl.innerHTML = `<span style="color:#15803d; font-weight:700;">✓ Research prompt copied! Paste it into Gemini chat to get the web-searched briefing.</span>`;
  }
}

function saveParsedMotionToApp() {
  if (!lastParsedMotionObj) return;
  const existingIdx = motions.findIndex(m => m.id === lastParsedMotionObj.id);
  if (existingIdx >= 0) motions[existingIdx] = lastParsedMotionObj;
  else motions.unshift(lastParsedMotionObj);
  localStorage.setItem(STORAGE_KEY_MOTIONS, JSON.stringify(motions));
  refreshAllViews();
  switchTab('motions');
}

function copyParsedJson() {
  if (!lastParsedMotionObj) return;
  navigator.clipboard.writeText(JSON.stringify(lastParsedMotionObj, null, 2));
  alert("Motion JSON (with 4-part briefing) copied to clipboard!");
}

function exportFullDatabase() {
  const payload = {
    exported_at: new Date().toISOString(),
    data_version: window.APP_DATA_VERSION,
    council: "Southend-on-Sea City Council",
    councillors,
    motions
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `southend-votewatch-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

window.addEventListener("DOMContentLoaded", initApp);
