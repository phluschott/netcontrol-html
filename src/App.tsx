import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMeta } from './data/db';
import { Clock } from './ui/common';
import SearchPalette from './ui/SearchPalette';
import GroupsPage from './pages/GroupsPage';
import GroupPage from './pages/GroupPage';
import StationsPage from './pages/StationsPage';
import StationPage from './pages/StationPage';
import SettingsPage from './pages/SettingsPage';

const BACKUP_DUE_DAYS = 7;

export default function App() {
  const [searching, setSearching] = useState(false);
  const backupDue = useLiveQuery(async () => {
    const last = await getMeta<string>('lastBackupAt');
    const hasData = (await getMeta<string>('legacyMigratedAt')) !== undefined;
    if (!hasData) return false;
    return !last || Date.now() - new Date(last).getTime() > BACKUP_DUE_DAYS * 864e5;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="app-header">
        <Link to="/" className="logo"><span className="mark">((·))</span>NET CONTROL</Link>
        <nav className="nav">
          <NavLink to="/groups">Groups</NavLink>
          <NavLink to="/stations">Stations</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <button className="search-btn" onClick={() => setSearching(true)}>Search <kbd>Ctrl K</kbd></button>
        {backupDue && <Link to="/settings" className="chip yellow" title="Download a backup from Settings">Backup due</Link>}
        <Clock />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/groups" replace />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="/stations" element={<StationsPage />} />
          <Route path="/stations/:call" element={<StationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/groups" replace />} />
        </Routes>
      </main>
      <footer className="app-foot">Data is stored in this browser. Download a backup from Settings regularly.</footer>
      {searching && <SearchPalette onClose={() => setSearching(false)} />}
    </>
  );
}
