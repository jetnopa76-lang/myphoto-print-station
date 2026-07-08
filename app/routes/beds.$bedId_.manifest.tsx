import type { LoaderFunctionArgs } from "@remix-run/node";
import PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import invariant from "tiny-invariant";

import { getBed } from "~/models/bed.server";
import { generatePiecesForBed, piecesForBed } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

function requestOrigin(request: Request): string {
  const host =
    request.headers.get("X-Forwarded-Host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto =
    request.headers.get("X-Forwarded-Proto") ??
    (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const bed = await getBed(params.bedId);
  if (!bed) throw new Response("Bed not found", { status: 404 });

  // Ensure pieces exist so the piece count is accurate.
  await generatePiecesForBed(bed.id);
  const pieces = await piecesForBed(bed.id);
  const origin = requestOrigin(request);

  // A single work-order QR. Scanning it at the print station queues the
  // piece-label strip (Zebra) and the traveler (Star).
  const scanUrl = `${origin}/station/scan/${bed.id}`;
  const qr = await QRCode.toBuffer(scanUrl, {
    type: "png",
    width: 600,
    margin: 1,
  });

  const doc = new PDFDocument({ size: "LETTER", margin: 40 });
  const done = pdfToBuffer(doc);
  const pageW = 612;

  doc.fontSize(28).fillColor("#000000").text(bed.workOrderNum, {
    align: "center",
  });
  doc
    .fontSize(14)
    .fillColor("#555555")
    .text(`${bed.label}   ·   ${pieces.length} pieces`, { align: "center" });
  doc.moveDown(1.5);

  const qrSize = 300;
  doc.image(qr, (pageW - qrSize) / 2, doc.y, { width: qrSize, height: qrSize });
  doc.y += qrSize + 20;

  doc
    .fontSize(13)
    .fillColor("#000000")
    .text("Scan to print piece labels + traveler", { align: "center" });
  doc
    .fontSize(9)
    .fillColor("#999999")
    .text(`Generated ${new Date().toLocaleString()}`, { align: "center" });

  doc.end();
  const buffer = await done;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${bed.workOrderNum}-manifest.pdf"`,
      "Content-Length": String(buffer.length),
    },
  });
};
