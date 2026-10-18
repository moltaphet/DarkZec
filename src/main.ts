import './style.css';
import './components/terminal-effects.css';
import './components/ProtocolSpecs.css';
import './components/ViewingKeyVault.css';
import './components/LiveTerminalStream.css';
import { element, Lifetime } from './lib/dom';
import { mountNetworkHeader } from './components/NetworkHeader';
import { mountActionRipples } from './components/ActionRipples';
import { MemoScramble } from './components/MemoScramble';
import { BlindOrderflow } from './components/BlindOrderflow';
import { TelemetryRail } from './components/TelemetryRail';
import { mountProtocolSpecs } from './components/ProtocolSpecs';
import { ViewingKeyVault } from './components/ViewingKeyVault';
import { LiveTerminalStream } from './components/LiveTerminalStream';
import { SecurityAudit } from './lib/security-events';
import { monitorSecurityPolicy } from './lib/security-monitor';
import { DEMO_BIDS, FIXTURE_ADDRESS, FIXTURE_RECEIVER, FIXTURE_REFUND_ADDRESS, FIXTURE_REFUND_RECEIVER, SIMULATION_CONFIG } from './fixtures';
import type { Network } from './protocol/address';
import { decodeUnifiedAddress } from './protocol/address';
import { parseQuantity } from './protocol/amount';
import { hex } from './protocol/crypto';
import type { PreparedBid } from './protocol/memo';
import { prepareBid } from './protocol/memo';
import { verifyProof } from './protocol/merkle';
import { Sandbox } from './simulation';
import type { ClearingResult } from './simulation';

const el = (id: string): HTMLElement => element(id, HTMLElement);
const input = (id: string): HTMLInputElement => element(id, HTMLInputElement);
const area = (id: string): HTMLTextAreaElement => element(id, HTMLTextAreaElement);
const button = (id: string): HTMLButtonElement => element(id, HTMLButtonElement);
const text = (id: string, value: string): void => { el(id).textContent = value; };
const visible = (id: string, show: boolean): void => { el(id).hidden = !show; };

const effects = new Lifetime();
const securityAudit = new SecurityAudit(); effects.own(() => securityAudit.destroy());
const securityPolicy = monitorSecurityPolicy(securityAudit); effects.own(() => securityPolicy.destroy());
securityAudit.log('boot');
const stream = new LiveTerminalStream(el('live-terminal-stream'), securityAudit); effects.own(() => stream.destroy());
const viewingKeyVault = new ViewingKeyVault(el('viewing-key-view'), undefined, event => securityAudit.vault(event));
effects.own(() => viewingKeyVault.destroy());
const protocolSpecs = mountProtocolSpecs(el('protocol-specs'));
effects.own(() => protocolSpecs.destroy());
const telemetry = new TelemetryRail(el('telemetry-rail'), button('telemetry-toggle'), el('telemetry-log'), el('telemetry-leaks'), el('telemetry-bytes'), el('telemetry-shield'), securityAudit);
const orderflow = new BlindOrderflow(element('blind-mesh', HTMLCanvasElement), el('mesh-caption'), el('mesh-state'));
const memoPreview = new MemoScramble(el('memo-scramble'), el('memo-payload'), el('memo-hex-stream'), el('memo-draft-state'),
  observer => prepareBid({ auctionId: SIMULATION_CONFIG.auctionId, price: input('bid-price').value,
    quantity: parseQuantity(input('bid-quantity').value), vault: FIXTURE_ADDRESS, refund: FIXTURE_REFUND_ADDRESS, network: 'testnet' }, observer),
  audit => telemetry.memo(audit), event => securityAudit.protocol(event, 'composer'));
const header = document.querySelector<HTMLElement>('.masthead');
const brand = document.querySelector<HTMLElement>('.brand');
if (header && brand) { const effect = mountNetworkHeader(header, brand); effects.own(() => effect.destroy()); }
const ripples = mountActionRipples(document.body);
effects.own(() => ripples.destroy()); effects.own(() => orderflow.destroy());
effects.own(() => memoPreview.destroy()); effects.own(() => telemetry.destroy());

let sandbox: Sandbox | undefined;
let prepared: PreparedBid | undefined;
let walletPrepared: PreparedBid | undefined;
let working = false;
let demoSeedProgress = 0;
let walletView = false;
let scannerView = false;
let lastResult: ClearingResult | undefined;

