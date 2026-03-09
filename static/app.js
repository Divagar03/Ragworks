/* ─────────────────────────────────────────────────────────────
   app.js  –  AI Incident Report Visualiser  (UC #21)
   Schema (from github.com/Divagar03/Ragworks):
     incident_id | date | location | incident_type | severity | description | citation
───────────────────────────────────────────────────────────── */

// ── Sample data (matches repo schema) ────────────────────────
const SAMPLE = [
  {
    incident_id: "INC-001",
    date: "2025-11-03",
    location: "Finance Department – Server Room",
    incident_type: "Ransomware",
    severity: "Critical",
    description: "LockBit 3.0 ransomware encrypted all shared drives on fin-server-01 and fin-server-02 via a phishing macro. 48-hour operational outage. Restored from clean backups.",
    citation: { filename: "Q4_Incident_Report.pdf", chunk_index: 2 }
  },
  {
    incident_id: "INC-002",
    date: "2025-11-17",
    location: "Customer Portal – auth-service",
    incident_type: "Credential Stuffing",
    severity: "High",
    description: "Automated botnet used combolists from an external breach to compromise ~1,200 customer accounts. MFA enforced and affected accounts reset.",
    citation: { filename: "Q4_Incident_Report.pdf", chunk_index: 5 }
  },
  {
    incident_id: "INC-003",
    date: "2025-11-22",
    location: "Reporting API – postgres-db-03",
    incident_type: "SQL Injection",
    severity: "High",
    description: "Unsanitised 'dateFrom' parameter in reporting-api-v2 allowed UNION-based SQL injection. Read access to internal tables confirmed; no exfiltration detected.",
    citation: { filename: "Q4_Incident_Report.pdf", chunk_index: 8 }
  },
  {
    incident_id: "INC-004",
    date: "2025-12-01",
    location: "HR Department – Workstation 07",
    incident_type: "Phishing",
    severity: "Medium",
    description: "Spear-phishing campaign impersonating the CEO targeted HR staff. Three employees clicked the link; no credential entry confirmed. Domain blocked.",
    citation: { filename: "Q4_Incident_Report.pdf", chunk_index: 11 }
  },
  {
    incident_id: "INC-005",
    date: "2025-12-09",
    location: "VPN Gateway – vpn-gw-01 / vpn-gw-02",
    incident_type: "Vulnerability Exploitation",
    severity: "Critical",
    description: "Active exploitation of CVE-2024-21893 (Ivanti SSRF) on perimeter VPN gateways. Possible lateral movement. Patch applied, credentials rotated.",
    citation: { filename: "Dec_Threat_Intel.pdf", chunk_index: 1 }
  },
  {
    incident_id: "INC-006",
    date: "2025-12-14",
    location: "Cloud Storage – s3://acme-logs-prod",
    incident_type: "Data Exfiltration",
    severity: "High",
    description: "Publicly accessible S3 bucket exposed ~80 GB of application logs including partial PII. Bucket ACL tightened, IAM policy updated, legal notified.",
    citation: { filename: "Dec_Threat_Intel.pdf", chunk_index: 4 }
  }
];

// ── State ─────────────────────────────────────────────────────
let allIncidents    = [];
let filtered        = [];
let viewMode        = 'cards';
let lastExtractedJSON = ''; // stores the raw JSON from last RAG run

// ── DOM refs ──────────────────────────────────────────────────
const inputSection    = document.getElementById('input-section');
const newAnalysisBar  = document.getElementById('new-analysis-bar');
const extractedLabel  = document.getElementById('extracted-file-label');
const downloadJsonBtn = document.getElementById('download-json-btn');
const newAnalysisBtn  = document.getElementById('new-analysis-btn');

const dropZone        = document.getElementById('drop-zone');
const reportFileInput = document.getElementById('report-file-input');
const filePreview     = document.getElementById('file-preview');
const fileNameEl      = document.getElementById('file-name');
const clearFileBtn    = document.getElementById('clear-file');
const extractBtn      = document.getElementById('extract-btn');
const extractStatus   = document.getElementById('extract-status');

const validationBox  = document.getElementById('validation-box');
const validationList = document.getElementById('validation-list');

const summaryBar   = document.getElementById('summary-bar');
const statTotal    = document.getElementById('stat-total');
const statCritical = document.getElementById('stat-critical');
const statHigh     = document.getElementById('stat-high');
const statMedium   = document.getElementById('stat-medium');
const statLow      = document.getElementById('stat-low');

const resultsToolbar = document.getElementById('results-toolbar');
const filterInput    = document.getElementById('filter-input');
const filterSeverity = document.getElementById('filter-severity');
const exportJsonBtn  = document.getElementById('export-json');
const exportCsvBtn   = document.getElementById('export-csv');
const exportPdfBtn   = document.getElementById('export-pdf');
const toggleCardsBtn = document.getElementById('toggle-cards');
const toggleTableBtn = document.getElementById('toggle-table');

const cardView   = document.getElementById('card-view');
const tableView  = document.getElementById('table-view');
const tableBody  = document.getElementById('table-body');
const emptyState = document.getElementById('empty-state');

