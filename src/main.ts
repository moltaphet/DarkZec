import './style.css';
import './components/terminal-effects.css';
import './components/ProtocolSpecs.css';
import './components/ViewingKeyVault.css';
import './components/LiveTerminalStream.css';
import './components/RevealPanel.css';
import './components/OperatorTools.css';
import { RevealPanel } from './components/RevealPanel';
import './theme.css';
import { element, Lifetime } from './lib/dom';
import { mountNetworkHeader } from './components/NetworkHeader';
import { mountActionRipples } from './components/ActionRipples';
import { mountHeroLogo } from './components/HeroLogo';
import { mountScene } from './components/Scene3D';
import { mountBrandDecode } from './components/BrandDecode';
import { MemoScramble } from './components/MemoScramble';
import { BlindOrderflow } from './components/BlindOrderflow';
import { TelemetryRail } from './components/TelemetryRail';
import { mountProtocolSpecs } from './components/ProtocolSpecs';
import { ViewingKeyVault } from './components/ViewingKeyVault';
import { LiveTerminalStream } from './components/LiveTerminalStream';
import { LiveAuctionPanel } from './components/LiveAuctionPanel';
import type { LiveAuctionSettings } from './components/LiveAuctionPanel';
import { OperatorPanel } from './components/OperatorPanel';
import { AuditView } from './components/AuditView';
import { AuctionSession } from './lib/auction-session';
import { serializeAuditBundle } from './lib/audit-bundle';
import { SecurityAudit } from './lib/security-events';
import { monitorSecurityPolicy } from './lib/security-monitor';
import { DEMO_BIDS, FIXTURE_ADDRESS, FIXTURE_RECEIVER, FIXTURE_REFUND_ADDRESS, FIXTURE_REFUND_RECEIVER, SIMULATION_CONFIG } from './fixtures';
import type { Network } from './protocol/address';
import { assertDistinctRefund, decodeUnifiedAddress, orchardPaymentAddress } from './protocol/address';
import { formatZec, parseQuantity, parseZec } from './protocol/amount';
import { commitment, hex } from './protocol/crypto';
import type { PreparedBid } from './protocol/memo';
import { buildPaymentUri, COLLATERAL_TIERS, commitSubmission, prepareBid, REVEAL_AMOUNT } from './protocol/memo';
import { verifyProof } from './protocol/merkle';
import { settlementBalance } from './simulation';
import type { AuctionConfig, Sandbox, SettlementResult } from './simulation';
import { compareWithRequest, memoFingerprint, parseReceivedCommitMemo } from './lib/memo-import';
import { downloadText, parseReceiptText, readReceiptFile, receiptFilename, receiptText } from './lib/receipt-file';
import { fetchVaultMemos, localTestnetStatus, verifyTestnetCommit } from './lib/testnet-chain';

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
const heroLogo = mountHeroLogo(element('hero-logo', HTMLCanvasElement));
effects.own(() => heroLogo.destroy());
// The full-page WebGL scene supersedes the flat hero mark; without WebGL the flat mark remains.
const root = document.documentElement;
const hudDistance = document.getElementById('hud-distance');
const scene = mountScene(element('scene-3d', HTMLCanvasElement), () => { root.classList.remove('has-scene'); delete root.dataset.phase; }, progress => {
  const meters = Math.round(4 * (1 - progress));
  if (hudDistance && hudDistance.textContent !== `${meters} M`) hudDistance.textContent = `${meters} M`;
  root.style.setProperty('--journey', progress.toFixed(3));
  const phase = progress >= 0.985 ? 'app' : 'journey';
  if (root.dataset.phase !== phase) root.dataset.phase = phase;
});
if (scene) {
  root.classList.add('has-scene');
  const reveal = new IntersectionObserver(entries => entries.forEach(entry => entry.target.classList.toggle('in', entry.isIntersecting)), { threshold: 0.12 });
  document.querySelectorAll('.callout').forEach(node => reveal.observe(node));
  effects.own(() => { root.classList.remove('has-scene'); delete root.dataset.phase; reveal.disconnect(); scene.destroy(); });
}
const brandWord = document.querySelector<HTMLElement>('.brand-word');
if (brand && brandWord) { const decode = mountBrandDecode(brandWord, brand); effects.own(() => decode.destroy()); }
const ripples = mountActionRipples(document.body);
effects.own(() => ripples.destroy()); effects.own(() => orderflow.destroy());
effects.own(() => memoPreview.destroy()); effects.own(() => telemetry.destroy());

