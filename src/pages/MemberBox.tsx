import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, live } from '../data/db';
import { hasPerm, stationLocation, distinctOnAirName, type Directory } from '../data/queries';
import { CHECKIN_STATUS_LABEL, GROUP_TYPE_LABEL, STATION_STATUS_LABEL, type Membership, type Station } from '../data/types';
import { RoleChips } from '../ui/forms';
import { fmtDate } from '../ui/common';

/** Everything about one member, shown beside the group's member list. */
export default function MemberBox({ station, membership, groupId, dir, onEdit, onClose }: {
  station: Station; membership: Membership; groupId: string; dir: Directory;
  onEdit?: () => void; onClose: () => void;
}) {
  const history = useLiveQuery(async () => {
    const cs = live(await db.checkins.where('stationId').equals(station.id).toArray());
    const ss = await db.sessions.bulkGet(cs.map((c) => c.sessionId));
    return cs.map((c, i) => ({ c, s: ss[i] })).filter((x) => x.s && !x.s.deletedAt).sort((a, b) => b.s!.startedAt.localeCompare(a.s!.startedAt));
  }, [station.id]);
  const seeHistory = hasPerm(dir, groupId, 'nets.history');
  const here = (history ?? []).filter((x) => x.c.groupId === groupId);
  const inHere = here.filter((x) => x.c.status === 'checked_in');
  const lastIn = (history ?? []).find((x) => x.c.status === 'checked_in');
  const others = (dir.membershipsByStation.get(station.id) ?? []).filter((m) => m.groupId !== groupId);
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

  return (
    <div className="panel" style={{ borderColor: 'var(--green-bd)' }}>
      <div className="panel-header">
        <span className="panel-title">Member</span>
        <button className="icon" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="panel-body stack">
        <div>
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2 }}>{station.call}</span>
            <span className={'chip ' + (station.status === 'active' ? 'green' : 'dim')}>{STATION_STATUS_LABEL[station.status]}</span>
          </div>
          <div>{station.name}{distinctOnAirName(station) && <span className="muted"> “{distinctOnAirName(station)}”</span>}</div>
          <div className="muted">{stationLocation(station) || 'No location on file'}{station.grid && ` · ${station.grid}`}</div>
          {station.previousCalls.length > 0 && <div className="muted">Previously {station.previousCalls.join(', ')}</div>}
        </div>

        {station.notes && <div className="warn-text pre">{station.notes}</div>}

        <div>
          <div className="label">In this group</div>
          <dl className="dl" style={{ gridTemplateColumns: '90px 1fr' }}>
            <dt>Roles</dt><dd><RoleChips roles={membership.roles} /></dd>
            <dt>Spotter ID</dt><dd>{membership.spotterId || '–'}</dd>
            <dt>Joined</dt><dd>{membership.joinedOn || '–'}</dd>
            <dt>Status</dt><dd>{membership.active ? 'Active' : 'Inactive'}</dd>
            {membership.notes && <><dt>Notes</dt><dd>{membership.notes}</dd></>}
          </dl>
        </div>

        {others.length > 0 && (
          <div>
            <div className="label">Other groups</div>
            <div className="chips">{others.map((m) => {
              const g = dir.groupById.get(m.groupId);
              return g ? <Link key={m.id} className="chip" to={`/groups/${g.id}`} title={GROUP_TYPE_LABEL[g.type]}>{g.name}</Link> : null;
            })}</div>
          </div>
        )}

        {seeHistory && (
          <div>
            <div className="label">Nets in this group</div>
            {here.length ? (
              <>
                <div>Checked in to <b>{inHere.length}</b> of {here.length} net{here.length === 1 ? '' : 's'}{lastIn && <> · last heard {fmtDate(lastIn.s!.startedAt)}</>}</div>
                <table style={{ marginTop: 6 }}><tbody>
                  {here.slice(0, 5).map(({ c, s }) => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'nowrap', paddingLeft: 0 }}><Link to={`/nets/${s!.id}`}>{fmtDate(s!.startedAt)}</Link></td>
                      <td><span className={'chip ' + (c.status === 'checked_in' ? 'green' : c.status === 'absent' ? '' : 'dim')}>{CHECKIN_STATUS_LABEL[c.status]}</span>{c.late && <span className="chip yellow" style={{ marginLeft: 4 }}>Late</span>}</td>
                      <td className="mono muted">{t(c.statusAt)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </>
            ) : <div className="muted">Not on any net in this group yet.</div>}
          </div>
        )}

        <div className="row">
          <Link to={`/stations/${station.call}`} className="btn primary" style={{ color: 'var(--green3)', borderColor: '#2f8f68', background: 'rgba(74,222,128,.08)' }}>Go to Member Page</Link>
          {onEdit && <button onClick={onEdit}>Edit Membership</button>}
        </div>
      </div>
    </div>
  );
}