const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');
const modalIdEl    = document.getElementById('modal-id');
const modalTitleEl = document.getElementById('modal-title');
const modalBody    = document.getElementById('modal-body');

// ── Upload / Drag-and-drop (RAG flow) ────────────────────────
let selectedFile = null;

dropZone.addEventListener('click', () => reportFileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});
reportFileInput.addEventListener('change', e => {
  if (e.target.files[0]) setSelectedFile(e.target.files[0]);
  e.target.value = '';
});
clearFileBtn.addEventListener('click', () => setSelectedFile(null));

function setSelectedFile(file) {
  selectedFile = file;
  if (file) {
    fileNameEl.textContent = file.name;
    filePreview.classList.remove('hidden');
    dropZone.classList.add('hidden');
    extractBtn.disabled = false;
  } else {
    filePreview.classList.add('hidden');
    dropZone.classList.remove('hidden');
    extractBtn.disabled = true;
    setExtractStatus('');
  }
}

extractBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  setExtractStatus('Extracting incidents via RAG pipeline…', 'loading');
  extractBtn.disabled = true;

  const fd = new FormData();
  fd.append('file', selectedFile);

  try {
    const resp = await fetch('/api/extract', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok) {
      setExtractStatus('Error: ' + (data.error || resp.statusText), 'error');
      extractBtn.disabled = false;
      return;
    }

    // Store generated JSON for download
    lastExtractedJSON = JSON.stringify(data.incidents, null, 2);

    showValidationErrors(data.validation_errors);
    loadIncidents(data.incidents);

    // Switch to visualization-only view
    inputSection.classList.add('hidden');
    extractedLabel.textContent = `📄 ${selectedFile.name}  —  ${data.incidents.length} incident(s) extracted`;
    newAnalysisBar.classList.remove('hidden');

    // Scroll to results
    document.getElementById('summary-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setExtractStatus('Network error: ' + err.message, 'error');
    extractBtn.disabled = false;
  }
});

