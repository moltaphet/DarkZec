import { bech32m } from '@scure/base';
import { encodeOrchardAddress, f4jumble } from '../src/protocol/address';
import { unhex, utf8 } from '../src/protocol/crypto';

// Public official receiving bytes only; no keys or wallet handoffs in tests.
export const VAULT_RECEIVER = '953f3c78d103c32b60559299462ebb27348964b892acad10482fe502c99f0d524959ba7be4f188e3a27138';
export const REFUND_RECEIVER = 'cc802699330bc4748e34dd598c7124e72299e6a6d5bcc32e90409c8024868b2705aadfab6068d458f69b0c';
export const TEST_VAULT = encodeOrchardAddress(unhex(VAULT_RECEIVER), 'testnet');
export const TEST_REFUND = encodeOrchardAddress(unhex(REFUND_RECEIVER), 'testnet');
export function walletAddress(receiver: string, transparent = false): string {
  const padding = new Uint8Array(16); padding.set(utf8('utest'));
  const items = [...(transparent ? [0, 20, ...new Uint8Array(20)] : []), 2, 43, ...new Uint8Array(43).fill(7), 3, 43, ...unhex(receiver)];
  return bech32m.encode('utest', bech32m.toWords(f4jumble(new Uint8Array([...items, ...padding]))), 2048);
}
// Synthetic receiving encodings for intercepted browser tests; never funded or opened in a wallet.
function syntheticReceiver(diversifier: number): string {
  const bytes = unhex(REFUND_RECEIVER); bytes[0] = diversifier;
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
export const WALLET_VAULT_RECEIVER = syntheticReceiver(17);
export const WALLET_REFUND_RECEIVER = syntheticReceiver(18);
export const WALLET_VAULT = encodeOrchardAddress(unhex(WALLET_VAULT_RECEIVER), 'testnet');
export const WALLET_REFUND = encodeOrchardAddress(unhex(WALLET_REFUND_RECEIVER), 'testnet');
