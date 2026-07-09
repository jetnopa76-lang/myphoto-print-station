import type { LoaderFunctionArgs } from "@remix-run/node";
import PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import invariant from "tiny-invariant";

import { requestOrigin } from "~/lib/bridge.server";
import { bedPiecesForOrder, getBed } from "~/models/bed.server";
import { getOrderScope } from "~/models/order.server";
import { requireStaff } from "~/session.server";

// The bridge (token) or a logged-in staffer (for preview) may fetch a traveler.
async function allowBridgeOrStaff(request: Request): Promise<void> {
  const expected = process.env.PRINT_BRIDGE_TOKEN;
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (expected && token === expected) return;
  await requireStaff(request);
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * 80mm traveler for one order's pieces on a bed. Fetched by the print bridge
 * (token auth) and printed on the Star TSP100III via its driver.
 * URL: /station/traveler/:bedId?order=<shopifyOrderId>
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await allowBridgeOrStaff(request);
  invariant(params.bedId, "bedId is required");
  const shopifyOrderId = new URL(request.url).searchParams.get("order");
  if (!shopifyOrderId) throw new Response("order is required", { status: 400 });

  const bed = await getBed(params.bedId);
  if (!bed) throw new Response("Bed not found", { status: 404 });
  const pieces = await bedPiecesForOrder(bed.id, shopifyOrderId);
  if (pieces.length === 0) throw new Response("No pieces", { status: 404 });

  const job = pieces[0].job;
  const scope = await getOrderScope(job.orderName);
  const onOtherBeds = Math.max(0, scope.totalPieces - pieces.length);
  const origin = requestOrigin(request);
  const orderQr = await QRCode.toBuffer(
    `${origin}/pack/${encodeURIComponent(job.orderName)}`,
    { type: "png", width: 300, margin: 1 },
  );

  const W = 226; // ~80mm
  const M = 12;
  const contentW = W - M * 2;
  const height =
    250 + pieces.length * 16 + (scope.multi ? 60 + scope.breakdown.length * 14 : 0);
  const doc = new PDFDocument({ size: [W, height], margin: M });
  const done = pdfToBuffer(doc);

  doc.fontSize(15).fillColor("#000000").text("TRAVELER", { align: "center" });
  doc.fontSize(11).text(bed.workOrderNum, { align: "center" });
  doc.moveDown(0.5);

  doc.fontSize(18).text(job.orderName, { align: "center" });
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor("#333333")
    .text(job.productTitle, { align: "center", width: contentW });
  doc
    .fontSize(10)
    .text(`${job.size}  ·  ${job.material}`, { align: "center" });
  doc.moveDown(0.5);

  doc
    .fontSize(12)
    .fillColor("#000000")
    .text(`${pieces.length} piece${pieces.length === 1 ? "" : "s"} on this bed`, {
      align: "center",
    });
  doc.moveDown(0.5);

  doc.fontSize(8).fillColor("#666666");
  pieces.forEach((p) => {
    doc.text(`• ${p.qrCode}   (pc ${p.pieceIndex}/${p.job.quantity})`, {
      width: contentW,
    });
  });

  doc.moveDown(0.5);

  // Multi-piece consolidation notice: this order's pieces are split across
  // more than one bed, so the packer must hold this bed's pieces until the
  // rest arrive.
  if (scope.multi) {
    const boxY = doc.y;
    const boxH = 34 + scope.breakdown.length * 12;
    doc.rect(M, boxY, contentW, boxH).fill("#000000");
    doc.fillColor("#ffffff").fontSize(11);
    doc.text(`MULTI-PIECE ORDER — ${scope.totalPieces} PCS`, M + 6, boxY + 5, {
      width: contentW - 12,
    });
    doc.fontSize(8);
    scope.breakdown.forEach((b) => {
      doc.text(`   ${b.size} ${b.material} ×${b.quantity}`, {
        width: contentW - 12,
      });
    });
    doc.y = boxY + boxH + 4;
    doc
      .fontSize(9)
      .fillColor("#000000")
      .text(
        onOtherBeds > 0
          ? `Do NOT ship yet — ${onOtherBeds} more piece${onOtherBeds === 1 ? "" : "s"} on other bed(s).`
          : "Consolidate all pieces before shipping.",
        { align: "center", width: contentW },
      );
    doc.moveDown(0.5);
  } else {
    doc
      .fontSize(9)
      .fillColor("#2e7d32")
      .text("Single-piece order — ready to ship after QC.", {
        align: "center",
        width: contentW,
      });
    doc.moveDown(0.5);
  }
  const qrSize = 110;
  doc.image(orderQr, (W - qrSize) / 2, doc.y, { width: qrSize, height: qrSize });
  doc.y += qrSize + 6;
  doc
    .fontSize(8)
    .fillColor("#999999")
    .text("Scan at packing to consolidate", { align: "center" });

  doc.end();
  const buffer = await done;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${bed.workOrderNum}-${job.orderName}-traveler.pdf"`,
    },
  });
};
