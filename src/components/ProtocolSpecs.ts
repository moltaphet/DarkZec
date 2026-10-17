import type { Disposable } from '../lib/dom';

interface ProtocolEntry {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly tag: string;
  readonly paragraphs: readonly string[];
  readonly formula?: string;
  readonly note: string;
}

const ENTRIES: readonly ProtocolEntry[] = [
  {
    id: 'overview', title: 'Overview', question: 'Why trade in the dark?', tag: 'PRIVATE MARKETS',
    paragraphs: [
      'A dark pool keeps trading intentions off a public orderbook before execution. DarkZec’s design carries sealed auction bids in Zcash shielded notes, with only salted commitment hashes visible in the public book. Wallet addresses, limit prices and quantities stay out of that book, reducing the information available for order surveillance and front-running.',
      'The same private-instruction model can support negotiated OTC trades: counterparties agree terms privately and use shielded settlement rather than publishing their entire negotiation. OTC matching and live settlement are production goals; this terminal currently provides a local auction sandbox and a wallet request builder.',
    ],
    note: 'LOCAL BOUNDARY / The terminal makes no external runtime requests. Shielded payments reduce on-chain metadata exposure; they do not eliminate timing correlation, device compromise or disclosures to a trusted vault or wallet.',
  },
  {
    id: 'privacy', title: 'Privacy mechanics', question: 'How does a bid reach the wallet?', tag: 'ZIP-302 / ZIP-321',
    paragraphs: [
      'The bid is compact JSON containing a version, auction ID, canonical price, quantity, secret salt and Orchard refund address. DarkZec checks its UTF-8 byte length before encoding: the decoded payload must fit within the 512-byte shielded memo field. ZIP-302 describes memo-field interpretation; the wallet’s Zcash transaction machinery performs the actual note and memo encryption.',
      'ZIP-321 carries those bytes as unpadded Base64url in the memo parameter of a zcash: payment URI. The request includes an Orchard-only Unified Address and an exact ZEC amount. Zodl or another compatible Orchard wallet can review the request and construct the shielded payment; URI handling depends on the installed wallet and device.',
    ],
    formula: 'JSON → UTF-8 ≤ 512 bytes → Base64url → ZIP-321 URI → wallet → encrypted Orchard memo',
    note: 'PRIVATE HANDOFF / Base64url is readable encoding, not encryption. The URI contains your bid and salt. Share it only with a trusted wallet, and verify the full destination, network and amount there. No seed or spending key is requested.',
  },
  {
    id: 'clearing', title: 'Clearing engine', question: 'What is a Vickrey second-price auction?', tag: 'PROTOCOL OPTION',
    paragraphs: [
      'In a single-lot Vickrey sealed-bid auction, the highest eligible bidder wins and pays the second-highest bid, subject to the announced reserve and tie rules. For example, with bids of 0.90, 0.75 and 0.60 ZEC and a reserve below 0.75 ZEC, the winning bidder pays 0.75 ZEC. The clearing rule must be announced before bids are accepted.',
      'In a production vault, an authorized Incoming Viewing Key (IVK) holder can decrypt incoming shielded notes without gaining spending authority from that key. After the auction closes, the engine can read bids, compute the clearing price and publish the price plus commitment-based audit data while withholding participant addresses from the public. The viewing-key holder can still see the incoming note contents.',
    ],
    note: 'CURRENT SANDBOX / This build uses a uniform-price multi-lot engine, not Vickrey: exhausted supply pays the marginal accepted price; unsold supply pays reserve. The separate Vault scanner authenticates mock AES-GCM notes using a saved, passphrase-encrypted key. No real Orchard IVK scanning or settlement runs here.',
  },
  {
    id: 'audit', title: 'Verifiable audit', question: 'How do I prove my bid was included?', tag: 'SHA-256 / MERKLE',
    paragraphs: [
      'Keep your auction ID, canonical bid price, quantity and salt private. Recompute the SHA-256 commitment below to identify your own leaf in the published commitment set. The salt prevents someone who sees only the commitment from simply guessing a small range of prices and quantities.',
      'An inclusion proof supplies the leaf index, tree size and sibling hashes along the path to the frozen Merkle root. Hashing that path locally must reproduce the root. The salt is needed to reconstruct your commitment; the public inclusion check itself uses only that commitment and the proof, so you do not need to disclose your bid or salt.',
    ],
    formula: 'SHA256(auction_id || ":" || bid_price || ":" || quantity || ":" || salt)',
    note: 'VERIFY LOCALLY / Close the sandbox auction, then use Inclusion audit to verify an entry. Its root is local and not independently anchored. Inclusion alone does not prove fair clearing or payment. Reset/reload discards this session’s bid secrets; a live deployment needs a secure bidder receipt and an anchored root.',
  },
];

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className; node.textContent = text;
  return node;
}

/** Static, local documentation: no application secrets or asynchronous state are consumed. */
export function mountProtocolSpecs(host: HTMLElement): Disposable {
  const manual = document.createElement('details');
  manual.id = 'protocol-manual'; manual.className = 'panel protocol-manual';
  const summary = document.createElement('summary'); summary.className = 'protocol-manual-summary';
  const heading = document.createElement('h2'); heading.className = 'protocol-manual-heading';
  const label = document.createElement('span');
  const title = textElement('span', 'protocol-manual-title', '[ PROTOCOL SPECS & FAQ ]');
  label.append(textElement('span', 'micro protocol-manual-code', 'NODE 07 / FIELD MANUAL'), title,
    textElement('span', 'protocol-manual-description', 'Privacy mechanics. Clearing rules. Proof of inclusion.'));
  const affordance = textElement('span', 'protocol-manual-affordance', ''); affordance.setAttribute('aria-hidden', 'true');
  affordance.append(textElement('span', 'protocol-manual-count', '04 ENTRIES'), textElement('span', 'protocol-expand', '+'));
  heading.append(label, affordance); summary.append(heading); manual.append(summary);

  const body = document.createElement('div'); body.className = 'protocol-manual-body';
  const introduction = textElement('p', 'protocol-manual-intro', 'Read the design, then verify the implementation. Production mechanics and the local sandbox are labeled separately throughout.');
  body.append(introduction);
  ENTRIES.forEach((entry, index) => {
    const article = document.createElement('details'); article.className = 'protocol-entry'; article.id = `protocol-${entry.id}`;
    article.open = index === 0;
    const row = document.createElement('summary'); row.className = 'protocol-entry-summary';
    const text = document.createElement('span'); text.className = 'protocol-entry-heading';
    text.append(textElement('span', 'protocol-entry-title', entry.title), textElement('span', 'protocol-entry-question', entry.question));
    const marker = textElement('span', 'protocol-entry-toggle', '+'); marker.setAttribute('aria-hidden', 'true');
    row.append(textElement('span', 'protocol-entry-number', String(index + 1).padStart(2, '0')), text,
      textElement('span', 'protocol-entry-tag', entry.tag), marker);
    const content = document.createElement('div'); content.className = 'protocol-entry-content';
    for (const paragraph of entry.paragraphs) content.append(textElement('p', '', paragraph));
    if (entry.formula) content.append(textElement('code', 'protocol-formula', entry.formula));
    content.append(textElement('p', 'protocol-entry-note', entry.note));
    article.append(row, content); body.append(article);
  });
  const footer = textElement('div', 'protocol-manual-footer', 'END OF FIELD MANUAL / LOCAL DOCUMENTATION / NO NETWORK REQUIRED');
  body.append(footer); manual.append(body); host.replaceChildren(manual);
  return { destroy() { manual.remove(); } };
}
