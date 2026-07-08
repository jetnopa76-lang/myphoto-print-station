# Print bridge (Windows station)

Small program that runs on the print-station computer. It watches the Print
Station queue and, when a work-order QR is scanned, prints the piece QR labels
to the **Zebra GK420d** and the travelers to the **Star TSP100III**.

It uses only Node's built-ins — **no `npm install`**.

## One-time setup

1. **Install Node.js** (LTS) on the station PC: https://nodejs.org → run the
   installer → accept defaults. Verify in Command Prompt: `node --version`
   (should print v18 or higher).

2. **Install SumatraPDF** (free, tiny — used to print the traveler PDF to the
   Star). Download the 64-bit build from https://www.sumatrapdfreader.org,
   and note where the `SumatraPDF.exe` ends up (e.g. `C:\Tools\SumatraPDF.exe`).

3. **Find your exact printer names.** Open PowerShell and run:
   ```
   Get-Printer | Select-Object Name
   ```
   Copy the exact names for the Zebra and the Star.

4. **Copy this `bridge` folder** onto the station PC (anywhere, e.g. the
   Desktop).

5. **Make the config.** In the folder, copy `config.example.json` to
   `config.json` and fill in:
   - `token` — the same `PRINT_BRIDGE_TOKEN` you set on Fly.
   - `zebraPrinter` / `starPrinter` — the exact names from step 3.
   - `sumatraPath` — the path from step 2.

## Run it

Open Command Prompt, `cd` into the folder, and run:
```
node bridge.js
```
Leave that window open — it prints a line each time it prints something. To
start it automatically on login later, we can add a shortcut; for testing,
just run it by hand.

## Test

With the bridge running and the app open in a browser, scan a bed's manifest
QR. Within a few seconds the bridge window logs `Printing WO-…`, and the labels
+ traveler come out of the two printers.

## Troubleshooting

- **"cannot reach Print Station"** — check `printStationUrl` and that the PC is
  online.
- **queue poll `401`** — the `token` doesn't match the Fly `PRINT_BRIDGE_TOKEN`.
- **Zebra prints blank / garbage** — the Zebra must accept RAW ZPL. Its driver
  should be the ZDesigner driver; `rawprint.ps1` sends bytes as RAW so the
  driver shouldn't reinterpret them.
- **Star does nothing** — check `sumatraPath` is correct and `starPrinter`
  matches exactly. Try printing a test PDF manually:
  `C:\Tools\SumatraPDF.exe -print-to "Star name" -silent somefile.pdf`
- Nothing happens at all — make sure the bed was actually scanned (it should
  show **Labels queued** in Bed Viewer).
