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

function log(...a) {
  console.log(new Date().toLocaleTimeString(), ...a);
}

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
    const res = await fetch(
      cfg.printStationUrl.replace(/\/$/, "") + "/api/print-queue",
      { headers: { Authorization: `Bearer ${cfg.token}` } },
    );
    if (!res.ok) {
      log("queue poll failed:", res.status);
      return;
    }
    data = await res.json();
  } catch (e) {
    log("cannot reach Print Station:", e.message);
    return;
  }

  for (const bed of data.beds || []) {
    log(`Printing ${bed.workOrderNum} — ${bed.orders.length} order(s)`);
    try {
      for (const order of bed.orders) {
        await printZebra(order.zebraZpl);
        await printTraveler(order.travelerUrl);
        log(`  ✓ ${order.orderName}: ${order.pieceCount} label(s) + traveler`);
      }
      await fetch(
        cfg.printStationUrl.replace(/\/$/, "") + "/api/print-queue",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ bedId: bed.bedId }),
        },
      );
      log(`  done ${bed.workOrderNum}`);
    } catch (e) {
      log(`  ✗ ${bed.workOrderNum} failed:`, e.message, "(will retry next poll)");
    }
  }
}

log(`Print bridge running. Polling ${cfg.printStationUrl} every ${cfg.pollSeconds || 4}s.`);
log(`Zebra: ${cfg.zebraPrinter}  |  Star: ${cfg.starPrinter}`);
setInterval(tick, pollMs);
tick();
