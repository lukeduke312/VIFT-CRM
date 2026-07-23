(() => {
  if (location.hostname !== 'staging-crm.viftfast.se') return;

  document.title = '[STAGING] ' + document.title;

  const badge = document.createElement('div');
  badge.textContent = 'STAGING • TESTMILJÖ';

  Object.assign(badge.style, {
    position: 'fixed',
    right: '14px',
    bottom: '14px',
    zIndex: '999999',
    padding: '8px 13px',
    borderRadius: '7px',
    background: '#b91c1c',
    color: '#ffffff',
    fontFamily: 'Arial, sans-serif',
    fontSize: '12px',
    fontWeight: '800',
    letterSpacing: '0.5px',
    boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
    pointerEvents: 'none'
  });

  document.body.appendChild(badge);
})();
