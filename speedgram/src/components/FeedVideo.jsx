import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import PropTypes from 'prop-types';
import { toggleFeedMuted, useFeedMuted } from '../videoFeed';

// A feed/reel video that plays only while it dominates the viewport. One
// IntersectionObserver per element drives play/pause; because a post or a reel
// slide is tall, at most one clears the visibility threshold at a time, so the
// "one video at a time" rule falls out of the geometry rather than a global lock.
const PLAY_THRESHOLD = 0.7;

const FeedVideo = ({ videoUrl, poster, alt, className = '', rounded = false, children }) => {
  const videoRef = useRef(null);
  const muted = useFeedMuted();
  const [playing, setPlaying] = useState(false);

  // Reflect the shared mute state onto the element imperatively — React's `muted`
  // attribute doesn't reliably update a live media element.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= PLAY_THRESHOLD) {
          video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          video.pause();
          setPlaying(false);
        }
      },
      { threshold: [0, PLAY_THRESHOLD, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoUrl]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  return (
    <div className={`visual feed-video${rounded ? ' is-rounded' : ''}${className ? ` ${className}` : ''}`}>
      <video
        ref={videoRef}
        src={videoUrl}
        poster={poster || undefined}
        aria-label={alt}
        loop
        muted
        playsInline
        preload="metadata"
        onClick={togglePlay}
      />
      <button
        type="button"
        className="feed-video-mute"
        onClick={(event) => { event.stopPropagation(); toggleFeedMuted(); }}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      {!playing ? <span className="feed-video-paused" aria-hidden="true" /> : null}
      {children}
    </div>
  );
};

FeedVideo.propTypes = {
  alt: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  poster: PropTypes.string,
  rounded: PropTypes.bool,
  videoUrl: PropTypes.string.isRequired,
};

export default FeedVideo;
