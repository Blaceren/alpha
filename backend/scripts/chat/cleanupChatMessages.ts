import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const channels = await prisma.chatChannel.findMany({ where: { isActive: true } });
  let total = 0;

  for (const channel of channels) {
    const cutoff = new Date(Date.now() - channel.retentionDays * 24 * 60 * 60 * 1000);
    const where = { channelId: channel.id, createdAt: { lt: cutoff } };
    const count = await prisma.chatMessage.count({ where });
    total += count;
    console.log(`${apply ? "delete" : "dry-run"} channel=${channel.slug} cutoff=${cutoff.toISOString()} messages=${count}`);
    if (apply && count > 0) await prisma.chatMessage.deleteMany({ where });
  }

  console.log(`CHAT_CLEANUP_${apply ? "APPLIED" : "DRY_RUN"}: ${total} messages`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
