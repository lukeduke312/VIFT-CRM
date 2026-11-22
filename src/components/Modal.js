/**
 * Modal — enda modalsystem, inga dubbletter
 */

const Modal = {
  _stack: [],

  open(opts) {
    const id = 'modal-' + Date.now();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = id;

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet' + (opts.wide ? ' modal-wide' : '');

    const handle = document.createElement('div');
    handle.className = 'modal-handle';
    sheet.appendChild(handle);

    if (opts.title) {
      const title = document.createElement('div');
      title.className = 'modal-title';
      title.innerHTML = opts.title;
      sheet.appendChild(title);
    }

    // Scrollable body
    const bodyWrapper = document.createElement('div');
    bodyWrapper.className = 'modal-body';
    const bodyContent = document.createElement('div');
    bodyContent.innerHTML = opts.body || '';
    bodyWrapper.appendChild(bodyContent);
    sheet.appendChild(bodyWrapper);

    // Sticky footer
    if (opts.buttons && opts.buttons.length > 0) {
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      opts.buttons.forEach(btn => {
        const b = document.createElement('button');
        b.className = btn.cls || 'btn bs';
        b.innerHTML = btn.label;
        b.onclick = btn.onClick;
        footer.appendChild(b);
      });
      sheet.appendChild(footer);
    }

    overlay.appendChild(sheet);
    document.getElementById('modal-root').appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('open'));

    overlay.addEventListener('click', e => {
      if (e.target === overlay) Modal.close();
    });

    this._stack.push(id);
    document.body.classList.add('modal-open');
    return id;
  },

  close() {
    const id = this._stack.pop();
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('open');
      setTimeout(() => el.remove(), 250);
    }
    if (this._stack.length === 0) {
      document.body.classList.remove('modal-open');
    }
  },

  closeAll() {
    while (this._stack.length > 0) this.close();
  },

  confirm(message, onConfirm, onCancel) {
    Modal.open({
      title: 'Bekräfta',
      body: `<p style="font-size:14px;line-height:1.5;color:var(--tx);">${message}</p>`,
      buttons: [
        {
          label: 'Bekräfta', cls: 'btn bp', onClick: () => {
            Modal.close();
            if (onConfirm) onConfirm();
          }
        },
        {
          label: 'Avbryt', cls: 'btn bs', onClick: () => {
            Modal.close();
            if (onCancel) onCancel();
          }
        }
      ]
    });
  }
};

/* AO-050-fixen: längre, flerradiga faktameddelanden (se BillingQueueService/
   InvoiceService) behöver mer lästid än det ursprungliga 2.5s-standardvärdet
   — annars hinner en användare inte läsa klart innan den försvinner. Ingen
   explicit `duration`-anropare påverkas (deras värde används alltid
   oförändrat); bara det implicita standardvärdet skalas med meddelandets
   längd. */
function showToast(msg, duration) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (duration === undefined) {
    duration = msg && msg.length > 60 ? 5000 : 2500;
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

/* N1 (blocker round 2026-11-12): persistent "osparad ändring" banner.
   Shown for every journaled edit the user was told had failed and that
   did not reach the server (state.js settlePersistFailure() ->
   'not-landed'/'unknown'). It stays until the user picks, per item,
   "Återuppta" (resumeHeldPersist: re-checks the server three-way, then
   resends; a third value goes to the conflict dialog) or "Kasta"
   (discardHeldPersist). Not a toast and not an overlay modal: it does
   not close on its own, by clicking beside it, or on navigation, and it
   does not cover an open form. Text is set with textContent only. */
const PersistRecoveryBanner = {
  _busy: {},
  render(items) {
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return;
    let el = document.getElementById('vf-unsaved-banner');
    if (!items || !items.length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'vf-unsaved-banner';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:36px;z-index:2000;max-width:min(680px,calc(100vw - 16px));width:100%;box-sizing:border-box;background:#fff7ed;color:#7c2d12;border:1px solid #fdba74;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);padding:10px 12px;font-size:13px;line-height:1.4;';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:600;margin-bottom:6px;';
    head.textContent = items.length === 1
      ? 'En ändring kunde inte sparas och ligger kvar osparad.'
      : items.length + ' ändringar kunde inte sparas och ligger kvar osparade.';
    el.appendChild(head);
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-bottom:6px;';
    sub.textContent = 'Servern har inte fått dem. Välj för varje: Återuppta (skicka igen) eller Kasta (glöm ändringen).';
    el.appendChild(sub);
    items.forEach(it => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 0;border-top:1px solid #fed7aa;';
      const txt = document.createElement('span');
      txt.style.cssText = 'flex:1 1 220px;min-width:0;overflow-wrap:anywhere;';
      txt.textContent = (it.isCreate ? 'Ny: ' : it.op === 'delete' ? 'Borttagning: ' : 'Ändring: ') + it.label;
      row.appendChild(txt);
      const k = it.key + '|' + it.id;
      const mk = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = cls; b.textContent = label;
        b.disabled = !!this._busy[k];
        b.addEventListener('click', async () => {
          if (this._busy[k]) return;
          this._busy[k] = true; b.disabled = true;
          try { await fn(); } finally { delete this._busy[k]; }
          try { if (typeof _vfRefreshHeldBanner === 'function') _vfRefreshHeldBanner(); } catch (e) {}
        });
        return b;
      };
      row.appendChild(mk('Återuppta', 'btn bxs bp', () => resumeHeldPersist(it.key, it.id)));
      row.appendChild(mk('Kasta', 'btn bxs bs', () => {
        if (typeof confirm === 'function' && !confirm('Kasta den osparade ändringen (' + it.label + ')? Den kan inte återställas.')) return;
        discardHeldPersist(it.key, it.id);
      }));
      el.appendChild(row);
    });
  }
};
