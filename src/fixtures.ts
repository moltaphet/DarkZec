import { encodeOrchardAddress } from './protocol/address';
import { unhex } from './protocol/crypto';
import type { AuctionConfig } from './simulation';

// PUBLIC test vector receiver, not a funded wallet. Never offer a wallet link for it.
// Source/provenance: docs/engineering-report.md. No private key material is included.
export const FIXTURE_RECEIVER = '953f3c78d103c32b60559299462ebb27348964b892acad10482fe502c99f0d524959ba7be4f188e3a27138';
export const FIXTURE_ADDRESS = encodeOrchardAddress(unhex(FIXTURE_RECEIVER), 'testnet');
export const FIXTURE_REFUND_RECEIVER = 'cc802699330bc4748e34dd598c7124e72299e6a6d5bcc32e90409c8024868b2705aadfab6068d458f69b0c';
export const FIXTURE_REFUND_ADDRESS = encodeOrchardAddress(unhex(FIXTURE_REFUND_RECEIVER), 'testnet');
export const SIMULATION_CONFIG: AuctionConfig = Object.freeze({
  auctionId: 'NODE07-001', supply: 10, reserve: '0.5', vault: FIXTURE_ADDRESS, network: 'testnet', collateral: '10', revealWindowMs: 60_000,
});
export const DEMO_BIDS = Object.freeze([
  Object.freeze({ price: '0.74', quantity: 4 }),
  Object.freeze({ price: '0.68', quantity: 6 }),
  Object.freeze({ price: '0.59', quantity: 5 }),
]);
