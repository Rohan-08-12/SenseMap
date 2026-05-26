import { useEffect } from 'react';
import './LogoutConfirmation.css';

function LogoutConfirmation({ onCancel, onLogout }) {
  // 🔓 DEV BYPASS
  // const { logout } = useAuth0();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleLogout = () => {
    if (onLogout) onLogout();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div className="logout-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-labelledby="logout-title">
      <div className="logout-modal">
        {/* Logo */}
        <div className="logout-logo">
          <div className="logout-logo-icon">
            <img src="/favicon.png" alt="" />
          </div>
          <span className="logout-logo-text">SenseMap</span>
        </div>

        {/* Logout icon */}
        <div className="logout-icon-circle">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="#4b8bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="16,17 21,12 16,7" stroke="#4b8bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke="#4b8bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Text */}
        <h2 className="logout-title" id="logout-title">Are you sure you want to log out?</h2>
        <p className="logout-desc">
          You can always log back in to access your saved places, sensory profile, and personalized recommendations.
        </p>

        {/* Info note */}
        <div className="logout-info">
          <div className="logout-info-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="#4b8bff" strokeWidth="1.5"/>
              <path d="M8 5.5v3M8 10.5h.01" stroke="#4b8bff" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="logout-info-text">
            Nothing will be deleted. Logging out only ends this session on your current device.
          </span>
        </div>

        {/* Buttons */}
        <div className="logout-actions">
          <button className="logout-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="logout-btn-confirm" onClick={handleLogout}>Log Out</button>
        </div>
      </div>
    </div>
  );
}

export default LogoutConfirmation;