function vault(): Sandbox { if (!sandbox) throw new Error('The local vault is still starting.'); return sandbox; }
function status(message: string): void {
  const target = el('session-status');
  const tag = document.createElement('span'); tag.className = 'notice-tag'; tag.textContent = scannerView ? 'LOCAL SCANNER' : walletView ? 'LOCAL BUILDER' : 'SANDBOX';
  const content = document.createElement('span'); content.textContent = message;
  target.replaceChildren(tag, content);
}
function clearPrepared(): void {
  prepared = undefined;
  visible('prepared-panel', false);
  element('sensitive-details', HTMLDetailsElement).open = false;
  area('demo-uri').value = '';
  for (const id of ['prepared-amount', 'prepared-bytes', 'prepared-hash']) text(id, '');
}
function eraseWallet(): void {
  walletPrepared = undefined; area('wallet-uri').value = '';
  input('wallet-reviewed').checked = false;
  for (const id of ['wallet-amount', 'wallet-bytes']) text(id, '');
  visible('wallet-output', false); updateWalletLink();
  if (walletView) telemetry.memo({ bytes: 0, state: 'empty' }, 'wallet');
}
function updateWalletLink(): void {
  const link = element('open-wallet', HTMLAnchorElement);
  const enabled = walletPrepared !== undefined && input('wallet-reviewed').checked && !working;
  link.setAttribute('aria-disabled', String(!enabled));
  if (enabled && walletPrepared) { link.href = walletPrepared.uri; link.tabIndex = 0; }
  else { link.removeAttribute('href'); link.tabIndex = -1; }
}
function controls(): void {
  const phase = sandbox?.publicSnapshot().phase;
  memoPreview.setEnabled(phase === 'open' && !walletView && !scannerView);
  if (!scannerView) securityAudit.encryption(!walletView && phase !== 'cleared' && (sandbox?.publicSnapshot().commitments.length ?? 0) > 0 ? 'auction-sealed' : 'idle');
  for (const control of document.querySelectorAll<HTMLButtonElement>('button')) if (!control.closest('[data-independent-controls]')) control.disabled = working || !sandbox;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) if (!control.closest('[data-independent-controls]')) control.disabled = working || !sandbox;
  for (const id of ['prepare', 'seed', 'commit']) button(id).disabled = working || phase !== 'open';
  button('seed').disabled ||= demoSeedProgress === DEMO_BIDS.length;
  button('commit').disabled ||= !prepared;
  button('close').disabled = working || phase !== 'open';
  button('clear').disabled = working || phase !== 'closed';
  for (const id of ['bid-price', 'bid-quantity']) input(id).disabled = working || phase !== 'open';
  updateWalletLink();
}
function renderBook(): void {
  const snapshot = vault().publicSnapshot();
  orderflow.update(snapshot.commitments, snapshot.phase);
  text('bid-count', String(snapshot.commitments.length).padStart(2, '0'));
  text('phase', snapshot.phase === 'open' ? 'ACCEPTING BIDS' : snapshot.phase === 'closed' ? 'CLOSED / SEALED' : 'CLEARED');
  const list = el('commitment-list');
  list.replaceChildren();
  if (snapshot.commitments.length === 0) {
    const empty = document.createElement('div'); empty.className = 'empty-book';
    empty.textContent = 'The book is empty. Prepare your bid or load the demo set.'; list.append(empty);
  }
  snapshot.commitments.forEach((hash, i) => {
    const row = document.createElement('div'); row.className = 'commitment-row';
    const entry = document.createElement('span'); entry.className = 'entry'; entry.textContent = String(i + 1).padStart(2, '0');
    const code = document.createElement('code'); code.textContent = hash;
    const state = document.createElement('span'); state.className = 'state'; state.textContent = snapshot.phase === 'cleared' ? 'OPENED' : 'SEALED';
    row.append(entry, code, state); list.append(row);
  });
}
async function action(operation: () => Promise<void>): Promise<void> {
  if (working) return;
  working = true; visible('error', false); controls();
  try { await operation(); }
  catch (error: unknown) {
    telemetry.log('invalid');
    text('error', error instanceof Error ? error.message : 'The operation failed. Check the inputs and try again.');
    visible('error', true);
  } finally {
    working = false;
    if (sandbox) renderBook(); controls();
  }
}
function setView(view: 'sandbox' | 'wallet' | 'scanner'): void {
  if (working) return;
  walletView = view === 'wallet'; scannerView = view === 'scanner';
  securityAudit.encryption('idle');
  if (!scannerView) viewingKeyVault.lock();
  visible('sandbox-view', view === 'sandbox'); visible('wallet-view', walletView); visible('viewing-key-view', scannerView);
  for (const [id, active] of [['sandbox-tab', view === 'sandbox'], ['wallet-tab', walletView], ['vault-tab', scannerView]] as const) {
    el(id).classList.toggle('active', active); el(id).setAttribute('aria-pressed', String(active));
  }
  visible('error', false);
  clearPrepared(); eraseWallet();
  memoPreview.clear();
  memoPreview.setEnabled(view === 'sandbox' && vault().publicSnapshot().phase === 'open');
  if (view === 'sandbox' && vault().publicSnapshot().phase === 'open') memoPreview.update();
  status(scannerView ? 'Private mock-note scanner. Only mock keys can be saved as passphrase-encrypted tab ciphertext. Real viewing keys are disabled. No RPC.' : walletView ? 'Requests are built on this device. Wallet handoff is explicit; no RPC or payment tracking.' : 'Session-only simulation. No funds move. Reloading erases all bids.');
  controls();
}

