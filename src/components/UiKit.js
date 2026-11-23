/**
 * UiKit — gemensamma presentationshjälpare för designsystem V3
 * (src/styles/system.css). Rena funktioner som returnerar HTML-strängar;
 * ingen egen state, inga nätverksanrop. Används av arbetsordrar,
 * dashboard, mina jobb m.fl. så att samma sak alltid ser likadan ut.
 */
const UiKit = (function () {
  'use strict';

  const AV_COLORS = ['#2f6fb5', '#2a8a6e', '#8a5cc7', '#c26a2b', '#3d7f9a', '#b2476b', '#5a6f2f', '#6b5b95'];

  function _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(st) {
    if (!st) return '?';
    const a = (st.firstName || '').trim().charAt(0);
    const b = (st.lastName || '').trim().charAt(0);
    return ((a + b) || (st.name || '?').charAt(0)).toUpperCase();
  }

  function staffName(st) {
    if (!st) return '';
    return ((st.firstName || '') + ' ' + (st.lastName || '')).trim() || st.name || st.id || '';
  }

  /** Enskild avatar (initialer i färgad cirkel, stabil färg per person). */
  function avatar(st, size) {
    if (!st) return '';
    const s = size || 26;
    const col = st.color || AV_COLORS[_hash(String(st.id || staffName(st))) % AV_COLORS.length];
    const fs = Math.max(9, Math.round(s * 0.4));
    return `<span class="av" style="background:${col};width:${s}px;height:${s}px;font-size:${fs}px" title="${esc(staffName(st))}">${esc(initials(st))}</span>`;
  }

  /** Avatarstapel för en lista med personal-id:n. Tom lista → streckad ring. */
  function avatarStack(ids, max) {
    const list = (ids || []).map((id) => (typeof getStaff === 'function' ? getStaff(id) : null)).filter(Boolean);
    if (!list.length) return `<span class="av-none" title="Ingen tilldelad" aria-label="Ingen tilldelad">${typeof ic === 'function' ? ic('user', 12) : ''}</span>`;
    const m = max || 3;
    const shown = list.slice(0, m).map((st) => avatar(st)).join('');
    const more = list.length > m ? `<span class="av av-more" title="${esc(list.slice(m).map(staffName).join(', '))}">+${list.length - m}</span>` : '';
    return `<span class="av-stack" aria-label="${esc(list.map(staffName).join(', '))}">${shown}${more}</span>`;
  }

  /** Lokalt datum (YYYY-MM-DD) — inte UTC, så "idag" stämmer även efter midnatt. */
  function localDate(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }

  function _addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return localDate(new Date(y, m - 1, d + n));
  }

  const WD = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  const MO = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  /**
   * Kort, mänsklig dag: "Idag", "Imorgon", "Igår", "ons 26 nov", "3 mar 2027".
   * dateStr är YYYY-MM-DD (planerat datum i AO).
   */
  function dayLabel(dateStr, today) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return '';
    const t = today || localDate();
    const ds = dateStr.slice(0, 10);
    if (ds === t) return 'Idag';
    if (ds === _addDays(t, 1)) return 'Imorgon';
    if (ds === _addDays(t, -1)) return 'Igår';
    const [y, m, d] = ds.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const [ty, tm, td] = t.split('-').map(Number);
    const diff = Math.round((dt - new Date(ty, tm - 1, td)) / 86400000);
    if (Math.abs(diff) <= 6) return WD[dt.getDay()] + ' ' + d + ' ' + MO[m - 1];
    return d + ' ' + MO[m - 1] + (String(y) !== t.slice(0, 4) ? ' ' + y : '');
  }

  /** Snabbfilterchip. on = aktiv; n = antal (visas om satt); tone 'danger' färgar antalet. */
  function chip(label, onclick, opts) {
    const o = opts || {};
    const n = (o.n === undefined || o.n === null) ? '' : `<span class="chip-n">${o.n}</span>`;
    return `<button type="button" class="chip${o.on ? ' on' : ''}${o.tone ? ' chip-' + o.tone : ''}" aria-pressed="${o.on ? 'true' : 'false'}" onclick="${onclick}">${o.icon && typeof ic === 'function' ? ic(o.icon, 13) : ''}${esc(label)}${n}</button>`;
  }

  return { avatar, avatarStack, initials, staffName, localDate, dayLabel, chip, addDays: _addDays };
})();
