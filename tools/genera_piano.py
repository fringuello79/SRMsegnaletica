import xml.etree.ElementTree as ET, math, json
ns={'g':'http://www.topografix.com/GPX/1/1'}
import os
BASE=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
t=ET.parse(os.path.join(BASE,'data','traccia-srm2026.gpx'))
pts=[(float(p.get('lat')),float(p.get('lon')),float(p.find('g:ele',ns).text)) for p in t.findall('.//g:trkpt',ns)]
R=6371000
def hav(a,b):
    la1,lo1=map(math.radians,a[:2]); la2,lo2=map(math.radians,b[:2])
    d=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(d))
def brg(a,b):
    la1,lo1=map(math.radians,a[:2]); la2,lo2=map(math.radians,b[:2])
    y=math.sin(lo2-lo1)*math.cos(la2); x=math.cos(la1)*math.sin(la2)-math.sin(la1)*math.cos(la2)*math.cos(lo2-lo1)
    return (math.degrees(math.atan2(y,x))+360)%360
cum=[0]
for i in range(1,len(pts)): cum.append(cum[-1]+hav(pts[i-1],pts[i]))
TOT=cum[-1]
def at(d):
    d=max(0,min(TOT,d))
    for i in range(1,len(cum)):
        if cum[i]>=d:
            f=(d-cum[i-1])/(cum[i]-cum[i-1]) if cum[i]>cum[i-1] else 0
            a,b=pts[i-1],pts[i]
            return (a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1]),a[2]+f*(b[2]-a[2]))
    return pts[-1]
def turn_at(d,w=40):
    bi=brg(at(d-w),at(d)); bo=brg(at(d),at(d+w)); return ((bo-bi+540)%360)-180
def nearest_km(lat,lon,lo_km,hi_km):
    best=(1e9,0)
    d=lo_km*1000
    while d<=hi_km*1000:
        p=at(d); dd=hav(p,(lat,lon))
        if dd<best[0]: best=(dd,d)
        d+=5
    return best[1]/1000,best[0]
SENT=[(0,8.2,'E1'),(8.2,10,'3'),(10,14.5,'3B'),(14.5,17,'3'),(17,18.5,'1'),(18.5,24.3,'7'),(24.3,29.71,'E1')]
CAMBI=[(8.2,'E1 → 3'),(10,'3 → 3B'),(14.5,'3B → 3'),(17,'3 → 1'),(18.5,'1 → 7'),(24.3,'7 → E1')]
def sentiero(km):
    for a,b,s in SENT:
        if a<=km<b: return s
    return 'E1'
def analisi(km,dirz):
    peaks=[]
    for off in range(-200,201,10):
        tt=turn_at(km*1000+off)
        if abs(tt)>=40: peaks.append((abs(tt),off,tt))
    peaks.sort(reverse=True); sel=[]
    for p in peaks:
        if all(abs(p[1]-q[1])>60 for q in sel): sel.append(p)
    want=-1 if dirz=='sx' else 1
    same=[p for p in sel if (p[2]>0)==(want>0)]
    opp=[p for p in sel if (p[2]>0)!=(want>0)]
    cambio=[c for c in CAMBI if abs(c[0]-km)<=0.35]
    cambio_txt=(' Cambio sentiero %s previsto al km %s.'%(cambio[0][1],str(cambio[0][0]).replace('.',','))) if cambio else ''
    if same:
        p=min(same,key=lambda q:abs(q[1]))
        ang=round(abs(p[2]))
        if abs(p[1])<=30:
            return dict(esito='coerente',testo=f"La traccia svolta a {'sinistra' if want<0 else 'destra'} di circa {ang}° proprio qui.{cambio_txt}"),None
        kmS=km+p[1]/1000; q=at(kmS*1000)
        sug=dict(km=round(kmS,3),lat=round(q[0],6),lon=round(q[1],6),dist=abs(p[1]),ang=ang)
        return dict(esito='spostare',testo=f"La svolta a {'sinistra' if want<0 else 'destra'} ({ang}°) della traccia è {abs(p[1])} m {'più avanti' if p[1]>0 else 'più indietro'}, al km {kmS:.2f}".replace('.',',',1)+'.'+cambio_txt),sug
    if opp:
        p=min(opp,key=lambda q:abs(q[1]))
        return dict(esito='opposto',testo=f"Entro 200 m la traccia svolta solo a {'destra' if want<0 else 'sinistra'} ({round(abs(p[2]))}°, {abs(p[1])} m {'più avanti' if p[1]>0 else 'più indietro'}): verificare il senso della freccia.{cambio_txt}"),None
    return dict(esito='dritto',testo="La traccia prosegue quasi dritta: il bivio va individuato sul posto (o sui sentieri OSM in mappa)."+cambio_txt),None

