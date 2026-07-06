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

  // Ensure pieces exist so the manifest always has QR codes.
  await generatePiecesForBed(bed.id);
  const pieces = await piecesForBed(bed.id);

  const origin = requestOrigin(request);

  // Pre-render every QR code to a PNG buffer.
  const qrBuffers = await Promise.all(
    pieces.map((piece) =>
      QRCode.toBuffer(`${origin}/scan/${piece.qrCode}`, {
        type: "png",
        width: 220,
        margin: 1,
      }),
    ),
  );

  const doc = new PDFDocument({ size: "LETTER", margin: 40 });
  const done = pdfToBuffer(doc);

  doc.fontSize(20).text(`Bed manifest — ${bed.workOrderNum}`);
  doc
    .fontSize(11)
    .fillColor("#555555")
    .text(`${bed.label}   ·   ${pieces.length} pieces`)
    .text(`Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);
  doc.fillColor("#000000");

  const qrSize = 90;
  const rowHeight = 110;
  const textX = 40 + qrSize + 16;
  let y = doc.y;

  pieces.forEach((piece, i) => {
    if (y + rowHeight > doc.page.height - 40) {
      doc.addPage();
      y = 40;
    }

    doc.image(qrBuffers[i], 40, y, { width: qrSize, height: qrSize });

    doc
      .fontSize(13)
      .fillColor("#000000")
      .text(`${piece.job.orderName} — ${piece.job.productTitle}`, textX, y + 6, {
        width: 612 - textX - 40,
      });
    doc
      .fontSize(10)
      .fillColor("#555555")
      .text(
        `${piece.job.size}  ·  ${piece.job.material}  ·  piece ${piece.pieceIndex} of ${piece.job.quantity}`,
        textX,
        y + 30,
      );
    doc.fillColor("#888888").text(piece.qrCode, textX, y + 46);

    y += rowHeight;
  });

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
