/**
 * CustomerPicker — återanvändbar, business-logic-fri sökbar kundväljare.
 *
 * V49A2A: bygger på samma DOM/CSS-kontrakt som src/components/CustomSelect.js
 * (dold nativ <select> + wrap/trigger/dropdown), ÅTERANVÄNDER dess publika
 * CSS-klasser (cswrap/cstrig/cslbl/csdd/css-srch/csolist/cso/csoa) och dess
 * publika CustomSelect._close(), MEN duplicerar INTE dess privata
 * _tog/_srch/_pick — de bygger på statiska, förrenderade <div class="cso">
 * med endast label-text att filtrera på, vilket inte räcker för sökning
 * över flera kundfält (adress, kontaktperson, org.nr, telefon, e-post).
 * CustomSelect.js självt är HELT ORÖRT av detta — se RAPPORT-V49A2A.md §2.
 *
 * Kontrakt (samma som CustomSelect, se dess header-kommentar):
 *   CustomerPicker.render(id, { value, placeholder, onchange })
 *   → HTML-sträng med en dold <select id="${id}"> vars .value är customerId.
 *   Befintlig kod som läser document.getElementById(id).value, eller sätter
 *   ett onchange-attribut på den, fortsätter fungera oförändrat.
 *
 *   CustomerPicker.refresh(id, opts) — ren omrendering (ingen manuell
 *   DOM-splicing) efter t.ex. att en ny kund skapats, se §9 i RAPPORT.
 *
 * CustomerPicker äger INGEN affärslogik: ingen fastighet/objekt/kontakt/
 * adress-ifyllnad, ingen wizard-state, ingen arbetsorder-skapelse. Den
 * returnerar bara ett vald customerId via samma change-event-mekanik som
 * en riktig <select> — callern (t.ex. WorkOrdersPage) äger allt annat.
 */
