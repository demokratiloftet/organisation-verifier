import type { Mode, Decision, SavedCheck } from '../src/domain.js';
import type { Publication, VerifiedPage } from '../src/store.js';
import type { FixtureState } from '../src/sources.js';
interface State {
  checks: SavedCheck[];
  publications: Publication[];
  network?: FixtureState;
  busy?: boolean;
}
function element<T extends HTMLElement>(selector: string, constructor: { new (): T }): T {
  const node = document.querySelector(selector);
  if (!(node instanceof constructor)) throw new Error(`Missing page element: ${selector}`);
  return node;
}
const $ = (selector: string) => element(selector, HTMLElement);
let mode: Mode = 'fixture';
let automatic = false;
let state: State = { checks: [], publications: [] };
// Keep the operator's result even when the batch adds newer checks to history.
const selectedChecks: Partial<Record<Mode, SavedCheck>> = {};
const labels: Record<Decision, string> = {
  match: 'Samsvar',
  no_match: 'Ingen kobling',
  needs_review: 'Må vurderes',
  unavailable: 'Kunne ikke kontrolleres',
};
const publicationLabels: Record<Publication['state'], string> = {
  pending: 'Venter på bekreftelse',
  published: 'Publisert',
  revoking: 'Tilbaketrekking pågår',
  revoked: 'Trukket tilbake',
};
const time = (value: string) =>
  new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    new Date(value),
  );
const text = (selector: string, value: string) => {
  $(selector).textContent = value;
};

