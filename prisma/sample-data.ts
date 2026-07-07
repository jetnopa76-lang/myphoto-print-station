import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// A few fake myphoto orders spread across size/material groups so the
// dashboard and Beds page have something to work with. Safe to re-run:
// jobs are upserted on lineItemKey, so you won't get duplicates.
//
// Run with:  npx tsx prisma/sample-data.ts
// Remove with: npx tsx prisma/sample-data.ts --clear

type Sample = {
  order: string;
  orderId: string;
  lineItemId: string;
  sku: string;
  productTitle: string;
  variantTitle: string;
  size: string;
  material: string;
  quantity: number;
  imageUrl: string;
};

const SAMPLES: Sample[] = [
  {
    order: "#2001",
    orderId: "2001",
    lineItemId: "1",
    sku: "ACR-5X7",
    productTitle: "Acrylic Photo Block",
    variantTitle: "5x7",
    size: "5x7",
    material: "Acrylic Block",
    quantity: 2,
    imageUrl: "https://picsum.photos/seed/2001a/1500/2100",
  },
  {
    order: "#2002",
    orderId: "2002",
    lineItemId: "1",
    sku: "ACR-5X7",
    productTitle: "Acrylic Photo Block",
    variantTitle: "5x7",
    size: "5x7",
    material: "Acrylic Block",
    quantity: 1,
    imageUrl: "https://picsum.photos/seed/2002a/1500/2100",
  },
  {
    order: "#2003",
    orderId: "2003",
    lineItemId: "1",
    sku: "MET-8X10",
    productTitle: "Metal Print",
    variantTitle: "8x10",
    size: "8x10",
    material: "Metal Print",
    quantity: 3,
    imageUrl: "https://picsum.photos/seed/2003a/2000/2500",
  },
  {
    order: "#2004",
    orderId: "2004",
    lineItemId: "1",
    sku: "MET-8X10",
    productTitle: "Metal Print",
    variantTitle: "8x10",
    size: "8x10",
    material: "Metal Print",
    quantity: 1,
    imageUrl: "https://picsum.photos/seed/2004a/2000/2500",
  },
  {
    order: "#2005",
    orderId: "2005",
    lineItemId: "1",
    sku: "CAN-11X14",
    productTitle: "Canvas Wrap",
    variantTitle: "11x14",
    size: "11x14",
    material: "Canvas",
    quantity: 1,
    imageUrl: "https://picsum.photos/seed/2005a/2200/2800",
  },
  {
    order: "#2005",
    orderId: "2005",
    lineItemId: "2",
    sku: "ACR-5X7",
    productTitle: "Acrylic Photo Block",
    variantTitle: "5x7",
    size: "5x7",
    material: "Acrylic Block",
    quantity: 1,
    imageUrl: "https://picsum.photos/seed/2005b/1500/2100",
  },
];

async function clear() {
  const keys = SAMPLES.map((s) => `${s.orderId}-${s.lineItemId}`);
  const jobs = await prisma.printJob.findMany({
    where: { lineItemKey: { in: keys } },
    select: { id: true },
  });
  const ids = jobs.map((j) => j.id);
  if (ids.length === 0) {
    console.log("No sample jobs to clear.");
    return;
  }
  // Remove pieces/beditems/events that reference these jobs first.
  await prisma.pieceEvent.deleteMany({
    where: { piece: { jobId: { in: ids } } },
  });
  await prisma.printPiece.deleteMany({ where: { jobId: { in: ids } } });
  await prisma.bedItem.deleteMany({ where: { jobId: { in: ids } } });
  await prisma.printJobEvent.deleteMany({ where: { jobId: { in: ids } } });
  await prisma.printJob.deleteMany({ where: { id: { in: ids } } });
  console.log(`Cleared ${ids.length} sample jobs.`);
}

async function seed() {
  for (const s of SAMPLES) {
    const lineItemKey = `${s.orderId}-${s.lineItemId}`;
    const properties = [{ name: "_image_url", value: s.imageUrl }];
    await prisma.printJob.upsert({
      where: { lineItemKey },
      update: {},
      create: {
        shopifyOrderId: `gid://shopify/Order/${s.orderId}`,
        orderName: s.order,
        lineItemId: s.lineItemId,
        lineItemKey,
        sku: s.sku,
        productHandle: s.productTitle.toLowerCase().replace(/\s+/g, "-"),
        productTitle: s.productTitle,
        variantTitle: s.variantTitle,
        size: s.size,
        material: s.material,
        quantity: s.quantity,
        properties,
        frameCount: 1,
        status: "pending",
        events: {
          create: { action: "created", note: "Sample data" },
        },
      },
    });
  }
  const count = await prisma.printJob.count({ where: { status: "pending" } });
  console.log(
    `Sample data loaded. ${SAMPLES.length} jobs upserted; ${count} pending jobs total. 🌱`,
  );
}

async function main() {
  if (process.argv.includes("--clear")) {
    await clear();
  } else {
    // Reset first so every run gives a fresh set of *pending* orders,
    // even if a previous run's jobs were batched into beds.
    await clear();
    await seed();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