const CustomerPicker = {

  _NO_QUERY_LIMIT: 30,
  _QUERY_LIMIT: 50,

  /* ── Sök-normalisering (V49A1 §4-mönster: liten intern normalizer,
     inget externt beroende) ──────────────────────────────────────── */

  _normText(s) {
    return (s === null || s === undefined ? '' : String(s)).toLowerCase().trim().replace(/\s+/g, ' ');
  },

  /* Endast siffror kvar — gör org.nr/personnr/telefon-sökning tolerant mot
     bindestreck, mellanslag och andra vanliga skiljetecken i båda led
     (query OCH lagrat värde), t.ex. sökning "556821" hittar "556821-0750"
     och "031123456" hittar "031-123 456". */
  _normDigits(s) {
    return (s === null || s === undefined ? '' : String(s)).replace(/[^0-9]/g, '');
  },

  /* V49A2A R2: numeric-fält (org.nr/personnr/telefon) får ENDAST jämföras
     när queryn faktiskt SER UT som ett nummer — annars ger en adress-
     sökning som "Norra Hamngatan 4" falska träffar på varenda kund vars
     telefon/org.nr råkar innehålla siffran 4 (se RAPPORT-V49A2A-R2.md §1).
     True endast om queryn (trimmad) uteslutande består av siffror,
     whitespace, +, -, parenteser och punkt, OCH innehåller minst en
     siffra — en bokstav var som helst i queryn gör den till en textquery. */
  _isNumericQuery(query) {
    const s = (query === null || query === undefined ? '' : String(query)).trim();
    if (!s || !/[0-9]/.test(s)) return false;
    return /^[0-9+\-() .]+$/.test(s);
  },

  _matches(cu, qText, qDigits) {
    if (!qText && !qDigits) return true;
    const contacts = Array.isArray(cu.contacts) ? cu.contacts : [];
    if (qText) {
      const textFields = [
        (typeof CustomerService !== 'undefined' ? CustomerService.displayName(cu) : ''),
        cu.name, cu.firstName, cu.lastName, cu.contactPerson,
        cu.address, cu.zip, cu.city, cu.email
      ];
      contacts.forEach(ct => { textFields.push(ct && ct.name); textFields.push(ct && ct.email); });
      if (textFields.some(f => this._normText(f).includes(qText))) return true;
    }
    if (qDigits) {
      const numFields = [cu.orgNr, cu.personnr, cu.phone];
      contacts.forEach(ct => numFields.push(ct && ct.phone));
      if (numFields.some(f => this._normDigits(f).includes(qDigits))) return true;
    }
    return false;
  },

  /* Sekundärrad: adress/ort · kontaktperson. Saknas adress: annan
     relevant identifierare (org.nr/personnr/telefon/e-post). Saknas
     kontaktperson: bara adress/ort. Se RAPPORT-V49A2A.md §5. */
  _subLine(cu) {
    const addrBits = [cu.address, cu.city].filter(Boolean).join(', ');
    const bits = [];
    if (addrBits) bits.push(addrBits);
    if (cu.contactPerson) bits.push(cu.contactPerson);
    if (bits.length) return bits.join(' · ');
    if (cu.orgNr) return 'Org.nr ' + cu.orgNr;
    if (cu.personnr) return 'Personnr ' + cu.personnr;
    if (cu.phone) return cu.phone;
    if (cu.email) return cu.email;
    return '';
  },

  _customers() {
    return (typeof state !== 'undefined' && state.customers) ? state.customers : [];
  },

  _rowHtml(id, cu) {
    const name = (typeof CustomerService !== 'undefined') ? CustomerService.displayName(cu) : (cu.name || '—');
    const sub  = this._subLine(cu);
    /* Ingen match-highlight (V49A2A §6): highlight skulle kräva att dela
       upp den redan escapade strängen kring en osäker index-träff, vilket
       riskerar XSS om det görs fel. Säkerhet före polish — all kunddata
       går genom esc() rakt av. */
    return `<div class="cso cpo" data-id="${esc(cu.id)}" onclick="CustomerPicker._pick('${id}','${esc(cu.id)}')">
      <div class="cpo-name">${esc(name)}</div>
      ${sub ? `<div class="cpo-sub">${esc(sub)}</div>` : ''}
    </div>`;
  },

  _rowsHtml(id, query) {
    const list = this._customers();
    const qText = this._normText(query);
    const qDigits = this._isNumericQuery(query) ? this._normDigits(query) : '';
    const hasQuery = !!(qText || qDigits);
    const nameOf = cu => (typeof CustomerService !== 'undefined') ? CustomerService.displayName(cu) : (cu.name || '');
    let filtered = list.filter(cu => this._matches(cu, qText, qDigits));
    filtered = filtered.slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'sv'));
    filtered = filtered.slice(0, hasQuery ? this._QUERY_LIMIT : this._NO_QUERY_LIMIT);
    if (!filtered.length) {
      return `<div class="cpo-empty">Ingen kund hittades</div>`;
    }
    return filtered.map(cu => this._rowHtml(id, cu)).join('');
  },

  /* ── Publikt API ──────────────────────────────────────────────── */

  render(id, { value = '', placeholder = 'Välj kund...', onchange = '' } = {}) {
    const list = this._customers();
    const nameOf = cu => (typeof CustomerService !== 'undefined') ? CustomerService.displayName(cu) : (cu.name || '');
    const selOpts = list.map(c =>
      `<option value="${esc(c.id)}"${c.id === value ? ' selected' : ''}>${esc(nameOf(c))}</option>`
    ).join('');
    const selectedCu = value ? list.find(c => c.id === value) : null;
    const selectedLabel = selectedCu ? nameOf(selectedCu) : '';
    const initialRows = this._rowsHtml(id, '');

    return `<div id="cpouter-${id}">
      <select id="${id}" style="display:none;"${onchange ? ` onchange="${onchange}"` : ''}>
        <option value="">${esc(placeholder)}</option>${selOpts}
      </select>
      <div class="cswrap" id="cpui-${id}">
        <div class="cstrig" id="cptrig-${id}" data-placeholder="${esc(placeholder)}" tabindex="0"
             onclick="CustomerPicker._tog('${id}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();CustomerPicker._tog('${id}');}else if(event.key==='Escape'){CustomSelect._close();}">
          ${this._trigInnerHtml(id, selectedLabel, placeholder)}
        </div>
        <div class="csdd" id="cpdd-${id}" style="display:none;">
          <input type="text" class="css-srch" placeholder="Sök kund, adress, kontaktperson…"
                 oninput="CustomerPicker._srch('${id}', this.value)"
                 onkeydown="CustomerPicker._keydd(event,'${id}')"
                 onclick="event.stopPropagation()">
          <div class="csolist" id="cplist-${id}">${initialRows}</div>
        </div>
      </div>
    </div>`;
  },

  /* Triggerns innehåll (label + ev. rensa-knapp + chevron). Bruten ut ur
     render() så _pick()/_clear() kan uppdatera BÅDE label OCH om
     rensa-knappen ska visas, utan att bygga om hela widgeten. Se
     RAPPORT-V49A2A-R1.md §2/§5. */
  _trigInnerHtml(id, label, placeholder) {
    const hasValue = !!label;
    /* V49A2A R3: click-nivåns stopPropagation räcker inte för tangentbord —
       ett Enter/Space med fokus på .cpclr genererar ett KEYDOWN som annars
       bubblar upp till förälderns .cstrig-onkeydown INNAN webbläsaren hinner
       generera click-eventet från knappaktiveringen, vilket öppnar/stänger
       dropdownen istället för att rensa. onkeydown="event.stopPropagation()"
       stoppar bubblingen utan att göra preventDefault — nativ knapp-
       aktivering (Enter/Space → click) fortsätter fungera normalt, och det
       riktiga click-eventet går sedan genom befintlig _clear() → _pick(id,'')
       precis som vid musklick. Se RAPPORT-V49A2A-R3.md §1/§2. */
    const clearBtn = hasValue
      ? `<button type="button" class="cpclr" title="Rensa vald kund" aria-label="Rensa vald kund"
           onkeydown="event.stopPropagation()"
           onclick="event.stopPropagation();CustomerPicker._clear('${id}')">${typeof ic === 'function' ? ic('x', 13) : '×'}</button>`
      : '';
    return `<span class="cslbl" style="color:${hasValue ? 'var(--tx)' : 'var(--mt)'};">${esc(label || placeholder)}</span>
      ${clearBtn}
      ${typeof ic === 'function' ? ic('chevron-down', 13) : ''}`;
  },

  /* Ren omrendering av HELA widgeten (select + UI) mot aktuell
     state.customers — ersätter manuell createElement('option')-splicing
     efter t.ex. "+ Ny kund". Callern anropar sin egen change-handler
     (t.ex. WorkOrdersPage._wizCustomerChanged()) EFTER refresh() —
     samma mönster som den tidigare koden redan använde. Se RAPPORT §9. */
  refresh(id, opts) {
    const outer = document.getElementById('cpouter-' + id);
    if (!outer) return;
    outer.outerHTML = this.render(id, opts);
  },

  _tog(id) {
    const ddId = 'cpdd-' + id;
    const uiId = 'cpui-' + id;
    const dd = document.getElementById(ddId);
    if (!dd) return;
    const opening = dd.style.display === 'none';
    CustomSelect._close();
    if (opening) {
      dd.style.display = 'block';
      const wrap = document.getElementById(uiId);
      if (wrap) wrap.classList.add('csopen');
      const list = document.getElementById('cplist-' + id);
      const srch = dd.querySelector('.css-srch');
      if (list) list.innerHTML = this._rowsHtml(id, '');
      if (srch) setTimeout(() => { srch.value = ''; srch.focus(); }, 0);
    }
  },

  _srch(id, term) {
    const list = document.getElementById('cplist-' + id);
    if (!list) return;
    list.innerHTML = this._rowsHtml(id, term);
  },

  /* customerId === '' rensar valet (samma kontrakt som ett vanligt val,
     se RAPPORT-V49A2A-R1.md §2/§3): sätter hidden select till '', skickar
     EXAKT ett change-event (triggar WorkOrdersPage._wizCustomerChanged()
     precis som ett riktigt kundval), och återställer triggerns
     label/rensa-knapp till tomt-läge. CustomerPicker rensar INGEN
     AO-specifik data själv — det är helt och hållet callerns ansvar,
     precis som vid ett vanligt kundbyte. */
  _pick(id, customerId) {
    const sel = document.getElementById(id);
    if (sel) {
      sel.value = customerId;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const trig = document.getElementById('cptrig-' + id);
    if (trig) {
      const cu = (customerId && typeof getCu === 'function') ? getCu(customerId) : null;
      const label = cu && typeof CustomerService !== 'undefined' ? CustomerService.displayName(cu) : '';
      const placeholder = (trig.dataset && trig.dataset.placeholder) || 'Välj kund...';
      trig.innerHTML = this._trigInnerHtml(id, label, placeholder);
    }
    CustomSelect._close();
  },

  /* Rensa-knappen i triggern anropar detta. Ren tunn wrapper runt _pick —
     ingen duplicerad select/change-logik, se RAPPORT-V49A2A-R1.md §3. */
  _clear(id) {
    this._pick(id, '');
  },

  _keydd(event, id) {
    const list = document.getElementById('cplist-' + id);
    if (!list) return;
    const rows = Array.prototype.slice.call(list.querySelectorAll('.cpo'));
    if (event.key === 'Escape') { event.preventDefault(); CustomSelect._close(); return; }
    if (!rows.length) return;
    let idx = rows.findIndex(r => r.classList.contains('cpo-active'));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      idx = (idx + 1) % rows.length;
      rows.forEach(r => r.classList.remove('cpo-active'));
      rows[idx].classList.add('cpo-active');
      if (rows[idx].scrollIntoView) rows[idx].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      idx = idx <= 0 ? rows.length - 1 : idx - 1;
      rows.forEach(r => r.classList.remove('cpo-active'));
      rows[idx].classList.add('cpo-active');
      if (rows[idx].scrollIntoView) rows[idx].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = idx >= 0 ? rows[idx] : rows[0];
      if (target && target.click) target.click();
    }
  }
};
