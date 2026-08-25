/**
 * Adopt productions that predate user accounts.
 *
 * `owner_id` had to be nullable so the column could be added to a database that
 * already held rows. The API treats an unowned production as invisible rather
 * than as public, which is the safe default and also means anything imported
 * before this change has disappeared from the interface. This hands it to
 * somebody.
 *
 *   node scripts/claim-orphan-productions.js you@example.com
 *   node scripts/claim-orphan-productions.js you@example.com --dry-run
 */

import { prisma } from '../src/db.js';

const [email, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!email) {
  console.error('Usage: node scripts/claim-orphan-productions.js <email> [--dry-run]');
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
if (!user) {
  console.error(`No account for ${email}. Register first, then run this.`);
  process.exit(1);
}

const orphans = await prisma.production.findMany({
  where: { ownerId: null },
  orderBy: { createdAt: 'asc' },
});

if (!orphans.length) {
  console.log('No unowned productions. Nothing to do.');
  process.exit(0);
}

console.log(`${orphans.length} unowned production(s):`);
for (const production of orphans) {
  console.log(`  ${production.id}  ${production.title}`);
}

if (dryRun) {
  console.log(`\n--dry-run: nothing changed. Re-run without it to give these to ${user.email}.`);
  process.exit(0);
}

const { count } = await prisma.production.updateMany({
  where: { ownerId: null },
  data: { ownerId: user.id },
});
console.log(`\nGave ${count} production(s) to ${user.email}.`);
await prisma.$disconnect();
