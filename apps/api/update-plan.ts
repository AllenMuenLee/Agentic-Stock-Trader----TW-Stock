import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.updateMany({
    where: { email: 'limuen.allen@gmail.com' },
    data: { plan: 'UNLIMITED' },
  });
  console.log(`Updated ${result.count} user(s) plan to UNLIMITED`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
