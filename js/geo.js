// Utilità geografiche sulla traccia ufficiale SRM 2026
const R = 6371000;
const rad = d => d * Math.PI / 180;

export function dist(a, b) {
  const la1 = rad(a[0]), la2 = rad(b[0]);
  const dla = la2 - la1, dlo = rad(b[1] - a[1]);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const la1 = rad(a[0]), la2 = rad(b[0]), dlo = rad(b[1] - a[1]);
  const y = Math.sin(dlo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const PUNTI = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];
export const cardinale = b => PUNTI[Math.round(b / 45) % 8];

export class Traccia {
  constructor(data) {
    this.pts = data.pts;            // [lat, lon, ele, km]
    this.kmTot = data.km_tot;
    this.comune = data.comune || []; // tratti percorsi due volte [[a,b],[c,d]]
    this.sentieri = data.sentieri || [];
  }
  latlngs() { return this.pts.map(p => [p[0], p[1]]); }

  at(km) {
    const p = this.pts;
    km = Math.max(0, Math.min(this.kmTot, km));
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][3] < km) lo = m; else hi = m; }
    const a = p[lo], b = p[hi];
    const f = b[3] > a[3] ? (km - a[3]) / (b[3] - a[3]) : 0;
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
  }

  // direzione in cui va il corridore dopo il punto (gradi da nord)
  direzioneDopo(km, avanti = 0.06) { return bearing(this.at(km - 0.015), this.at(km + avanti)); }

  sentiero(km) {
    const s = this.sentieri.find(x => km >= x.da && km < x.a);
    return s ? s.nome : (this.sentieri.at(-1)?.nome || '');
  }

  // proiezione di un punto sulla traccia, cercando solo tra kmMin e kmMax
  proietta(lat, lon, kmMin = 0, kmMax = this.kmTot) {
    const p = this.pts, k = Math.cos(rad(lat)) ;
    const toXY = q => [(q[1] - lon) * k * 111320, (q[0] - lat) * 110540];
    let best = { d: Infinity, km: 0 };
    for (let i = 1; i < p.length; i++) {
      if (p[i][3] < kmMin || p[i - 1][3] > kmMax) continue;
      const A = toXY(p[i - 1]), B = toXY(p[i]);
      const vx = B[0] - A[0], vy = B[1] - A[1];
      const L2 = vx * vx + vy * vy;
      let t = L2 ? -(A[0] * vx + A[1] * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const x = A[0] + t * vx, y = A[1] + t * vy;
      const d = Math.hypot(x, y);
      if (d < best.d) best = { d, km: p[i - 1][3] + t * (p[i][3] - p[i - 1][3]) };
    }
    return best;
  }

  nelTrattoComune(km) { return this.comune.some(([a, b]) => km >= a - 0.02 && km <= b + 0.02); }
}

export const fmtKm = km => (Math.round(km * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: km % 1 ? 1 : 0, maximumFractionDigits: 2 });
export const fmtCoord = v => v.toFixed(6);
export function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
}
