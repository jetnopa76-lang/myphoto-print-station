import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seed() {
  const staff = [
    { name: "Admin", pin: "1234", role: "admin" },
    { name: "Operator", pin: "1111", role: "operator" },
    { name: "Supervisor", pin: "2222", role: "supervisor" },
  ];

  for (const { name, pin, role } of staff) {
    const pinHash = await bcrypt.hash(pin, 10);
    await prisma.staff.upsert({
      where: { name },
      update: { pinHash, role, active: true },
      create: { name, pinHash, role },
    });
  }

  console.log(`Database has been seeded. 🌱`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
