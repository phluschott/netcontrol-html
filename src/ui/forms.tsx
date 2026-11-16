import { useState, type FormEvent, type ReactNode } from 'react';
import { MEMBER_ROLES, MEMBER_ROLE_LABEL, STATION_STATUS_LABEL, GROUP_TYPE_LABEL, type GroupFields, type MembershipFields, type StationFields, type StationStatus, type GroupType, type MemberRole } from '../data/types';
import { cleanCallInput, callError } from '../lib/callsign';
import { Modal } from './common';

/* ---------- station ---------- */
export function StationFormModal({ title, initial, onSubmit, onClose, submitLabel = 'Save', extra }: {
  title: string; initial: StationFields; submitLabel?: string; extra?: ReactNode;
  onSubmit: (f: StationFields) => Promise<unknown>; onClose: () => void;
}) {
  const [f, setF] = useState<StationFields>(initial);
  const [prev, setPrev] = useState(initial.previousCalls.join(', '));
  const [err, setErr] = useState('');
  const set = <K extends keyof StationFields>(k: K, v: StationFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const ce = callError(f.call);
    if (ce) { setErr(ce); return; }
    try {
      await onSubmit({ ...f, previousCalls: prev.split(/[,\s]+/).map(cleanCallInput).filter(Boolean) });
      onClose();
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => submit()}>{submitLabel}</button></>}>
      <form onSubmit={submit} className="fields">
        <div><label>Call sign *</label><input className="call-input" value={f.call} autoFocus onChange={(e) => { set('call', cleanCallInput(e.target.value).replace('/', '')); setErr(''); }} maxLength={8} /></div>
        <div><label>Status</label><select value={f.status} onChange={(e) => set('status', e.target.value as StationStatus)}>{Object.entries(STATION_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label>Full name</label><input value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label>On-air name</label><input value={f.onAirName} placeholder="What you call them on the air" onChange={(e) => set('onAirName', e.target.value)} /></div>
        <div><label>City</label><input value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div><label>County</label><input value={f.county} onChange={(e) => set('county', e.target.value)} /></div>
        <div><label>State</label><input value={f.state} maxLength={3} onChange={(e) => set('state', e.target.value.toUpperCase())} /></div>
        <div><label>Grid square</label><input value={f.grid} maxLength={8} onChange={(e) => set('grid', e.target.value)} /></div>
        <div className="full"><label>Standing notes</label><textarea rows={3} value={f.notes} placeholder="True every week: mobile most Tuesdays, relays via K9XYZ, hard of hearing…" onChange={(e) => set('notes', e.target.value)} /></div>
        <div className="full"><label>Previous call signs</label><input value={prev} placeholder="Comma separated" onChange={(e) => setPrev(e.target.value.toUpperCase())} /><div className="hint">History under these calls stays with this station. Changing the call sign above adds the old one here on its own.</div></div>
        {extra && <div className="full">{extra}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---------- group ---------- */
export function GroupFormModal({ title, initial, onSubmit, onClose }: {
  title: string; initial: GroupFields; onSubmit: (f: GroupFields) => Promise<unknown>; onClose: () => void;
}) {
  const [f, setF] = useState(initial);
  const [counties, setCounties] = useState(initial.counties.join(', '));
  const [err, setErr] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!f.name.trim()) { setErr('A group needs a name.'); return; }
    try { await onSubmit({ ...f, counties: counties.split(',').map((c) => c.trim()).filter(Boolean) }); onClose(); }
    catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => submit()}>Save</button></>}>
      <form onSubmit={submit} className="fields">
        <div className="full"><label>Group name *</label><input value={f.name} autoFocus placeholder="e.g., Peoria County Skywarn" onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label>Type</label><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as GroupType })}>{Object.entries(GROUP_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><div className="hint">Decides which net screens this group can run.</div></div>
        <div><label>Counties served</label><input value={counties} placeholder="Peoria, Tazewell, Woodford" onChange={(e) => setCounties(e.target.value)} /></div>
        <div className="full"><label>Description</label><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---------- membership ---------- */
export function MembershipEditor({ value, onChange }: { value: MembershipFields; onChange: (v: MembershipFields) => void }) {
  const toggle = (r: MemberRole) => onChange({ ...value, roles: value.roles.includes(r) ? value.roles.filter((x) => x !== r) : [...value.roles, r] });
  return (
    <div className="fields">
      <div className="full"><label>Roles in this group</label>
        <div className="row">{MEMBER_ROLES.map((r) => <label key={r} className="check"><input type="checkbox" checked={value.roles.includes(r)} onChange={() => toggle(r)} />{MEMBER_ROLE_LABEL[r]}</label>)}</div>
      </div>
      <div><label>Spotter ID</label><input value={value.spotterId} onChange={(e) => onChange({ ...value, spotterId: e.target.value })} /></div>
      <div><label>Joined</label><input type="date" value={value.joinedOn} onChange={(e) => onChange({ ...value, joinedOn: e.target.value })} /></div>
      <div><label>Membership</label><label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={value.active} onChange={(e) => onChange({ ...value, active: e.target.checked })} />Active</label><div className="hint">Inactive members stay on record but drop off roll call.</div></div>
      <div className="full"><label>Notes for this group</label><input value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} /></div>
    </div>
  );
}

export function MembershipModal({ title, initial, onSubmit, onClose }: { title: string; initial: MembershipFields; onSubmit: (v: MembershipFields) => Promise<unknown>; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const submit = async () => { try { await onSubmit(v); onClose(); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={submit}>Save</button></>}>
      <MembershipEditor value={v} onChange={setV} />
    </Modal>
  );
}

export function RoleChips({ roles }: { roles: MemberRole[] }) {
  const cls: Record<MemberRole, string> = { member: 'dim', spotter: 'yellow', ncs: 'green', officer: 'blue' };
  return <span className="chips">{roles.filter((r) => r !== 'member' || roles.length === 1).map((r) => <span key={r} className={'chip ' + cls[r]}>{MEMBER_ROLE_LABEL[r]}</span>)}</span>;
}
