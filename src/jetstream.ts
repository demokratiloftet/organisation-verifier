import { isValidDid, isValidHandle } from '@atproto/syntax';
import { Store } from './store.js';

// Jetstream v2 JSON envelopes. Events only enqueue fresh authoritative lookups.
export function queueEvent(store: Store, input: unknown): void {
  const envelope = input as { $type?: string; payload?: Record<string, unknown> };
  if (envelope?.$type !== 'message' || !envelope.payload) throw new Error('Invalid Jetstream envelope.');
  const event = envelope.payload;
  const seq = event.seq;
  const did = event.did;
  const kind = String(event.$type).split('#')[1];
  if (kind === 'info') {
    if (event.name === 'OutdatedCursor' || event.name === 'FutureCursor') {
      store.transaction(() => {
        store.set('jetstream.gap', String(event.name));
        store.set('jetstream.cursor', '0');
        store.db.exec('UPDATE organisations SET next_check=0');
      });
    }
    return;
  }
  const witnessed = typeof event.witnessedAt === 'string' ? event.witnessedAt : event.time;
  if (
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 0 ||
    typeof did !== 'string' ||
    !isValidDid(did) ||
    typeof witnessed !== 'string' ||
    !Number.isFinite(Date.parse(witnessed))
  )
    throw new Error('Invalid Jetstream event.');
  if (seq <= Number(store.get('jetstream.cursor') ?? -1)) return;
  const identity = event.identity as { handle?: unknown } | undefined;
  const handle =
    typeof identity?.handle === 'string' && isValidHandle(identity.handle) ? identity.handle : undefined;
  const account = event.account as { active?: boolean } | undefined;
  store.transaction(() => {
    const orgnrs = store.affected(did, handle);
    if (
      kind === 'identity' ||
      kind === 'account' ||
      kind === 'sync' ||
      (kind === 'commit' && event.collection === 'app.bsky.actor.profile')
    ) {
      for (const orgnr of orgnrs) store.enqueue(orgnr);
      if (
        !orgnrs.length &&
        ((kind === 'account' && account?.active === true) || (kind === 'identity' && !handle))
      )
        store.enqueue(did, Date.now(), 0);
    }
    store.set('jetstream.cursor', String(seq));
    store.set('jetstream.time', witnessed);
    store.set('jetstream.lastEvent', new Date().toISOString());
  });
}

export function startJetstream(store: Store, endpoint: string): () => void {
  const base = new URL(endpoint);
  if (base.protocol !== 'wss:' || base.username || base.password || base.search || base.hash)
    throw new Error('Jetstream requires a credential-free WSS endpoint.');
  if (store.get('jetstream.endpoint') !== endpoint)
    store.transaction(() => {
      store.set('jetstream.endpoint', endpoint);
      store.set('jetstream.cursor', '0');
      store.db.exec('UPDATE organisations SET next_check=0');
    });
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setInterval> | undefined;
  let attempts = 0;
  const connect = () => {
    const url = new URL(base);
    url.searchParams.set('collections', 'app.bsky.actor.profile');
    const time = store.get('jetstream.time');
    // Timestamp replay clamps to retention and emits OutdatedCursor, unlike a stale seq (HTTP 400).
    if (time) url.searchParams.set('cursor', String(Date.parse(time) * 1000 - 1_000_000));
    socket = new WebSocket(url, ['xrpc.v1.json']);
    let lastMessage = Date.now();
    socket.onopen = () => store.set('jetstream.connection', 'connected');
    socket.onmessage = (message) => {
      try {
        if (typeof message.data !== 'string' || message.data.length > 1_000_000)
          throw new Error('Unexpected frame.');
        queueEvent(store, JSON.parse(message.data));
        lastMessage = Date.now();
        attempts = 0;
      } catch {
        store.set('jetstream.connection', 'invalid event; reconnecting');
        socket?.close();
      }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      if (idle) clearInterval(idle);
      store.set('jetstream.connection', 'disconnected');
      if (!stopped) retry = setTimeout(connect, Math.min(60_000, 1000 * 2 ** Math.min(attempts++, 6)));
    };
    idle = setInterval(() => {
      if (Date.now() - lastMessage > 60_000) socket?.close();
    }, 10_000);
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (idle) clearInterval(idle);
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onopen = null;
      socket.close();
    }
  };
}
