'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { UserRole } from '@hl/shared';
import type { ListingSummary } from '@hl/shared';

interface MapViewProps {
  listings: ListingSummary[];
  center: { latitude: number; longitude: number };
  onMarkerClick?: (listing: ListingSummary) => void;
  pickerPin?: { latitude: number; longitude: number; onMove: (lat: number, lng: number) => void };
}

export function MapView({ listings, center, onMarkerClick, pickerPin }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const pickerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      // eslint-disable-next-line no-console
      console.error('NEXT_PUBLIC_MAPBOX_TOKEN is not set — map will not render.');
      return;
    }
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = token;
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [center.longitude, center.latitude],
      zoom: 13,
    });
    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.flyTo({ center: [center.longitude, center.latitude], essential: true });
  }, [center.latitude, center.longitude]);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());

    markersRef.current = listings.map((listing) => {
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
      el.style.backgroundColor = listing.authorRole === UserRole.PROVIDER ? '#F2A93B' : '#3FA796';
      el.style.cursor = 'pointer';
      el.setAttribute('role', 'button');
      el.setAttribute(
        'aria-label',
        `${listing.category}, AED ${listing.payAmountAed}, ${listing.locationLabel}`,
      );

      const popup = new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<div style="font-family:Inter,sans-serif;min-width:180px">
           <div style="font-weight:600;font-size:13px;color:#14213D">${escapeHtml(listing.category)}</div>
           <div style="font-size:12px;color:#333B4A;margin-top:2px">AED ${listing.payAmountAed} · ${escapeHtml(listing.locationLabel)}</div>
         </div>`,
      );

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([listing.longitude, listing.latitude])
        .setPopup(popup)
        .addTo(mapRef.current!);

      el.addEventListener('click', () => onMarkerClick?.(listing));
      return marker;
    });
  }, [listings, onMarkerClick]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!pickerPin) {
      pickerRef.current?.remove();
      pickerRef.current = null;
      return;
    }

    if (!pickerRef.current) {
      pickerRef.current = new mapboxgl.Marker({ color: '#14213D', draggable: true })
        .setLngLat([pickerPin.longitude, pickerPin.latitude])
        .addTo(mapRef.current);

      pickerRef.current.on('dragend', () => {
        const lngLat = pickerRef.current!.getLngLat();
        pickerPin.onMove(lngLat.lat, lngLat.lng);
      });
    } else {
      pickerRef.current.setLngLat([pickerPin.longitude, pickerPin.latitude]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerPin?.latitude, pickerPin?.longitude, Boolean(pickerPin)]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
