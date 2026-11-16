import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDirectory, searchStations, stationLocation } from '../data/queries';
import { GROUP_TYPE_LABEL } from '../data/types';
import { Highlight } from './common';

/** Ctrl+K / Cmd+K: jump to any station or group. */
export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const dir = useDirectory();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);

  const items = useMemo(() => {
    if (!dir || !q.trim()) return [];
    const stations = searchStations(dir.stations, q, 12).map(({ station: s }) => ({
      key: s.id, kind: 'Station', title: s.call, sub: [s.name, stationLocation(s)].filter(Boolean).join(' · '), to: `/stations/${s.call}`, isCall: true,
    }));
    const lq = q.trim().toLowerCase();
    const groups = dir.groups.filter((g) => g.name.toLowerCase().includes(lq)).slice(0, 6).map((g) => ({
      key: g.id, kind: 'Group', title: g.name, sub: GROUP_TYPE_LABEL[g.type], to: `/groups/${g.id}`, isCall: false,
    }));
    return [...stations, ...groups];
  }, [dir, q]);

  useEffect(() => { setAct(0); }, [q]);
  const go = (i: number) => { const it = items[i]; if (it) { nav(it.to); onClose(); } };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal palette" role="dialog" aria-label="Search">
        <input autoFocus placeholder="Search call sign (prefix or suffix), name, city, or group…" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(act); }
          }} />
        <div className="palette-list">
          {items.map((it, i) => (
            <div key={it.key} className={'palette-item' + (i === act ? ' act' : '')} onMouseEnter={() => setAct(i)} onClick={() => go(i)}>
              <span className="kind">{it.kind}</span>
              <span className={it.isCall ? 'call' : ''}><Highlight text={it.title} q={it.isCall ? q.toUpperCase().replace(/[^A-Z0-9]/g, '') : q} /></span>
              <span className="muted">{it.sub}</span>
            </div>
          ))}
          {q.trim() && !items.length && <div className="empty">No match.</div>}
          {!q.trim() && <div className="empty"><kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</div>}
        </div>
      </div>
    </div>
  );
}
