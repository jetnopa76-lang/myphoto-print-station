// MyPhoto Print Station — local print bridge (Windows).
//
// Polls the Print Station print queue and drives the two USB printers:
//   • Zebra GK420d  — raw ZPL piece labels  (via rawprint.ps1)
//   • Star TSP100III — traveler PDF          (via SumatraPDF)
//
// No npm install needed — uses only Node built-ins (Node 18+).
// Configure config.json (copy from config.example.json), then run:  node bridge.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const CONFIG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Missing config.json — copy config.example.json to config.json and fill it in.");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const pollMs = (cfg.pollSeconds || 4) * 1000;

// Be forgiving about the URL: trim it and add https:// if a scheme is missing.
let baseUrl = String(cfg.printStationUrl || "").trim();
if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = "https://" + baseUrl;
baseUrl = baseUrl.replace(/\/$/, "");
const queueUrl = baseUrl + "/api/print-queue";

function log(...a) {
  console.log(new Date().toLocaleTimeString(), ...a);
}

// Safety net: never reprint the same order within this window, even if the
// "mark done" call fails. Prevents runaway printing.
const REPRINT_COOLDOWN_MS = 60000;
const recentlyPrinted = new Map();

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function printZebra(zpl) {
  const tmp = path.join(os.tmpdir(), `mp-label-${Date.now()}.zpl`);
  fs.writeFileSync(tmp, zpl, "latin1");
  try {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(__dirname, "rawprint.ps1"),
      "-PrinterName",
      cfg.zebraPrinter,
      "-FilePath",
      tmp,
    ]);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function printTraveler(travelerUrl) {
  const res = await fetch(travelerUrl, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`traveler fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `mp-traveler-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    await run(cfg.sumatraPath, [
      "-print-to",
      cfg.starPrinter,
      "-silent",
      tmp,
    ]);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function tick() {
  let data;
  try {
    const res = await fetch(queueUrl, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (!res.ok) {
      log("queue poll failed:", res.status);
      return;
    }
    data = await res.json();
  } catch (e) {
    log("cannot reach Print Station:", e.message);
    return;
  }

  // Each entry is one order the worker approved at the bed.
  for (const job of data.jobs || []) {
    const key = `${job.bedId}:${job.shopifyOrderId}`;
    const printedAt = recentlyPrinted.get(key);
    if (printedAt && Date.now() - printedAt < REPRINT_COOLDOWN_MS) {
      continue; // already printed this order moments ago — skip to avoid runaway
    }
    recentlyPrinted.set(key, Date.now());

    const tag = `${job.workOrderNum} ${job.orderName}`;
    log(`Printing ${tag} — ${job.pieceCount} piece(s)`);
    try {
      await printZebra(job.zebraZpl);
      log(`  ✓ ${job.orderName}: ${job.pieceCount} label(s)`);
    } catch (e) {
      log(`  ✗ ${job.orderName} labels failed:`, e.message);
    }
    try {
      await printTraveler(job.travelerUrl);
      log(`  ✓ ${job.orderName}: traveler`);
    } catch (e) {
      log(`  ✗ ${job.orderName} traveler failed:`, e.message);
    }
    // Ack regardless so it doesn't reprint on every poll. Re-approve the order
    // on the load screen to reprint if something failed.
    try {
      await fetch(queueUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bedId: job.bedId,
          shopifyOrderId: job.shopifyOrderId,
        }),
      });
      log(`  done ${tag}`);
    } catch (e) {
      log(`  ack failed for ${tag}:`, e.message);
    }
  }
}

log(`Print bridge running. Polling ${cfg.printStationUrl} every ${cfg.pollSeconds || 4}s.`);
log(`Zebra: ${cfg.zebraPrinter}  |  Star: ${cfg.starPrinter}`);
setInterval(tick, pollMs);
tick();
