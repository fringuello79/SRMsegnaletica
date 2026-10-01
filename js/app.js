// Segnaletica SRM 2026 — strumento di campo per verifica, posa e rimozione dei segnali
import { Traccia, dist, bearing, cardinale, fmtKm, fmtCoord, fmtDist } from './geo.js';
import { STATI, ORDINE_STATI, DIR_LABEL, frecciaCartello, frecciaMappa } from './frecce.js';
import { creaStore } from './store.js';
import { firebaseConfig } from '../firebase-config.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mobile = () => matchMedia('(max-width: 899px)').matches;
const LS = {
  get: (k, d = null) => { try { return localStorage.getItem('srmseg:' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('srmseg:' + k, v); } catch {} },
};

// numero visualizzato del paletto (può differire dall'identificativo interno dopo una rinumerazione)
const N = s => s?.num || s?.id || '';
const numDi = id => { const s = S.segnali.find(x => x.id === id); return s ? N(s) : id; };
const S = {
  traccia: null, piano: null, poi: [], meta: {},
  segnali: [], eventi: [], volontari: [], daServer: false,
  sel: null, scheda: 'segnale', filtro: 'tutti',
  me: null, segui: false, condividi: LS.get('condividi', '1') === '1',
  sposta: null, bivi: [], store: null, nome: '', squadra: '', modo: 'prova',
};
let map, layers = {}, markers = new Map(), mkMe, cerchioMe, mkVol = new Map();

/* =========================================================== avvio */
async function avvia() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const [tr, piano, poi] = await Promise.all(['data/traccia.json', 'data/segnali.json', 'data/poi.json'].map(u => fetch(u).then(r => r.json())));
  S.traccia = new Traccia(tr); S.piano = piano; S.poi = poi; S.meta = piano.meta;
  creaMappa();
  collegaInterfaccia();
  await accesso();
  avviaGps();
}

/* =========================================================== accesso e archivio */
async function accesso() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('squadra')) { LS.set('squadra', hash.get('squadra').trim()); history.replaceState(null, '', location.pathname + location.search); }
  S.nome = LS.get('nome', '');
  S.squadra = LS.get('squadra', '');
  const serveSquadra = !!firebaseConfig?.apiKey;
  if (!S.nome || (serveSquadra && (!S.squadra || S.squadra.length < 10))) await chiediAccesso(serveSquadra);
  await apriArchivio();
  if (!LS.get('guidaVista')) { LS.set('guidaVista', '1'); $('#dlgGuida').showModal(); }
}

function chiediAccesso(serveSquadra) {
  return new Promise(ok => {
    const d = $('#dlgAccesso');
    $('#inNome').value = S.nome; $('#inSquadra').value = S.squadra;
    $('#campoSquadra').hidden = !serveSquadra; $('#inSquadra').required = serveSquadra;
    if (!serveSquadra) $('#accessoTesto').textContent = 'Modalità prova: i dati restano su questo dispositivo. Ogni azione viene registrata con il tuo nome.';
    d.addEventListener('cancel', e => e.preventDefault(), { once: true });
    d.showModal();
    $('#formAccesso').onsubmit = () => {
      S.nome = $('#inNome').value.trim(); LS.set('nome', S.nome);
      if (serveSquadra) { S.squadra = $('#inSquadra').value.trim(); LS.set('squadra', S.squadra); }
      ok();
    };
  });
}

async function apriArchivio() {
  const st = creaStore({ config: firebaseConfig, squadra: S.squadra, nome: S.nome });
  S.store = st; S.modo = st.modo;
  st.on('segnali', (lista, meta) => {
    S.segnali = lista.sort((a, b) => a.km - b.km);
    S.daServer = S.daServer || meta.daServer;
    if (S.modo === 'prova' && meta.daServer && !lista.length && !LS.get('provaCaricata')) {
      LS.set('provaCaricata', '1'); st.inizializza(S.piano.segnali); return;
    }
    if (S.sel && !S.segnali.find(s => s.id === S.sel)) S.sel = null;
    disegnaSegnali(); aggiornaTutto();
  });
  st.on('eventi', ev => { S.eventi = ev; if (S.scheda !== 'elenco') renderScheda(); });
  st.on('volontari', v => { S.volontari = v; disegnaVolontari(); if (S.scheda === 'squadra') renderScheda(); });
  st.on('stato', mostraSync);
  st.on('errore', msg => { toast(msg, 6000); mostraSync({ errore: msg }); });
  try { await st.avvia(); }
  catch (e) {
    console.error(e);
    mostraSync({ errore: 'Collegamento a Firebase non riuscito: ' + (e.code || e.message) });
  }
}

function mostraSync(s) {
  const el = $('#sync');
  el.className = 'sync';
  if (s.errore) { el.textContent = s.errore; el.classList.add('prova'); return; }
  if (s.modo === 'prova') { el.textContent = 'Modalità prova: i dati restano su questo dispositivo.'; el.classList.add('prova'); return; }
  if (!s.online || !navigator.onLine) { el.textContent = 'Senza rete: le modifiche sono salvate sul telefono e partono appena torna il segnale.'; el.classList.add('offline'); return; }
  if (s.inAttesa) { el.textContent = 'Invio delle modifiche in corso…'; return; }
  el.classList.add('ok');
}

/* =========================================================== mappa */
function creaMappa() {
  map = L.map('mappa', { zoomControl: false, maxZoom: 20, attributionControl: false, tap: true });
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false, position: 'topleft' }).addTo(map);
  layers.base = {
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Immagini © Esri, Maxar, Earthstar Geographics' }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 17, subdomains: 'abc', className: 'tile-attenuata', attribution: '© OpenTopoMap (CC-BY-SA), dati © OpenStreetMap' }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, className: 'tile-attenuata', attribution: '© OpenStreetMap' }),
  };
  layers.cai = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 18, opacity: .85, className: 'tile-sentieri', attribution: 'Sentieri © waymarkedtrails.org' });
  const base = LS.get('base', 'satellite');
  (layers.base[base] || layers.base.satellite).addTo(map);
  if (LS.get('ov:cai', '1') === '1') layers.cai.addTo(map);

  ['traccia', 'chevron', 'bivi', 'svolte'].forEach((p, i) => { map.createPane(p); map.getPane(p).style.zIndex = 405 + i * 5; });
  const ll = S.traccia.latlngs();
  L.polyline(ll, { pane: 'traccia', color: '#153821', weight: 8, opacity: .85, interactive: false }).addTo(map);
  L.polyline(ll, { pane: 'traccia', color: '#FF8102', weight: 4.5, opacity: 1, interactive: false }).addTo(map);
  // tratto percorso due volte: tratteggio bianco
  S.traccia.comune.slice(0, 1).forEach(([a, b]) => {
    const seg = S.traccia.pts.filter(p => p[3] >= a && p[3] <= b).map(p => [p[0], p[1]]);
    L.polyline(seg, { pane: 'traccia', color: '#fff', weight: 2, dashArray: '2 9', opacity: .95, interactive: false })
      .addTo(map);
  });
  map.fitBounds(L.latLngBounds(ll), { padding: [30, 30] });

  // frecce di direzione e chilometri
  layers.chevron = L.layerGroup();
  for (let k = 0.25; k < S.traccia.kmTot - 0.1; k += 0.35) {
    const p = S.traccia.at(k), b = S.traccia.direzioneDopo(k, 0.03);
    L.marker([p[0], p[1]], { pane: 'chevron', interactive: false, keyboard: false, icon: L.divIcon({ className: 'mk-chevron', iconSize: [16, 16], iconAnchor: [8, 8],
      html: `<svg viewBox="-8 -8 16 16" width="16" height="16"><path transform="rotate(${b})" d="M-5 3 L0 -3 L5 3" fill="none" stroke="#153821" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` }) }).addTo(layers.chevron);
  }
  for (let k = 1; k < S.traccia.kmTot; k++) {
    const p = S.traccia.at(k);
    L.marker([p[0], p[1]], { pane: 'chevron', icon: L.divIcon({ className: 'mk-km', iconSize: [22, 22], iconAnchor: [11, 11], html: `<span>${k}</span>` }) })
      .bindTooltip(`km ${k}`, { className: 'tip', direction: 'top' }).addTo(layers.chevron);
  }
  const zoomChevron = () => {
    if (map.getZoom() >= 14) layers.chevron.addTo(map); else layers.chevron.remove();
    $('#mappa').classList.toggle('z-lontano', map.getZoom() < 14);
  };
  map.on('zoomend', zoomChevron); zoomChevron();

  // punti gara
  layers.poi = L.layerGroup();
  S.poi.forEach(p => L.marker([p.lat, p.lon], { icon: iconaPoi(p.tipo), keyboard: false })
    .bindTooltip(`<b>${esc(p.nome)}</b><br>km ${fmtKm(p.km)}, ${p.ele} m<br>${esc(p.desc)}`, { className: 'tip', direction: 'top', offset: [0, -14] })
    .addTo(layers.poi));
  if (LS.get('ov:poi', '1') === '1') layers.poi.addTo(map);

  layers.segnali = L.layerGroup().addTo(map);
  layers.svolte = L.layerGroup();
  if (LS.get('ov:svolte', '1') === '1') layers.svolte.addTo(map);
  layers.squadra = L.layerGroup();
  if (LS.get('ov:squadra', '1') === '1') layers.squadra.addTo(map);
  layers.bivi = L.layerGroup();

  map.on('click', e => {
    if (S.sposta) { const m = markers.get(S.sposta.id); m?.setLatLng(e.latlng); anteprimaSposta(); return; }
  });
  map.on('dragstart', () => { if (S.segui) { S.segui = false; $('#btnPosizione').classList.remove('attivo'); } });
}

