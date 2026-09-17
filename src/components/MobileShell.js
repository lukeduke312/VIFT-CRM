/**
 * MobileShell — V55A-A Mobile Shell Foundation
 *
 * Delad, mobil-endast navigationsram: fast bottennavigering (4 personliga
 * genvägar + "Mer"), en kompakt "Mer"-meny/sheet för övriga tillgängliga
 * moduler, och en ihållande "Incheckad"-status. Renderas EN gång i den
 * delade app-skalen (index.html), aldrig per sida — samma mönster som
 * `#bottom-nav`/`.topbar` redan använder (se Sidebar.js/Router.js).
 *
 * ARKITEKTURPRINCIPER (medvetet, för att inte skapa parallella system):
 *  - Genvägarna hämtas ur EXAKT samma modul-lista som redan styr
 *    desktop-sidebaren (`Sidebar.NAV_ITEMS`) och SAMMA behörighetskontroll
 *    (`Auth.canViewPage`) — ingen ny modul-/behörighetslista.
 *  - Genvägarna sparas via den REDAN BEFINTLIGA `UserPrefsService`
 *    (nyckeln `bottomNavShortcuts`) — exakt samma mönster som
 *    `sidebarCollapsed`/`sidebarPosition`/`density`, ingen ny
 *    inställningslagring.
 *  - "Incheckad"-status läser DIREKT `state.stampActive`/
 *    `state.stampTimestamp` och återanvänder `TimeService.elapsedStr()`
 *    — SAMMA sanningskälla som TimePage.js redan använder, ingen egen
 *    kopia av vare sig aktiv-flaggan eller starttidsstämpeln.
 *  - Aktivt-sida-markering drivs av `Router.currentPage` (Router.js
 *    anropar `MobileShell.onNavigate()` — se Router.js).
 */
