/**
 * Generate a NATS Account NKey keypair for use with auth_callout.
 *
 * Usage:
 *   bun run scripts/generate-nats-account-key.ts
 *
 * Copy the output values into your .env file.
 */

import * as nkeys from "nkeys.js";

const kp = nkeys.createAccount();
const seed = new TextDecoder().decode(kp.getSeed());
const pubkey = kp.getPublicKey();

console.log("# Add these to your .env file:");
console.log(`NATS_ACCOUNT_SEED=${seed}`);
console.log(`NATS_ACCOUNT_PUBKEY=${pubkey}`);
