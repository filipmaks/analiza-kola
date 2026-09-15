// Window logic. All data comes from the main process as snapshots; this file only renders
// and forwards intents. Every piece of text from the web is escaped before it reaches the DOM.
'use strict';
(() => {
  const C = window.FPCore;
  const fp = window.fp;
  const $ = selector => document.querySelector(selector);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (value, digits) => `$${Number(value || 0).toFixed(digits)}`;

  const DESTINATIONS = [
    { id: 'daily', label: 'Dnevni izveštaj', icon: 'grid' },
    { id: 'history', label: 'Istorija', icon: 'history' },
    { id: 'settings', label: 'Podešavanja', icon: 'sliders' }
  ];
  const RESUMABLE = ['Delimičan', 'Zaustavljen', 'U toku'];

  // App state from the main process, plus view state that only this window cares about.
  let app = null;
  const ui = {
    destination: 'daily', pastReport: null, allFindings: new Set(), open: new Set(), menu: null,
    exportMessage: '', leagueSearch: '', keyDraft: '', budgetDraft: null, evidence: null, confirmDelete: null
  };

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  const tag = (text, tone = '') => `<span class="tag ${tone}">${esc(text)}</span>`;
  const stat = (value, label, iconName) => `
    <div class="panel stat"><div class="top"><span class="value">${esc(value)}</span>${icon(iconName)}</div><div class="label">${esc(label)}</div></div>`;
  const scoreText = s => s ? `${s.home}:${s.away}` : '—';
  const externalLink = (url, label = 'Otvori na Flashscore-u') =>
    url ? `<button class="icon-btn" title="${esc(label)}" data-action="external" data-url="${esc(url)}">${icon('external')}</button>` : '';

  function leagueByID(id) {
    return app.allLeagues.find(l => l.id === id) || { id, name: id, country: '', flag: '🌐' };
  }

  // ---------------------------------------------------------------------------
  // Sidebar and header
  // ---------------------------------------------------------------------------

  function renderChrome() {
    $('#nav').innerHTML = DESTINATIONS.map(d => `
      <button class="nav-item ${ui.destination === d.id ? 'active' : ''}" data-action="go" data-to="${d.id}">${icon(d.icon)}<span>${d.label}</span></button>`).join('');
    const chosen = new Set(app.preferences.leagueIDs);
    const mine = app.allLeagues.filter(l => chosen.has(l.id));
    $('#my-leagues').innerHTML = mine.length
      ? mine.map(l => {
        const scan = app.todayScans.find(s => s.league.id === l.id);
        const count = app.didScanToday ? `(${scan ? scan.upcoming : 0})` : '—';
        return `<div class="league-line" title="${esc(l.country)}"><span>${esc(l.flag)}</span><span class="name">${esc(l.name)}</span><span class="count">${count}</span></div>`;
      }).join('')
      : '<div class="league-line faint">Nijedna liga nije izabrana</div>';
    $('#title').textContent = DESTINATIONS.find(d => d.id === ui.destination).label;
    $('#status-dot').classList.toggle('busy', app.isRunning || app.isScanningToday);
    $('#status').textContent = app.isRunning ? 'Obrada u toku' : app.isScanningToday ? 'Skeniranje' : 'Spremno';
  }

  // ---------------------------------------------------------------------------
  // Daily view
  // ---------------------------------------------------------------------------

  function renderDaily() {
    const report = app.report;
    const noLeagues = app.preferences.leagueIDs.length === 0;
    const scanHasGames = app.didScanToday && app.todayScans.some(s => s.upcoming > 0);
    let html = `
      <div class="hero-head">
        <div><h1>Jasnija slika. Bolji pregled.</h1><p class="muted">Međusobni susreti, obrasci i forma za naredna 24 sata.</p></div>
        <span class="spacer"></span>
        <button class="btn primary" data-action="${app.isRunning ? 'cancel' : 'start'}" ${app.isScanningToday ? 'disabled' : ''} title="${noLeagues ? 'Izaberi bar jednu ligu u Podešavanjima' : 'Analizira naredna 24 sata'}">
          ${app.isRunning ? icon('stop') + 'Zaustavi' : icon('search') + 'Napravi mi dnevni izveštaj'}
        </button>
      </div>
      <div class="panel tight scan">
        <div class="scan-main">
          ${app.isScanningToday ? icon('refresh', 'spin') : icon('calendar')}
          <div class="stack" style="flex:1">
            <h3>Današnje lige</h3>
            <p class="muted small">${esc(app.scanSummary || 'Brzo proveri koje se lige igraju danas. Skeniranje samo dodaje lige u tvoj izbor.')}</p>
          </div>
          <button class="btn" data-action="scan" ${app.isScanningToday || app.isRunning ? 'disabled' : ''}>${app.isScanningToday ? 'Skeniram…' : 'Skeniraj danas'}</button>
        </div>
        ${scanHasGames ? `<div class="row small"><button class="link" data-action="only-today">Koristi samo današnje lige</button><span class="faint tiny">Menja tvoj izbor liga.</span></div>` : ''}
      </div>`;
    if (app.isRunning && app.reportProgress) {
      const p = app.reportProgress;
      html += `
        <div class="panel tight row">
          <span class="spinner"></span>
          <div class="stack" style="gap:5px">
            <strong>${esc(app.progress)}</strong>
            <span class="muted small">${p.completed}/${p.queued} utakmica · ${p.pages} učitavanja · obrađeni podaci se čuvaju</span>
          </div>
        </div>`;
    }
    if (report) {
      html += renderReport(report);
    } else {
      html += `
        <div class="panel hero">
          <div>
            ${tag('TVOJ DNEVNI FUDBALSKI PREGLED', 'accent')}
            <h2>Od rezultata<br>do korisnih uvida.</h2>
            <p>Pronađi obrasce u poslednjih deset međusobnih susreta. Proveri svaki zaključak i sagledaj ga uz trenutnu formu.</p>
            <div class="features"><span>${icon('swap')} H2H analiza</span><span>${icon('clock')} Lokalna istorija</span></div>
          </div>
          ${pitchArt()}
        </div>
        <div class="stats">
          ${stat('10', 'H2H susreta', 'swap')}
          ${stat(`>${Math.trunc(app.preferences.threshold)}%`, 'Početni prag', 'chart')}
          ${stat('24h', 'Predstojeći mečevi', 'clock')}
        </div>
        <p class="muted small">Klikom na dugme počinje preuzimanje sa Flashscore-a. Prvi izveštaj može trajati duže zbog prikupljanja istorije.</p>`;
    }
    return html;
  }

  function pitchArt() {
    return `<svg class="pitch" viewBox="0 0 205 255" fill="none" stroke="currentColor" aria-hidden="true">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".13"/><stop offset="1" stop-color="currentColor" stop-opacity=".03"/></linearGradient></defs>
      <rect x="0" y="0" width="205" height="255" rx="24" fill="url(#pg)" stroke="none"/>
      <g stroke-opacity=".35"><rect x="25" y="25" width="155" height="205" rx="5"/><path d="M25 127.5h155"/><circle cx="102.5" cy="127.5" r="27"/>
      <rect x="57.5" y="25" width="90" height="37"/><rect x="57.5" y="193" width="90" height="37"/></g>
      <g transform="translate(112 80)"><circle r="26" fill="var(--panel)" stroke="none"/><g transform="translate(-17 -17) scale(1.42)" stroke-width="1.5">${window.ICONS.ball}</g></g>
      <g transform="translate(26 170)"><rect width="50" height="46" rx="13" fill="var(--panel)" stroke="none" opacity=".85"/><path d="M13 32l8-9 7 5 10-12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>
    </svg>`;
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  function renderReport(report) {
    const patterns = report.matches.flatMap(m => m.findings).filter(C.strongEnough).length;
    const canResume = RESUMABLE.includes(report.state) && !app.isRunning;
    const menuOpen = ui.menu === report.id;
    let html = `
      <div class="report-head">
        <div class="stack">
          <h3>${esc(C.dateText(report.createdAt))} — ${esc(C.dateText(report.windowEnd))}</h3>
          <span class="muted small">Istorijska učestalost opisuje uzorak, a ne verovatnoću sledećeg ishoda.</span>
        </div>
        <span class="spacer"></span>
        <div class="menu">
          <button class="btn" data-action="menu" data-id="${esc(report.id)}">${icon('share')}Izvezi</button>
          ${menuOpen ? `<div class="menu-list">
            <button data-action="export" data-id="${esc(report.id)}" data-format="markdown">${icon('doc')}Markdown izveštaj</button>
            <button data-action="export" data-id="${esc(report.id)}" data-format="json">${icon('curly')}JSON podaci</button>
          </div>` : ''}
        </div>
        ${tag(report.state, report.state === 'Završen' ? 'accent' : 'orange')}
        ${canResume ? `<button class="btn" data-action="resume" data-id="${esc(report.id)}" ${app.isScanningToday ? 'disabled' : ''}>Nastavi</button>` : ''}
      </div>
      ${ui.exportMessage ? `<p class="small muted">${esc(ui.exportMessage)}</p>` : ''}
      <div class="stats">
        ${stat(String(report.matches.length), 'Obrađene utakmice', 'ball')}
        ${stat(String(patterns), 'Pronađeni obrasci', 'chart')}
        ${stat(money(report.spent, 3), `AI trošak · limit ${money(report.aiBudget, 2)}`, 'sparkles')}
      </div>
      ${report.reserved > 0 ? `<p class="muted small">Rezervisano za AI zahteve sa nepotvrđenim troškom: ${money(report.reserved, 4)}.</p>` : ''}`;

    for (const id of report.leagueIDs) {
      const league = leagueByID(id);
      const matches = report.matches.filter(m => m.fixture.leagueID === id).sort((a, b) => a.fixture.kickoff - b.fixture.kickoff);
      const emptyText = report.discoveredLeagueIDs.includes(id)
        ? (report.queue.some(m => m.leagueID === id) ? 'Utakmice još nisu obrađene.' : 'Nema zakazanih utakmica u ovom periodu.')
        : 'Raspored još nije potvrđen.';
      html += `
        <section class="league-block">
          <div class="league-head"><span class="flag">${esc(league.flag)}</span><h4>${esc(league.name)}</h4><span class="muted small">${esc(league.country)}</span>
            <span class="spacer"></span><span class="muted small">${matches.length} utakmica</span></div>
          ${matches.map(m => renderMatch(m, report.id)).join('')}
          ${matches.length ? '' : `<div class="empty">${esc(emptyText)}</div>`}
        </section>`;
    }
    if (report.notes.length) {
      const key = `notes:${report.id}`;
      html += `<details data-key="${esc(key)}" ${ui.open.has(key) ? 'open' : ''}>
        <summary>Napomene o izveštaju (${report.notes.length})</summary>
        <div class="notes">${report.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>
      </details>`;
    }
    return html;
  }

  function renderMatch(m, reportID) {
    const key = `${reportID}:${m.id}`;
    const showAll = ui.allFindings.has(key);
    const top = C.highlighted(m);
    const visible = showAll ? m.findings : top;
    const findings = visible.length
      ? visible.map(f => {
        const index = m.findings.indexOf(f);
        return `
          <button class="finding" data-action="evidence" data-report="${esc(reportID)}" data-match="${esc(m.id)}" data-index="${index}">
            <div class="stack" style="flex:1">
              <span class="title">${esc(C.ruleTitle(f.rule, m.fixture))}</span>
              <span class="sub muted small">${esc(C.PERIOD_LABEL[f.rule.period])} · ${esc(C.SAMPLE_LABEL[f.sample])}</span>
              ${C.strongEnough(f) ? '' : '<span class="warn tiny">Nedovoljan uzorak</span>'}
            </div>
            <div class="figures">
              <span class="mono"><span class="muted">${esc(C.countLabel(f))}</span>&nbsp;&nbsp;<span class="pct">${esc(C.percentLabel(f))}</span></span>
              <span class="bar"><span style="width:${Math.round(C.rate(f) * 100)}%"></span></span>
            </div>
            <span class="chev">${icon('chevron')}</span>
          </button>`;
      }).join('')
      : '<p class="muted">Nema dovoljno podataka za istaknuti obrazac.</p>';
    const first = top[0];
    const summary = m.summary
      ? `<div class="summary">${icon('sparkles')}<span>${esc(m.summary)}</span></div>`
      : first ? `<p class="local-summary">U posmatranom uzorku: ${esc(C.ruleTitle(first.rule, m.fixture).toLowerCase())}, ${esc(C.PERIOD_LABEL[first.rule.period].toLowerCase())} — ${esc(C.countLabel(first))} susreta. Detalji prikazuju svaku utakmicu iz uzorka.</p>` : '';
    const formKey = `form:${key}`;
    const forms = m.forms.map(form => `
      <div class="form">
        <h5>${esc(form.team.name)}</h5>
        <div class="mono small">${esc(form.results.join('   ')) || '—'}</div>
        <div class="faint tiny">P = pobeda · N = nerešeno · I = izgubljeno · D/G = domaćin/gost</div>
        ${form.ppg !== null ? `<div class="muted small">Bodovi po meču: ${form.ppg.toFixed(2)} · Gol-razlika: ${form.goalDifference ?? '—'}</div>` : ''}
        ${form.notes.map(n => `<div class="warn small">${esc(n)}</div>`).join('')}
        ${form.matches.map(fm => `
          <div class="form-match"><span>${esc(C.dateText(fm.kickoff, false))}</span><span class="teams">${esc(fm.home.name)} – ${esc(fm.away.name)}</span>
            <span class="mono">${esc(scoreText(fm.regular))}</span>${externalLink(fm.sourceURL)}</div>`).join('')}
      </div>`).join('');
    return `
      <article class="panel match">
        <div class="match-top">
          <div class="stack" style="flex:1"><h3>${esc(m.fixture.home.name)}&nbsp; – &nbsp;${esc(m.fixture.away.name)}</h3><span class="date muted small">${esc(C.dateText(m.fixture.kickoff))}</span></div>
          ${tag('H2H · poslednjih 10', 'accent')}
          ${externalLink(m.fixture.sourceURL)}
        </div>
        <div class="divider"></div>
        ${findings}
        ${m.findings.length ? `<button class="link small" style="margin-top:8px" data-action="toggle-all" data-key="${esc(key)}">${showAll ? 'Prikaži manje' : `Svi obrasci (${m.findings.length})`}</button>` : ''}
        ${summary}
        <details data-key="${esc(formKey)}" ${ui.open.has(formKey) ? 'open' : ''}>
          <summary>Forma i napomene</summary>
          <div class="forms">${forms}<div class="notes">${m.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div></div>
        </details>
      </article>`;
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  function renderHistory() {
    if (ui.pastReport) {
      return `<button class="link" data-action="history-back">${icon('back')} Svi izveštaji</button>${renderReport(ui.pastReport)}`;
    }
    const items = app.history.map(r => `
      <div class="panel history-item" data-action="open-report" data-id="${esc(r.id)}" role="button" tabindex="0">
        <span class="doc-icon">${icon('doc')}</span>
        <div class="stack" style="flex:1;gap:6px"><strong style="font-size:14px">${esc(C.dateText(r.createdAt))}</strong>
          <span class="muted small">${r.matchCount} utakmica · ${r.leagueCount} liga</span></div>
        ${tag(r.state, r.state === 'Završen' ? 'accent' : '')}
        ${app.isRunning && app.reportProgress?.id === r.id ? '' : `<button class="icon-btn" title="Obriši izveštaj" data-action="delete-report" data-id="${esc(r.id)}">${icon('trash')}</button>`}
        <span class="faint">${icon('chevron')}</span>
      </div>`).join('');
    return `
      <div class="stack" style="gap:8px"><h1 class="page-title">Tvoji prethodni pregledi</h1><p class="muted">Sačuvani rezultati dostupni su i bez interneta.</p></div>
      ${items || `<div class="panel row muted">${icon('clock')} Još nema sačuvanih izveštaja.</div>`}`;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  function renderSettings() {
    const p = app.preferences;
    const query = ui.leagueSearch.trim().toLocaleLowerCase('sr');
    const fold = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('sr');
    const visible = query ? app.allLeagues.filter(l => fold(l.name).includes(fold(query)) || fold(l.country).includes(fold(query))) : app.allLeagues;
    const chosen = new Set(p.leagueIDs);
    const allSelected = visible.length > 0 && visible.every(l => chosen.has(l.id));
    const noneSelected = visible.every(l => !chosen.has(l.id));
    const models = [...new Set([...app.availableModels, p.aiModel])].sort();
    const modelField = app.availableModels.length
      ? `<select id="model" data-change="model" style="width:240px">${models.map(m => `<option ${m === p.aiModel ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`
      : `<input id="model" type="text" data-change="model" value="${esc(p.aiModel)}" placeholder="${esc(C.DEFAULT_MODEL)}" style="width:240px">`;
    const budget = ui.budgetDraft ?? p.aiBudget.toFixed(2);
    return `
      <div class="stack" style="gap:8px"><h1 class="page-title">Pregled po tvojoj meri</h1><p class="muted">Jednostavna podešavanja. Više kontrole nad podacima i troškom.</p></div>

      <section class="panel settings-section">
        <div class="row"><h3>${icon('sparkles')} OpenAI obrazloženja</h3><span class="spacer"></span>${tag(app.hasKey ? 'Ključ je sačuvan' : 'Lokalni režim', 'accent')}</div>
        <p class="muted">API ključ se čuva šifrovano na ovom računaru, zaštitom tvog Windows naloga. Statistika se računa lokalno, a AI dobija samo sažete nalaze.</p>
        ${app.encryptionAvailable ? '' : '<p class="warn small">Šifrovanje ključeva trenutno nije dostupno na ovom sistemu; ključ se ne može sačuvati.</p>'}
        <div class="field-row">
          <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="${app.hasKey ? 'Unesi novi API ključ za zamenu' : 'OpenAI API ključ'}" value="${esc(ui.keyDraft)}">
          <button class="btn" data-action="save-key" ${!ui.keyDraft.trim() || app.checkingKey ? 'disabled' : ''}>${app.checkingKey ? 'Proveravam…' : 'Sačuvaj i proveri'}</button>
          ${app.hasKey ? `<button class="btn danger" data-action="remove-key" ${app.checkingKey ? 'disabled' : ''}>Ukloni</button>` : ''}
        </div>
        ${app.keyStatus ? `<p class="muted small">${esc(app.keyStatus)}</p>` : ''}
        <div class="field-row"><span>AI limit po izveštaju (USD)</span><span class="spacer"></span>
          <input id="budget" type="number" min="0" max="10" step="0.01" data-change="budget" value="${esc(budget)}" style="width:100px;text-align:right"></div>
        <div class="field-row"><span>Model</span><span class="spacer"></span>${modelField}</div>
        <p class="muted small">Budžet se računa po cenovniku 0,75 USD / milion ulaznih i 4,50 USD / milion izlaznih tokena. Po dostizanju limita koristi se lokalno obrazloženje.</p>
        <button class="link small" data-action="external" data-url="https://platform.openai.com/api-keys">Otvori OpenAI API ključeve</button>
      </section>

      <section class="panel settings-section">
        <div class="row"><h3>${icon('ball')} Lige</h3><span class="spacer"></span>${tag(`${p.leagueIDs.length} izabrano`, 'accent')}</div>
        <div class="field-row"><input id="league-search" type="search" placeholder="Pretraži po nazivu ili zemlji" value="${esc(ui.leagueSearch)}"></div>
        <div class="row">
          <button class="btn" data-action="select-visible" ${allSelected || !visible.length ? 'disabled' : ''}>Izaberi sve</button>
          <button class="btn" data-action="clear-visible" ${noneSelected || !visible.length ? 'disabled' : ''}>Poništi sve</button>
          <span class="muted small">${query ? 'Rezultati pretrage' : 'Sve lige'}</span>
        </div>
        ${p.leagueIDs.length === 0 ? '<p class="warn small">Izaberi bar jednu ligu da bi dnevni izveštaj mogao da se napravi.</p>' : ''}
        <div class="league-grid">
          ${visible.map(l => `
            <label><input type="checkbox" data-league="${esc(l.id)}" ${chosen.has(l.id) ? 'checked' : ''}>
              <span class="flag">${esc(l.flag)}</span><span class="stack"><span>${esc(l.name)}</span><span class="muted tiny">${esc(l.country)}</span></span></label>`).join('')}
          ${visible.length ? '' : '<p class="muted">Nema liga za ovu pretragu.</p>'}
        </div>
      </section>

      <section class="panel settings-section">
        <h3>${icon('sliders')} Analiza i izgled</h3>
        <div class="row"><span>Prikaži učestalost veću od</span><span class="spacer"></span><span class="threshold" id="threshold-value">${Math.trunc(p.threshold)}%</span></div>
        <input id="threshold" type="range" min="0" max="99" step="1" value="${Math.trunc(p.threshold)}">
        <p class="muted small">Za istaknuti zaključak potrebno je najmanje pet validnih susreta. Promena praga važi za nove izveštaje.</p>
        <div class="divider" style="margin:4px 0"></div>
        <div class="row"><span>Tema</span><span class="spacer"></span>
          <div class="segmented">${[['system', 'Prati sistem'], ['light', 'Svetla'], ['dark', 'Tamna']].map(([v, label]) =>
            `<button class="${p.theme === v ? 'on' : ''}" data-action="theme" data-theme="${v}">${label}</button>`).join('')}</div>
        </div>
      </section>

      <section class="panel settings-section">
        <h3>${icon('info')} O podacima</h3>
        <p class="muted small" style="line-height:1.6">Izvor je Flashscore. Preuzimanje se pokreće samo na tvoj zahtev, sekvencijalno i uz keširanje. Pri blokadi se zaustavlja. Flashscore ograničava automatizovano preuzimanje bez saglasnosti; mala učestalost ne garantuje dozvolu ili odsustvo blokade.</p>
        <button class="link small" data-action="external" data-url="https://www.flashscore.com/terms-of-use/">Flashscore uslovi korišćenja</button>
        <p class="faint tiny">Verzija ${esc(app.version || '')} · Podaci: %APPDATA%\\Fudbalski pregled</p>
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  let overlayKey = '';
  function renderOverlay() {
    const overlay = $('#overlay');
    const key = app.pendingNewLeagues.length ? `leagues:${app.pendingNewLeagues.map(l => l.id).join(',')}`
      : ui.confirmDelete ? `delete:${ui.confirmDelete}`
      : ui.evidence ? `evidence:${ui.evidence.finding.id}` : '';
    if (key === overlayKey) return;
    overlayKey = key;
    if (app.pendingNewLeagues.length) {
      overlay.hidden = false;
      overlay.innerHTML = `
        <div class="dialog small" role="dialog" aria-modal="true">
          <div class="dialog-head"><h2>Nove lige pronađene</h2></div>
          <div class="dialog-body">
            ${app.pendingNewLeagues.map(l => `<div class="row"><span>${esc(l.flag)}</span><strong>${esc(l.name)}</strong><span class="muted small">${esc(l.country)}</span></div>`).join('')}
            <p class="muted">Dodati ih u listu liga i uključiti u današnju analizu?</p>
          </div>
          <div class="dialog-foot"><button class="btn" data-action="reject-leagues">Ne sada</button><button class="btn primary" data-action="accept-leagues">Dodaj i koristi</button></div>
        </div>`;
      return;
    }
    if (ui.confirmDelete) {
      overlay.hidden = false;
      overlay.innerHTML = `
        <div class="dialog small" role="dialog" aria-modal="true">
          <div class="dialog-head"><h2>Obrisati izveštaj?</h2></div>
          <div class="dialog-body"><p class="muted">Izveštaj će biti trajno uklonjen sa ovog računara. Keširani rezultati ostaju.</p></div>
          <div class="dialog-foot"><button class="btn" data-action="close-overlay">Otkaži</button><button class="btn primary" data-action="confirm-delete">Obriši</button></div>
        </div>`;
      return;
    }
    if (ui.evidence) {
      const { finding: f, fixture } = ui.evidence;
      const kickoffs = f.matches.map(m => m.kickoff);
      overlay.hidden = false;
      overlay.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="dialog-head"><h2>Iza ovog zaključka</h2><button class="btn" data-action="close-overlay">Zatvori</button></div>
          <div class="dialog-body">
            <h3 style="font-size:17px">${esc(C.ruleTitle(f.rule, fixture))}</h3>
            <div class="row">${tag(`${C.countLabel(f)} · ${C.percentLabel(f)}`, 'accent')}${tag(C.SAMPLE_LABEL[f.sample])}${tag(C.PERIOD_LABEL[f.rule.period])}</div>
            ${kickoffs.length ? `<p class="muted small">Period: ${esc(C.dateText(Math.min(...kickoffs), false))} – ${esc(C.dateText(Math.max(...kickoffs), false))}</p>` : ''}
            ${C.containsOldMatches(f, Date.now()) ? `<p class="warn small">${icon('clock')} Uzorak uključuje susrete starije od pet godina.</p>` : ''}
            <p class="muted small">Validni podaci: ${f.matches.length} od ${f.sampleCount} izabranih susreta. Nedostajući rezultati ne računaju se kao nula.</p>
            <div>
              ${f.matches.map(m => {
                const hit = f.hitIDs.includes(m.id);
                return `<div class="evidence-row">
                  <span class="${hit ? 'hit' : 'miss'}">${icon(hit ? 'check' : 'minus')}</span>
                  <div class="stack" style="flex:1;gap:4px"><strong>${esc(m.home.name)} – ${esc(m.away.name)}</strong><span class="muted small">${esc(C.dateText(m.kickoff, false))} · ${esc(m.competition)}</span></div>
                  <div class="stack" style="align-items:flex-end;gap:4px"><span class="score mono">${esc(scoreText(C.score(m, f.rule.period)).replace(':', ' : '))}</span>
                    <span class="muted tiny">90′: ${esc(scoreText(m.regular))} · 1P: ${esc(scoreText(m.firstHalf))}</span></div>
                  ${externalLink(m.sourceURL)}
                </div>`;
              }).join('')}
            </div>
            <p class="muted small">Ovo je istorijska učestalost u prikazanom uzorku, bez garancije budućeg ishoda.</p>
          </div>
        </div>`;
      return;
    }
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  function render() {
    if (!app) return;
    // Keep the caret where it was: the settings view re-renders while the user types.
    const active = document.activeElement;
    const focus = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;

    renderChrome();
    let body = '';
    if (app.errorMessage) {
      body += `<div class="error" role="alert"><span class="warn">${icon('warning')}</span><p>${esc(app.errorMessage)}</p><button class="icon-btn" title="Zatvori" data-action="dismiss-error">${icon('close')}</button></div>`;
    }
    if (ui.destination === 'daily') body += renderDaily();
    else if (ui.destination === 'history') body += renderHistory();
    else body += renderSettings();
    $('#content').innerHTML = body;
    renderOverlay();

    if (focus) {
      const el = document.getElementById(focus.id);
      if (el) {
        el.focus();
        try { if (focus.start !== null && focus.start !== undefined) el.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ }
      }
    }
  }

  function applyState(next) {
    const reportChanged = next.report !== undefined;
    const previousReport = app?.report ?? null;
    app = Object.assign({}, app, next);
    if (!reportChanged) app.report = previousReport;
    // A report opened from history follows live updates when it is the one being processed.
    if (reportChanged && ui.pastReport && app.report && ui.pastReport.id === app.report.id) ui.pastReport = app.report;
    if (ui.pastReport && !app.history.some(h => h.id === ui.pastReport.id)) ui.pastReport = null;
    render();
  }

  // ---------------------------------------------------------------------------
  // Intents
  // ---------------------------------------------------------------------------

  async function findReport(id) {
    if (app.report?.id === id) return app.report;
    if (ui.pastReport?.id === id) return ui.pastReport;
    return fp.getReport(id);
  }

  const actions = {
    go: el => { ui.destination = el.dataset.to; ui.pastReport = null; ui.menu = null; render(); $('#scroll').scrollTop = 0; },
    start: () => fp.start(),
    cancel: () => fp.cancel(),
    scan: () => fp.scanToday(),
    'only-today': () => fp.useOnlyTodayLeagues(),
    'dismiss-error': () => fp.dismissError(),
    resume: el => { ui.destination = 'daily'; ui.pastReport = null; fp.resume(el.dataset.id); },
    menu: el => { ui.menu = ui.menu === el.dataset.id ? null : el.dataset.id; render(); },
    export: async el => {
      ui.menu = null; render();
      const result = await fp.export(el.dataset.id, el.dataset.format);
      ui.exportMessage = result?.message || '';
      render();
    },
    'toggle-all': el => { const k = el.dataset.key; ui.allFindings.has(k) ? ui.allFindings.delete(k) : ui.allFindings.add(k); render(); },
    evidence: async el => {
      const report = await findReport(el.dataset.report);
      const match = report?.matches.find(m => m.id === el.dataset.match);
      const finding = match?.findings[Number(el.dataset.index)];
      if (!finding) return;
      ui.evidence = { finding, fixture: match.fixture };
      renderOverlay();
    },
    'close-overlay': () => { ui.evidence = null; ui.confirmDelete = null; renderOverlay(); },
    'open-report': async el => {
      const report = await fp.getReport(el.dataset.id);
      if (!report) return;
      ui.pastReport = report; render(); $('#scroll').scrollTop = 0;
    },
    'history-back': () => { ui.pastReport = null; render(); },
    'delete-report': el => { ui.confirmDelete = el.dataset.id; renderOverlay(); },
    'confirm-delete': async () => { const id = ui.confirmDelete; ui.confirmDelete = null; renderOverlay(); await fp.deleteReport(id); },
    'accept-leagues': () => fp.acceptNewLeagues(),
    'reject-leagues': () => fp.rejectNewLeagues(),
    external: el => fp.openExternal(el.dataset.url),
    'save-key': () => { const value = ui.keyDraft; ui.keyDraft = ''; fp.saveKey(value); },
    'remove-key': () => { ui.keyDraft = ''; fp.saveKey(''); },
    'select-visible': () => {
      const ids = new Set(app.preferences.leagueIDs);
      for (const box of document.querySelectorAll('input[data-league]')) ids.add(box.dataset.league);
      fp.savePreferences({ leagueIDs: [...ids] });
    },
    'clear-visible': () => {
      const visible = new Set([...document.querySelectorAll('input[data-league]')].map(b => b.dataset.league));
      fp.savePreferences({ leagueIDs: app.preferences.leagueIDs.filter(id => !visible.has(id)) });
    },
    theme: el => fp.savePreferences({ theme: el.dataset.theme })
  };

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) {
      if (ui.menu && !event.target.closest('.menu')) { ui.menu = null; render(); }
      if (event.target.id === 'overlay' && !app.pendingNewLeagues.length) actions['close-overlay']();
      return;
    }
    // A button nested in a clickable row acts on its own.
    event.stopPropagation();
    const action = actions[target.dataset.action];
    if (action) action(target);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (ui.menu) { ui.menu = null; render(); }
      else if (ui.evidence || ui.confirmDelete) actions['close-overlay']();
    }
    if (event.key === 'Enter') {
      const el = event.target;
      if (el.id === 'key' && ui.keyDraft.trim()) actions['save-key']();
      else if (el.matches?.('[data-action="open-report"]')) actions['open-report'](el);
      else if (el.dataset?.change) commitField(el);
    }
  });

  document.addEventListener('input', event => {
    const el = event.target;
    if (el.id === 'key') {
      ui.keyDraft = el.value;
      const button = document.querySelector('[data-action="save-key"]');
      if (button) button.disabled = !ui.keyDraft.trim() || app.checkingKey;
    } else if (el.id === 'league-search') {
      ui.leagueSearch = el.value; render();
    } else if (el.id === 'budget') {
      ui.budgetDraft = el.value;
    } else if (el.id === 'threshold') {
      $('#threshold-value').textContent = `${el.value}%`;
    }
  });

  function commitField(el) {
    if (el.dataset.change === 'budget') {
      const value = parseFloat(String(el.value).replace(',', '.'));
      ui.budgetDraft = null;
      if (Number.isFinite(value)) fp.savePreferences({ aiBudget: value }); else render();
    } else if (el.dataset.change === 'model') {
      if (el.value.trim()) fp.selectModel(el.value.trim()); else render();
    }
  }

  document.addEventListener('change', event => {
    const el = event.target;
    if (el.dataset.league) {
      const ids = new Set(app.preferences.leagueIDs);
      el.checked ? ids.add(el.dataset.league) : ids.delete(el.dataset.league);
      fp.savePreferences({ leagueIDs: [...ids] });
    } else if (el.id === 'threshold') {
      fp.savePreferences({ threshold: Number(el.value) });
    } else if (el.dataset.change) {
      commitField(el);
    }
  });

  // <details> does not bubble "toggle"; capture it so open sections survive re-rendering.
  document.addEventListener('toggle', event => {
    const key = event.target.dataset?.key;
    if (!key) return;
    event.target.open ? ui.open.add(key) : ui.open.delete(key);
  }, true);

  for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

  fp.onState(applyState);
  fp.ready().then(applyState);
})();