const MobileShell = {

  /* ── Standardgenvägar (används endast om användaren inte sparat egna,
     eller om ett sparat val inte längre är giltigt/behörigt) ────────── */
  DEFAULT_SHORTCUTS: ['pg-dash', 'pg-ao', 'pg-myjobs', 'pg-tid'],

  _tickTimer: null,

  /* ── Kandidatpool — EXAKT samma moduler + behörighetskontroll som
     desktop-sidebaren, aldrig en egen lista. ───────────────────────── */
  _candidateItems() {
    return (Sidebar.NAV_ITEMS || []).filter(i => i.id && Auth.canViewPage(i.id));
  },

  /* ── Läsning/validering av sparade genvägar ───────────────────────
     §14 (behörighet): ett sparat men numera otillåtet/obefintligt
     route-id filtreras alltid bort HÄR, oavsett vad som råkar stå i
     localStorage — aldrig bara vid sparningstillfället. */
  getShortcuts() {
    const uid = state.currentUser ? state.currentUser.id : null;
    const candidates = this._candidateItems();
    const candidateIds = candidates.map(i => i.id);
    const saved = uid ? (UserPrefsService.get(uid).bottomNavShortcuts || []) : [];

    const out = [];
    saved.forEach(id => {
      if (candidateIds.includes(id) && !out.includes(id)) out.push(id);
    });
    if (out.length < 4) {
      this.DEFAULT_SHORTCUTS.forEach(id => {
        if (out.length < 4 && candidateIds.includes(id) && !out.includes(id)) out.push(id);
      });
    }
    if (out.length < 4) {
      candidateIds.forEach(id => {
        if (out.length < 4 && !out.includes(id)) out.push(id);
      });
    }
    return out.slice(0, 4);
  },

  saveShortcuts(ids) {
    const uid = state.currentUser ? state.currentUser.id : null;
    if (!uid) return { ok: false, error: 'Ingen inloggad användare' };
    const candidateIds = this._candidateItems().map(i => i.id);
    const clean = [];
    (ids || []).forEach(id => {
      if (id && candidateIds.includes(id) && !clean.includes(id)) clean.push(id);
    });
    if (clean.length !== 4) return { ok: false, error: 'Välj exakt fyra olika genvägar' };
    UserPrefsService.save(uid, { bottomNavShortcuts: clean });
    this.renderBottomNav();
    return { ok: true };
  },

  /* ── Init — anropas EN gång från App.showApp(), efter Sidebar.render() ── */
  init() {
    this.renderBottomNav();
    this.renderClockStatus();
    this._startTick();
  },

  /* ── Bottennavigering ──────────────────────────────────────────── */
  renderBottomNav() {
    const el = document.getElementById('mobile-bottom-nav');
    if (!el) return;
    const shortcuts = this.getShortcuts();
    const items = shortcuts.map(id => {
      const item = Sidebar.NAV_ITEMS.find(i => i.id === id);
      if (!item) return '';
      const isActive = Router.currentPage === id;
      const isClockedIn = id === 'pg-tid' && !!state.stampActive;
      /* R1 §6 — rent presentations-lager: `mobileLabel` (om satt på ett
         Sidebar.NAV_ITEMS-objekt) används BARA här, för själva
         bottennav-etiketten. Ingen ny navigations-/behörighetslista —
         id/icon/behörighet kommer fortsatt uteslutande från
         Sidebar.NAV_ITEMS självt. Desktop-sidebaren (Sidebar.render())
         läser fortfarande `item.label` oförändrat. */
      const label = item.mobileLabel || item.label;
      return `
        <button class="mnav-item ${isActive ? 'on' : ''}" data-page="${id}" onclick="Router.showPage('${id}')">
          <span class="mnav-ico">${ic(item.icon, 20)}${isClockedIn ? '<span class="mnav-dot"></span>' : ''}</span>
          <span class="mnav-lbl">${esc(label)}</span>
        </button>`;
    }).join('');

    const moreActive = Router.currentPage && !shortcuts.includes(Router.currentPage);
    el.innerHTML = `
      ${items}
      <button class="mnav-item ${moreActive ? 'on' : ''}" data-page="more" onclick="MobileShell.openMore()">
        <span class="mnav-ico">${ic('more-horizontal', 20)}</span>
        <span class="mnav-lbl">Mer</span>
      </button>`;
  },

  /* Anropas av Router.showPage() vid varje navigation — uppdaterar bara
     aktiv-markeringen, ingen full omrendering. */
  onNavigate(pageId) {
    const el = document.getElementById('mobile-bottom-nav');
    if (!el) return;
    const shortcuts = this.getShortcuts();
    el.querySelectorAll('.mnav-item').forEach(btn => {
      const p = btn.getAttribute('data-page');
      const isOn = p === pageId || (p === 'more' && !shortcuts.includes(pageId));
      btn.classList.toggle('on', isOn);
    });
  },

  /* ── "Mer"-meny (kompakt bottensheet) ──────────────────────────────
     Visar ÖVRIGA tillgängliga moduler (de som INTE redan är en av de
     fyra bottengenvägarna), grupperade precis som desktop-sidebarens
     befintliga sektioner — men i en liten, snabbstängd sheet, inte en
     hopklämd desktop-meny. */
  openMore() {
    const sheet = document.getElementById('mobile-more-sheet');
    if (!sheet) return;
    const shortcuts = this.getShortcuts();
    const currentPage = Router.currentPage;

    let html = '';
    let pendingSection = '';
    let sectionOpen = false;
    let sectionHasItems = false;

    (Sidebar.NAV_ITEMS || []).forEach(item => {
      if (item.section) {
        if (sectionOpen && sectionHasItems) html += '</div>';
        pendingSection = `<div class="mmore-section"><div class="mmore-section-label">${esc(item.section)}</div>`;
        sectionOpen = true;
        sectionHasItems = false;
        return;
      }
      if (!item.id || !Auth.canViewPage(item.id)) return;
      if (shortcuts.includes(item.id)) return; /* redan en bottengenväg */

      if (sectionOpen && !sectionHasItems) { html += pendingSection; sectionHasItems = true; }
      const isActive = item.id === currentPage;
      html += `
        <button class="mmore-item ${isActive ? 'on' : ''}" onclick="MobileShell.closeMore();Router.showPage('${item.id}')">
          <span class="mmore-ico">${ic(item.icon, 18)}</span>
          <span class="mmore-lbl">${esc(item.label)}</span>
          ${isActive ? ic('check', 14) : ''}
        </button>`;
    });
    if (sectionOpen && sectionHasItems) html += '</div>';

    sheet.innerHTML = `
      <div class="mmore-backdrop" onclick="MobileShell.closeMore()"></div>
      <div class="mmore-panel">
        <div class="mmore-handle"></div>
        <div class="mmore-header">
          <h3>Mer</h3>
          <button class="mmore-close" onclick="MobileShell.closeMore()" aria-label="Stäng">${ic('x', 16)}</button>
        </div>
        <div class="mmore-scroll">${html || '<p style="padding:16px;color:var(--mt);font-size:13px;">Inga fler moduler tillgängliga.</p>'}</div>
        <div class="mmore-footer">
          <button class="mmore-customize" onclick="MobileShell.closeMore();MobileShell.openShortcutEditor()">
            ${ic('settings', 16)}
            <span>Anpassa snabbgenvägar</span>
          </button>
        </div>
      </div>`;
    sheet.classList.add('open');
    document.body.classList.add('mmore-lock-scroll');
  },

  closeMore() {
    const sheet = document.getElementById('mobile-more-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    document.body.classList.remove('mmore-lock-scroll');
  },

  /* ── Genvägskonfiguration — nås från Sidebar.showSettings() ────────
     §4: exakt fyra platser, inga dubbletter, permission-filtrerad pool. */
  openShortcutEditor() {
    const uid = state.currentUser ? state.currentUser.id : null;
    if (!uid) return;
    const candidates = this._candidateItems();
    const current = this.getShortcuts();

    const optionsHtml = (selectedId) => candidates.map(i =>
      `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.label)}</option>`
    ).join('');

    Modal.open({
      title: 'Snabbval för mobilnavigering',
      body: `
        <p style="font-size:12px;color:var(--mt);margin-bottom:12px;">
          Välj vilka fyra genvägar som visas längst ner i appen på mobil. "Mer" innehåller alltid resten.
        </p>
        ${[0, 1, 2, 3].map(i => `
          <div class="fg" style="margin-bottom:10px;">
            <label>Plats ${i + 1}</label>
            <select id="mnav-slot-${i}">${optionsHtml(current[i] || '')}</select>
          </div>`).join('')}
        <div id="mnav-slot-err" style="color:var(--rd);font-size:12px;font-weight:700;display:none;margin-top:4px;"></div>
      `,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const values = [0, 1, 2, 3].map(i => document.getElementById('mnav-slot-' + i)?.value || '');
          const hasDup = new Set(values).size !== values.length;
          if (hasDup) {
            const err = document.getElementById('mnav-slot-err');
            if (err) { err.textContent = 'Varje plats måste vara en unik genväg.'; err.style.display = 'block'; }
            return;
          }
          const result = this.saveShortcuts(values);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          showToast('Snabbval sparade');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* ── Ihållande "Incheckad"-status ──────────────────────────────────
     §6: läser DIREKT state.stampActive/state.stampTimestamp — ingen
     egen kopia. Synlig på alla mobila huvudrutter (renderad i den
     delade skalen, inte per sida), döljs helt när utcheckad. */
  renderClockStatus() {
    const el = document.getElementById('mobile-clock-status');
    if (!el) return;
    const active = !!(state.stampActive && state.stampTimestamp);
    /* R1 §4 — en body-klass speglar klock-in-läget så CSS:en (utanför
       denna funktions kontroll) kan reservera TILLRÄCKLIGT med
       bottenutrymme för bottennav+klockstatus TILLSAMMANS när inklockad
       — se responsive.css. Ren presentations-synk, ingen egen
       tillståndskälla (facit är fortfarande state.stampActive). */
    document.body.classList.toggle('mobile-clock-active', active);
    if (!active) {
      el.innerHTML = '';
      el.classList.remove('show');
      this._syncBadge();
      return;
    }
    el.classList.add('show');
    /* R1 §1 — huvudytan navigerar fortsatt till Tid & stämpla; en
       SEPARAT "Klocka ut"-knapp öppnar DIREKT den redan befintliga,
       kanoniska klock-ut-dialogen (TimePage.openClockOut()) — ingen
       egen genväg som kringgår den (samma PriceGroup/kommentar/
       debiterbar-flöde, samma enda TimeService.clockOut()-anropsplats). */
    el.innerHTML = `
      <div class="mclock-bar">
        <button class="mclock-main" onclick="Router.showPage('pg-tid')">
          <span class="mclock-dot"></span>
          <span class="mclock-txt">Incheckad · <span id="mclock-elapsed">${esc(TimeService.elapsedStr(state.stampTimestamp))}</span></span>
        </button>
        <button class="mclock-out-btn" onclick="TimePage.openClockOut()">Klocka ut</button>
      </div>`;
    this._syncBadge();
  },

  /* Anropas av TimeService.clockIn()/clockOut() — se TimeService.js.
     Uppdaterar BÅDE statusfältet och Tid-genvägens badge-prick direkt,
     ingen väntan på nästa full omrendering. */
  onClockChange() {
    this.renderClockStatus();
    this.renderBottomNav();
    this._startTick();
    if (!state.stampActive) this._clear8hReminderFlag();
  },

  /* ── Live-uppdaterande förfluten tid + 8h-påminnelse (§7/§8) ──────── */
  _startTick() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
    if (!state.stampActive) return;
    this._tickTimer = setInterval(() => this._tick(), 30000);
  },

  _tick() {
    if (!state.stampActive || !state.stampTimestamp) {
      if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
      return;
    }
    const elEl = document.getElementById('mclock-elapsed');
    if (elEl) elEl.textContent = TimeService.elapsedStr(state.stampTimestamp);
    this._check8HourReminder();
  },

  /* §8 — 8-timmarspåminnelse, MEDVETET foreground-endast (se §"Kända
     begränsningar" i rapporten). En setInterval i en öppen flik/app kan
     ALDRIG garanterat köra i bakgrunden på iOS/Android när appen är
     stängd — det kräver server-driven push (samma mönster som
     `service-monitor`-Edge Function:en redan använder för andra
     dagliga bevakningar), vilket är dokumenterat som backlog, inte
     byggt här (se rapporten). Denna funktion ger ENDAST ett bästa-
     möjliga, foreground-baserat larm, EN gång per inklockning.
     R1 §2-fixen: dedup-flaggan MÅSTE överleva en sidladdning (en
     minnesvariabel nollställs annars av en ren omladdning, vilket lät
     SAMMA inklockning påminna på nytt) — den lagras därför persistent
     via den redan befintliga `Storage.setLocal()`-mekanismen (samma
     `vift_`-prefixade localStorage-arkitektur som all annan lokal
     cache redan använder), bunden till EXAKT den aktiva
     `state.stampTimestamp`. En NY inklockning ger ett NYTT
     `stampTimestamp`, så en gammal påmind flagga kan aldrig tysta en
     genuint ny inklocknings egen 8-timmarspåminnelse. */
  _REMINDER_KEY: 'stamp8hRemindedTs',

  _get8hReminderFlag() {
    try { return JSON.parse(localStorage.getItem('vift_' + this._REMINDER_KEY) || 'null'); }
    catch (e) { return null; }
  },

  _set8hReminderFlag(ts) {
    if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
      Storage.setLocal(this._REMINDER_KEY, ts);
    }
  },

  _clear8hReminderFlag() {
    try { localStorage.removeItem('vift_' + this._REMINDER_KEY); } catch (e) {}
  },

  _check8HourReminder() {
    const elapsedMin = Math.round((Date.now() - state.stampTimestamp) / 60000);
    if (elapsedMin < 480) return;
    if (this._get8hReminderFlag() === state.stampTimestamp) return;
    this._set8hReminderFlag(state.stampTimestamp);

    const msg = 'Du har varit incheckad i ca 8 timmar. Glöm inte att checka ut.';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('VIFT CRM', { body: msg, icon: '/assets/icon-192.png' }); }
      catch (e) { showToast(msg); }
    } else {
      showToast(msg);
    }
    /* R1 §3 — badgen representerar UTESLUTANDE "inklockad just nu", inte
       en räknare för 8-timmarshändelsen. Den sätts redan av
       onClockChange()/_syncBadge() vid själva inklockningen — rör den
       INTE här. */
  },

  /* ── §3 — App-/PWA-badge-livscykel ─────────────────────────────────
     Badgen betyder UTESLUTANDE "du är inklockad just nu" — den sätts
     vid inklockning och rensas ALLTID vid utcheckning ELLER om appen
     initieras utan en aktiv inklockning (t.ex. efter en utloggning-in-
     på-en-annan-enhet-scenario). Respekterar webbläsare utan stöd för
     Badging API (funktionerna finns inte alls då — inget fel kastas). */
  _syncBadge() {
    if (state.stampActive) this._setBadge(); else this._clearBadge();
  },

  _setBadge() {
    if (navigator.setAppBadge) {
      try { navigator.setAppBadge(1); } catch (e) {}
    }
  },

  _clearBadge() {
    if (navigator.clearAppBadge) {
      try { navigator.clearAppBadge(); } catch (e) {}
    }
  }
};
