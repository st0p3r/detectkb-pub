import { createElement, useEffect, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BookOpen,
  Cpu,
  Crosshair,
  Database,
  FileText,
  Folder,
  HardDrive,
  Hash,
  Lightbulb,
  Plus,
  Shield,
  TerminalSquare,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

// Same icons as the sidebar, so a node's type is recognisable at a glance
const GROUP_ICONS: Record<string, LucideIcon> = {
  RULE: Shield,
  NOTE: FileText,
  CONCEPT: Lightbulb,
  DATA_SOURCE: Database,
  SPL_COMMAND: Terminal,
  technique: Crosshair,
  sysmon: Cpu,
  lolbas: Terminal,
  gtfobins: TerminalSquare,
  loldrivers: HardDrive,
  tag: Hash,
  category: Folder,
  more: Plus,
};
const FALLBACK = BookOpen;

export const iconFor = (group: string): LucideIcon => GROUP_ICONS[group] ?? FALLBACK;

function toImage(icon: LucideIcon, color: string): Promise<HTMLImageElement> {
  const svg = renderToStaticMarkup(createElement(icon, { color, size: 48, strokeWidth: 2 }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Rasterised icons keyed by `${group}|${color}`; null until all are loaded. */
export function useNodeIcons(requests: { group: string; color: string }[]) {
  const [icons, setIcons] = useState<Map<string, HTMLImageElement> | null>(null);
  const key = Array.from(new Set(requests.map((r) => `${r.group}|${r.color}`))).sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const wanted = key ? key.split(',') : [];
    Promise.all(
      wanted.map(async (k) => {
        const [group, color] = k.split('|');
        return [k, await toImage(iconFor(group), color)] as const;
      })
    ).then((entries) => {
      if (!cancelled) setIcons(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return icons;
}
