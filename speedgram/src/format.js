export const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const exactCount = new Intl.NumberFormat('en');

export const relativeTime = (timestamp) => {
  if (!timestamp) return '';
  const seconds = Math.max(1, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
};

export const clockTime = (timestamp) => (timestamp
  ? new Date(timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  : '');