element('bid-form', HTMLFormElement).addEventListener('submit', event => {
  event.preventDefault();
  void action(async () => {
    clearPrepared();
    prepared = await memoPreview.prepare();
    text('prepared-hash', prepared.commitment); text('prepared-amount', `${prepared.amount} ZEC`);
    text('prepared-bytes', `${prepared.byteLength} / 512 BYTES`); visible('prepared-panel', true);
    telemetry.log('prepared');
    status('Bid prepared privately. Review the memo audit, then commit to the local vault.');
  });
});
for (const id of ['bid-price', 'bid-quantity']) input(id).addEventListener('input', () => {
  if (working || walletView || scannerView || sandbox?.publicSnapshot().phase !== 'open') return;
  clearPrepared(); memoPreview.update(); controls();
});
element('sensitive-details', HTMLDetailsElement).addEventListener('toggle', () => {
  area('demo-uri').value = element('sensitive-details', HTMLDetailsElement).open ? prepared?.uri ?? '' : '';
});
async function copy(value: string): Promise<void> {
  if (!value) throw new Error('Prepare a request first.');
  if (!navigator.clipboard) throw new Error('Clipboard unavailable. Select the visible URI and copy it manually.');
  try { await navigator.clipboard.writeText(value); }
  catch { throw new Error('Clipboard access was denied. Select the visible URI and copy it manually.'); }
  status('Sensitive URI copied. It contains readable bid details; keep it private and clear your clipboard after use.');
}
button('copy-demo').addEventListener('click', () => { void action(() => copy(prepared?.uri ?? '')); });
button('commit').addEventListener('click', () => {
  void action(async () => {
    if (!prepared) throw new Error('Prepare a bid first.');
    await vault().submit(prepared); clearPrepared(); memoPreview.clear(); telemetry.log('committed');
    status('Bid committed locally. Only its hash appears in the sealed book.');
  });
});
button('seed').addEventListener('click', () => {
  void action(async () => {
    while (demoSeedProgress < DEMO_BIDS.length) {
      const bid = DEMO_BIDS[demoSeedProgress]; if (!bid) throw new Error('Missing local demo fixture.');
      await vault().submit(await prepareBid({ ...bid, auctionId: SIMULATION_CONFIG.auctionId, vault: FIXTURE_ADDRESS, refund: FIXTURE_REFUND_ADDRESS, network: 'testnet' }, event => securityAudit.protocol(event, 'auction')));
      demoSeedProgress++;
    }
    telemetry.log('seeded');
    status('Three local demo bids committed. Their prices stay sealed until you close and unseal the auction.');
  });
});
button('close').addEventListener('click', () => {
  void action(async () => {
    vault().close(); clearPrepared(); memoPreview.setEnabled(false);
    const count = vault().publicSnapshot().commitments.length;
    if (count > 0) text('merkle-root', (await vault().audit(0)).root);
    else text('merkle-root', 'No commitments. Inclusion proofs require at least one bid.');
    telemetry.log('closed'); if (count > 0) telemetry.log('merkle'); visible('audit-panel', true);
    status('Auction closed. The commitment set is frozen; bids remain sealed until you choose Unseal & clear.');
  });
});
button('clear').addEventListener('click', () => {
  void action(async () => {
    lastResult = await vault().clear();
    telemetry.log('cleared');
    text('clearing-price', `${lastResult.clearingPrice} ZEC`); text('filled-lots', `${lastResult.filled} / ${SIMULATION_CONFIG.supply} LOTS`);
    const rows = el('result-rows'); rows.replaceChildren();
    for (const allocation of lastResult.allocations) {
      const row = document.createElement('tr');
      for (const value of [allocation.commitment.slice(0, 16) + '…', allocation.price, `${allocation.filled} / ${allocation.requested}`, allocation.paid, allocation.refundAmount]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      rows.append(row);
    }
    visible('results-panel', true);
    status('Demo bids unsealed on this screen. Allocations and refunds calculated locally; no transaction was sent.');
  });
});
element('audit-form', HTMLFormElement).addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    const index = parseQuantity(input('audit-index').value) - 1;
    const audit = await vault().audit(index);
    if (!await verifyProof(audit.commitment, audit.proof, audit.root)) throw new Error('Inclusion proof failed.');
    text('audit-result', `VERIFIED / Entry ${index + 1} belongs to the frozen Merkle root.`);
    telemetry.log('proof');
  });
});
button('reset').addEventListener('click', () => {
  void action(async () => {
    memoPreview.setEnabled(false); clearPrepared(); eraseWallet();
    sandbox = await Sandbox.create(SIMULATION_CONFIG);
    demoSeedProgress = 0; lastResult = undefined;
    for (const id of ['bid-form', 'wallet-form', 'audit-form']) element(id, HTMLFormElement).reset();
    text('error', ''); telemetry.reset();
    visible('audit-panel', false); visible('results-panel', false); text('merkle-root', ''); text('audit-result', '');
    text('result-rows', ''); text('clearing-price', ''); text('filled-lots', '');
    memoPreview.setEnabled(!walletView && !scannerView);
    if (!walletView && !scannerView) memoPreview.update();
    status('Local session reset. A new session key is active and the book is empty.');
  });
});
button('sandbox-tab').addEventListener('click', () => setView('sandbox'));
button('wallet-tab').addEventListener('click', () => setView('wallet'));
button('vault-tab').addEventListener('click', () => setView('scanner'));

