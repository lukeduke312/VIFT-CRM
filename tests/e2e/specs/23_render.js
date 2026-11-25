'use strict';
/* QA 2026-11-25 (regression efter XSS-rättningen QA-P0-3): betrodd markup
   (ic()-ikoner, badges, länkar) får aldrig visas som text. Alla sidor, alla
   admin-flikar, detaljsidor och vanliga dialoger öppnas per roll; synlig text
   (innerText) får inte innehålla HTML-taggar eller HTML-entiteter.
   Simulerad server. */
const MARKUP = /<\/?(svg|path|span|div|i|b|strong|em|a|button|br|img|small|p|ul|li|table|td|tr|label|input|select|option)\b[^>]*>|&(lt|gt|amp|quot|#39|nbsp);/i;
/* QA 2026-11-26: även trasig HTML där en tagg i ett attribut avslutat elementet
   för tidigt — då syns attributfragment som text (Serviceintervall-sökfältet). */
const BROKEN = /\b(on[a-z]+|value|placeholder|class|style|href|xmlns|viewBox|stroke-width)=["']|<svg\b|<path\b/i;

async function check(s, where, hits) {
  const r = await s.eval(([src, bsrc]) => {
    const re = new RegExp(src, 'i'); const broken = new RegExp(bsrc, 'i');
    const out = [];
    const roots = [document.querySelector('.page.active'), ...document.querySelectorAll('.modal-overlay.open')].filter(Boolean);
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) {
        const el = n.parentElement;
        if (!el || el.closest('script,style,textarea,code,pre') || !el.offsetParent) continue;
        const t = n.nodeValue; const m = t.match(re) || t.match(broken);
        if (m) out.push((el.className ? String(el.className).split(' ')[0] : el.tagName) + ': "' + t.trim().slice(Math.max(0, m.index - 20), m.index + 40) + '"');
      }
      // Attribut som visas för användaren (title/placeholder/aria-label)
      root.querySelectorAll('[title],[placeholder],[aria-label]').forEach((e) => ['title', 'placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && (re.test(v) || v.includes('<'))) out.push(a + ': "' + v.slice(0, 60) + '"'); }));
    }
    return out.slice(0, 5);
  }, [MARKUP.source, BROKEN.source]);
  if (r.length) hits.push(where + ' → ' + r.join(' | '));
}

/* QA 2026-11-26 (fältsidorna): samma kontroll som tidigare, men uppdelad på
   två test med två roller var. Fältsidorna fick flikar och chips som testet
   klickar igenom, och hela körningen (fyra roller) gick över 90 s-gränsen per
   test på en belastad maskin (87 s före, 93 s efter). Inga kontroller är
   borttagna: samma roller, sidor, flikar, admin-flikar och dialoger. */
async function runRoles(t, roles) {
    const hits = [];
    for (const [role, vp] of roles) {
      const s = await t.world.session({ viewport: vp });
      await s.login(role);
      const pages = await s.eval(() => Object.keys(Auth.PAGE_PERMISSIONS || {}).filter((p) => Auth.canViewPage(p)));
      const ids = await s.eval(() => ({
        ao: (state.workOrders || []).slice(0, 3).map((a) => a.id), cu: (state.customers || []).slice(0, 2).map((c) => c.id),
        off: (state.offers || []).slice(0, 3).map((o) => o.id), inv: (state.invoices || []).slice(0, 2).map((i) => i.id),
        prop: (state.properties || []).slice(0, 2).map((p) => p.id)
      }));
      const visits = pages.map((p) => [p, {}]);
      ids.ao.forEach((id) => visits.push(['pg-ao-detail', { aoId: id }]));
      ids.cu.forEach((id) => visits.push(['pg-crm-detail', { customerId: id }]));
      ids.off.forEach((id) => visits.push(['pg-offer-detail', { offerId: id }]));
      ids.inv.forEach((id) => visits.push(['pg-inv-detail', { invoiceId: id }]));
      ids.prop.forEach((id) => visits.push(['pg-obj-detail', { propId: id }]));
      for (const [p, prm] of visits) {
        if (!(await s.eval((x) => Auth.canViewPage(x), p))) continue;
        await s.eval(([x, q]) => { try { Modal.close(); } catch (e) {} try { Router.showPage(x, q); } catch (e) {} }, [p, prm]); await s.settle(300);
        await check(s, role + ' ' + p + (Object.values(prm)[0] ? '(' + Object.values(prm)[0] + ')' : ''), hits);
        // Flikar och filterchips på sidan: klicka var och en och kontrollera igen.
        const nTabs = await s.eval(() => document.querySelectorAll('.page.active [role=tab], .page.active .tab, .page.active .chip, .page.active .seg-btn, .page.active [class*="-tab"]:not(.admin-tab)').length);
        for (let i = 0; i < Math.min(nTabs, 14); i++) {
          const label = await s.eval((k) => { const el = document.querySelectorAll('.page.active [role=tab], .page.active .tab, .page.active .chip, .page.active .seg-btn, .page.active [class*="-tab"]:not(.admin-tab)')[k]; if (!el || !el.offsetParent || el.tagName === 'A') return null; try { el.click(); } catch (e) {} return (el.textContent || '').trim().slice(0, 20); }, i);
          if (label === null) continue;
          await s.settle(200);
          await check(s, role + ' ' + p + ' flik "' + label + '"', hits);
          if (!(await s.eval((x) => !!document.querySelector('.page.active'), p))) break;
        }
        if (p === 'pg-admin') {
          const tabs = await s.eval(() => [...document.querySelectorAll('.admin-tab')].map((b) => (b.getAttribute('onclick') || '').match(/_tab='([^']+)'/)).filter(Boolean).map((m) => m[1]));
          for (const k of tabs) { await s.eval((x) => { AdminPage._tab = x; AdminPage.render(); }, k); await s.settle(200); await check(s, role + ' pg-admin/' + k, hits); }
        }
        if (p === 'pg-ao-detail') {
          for (const fn of ['openAddMaterial', 'openAddLog', 'openPricingModal', 'openEdit']) {
            const ok = await s.eval((f) => { try { if (typeof WorkOrderDetailPage[f] !== 'function') return false; WorkOrderDetailPage[f](); return true; } catch (e) { return false; } }, fn);
            if (ok) { await s.settle(250); await check(s, role + ' ' + p + ' dialog ' + fn, hits); await s.eval(() => { try { Modal.close(); } catch (e) {} }); await s.settle(150); }
          }
        }
      }
      t.note(role + ': ' + visits.length + ' sidvisningar');
      await s.context.close();
    }
    t.assert(hits.length === 0, 'markup visas som text: ' + hits.join(' ;; '));
}

module.exports = [{
  id: 'RENDER-01', module: 'Säkerhet', kind: 'ui',
  name: 'Ingen betrodd markup visas som text efter XSS-escaping: alla sidor, admin-flikar, detaljsidor och vanliga dialoger (admin, arbetsledare)',
  run: (t) => runRoles(t, [['admin', 'laptop'], ['chef', 'laptop']]),
}, {
  id: 'RENDER-01B', module: 'Säkerhet', kind: 'ui',
  name: 'Ingen betrodd markup visas som text efter XSS-escaping: alla sidor, detaljsidor och vanliga dialoger (ekonomi, fält)',
  run: (t) => runRoles(t, [['ekonomi', 'laptop'], ['falt', 'iphone']]),
}];
