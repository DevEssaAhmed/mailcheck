"use strict";

const $ = id => document.getElementById(id);

let token = "";
let ready = false;

let batchEmails = [];
let batchResults = [];
let batchRunning = false;

// Default only. The backend value from /api/status will overwrite this.
let maxConcurrent = 4;

const labels = {
  safe: "Reachable",
  risky: "Risky",
  invalid: "Invalid",
  unknown: "Inconclusive"
};


/* =========================================================
   GENERAL HELPERS
========================================================= */

function boolean(value, yes, no) {
  return value === true
    ? yes
    : value === false
      ? no
      : "Not confirmed";
}


function setError(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}


/* =========================================================
   SINGLE RESULT RENDERING
========================================================= */

function render(data) {
  const status = Object.hasOwn(labels, data.status)
    ? data.status
    : "unknown";

  $("result-email").textContent = data.email;
  $("verdict").textContent = labels[status];
  $("verdict").className = `badge ${status}`;
  $("reason").textContent = data.reason || "";

  $("timing").textContent =
    data.elapsed != null
      ? `${data.elapsed}s`
      : "";

  const d = data.details || {};

  const syntax = d.syntax || {};
  const mx = d.mx || {};
  const smtp = d.smtp || {};
  const misc = d.misc || {};

  const rows = [
    [
      "Address format",
      boolean(
        syntax.is_valid_syntax,
        "Valid",
        "Invalid"
      )
    ],

    [
      "Domain accepts mail",
      boolean(
        mx.accepts_mail,
        "Yes",
        "No"
      )
    ],

    [
      "Mail server connection",
      boolean(
        smtp.can_connect_smtp,
        "Connected",
        "Not connected"
      )
    ],

    [
      "Mailbox deliverability",
      boolean(
        smtp.is_deliverable,
        "Reported deliverable",
        "Not deliverable"
      )
    ],

    [
      "Accepts any address",
      boolean(
        smtp.is_catch_all,
        "Yes · catch-all",
        "No"
      )
    ],

    [
      "Disposable address",
      boolean(
        misc.is_disposable,
        "Yes",
        "No"
      )
    ]
  ];

  $("checks").replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");

      dt.textContent = label;
      dd.textContent = value;

      row.append(dt, dd);

      return row;
    })
  );

  $("raw").textContent =
    JSON.stringify(data.details, null, 2);

  $("raw-details").hidden = !data.details;
  $("raw-details").open = false;

  $("result").hidden = false;
}


/* =========================================================
   API
========================================================= */

async function readResponse(response) {
  const type =
    response.headers.get("Content-Type") || "";

  if (!type.includes("application/json")) {
    throw new Error(
      `The forwarded app returned HTTP ${response.status}. ` +
      "Open port 8765 in a new browser tab and sign in to GitHub if prompted."
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

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Could not reconnect to the app."
    );
  }

  token = data.token;

  ready = Boolean(data.ready);

  if (
    typeof data.max_concurrent === "number" &&
    Number.isFinite(data.max_concurrent) &&
    data.max_concurrent > 0
  ) {
    maxConcurrent =
      Math.floor(data.max_concurrent);
  }

  return data;
}


/*
 * Does NOT refresh /api/status before every request.
 *
 * The current token is used immediately.
 *
 * If the backend reports that the session expired,
 * the token is refreshed once and the request is retried.
 */
async function postCheck(path, email) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(path, {
      method: "POST",

      credentials: "same-origin",

      headers: {
        "Content-Type": "application/json",
        "X-Mailcheck-Token": token
      },

      body: JSON.stringify({
        email
      })
    });

    const data = await readResponse(response);

    if (
      response.status === 403 &&
      data.code === "session_expired" &&
      attempt === 0
    ) {
      await refreshSession();
      continue;
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        `The check failed (HTTP ${response.status}).`
      );
    }

    return data;
  }

  throw new Error(
    "The session could not be refreshed."
  );
}


function submitCheck(email) {
  return postCheck(
    "/api/check",
    email
  );
}


function submitBatchCheck(email) {
  return postCheck(
    "/api/batch-check",
    email
  );
}


/* =========================================================
   BATCH INPUT
========================================================= */