function selectMode(next: Mode) {
  mode = next;
  for (const name of ['fixture', 'live']) {
    $(`#${name}-panel`).hidden = name !== mode;
    $(`#${name}-tab`).classList.toggle('active', name === mode);
    $(`#${name}-tab`).setAttribute('aria-pressed', String(name === mode));
  }
  $('#notice').hidden = true;
  render();
}
function field(label: string, value: string | undefined, mono = false) {
  const item = document.createElement('div');
  const dt = document.createElement('span');
  dt.textContent = label;
  const dd = document.createElement('strong');
  dd.textContent = value ?? '—';
  if (mono) dd.className = 'mono';
  item.append(dt, dd);
  return item;
}
function render() {
  const checks = state.checks.filter((check) => check.mode === mode);
  const check = selectedChecks[mode] ?? checks[0];
  // A fixture restart creates new DIDs. Never present old records as current.
  const publications = state.publications.filter((p) =>
    mode === 'fixture'
      ? p.repo === state.network?.issuer.did
      : p.mode === 'live' && p.orgnr === check?.organisation.orgnr,
  );
  const publication = publications[0];
  text('#result-title', check?.organisation.name ?? 'Klar for kontroll');
  text(
    '#reason',
    check?.reason ??
      (mode === 'fixture'
        ? 'Velg en situasjon og kjør kontrollen.'
        : 'Skriv inn organisasjonsnummeret og kjør kontrollen.'),
  );
  $('#check-details').hidden = !check;
  $('#account-help').hidden = !(
    mode === 'live' &&
    check?.decision === 'no_match' &&
    !check.organisation.deleted &&
    check.candidate &&
    !check.identity
  );
  text('#decision', check ? labels[check.decision] : 'Ikke kjørt');
  $('#decision').className = `badge ${check?.decision ?? ''}`;
  $('#evidence').replaceChildren(
    ...(check
      ? [
          field(
            'ORGANISASJONSNUMMER',
            `${check.organisation.orgnr}${mode === 'fixture' ? ' · fiktivt' : ''}`,
          ),
          field('REGISTRERT HJEMMESIDE', check.organisation.website),
          field('HANDLE', check.candidate, true),
          field('PROFILNAVN', check.identity?.displayName),
          field('KONTOENS DID', check.identity?.did, true),
          field(
            'KONTROLLERT',
            `${time(check.checkedAt)} · ${mode === 'fixture' ? 'syntetisk registergrunnlag' : check.registrySource === 'index' ? 'oppdatert Brreg-indeks' : 'Brreg API'}`,
          ),
        ]
      : []),
  );
  $('#record-section').hidden = !publication;
  $('#record').hidden = !publication;
  if (publication) {
    text('#record-title', mode === 'fixture' ? 'Verifikasjon i testmiljøet' : 'Verifikasjon fra utstederen');
    text('#publication-status', publicationLabels[publication.state]);
    $('#publication-status').className =
      `badge ${publication.state === 'published' ? 'match' : 'needs_review'}`;
    text(
      '#publication-note',
      publication.error ??
        (publication.state === 'revoked'
          ? 'Verifikasjonen er fjernet.'
          : mode === 'fixture'
            ? 'Ingen offentlig publisering.'
            : 'Håndteres automatisk av tjenesten.'),
    );
    text(
      '#record',
      JSON.stringify(
        {
          uri: publication.uri,
          rkey: publication.rkey,
          state: publication.state,
          record: publication.record,
        },
        null,
        2,
      ),
    );
  }
  $('#history-panel').hidden = !checks.length;
  text('#history-count', String(checks.length));
  const rows: HTMLElement[] = checks.slice(0, 8).map((item) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const timestamp = document.createElement('span');
    timestamp.textContent = time(item.checkedAt);
    timestamp.className = 'mono muted';
    const name = document.createElement('strong');
    name.textContent = item.organisation.name;
    const badge = document.createElement('span');
    badge.textContent = labels[item.decision];
    badge.className = `badge ${item.decision}`;
    row.append(timestamp, name, badge);
    return row;
  });
  $('#history').replaceChildren(...rows);
}
let verifiedPage = 1;
let verifiedQuery = '';
let verifiedRequest = 0;
let verifiedSnapshot = '';
async function refreshVerified() {
  const request = ++verifiedRequest;
  const params = new URLSearchParams({ view: 'verified', q: verifiedQuery, page: String(verifiedPage) });
  try {
    const response = await fetch(`/api/state?${params}`);
    if (!response.ok)
      throw new Error('Kunne ikke hente organisasjonslisten. Prøver igjen ved neste oppdatering.');
    const data = (await response.json()) as VerifiedPage & { issuer: { did: string; pds: string } | null };
    if (request !== verifiedRequest) return;
    verifiedPage = data.page;
    const snapshot = JSON.stringify([data, verifiedQuery]);
    if (snapshot === verifiedSnapshot) return;
    verifiedSnapshot = snapshot;
    text('#verified-count', `${data.total} verifisert`);
    text(
      '#verified-message',
      data.matching
        ? verifiedQuery
          ? `${data.matching} treff av ${data.total} verifiserte organisasjoner.`
          : `${data.total} organisasjoner har aktiv verifikasjon.`
        : verifiedQuery
          ? 'Ingen treff. Prøv et annet navn, organisasjonsnummer eller domene.'
          : 'Ingen aktive offentlige verifikasjoner ennå.',
    );
    $('#verified-rows').replaceChildren(
      ...data.items.map((item) => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        const title = document.createElement('strong');
        title.textContent = item.name;
        const orgnr = document.createElement('small');
        orgnr.textContent = `Org.nr. ${item.orgnr}`;
        name.append(title, orgnr);
        const account = document.createElement('td');
        const profile = document.createElement('a');
        profile.textContent = `@${item.handle}`;
        profile.href = `https://bsky.app/profile/${encodeURIComponent(item.did)}`;
        profile.target = '_blank';
        profile.rel = 'noopener noreferrer';
        account.append(profile);
        const confirmed = document.createElement('td');
        const date = document.createElement('time');
        date.dateTime = item.confirmedAt;
        date.textContent = new Intl.DateTimeFormat('nb-NO', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(item.confirmedAt));
        date.title = new Date(item.confirmedAt).toLocaleString('nb-NO');
        confirmed.append(date);
        const record = document.createElement('td');
        if (data.issuer) {
          const link = document.createElement('a');
          link.textContent = 'Se record ↗';
          const url = new URL('/xrpc/com.atproto.repo.getRecord', data.issuer.pds);
          url.search = new URLSearchParams({
            repo: data.issuer.did,
            collection: 'app.bsky.graph.verification',
            rkey: item.rkey,
          }).toString();
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `Se offentlig verifikasjon for ${item.name}`);
          record.append(link);
        }
        row.append(name, account, confirmed, record);
        return row;
      }),
    );
    $('#verified-table-wrap').hidden = !data.items.length;
    $('#verified-pagination').hidden = data.pages <= 1;
    text('#verified-page', `Side ${data.page} av ${data.pages}`);
    element('#verified-prev', HTMLButtonElement).disabled = data.page <= 1;
    element('#verified-next', HTMLButtonElement).disabled = data.page >= data.pages;
  } catch (error) {
    if (request !== verifiedRequest) return;
    verifiedSnapshot = '';
    text(
      '#verified-message',
      error instanceof Error ? error.message : 'Kunne ikke hente organisasjonslisten.',
    );
    text('#verified-count', 'Status ukjent');
    $('#verified-rows').replaceChildren();
    $('#verified-table-wrap').hidden = true;
    $('#verified-pagination').hidden = true;
  }
}
$('#verified-search').addEventListener('submit', (event) => {
  event.preventDefault();
  verifiedQuery = element('#verified-query', HTMLInputElement).value.trim();
  verifiedPage = 1;
  void refreshVerified();
});
$('#verified-prev').addEventListener('click', () => {
  verifiedPage--;
  void refreshVerified();
});
$('#verified-next').addEventListener('click', () => {
  verifiedPage++;
  void refreshVerified();
});
void refreshVerified();
async function refresh() {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Kunne ikke hente status.');
  // Same-origin response produced by the typed server; rendered only as text.
  state = (await response.json()) as State;
  render();
  const automationResponse = await fetch('/api/automation');
  if (!automationResponse.ok) throw new Error('Kunne ikke hente bakgrunnsstatus.');
  const automation = (await automationResponse.json()) as {
    enabled: boolean;
    publishing: boolean;
    privateIssuance: boolean;
    issuanceScope: 'pilot' | 'all_matching' | null;
    organisations: number;
    queued: number;
    retrying: number;
    discovery: number;
    withWebsite: number;
    completed: number;
    progress: Record<string, string>;
  };
  $('#automation-panel').hidden = !automation.enabled;
  automatic = automation.enabled;
  text(
    '#automation-mode',
    automation.publishing
      ? automation.privateIssuance
        ? 'Intern pilot'
        : automation.issuanceScope === 'all_matching'
          ? 'Automatisk utstedelse til alle som består'
          : 'Utstedelse til pilotlisten'
      : 'Kun forhåndsvisning',
  );
  text(
    '#automation-summary',
    `${automation.organisations.toLocaleString('nb-NO')} organisasjoner i registeret, ${automation.withWebsite.toLocaleString('nb-NO')} med registrert domene. ${automation.completed.toLocaleString('nb-NO')} organisasjoner har minst én fullført kontroll, også de uten treff.`,
  );
  text(
    '#automation-throughput',
    `${(automation.queued - automation.discovery).toLocaleString('nb-NO')} organisasjonskontroller og ${automation.discovery.toLocaleString('nb-NO')} kontooppslag i kø. ${automation.progress['worker.completedLastMinute'] ?? '0'} jobber behandlet siste minutt (inkludert mislykkede forsøk). Inntil ${automation.progress['worker.concurrency'] ?? '1'} samtidige jobber.`,
  );
  const phases: Record<string, string> = {
    loading: 'Registerimport pågår',
    catchup: 'Henter registerendringer',
    ready: 'Registeret er importert',
  };
  text(
    '#automation-progress',
    `${phases[automation.progress['import.phase'] ?? ''] ?? 'Full registerimport er ikke kjørt'}. Siste registeroppdatering: ${automation.progress['registry.lastPoll'] ?? 'ikke kjørt'}.`,
  );
  text(
    '#automation-errors',
    [
      automation.retrying ? `${automation.retrying} kontroller venter på nytt forsøk.` : '',
      automation.progress['worker.error'],
      automation.progress['registry.error'],
    ]
      .filter(Boolean)
      .join(' '),
  );
  $('#automation-errors').hidden = !$('#automation-errors').textContent;
}
async function run(path: string, body: Record<string, string>) {
  const buttons = document.querySelectorAll<HTMLButtonElement>('form button');
  buttons.forEach((button) => {
    button.disabled = true;
  });
  $('#notice').hidden = false;
  $('#notice').className = 'working';
  text('#notice', 'Kontrollerer kilder og identitet …');
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Kontrollen feilet.',
      );
    if (typeof result === 'object' && result !== null && 'check' in result) {
      const check = result.check as SavedCheck;
      selectedChecks[check.mode] = check;
    }
    await refresh();
    text('#notice', 'Kontrollen er ferdig.');
    $('#notice').className = 'success';
  } catch (error) {
    text('#notice', error instanceof Error ? error.message : 'Kontrollen feilet.');
    $('#notice').className = 'error';
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
$('#fixture-tab').addEventListener('click', () => selectMode('fixture'));
$('#live-tab').addEventListener('click', () => selectMode('live'));
$('#fixture-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run('/api/fixture/check', { scenario: element('#scenario', HTMLSelectElement).value });
});
$('#live-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run('/api/live/check', { orgnr: element('#orgnr', HTMLInputElement).value });
});
refresh().catch((error) => {
  $('#notice').hidden = false;
  text('#notice', error instanceof Error ? error.message : 'Kontrollen feilet.');
});
setInterval(() => {
  if (!document.hidden) void refreshVerified();
  if (automatic && !document.hidden && !document.querySelector('form button:disabled'))
    refresh().catch(() => {
      text('#automation-errors', 'Status kunne ikke oppdateres. Prøver igjen.');
      $('#automation-errors').hidden = false;
    });
}, 10_000);