// ── New Analysis reset ────────────────────────────────────────
newAnalysisBtn.addEventListener('click', () => {
  newAnalysisBar.classList.add('hidden');
  inputSection.classList.remove('hidden');
  setSelectedFile(null);
  setExtractStatus('');
  clearResults();
  lastExtractedJSON = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Download generated JSON ───────────────────────────────────
downloadJsonBtn.addEventListener('click', () => {
  if (!lastExtractedJSON) return;
  download(lastExtractedJSON, 'extracted_incidents.json', 'application/json');
});

// ── Load & render ─────────────────────────────────────────────
function loadIncidents(incidents) {
  allIncidents = incidents;
  updateSummary();
  applyFilters();
  resultsToolbar.classList.remove('hidden');
  summaryBar.classList.remove('hidden');
}

// ── Filters ───────────────────────────────────────────────────
filterInput.addEventListener('input', applyFilters);
filterSeverity.addEventListener('change', applyFilters);

function applyFilters() {
  const kw  = filterInput.value.trim().toLowerCase();
  const sev = filterSeverity.value;
  filtered = allIncidents.filter(inc => {
    if (sev && inc.severity !== sev) return false;
    if (kw && !JSON.stringify(inc).toLowerCase().includes(kw)) return false;
    return true;
  });
  renderView();
}

// ── View mode ─────────────────────────────────────────────────
toggleCardsBtn.addEventListener('click', () => setViewMode('cards'));
toggleTableBtn.addEventListener('click', () => setViewMode('table'));
exportJsonBtn.addEventListener('click', doExportJSON);
exportCsvBtn.addEventListener('click',  doExportCSV);

function setViewMode(mode) {
  viewMode = mode;
  toggleCardsBtn.classList.toggle('active', mode === 'cards');
  toggleTableBtn.classList.toggle('active', mode === 'table');
  renderView();
}

function renderView() {
  if (filtered.length === 0 && allIncidents.length > 0) {
    cardView.classList.add('hidden');
    tableView.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = '<div class="empty-icon">🔍</div><p>No incidents match your filters.</p>';
    return;
  }
  emptyState.classList.add('hidden');
  if (viewMode === 'cards') {
    tableView.classList.add('hidden');
    cardView.classList.remove('hidden');
    renderCards();
  } else {
    cardView.classList.add('hidden');
    tableView.classList.remove('hidden');
    renderTable();
  }
}

// ── Cards ─────────────────────────────────────────────────────
function renderCards() {
  cardView.innerHTML = '';
  filtered.forEach(inc => {
    const card = document.createElement('div');
    card.className = 'inc-card';
    card.innerHTML = `
      <div class="inc-card-top">
        <div class="inc-header-row">
          <div>
            <div class="inc-id">${esc(inc.incident_id)}</div>
            <div class="inc-title">${esc(inc.incident_type)}</div>
          </div>
          ${pill(inc.severity)}
        </div>
      </div>
      <div class="inc-card-body">
        <div class="inc-row">
          <span class="inc-label">📅 Date</span>
          <span class="inc-value">${esc(inc.date)}</span>
        </div>
        <div class="inc-row">
          <span class="inc-label">📍 Location</span>
          <span class="inc-value">${esc(inc.location)}</span>
        </div>
        <div class="inc-row" style="flex-direction:column;gap:.2rem">
          <span class="inc-label">📝 Description</span>
          <span class="inc-value" style="white-space:normal">${esc(inc.description)}</span>
        </div>
      </div>
      <div class="inc-card-footer">
        <span>📎 ${citationLabel(inc.citation)}</span>
        <span style="color:var(--primary);font-weight:600">Details →</span>
      </div>
    `;
    card.addEventListener('click', () => openModal(inc));
    cardView.appendChild(card);
  });
}

// ── Table (R5) ────────────────────────────────────────────────
function renderTable() {
  tableBody.innerHTML = '';
  filtered.forEach(inc => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(inc.incident_id)}</strong></td>
      <td>${esc(inc.date)}</td>
      <td title="${esc(inc.location)}">${esc(inc.location)}</td>
      <td>${esc(inc.incident_type)}</td>
      <td>${pill(inc.severity)}</td>
      <td title="${esc(inc.description)}">${esc(inc.description)}</td>
      <td title="${citationLabel(inc.citation)}">${citationLabel(inc.citation)}</td>
    `;
    tr.addEventListener('click', () => openModal(inc));
    tableBody.appendChild(tr);
  });
}

// ── Detail Modal ──────────────────────────────────────────────
function openModal(inc) {
  modalIdEl.textContent    = inc.incident_id;
  modalTitleEl.textContent = inc.incident_type;
  const cite = inc.citation || {};
  modalBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-label">Date</div>
        <div class="detail-value">${esc(inc.date)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Severity</div>
        <div class="detail-value">${pill(inc.severity)}</div>
      </div>
      <div class="detail-item detail-full">
        <div class="detail-label">Location</div>
        <div class="detail-value">${esc(inc.location)}</div>
      </div>
      <div class="detail-item detail-full">
        <div class="detail-label">Incident Type</div>
        <div class="detail-value">${esc(inc.incident_type)}</div>
      </div>
      <div class="detail-item detail-full">
        <div class="detail-label">Description</div>
        <div class="detail-value">${esc(inc.description)}</div>
      </div>
      ${cite.filename ? `
      <div class="detail-item detail-full">
        <div class="detail-label">📎 Citation (R4)</div>
        <div class="citation-card">
          <strong>${esc(cite.filename)}</strong>
          ${cite.chunk_index !== undefined ? ` — chunk ${cite.chunk_index}` : ''}
          ${cite.doc_id ? `<br><span style="color:var(--text-muted);font-size:.76rem">doc_id: ${esc(cite.doc_id)}</span>` : ''}
        </div>
      </div>` : ''}
    </div>
  `;
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Summary Bar ───────────────────────────────────────────────
function updateSummary() {
  const c = v => allIncidents.filter(i => i.severity === v).length;
  statTotal.textContent    = `${allIncidents.length} Total`;
  statCritical.textContent = `${c('Critical')} Critical`;
  statHigh.textContent     = `${c('High')} High`;
  statMedium.textContent   = `${c('Medium')} Medium`;
  statLow.textContent      = `${c('Low')} Low`;
}

// ── Exports ───────────────────────────────────────────────────
function doExportJSON() {
  download(JSON.stringify(filtered, null, 2), 'incidents.json', 'application/json');
}
function doExportCSV() {
  const cols = ['incident_id', 'date', 'location', 'incident_type', 'severity', 'description'];
  const header = cols.join(',');
  const rows = filtered.map(inc =>
    cols.map(c => `"${String(inc[c] ?? '').replace(/"/g, '""')}"`).join(',')
  );
  download([header, ...rows].join('\n'), 'incidents.csv', 'text/csv');
}
function download(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Validation errors ─────────────────────────────────────────
function showValidationErrors(errors) {
  if (!errors || !errors.length) { validationBox.classList.add('hidden'); return; }
  validationList.innerHTML = errors.map(e => `<li>${esc(e)}</li>`).join('');
  validationBox.classList.remove('hidden');
}

// ── Helpers ───────────────────────────────────────────────────
function clearResults() {
  allIncidents = []; filtered = [];
  cardView.innerHTML = ''; tableBody.innerHTML = '';
  cardView.classList.add('hidden'); tableView.classList.add('hidden');
  summaryBar.classList.add('hidden'); resultsToolbar.classList.add('hidden');
  validationBox.classList.add('hidden');
  emptyState.classList.remove('hidden');
  emptyState.innerHTML = '';
}
function setExtractStatus(msg, type = '') {
  extractStatus.textContent = msg;
  extractStatus.className   = 'status-msg' + (type ? ' ' + type : '');
  extractStatus.classList.toggle('hidden', !msg);
}
function setInputStatus() {}
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function pill(value) {
  const cls = 'pill-' + String(value || '').replace(/\s+/g, '.');
  return `<span class="pill ${cls}">${esc(value)}</span>`;
}
function citationLabel(cite) {
  if (!cite || !cite.filename) return 'N/A';
  return cite.chunk_index !== undefined
    ? `${cite.filename} [chunk ${cite.chunk_index}]`
    : cite.filename;
}