def opp(d): return 'dx' if d=='sx' else 'sx'
# Paletti: (km posizione di riferimento, frecce)
P=[]
# S01: tuo km 1 sx + ritorno proposto
la,lo,_=at(1000); kR,dR=nearest_km(la,lo,27.0,29.71)
P.append(dict(ref=1.0,frecce=[dict(verso='andata',km=1.0,dir='sx',origine='ale',ex='km 1 sx'),dict(verso='ritorno',km=round(kR,2),dir='dx',origine='proposta',ex=None)]))
# S02: tuo km 28 sx (ritorno) + andata proposta
la,lo,_=at(28000); kA,dA=nearest_km(la,lo,0,3.0)
P.append(dict(ref=28.0,frecce=[dict(verso='andata',km=round(kA,2),dir='dx',origine='proposta',ex=None),dict(verso='ritorno',km=28.0,dir='sx',origine='ale',ex='km 28 sx')]))
# S03: tuo km 2.6 sx + tuo km 27 sx (ritorno, stesso bivio)
la,lo,_=at(2600); kR3,dR3=nearest_km(la,lo,26.8,27.5)
P.append(dict(ref=2.6,frecce=[dict(verso='andata',km=2.6,dir='sx',origine='ale',ex='km 2,6 sx'),dict(verso='ritorno',km=round(kR3,2),dir='sx',origine='ale',ex='km 27 sx',nota_ex='Il tuo «km 27 sx» cade 130 m prima di questo bivio, dove il ritorno rientra nel tratto comune: è lo stesso paletto del km 2,6.')]))
for km,d in [(3.3,'sx'),(4,'sx'),(5.8,'sx'),(6.7,'sx'),(8,'dx'),(14.2,'dx'),(15.3,'dx'),(18.5,'sx'),(21,'sx'),(24.2,'dx'),(26,'dx')]:
    P.append(dict(ref=km,frecce=[dict(verso='unico',km=km,dir=d,origine='ale',ex=f"km {str(km).replace('.',',')} {d}")]))
# ordina per primo passaggio
def first_km(p): return min(f['km'] for f in p['frecce'])
P.sort(key=first_km)
out=[]
for i,p in enumerate(P,1):
    sid=f"S{i:02d}"
    la,lo,el=at(p['ref']*1000)
    frecce=[]
    sug_main=None
    for f in p['frecce']:
        code=sid+({'andata':'-A','ritorno':'-R','unico':''}[f['verso']])
        an,sug=analisi(f['km'],f['dir'])
        if f.get('nota_ex'): an['testo']=f['nota_ex']+' '+an['testo']
        if f['origine']=='proposta':
            an['testo']='Freccia PROPOSTA: il paletto è nel tratto percorso due volte, quindi serve anche la freccia per l\'altro senso. '+an['testo']
        fr=dict(codice=code,verso=f['verso'],km=f['km'],dir=f['dir'],origine=f['origine'],ex=f['ex'],sentiero=sentiero(f['km']),bearing=round(brg(at(f['km']*1000-30),at(f['km']*1000+60))),analisi=an)
        frecce.append(fr)
        if sug and f['origine']=='ale' and sug_main is None: sug_main=dict(sug,freccia=code)
    out.append(dict(id=sid,lat=round(la,6),lon=round(lo,6),ele=round(el),km=round(first_km(p),2),frecce=frecce,doppio=len(frecce)>1,suggerimento=sug_main,stato='da_verificare',origine='piano'))
for s in out:
    print(s['id'],s['km'],[(f['codice'],f['km'],f['dir'],f['origine'],f['analisi']['esito']) for f in s['frecce']], 'SUG' if s['suggerimento'] else '')
meta=dict(gara='Skyrace del Maglio 2026',data_gara='2026-10-18',partenza='09:00',fine='2026-10-18T16:00:00+02:00',scadenza_rimozione='2026-10-21T16:00:00+02:00',km_tot=round(TOT/1000,2),generato='2026-10-01',fonte='Traccia ufficiale skyrace-del-maglio-2026.gpx')
json.dump(dict(meta=meta,segnali=out),open(os.path.join(BASE,'data','segnali.json'),'w'),ensure_ascii=False,indent=1)
# traccia
tr=[[round(a,6),round(b,6),round(c),round(k/1000,3)] for (a,b,c),k in zip(pts,cum)]
json.dump(dict(km_tot=round(TOT/1000,3),comune=[[0,2.6],[27.12,29.71]],sentieri=[dict(da=a,a=b,nome=s) for a,b,s in SENT],pts=tr),open(os.path.join(BASE,'data','traccia.json'),'w'),separators=(',',':'))
def poi(km,nome,tipo,desc):
    a,b,c=at(km*1000); return dict(km=km,nome=nome,tipo=tipo,desc=desc,lat=round(a,6),lon=round(b,6),ele=round(c))
POI=[poi(0,'Partenza / Arrivo','start','Piazza della Repubblica, Magliano de\' Marsi — partenza ore 09:00, chiusura ore 16:00'),
     poi(8.2,'S. Maria in Valle Porclaneta','acqua','Punto acqua e sali, prelievo bastoncini'),
     poi(10,'Passo Le Forche','cancello','Cancello orario 1h45 (ore 10:45) — ponte radio Protezione Civile'),
     poi(15,'Rifugio Capanna di Sevice','ristoro','Ristoro completo — cancello orario 3h45 (ore 12:45)'),
     poi(18.3,'Riserva idrica di emergenza','riserva','Alle spalle del Monte Cafornia — scorta limitata, non è un punto di rifornimento. Quota massima 2.385 m'),
     poi(24.3,'Fonte Canale','acqua','Punto acqua — fontanile (posizione da verificare sul posto)')]
json.dump(POI,open(os.path.join(BASE,'data','poi.json'),'w'),ensure_ascii=False,indent=1)
# GPX waypoint export
g=['<?xml version="1.0" encoding="UTF-8"?>','<gpx version="1.1" creator="SRM Segnaletica" xmlns="http://www.topografix.com/GPX/1/1">','<metadata><name>SRM 2026 — segnaletica (piano, da verificare)</name></metadata>']
for s in out:
    d=' / '.join(f"{f['codice']} {f['dir'].upper()} km {f['km']}" for f in s['frecce'])
    g.append(f'<wpt lat="{s["lat"]}" lon="{s["lon"]}"><ele>{s["ele"]}</ele><name>{s["id"]}</name><desc>{d} — DA VERIFICARE</desc><sym>Flag, Red</sym></wpt>')
g.append('</gpx>')
open(os.path.join(BASE,'data','segnali-piano.gpx'),'w').write('\n'.join(g))
