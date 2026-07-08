// ZPL generation for the Zebra GK420d (203 dpi thermal label printer).
// One 2" x 1" label per piece: a QR (encoding the piece's scan URL) on the
// left, order + piece details on the right.

const DPI = 203;
const LABEL_W = Math.round(2 * DPI); // 406 dots
const LABEL_H = Math.round(1 * DPI); // 203 dots

export interface LabelPiece {
  qrCode: string;
  orderName: string;
  size: string;
  material: string;
  pieceIndex: number;
  pieceCount: number;
}

function escapeZpl(text: string): string {
  // ^ and ~ are ZPL control chars; strip them from field data.
  return text.replace(/[\^~]/g, " ");
}

/** ZPL for a single 2"x1" piece label. */
export function pieceLabelZpl(piece: LabelPiece, origin: string): string {
  const url = `${origin}/scan/${piece.qrCode}`;
  const order = escapeZpl(piece.orderName);
  const line2 = escapeZpl(`${piece.size} ${piece.material}`);
  const line3 = `Pc ${piece.pieceIndex}/${piece.pieceCount}`;
  return [
    "^XA",
    "^CI28", // UTF-8
    `^PW${LABEL_W}`,
    `^LL${LABEL_H}`,
    "^LH0,0",
    // QR on the left. ^BQN,2,5 = model 2, magnification 5.
    "^FO16,40^BQN,2,5",
    `^FDLA,${url}^FS`,
    // Text block on the right.
    `^FO200,30^A0N,30,30^FD${order}^FS`,
    `^FO200,75^A0N,24,24^FD${line2}^FS`,
    `^FO200,115^A0N,22,22^FD${line3}^FS`,
    `^FO200,150^A0N,18,18^FD${escapeZpl(piece.qrCode)}^FS`,
    "^XZ",
  ].join("\n");
}

/** ZPL for a batch of piece labels (one order's pieces on a bed). */
export function orderLabelsZpl(pieces: LabelPiece[], origin: string): string {
  return pieces.map((p) => pieceLabelZpl(p, origin)).join("\n");
}