element('wallet-form', HTMLFormElement).addEventListener('input', () => { eraseWallet(); controls(); });
element('wallet-form', HTMLFormElement).addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    eraseWallet();
    const selected = element('wallet-network', HTMLSelectElement).value;
    if (selected !== 'mainnet' && selected !== 'testnet') throw new Error('Select a valid network.');
    const network: Network = selected;
    const vaultAddress = area('wallet-vault').value.trim(); const refund = area('wallet-refund').value.trim();
    for (const address of [vaultAddress, refund]) {
      const receivers = decodeUnifiedAddress(address, network);
      if (receivers.some(receiver => receiver.type === 3 && [FIXTURE_RECEIVER, FIXTURE_REFUND_RECEIVER].includes(hex(receiver.bytes)))) throw new Error('Public demo fixtures cannot be used for wallet requests. Use verified addresses you control or trust.');
    }
    walletPrepared = await prepareBid({ auctionId: input('wallet-auction').value, price: input('wallet-price').value,
      quantity: parseQuantity(input('wallet-quantity').value), vault: vaultAddress, refund, network }, event => securityAudit.protocol(event, 'wallet'));
    telemetry.memo({ bytes: walletPrepared.byteLength, state: 'ready' }, 'wallet'); telemetry.log('wallet');
    area('wallet-uri').value = walletPrepared.uri;
    text('wallet-amount', `${walletPrepared.amount} ZEC`); text('wallet-bytes', `${walletPrepared.byteLength} / 512 BYTES`);
    visible('wallet-output', true);
    status('Payment request prepared on this device. Verify the full vault address and amount before opening your wallet.');
  });
});
input('wallet-reviewed').addEventListener('change', updateWalletLink);
button('copy-wallet').addEventListener('click', () => { void action(() => copy(walletPrepared?.uri ?? '')); });
button('erase-wallet').addEventListener('click', () => { eraseWallet(); telemetry.log('erased'); controls(); status('Sensitive payment request erased from the interface.'); });
element('open-wallet', HTMLAnchorElement).addEventListener('click', event => {
  if (!walletPrepared || !input('wallet-reviewed').checked || working) event.preventDefault();
});

// Best-effort clear on page exit; JS strings and browser/OS clipboard cannot be securely erased.
window.addEventListener('pagehide', () => { clearPrepared(); eraseWallet(); effects.destroy(); sandbox = undefined; lastResult = undefined; });
window.addEventListener('pageshow', event => {
  // A restored bfcache document must not retain stale controls after pagehide erased its vault.
  if (event.persisted) window.location.reload();
});
void action(async () => {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('Open DarkZec on localhost or HTTPS to enable browser cryptography.');
  sandbox = await Sandbox.create(SIMULATION_CONFIG);
  memoPreview.setEnabled(true); memoPreview.update();
});
