import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../theme/ThemeContext.jsx';
import { deleteAccount } from '../services/api';
import LegalModal from './LegalModal';
import './Settings.css';

const STORAGE_KEY = 'sensorysafe_settings';

const DEFAULT_SETTINGS = {
  notifications: true,
  quietAlerts: true,
  crowdWarnings: true,
  emailDigest: false,
  darkMode: false,
  highContrast: false,
  reducedMotion: false,
  fontSize: 'medium',
  mapStyle: 'default',
  distanceUnit: 'km',
  showProfileBadge: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const THEMES = [
  { id: 'nature', label: 'Nature', desc: 'Green / beige', color: '#5a8f6e' },
  { id: 'calm', label: 'Calm', desc: 'Blue / teal', color: '#5b9bd5' },
];

function Settings({ user, userProfile, onLogout, onSettingsChange }) {
  const [settings, setSettings] = useState(loadSettings);
  const { theme, setTheme, resetTheme } = useTheme();
  const [savedToast, setSavedToast] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [legalModal, setLegalModal] = useState(null);
  const toastRef = useRef(null);
  const mountedRef = useRef(false);

  const showSaved = useCallback(() => {
    setSavedToast(true);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setSavedToast(false), 2000);
  }, []);

  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    onSettingsChange?.(settings);
    showSaved();
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key) => setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  const set = (key, val) => setSettings((prev) => ({ ...prev, [key]: val }));

  const handleNotificationsToggle = async () => {
    if (!settings.notifications && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') return; // don't toggle if user blocked
    }
    toggle('notifications');
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    resetTheme();
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true);
    try {
      await deleteAccount();
      onLogout?.();
    } catch {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  };

  const joined = user?.updated_at
    ? new Date(user.updated_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'Unknown';

  const profileCompleteness = (() => {
    let score = 0;
    if (user?.name) score += 25;
    if (user?.email) score += 25;
    if (userProfile?.noiseTolerance) score += 20;
    if (userProfile?.lightingTolerance) score += 15;
    if (userProfile?.crowdTolerance) score += 15;
    return score;
  })();

  return (
    <div className="sett-page">
      <div className="sett-header">
        <div>
          <h1>Settings</h1>
          <p>Manage your account, preferences, and accessibility options.</p>
        </div>
      </div>

      {savedToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--theme-accent)', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          Settings saved
        </div>
      )}

      <div className="sett-grid">
        {/* ── Account Card ── */}
        <section className="sett-card sett-account-card">
          <h2>Account</h2>
          <div className="sett-account-row">
            <div className="sett-avatar">
              {user?.picture ? (
                <img src={user.picture} alt="" />
              ) : (
                <div className="sett-avatar-placeholder" />
              )}
            </div>
            <div className="sett-account-info">
              <h3>{user?.name || 'User'}</h3>
              <span className="sett-email">{user?.email || '—'}</span>
              <span className="sett-joined">Joined {joined}</span>
            </div>
          </div>

          <div className="sett-completeness">
            <div className="sett-completeness-header">
              <span>Profile completeness</span>
              <span className="sett-completeness-pct">{profileCompleteness}%</span>
            </div>
            <div className="sett-completeness-bar">
              <div className="sett-completeness-fill" style={{ width: `${profileCompleteness}%` }} />
            </div>
          </div>

          <div className="sett-account-fields">
            <div className="sett-field">
              <label>Display name</label>
              <span>{user?.name || '—'}</span>
            </div>
            <div className="sett-field">
              <label>Email</label>
              <span>{user?.email || '—'}</span>
            </div>
            <div className="sett-field">
              <label>Auth provider</label>
              <span>{user?.sub?.split('|')[0] || 'auth0'}</span>
            </div>
          </div>
        </section>

        {/* ── Notifications Card ── */}
        <section className="sett-card">
          <h2>Notifications</h2>
          <p className="sett-card-desc">Choose which alerts and updates you receive.</p>

          <Toggle label="Push notifications" sublabel="Real-time sensory alerts on your device" checked={settings.notifications} onChange={handleNotificationsToggle} />
          <Toggle label="Quiet zone alerts" sublabel="Notify when nearby places drop below your noise threshold" checked={settings.quietAlerts} onChange={() => toggle('quietAlerts')} />
          <Toggle label="Crowd warnings" sublabel="Alert when saved places exceed your crowd tolerance" checked={settings.crowdWarnings} onChange={() => toggle('crowdWarnings')} />
          <Toggle label="Weekly email digest" sublabel="Summary of your comfort scores and new quiet spots" checked={settings.emailDigest} onChange={() => toggle('emailDigest')} />
        </section>

        {/* ── Appearance Card ── */}
        <section className="sett-card">
          <h2>Appearance</h2>
          <p className="sett-card-desc">Choose a color theme that feels comfortable for you.</p>

          <div className="sett-theme-options">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`sett-theme-btn ${theme === t.id ? 'active' : ''}`}
                onClick={() => setTheme(t.id)}
                aria-pressed={theme === t.id}
                aria-label={`${t.label} theme: ${t.desc}`}
              >
                <span className="sett-theme-swatch" style={{ background: t.color }} aria-hidden />
                <span className="sett-theme-label">{t.label}</span>
                <span className="sett-theme-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Accessibility Card ── */}
        <section className="sett-card">
          <h2>Accessibility</h2>
          <p className="sett-card-desc">Adjust the interface for your comfort.</p>

          <Toggle label="High contrast mode" sublabel="Increase contrast for better readability" checked={settings.highContrast} onChange={() => toggle('highContrast')} />
          <Toggle label="Reduced motion" sublabel="Minimize animations and transitions" checked={settings.reducedMotion} onChange={() => toggle('reducedMotion')} />

          <div className="sett-select-row">
            <div>
              <span className="sett-toggle-label">Font size</span>
              <span className="sett-toggle-sub">Adjust text size across the app</span>
            </div>
            <select value={settings.fontSize} onChange={(e) => set('fontSize', e.target.value)} className="sett-select">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </section>

        {/* ── Map & Display Card ── */}
        <section className="sett-card">
          <h2>Map &amp; Display</h2>
          <p className="sett-card-desc">Customize how the map and data appear.</p>

          <div className="sett-select-row">
            <div>
              <span className="sett-toggle-label">Map style</span>
              <span className="sett-toggle-sub">Choose your preferred map look</span>
            </div>
            <select value={settings.mapStyle} onChange={(e) => set('mapStyle', e.target.value)} className="sett-select">
              <option value="default">Default</option>
              <option value="satellite">Satellite</option>
              <option value="terrain">Terrain</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="sett-select-row">
            <div>
              <span className="sett-toggle-label">Distance unit</span>
              <span className="sett-toggle-sub">How distances are displayed</span>
            </div>
            <select value={settings.distanceUnit} onChange={(e) => set('distanceUnit', e.target.value)} className="sett-select">
              <option value="km">Kilometers</option>
              <option value="mi">Miles</option>
            </select>
          </div>
        </section>

        {/* ── Privacy Card ── */}
        <section className="sett-card">
          <h2>Privacy</h2>
          <p className="sett-card-desc">Control how your data is used.</p>

          <Toggle label="Show profile badge" sublabel="Display your sensory profile type to the community" checked={settings.showProfileBadge} onChange={() => toggle('showProfileBadge')} />
        </section>

        {/* ── Danger Zone Card ── */}
        <section className="sett-card sett-danger-card">
          <h2>Account Actions</h2>

          <div className="sett-action-row">
            <div>
              <span className="sett-toggle-label">Log out</span>
              <span className="sett-toggle-sub">End your current session on this device</span>
            </div>
            <button type="button" className="sett-btn sett-btn-logout" onClick={onLogout}>Log Out</button>
          </div>

          <div className="sett-action-row">
            <div>
              <span className="sett-toggle-label">Reset all settings</span>
              <span className="sett-toggle-sub">Restore every preference to its default value</span>
            </div>
            <button type="button" className="sett-btn sett-btn-reset" onClick={handleReset}>Reset</button>
          </div>

          <div className="sett-action-row sett-action-danger">
            <div>
              <span className="sett-toggle-label">Delete account</span>
              <span className="sett-toggle-sub">
                {deleteConfirm ? 'This will permanently remove your account and all data. This cannot be undone.' : 'Permanently remove your account and all data'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {deleteConfirm && (
                <button type="button" className="sett-btn sett-btn-reset" onClick={() => setDeleteConfirm(false)} disabled={deleting}>
                  Cancel
                </button>
              )}
              <button type="button" className="sett-btn sett-btn-danger" onClick={handleDeleteAccount} disabled={deleting}>
                {deleting ? 'Deleting…' : deleteConfirm ? 'Yes, delete' : 'Delete account'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="sett-footer">
        <span>SenseMap v1.0</span>
        <span>·</span>
        <button className="sett-legal-link" onClick={() => setLegalModal('privacy')}>Privacy Policy</button>
        <span>·</span>
        <button className="sett-legal-link" onClick={() => setLegalModal('terms')}>Terms of Use</button>
      </div>

      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
    </div>
  );
}

function Toggle({ label, sublabel, checked, onChange }) {
  return (
    <div className="sett-toggle-row">
      <div>
        <span className="sett-toggle-label">{label}</span>
        {sublabel && <span className="sett-toggle-sub">{sublabel}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`sett-switch ${checked ? 'on' : ''}`}
        onClick={onChange}
      >
        <span className="sett-switch-knob" />
      </button>
    </div>
  );
}

export default Settings;
