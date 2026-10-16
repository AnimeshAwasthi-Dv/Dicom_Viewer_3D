import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from './config';
import { createStorage } from './storage';
import { importS3Study } from './sourceImporter';
import { openDatabase } from './database';
import { createJobs, JOB_LEASE_MS, type ClaimedJob } from './jobs';

const config = readConfig();
const storage = createStorage(config);
const db = openDatabase(config.VIEWER_DATA_DIR);
const jobs = createJobs(db);
let stopping = false;
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

async function run(claim: ClaimedJob): Promise<void> {
  let leaseLost = false;
  const renewal = setInterval(() => {
    try { if (!jobs.renew(claim)) leaseLost = true; } catch { leaseLost = true; }
  }, JOB_LEASE_MS / 3);
  const assertOwner = () => {
    if (leaseLost || !jobs.owns(claim)) throw new Error('Import job lease lost');
  };
  try {
    await importS3Study(config, storage.client, claim.payload, async (...args) => {
      assertOwner();
      await storage.put(...args);
    }, async value => { assertOwner(); jobs.progress(claim, value); });
    jobs.complete(claim, await storage.manifest(claim.payload.id));
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    jobs.fail(claim, errorType);
    console.error(`Import ${claim.payload.id} attempt ${claim.attempts} failed: ${errorType}`);
  } finally { clearInterval(renewal); }
}

console.log('Study import worker ready');
try {
  while (!stopping) {
    try {
      const claim = jobs.claim();
      if (claim) await run(claim);
      else await delay(1000);
    } catch (error) {
      console.error(`Import worker error: ${error instanceof Error ? error.name : 'UnknownError'}`);
      await delay(1000);
    }
  }
} finally { storage.client.destroy(); db.close(); }
