/**
 * CustomSelect — återanvändbar custom dropdown
 * Wraps a hidden native <select> so existing code (.value reads) still works.
 *
 * Usage:
 *   CustomSelect.render(id, { options, value, placeholder, onchange, searchable })
 *   options: [{v:'value', l:'Label'}, ...]
 *   onchange: inline handler string e.g. 'MyPage.onChange(this.value)'
 */
const CustomSelect = {

  render(id, { options = [], value = '', placeholder = 'Välj...', onchange = '', searchable = false } = {}) {
    const uiId = 'csui-' + id;
    const ddId = 'csdd-' + id;

    const selOpts = options.map(o =>
      `<option value="${this._e(o.v)}"${o.v === value ? ' selected' : ''}>${this._e(o.l)}</option>`
    ).join('');

    const selected   = options.find(o => o.v === value);
    const displayLbl = selected ? selected.l : '';
    const displayClr = displayLbl ? 'var(--tx)' : 'var(--mt)';

    const optItems = options.map(o =>
      `<div class="cso${o.v === value ? ' csoa' : ''}" data-v="${this._e(o.v)}"
           onclick="CustomSelect._pick('${id}',this)">${this._e(o.l)}</div>`
    ).join('');

    const searchHtml = searchable
      ? `<input type="text" class="css-srch" placeholder="Sök..."
             oninput="CustomSelect._srch('${ddId}',this.value)"
             onclick="event.stopPropagation()" onkeydown="event.stopPropagation();">`
      : '';

    return `
      <select id="${id}" style="display:none;"${onchange ? ` onchange="${onchange}"` : ''}>${selOpts}</select>
      <div class="cswrap" id="${uiId}">
        <div class="cstrig" tabindex="0"
             onclick="CustomSelect._tog('${id}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();CustomSelect._tog('${id}');}else if(event.key==='Escape'){CustomSelect._close();}">
          <span class="cslbl" style="color:${displayClr};">${this._e(displayLbl || placeholder)}</span>
          ${ic('chevron-down', 13)}
        </div>
        <div class="csdd" id="${ddId}" style="display:none;">
          ${searchHtml}
          <div class="csolist">
            ${optItems || `<div style="padding:10px 12px;font-size:12px;color:var(--mt);">Inga alternativ</div>`}
          </div>
        </div>
      </div>`;
  },

  _e(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  _tog(nativeId) {
    const ddId = 'csdd-' + nativeId;
    const uiId = 'csui-' + nativeId;
    const dd   = document.getElementById(ddId);
    if (!dd) return;
    const opening = dd.style.display === 'none';
    this._close();
    if (opening) {
      dd.style.display = 'block';
      const wrap = document.getElementById(uiId);
      if (wrap) wrap.classList.add('csopen');
      const srch = dd.querySelector('.css-srch');
      if (srch) setTimeout(() => { srch.value = ''; this._srch(ddId, ''); srch.focus(); }, 0);
    }
  },

  _pick(nativeId, el) {
    const v = el.dataset.v;
    const l = el.textContent.trim();
    const sel = document.getElementById(nativeId);
    if (sel) {
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const wrap = document.getElementById('csui-' + nativeId);
    if (wrap) {
      const lbl = wrap.querySelector('.cslbl');
      if (lbl) { lbl.textContent = l || ''; lbl.style.color = v ? 'var(--tx)' : 'var(--mt)'; }
      wrap.querySelectorAll('.cso').forEach(opt => opt.classList.toggle('csoa', opt === el));
    }
    this._close();
  },

  _srch(ddId, term) {
    const dd = document.getElementById(ddId);
    if (!dd) return;
    const q = term.toLowerCase();
    dd.querySelectorAll('.cso').forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  _close() {
    document.querySelectorAll('.csdd').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.cswrap').forEach(el => el.classList.remove('csopen'));
  }
};

document.addEventListener('click', e => {
  if (!e.target.closest('.cswrap')) CustomSelect._close();
}, true);
