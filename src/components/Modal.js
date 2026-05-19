/**
 * Modal — enda modalsystem, inga dubbletter
 */

const Modal = {
  _stack: [],

  /**
   * Öppna en modal
   * opts: { title, body, buttons, wide }
   */
  open(opts) {
    const id = 'modal-' + Date.now();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = id;

    const sheet = document.createElement('div');
    sheet.className = 'modal-sheet' + (opts.wide ? ' modal-wide' : '');

    const handle = document.createElement('div');
    handle.className = 'modal-handle';

    const content = document.createElement('div');

    if (opts.title) {
      const title = document.createElement('div');
      title.className = 'modal-title';
      title.textContent = opts.title;
      content.appendChild(title);
    }

    const body = document.createElement('div');
    body.innerHTML = opts.body || '';
    content.appendChild(body);

    if (opts.buttons && opts.buttons.length > 0) {
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      opts.buttons.forEach(btn => {
        const b = document.createElement('button');
        b.className = btn.cls || 'btn bs';
        b.textContent = btn.label;
        b.onclick = btn.onClick;
        footer.appendChild(b);
      });
      content.appendChild(footer);
    }

    sheet.appendChild(handle);
    sheet.appendChild(content);
    overlay.appendChild(sheet);
    document.getElementById('modal-root').appendChild(overlay);

    // Öppna med liten delay för animation
    requestAnimationFrame(() => {
      overlay.classList.add('open');
    });

    // Stäng vid klick på overlay
    overlay.addEventListener('click', e => {
      if (e.target === overlay) Modal.close();
    });

    this._stack.push(id);
    return id;
  },

  /**
   * Stäng senaste modalen
   */
  close() {
    const id = this._stack.pop();
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('open');
      setTimeout(() => el.remove(), 250);
    }
  },

  /**
   * Stäng alla modaler
   */
  closeAll() {
    while (this._stack.length > 0) this.close();
  },

  /**
   * Bekräftelsedialog
   */
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

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
