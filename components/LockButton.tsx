export function LockButton() {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        top: '18px',
        transform: 'translateX(-50%)',
        zIndex: 2147483647,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '10px 16px',
        borderRadius: '999px',
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid rgba(148, 163, 184, 0.45)',
        color: '#f8fafc',
        fontSize: '15px',
        fontWeight: 600,
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.35)',
      }}
    >
      <span>Click the subtitle box to lock</span>
      <span aria-hidden="true" style={{ fontSize: '18px', lineHeight: 1 }}>
        ↓
      </span>
    </div>
  );
}
