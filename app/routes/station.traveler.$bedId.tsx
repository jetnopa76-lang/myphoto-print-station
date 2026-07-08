import type { LoaderFunctionArgs } from "@remix-run/node";
import PDFDocument from "pdfkit";
import * as QRCode from "qrcode";
import invariant from "tiny-invariant";

import { requestOrigin, requireBridgeToken } from "~/lib/bridge.server";
import { bedPiecesForOrder, getBed } from "~/models/bed.server";

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
  requireBridgeToken(request);
  invariant(params.bedId, "bedId is required");
  const shopifyOrderId = new URL(request.url).searchParams.get("order");
  if (!shopifyOrderId) throw new Response("order is required", { status: 400 });

  const bed = await getBed(params.bedId);
  if (!bed) throw new Response("Bed not found", { status: 404 });
  const pieces = await bedPiecesForOrder(bed.id, shopifyOrderId);
  if (pieces.length === 0) throw new Response("No pieces", { status: 404 });

  const job = pieces[0].job;
  const origin = requestOrigin(request);
  const orderQr = await QRCode.toBuffer(
    `${origin}/pack/${encodeURIComponent(job.orderName)}`,
    { type: "png", width: 300, margin: 1 },
  );

  const W = 226; // ~80mm
  const M = 12;
  const contentW = W - M * 2;
  const height = 250 + pieces.length * 16;
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