function iconaPoi(tipo) {
  const g = {
    start: '<path d="M6 21V4m0 0h11l-2 4 2 4H6" fill="none" stroke="#153821" stroke-width="2.2" stroke-linejoin="round"/>',
    acqua: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" fill="#1f5fad"/>',
    cancello: '<circle cx="12" cy="12" r="8" fill="none" stroke="#c62828" stroke-width="2.4"/><path d="M12 7v5l3 2" stroke="#c62828" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
    ristoro: '<path d="M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Zm11 1h2a2 2 0 0 1 0 4h-2" fill="none" stroke="#153821" stroke-width="2.2"/>',
    riserva: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z" fill="none" stroke="#6b6f67" stroke-width="2.2"/><path d="M12 10v4" stroke="#6b6f67" stroke-width="2.4" stroke-linecap="round"/>',
  }[tipo] || '';
  return L.divIcon({ className: 'mk-poi', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div><svg viewBox="0 0 24 24" width="20" height="20">${g}</svg></div>` });
}

function iconaSegnale(s) {
  const st = STATI[s.stato] || STATI.da_verificare;
  const sel = S.sel === s.id, trasc = S.sposta?.id === s.id;
  const doppio = (s.frecce || []).length > 1;
  const fr = (s.frecce || []).map(f => frecciaMappa(S.traccia.direzioneDopo(f.km), { size: doppio ? 34 : 46, sbiadita: s.stato === 'rimosso' })).join('');
  return L.divIcon({
    className: 'mk-segnale', iconSize: [64, 64], iconAnchor: [32, 32],
    html: `<div class="mk st-${s.stato} ${doppio ? 'doppio' : ''} ${sel ? 'sel' : ''} ${trasc ? 'trascina' : ''}" style="--c:${st.colore}">${fr}${doppio ? '<span class="ar a">A</span><span class="ar r">R</span>' : ''}<span class="tag">${esc(N(s))}<i aria-label="${st.label}">${st.icona}</i></span></div>`,
  });
}

function disegnaSegnali() {
  const visti = new Set();
  for (const s of S.segnali) {
    visti.add(s.id);
    let m = markers.get(s.id);
    if (S.sposta?.id === s.id && m) { m.setIcon(iconaSegnale(s)); continue; }
    if (!m) {
      m = L.marker([s.lat, s.lon], { icon: iconaSegnale(s), title: N(s), riseOnHover: true });
      m.on('click', () => seleziona(s.id));
      m.on('drag', anteprimaSposta);
      m.on('dragend', anteprimaSposta);
      m.addTo(layers.segnali); markers.set(s.id, m);
    } else { m.setLatLng([s.lat, s.lon]); m.setIcon(iconaSegnale(s)); }
    m.setZIndexOffset(S.sel === s.id ? 1000 : 0);
  }
  for (const [id, m] of markers) if (!visti.has(id)) { m.remove(); markers.delete(id); }
  // svolte suggerite dalla traccia
  layers.svolte.clearLayers();
  for (const s of S.segnali) {
    if (!s.suggerimento || s.stato !== 'da_verificare') continue;
    const g = s.suggerimento;
    L.circleMarker([g.lat, g.lon], { pane: 'svolte', radius: 11, color: '#FF8102', weight: 3, dashArray: '4 4', fillColor: '#fff', fillOpacity: .35 })
      .bindTooltip(`Svolta della traccia per ${N(s)} (km ${fmtKm(g.km)})`, { className: 'tip', direction: 'top' })
      .on('click', () => seleziona(s.id)).addTo(layers.svolte);
  }
}

function vola(latlng, z = 17) {
  const off = mobile() ? ($('#pannello').dataset.altezza === 'chiuso' ? 30 : 100) : 0;
  const zz = Math.max(map.getZoom(), z);
  const pt = map.project(latlng, zz).add([0, off]);
  map.flyTo(map.unproject(pt, zz), zz, { duration: .6 });
}

/* =========================================================== GPS e squadra */
let ultimoInvio = { t: 0, lat: 0, lon: 0 };
function avviaGps() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.watchPosition(p => {
    S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
    const ll = [S.me.lat, S.me.lon];
    if (!mkMe) {
      cerchioMe = L.circle(ll, { radius: S.me.acc, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
      mkMe = L.marker(ll, { icon: L.divIcon({ className: 'mk-me', iconSize: [20, 20], iconAnchor: [10, 10], html: '<div></div>' }), zIndexOffset: 2000, keyboard: false })
        .bindTooltip('Tu', { className: 'tip' }).addTo(map);
    } else { mkMe.setLatLng(ll); cerchioMe.setLatLng(ll).setRadius(S.me.acc); }
    if (S.segui) map.panTo(ll);
    aggiornaDistanza();
    if (S.condividi && S.modo === 'firebase') {
      const moved = dist([S.me.lat, S.me.lon], [ultimoInvio.lat, ultimoInvio.lon]);
      if (Date.now() - ultimoInvio.t > 20000 || moved > 30) { ultimoInvio = { t: Date.now(), lat: S.me.lat, lon: S.me.lon }; S.store?.posizione(S.me); }
    }
  }, err => { if (err.code === 1) toast('Posizione non autorizzata: attivala nelle impostazioni del browser per usare «Metti qui».', 6000); },
  { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

function colore(uid) { let h = 0; for (const c of uid || '') h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 36%)`; }
function iniziali(n) { return (n || '?').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(); }
function fa(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'adesso'; if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h fa`;
  return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
function quando(e) { const t = e.tl || (e.t?.toMillis ? e.t.toMillis() : e.t); return t || Date.now(); }

function disegnaVolontari() {
  const visti = new Set();
  for (const v of S.volontari) {
    if (v.uid === S.store?.uid) continue;
    const t = v.tl || 0; if (Date.now() - t > 6 * 3600e3) continue;
    visti.add(v.uid);
    const vecchio = Date.now() - t > 10 * 60e3;
    const icon = L.divIcon({ className: `mk-vol ${vecchio ? 'vecchio' : ''}`, iconSize: [32, 32], iconAnchor: [16, 16], html: `<div class="iniziali" style="background:${colore(v.uid)}">${esc(iniziali(v.nome))}</div>` });
    let m = mkVol.get(v.uid);
    if (!m) { m = L.marker([v.lat, v.lon], { icon, zIndexOffset: 1500 }).addTo(layers.squadra); mkVol.set(v.uid, m); }
    else { m.setLatLng([v.lat, v.lon]).setIcon(icon); }
    m.unbindTooltip().bindTooltip(`${esc(v.nome)}, ${fa(t)}`, { className: 'tip', direction: 'top', offset: [0, -14] });
  }
  for (const [uid, m] of mkVol) if (!visti.has(uid)) { m.remove(); mkVol.delete(uid); }
}

/* =========================================================== pannello trascinabile (telefono) */
// Tre altezze: chiuso (solo maniglia e schede), basso (scheda breve), alto (scheda intera).
// Si trascina dalla maniglia o dalle schede; dal contenuto, tirando giù quando è in cima.
const ALTEZZE = ['alto', 'basso', 'chiuso'];
function altezzaPannello(st) {
  $('#pannello').dataset.altezza = st;
  $('.layout').dataset.pannello = st;
}
function initFoglio() {
  const p = $('#pannello'), corpo = $('.pannello-corpo');
  altezzaPannello(p.dataset.altezza || 'basso');
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position:absolute;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(sonda);
  const varPx = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
  const posizione = st => {
    if (st === 'alto') return 0;
    const sicuro = parseFloat(getComputedStyle(sonda).paddingBottom) || 0;
    return p.offsetHeight - (st === 'basso' ? varPx('--apri-basso') : varPx('--apri-chiuso')) - sicuro;
  };
  const attuale = () => new DOMMatrixReadOnly(getComputedStyle(p).transform).m42;
  let drag = null, inAttesa = null, ignoraClick = false;

  const inizia = y => {
    drag = { y0: y, base: attuale(), ultimo: y, t: performance.now(), v: 0, ty: attuale() };
    p.classList.add('trascina');
  };
  const muovi = y => {
    const max = posizione('chiuso');
    let ty = drag.base + (y - drag.y0);
    if (ty < 0) ty = ty / 4;                       // resistenza oltre il massimo
    ty = Math.min(ty, max + 30);
    p.style.transform = `translateY(${ty}px)`;
    const ora = performance.now();
    drag.v = (y - drag.ultimo) / Math.max(1, ora - drag.t);
    drag.ultimo = y; drag.t = ora; drag.ty = ty;
  };
  const termina = () => {
    const { ty, v } = drag; drag = null;
    p.classList.remove('trascina'); p.style.transform = '';
    const punti = ALTEZZE.map(st => ({ st, y: posizione(st) }));   // alto (0) … chiuso (max)
    let scelto;
    if (v > 0.45) scelto = punti.find(x => x.y > ty + 8) || punti.at(-1);
    else if (v < -0.45) scelto = [...punti].reverse().find(x => x.y < ty - 8) || punti[0];
    else scelto = punti.reduce((a, b) => Math.abs(b.y - ty) < Math.abs(a.y - ty) ? b : a);
    altezzaPannello(scelto.st);
    if (scelto.st !== 'alto') corpo.scrollTop = 0;
  };

  // maniglia e schede: trascinamento con il dito o il mouse; un tocco senza movimento resta un clic
  [$('#maniglia'), $('.schede')].forEach(z => {
    z.addEventListener('pointerdown', e => { if (mobile()) inAttesa = { y: e.clientY, id: e.pointerId, z }; });
    z.addEventListener('pointermove', e => {
      if (inAttesa && !drag && Math.abs(e.clientY - inAttesa.y) > 6) {
        inizia(inAttesa.y); try { z.setPointerCapture(inAttesa.id); } catch {}
      }
      if (drag) muovi(e.clientY);
    });
    const fine = () => { if (drag) { termina(); ignoraClick = true; setTimeout(() => ignoraClick = false, 80); } inAttesa = null; };
    z.addEventListener('pointerup', fine);
    z.addEventListener('pointercancel', fine);
    z.addEventListener('click', e => { if (ignoraClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  });
  $('#maniglia').addEventListener('click', () => {
    const st = p.dataset.altezza;
    altezzaPannello(st === 'alto' ? 'basso' : st === 'basso' ? 'alto' : 'basso');
  });

  // contenuto: tirando giù quando la scheda è in cima il pannello scende; tirando su da basso si apre
  let tocco = null;
  corpo.addEventListener('touchstart', e => {
    if (!mobile() || e.touches.length !== 1 || e.target.closest('input, textarea, select')) { tocco = null; return; }
    tocco = { y0: e.touches[0].clientY, attivo: false };
  }, { passive: true });
  corpo.addEventListener('touchmove', e => {
    if (!tocco) return;
    const y = e.touches[0].clientY, dy = y - tocco.y0;
    if (!tocco.attivo) {
      if (Math.abs(dy) < 8) return;
      const giu = dy > 0, st = p.dataset.altezza;
      if ((giu && corpo.scrollTop <= 0) || (!giu && st !== 'alto')) { tocco.attivo = true; inizia(tocco.y0); }
      else { tocco = null; return; }
    }
    e.preventDefault(); muovi(y);
  }, { passive: false });
  const fineTocco = () => { if (tocco?.attivo && drag) termina(); tocco = null; };
  corpo.addEventListener('touchend', fineTocco);
  corpo.addEventListener('touchcancel', fineTocco);
}

/* =========================================================== pannello */
function collegaInterfaccia() {
  $$('.schede button').forEach(b => b.addEventListener('click', () => vaiScheda(b.dataset.scheda)));
  initFoglio();
  $('#btnMenu').addEventListener('click', () => { $('#menuInfo').textContent = infoSessione(); $('#dlgMenu').showModal(); });
  $('#btnLivelli').addEventListener('click', apriLivelli);
  $('#btnPosizione').addEventListener('click', () => {
    if (!S.me) { toast('Sto cercando la tua posizione…'); return; }
    S.segui = !S.segui; $('#btnPosizione').classList.toggle('attivo', S.segui);
    if (S.segui) vola([S.me.lat, S.me.lon], 16);
  });
  $('#btnAggiungi').addEventListener('click', apriNuovo);
  $('#btnGpx').addEventListener('click', esportaGpx);
  $('#btnCsv').addEventListener('click', esportaCsv);
  $('#btnGuida').addEventListener('click', () => { $('#dlgMenu').close(); $('#dlgGuida').showModal(); });
  $('#btnRinumera').addEventListener('click', () => { $('#dlgMenu').close(); apriRinumera(); });
  $('#btnCambiaNome').addEventListener('click', async () => { $('#dlgMenu').close(); LS.set('nome', ''); location.reload(); });
  $('#btnOffline').addEventListener('click', scaricaOffline);
  document.addEventListener('focusout', e => { if (e.target.matches?.('textarea.nota') && rinviaRender) { rinviaRender = false; setTimeout(renderScheda, 50); } });
}

function infoSessione() {
  if (S.modo === 'prova') return `Sei ${S.nome}. Modalità prova: i dati restano su questo dispositivo.`;
  return `Sei ${S.nome}, squadra ${S.squadra.slice(0, 3)}••••. Dati condivisi in tempo reale con chi usa lo stesso codice.`;
}

function vaiScheda(n) {
  S.scheda = n;
  $$('.schede button').forEach(b => b.setAttribute('aria-selected', b.dataset.scheda === n));
  $$('.scheda').forEach(s => s.hidden = s.id !== 'scheda-' + n);
  renderScheda();
}

function aggiornaTutto() { renderAvanzamento(); renderScheda(); }

function conteggi() {
  const c = { da_verificare: 0, verificato: 0, posato: 0, rimosso: 0 };
  S.segnali.forEach(s => c[s.stato] = (c[s.stato] || 0) + 1);
  return c;
}

function renderAvanzamento() {
  const c = conteggi(), n = S.segnali.length || 1;
  const dopoGara = Date.now() > Date.parse(S.meta.fine);
  const testo = dopoGara ? `<b>${c.rimosso}</b>/${S.segnali.length} rimossi` : `<b>${c.posato + c.rimosso}</b>/${S.segnali.length} posati`;
  $('#avanzamento').innerHTML = `<span class="numeri">${testo}</span><span class="barra-stati" aria-hidden="true">${ORDINE_STATI.map(k => `<span style="width:${c[k] / n * 100}%;background:${STATI[k].colore}"></span>`).join('')}</span>`;
  const daFare = c.da_verificare;
  $('.schede [data-scheda="elenco"]').innerHTML = `Elenco${daFare ? `<span class="conta" title="Da verificare">${daFare}</span>` : ''}`;
}

let rinviaRender = false;
function renderScheda() {
  if (document.activeElement?.matches?.('textarea.nota')) { rinviaRender = true; return; }
  if (S.scheda === 'segnale') renderSegnale();
  else if (S.scheda === 'elenco') renderElenco();
  else renderSquadra();
}

function seleziona(id, { daElenco = false } = {}) {
  if (S.sposta && S.sposta.id !== id) annullaSposta();
  S.sel = id;
  const s = S.segnali.find(x => x.id === id);
  disegnaSegnali();
  vaiScheda('segnale');
  if (s) { if (daElenco || !map.getBounds().pad(-0.15).contains([s.lat, s.lon])) vola([s.lat, s.lon], 17); }
  if (mobile()) altezzaPannello('basso');
  $('.pannello-corpo').scrollTop = 0;
}

function chip(stato) { const st = STATI[stato] || STATI.da_verificare; return `<span class="chip" style="background:${st.colore}"><i>${st.icona}</i>${st.breve}</span>`; }

function renderSegnale() {
  const el = $('#scheda-segnale');
  const s = S.segnali.find(x => x.id === S.sel);
  if (!s) { el.innerHTML = renderRiepilogo(); legaRiepilogo(el); return; }
  const kmP = S.traccia.proietta(s.lat, s.lon, (s.km || 0) - 1.5, (s.km || 0) + 1.5);
  const ele = Math.round(S.traccia.at(kmP.km)[2]);
  const sent = S.traccia.sentiero(s.km);
  const st = s.stato;
  const sp = S.sposta?.id === s.id;
  const az = [];
  if (sp) {
    az.push(`<div class="sposta-guida" id="spostaInfo">Trascina la freccia sul bivio vero, oppure tocca la mappa nel punto giusto.</div>
      <div class="riga"><button class="btn" data-az="annullaSposta">Annulla</button><button class="btn btn-sole" data-az="salvaSposta">Salva posizione</button></div>`);
  } else {
    if (st === 'da_verificare') az.push(`<button class="btn btn-sole" data-az="verifica">Conferma posizione</button>`);
    if (st === 'verificato') az.push(`<button class="btn btn-sole" data-az="posa">Segna come posato</button>`);
    if (st === 'posato') az.push(`<button class="btn btn-sole" data-az="rimuovi">Segna come rimosso</button>`);
    if (st === 'rimosso') az.push(`<p class="dlg-nota">Rimosso ${s.rimossoDa ? 'da ' + esc(s.rimossoDa) : ''} ${s.rimossoIl ? fa(s.rimossoIl) : ''}.</p>`);
    if (st === 'da_verificare' || st === 'verificato') az.push(`<div class="riga"><button class="btn" data-az="mettiQui">Metti qui (GPS)</button><button class="btn" data-az="sposta">Sposta sulla mappa</button></div>`);
    az.push(`<div class="riga"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=walking">Naviga fin qui</a><button class="btn" data-az="centra">Mostra in mappa</button></div>`);
  }
  const frecce = (s.frecce || []).map((f, i) => `
    <div class="freccia-card">
      ${frecciaCartello(f.dir, { h: 46, titolo: `Freccia ${f.codice} ${DIR_LABEL[f.dir]}` })}
      <div class="fc-testo"><b>${esc(f.codice)} ${DIR_LABEL[f.dir]}</b><span>${f.verso === 'unico' ? '' : (f.verso === 'andata' ? 'Andata, ' : 'Ritorno, ')}km ${fmtKm(f.km)}, sentiero ${esc(S.traccia.sentiero(f.km))}</span></div>
      ${f.origine === 'proposta' ? `<div class="proposta">Freccia proposta per il tratto percorso due volte: controlla il senso sul posto.</div>` : ''}
      ${st !== 'rimosso' ? `<div class="scelta-dir" role="group" aria-label="Senso della freccia ${esc(f.codice)}">${['sx', 'dritto', 'dx'].map(d => `<button type="button" data-dir="${i}:${d}" class="${f.dir === d ? 'on' : ''}" aria-pressed="${f.dir === d}">${{ sx: 'Sinistra', dritto: 'Dritto', dx: 'Destra' }[d]}</button>`).join('')}</div>` : ''}
    </div>`).join('');
  const analisi = (s.frecce || []).map(f => f.analisi ? `<div class="esito" style="--c:${{ coerente: '#3e6b2a', spostare: '#b7791f', opposto: '#c62828', dritto: '#6b6f67' }[f.analisi.esito] || '#6b6f67'}"><span><b>${esc(f.codice)}</b>: ${esc(f.analisi.testo)}</span></div>` : '').join('');
  const bivio = S.bivi.length ? biviVicini(s.lat, s.lon)[0] : null;
  const storia = S.eventi.filter(e => e.segnale === s.id).slice(0, 30);
  el.innerHTML = `
    <div class="seg-testa">
      <div class="seg-num">${esc(N(s))}</div>
      <div class="seg-info"><div class="km">km ${fmtKm(s.km)}${s.doppio ? ' e ' + fmtKm(Math.max(...s.frecce.map(f => f.km))) : ''}</div><div class="det">Sentiero ${esc(sent)}, ${ele} m</div>${chip(st)}</div>
      <button class="seg-chiudi" data-az="chiudi" aria-label="Chiudi la scheda">×</button>
    </div>
    <div class="azioni">${az.join('')}</div>
    <div class="distanza" id="distanza" hidden></div>
    <div class="frecce">${frecce}</div>
    <div class="blocco">
      <h3>Controllo sulla traccia</h3>
      ${analisi}
      <p>Ora è a <b>${Math.round(kmP.d)} m</b> dalla traccia${kmP.d > 40 ? ' (lontano: verifica che sia sul sentiero giusto)' : ''}.</p>
      ${s.suggerimento && st === 'da_verificare' ? `<button class="btn btn-piccolo" data-az="suggerimento">Sposta sulla svolta della traccia (${s.suggerimento.dist} m)</button>` : ''}
      ${bivio && bivio.d < 80 ? `<p>Bivio OpenStreetMap più vicino a ${Math.round(bivio.d)} m. <button class="link" data-az="bivio">Sposta sul bivio</button></p>` : ''}
    </div>
    <div class="blocco">
      <h3>Posizione</h3>
      <div class="coord"><span>${fmtCoord(s.lat)}, ${fmtCoord(s.lon)}</span><button class="link" data-az="copia">Copia</button></div>
      ${s.verificatoDa ? `<p class="dlg-nota">Posizione confermata da ${esc(s.verificatoDa)} ${s.verificatoIl ? fa(s.verificatoIl) : ''}.</p>` : `<p class="dlg-nota">Posizione calcolata dal piano: da verificare sul bivio reale prima di piantare il paletto.</p>`}
      ${s.posatoDa ? `<p class="dlg-nota">Posato da ${esc(s.posatoDa)} ${s.posatoIl ? fa(s.posatoIl) : ''}.</p>` : ''}
    </div>
    <div class="blocco">
      <h3>Nota per chi posa</h3>
      <textarea class="nota" id="nota" placeholder="Es. piantare a sinistra del palo CAI, terreno duro">${esc(s.nota || '')}</textarea>
      <button class="btn btn-piccolo" data-az="salvaNota">Salva nota</button>
    </div>
    <div class="blocco">
      <h3>Storia</h3>
      ${storia.length ? `<ul class="storia">${storia.map(rigaStoria).join('')}</ul>` : '<p class="dlg-nota">Ancora nessuna azione registrata.</p>'}
    </div>
    <div class="blocco">
      <h3>Altre azioni</h3>
      <div class="azioni">
        <label class="campo">Correggi lo stato
          <select id="cambiaStato" class="btn">${ORDINE_STATI.map(k => `<option value="${k}" ${k === st ? 'selected' : ''}>${STATI[k].label}</option>`).join('')}</select>
        </label>
        <button class="btn btn-pericolo btn-piccolo" data-az="elimina">Elimina il segnale ${esc(N(s))}</button>
      </div>
    </div>`;
  el.querySelectorAll('[data-az]').forEach(b => b.addEventListener('click', () => azione(b.dataset.az, s)));
  el.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => cambiaDir(s, ...b.dataset.dir.split(':'))));
  el.querySelector('#cambiaStato')?.addEventListener('change', e => correggiStato(s, e.target.value));
  el.querySelectorAll('.storia img').forEach(i => i.addEventListener('click', () => window.open(i.src, '_blank')));
  aggiornaDistanza();
}

