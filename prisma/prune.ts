import { db } from "../src/lib/db";
import { pruneExpiredIdempotencyKeys } from "../src/modules/work-items/service";

// Deletes expired idempotency records. Expiry is enforced on read; run this on
// a schedule (cron / platform scheduler) to reclaim space.
async function main() {
  const n = await pruneExpiredIdempotencyKeys();
  console.log(`Pruned ${n} expired idempotency record(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
