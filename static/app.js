"use strict";

const $ = id => document.getElementById(id);

let token = "";
let ready = false;
let batchEmails = [];
let batchResults = [];
let batchRunning = false;

const labels = {
  safe: "Reachable",
  risky: "Risky",
  invalid: "Invalid",
  unknown: "Inconclusive"
};

function boolean(value, yes, no) {
  return value === true ? yes : value === false ? no : "Not confirmed";
}

function render(data) {
  const status = Object.hasOwn(labels, data.status) ? data.status : "unknown";
  $("result-email").textContent = data.email;
  $("verdict").textContent = labels[status];
  $("verdict").className = `badge ${status}`;
  $("reason").textContent = data.reason;
  $("timing").textContent = data.elapsed != null ? `${data.elapsed}s` : "";

  const d = data.details || {};
  const syntax = d.syntax || {};
  const mx = d.mx || {};
  const smtp = d.smtp || {};
  const misc = d.misc || {};
  const rows = [
    ["Address format", boolean(syntax.is_valid_syntax, "Valid", "Invalid")],
    ["Domain accepts mail", boolean(mx.accepts_mail, "Yes", "No")],
    ["Mail server connection", boolean(smtp.can_connect_smtp, "Connected", "Not connected")],
    ["Mailbox deliverability", boolean(smtp.is_deliverable, "Reported deliverable", "Not deliverable")],
    ["Accepts any address", boolean(smtp.is_catch_all, "Yes · catch-all", "No")],
    ["Disposable address", boolean(misc.is_disposable, "Yes", "No")]
  ];

  $("checks").replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));

  $("raw").textContent = JSON.stringify(data.details, null, 2);
  $("raw-details").hidden = !data.details;
  $("raw-details").open = false;
  $("result").hidden = false;
}

async function readResponse(response) {
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) {
    throw new Error(
      `The forwarded app returned HTTP ${response.status}. Open port 8765 in a new browser tab and sign in to GitHub if prompted.`
    );
  }
  return response.json();
}

async function refreshSession() {
  const response = await fetch("/api/status", {
    cache: "no-store",
    credentials: "same-origin"
  });
  const data = await readResponse(response);
  if (!response.ok) throw new Error(data.error || "Could not reconnect to the app.");
  token = data.token;
  return data;
}

async function postCheck(path, email) {
  await refreshSession();

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Mailcheck-Token": token
      },
      body: JSON.stringify({ email })
    });

    const data = await readResponse(response);

    if (response.status === 403 && data.code === "session_expired" && attempt === 0) {
      await refreshSession();
      continue;
    }

    if (!response.ok) {
      throw new Error(data.error || `The check failed (HTTP ${response.status}).`);
    }

    return data;
  }

  throw new Error("The session could not be refreshed.");
}

function submitCheck(email) {
  return postCheck("/api/check", email);
}

function submitBatchCheck(email) {
  return postCheck("/api/batch-check", email);
}

function setError(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function parseBatchText(text) {
  const seen = new Set();
  const rows = [];

  for (const raw of text.split(/\r?\n/)) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    rows.push(value);
  }

  return rows;
}

function updateBatchControls() {
  $("batch-start").disabled = !ready || batchRunning || batchEmails.length === 0;
  $("batch-file").disabled = batchRunning;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCsv(rows) {
  const headers = ["email", "status", "reason", "elapsed"];
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push([
      csvCell(row.email),
      csvCell(row.status),
      csvCell(row.reason),
      csvCell(row.elapsed)
    ].join(","));
  }

  return lines.join("\r\n");
}

function reachableBatchResults() {
  return batchResults.filter(row => row.status === "safe");
}