const AZIONI = { piano_caricato: 'Piano caricato', rinumerati: 'Paletti rinumerati in ordine di km', spostato: 'Spostato', messo_qui: 'Portato sulla posizione GPS', verificato: 'Posizione confermata', posato: 'Posato', rimosso: 'Rimosso', stato: 'Stato corretto', freccia: 'Senso della freccia cambiato', nota: 'Nota aggiornata', creato: 'Aggiunto', eliminato: 'Eliminato' };
function rigaStoria(e) {
  const t = quando(e);
  const d = new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<li><time>${d}</time><span><b>${esc(AZIONI[e.azione] || e.azione)}</b>${e.segnale && e.segnale !== '*' && S.scheda !== 'segnale' ? ' ' + esc(numDi(e.segnale)) : ''}, ${esc(e.chi || '')}${e.note ? `. ${esc(e.note)}` : ''}</span>${e.foto ? `<img src="${e.foto}" alt="Foto di ${esc(e.chi || '')}">` : ''}</li>`;
}

function renderRiepilogo() {
  if (!S.segnali.length) {
    if (S.modo === 'firebase' && S.daServer) return `<div class="vuoto"><h2>La squadra è vuota</h2><p>Carica il piano: ${S.piano.segnali.length} paletti dalle tue indicazioni, con le frecce doppie nel tratto percorso due volte.</p><button class="btn btn-sole" data-az="carica">Carica il piano dei segnali</button></div>`;
    return `<div class="vuoto"><h2>Caricamento…</h2><p>Sto leggendo i segnali della squadra.</p></div>`;
  }
  const c = conteggi();
  const daFare = S.segnali.filter(s => s.stato !== 'rimosso' && s.stato !== 'posato');
  let prossimo = daFare[0];
  if (S.me && daFare.length) prossimo = daFare.reduce((a, b) => dist([S.me.lat, S.me.lon], [a.lat, a.lon]) < dist([S.me.lat, S.me.lon], [b.lat, b.lon]) ? a : b);
  return `
    <div class="riepilogo">${ORDINE_STATI.map(k => `<div style="--c:${STATI[k].colore}"><b>${c[k] || 0}</b><span>${STATI[k].breve}</span></div>`).join('')}</div>
    ${prossimo ? `<button class="prossimo" data-sel="${prossimo.id}">${frecciaCartello(prossimo.frecce[0].dir, { h: 30 })}<span><b>${S.me ? 'Il più vicino da fare' : 'Il primo da fare'}: ${esc(N(prossimo))}</b><br><span class="dlg-nota">km ${fmtKm(prossimo.km)}, ${STATI[prossimo.stato].label.toLowerCase()}${S.me ? `, a ${fmtDist(dist([S.me.lat, S.me.lon], [prossimo.lat, prossimo.lon]))}` : ''}</span></span></button>` : '<p class="vuoto">Tutti i segnali sono posati o rimossi.</p>'}
    <p class="dlg-nota" style="margin-top:14px">Tocca una freccia sulla mappa per aprirne la scheda. Le frecce puntano dove deve andare il corridore.</p>`;
}
function legaRiepilogo(el) {
  el.querySelector('[data-az="carica"]')?.addEventListener('click', async e => { e.target.disabled = true; await S.store.inizializza(S.piano.segnali); toast('Piano caricato'); });
  el.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => seleziona(b.dataset.sel, { daElenco: true })));
}

function aggiornaDistanza() {
  const box = $('#distanza'); if (!box) return;
  const s = S.segnali.find(x => x.id === S.sel);
  if (!s || !S.me) { box.hidden = true; return; }
  const d = dist([S.me.lat, S.me.lon], [s.lat, s.lon]);
  const b = bearing([S.me.lat, S.me.lon], [s.lat, s.lon]);
  box.hidden = false;
  box.innerHTML = `<svg class="bussola" viewBox="-17 -17 34 34" aria-hidden="true"><circle r="15" fill="none" stroke="#f3efe2" stroke-opacity=".4" stroke-width="2"/><text y="-9" font-size="7" fill="#f3efe2" text-anchor="middle" font-family="Oswald">N</text><path transform="rotate(${b})" d="M0 -12 L6 6 L0 2 L-6 6 Z" fill="#FF8102"/></svg>
    <div><b>${d < 15 ? 'Sei sul punto' : fmtDist(d)}</b>${d >= 15 ? ` verso ${cardinale(b)}` : ''}<small>Precisione del GPS: ${Math.round(S.me.acc)} m</small></div>`;
}

function renderElenco() {
  const el = $('#scheda-elenco');
  const filtri = [['tutti', 'Tutti'], ['da_verificare', 'Da verificare'], ['verificato', 'Confermati'], ['posato', 'Posati'], ['rimosso', 'Rimossi'], ['vicini', 'Vicino a me']];
  let lista = S.segnali.filter(s => S.filtro === 'tutti' || S.filtro === 'vicini' || s.stato === S.filtro);
  if (S.filtro === 'vicini' && S.me) lista = [...lista].sort((a, b) => dist([S.me.lat, S.me.lon], [a.lat, a.lon]) - dist([S.me.lat, S.me.lon], [b.lat, b.lon]));
  el.innerHTML = `<div class="filtri" role="group" aria-label="Filtra i segnali">${filtri.map(([k, l]) => `<button data-f="${k}" class="${S.filtro === k ? 'on' : ''}" aria-pressed="${S.filtro === k}">${l}</button>`).join('')}</div>
    ${S.filtro === 'vicini' && !S.me ? '<p class="dlg-nota">Attendo la tua posizione GPS…</p>' : ''}
    <ul class="righe">${lista.map(s => `<li><button data-sel="${s.id}">
      <span class="n">${esc(N(s))}</span>
      <span class="d"><b>km ${fmtKm(s.km)}</b> ${s.frecce.map(f => `${f.verso === 'ritorno' ? 'rit.' : ''} ${DIR_LABEL[f.dir]}`).join(', ')}<br>Sentiero ${esc(S.traccia.sentiero(s.km))}${S.me ? `, a ${fmtDist(dist([S.me.lat, S.me.lon], [s.lat, s.lon]))}` : ''}${s.nota ? ', con nota' : ''}</span>
      ${chip(s.stato)}</button></li>`).join('') || '<li class="vuoto">Nessun segnale in questo filtro.</li>'}</ul>`;
  el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { S.filtro = b.dataset.f; renderElenco(); }));
  el.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => seleziona(b.dataset.sel, { daElenco: true })));
}

function renderSquadra() {
  const el = $('#scheda-squadra');
  const fine = Date.parse(S.meta.fine), scad = Date.parse(S.meta.scadenza_rimozione), ora = Date.now();
  const c = conteggi();
  const nonRimossi = S.segnali.length - (c.rimosso || 0);
  let box;
  if (ora < fine) box = `<div class="scadenza"><b>Posa sabato 17 ottobre</b>Rimozione completa entro mercoledì 21 ottobre alle 16:00: 72 ore dalla chiusura della gara (art. 11 del disciplinare del Parco).</div>`;
  else if (ora < scad) { const h = Math.floor((scad - ora) / 3600e3); box = `<div class="scadenza"><b>Mancano ${Math.floor(h / 24)} giorni e ${h % 24} ore</b>${nonRimossi} segnali ancora da rimuovere entro mercoledì 21 ottobre alle 16:00.</div>`; }
  else box = `<div class="scadenza"><b>${nonRimossi ? `Termine superato: ${nonRimossi} segnali non risultano rimossi` : 'Tutti i segnali risultano rimossi'}</b>Termine: 21 ottobre alle 16:00.</div>`;
  const altri = S.volontari.filter(v => v.uid !== S.store?.uid && Date.now() - (v.tl || 0) < 6 * 3600e3);
  const link = S.modo === 'firebase' ? `${location.origin}${location.pathname}#squadra=${encodeURIComponent(S.squadra)}` : '';
  el.innerHTML = `${box}
    <div class="blocco" style="border:0;margin:0;padding:0">
      <h3>Tu: ${esc(S.nome)}</h3>
      <label class="interruttore"><span>Mostra la mia posizione alla squadra${S.modo === 'prova' ? ' (attivo solo con Firebase)' : ''}</span><input type="checkbox" id="swCondividi" ${S.condividi ? 'checked' : ''}></label>
      ${link ? `<button class="btn btn-piccolo" id="btnLink">Invia il link ai volontari</button>` : ''}
    </div>
    <div class="blocco">
      <h3>Sul percorso ora</h3>
      ${altri.length ? altri.map(v => `<div class="volontario"><span class="iniziali" style="background:${colore(v.uid)}">${esc(iniziali(v.nome))}</span><span style="flex:1"><b>${esc(v.nome)}</b><br><span class="dlg-nota">${fa(v.tl)}${S.me ? `, a ${fmtDist(dist([S.me.lat, S.me.lon], [v.lat, v.lon]))}` : ''}</span></span><button class="link" data-vol="${v.uid}">Mostra</button></div>`).join('') : `<p class="dlg-nota">${S.modo === 'prova' ? 'In modalità prova non si vedono gli altri volontari.' : 'Nessun altro volontario sta condividendo la posizione.'}</p>`}
    </div>
    <div class="blocco">
      <h3>Ultime azioni</h3>
      ${S.eventi.length ? `<ul class="storia">${S.eventi.slice(0, 40).map(rigaStoria).join('')}</ul>` : '<p class="dlg-nota">Ancora nessuna azione.</p>'}
    </div>`;
  el.querySelector('#swCondividi').addEventListener('change', e => {
    S.condividi = e.target.checked; LS.set('condividi', S.condividi ? '1' : '0');
    if (!S.condividi) S.store?.posizione(null); else if (S.me) S.store?.posizione(S.me);
  });
  el.querySelector('#btnLink')?.addEventListener('click', async () => {
    const testo = `Segnaletica SRM 2026: apri il link, inserisci il tuo nome e attiva la posizione. ${link}`;
    if (navigator.share) { try { await navigator.share({ title: 'Segnaletica SRM 2026', text: testo }); return; } catch {} }
    await navigator.clipboard?.writeText(testo); toast('Link copiato: incollalo nel gruppo WhatsApp');
  });
  el.querySelectorAll('[data-vol]').forEach(b => b.addEventListener('click', () => { const v = S.volontari.find(x => x.uid === b.dataset.vol); if (v) vola([v.lat, v.lon], 16); }));
  el.querySelectorAll('.storia img').forEach(i => i.addEventListener('click', () => window.open(i.src, '_blank')));
}