function parseBatchText(text) {
  const seen = new Set();
  const rows = [];

  for (const raw of text.split(/\r?\n/)) {
    const value = raw.trim();

    if (!value) {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    rows.push(value);
  }

  return rows;
}


function updateBatchControls() {
  $("batch-start").disabled =
    !ready ||
    batchRunning ||
    batchEmails.length === 0;

  $("batch-file").disabled =
    batchRunning;
}


/* =========================================================
   CSV EXPORT
========================================================= */

function csvCell(value) {
  const text =
    value == null
      ? ""
      : String(value);

  return `"${text.replaceAll('"', '""')}"`;
}


function buildCsv(rows) {
  const headers = [
    "email",
    "status",
    "reason",
    "elapsed"
  ];

  const lines = [
    headers.join(",")
  ];

  for (const row of rows) {
    lines.push(
      [
        csvCell(row.email),
        csvCell(row.status),
        csvCell(row.reason),
        csvCell(row.elapsed)
      ].join(",")
    );
  }

  return lines.join("\r\n");
}


/*
 * Only SAFE / REACHABLE addresses are exported.
 */
function reachableBatchResults() {
  return batchResults.filter(
    row =>
      row &&
      row.status === "safe"
  );
}


function downloadBatchCsv() {
  const reachable =
    reachableBatchResults();

  if (!reachable.length) {
    setError(
      "No reachable addresses were found to export."
    );

    return;
  }

  const blob = new Blob(
    [buildCsv(reachable)],
    {
      type: "text/csv;charset=utf-8"
    }
  );

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  const stamp =
    new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d{3}Z$/, "Z");

  a.href = url;

  a.download =
    `mailcheck-reachable-${stamp}.csv`;

  document.body.append(a);

  a.click();

  a.remove();

  URL.revokeObjectURL(url);
}


/* =========================================================
   BATCH PROGRESS
========================================================= */

function setBatchProgress(
  done,
  total,
  email = ""
) {
  const percent =
    total
      ? Math.round(
          (done / total) * 100
        )
      : 0;

  $("batch-progress-bar").style.width =
    `${percent}%`;

  $("batch-progress").textContent =
    total
      ? `${done} / ${total}${
          email
            ? ` · ${email}`
            : ""
        }`
      : "";
}


/* =========================================================
   BATCH SUMMARY
========================================================= */

function summarizeBatch(rows) {
  const counts = rows.reduce(
    (acc, row) => {
      if (!row) {
        return acc;
      }

      const status =
        row.status || "unknown";

      acc[status] =
        (acc[status] || 0) + 1;

      return acc;
    },
    {}
  );

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
    .filter(
      ([key]) =>
        counts[key]
    )
    .map(
      ([key, label]) =>
        `${counts[key]} ${label}`
    );

  $("batch-summary").textContent =
    parts.length
      ? parts.join(" · ")
      : "No rows processed.";

  $("batch-summary").hidden = false;
}


/* =========================================================
   BATCH CHECKER
========================================================= */

/*
 * PARALLEL WORKER POOL
 *
 * Example:
 *
 * maxConcurrent = 4
 *
 * Worker 1 -> address 1
 * Worker 2 -> address 2
 * Worker 3 -> address 3
 * Worker 4 -> address 4
 *
 * When Worker 2 finishes:
 *
 * Worker 2 -> address 5
 *
 * etc.
 *
 * Therefore the batch is NOT processed one-by-one.
 */
async function runBatch() {
  if (
    !ready ||
    batchRunning ||
    batchEmails.length === 0
  ) {
    return;
  }

  batchRunning = true;

  batchResults = [];

  updateBatchControls();

  setError("");

  $("batch-download").hidden = true;

  $("batch-summary").hidden = true;

  $("batch-progress-wrap").hidden =
    false;

  setBatchProgress(
    0,
    batchEmails.length
  );


  /*
   * Refresh ONCE before the batch begins.
   *
   * We do not make /api/status requests
   * for every individual email.
   */
  try {
    const status =
      await refreshSession();

    if (!status.ready) {
      throw new Error(
        "Reacher is not ready."
      );
    }
  } catch (error) {
    batchRunning = false;

    setError(
      error.message ||
      "Could not start the batch."
    );

    updateBatchControls();

    return;
  }


  const total =
    batchEmails.length;

  let completed = 0;

  let nextIndex = 0;


  /*
   * Each worker repeatedly takes
   * the next available address.
   */
  async function worker() {
    while (true) {
      const index =
        nextIndex++;

      if (index >= total) {
        return;
      }

      const email =
        batchEmails[index];

      setBatchProgress(
        completed,
        total,
        email
      );

      try {
        const result =
          await submitBatchCheck(email);

        batchResults[index] = {
          email:
            result.email ??
            email,

          status:
            result.status ??
            "unknown",

          reason:
            result.reason ??
            "",

          elapsed:
            result.elapsed ??
            ""
        };
      } catch (error) {
        batchResults[index] = {
          email,

          status: "error",

          reason:
            error.message ||
            "Batch check failed.",

          elapsed: ""
        };
      }

      completed++;

      setBatchProgress(
        completed,
        total,
        email
      );
    }
  }


  /*
   * Do not create more workers
   * than there are addresses.
   */
  const workerCount =
    Math.min(
      maxConcurrent,
      total
    );

  const workers =
    Array.from(
      {
        length: workerCount
      },
      () => worker()
    );


  /*
   * All workers execute concurrently.
   */
  await Promise.all(workers);


  /*
   * Rebuild as a dense array
   * while preserving the same order
   * as the uploaded text file.
   */
  batchResults =
    Array.from(
      {
        length: total
      },
      (_, index) =>
        batchResults[index] || {
          email:
            batchEmails[index],

          status:
            "error",

          reason:
            "No result returned.",

          elapsed:
            ""
        }
    );


  summarizeBatch(
    batchResults
  );


  /*
   * Download button only appears
   * if at least one SAFE address exists.
   */
  $("batch-download").hidden =
    reachableBatchResults().length === 0;


  batchRunning = false;

  updateBatchControls();
}


