import { describe, expect, it } from 'vitest';
import { SecurityAudit } from '../src/lib/security-events';
import type { ProtocolAuditEvent, ScanAuditEvent, SecuritySnapshot } from '../src/lib/security-events';
import { prepareBid } from '../src/protocol/memo';
import { FIXTURE_ADDRESS, FIXTURE_REFUND_ADDRESS } from '../src/fixtures';
import { createDemoNotes, mockNoteKey, MOCK_SCAN_SCOPE, scanMockNotes } from '../src/lib/mock-note-scanner';
import { DEMO_VIEWING_KEY } from '../src/lib/viewing-key-session';

const request = { auctionId: 'PRIVATE-AUCTION', price: '0.937142', quantity: 7, refund: FIXTURE_REFUND_ADDRESS, vault: FIXTURE_ADDRESS, network: 'testnet' as const };

describe('bounded local security audit', () => {
  it('retains only fixed metadata, immutable snapshots and monotonic timestamps', async () => {
    let time = 1000; const audit = new SecurityAudit(() => time);
    const events: ProtocolAuditEvent[] = [];
    const result = await prepareBid(request, event => { events.push(event); audit.protocol(event, 'composer'); });
    expect(events).toEqual([{ type: 'memo-validated', bytes: result.byteLength }, { type: 'commitment-created' }, { type: 'uri-generated' }]);
    time = 0; audit.log('prepared');
    const state = audit.snapshot(); const encoded = JSON.stringify(state);
    for (const secret of [request.auctionId, request.price, FIXTURE_ADDRESS, result.memo, result.uri, result.commitment]) expect(encoded).not.toContain(secret);
    expect(state.entries.map(entry => entry.timestamp)).toEqual(Array(4).fill('1970-01-01T00:00:01.000Z'));
    expect(Object.isFrozen(state)).toBe(true); expect(Object.isFrozen(state.entries)).toBe(true); expect(Object.isFrozen(state.entries[0])).toBe(true);
  });
  it('bounds history and keeps blocked counters after clear and reset', () => {
    const audit = new SecurityAudit(); audit.encryption('auction-sealed'); audit.networkGuard(true); audit.log('blocked');
    for (let i = 0; i < 200; i++) audit.log('committed');
    expect(audit.snapshot().entries).toHaveLength(128); expect(audit.snapshot().dropped).toBe(75);
    audit.memo({ bytes: 512, state: 'ready' }, 'wallet');
    const sequence = audit.snapshot().totalEvents; audit.clear();
    expect(audit.snapshot()).toMatchObject({ entries: [], dropped: 0, leaksBlocked: 1, shield: 'ACTIVE', networkGuard: true, memo: { bytes: 512 }, totalEvents: sequence });
    audit.reset(); expect(audit.snapshot()).toMatchObject({ leaksBlocked: 1, shield: 'IDLE', memo: { bytes: 0, state: 'empty' } });
    expect(audit.snapshot().entries).toHaveLength(1); expect(audit.snapshot().entries[0]?.sequence).toBe(sequence + 1);
  });
  it('rejects invalid runtime metadata without exposing extra properties', () => {
    const audit = new SecurityAudit();
    for (const bytes of [-1, 513, NaN, Infinity, 1.1]) audit.memo({ bytes, state: 'ready' });
    audit.protocol({ type: 'memo-validated', bytes: 513 }, 'composer');
    audit.vault({ type: 'scan-completed', accepted: 128, rejected: 1, empty: 0 });
    const event = { type: 'uri-generated' as const, privateInput: 'SECRET-SHOULD-NEVER-APPEAR' };
    audit.protocol(event, 'wallet');
    expect(audit.snapshot().entries).toHaveLength(1); expect(audit.snapshot().memo.bytes).toBe(0);
    expect(JSON.stringify(audit.snapshot())).not.toContain(event.privateInput);
  });
  it('isolates throwing subscribers and observers, supports unsubscribe and disposal', async () => {
    const audit = new SecurityAudit(); const states: SecuritySnapshot[] = [];
    audit.subscribe(() => { throw new Error('private exception'); });
    const stop = audit.subscribe(state => states.push(state)); audit.log('boot');
    expect(states).toHaveLength(2); stop(); audit.log('prepared'); expect(states).toHaveLength(2);
    const result = await prepareBid(request, () => { throw new Error('observer must not break crypto'); });
    expect(result.uri).toMatch(/^zcash:/); audit.destroy(); audit.log('blocked');
    expect(audit.snapshot().entries).toHaveLength(0); expect(audit.snapshot().leaksBlocked).toBe(0);
  });
  it('reports genuine preparation failures without claiming URI success', async () => {
    const events: ProtocolAuditEvent[] = [];
    await expect(prepareBid({ ...request, vault: 'invalid-private-destination' }, event => events.push(event))).rejects.toThrow();
    expect(events.at(-1)).toEqual({ type: 'preparation-rejected', phase: 'input' });
    expect(events.some(event => event.type === 'uri-generated')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('invalid-private-destination');
    events.splice(0);
    await expect(prepareBid({ ...request, price: 'invalid-private-price' }, event => events.push(event))).rejects.toThrow();
    expect(events).toEqual([{ type: 'preparation-rejected', phase: 'input' }]);
  });
  it('emits authenticated scanner results without note IDs, keys, commitments or amounts', async () => {
    const notes = await createDemoNotes(); const key = await mockNoteKey(DEMO_VIEWING_KEY);
    const events: ScanAuditEvent[] = []; const audit = new SecurityAudit();
    const rows = await scanMockNotes(notes, key, MOCK_SCAN_SCOPE, undefined, undefined, event => { events.push(event); audit.vault(event); });
    expect(rows).toHaveLength(5);
    expect(events.filter(event => event.type === 'decryption-attempt')).toHaveLength(5);
    expect(events.filter(event => event.type === 'decryption-succeeded')).toHaveLength(5);
    expect(events.filter(event => event.type === 'scan-memo-validated')).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: 'scan-completed', accepted: 3, rejected: 1, empty: 1 });
    const encoded = JSON.stringify(audit.snapshot());
    for (const secret of [DEMO_VIEWING_KEY, notes[0]?.commitment ?? 'NO COMMITMENT', 'NOTE-0001', FIXTURE_ADDRESS, '0.74']) expect(encoded).not.toContain(secret);
    const wrong = await mockNoteKey(`mock:node07:${'08'.repeat(32)}`); events.splice(0);
    await scanMockNotes(notes, wrong, MOCK_SCAN_SCOPE, undefined, undefined, event => events.push(event));
    expect(events.filter(event => event.type === 'decryption-succeeded')).toHaveLength(0);
    expect(events.filter(event => event.type === 'note-rejected' && event.authentication)).toHaveLength(5);
    expect(events.at(-1)).toEqual({ type: 'scan-completed', accepted: 0, rejected: 5, empty: 0 });
  });
  it('cancels scans without late success events even if cancellation happens during hashing', async () => {
    const notes = await createDemoNotes(); const key = await mockNoteKey(DEMO_VIEWING_KEY);
    const events: ScanAuditEvent[] = []; const controller = new AbortController();
    await expect(scanMockNotes(notes, key, MOCK_SCAN_SCOPE, controller.signal, undefined, event => {
      events.push(event); if (event.type === 'decryption-succeeded') controller.abort();
    })).rejects.toThrow('cancelled');
    expect(events.some(event => event.type === 'scan-memo-validated' || event.type === 'scan-completed')).toBe(false);
    const result = await scanMockNotes(notes, key, MOCK_SCAN_SCOPE, undefined, undefined, () => { throw new Error('ignored observer'); });
    expect(result.filter(row => row.status === 'accepted')).toHaveLength(3);
  });
  it('requires verified local payload state for ACTIVE and clears it on lock, failure and reset', () => {
    const audit = new SecurityAudit(); expect(audit.snapshot().shield).toBe('IDLE');
    audit.protocol({ type: 'memo-validated', bytes: 200 }, 'composer'); audit.protocol({ type: 'uri-generated' }, 'wallet');
    expect(audit.snapshot().shield).toBe('IDLE');
    audit.encryption('auction-sealed'); expect(audit.snapshot()).toMatchObject({ shield: 'ACTIVE', payloadState: 'auction-sealed' });
    expect(audit.snapshot().shieldDetail).toContain('mock AES-GCM');
    audit.encryption('idle'); audit.vault({ type: 'decryption-succeeded' }); expect(audit.snapshot().shield).toBe('IDLE');
    audit.vault({ type: 'scan-memo-validated', bytes: 200 }); expect(audit.snapshot()).toMatchObject({ shield: 'ACTIVE', payloadState: 'vault-verified' });
    audit.vault({ type: 'vault-locked' }); expect(audit.snapshot().shield).toBe('IDLE');
    audit.vault({ type: 'scan-completed', accepted: 0, rejected: 5, empty: 0 }); expect(audit.snapshot().shield).toBe('OFFLINE');
    audit.reset(); expect(audit.snapshot().shield).toBe('IDLE');
  });
  it('keeps encrypted submission and Merkle compilation as distinct fixed events', () => {
    const audit = new SecurityAudit(); audit.log('committed');
    expect(JSON.stringify(audit.snapshot())).not.toContain('Merkle leaf');
    audit.log('closed'); audit.log('merkle');
    expect(audit.snapshot().entries.map(entry => entry.message)).toEqual([
      'Bid payload encrypted and committed locally', 'Commitment set frozen', 'Merkle leaf generated for frozen commitment set; root compiled',
    ]);
  });
});