/* =========================================================== azioni */
async function azione(az, s) {
  switch (az) {
    case 'chiudi': S.sel = null; annullaSposta(); disegnaSegnali(); renderScheda(); break;
    case 'centra': vola([s.lat, s.lon], 18); if (mobile()) altezzaPannello('basso'); break;
    case 'copia': await navigator.clipboard?.writeText(`${fmtCoord(s.lat)}, ${fmtCoord(s.lon)}`); toast('Coordinate copiate'); break;
    case 'sposta': iniziaSposta(s); break;
    case 'annullaSposta': annullaSposta(); break;
    case 'salvaSposta': salvaSposta(s); break;
    case 'suggerimento': spostaA(s, s.suggerimento.lat, s.suggerimento.lon, 'sulla svolta della traccia'); break;
    case 'bivio': { const b = biviVicini(s.lat, s.lon)[0]; if (b) spostaA(s, b.lat, b.lon, 'sul bivio OpenStreetMap'); break; }
    case 'mettiQui': mettiQui(s); break;
    case 'verifica': conferma(s, 'verificato'); break;
    case 'posa': conferma(s, 'posato'); break;
    case 'rimuovi': conferma(s, 'rimosso'); break;
    case 'salvaNota': {
      const v = $('#nota').value.trim();
      await S.store.salva(s.id, { nota: v }, { azione: 'nota', note: v.slice(0, 120) }); toast('Nota salvata'); break;
    }
    case 'elimina':
      if (!confirm(`Eliminare ${N(s)}? Resta comunque nella storia delle azioni.`)) return;
      S.sel = null; await S.store.elimina(s.id, { azione: 'eliminato', note: `${N(s)} al km ${fmtKm(s.km)}` }); toast(`${N(s)} eliminato`); break;
  }
}