/* =========================================================
   APP BOOT
========================================================= */

async function boot() {
  try {
    const data =
      await refreshSession();

    token = data.token;

    ready =
      Boolean(data.ready);


    if (data.codespaces) {
      $("runtime-label").textContent =
        "Runs in your Codespace";

      const local =
        document.querySelector(".local");

      if (local) {
        local.textContent =
          "CODESPACE";
      }
    }


    $("engine").textContent =
      ready
        ? `Reacher ready · ${maxConcurrent} parallel`
        : "Reacher needs installation";


    $("engine").className =
      `engine ${
        ready
          ? "ready"
          : "missing"
      }`;


    $("check-button").disabled =
      !ready;


    if (!ready) {
      setError(
        "Run python3 setup_reacher.py in the app folder, then refresh this page. " +
        "Windows users: use Start-Windows.bat. See README.md for setup."
      );
    }


    updateBatchControls();

  } catch (error) {

    ready = false;

    $("engine").textContent =
      "App server unavailable";


    $("check-button").disabled =
      true;


    setError(
      "Start the app with python3 app.py and open http://127.0.0.1:8765. " +
      "Keep the terminal window open."
    );


    updateBatchControls();
  }
}


/* =========================================================
   SINGLE EMAIL FORM
========================================================= */

$("check-form").addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    if (
      !ready ||
      $("check-button").disabled
    ) {
      return;
    }


    const email =
      $("email")
        .value
        .trim();


    setError("");


    if (
      !email ||
      !$("email").checkValidity()
    ) {

      setError(
        "Enter one email address, such as name@company.com."
      );

      $("email").focus();

      return;
    }


    $("empty").hidden = true;

    $("result").hidden = true;

    $("loading").hidden = false;

    $("timing").textContent = "";

    $("check-button").disabled =
      true;

    $("email").readOnly =
      true;


    const resultPanel =
      document.querySelector(
        ".result-panel"
      );

    if (resultPanel) {
      resultPanel.setAttribute(
        "aria-busy",
        "true"
      );
    }


    try {

      /*
       * Refresh once before a normal
       * individual check.
       */
      await refreshSession();

      const result =
        await submitCheck(email);

      render(result);

    } catch (error) {

      setError(
        error.message ===
          "Failed to fetch"
          ? "The local app disconnected. Restart it and refresh this page."
          : error.message
      );

      $("empty").hidden = false;

    } finally {

      $("loading").hidden = true;

      $("check-button").disabled =
        !ready;

      $("email").readOnly =
        false;


      if (resultPanel) {
        resultPanel.setAttribute(
          "aria-busy",
          "false"
        );
      }
    }
  }
);


/* =========================================================
   BATCH FILE UPLOAD
========================================================= */

$("batch-file").addEventListener(
  "change",
  async event => {

    setError("");

    batchResults = [];

    $("batch-download").hidden =
      true;

    $("batch-summary").hidden =
      true;

    $("batch-progress-wrap").hidden =
      true;


    const file =
      event.target.files?.[0];


    if (!file) {

      batchEmails = [];

      $("batch-file-meta").textContent =
        "One email address per line. Duplicate lines are removed.";

      updateBatchControls();

      return;
    }


    try {

      const text =
        await file.text();


      batchEmails =
        parseBatchText(text);


      if (!batchEmails.length) {

        throw new Error(
          "The text file does not contain any non-empty lines."
        );
      }


      if (
        batchEmails.length >
        5000
      ) {

        batchEmails = [];

        throw new Error(
          "For one batch, use at most 5,000 unique lines."
        );
      }


      $("batch-file-meta").textContent =
        `${file.name} · ` +
        `${batchEmails.length.toLocaleString()} ` +
        `unique address${
          batchEmails.length === 1
            ? ""
            : "es"
        }`;


    } catch (error) {

      batchEmails = [];

      setError(
        error.message ||
        "Could not read the uploaded text file."
      );
    }


    updateBatchControls();
  }
);


/* =========================================================
   BUTTON EVENTS
========================================================= */

$("batch-start").addEventListener(
  "click",
  runBatch
);


$("batch-download").addEventListener(
  "click",
  downloadBatchCsv
);


/* =========================================================
   START APPLICATION
========================================================= */

boot();