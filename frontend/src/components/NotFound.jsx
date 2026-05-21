import './NotFound.css';

export default function NotFound() {
  return (
    <div className="nf">
      <div className="nf-card">
        <div className="nf-icon">🗺</div>
        <h1 className="nf-title">Page not found</h1>
        <p className="nf-desc">This place isn't on the map. Let's get you somewhere comfortable.</p>
        <a href="/" className="nf-btn">Take me home</a>
      </div>
    </div>
  );
}
