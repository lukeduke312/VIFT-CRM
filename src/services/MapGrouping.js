/**
 * MapGrouping — grupperar arbetsordrar per plats för kartan (2026-11-23).
 *
 * Problem (Vasaplatsen 8, Göteborg): två AO på samma adress fick var sin
 * markör på exakt samma punkt — den ena dolde den andra.
 *
 * Regler:
 *  1. Samma plats = samma normaliserade adress (gata + nummer + postnr/ort).
 *     Saknas adress används koordinaterna med 6 decimaler (~0,1 m).
 *     Två OLIKA adresser grupperas aldrig ihop, även om geokodningen gett
 *     dem samma eller nästan samma koordinater (avrundning).
 *  2. Olika platser som ändå hamnar nära varandra (< NEAR_METERS) sprids
 *     ut lite i en cirkel så att båda markörerna syns och kan klickas.
 *  3. Antal AO, antal platser och antal som inte kunde placeras räknas
 *     separat (kartans räknare).
 */
const MapGrouping = (function () {
  var NEAR_METERS = 25;
  var SPREAD_METERS = 18;

  function _norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function addressKey(ao) {
    var street = _norm(ao && ao.address);
    if (!street) return '';
    var zip = String((ao && ao.zip) || '').replace(/\s+/g, '');
    var city = _norm(ao && ao.city);
    return street + '|' + (zip || city);
  }
  function _meters(a, b) {
    var dLat = (a.lat - b.lat) * 111320;
    var dLng = (a.lng - b.lng) * 111320 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }

  /* items: [{ ao, coord:{lat,lng} }] → grupper med visningskoordinat */
  function group(items) {
    var byKey = {};
    var order = [];
    (items || []).forEach(function (it) {
      if (!it || !it.coord || typeof it.coord.lat !== 'number' || typeof it.coord.lng !== 'number') return;
      var k = addressKey(it.ao) || ('@' + it.coord.lat.toFixed(6) + ',' + it.coord.lng.toFixed(6));
      if (!byKey[k]) { byKey[k] = { key: k, coord: { lat: it.coord.lat, lng: it.coord.lng }, items: [] }; order.push(k); }
      byKey[k].items.push(it.ao);
    });
    var groups = order.map(function (k) {
      var g = byKey[k];
      g.count = g.items.length;
      g.hasAkut = g.items.some(function (a) { return a.priority === 'akut'; });
      g.label = (g.items[0] && g.items[0].address) || '';
      g.display = { lat: g.coord.lat, lng: g.coord.lng };
      return g;
    });
    // Regel 2: sprid ut olika platser som ligger (nästan) på varandra.
    var done = {};
    groups.forEach(function (g, i) {
      if (done[i]) return;
      var cluster = [i];
      groups.forEach(function (h, j) { if (j > i && !done[j] && _meters(g.coord, h.coord) < NEAR_METERS) cluster.push(j); });
      if (cluster.length < 2) return;
      cluster.forEach(function (idx, n) {
        done[idx] = true;
        var ang = (2 * Math.PI * n) / cluster.length;
        var c = groups[idx].coord;
        groups[idx].display = {
          lat: c.lat + (SPREAD_METERS * Math.sin(ang)) / 111320,
          lng: c.lng + (SPREAD_METERS * Math.cos(ang)) / (111320 * Math.cos(c.lat * Math.PI / 180))
        };
        groups[idx].spread = true;
      });
    });
    return groups;
  }

  function counts(jobs, groups) {
    var placed = groups.reduce(function (s, g) { return s + g.count; }, 0);
    return { jobs: (jobs || []).length, places: groups.length, placed: placed, unplaced: (jobs || []).length - placed };
  }

  return { group: group, counts: counts, addressKey: addressKey, NEAR_METERS: NEAR_METERS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MapGrouping;