function iniziaSposta(s) {
  S.sposta = { id: s.id, lat: s.lat, lon: s.lon };
  const m = markers.get(s.id); m.dragging.enable(); m.setIcon(iconaSegnale(s));
  vola([s.lat, s.lon], 18);
  if (mobile()) altezzaPannello('basso');
  renderScheda();
}
function annullaSposta() {
  if (!S.sposta) return;
  const m = markers.get(S.sposta.id);
  if (m) { m.dragging.disable(); m.setLatLng([S.sposta.lat, S.sposta.lon]); }
  S.sposta = null; disegnaSegnali(); renderScheda();
}
function anteprimaSposta() {
  if (!S.sposta) return;
  const s = S.segnali.find(x => x.id === S.sposta.id); const m = markers.get(S.sposta.id); if (!s || !m) return;
  const p = m.getLatLng(); const pr = S.traccia.proietta(p.lat, p.lng, s.km - 1.5, s.km + 1.5);
  const mosso = dist([S.sposta.lat, S.sposta.lon], [p.lat, p.lng]);
  const info = $('#spostaInfo');
  if (info) info.innerHTML = `Spostato di <b>${fmtDist(mosso)}</b>. Nuovo punto al km ${fmtKm(pr.km)}, a ${Math.round(pr.d)} m dalla traccia${pr.d > 40 ? ': lontano dal percorso, controlla' : ''}.`;
}
async function salvaSposta(s) {
  const m = markers.get(s.id); const p = m.getLatLng();
  const da = { ...S.sposta }; m.dragging.disable(); S.sposta = null;
  await applicaPosizione(s, p.lat, p.lng, 'spostato', da);
}
async function spostaA(s, lat, lon, dove) {
  const da = { lat: s.lat, lon: s.lon };
  await applicaPosizione(s, lat, lon, 'spostato', da, dove);
  vola([lat, lon], 18);
}
async function applicaPosizione(s, lat, lon, tipo, da, dove = '', extra = {}, evExtra = {}) {
  const frecce = s.frecce.map(f => {
    const pr = S.traccia.proietta(lat, lon, f.km - 1.5, f.km + 1.5);
    return { ...f, km: Math.round(pr.km * 1000) / 1000 };
  });
  const km = Math.min(...frecce.map(f => f.km));
  const mosso = dist([da.lat, da.lon], [lat, lon]);
  await S.store.salva(s.id, { lat: +lat.toFixed(7), lon: +lon.toFixed(7), km, frecce, ...extra },
    { azione: tipo, note: `${Math.round(mosso)} m ${dove}`.trim(), lat, lon, ...evExtra });
  toast(`${N(s)} spostato di ${fmtDist(mosso)}`);
}

