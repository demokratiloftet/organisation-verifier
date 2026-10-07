const $ = (selector) => document.querySelector(selector);
let mode = 'fixture';
let state = { checks: [], publications: [] };
const labels = {
  match: 'Samsvar',
  no_match: 'Ingen kobling',
  needs_review: 'Må vurderes',
  unavailable: 'Kunne ikke kontrolleres',
};
const publicationLabels = {
  pending: 'Venter på bekreftelse',
  published: 'Publisert',
  revoking: 'Tilbaketrekking pågår',
  revoked: 'Trukket tilbake',
};
const time = (value) =>
  new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    new Date(value),
  );
const text = (selector, value) => {
  $(selector).textContent = value;
};

function selectMode(next) {
  mode = next;
  for (const name of ['fixture', 'live']) {
    $(`#${name}-panel`).hidden = name !== mode;
    $(`#${name}-tab`).classList.toggle('active', name === mode);
    $(`#${name}-tab`).setAttribute('aria-pressed', String(name === mode));
  }
  $('#notice').hidden = true;
  render();
}
function field(label, value, mono = false) {
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
  const check = checks[0];
  // A fixture restart creates new DIDs. Never present old records as current.
  const publications = state.publications.filter((p) => p.repo === state.network?.issuer.did);
  const publication = mode === 'fixture' ? publications[0] : undefined;
  text('#result-title', check?.organisation.name ?? 'Klar for første kontroll');
  text('#reason', check?.reason ?? 'Velg en situasjon og følg hva som skjer i hvert ledd.');
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
            `${time(check.checkedAt)} · ${mode === 'fixture' ? 'syntetisk registergrunnlag' : 'Brreg API'}`,
          ),
        ]
      : []),
  );
  text('#step-registry', check?.organisation.website ?? 'Hjemmeside fra Brreg');
  text(
    '#step-identity',
    check?.identity ? 'Toveis kobling bekreftet' : check ? 'Ingen bekreftet konto' : 'Handle ↔ DID',
  );
  text('#step-decision', check ? labels[check.decision] : 'Domene og profilnavn');
  text(
    '#step-publish',
    mode === 'live' ? 'Kun lesing' : publication ? publicationLabels[publication.state] : 'Ingen record ennå',
  );
  $('#record-section').hidden = !publication;
  if (publication) {
    text('#publication-status', publicationLabels[publication.state]);
    $('#publication-status').className =
      `badge ${publication.state === 'published' ? 'match' : 'needs_review'}`;
    text(
      '#publication-note',
      publication.error ??
        (publication.state === 'revoked'
          ? 'Recorden er slettet fra PDS-en. Det lokale kontrollsporet beholdes.'
          : 'Lagret på den lokale utstederkontoen. Dette gir ikke et offentlig Bluesky-merke.'),
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
  text('#history-count', `${checks.length} kjøringer`);
  const rows = checks.slice(0, 8).map((item) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const timestamp = document.createElement('span');
    timestamp.textContent = time(item.checkedAt);
    timestamp.className = 'mono muted';
    const name = document.createElement('strong');
    name.textContent = item.organisation.name;
    const source = document.createElement('span');
    source.textContent = item.candidate ?? 'Ingen hjemmeside';
    source.className = 'muted';
    const badge = document.createElement('span');
    badge.textContent = labels[item.decision];
    badge.className = `badge ${item.decision}`;
    row.append(timestamp, name, source, badge);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Kontrollhistorikken vises her.';
    rows.push(empty);
  }
  $('#history').replaceChildren(...rows);
}
async function refresh() {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Kunne ikke hente status.');
  state = await response.json();
  render();
}
async function run(path, body) {
  const buttons = document.querySelectorAll('form button');
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
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Kontrollen feilet.');
    await refresh();
    text('#notice', 'Kontrollen er ferdig. Grunnlaget og resultatet er oppdatert.');
    $('#notice').className = 'success';
  } catch (error) {
    text('#notice', error.message);
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
  run('/api/fixture/check', { scenario: $('#scenario').value });
});
$('#live-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run('/api/live/check', { orgnr: $('#orgnr').value });
});
refresh().catch((error) => {
  $('#notice').hidden = false;
  text('#notice', error.message);
});
