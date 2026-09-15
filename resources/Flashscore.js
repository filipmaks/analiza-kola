(() => {
  const text = e => e?.textContent?.trim() || '';
  const name = e => e?.querySelector('img[alt]')?.getAttribute('alt') || text(e?.querySelector('[class*="wcl-name_"]')) || text(e);
  const numbers = e => Array.from(e?.querySelectorAll('[data-testid="wcl-tableScore"]') || []).map(n => text(n)).filter(n => /^\d+$/.test(n)).map(Number);
  const pad = n => String(n).padStart(2, '0');
  const today = new Date();
  const todayStamp = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;

  // The daily overview prints only "HH:mm" because every row on it belongs to the
  // displayed day. Anything that already carries a day is passed through untouched.
  const stamp = raw => {
    const clean = (raw || '').replace(/ /g, ' ').trim();
    return /^\d{1,2}:\d{2}$/.test(clean) ? `${todayStamp} ${clean}` : clean;
  };

  const leaguePath = href => {
    const match = (href || '').match(/\/football\/([^?#]*)/i);
    if (!match) return '';
    const segments = match[1].split('/').filter(Boolean);
    while (segments.length && /^(fixtures|results|standings|archive|news|draw)$/i.test(segments[segments.length - 1])) segments.pop();
    return segments.join('/');
  };

  // Rows are flat siblings of their league header inside .sportName, so the header
  // is the closest preceding one. Both the current and the legacy markup are accepted.
  const headerFor = e => {
    const selector = '.headerLeague__wrapper, .event__header, [data-testid="wcl-headerLeague"]';
    let node = e.previousElementSibling;
    while (node) {
      if (node.matches?.(selector)) return node;
      const nested = node.querySelector?.(selector);
      if (nested) return nested;
      node = node.previousElementSibling;
    }
    return e.closest('.sportName')?.querySelector(selector) || null;
  };

  const leagueOf = e => {
    const header = headerFor(e);
    if (!header) return {path: '', name: '', country: ''};
    const link = header.querySelector('a.headerLeague__title, a[href*="/football/"]');
    const country = text(header.querySelector('.headerLeague__meta'))
      .replace(/standings/i, '').replace(/:\s*$/, '').trim();
    return {
      path: leaguePath(link?.getAttribute('href') || link?.href || ''),
      name: link?.getAttribute('title') || text(link),
      country
    };
  };

  const row = e => {
    const isH2H = e.classList.contains('h2h__row');
    const href = isH2H ? e.href : e.querySelector('a.eventRowLink')?.href;
    const score = isH2H ? numbers(e.querySelector('.h2h__result')) : numbers(e);
    const league = isH2H ? {path: '', name: '', country: ''} : leagueOf(e);
    const stage = text(e.querySelector('.event__stage'));
    const finished = isH2H ? !!e.querySelector('.h2h__result--final') : /^finished/i.test(stage);
    return {
      url: href || '',
      home: name(e.querySelector(isH2H ? '.h2h__homeParticipant' : '.event__homeParticipant')),
      away: name(e.querySelector(isH2H ? '.h2h__awayParticipant' : '.event__awayParticipant')),
      date: stamp(text(e.querySelector('[data-testid="wcl-stageTime"]')) || (isH2H ? '' : text(e.querySelector('.event__time')))),
      competition: e.querySelector('.h2h__event')?.getAttribute('title') || '',
      leaguePath: league.path, leagueName: league.name, leagueCountry: league.country, leagueFlag: '',
      score: score.length === 2 ? score : [],
      status: finished ? 'finished' : (!isH2H && e.classList.contains('event__match--scheduled') ? 'scheduled' : 'unknown'),
      statusText: stage + ' ' + (e.querySelector('.h2h__result')?.getAttribute('title') || '')
    };
  };

  const sections = Array.from(document.querySelectorAll('.h2h__section')).map((e, index) => ({
    index, title: text(e.querySelector('[data-testid="wcl-headerSection-text"]')),
    more: !!e.querySelector('button.wclButtonLink--h2h'), rows: Array.from(e.querySelectorAll('.h2h__row')).map(row)
  }));
  const home = document.querySelector('.duelParticipant__home');
  const away = document.querySelector('.duelParticipant__away');
  const headers = Array.from(document.querySelectorAll('.wclHeaderSection--summary')).map(e => ({
    label: text(e.children[0]), score: text(e.children[1])
  }));
  const detail = home && away ? {
    url: location.href,
    home: text(home.querySelector('a.participant__participantName')),
    away: text(away.querySelector('a.participant__participantName')),
    homeURL: home.querySelector('a[href*="/team/"]')?.href || '',
    awayURL: away.querySelector('a[href*="/team/"]')?.href || '',
    date: text(document.querySelector('.duelParticipant__startTime')),
    statusText: text(document.querySelector('.detailScore__status')),
    score: Array.from(document.querySelectorAll('.detailScore__wrapper > span')).map(text).filter(t => /^\d+$/.test(t)).map(Number),
    headers
  } : null;
  const body = document.body?.innerText || '';
  return JSON.stringify({timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    fixtures: Array.from(document.querySelectorAll('.event__match')).map(row), sections, detail,
    empty: /No matches found|No matches scheduled|No matches available|No data available/i.test(body),
    h2hLinks: Array.from(document.querySelectorAll('a[href*="/h2h/"]')).map(e => ({title: text(e), url: e.href})),
    fixtureMore: !!document.querySelector('a.event__more, button.event__more')});
})();
