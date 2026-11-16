import { useState } from 'react';
import { Modal, useToast } from '../ui/common';
import { RoleChips } from '../ui/forms';
import {
  applyImport, buildImportPlan, choiceKey, IMPORT_FIELD_LABEL, loadPlanContext, ROW_STATUS_LABEL,
  type ConflictChoices, type ImportPlan, type RowStatus,
} from '../data/importPlan';
import type { Group } from '../data/types';

const STATUS_CHIP: Record<RowStatus, string> = { new: 'green', add: 'blue', member: 'dim', invalid: 'red', duplicate: 'yellow' };
const FIELD_LABEL: Record<string, string> = { name: 'Name', onAirName: 'On-air', city: 'City', county: 'County', state: 'State', grid: 'Grid' };

export default function ImportModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [choices, setChoices] = useState<ConflictChoices>({});
  const [filter, setFilter] = useState<RowStatus | 'conflicts' | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const preview = async (src = text) => {
    setErr('');
    if (!src.trim()) { setErr('Choose a file or paste a list first.'); return; }
    const p = buildImportPlan(src, await loadPlanContext(group.id));
    if (!p.rows.length) { setErr('No rows found.'); return; }
    setPlan(p); setChoices({}); setFilter(p.counts.conflicts ? 'conflicts' : 'all');
  };

  const setAll = (v: 'keep' | 'file') => {
    if (!plan) return;
    const next: ConflictChoices = {};
    for (const r of plan.rows) for (const c of r.conflicts) next[choiceKey(r.line, c.field)] = v;
    setChoices(next);
  };

  const commit = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await applyImport(group.id, plan, choices);
      toast(`Import into ${group.name}: ${r.created} new, ${r.added} added, ${r.updated} updated, ${r.skipped} skipped`);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  if (!plan) {
    return (
      <Modal title={`Import into ${group.name}`} onClose={onClose} wide
        footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => preview()}>Preview</button></>}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Each row is matched to the station directory by call sign. Existing stations are added to this group, never duplicated.
            You will see every change before anything is saved.
          </p>
          <div>
            <label>CSV or text file</label>
            <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const t = await f.text(); setText(t); setFileName(f.name); preview(t);
            }} />
            {fileName && <div className="hint">{fileName}</div>}
          </div>
          <div>
            <label>Or paste</label>
            <textarea rows={8} value={text} placeholder={'Call Sign,First Name,Last Name,City,County,Spotter ID,Role\nW9ABC,Sam,Smith,Peoria,Peoria,S-12,Spotter\n\nor just one call sign per line'} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="hint">
            Recognized columns (any order, header names are flexible): {Object.values(IMPORT_FIELD_LABEL).join(', ')}.
            Without a header row, columns are read as call sign, name, city. Use <b>Sample CSV</b> on the group page for a ready-to-fill file.
          </div>
        </div>
      </Modal>
    );
  }

  const rows = plan.rows.filter((r) => filter === 'all' || (filter === 'conflicts' ? r.conflicts.length > 0 : r.status === filter));
  const writable = plan.counts.new + plan.counts.add + plan.counts.member;

  return (
    <Modal title={`Import into ${group.name}: Preview`} onClose={onClose} wide
      footer={<><span className="err spacer">{err}</span><button onClick={() => setPlan(null)}>Back</button><button className="primary" disabled={busy || !writable} onClick={commit}>Import {writable} row{writable === 1 ? '' : 's'}</button></>}>
      <div className="stack">
        <div className="muted">
          Columns read: {plan.columns.map((c) => `${c.header} → ${IMPORT_FIELD_LABEL[c.field]}`).join(' · ')}
        </div>
        <div className="row between">
          <div className="counts">
            {(['new', 'add', 'member', 'invalid', 'duplicate'] as RowStatus[]).map((s) => (
              <div key={s}><b className={s === 'invalid' && plan.counts[s] ? 'warn-text' : ''}>{plan.counts[s]}</b><span>{ROW_STATUS_LABEL[s]}</span></div>
            ))}
            <div><b className={plan.counts.conflicts ? 'warn-text' : ''}>{plan.counts.conflicts}</b><span>Conflicts</span></div>
          </div>
          <div className="seg">
            {(['all', 'conflicts', 'new', 'add', 'member', 'invalid', 'duplicate'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'conflicts' ? 'Conflicts' : ROW_STATUS_LABEL[f].replace('Skipped: ', '')}</button>
            ))}
          </div>
        </div>
        {plan.counts.conflicts > 0 && (
          <div className="row">
            <span className="muted">Where the file differs from what is on file:</span>
            <button className="small" onClick={() => setAll('keep')}>Keep all on file</button>
            <button className="small" onClick={() => setAll('file')}>Use file for all</button>
            <span className="hint">Blank fields on file are filled from the file either way.</span>
          </div>
        )}
        <div className="table-wrap" style={{ maxHeight: '48vh', overflowY: 'auto', border: '1px solid var(--border)' }}>
          <table>
            <thead><tr><th>Line</th><th>Result</th><th>Call</th><th>Name</th><th>Location</th><th>Group</th><th>Changes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line}>
                  <td className="muted">{r.line}</td>
                  <td><span className={'chip ' + STATUS_CHIP[r.status]}>{ROW_STATUS_LABEL[r.status]}</span></td>
                  <td className="call">{r.call || r.rawCall}{r.viaPrevious && <div className="muted">now {r.existingCall}</div>}</td>
                  <td>{r.incoming.name}</td>
                  <td>{[r.incoming.city, r.incoming.county, r.incoming.state].filter(Boolean).join(', ')}</td>
                  <td>{(r.roles.length > 0 || r.spotterId) && <><RoleChips roles={r.roles} />{r.spotterId && <span className="muted"> #{r.spotterId}</span>}</>}</td>
                  <td style={{ minWidth: 340 }}>
                    {r.error && <span className="err">{r.error}</span>}
                    {r.fills.length > 0 && <div className="muted">Fills blank: {r.fills.map((f) => `${FIELD_LABEL[f.field]} “${f.value}”`).join(', ')}</div>}
                    {r.conflicts.map((c) => {
                      const k = choiceKey(r.line, c.field);
                      const v = choices[k] ?? 'keep';
                      return (
                        <div key={k} className="conflict">
                          <span className="dim">{FIELD_LABEL[c.field]}</span>
                          <label><input type="radio" name={k} checked={v === 'keep'} onChange={() => setChoices({ ...choices, [k]: 'keep' })} /><span className="src">Keep</span>{c.existing}</label>
                          <label><input type="radio" name={k} checked={v === 'file'} onChange={() => setChoices({ ...choices, [k]: 'file' })} /><span className="src">Use file</span>{c.incoming}</label>
                        </div>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">Nothing in this view.</div>}
        </div>
      </div>
    </Modal>
  );
}
