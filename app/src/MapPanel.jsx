import { useEffect, useRef } from 'react';
import L from './leafletGlobal.js';
import 'leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

const STYLE = { color: '#0072B2', weight: 2, fillOpacity: 0.0 };

export default function MapPanel({ selection, onSelect, overlay, density, describeCell }) {
  const drawing = useRef(false);
  const densRef = useRef(null);
  const descRef = useRef(describeCell);
  descRef.current = describeCell;
  const el = useRef(null);
  const map = useRef(null);
  const drawn = useRef(null);

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([23, 80], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    const fg = new L.FeatureGroup().addTo(m);
    const ctl = new L.Control.Draw({
      position: 'topright',
      draw: {
        rectangle: { shapeOptions: STYLE, showArea: false },
        polygon: { shapeOptions: STYLE, allowIntersection: false, showArea: false },
        polyline: false, circle: false, marker: false, circlemarker: false,
      },
      edit: false,
    });
    m.addControl(ctl);
    m.on(L.Draw.Event.DRAWSTART, () => { drawing.current = true; });
    m.on(L.Draw.Event.DRAWSTOP, () => { setTimeout(() => { drawing.current = false; }, 50); });
    // Tap a density cell → its numbers
    m.on('click', (e) => {
      const d = densRef.current;
      if (drawing.current || !d) return;
      const key = `${Math.floor(e.latlng.lat * 10)}_${Math.floor(e.latlng.lng * 10)}`;
      const c = d.lookup.get(key);
      if (!c) return;
      L.popup({ maxWidth: 260 }).setLatLng([c.lat, c.lon]).setContent(descRef.current ? descRef.current(c) : '').openOn(m);
    });
    m.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      if (e.layerType === 'rectangle') {
        const b = layer.getBounds();
        onSelect({ type: 'rect', name: 'Drawn rectangle', bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]] });
      } else {
        const ll = layer.getLatLngs()[0].map((p) => [p.lat, p.lng]);
        onSelect({ type: 'poly', name: 'Drawn polygon', latlngs: ll });
      }
    });
    map.current = m;
    drawn.current = fg;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cells outside the data domain (contract v1.1 domain.json) are greyed out.
  useEffect(() => {
    if (!map.current || !overlay) return;
    const o = L.imageOverlay(overlay.url, overlay.bounds, { interactive: false, className: 'domain-ov', alt: 'Areas without data shaded grey' }).addTo(map.current);
    return () => o.remove();
  }, [overlay]);

  // Fire-density / anomaly raster inside the selection
  useEffect(() => {
    densRef.current = density;
    if (!map.current || !density) return;
    const o = L.imageOverlay(density.url, density.bounds, { interactive: false, className: 'domain-ov', alt: 'Fire density map of the selected area' }).addTo(map.current);
    return () => { o.remove(); map.current?.closePopup(); };
  }, [density]);

  useEffect(() => {
    const fg = drawn.current;
    if (!fg) return;
    fg.clearLayers();
    if (!selection) return;
    const layer = selection.type === 'rect' ? L.rectangle(selection.bounds, STYLE) : L.polygon(selection.latlngs, STYLE);
    fg.addLayer(layer);
    map.current.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 7 });
  }, [selection]);

  return <div ref={el} className="map" role="application" aria-label="Map: draw a rectangle or polygon to select an area" />;
}
