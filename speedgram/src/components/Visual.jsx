import { ImageOff } from 'lucide-react';
import PropTypes from 'prop-types';
import { initialsFor, toneFor } from '../visualTone';

export const Avatar = ({ src, username = '', size = 42, ring = 'none', className = '' }) => (
  <span className={`avatar ring-${ring}${className ? ` ${className}` : ''}`} style={{ '--avatar-size': `${size}px` }}>
    {src ? (
      <img className="avatar-fill" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
    ) : (
      <span className={`avatar-fill tone-${toneFor(username)}`}>
        <i style={{ fontSize: Math.max(9, Math.round(size / 3)) }}>{initialsFor(username)}</i>
      </span>
    )}
  </span>
);

Avatar.propTypes = {
  className: PropTypes.string,
  ring: PropTypes.oneOf(['none', 'story', 'seen', 'live']),
  size: PropTypes.number,
  src: PropTypes.string,
  username: PropTypes.string,
};

/** Media surface: real image or video when Instagram returned one, else a labelled fallback. */
const Visual = ({ imageUrl, videoUrl, alt, seed, label, className, rounded, controls, children }) => {
  const shell = `visual${rounded ? ' is-rounded' : ''}${className ? ` ${className}` : ''}`;

  if (videoUrl) {
    return (
      <div className={shell}>
        <video src={videoUrl} poster={imageUrl || undefined} controls={controls} playsInline preload="metadata" />
        {children}
      </div>
    );
  }
  if (imageUrl) {
    return (
      <div className={shell}>
        <img src={imageUrl} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
        {children}
      </div>
    );
  }
  return (
    <div className={`${shell} is-fallback tone-${toneFor(seed || alt || '')}`}>
      <span className="visual-grain" aria-hidden="true" />
      <span className="visual-orb one" aria-hidden="true" />
      <span className="visual-orb two" aria-hidden="true" />
      <span className="visual-missing"><ImageOff size={18} /> {label || 'Media unavailable'}</span>
      {children}
    </div>
  );
};

Visual.propTypes = {
  alt: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  controls: PropTypes.bool,
  imageUrl: PropTypes.string,
  label: PropTypes.string,
  rounded: PropTypes.bool,
  seed: PropTypes.string,
  videoUrl: PropTypes.string,
};

export default Visual;
