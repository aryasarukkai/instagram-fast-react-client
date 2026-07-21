import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import PropTypes from 'prop-types';
import { initialsFor, proxyImage, toneFor } from '../visualTone';

export const Avatar = ({ src, username = '', size = 42, ring = 'none', className = '' }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`avatar ring-${ring}${className ? ` ${className}` : ''}`} style={{ '--avatar-size': `${size}px` }}>
      {src && !failed ? (
        <img className="avatar-fill" src={proxyImage(src)} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className={`avatar-fill tone-${toneFor(username)}`}>
          <i style={{ fontSize: Math.max(9, Math.round(size / 3)) }}>{initialsFor(username)}</i>
        </span>
      )}
    </span>
  );
};

Avatar.propTypes = {
  className: PropTypes.string,
  ring: PropTypes.oneOf(['none', 'story', 'seen', 'live']),
  size: PropTypes.number,
  src: PropTypes.string,
  username: PropTypes.string,
};

/** Media surface: real image or video when Instagram returned one, else a labelled fallback. */
const Visual = ({ imageUrl, videoUrl, alt, seed, label, className, rounded, controls, autoPlay, loop, muted, children }) => {
  const shell = `visual${rounded ? ' is-rounded' : ''}${className ? ` ${className}` : ''}`;

  if (videoUrl) {
    return (
      <div className={shell}>
        <video
          src={videoUrl}
          poster={imageUrl || undefined}
          controls={controls}
          autoPlay={autoPlay}
          loop={loop}
          muted={muted}
          playsInline
          preload="metadata"
        />
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
  autoPlay: PropTypes.bool,
  children: PropTypes.node,
  className: PropTypes.string,
  controls: PropTypes.bool,
  imageUrl: PropTypes.string,
  label: PropTypes.string,
  loop: PropTypes.bool,
  muted: PropTypes.bool,
  rounded: PropTypes.bool,
  seed: PropTypes.string,
  videoUrl: PropTypes.string,
};

export default Visual;
