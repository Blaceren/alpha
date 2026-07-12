import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getBalanceProvider } from "@/lib/exchange/balanceProvider";

async function main() {
  const accounts = await prisma.exchangeAccount.findMany({
    include: { user: true },
  });

  for (const account of accounts) {
    const provider = getBalanceProvider(account.provider);
    const traderId = account.traderId;
    if (!traderId) {
      console.log(`skip user=${account.userId}: trader_id is missing`);
      continue;
    }
    const result = await provider.getBalanceByTraderId(traderId);

    if (!result.ok || typeof result.balance !== "number") {
      console.log(`skip user=${account.userId}: ${result.message}`);
      continue;
    }

    await prisma.exchangeAccount.update({
      where: { id: account.id },
      data: {
        balance: result.balance,
        lastVerifiedAt: new Date(),
      },
    });

    console.log(`synced user=${account.userId} balance=${result.balance}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