function mettiQui(s) {
  if (!S.me) { toast('Attendo il GPS: resta all\'aperto qualche secondo.'); return; }
  apriAzione(s, 'mettiQui');
}
function conferma(s, nuovo) { apriAzione(s, nuovo); }

let fotoCorrente = null;
const definiti = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
function apriAzione(s, tipo) {
  const d = $('#dlgAzione');
  fotoCorrente = null; $('#azioneAnteprima').hidden = true; $('#azioneFoto').value = ''; $('#azioneNota').value = '';
  const n = N(s);
  const titoli = { mettiQui: `Porta ${n} dove sei ora`, verificato: `Conferma la posizione di ${n}`, posato: `${n} posato`, rimosso: `${n} rimosso` };
  const ok = { mettiQui: 'Sposta qui', verificato: 'Conferma posizione', posato: 'Segna come posato', rimosso: 'Segna come rimosso' };
  $('#azioneTitolo').textContent = titoli[tipo]; $('#azioneOk').textContent = ok[tipo];
  let corpo = '';
  const gps = S.me ? `<div class="gps-stato ${S.me.acc > 25 ? 'debole' : ''}">Precisione GPS: <b>${Math.round(S.me.acc)} m</b>${S.me.acc > 25 ? '. È bassa: aspetta qualche secondo all\'aperto.' : ''}</div>` : '';
  const dQui = S.me ? dist([S.me.lat, S.me.lon], [s.lat, s.lon]) : null;
  if (tipo === 'mettiQui') corpo = `${gps}<p class="dlg-testo">Il segnale si sposta dalla posizione attuale (a ${fmtDist(dQui)}) a dove ti trovi.</p>`;
  if (tipo === 'verificato') corpo = `<p class="dlg-testo">Confermi che il paletto va esattamente qui e che le frecce sono nel senso giusto? Una foto del bivio aiuta chi lo pianterà.</p>`;
  if (tipo === 'posato') corpo = `${gps}${dQui != null && dQui > 25 ? `<label class="opzione"><input type="checkbox" id="azioneAggiorna" ${S.me.acc <= 25 ? 'checked' : ''}> Sei a ${fmtDist(dQui)} dal punto segnato: aggiorna la posizione con il mio GPS</label>` : ''}<p class="dlg-testo">Paletto piantato senza danneggiare alberi, rocce o manufatti. Scatta una foto: serve per il rendiconto al Parco.</p>`;
  if (tipo === 'rimosso') corpo = `<p class="dlg-testo">Paletto e freccia tolti, nessun residuo sul posto. Una foto del punto ripulito serve per la restituzione della cauzione.</p>`;
  $('#azioneCorpo').innerHTML = corpo;
  $('#azioneFotoRiga').hidden = tipo === 'mettiQui';
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    const nota = $('#azioneNota').value.trim();
    const ev = definiti({ note: nota, foto: fotoCorrente, lat: S.me?.lat, lon: S.me?.lon, acc: S.me ? Math.round(S.me.acc) : null });
    if (tipo === 'mettiQui') { await applicaPosizione(s, S.me.lat, S.me.lon, 'messo_qui', { lat: s.lat, lon: s.lon }, nota ? '. ' + nota : '', {}, definiti({ acc: Math.round(S.me.acc) })); return; }
    const patch = { stato: tipo };
    const ora = Date.now();
    if (tipo === 'verificato') Object.assign(patch, { verificatoDa: S.nome, verificatoIl: ora, frecce: s.frecce.map(f => ({ ...f, origine: f.origine === 'proposta' ? 'confermata' : f.origine })) });
    if (tipo === 'posato') Object.assign(patch, { posatoDa: S.nome, posatoIl: ora, fotoPosa: fotoCorrente || s.fotoPosa || null });
    if (tipo === 'rimosso') Object.assign(patch, { rimossoDa: S.nome, rimossoIl: ora, fotoRimozione: fotoCorrente || null });
    if (tipo === 'posato' && $('#azioneAggiorna')?.checked && S.me) {
      const { note, ...resto } = ev;
      await applicaPosizione(s, S.me.lat, S.me.lon, 'posato', { lat: s.lat, lon: s.lon }, `spostato e posato${note ? '. ' + note : ''}`, patch, resto);
    } else {
      await S.store.salva(s.id, patch, { azione: tipo, ...ev });
    }
    toast(`${N(s)}: ${STATI[tipo].label.toLowerCase()}`);
  };
}
$('#azioneFoto')?.addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return;
  try { fotoCorrente = await riduciFoto(f); const im = $('#azioneAnteprima'); im.src = fotoCorrente; im.hidden = false; }
  catch { toast('Foto non leggibile'); }
});
async function riduciFoto(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let q = .62, url = c.toDataURL('image/jpeg', q);
  while (url.length > 260000 && q > .3) { q -= .08; url = c.toDataURL('image/jpeg', q); }
  return url;
}