let session: AuctionSession | undefined;
// The demo auction uses public fixtures; a live auction swaps in a real testnet vault whose memos feed the ledger.
let auctionConfig: AuctionConfig = SIMULATION_CONFIG;
let live = false;
let liveSummary = 'Demo auction with public fixtures. Open the panel to run against a real testnet vault.';
let liveOk: boolean | undefined;
let walletRevealUri = '';
let prepared: PreparedBid | undefined;
let walletPrepared: PreparedBid | undefined;
// A paid request whose receipt was lost can never be revealed, so the handoff stays locked until the receipt is saved.
let walletReceiptSaved = false;
let working = false;
let demoSeedProgress = 0;
let walletView = false;
let scannerView = false;
let auditOpen = false;
let lastResult: SettlementResult | undefined;
let judgeTimeOffset = 0;
let revealDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
effects.own(() => clearTimeout(revealDeadlineTimer));
const judgeClock = (): number => Date.now() + judgeTimeOffset;
const revealPanel = new RevealPanel(el('reveal-workspace'), operation => { void action(operation); }, async bid => {
  const ack = await currentSession().reveal(bid); telemetry.log('revealed');
  status(`Reveal accepted. The operator signed an acknowledgement (signature ${ack.signature.slice(0, 16)}…), so omitting this bid from the result would be provable.`);
}, () => {
  const deadline = vault().publicSnapshot().revealDeadline;
  if (deadline === null) throw new Error('Open the reveal window first.');
  judgeTimeOffset = Math.max(judgeTimeOffset, deadline - Date.now() + 1); telemetry.log('expired');
}, SIMULATION_CONFIG.network);
effects.own(() => revealPanel.destroy());
const liveAuction = new LiveAuctionPanel(el('live-auction'), operation => { void action(operation); }, { start: startLiveAuction, sync: syncLiveAuction, leave: () => resetSession() });
effects.own(() => liveAuction.destroy());
const operatorPanel = new OperatorPanel(el('operator-view'), () => { void action(async () => {
  const bundle = currentSession().bundle(); if (!bundle) throw new Error('Finalize the auction before exporting its audit bundle.');
  downloadText(`darkzec-audit-${bundle.auction.auctionId}.json`, serializeAuditBundle(bundle));
  status('Audit bundle downloaded. It contains every revealed bid, including refund addresses; publish it only when bidders agreed that reveals become public.');
}); });
effects.own(() => operatorPanel.destroy());
const auditView = new AuditView(el('audit-view'), () => { const bundle = session?.bundle(); return bundle ? serializeAuditBundle(bundle) : undefined; });
effects.own(() => auditView.destroy());

