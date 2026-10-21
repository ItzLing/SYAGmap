import * as maplibregl from 'maplibre-gl';
import type { LngLat } from '../types';

export function pinEl(label: string, bg: string, size = 28, ring = false): HTMLElement {
  const el = document.createElement('div');
  el.textContent = label;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;font:700 12px system-ui;`
    + `display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);`
    + (ring ? `outline:3px solid ${bg}55;` : '');
  return el;
}

/** A simple managed set of DOM markers that is cleared and refilled together. */
export class MarkerSet {
  private list: maplibregl.Marker[] = [];

  constructor(private map: maplibregl.Map) {}

  add(pos: LngLat, el: HTMLElement, opts: { draggable?: boolean; onDragEnd?: (p: LngLat) => void } = {}) {
    const m = new maplibregl.Marker({ element: el, draggable: !!opts.draggable }).setLngLat(pos).addTo(this.map);
    if (opts.onDragEnd) m.on('dragend', () => opts.onDragEnd!([m.getLngLat().lng, m.getLngLat().lat]));
    this.list.push(m);
    return m;
  }

  clear() {
    this.list.forEach((m) => m.remove());
    this.list = [];
  }
}