async function cambiaDir(s, i, d) {
  const frecce = s.frecce.map((f, j) => j == i ? { ...f, dir: d } : f);
  await S.store.salva(s.id, { frecce }, { azione: 'freccia', note: `${s.frecce[i].codice}: ${DIR_LABEL[d]}` });
}
async function correggiStato(s, nuovo) {
  if (nuovo === s.stato) return;
  await S.store.salva(s.id, { stato: nuovo }, { azione: 'stato', note: `${STATI[s.stato].label} → ${STATI[nuovo].label}` });
  toast(`${N(s)}: ${STATI[nuovo].label.toLowerCase()}`);
}

/* =========================================================== nuovo segnale */
const numero = x => parseInt(String(x).replace(/\D/g, ''), 10) || 0;
function prossimoNum() {
  const n = Math.max(0, ...S.segnali.map(s => numero(N(s))), ...S.piano.segnali.map(s => numero(s.id)));
  return 'S' + String(n + 1).padStart(2, '0');
}
// identificativo interno libero: il numero stesso, oppure numero + suffisso se già usato da un paletto rinumerato
function docLibero(num) {
  const usati = new Set(S.segnali.map(s => s.id));
  return usati.has(num) ? `${num}-${Date.now().toString(36)}` : num;
}
function apriNuovo() {
  const d = $('#dlgNuovo'); const id = prossimoNum();
  $('#nuovoId').textContent = id;
  $('#mirino').hidden = false;
  const aggiornaInfo = () => {
    const dove = d.querySelector('[name=dove]:checked').value;
    const p = dove === 'gps' && S.me ? [S.me.lat, S.me.lon] : [map.getCenter().lat, map.getCenter().lng];
    const pr = S.traccia.proietta(p[0], p[1]);
    const comune = S.traccia.comune.length > 1 && pr.d < 60 && (S.traccia.nelTrattoComune(pr.km));
    $('#nuovoRitorno').hidden = !comune;
    $('#legendaDir1').textContent = comune ? 'Freccia per l\'andata' : 'Freccia per chi arriva';
    $('#nuovoInfo').textContent = (dove === 'gps' && !S.me) ? 'GPS non ancora disponibile: verrà usato il centro della mappa.' : `Punto al km ${fmtKm(pr.km)}, a ${Math.round(pr.d)} m dalla traccia.`;
    return { p, pr, comune };
  };
  d.querySelectorAll('[name=dove]').forEach(r => r.onchange = aggiornaInfo);
  d.querySelectorAll('.scelta-dir').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }));
  aggiornaInfo();
  d.showModal();
  d.onclose = async () => {
    $('#mirino').hidden = true;
    if (d.returnValue !== 'ok') return;
    const { p, pr, comune } = aggiornaInfo();
    const dir1 = d.querySelector('[data-nome=dir1] .on')?.dataset.v || 'dx';
    const dir2 = d.querySelector('[data-nome=dir2] .on')?.dataset.v || 'no';
    const frecce = [];
    if (comune && dir2 !== 'no') {
      // trova il secondo passaggio sullo stesso punto
      const [a, b] = S.traccia.comune;
      const altro = pr.km <= a[1] + 0.05 ? S.traccia.proietta(p[0], p[1], b[0] - 0.05, b[1]) : S.traccia.proietta(p[0], p[1], a[0], a[1] + 0.05);
      const kmA = Math.min(pr.km, altro.km), kmR = Math.max(pr.km, altro.km);
      frecce.push({ codice: id + '-A', verso: 'andata', km: +kmA.toFixed(3), dir: dir1, origine: 'campo' });
      frecce.push({ codice: id + '-R', verso: 'ritorno', km: +kmR.toFixed(3), dir: dir2, origine: 'campo' });
    } else frecce.push({ codice: id, verso: 'unico', km: +pr.km.toFixed(3), dir: dir1, origine: 'campo' });
    const seg = { id: docLibero(id), num: id, lat: +p[0].toFixed(7), lon: +p[1].toFixed(7), ele: Math.round(S.traccia.at(pr.km)[2]), km: Math.min(...frecce.map(f => f.km)), frecce, doppio: frecce.length > 1, suggerimento: null, stato: 'da_verificare', origine: 'campo' };
    await S.store.crea(seg, { azione: 'creato', note: `km ${fmtKm(seg.km)}`, lat: seg.lat, lon: seg.lon });
    toast(`${id} aggiunto`); seleziona(seg.id);
  };
}

/* =========================================================== rinumerazione */
function pianoRinumerazione() {
  return [...S.segnali].sort((a, b) => a.km - b.km)
    .map((s, i) => ({ s, vecchio: N(s), nuovo: 'S' + String(i + 1).padStart(2, '0') }));
}
const codiciFrecce = (s, num) => s.frecce.map(f => ({ ...f, codice: num + (f.verso === 'andata' ? '-A' : f.verso === 'ritorno' ? '-R' : '') }));
function apriRinumera() {
  const d = $('#dlgRinumera');
  const cambi = pianoRinumerazione().filter(x => x.vecchio !== x.nuovo);
  const posati = cambi.filter(x => x.s.stato === 'posato' || x.s.stato === 'rimosso');
  $('#rinumeraCorpo').innerHTML = cambi.length
    ? `<p class="dlg-testo">I paletti prendono i numeri in ordine di chilometro. Cambiano ${cambi.length} numeri, con i codici delle loro frecce; la storia di ogni paletto resta collegata.</p>
       ${posati.length ? `<p class="gps-stato debole">Attenzione: ${posati.map(x => x.vecchio).join(', ')} ${posati.length > 1 ? 'risultano già posati' : 'risulta già posato'}. Il numero scritto sul paletto non corrisponderà più.</p>` : ''}
       <ul class="storia">${cambi.map(x => `<li><time>km ${fmtKm(x.s.km)}</time><span><b>${esc(x.vecchio)}</b> diventa <b>${esc(x.nuovo)}</b></span></li>`).join('')}</ul>`
    : '<p class="dlg-testo">I paletti sono già numerati in ordine di chilometro.</p>';
  $('#rinumeraOk').hidden = !cambi.length;
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== 'ok' || !cambi.length) return;
    await S.store.salvaMolti(cambi.map(x => ({ id: x.s.id, patch: { num: x.nuovo, frecce: codiciFrecce(x.s, x.nuovo) } })),
      { azione: 'rinumerati', note: cambi.map(x => `${x.vecchio}→${x.nuovo}`).join(', ') });
    toast(`${cambi.length} paletti rinumerati`);
  };
}