function downloadBatchCsv() {
  const reachable = reachableBatchResults();
  if (!reachable.length) {
    setError("No reachable addresses were found to export.");
    return;
  }

  const blob = new Blob([buildCsv(reachable)], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  a.href = url;
  a.download = `mailcheck-reachable-${stamp}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setBatchProgress(done, total, email = "") {
  const percent = total ? Math.round((done / total) * 100) : 0;
  $("batch-progress-bar").style.width = `${percent}%`;
  $("batch-progress").textContent = total
    ? `${done} / ${total}${email ? ` · ${email}` : ""}`
    : "";
}

function summarizeBatch(rows) {
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const ordered = [
    ["safe", "reachable"],
    ["risky", "risky"],
    ["invalid", "invalid"],
    ["unknown", "inconclusive"],
    ["syntax_only", "syntax-only"],
    ["invalid_syntax", "invalid syntax"],
    ["error", "errors"]
  ];

  const parts = ordered
    .filter(([key]) => counts[key])
    .map(([key, label]) => `${counts[key]} ${label}`);

  $("batch-summary").textContent = parts.length ? parts.join(" · ") : "No rows processed.";
  $("batch-summary").hidden = false;
}

async function runBatch() {
  if (!ready || batchRunning || batchEmails.length === 0) return;

  batchRunning = true;
  batchResults = [];
  updateBatchControls();
  setError("");

  $("batch-download").hidden = true;
  $("batch-summary").hidden = true;
  $("batch-progress-wrap").hidden = false;
  setBatchProgress(0, batchEmails.length);

  for (let index = 0; index < batchEmails.length; index++) {
    const email = batchEmails[index];
    setBatchProgress(index, batchEmails.length, email);

    try {
      const result = await submitBatchCheck(email);
      batchResults.push({
        email: result.email ?? email,
        status: result.status ?? "unknown",
        reason: result.reason ?? "",
        elapsed: result.elapsed ?? ""
      });
    } catch (error) {
      batchResults.push({
        email,
        status: "error",
        reason: error.message || "Batch check failed.",
        elapsed: ""
      });
    }

    setBatchProgress(index + 1, batchEmails.length, email);
  }

  summarizeBatch(batchResults);
  $("batch-download").hidden = reachableBatchResults().length === 0;
  batchRunning = false;
  updateBatchControls();
}

async function boot() {
  try {
    const data = await refreshSession();
    token = data.token;
    ready = data.ready;

    if (data.codespaces) {
      $("runtime-label").textContent = "Runs in your Codespace";
      document.querySelector(".local").textContent = "CODESPACE";
    }

    $("engine").textContent = ready ? "Reacher ready" : "Reacher needs installation";
    $("engine").className = `engine ${ready ? "ready" : "missing"}`;
    $("check-button").disabled = !ready;

    if (!ready) {
      setError(
        "Run python3 setup_reacher.py in the app folder, then refresh this page. Windows users: use Start-Windows.bat. See README.md for setup."
      );
    }

    updateBatchControls();
  } catch {
    $("engine").textContent = "App server unavailable";
    setError(
      "Start the app with python3 app.py and open http://127.0.0.1:8765. Keep the terminal window open."
    );
  }
}

$("check-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!ready || $("check-button").disabled) return;

  const email = $("email").value.trim();
  setError("");

  if (!email || !$("email").checkValidity()) {
    setError("Enter one email address, such as name@company.com.");
    $("email").focus();
    return;
  }

  $("empty").hidden = true;
  $("result").hidden = true;
  $("loading").hidden = false;
  $("timing").textContent = "";
  $("check-button").disabled = true;
  $("email").readOnly = true;
  document.querySelector(".result-panel").setAttribute("aria-busy", "true");

  try {
    render(await submitCheck(email));
  } catch (error) {
    setError(
      error.message === "Failed to fetch"
        ? "The local app disconnected. Restart it and refresh this page."
        : error.message
    );
    $("empty").hidden = false;
  } finally {
    $("loading").hidden = true;
    $("check-button").disabled = false;
    $("email").readOnly = false;
    document.querySelector(".result-panel").setAttribute("aria-busy", "false");
  }
});

$("batch-file").addEventListener("change", async event => {
  setError("");
  batchResults = [];
  $("batch-download").hidden = true;
  $("batch-summary").hidden = true;
  $("batch-progress-wrap").hidden = true;

  const file = event.target.files?.[0];
  if (!file) {
    batchEmails = [];
    $("batch-file-meta").textContent = "One email address per line. Duplicate lines are removed.";
    updateBatchControls();
    return;
  }

  try {
    const text = await file.text();
    batchEmails = parseBatchText(text);

    if (!batchEmails.length) {
      throw new Error("The text file does not contain any non-empty lines.");
    }

    if (batchEmails.length > 5000) {
      batchEmails = [];
      throw new Error("For one batch, use at most 5,000 unique lines.");
    }

    $("batch-file-meta").textContent =
      `${file.name} · ${batchEmails.length.toLocaleString()} unique address${batchEmails.length === 1 ? "" : "es"}`;
  } catch (error) {
    batchEmails = [];
    setError(error.message || "Could not read the uploaded text file.");
  }

  updateBatchControls();
});

$("batch-start").addEventListener("click", runBatch);
$("batch-download").addEventListener("click", downloadBatchCsv);

boot();
