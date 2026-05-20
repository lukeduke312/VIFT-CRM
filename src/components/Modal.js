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
      title.textContent = opts.title;
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

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}