/* =========================================================== livelli, OSM, offline */
function apriLivelli() {
  const d = $('#dlgLivelli');
  const base = LS.get('base', 'satellite');
  d.querySelectorAll('[name=base]').forEach(r => { r.checked = r.value === base; r.onchange = () => {
    Object.values(layers.base).forEach(l => l.remove()); layers.base[r.value].addTo(map); layers.base[r.value].bringToBack(); LS.set('base', r.value); }; });
  d.querySelectorAll('[name=ov]').forEach(c => {
    const lay = { cai: layers.cai, osm: layers.bivi, svolte: layers.svolte, poi: layers.poi, squadra: layers.squadra }[c.value];
    c.checked = map.hasLayer(lay);
    c.onchange = () => {
      LS.set('ov:' + c.value, c.checked ? '1' : '0');
      if (c.checked) { lay.addTo(map); if (c.value === 'osm' && !S.bivi.length) caricaBivi(); } else lay.remove();
    };
  });
  d.showModal();
}

// Sentieri e bivi da OpenStreetMap: più server con tempo massimo, poi i dati restano sul telefono (anche senza campo)
const OSM_CACHE = 'srmseg-osm', OSM_CHIAVE = './osm-sentieri-v1.json';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function datiOSM() {
  try { const hit = await (await caches.open(OSM_CACHE)).match(OSM_CHIAVE); if (hit) return await hit.json(); } catch {}
  const b = L.latLngBounds(S.traccia.latlngs()).pad(0.08);
  const q = `[out:json][timeout:40];way["highway"~"^(path|track|footway|bridleway|steps|unclassified|service|residential|tertiary|secondary|cycleway|living_street|pedestrian)$"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});out geom;`;
  toast('Scarico sentieri e bivi da OpenStreetMap…', 6000);
  for (const url of OVERPASS) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal });
      if (!r.ok) continue;
      const grezzi = await r.json();
      const uso = new Map(), pos = new Map(), vie = [];
      for (const w of grezzi.elements || []) {
        if (!w.geometry) continue;
        vie.push({ s: w.tags?.highway === 'path' ? 1 : 0, p: w.geometry.map(g => [+g.lat.toFixed(5), +g.lon.toFixed(5)]) });
        w.nodes?.forEach((n, i) => { uso.set(n, (uso.get(n) || 0) + 1); pos.set(n, w.geometry[i]); });
      }
      const bivi = [];
      for (const [n, c] of uso) {
        if (c < 2) continue;
        const g = pos.get(n); const pr = S.traccia.proietta(g.lat, g.lon);
        if (pr.d <= 25) bivi.push({ lat: +g.lat.toFixed(6), lon: +g.lon.toFixed(6), km: +pr.km.toFixed(3) });
      }
      const dati = { vie, bivi, scaricato: Date.now() };
      try { await (await caches.open(OSM_CACHE)).put(OSM_CHIAVE, new Response(JSON.stringify(dati), { headers: { 'Content-Type': 'application/json' } })); } catch {}
      return dati;
    } catch { /* server lento o non raggiungibile: si prova il successivo */ }
    finally { clearTimeout(t); }
  }
  return null;
}
async function caricaBivi() {
  const dati = await datiOSM();
  if (!dati) { toast('OpenStreetMap non risponde: riprova tra qualche minuto.', 5000); return; }
  layers.bivi.clearLayers();
  for (const v of dati.vie) {
    L.polyline(v.p, { pane: 'bivi', color: '#9fd8ff', weight: 2.5, opacity: .9, dashArray: v.s ? '6 5' : null, interactive: false }).addTo(layers.bivi);
  }
  S.bivi = dati.bivi;
  for (const g of S.bivi) {
    L.marker([g.lat, g.lon], { pane: 'bivi', icon: L.divIcon({ className: 'mk-bivio', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div></div>' }) })
      .bindTooltip(`Bivio OSM, km ${fmtKm(g.km)}`, { className: 'tip' }).addTo(layers.bivi);
  }
  toast(`${S.bivi.length} bivi lungo la traccia`); renderScheda();
}
function biviVicini(lat, lon) { return S.bivi.map(b => ({ ...b, d: dist([lat, lon], [b.lat, b.lon]) })).sort((a, b) => a.d - b.d); }

function tilesPercorso(zmin = 12, zmax = 17, buffer = 160) {
  const set = new Set();
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
  for (let z = zmin; z <= zmax; z++) {
    for (let k = 0; k <= S.traccia.kmTot; k += 0.05) {
      const p = S.traccia.at(k);
      const dLat = buffer / 110540, dLon = buffer / (111320 * Math.cos(p[0] * Math.PI / 180));
      for (const la of [p[0] - dLat, p[0], p[0] + dLat]) for (const lo of [p[1] - dLon, p[1], p[1] + dLon]) set.add(`${z}/${lat2y(la, z)}/${lon2x(lo, z)}`);
    }
  }
  return [...set].map(t => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t}`);
}
async function scaricaOffline() {
  if (!('caches' in window)) { toast('Questo browser non può salvare la mappa.'); return; }
  const urls = tilesPercorso();
  if (!confirm(`Scarico circa ${urls.length} immagini (${Math.round(urls.length * 0.03)} MB). Meglio con il Wi‑Fi. Procedo?`)) return;
  const cache = await caches.open('srmseg-tiles');
  const prog = $('#offlineProg'); prog.hidden = false; prog.max = urls.length; prog.value = 0;
  let i = 0, err = 0;
  const lavora = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'no-cors' }); await cache.put(u, r); } } catch { err++; }
      prog.value++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, lavora));
  $('#offlineTesto').textContent = `Mappa satellitare del percorso salvata su questo telefono${err ? ` (${err} immagini non scaricate)` : ''}.`;
  toast('Mappa senza campo pronta');
}

/* =========================================================== esportazioni */
function scarica(nome, testo, tipo) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([testo], { type: tipo })); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function esportaGpx() {
  const w = S.segnali.map(s => `<wpt lat="${s.lat}" lon="${s.lon}"><ele>${Math.round(S.traccia.at(s.km)[2])}</ele><name>${esc(N(s))}</name><desc>${s.frecce.map(f => `${f.codice} ${DIR_LABEL[f.dir]} km ${fmtKm(f.km)}`).join('; ')}. ${STATI[s.stato].label}${s.nota ? '. ' + esc(s.nota) : ''}</desc><sym>Flag, Red</sym></wpt>`).join('\n');
  scarica('segnali-srm2026.gpx', `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Segnaletica SRM 2026" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>Segnaletica SRM 2026</name></metadata>\n${w}\n</gpx>`, 'application/gpx+xml');
}
function esportaCsv() {
  const r = [['Paletto', 'Frecce', 'km', 'Lat', 'Lon', 'Quota', 'Sentiero', 'Stato', 'Confermato da', 'Confermato il', 'Posato da', 'Posato il', 'Rimosso da', 'Rimosso il', 'Nota']];
  const dt = t => t ? new Date(t).toLocaleString('it-IT') : '';
  S.segnali.forEach(s => r.push([N(s), s.frecce.map(f => `${f.codice} ${f.dir}`).join(' / '), fmtKm(s.km), s.lat, s.lon, Math.round(S.traccia.at(s.km)[2]), S.traccia.sentiero(s.km), STATI[s.stato].label, s.verificatoDa || '', dt(s.verificatoIl), s.posatoDa || '', dt(s.posatoIl), s.rimossoDa || '', dt(s.rimossoIl), s.nota || '']));
  scarica('inventario-segnali-srm2026.csv', '﻿' + r.map(x => x.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
}

let tt;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('vis'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('vis'), ms); }

avvia().catch(e => { console.error(e); toast('Errore di avvio: ' + e.message, 8000); });