function currentSession(): AuctionSession { if (!session) throw new Error('The local vault is still starting.'); return session; }
function vault(): Sandbox { return currentSession().sandbox; }
const ledger = (): Sandbox | undefined => session?.sandbox;
function status(message: string): void {
  const target = el('session-status');
  const tag = document.createElement('span'); tag.className = 'notice-tag'; tag.textContent = scannerView ? 'LOCAL SCANNER' : walletView ? 'LOCAL BUILDER' : auditOpen ? 'AUDIT' : live ? 'LIVE TESTNET' : 'SANDBOX';
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
  walletPrepared = undefined; walletReceiptSaved = false; area('wallet-uri').value = '';
  area('wallet-reveal').value = '';
  input('wallet-reviewed').checked = false;
  for (const id of ['wallet-amount', 'wallet-bytes']) text(id, '');
  visible('wallet-output', false); updateWalletLink();
  const paymentResult = el('testnet-payment-result'); paymentResult.textContent = ''; paymentResult.classList.remove('is-ok', 'is-bad');
  button('testnet-check').disabled = true;
  eraseWalletReveal();
  if (walletView) telemetry.memo({ bytes: 0, state: 'empty' }, 'wallet');
}
function updateWalletLink(): void {
  const link = element('open-wallet', HTMLAnchorElement);
  const enabled = walletPrepared !== undefined && walletReceiptSaved && input('wallet-reviewed').checked && !working;
  link.setAttribute('aria-disabled', String(!enabled));
  if (enabled && walletPrepared) { link.href = walletPrepared.uri; link.tabIndex = 0; }
  else { link.removeAttribute('href'); link.tabIndex = -1; }
}
function eraseWalletReveal(): void {
  walletRevealUri = ''; area('wallet-reveal-uri').value = ''; visible('wallet-reveal-output', false); updateRevealLink();
}
function updateRevealLink(): void {
  const link = element('wallet-reveal-open', HTMLAnchorElement); const enabled = walletRevealUri !== '' && !working;
  link.setAttribute('aria-disabled', String(!enabled));
  if (enabled) { link.href = walletRevealUri; link.tabIndex = 0; } else { link.removeAttribute('href'); link.tabIndex = -1; }
}
function renderNodeStatus(label: string): void { text('network-status', `● ${label}`); }
/** The testnet checker only answers same-origin loopback requests, so a public deployment never probes it. */
const loopbackHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
async function refreshNodeStatus(): Promise<void> {
  if (!loopbackHost) {
    renderNodeStatus('PUBLIC DEMO / NO NODE');
    text('testnet-status', 'Testnet payment checks and live auctions read a local Zcash wallet, so they run only on a local DarkZec server (npm run dev). Everything else works here.');
    return;
  }
  try {
    const node = await localTestnetStatus();
    renderNodeStatus(node.connected ? node.network === 'testnet' ? node.synced ? 'TESTNET / SYNCED' : 'TESTNET / SYNCING' : `${node.network.toUpperCase()} / WRONG NETWORK` : 'NO LOCAL NODE');
    text('testnet-status', node.connected ? node.network !== 'testnet' ? 'The local wallet RPC is connected to the wrong network. Switch it to Zcash testnet.' : node.synced ? 'Local Zcash testnet wallet connected and synchronized.' : `Testnet node is syncing (${node.blocks ?? 0} / ${node.headers ?? 0} blocks).` : node.reason === 'wallet-not-configured' ? 'No local node wallet is configured. Start zcashd in testnet mode and provide its RPC credentials to the local server.' : 'Could not reach the local testnet wallet RPC.');
  } catch {
    renderNodeStatus('CHECKER UNAVAILABLE');
    text('testnet-status', 'The local testnet checker is unavailable. Start DarkZec with its local server to use payment verification.');
  }
}
function controls(): void {
  const phase = ledger()?.publicSnapshot().phase;
  memoPreview.setEnabled(phase === 'open' && !walletView && !scannerView);
  if (!scannerView) securityAudit.encryption('idle');
  for (const control of document.querySelectorAll<HTMLButtonElement>('button')) if (!control.closest('[data-independent-controls]')) control.disabled = working || !session;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) if (!control.closest('[data-independent-controls]')) control.disabled = working || !session;
  // In a live auction bids arrive only as confirmed shielded memos, never from the local composer or fixtures.
  for (const id of ['prepare', 'seed', 'commit']) button(id).disabled = working || phase !== 'open' || live;
  button('seed').disabled ||= demoSeedProgress === DEMO_BIDS.length;
  button('commit').disabled ||= !prepared;
  button('close').disabled = working || phase !== 'open';
  button('clear').disabled = working || !ledger()?.publicSnapshot().canClear;
  button('testnet-check').disabled = working || !walletPrepared || element('wallet-network', HTMLSelectElement).value !== 'testnet';
  for (const id of ['bid-price', 'bid-quantity']) input(id).disabled = working || phase !== 'open' || live;
  updateWalletLink(); updateRevealLink();
  const current = session;
  if (current) {
    revealPanel.update(current.sandbox.publicSnapshot(), working);
    operatorPanel.update({ view: current.sandbox.operatorView(), live, vault: current.sandbox.config.vault, publicKey: current.journal.publicKey,
      statements: current.journal.statements().length, bundleReady: current.bundle() !== undefined, busy: working });
  }
  liveAuction.update({ live, phase, busy: working || !session, summary: liveSummary, ...(liveOk === undefined ? {} : { ok: liveOk }) });
}
function renderBook(): void {
  const snapshot = vault().publicSnapshot();
  orderflow.update(snapshot.commitments, snapshot.phase);
  text('bid-count', String(snapshot.commitments.length).padStart(2, '0'));
  text('phase', snapshot.phase === 'open' ? 'COMMIT PHASE' : snapshot.phase === 'reveal' ? 'CLOSED / REVEAL WINDOW' : 'CLEARED');
  const list = el('commitment-list');
  list.replaceChildren();
  if (snapshot.commitments.length === 0) {
    const empty = document.createElement('div'); empty.className = 'empty-book';
    empty.textContent = live ? 'The book is empty. Sync from the vault once confirmed commit payments arrive.' : 'The book is empty. Prepare your bid or load the demo set.'; list.append(empty);
  }
  snapshot.commitments.forEach((hash, i) => {
    const row = document.createElement('div'); row.className = 'commitment-row';
    const entry = document.createElement('span'); entry.className = 'entry'; entry.textContent = String(i + 1).padStart(2, '0');
    const code = document.createElement('code'); code.textContent = hash;
    const state = document.createElement('span'); state.className = 'state'; state.textContent = snapshot.revealed.includes(hash) ? 'VALID' : snapshot.phase === 'cleared' ? 'EXCL' : 'COMMIT';
    row.append(entry, code, state); list.append(row);
  });
}
async function action(operation: () => Promise<void>): Promise<void> {
  if (working) return;
  // Disabling controls while busy drops keyboard focus, so return it to the control that started the operation.
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  working = true; visible('error', false); controls();
  try { await operation(); }
  catch (error: unknown) {
    telemetry.log('invalid');
    text('error', error instanceof Error ? error.message : 'The operation failed. Check the inputs and try again.');
    visible('error', true);
  } finally {
    working = false;
    if (session) renderBook(); controls();
    if (origin?.isConnected && document.activeElement === document.body) origin.focus({ preventScroll: true });
  }
}
function setView(view: 'sandbox' | 'wallet' | 'scanner' | 'audit'): void {
  if (working) return;
  walletView = view === 'wallet'; scannerView = view === 'scanner'; auditOpen = view === 'audit';
  securityAudit.encryption('idle');
  if (!scannerView) viewingKeyVault.lock();
  visible('sandbox-view', view === 'sandbox'); visible('wallet-view', walletView); visible('viewing-key-view', scannerView); visible('audit-view', auditOpen);
  for (const [id, active] of [['sandbox-tab', view === 'sandbox'], ['wallet-tab', walletView], ['vault-tab', scannerView], ['audit-tab', auditOpen]] as const) {
    el(id).classList.toggle('active', active); el(id).setAttribute('aria-pressed', String(active));
  }
  visible('error', false);
  clearPrepared(); eraseWallet(); clearMemoVerification();
  memoPreview.clear();
  memoPreview.setEnabled(view === 'sandbox' && vault().publicSnapshot().phase === 'open');
  if (view === 'sandbox' && vault().publicSnapshot().phase === 'open') memoPreview.update();
  status(auditOpen ? 'Audit mode re-derives a published auction in this browser: root, reveal openings, clearing, conservation and operator signatures. Nothing is sent anywhere.' : scannerView ? 'Private mock-note scanner. Only mock keys can be saved as passphrase-encrypted tab ciphertext. Real viewing keys stay in your local Zcash wallet.' : walletView ? 'Payment requests are built on this device. Optional confirmation reads your local testnet wallet; no keys leave it.' : live ? 'Live testnet auction: commits and reveals are imported from confirmed shielded memos at the vault. No funds are settled from this page.' : 'Session-only auction simulation. The local testnet checker can verify a payment, but this sandbox does not settle funds.');
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
  if (working || walletView || scannerView || auditOpen || live || ledger()?.publicSnapshot().phase !== 'open') return;
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
  status('Payment URI copied. Its memo contains only the auction ID and commitment hash. Keep your separate reveal receipt private.');
}
button('copy-demo').addEventListener('click', () => { void action(() => copy(prepared?.uri ?? '')); });
button('commit').addEventListener('click', () => {
  void action(async () => {
    if (!prepared) throw new Error('Prepare a bid first.');
    const receipt = prepared; await vault().submit(commitSubmission(receipt)); revealPanel.remember(receipt);
    clearPrepared(); memoPreview.clear(); telemetry.log('committed');
    status('Hash and posted collateral committed. Save your bidder receipt; it is required during the reveal window. The operator has no preimage.');
  });
});
button('seed').addEventListener('click', () => {
  void action(async () => {
    while (demoSeedProgress < DEMO_BIDS.length) {
      const bid = DEMO_BIDS[demoSeedProgress]; if (!bid) throw new Error('Missing local demo fixture.');
      const receipt = await prepareBid({ ...bid, auctionId: SIMULATION_CONFIG.auctionId, vault: FIXTURE_ADDRESS, refund: FIXTURE_REFUND_ADDRESS, network: 'testnet' }, event => securityAudit.protocol(event, 'auction'));
      await vault().submit(commitSubmission(receipt)); revealPanel.remember(receipt, true);
      demoSeedProgress++;
    }
    telemetry.log('seeded');
    status('Three demo hashes committed. Their receipts stay with simulated bidders; closing alone cannot reveal them.');
  });
});
button('close').addEventListener('click', () => {
  void action(async () => {
    const root = await currentSession().close(); clearPrepared(); memoPreview.setEnabled(false);
    const windowMs = auctionConfig.revealWindowMs ?? 60_000;
    clearTimeout(revealDeadlineTimer);
    revealDeadlineTimer = setTimeout(() => { if (session && !working) controls(); }, windowMs + 10);
    const count = vault().publicSnapshot().commitments.length;
    text('merkle-root', count > 0 ? root : 'No commitments. Inclusion proofs require at least one bid.');
    telemetry.log('closed'); if (count > 0) telemetry.log('merkle'); visible('audit-panel', true);
    const span = windowMs >= 120_000 ? `${Math.round(windowMs / 60_000)} minutes` : `${Math.round(windowMs / 1000)} seconds`;
    status(`Commit phase closed. The operator signed the frozen root over ${count} commitment${count === 1 ? '' : 's'}. Reveal window is open for ${span}; unrevealed bids cannot clear.`);
  });
});
button('clear').addEventListener('click', () => {
  void action(async () => {
    lastResult = await currentSession().clear();
    telemetry.log('cleared'); text('merkle-root', lastResult.root); visible('audit-panel', true);
    text('clearing-price', `${lastResult.clearingPrice} ZEC`); text('filled-lots', `${lastResult.filled} / ${auctionConfig.supply} LOTS`);
    const rows = el('result-rows'); rows.replaceChildren();
    for (const allocation of lastResult.allocations) {
      const row = document.createElement('tr');
      for (const value of [allocation.commitment.slice(0, 16) + '…', allocation.price, `${allocation.filled} / ${allocation.requested}`, allocation.paid, allocation.refundAmount]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      rows.append(row);
    }
    visible('results-panel', true);
    const balance = settlementBalance(lastResult); const balanceLine = el('settlement-balance');
    balanceLine.textContent = `${balance.balanced ? 'BALANCED' : 'MISMATCH'} / payments ${balance.paid} + refunds ${balance.refunded} + forfeited ${balance.forfeited} = ${balance.posted} ZEC posted collateral`;
    balanceLine.classList.toggle('is-ok', balance.balanced); balanceLine.classList.toggle('is-bad', !balance.balanced);
    text('excluded-bids', `${lastResult.excluded} unrevealed / ${lastResult.forfeitedCollateral} ZEC collateral forfeited and burned`);
    status('Only verified reveals entered clearing. Missing reveals are excluded from allocation but stay in the frozen commitment root; their full collateral is burned as the non-reveal penalty, so the operator gains nothing from a missing reveal. The operator signed the result; export the audit bundle from the operator view to let anyone re-run it. No settlement transaction was sent.');
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
/** Starts a fresh auction session; without a configuration it returns to the demo auction. */
async function resetSession(config: AuctionConfig = SIMULATION_CONFIG, liveVault = false): Promise<void> {
    memoPreview.setEnabled(false); clearPrepared(); eraseWallet(); clearMemoVerification();
    clearTimeout(revealDeadlineTimer);
    judgeTimeOffset = 0; session = await AuctionSession.create(config, judgeClock); auctionConfig = session.sandbox.config; revealPanel.reset();
    live = liveVault; liveOk = undefined;
    liveSummary = live ? `Live auction ${auctionConfig.auctionId} on vault ${auctionConfig.vault.slice(0, 18)}…: ${auctionConfig.collateral} ZEC collateral tier. Sync after confirmed commit payments arrive.` : 'Demo auction with public fixtures. Open the panel to run against a real testnet vault.';
    demoSeedProgress = 0; lastResult = undefined; renderStrip();
    for (const id of ['bid-form', 'wallet-form', 'audit-form']) element(id, HTMLFormElement).reset();
    text('error', ''); telemetry.reset();
    visible('audit-panel', false); visible('results-panel', false); text('merkle-root', ''); text('audit-result', '');
    text('result-rows', ''); text('clearing-price', ''); text('filled-lots', ''); text('settlement-balance', '');
    memoPreview.setEnabled(!walletView && !scannerView && !live);
    if (!walletView && !scannerView && !live) memoPreview.update();
    status(live ? liveSummary : 'Local commit/reveal session reset. Hash ledger, bidder receipts and operator statements erased; the book is empty.');
}
button('reset').addEventListener('click', () => { void action(() => resetSession()); });
function renderStrip(): void {
  text('strip-auction', auctionConfig.auctionId); text('strip-supply', String(auctionConfig.supply)); text('strip-reserve', auctionConfig.reserve);
  text('strip-supply-label', live ? 'TESTNET LOTS' : 'DEMO LOTS');
  text('strip-rule', auctionConfig.unitDemand ? auctionConfig.supply === 1 ? 'VICKREY / 1 LOT' : 'UNIT DEMAND' : 'UNIFORM PRICE');
}
function refuseFixtureVault(address: string): void {
  if (decodeUnifiedAddress(address, 'testnet').some(receiver => receiver.type === 3 && [FIXTURE_RECEIVER, FIXTURE_REFUND_RECEIVER].includes(hex(receiver.bytes)))) {
    throw new Error('Public demo fixtures cannot be used as a real vault. Use a testnet address your wallet can view.');
  }
}
async function startLiveAuction(settings: LiveAuctionSettings): Promise<void> {
  if (!COLLATERAL_TIERS.includes(settings.collateral)) throw new Error('Choose a 1, 10 or 100 ZEC collateral tier.');
  const vaultAddress = orchardPaymentAddress(settings.vault, 'testnet'); refuseFixtureVault(vaultAddress);
  await resetSession({ auctionId: settings.auctionId, supply: settings.mode === 'vickrey' ? 1 : 10, reserve: settings.reserve, vault: vaultAddress, network: 'testnet',
    collateral: settings.collateral, revealWindowMs: settings.revealMinutes * 60_000, unitDemand: settings.mode !== 'uniform' }, true);
}
/** Imports confirmed commit memos while bidding is open, and reveal memos during the reveal window. */
async function syncLiveAuction(): Promise<void> {
  if (!live) throw new Error('Start a live testnet auction first.');
  const current = currentSession(); const config = current.sandbox.config; const snapshot = current.sandbox.publicSnapshot();
  const notes = await fetchVaultMemos(config.vault, config.auctionId, Number(parseZec(config.collateral ?? '10')));
  if (notes.status !== 'ok') {
    const reasons = { 'wrong-network': 'the local wallet is not on Zcash testnet', syncing: 'the local testnet node is still syncing', 'wallet-not-configured': 'no local wallet RPC is configured', 'node-unavailable': 'the local wallet RPC did not answer' } as const;
    liveOk = false; liveSummary = `Sync failed: ${reasons[notes.status]}.`; return;
  }
  let added = 0; let skipped = 0;
  if (snapshot.phase === 'open') {
    for (const note of notes.commits) {
      if (current.sandbox.publicSnapshot().commitments.includes(note.commitment)) continue;
      try { await current.sandbox.submit({ auctionId: config.auctionId, commitment: note.commitment, collateral: config.collateral ?? '10' }); added++; }
      catch { skipped++; }
    }
    if (added) telemetry.log('committed');
    const pending = notes.reveals.length ? ` ${notes.reveals.length} reveal memo${notes.reveals.length === 1 ? '' : 's'} will be read after close.` : '';
    liveSummary = `Synced ${notes.commits.length} confirmed commit payment${notes.commits.length === 1 ? '' : 's'}: ${added} new, ${skipped} refused.${pending}`;
  } else if (snapshot.phase === 'reveal') {
    if (!snapshot.revealOpen) { liveOk = false; liveSummary = 'The reveal window has closed. Finalize to clear the verified reveals.'; return; }
    for (const note of notes.reveals) {
      let bid;
      try { bid = parseReceiptText(note.memo, 'testnet'); } catch { skipped++; continue; }
      // Reveals accepted on an earlier sync stay accepted; only new ones are submitted and acknowledged.
      if (current.sandbox.publicSnapshot().revealed.includes(await commitment(bid))) continue;
      try { await current.reveal(bid); added++; } catch { skipped++; }
    }
    if (added) telemetry.log('revealed');
    liveSummary = `Synced ${notes.reveals.length} reveal memo${notes.reveals.length === 1 ? '' : 's'}: ${added} newly accepted and signed, ${skipped} refused (no matching commitment, wrong auction or invalid receipt).`;
  } else { liveSummary = 'The auction is cleared; nothing more to import.'; }
  liveOk = skipped === 0;
}
button('sandbox-tab').addEventListener('click', () => setView('sandbox'));
button('wallet-tab').addEventListener('click', () => setView('wallet'));
button('vault-tab').addEventListener('click', () => setView('scanner'));
button('audit-tab').addEventListener('click', () => setView('audit'));

element('wallet-form', HTMLFormElement).addEventListener('input', () => { eraseWallet(); controls(); });
element('wallet-form', HTMLFormElement).addEventListener('submit', event => {
  event.preventDefault(); void action(async () => {
    eraseWallet();
    const selected = element('wallet-network', HTMLSelectElement).value;
    // No vault service exists for this prototype, so a mainnet request could only send real ZEC to an unmanaged address.
    if (selected === 'mainnet') throw new Error('Mainnet requests are disabled in this prototype. Use testnet.');
    if (selected !== 'testnet') throw new Error('Select a valid network.');
    const network: Network = selected;
    const vaultAddress = area('wallet-vault').value.trim(); const refund = area('wallet-refund').value.trim();
    for (const address of [vaultAddress, refund]) {
      const receivers = decodeUnifiedAddress(address, network);
      if (receivers.some(receiver => receiver.type === 3 && [FIXTURE_RECEIVER, FIXTURE_REFUND_RECEIVER].includes(hex(receiver.bytes)))) throw new Error('Public demo fixtures cannot be used for wallet requests. Use verified addresses you control or trust.');
    }
    const collateral = element('wallet-collateral', HTMLSelectElement).value;
    if (!COLLATERAL_TIERS.includes(collateral)) throw new Error('Choose a 1, 10 or 100 ZEC collateral tier.');
    walletPrepared = await prepareBid({ auctionId: input('wallet-auction').value, price: input('wallet-price').value,
      quantity: parseQuantity(input('wallet-quantity').value), vault: vaultAddress, refund, network, collateral }, event => securityAudit.protocol(event, 'wallet'));
    telemetry.memo({ bytes: walletPrepared.byteLength, state: 'ready' }, 'wallet'); telemetry.log('wallet');
    area('wallet-uri').value = walletPrepared.uri;
    area('wallet-reveal').value = receiptText(walletPrepared.reveal, network);
    text('wallet-amount', `${walletPrepared.amount} ZEC`); text('wallet-bytes', `${walletPrepared.byteLength} / 512 BYTES`);
    visible('wallet-output', true);
    button('testnet-check').disabled = network !== 'testnet';
    text('testnet-status', network === 'testnet' ? 'Ready to check the local testnet wallet for this payment.' : 'Chain verification is available for testnet requests only.');
    status('Payment request prepared on this device. Verify the full vault address and amount before opening your wallet.');
  });
});
input('wallet-reviewed').addEventListener('change', updateWalletLink);
button('download-wallet-receipt').addEventListener('click', () => {
  void action(async () => {
    if (!walletPrepared) throw new Error('Prepare a request first.');
    downloadText(receiptFilename(walletPrepared.reveal, walletPrepared.commitment), area('wallet-reveal').value);
    walletReceiptSaved = true;
    status('Reveal receipt downloaded. It holds your private price, quantity, salt and refund address: store it securely and never share it. Copy and Open wallet are now available.');
  });
});
function clearMemoVerification(): void {
  area('memo-verify-input').value = ''; text('memo-verify-result', '');
  const result = el('memo-verify-result'); result.classList.remove('is-ok', 'is-bad');
}
element('memo-verify-form', HTMLFormElement).addEventListener('submit', event => {
  event.preventDefault();
  void action(async () => {
    const result = el('memo-verify-result'); result.classList.remove('is-ok', 'is-bad');
    try {
      const imported = parseReceivedCommitMemo(area('memo-verify-input').value);
      const comparison = compareWithRequest(imported, walletPrepared ? { auctionId: walletPrepared.reveal.auctionId, commitment: walletPrepared.commitment } : undefined);
      result.textContent = `VALID COMMIT MEMO / auction ${imported.auctionId} / hash ${memoFingerprint(imported.commitment)} / ${imported.bytes} of 512 bytes / read as ${imported.transport}. ${comparison.detail}`;
      result.classList.add(comparison.matches ? 'is-ok' : 'is-bad');
      status('Memo validated locally. Nothing was sent anywhere.');
    } catch (error: unknown) {
      result.textContent = `REJECTED / ${error instanceof Error ? error.message : 'The memo could not be verified.'}`; result.classList.add('is-bad');
    }
  });
});
button('memo-verify-clear').addEventListener('click', clearMemoVerification);
button('testnet-check').addEventListener('click', () => { void action(async () => {
  if (!walletPrepared || element('wallet-network', HTMLSelectElement).value !== 'testnet') throw new Error('Prepare a testnet request first.');
  const address = /^zcash:([^?]+)/.exec(walletPrepared.uri)?.[1];
  if (!address) throw new Error('The payment request has no valid testnet destination.');
  const collateralZat = Number(parseZec(walletPrepared.amount));
  const result = await verifyTestnetCommit(address, walletPrepared.reveal.auctionId, walletPrepared.commitment, collateralZat);
  const output = el('testnet-payment-result'); output.classList.remove('is-ok', 'is-bad');
  if (result.status === 'confirmed') {
    output.textContent = `CONFIRMED / ${result.confirmations} confirmation${result.confirmations === 1 ? '' : 's'} / ${formatZec(BigInt(result.amountZat))} ZEC / tx ${result.txid}`;
    output.classList.add('is-ok'); telemetry.log('wallet');
  } else {
    const messages = { 'not-found': 'No matching confirmed Orchard payment was found. Check that the local wallet can view the vault address and that the memo and collateral are exact.', 'wrong-network': 'The local wallet is not connected to Zcash testnet.', syncing: 'Wait for the local testnet node to finish syncing, then check again.', 'wallet-not-configured': 'Configure the local zcashd RPC credentials, then restart DarkZec.', 'node-unavailable': 'The local testnet wallet RPC could not complete the check.' } as const;
    output.textContent = `NOT CONFIRMED / ${messages[result.status]}`; output.classList.add('is-bad'); telemetry.log('invalid');
  }
}); });
button('copy-wallet').addEventListener('click', () => {
  void action(async () => {
    if (walletPrepared && !walletReceiptSaved) throw new Error('Download the reveal receipt before copying the payment request. Without it the commitment can never be revealed.');
    await copy(walletPrepared?.uri ?? '');
  });
});
button('wallet-reveal-build').addEventListener('click', () => { const file = input('wallet-reveal-file'); file.value = ''; file.click(); });
input('wallet-reveal-file').addEventListener('change', () => {
  const file = input('wallet-reveal-file').files?.[0]; input('wallet-reveal-file').value = ''; if (!file) return;
  void action(async () => {
    eraseWalletReveal();
    const bid = await readReceiptFile(file, 'testnet');
    const vaultAddress = orchardPaymentAddress(area('wallet-vault').value.trim(), 'testnet'); refuseFixtureVault(vaultAddress);
    assertDistinctRefund(bid.refund, vaultAddress, 'testnet');
    walletRevealUri = buildPaymentUri({ address: vaultAddress, amount: REVEAL_AMOUNT, memo: receiptText(bid, 'testnet'), network: 'testnet' });
    area('wallet-reveal-uri').value = walletRevealUri; visible('wallet-reveal-output', true);
    status(`Reveal request for auction ${bid.auctionId} built: ${REVEAL_AMOUNT} ZEC to the vault with your receipt as the shielded memo. Send it only after the auction closes and before the reveal deadline.`);
  });
});
button('wallet-reveal-copy').addEventListener('click', () => { void action(() => copy(walletRevealUri)); });
element('wallet-reveal-open', HTMLAnchorElement).addEventListener('click', event => { if (!walletRevealUri || working) event.preventDefault(); });
button('erase-wallet').addEventListener('click', () => { eraseWallet(); telemetry.log('erased'); controls(); status('Sensitive payment request erased from the interface.'); });
element('open-wallet', HTMLAnchorElement).addEventListener('click', event => {
  if (!walletPrepared || !walletReceiptSaved || !input('wallet-reviewed').checked || working) event.preventDefault();
});

// Best-effort clear on page exit; JS strings and browser/OS clipboard cannot be securely erased.
window.addEventListener('pagehide', () => { clearPrepared(); eraseWallet(); effects.destroy(); session = undefined; lastResult = undefined; });
window.addEventListener('pageshow', event => {
  // A restored bfcache document must not retain stale controls after pagehide erased its vault.
  if (event.persisted) window.location.reload();
});
void action(async () => {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('Open DarkZec on localhost or HTTPS to enable browser cryptography.');
  session = await AuctionSession.create(SIMULATION_CONFIG, judgeClock); auctionConfig = session.sandbox.config; renderStrip();
  memoPreview.setEnabled(true); memoPreview.update();
});
void refreshNodeStatus();
