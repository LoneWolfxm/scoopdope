'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  onEnded?: () => void;
}

const SEEK_STEP_SECONDS = 5;

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function VideoPlayer({
  src,
  poster,
  title = 'Course video',
  className = '',
  autoPlay = false,
  muted: initialMuted = false,
  onEnded,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused || video.ended) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          announce('Unable to play video');
        });
      }
    } else {
      video.pause();
    }
  }, [announce]);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      const max = Number.isFinite(video.duration) ? video.duration : 0;
      const next = Math.min(Math.max(video.currentTime + deltaSeconds, 0), max);
      video.currentTime = next;
      setCurrentTime(next);
      announce(`Seeked to ${formatTime(next)}`);
    },
    [announce],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    announce(nextMuted ? 'Muted' : 'Unmuted');
  }, [announce]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    const element = container as HTMLDivElement & {
      webkitRequestFullscreen?: () => void;
    };

    const isFullscreen =
      document.fullscreenElement === container ||
      doc.webkitFullscreenElement === container;

    if (isFullscreen) {
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
      announce('Exited fullscreen');
    } else if (element.requestFullscreen) {
      void element.requestFullscreen();
      announce('Entered fullscreen');
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
      announce('Entered fullscreen');
    }
  }, [announce]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Ignore key events originating from interactive child controls
      // (e.g. the native video controls) to avoid double handling.
      const target = event.target as HTMLElement | null;
      if (target && target !== event.currentTarget) {
        const tag = target.tagName;
        if (
          tag === 'BUTTON' ||
          tag === 'INPUT' ||
          tag === 'SELECT' ||
          tag === 'TEXTAREA' ||
          tag === 'A'
        ) {
          return;
        }
      }

      switch (event.key) {
        case ' ':
        case 'Spacebar':
        case 'k':
        case 'K':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekBy(-SEEK_STEP_SECONDS);
          break;
        case 'ArrowRight':
          event.preventDefault();
          seekBy(SEEK_STEP_SECONDS);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          toggleFullscreen();
          break;
        default:
          break;
      }
    },
    [seekBy, toggleFullscreen, toggleMute, togglePlay],
  );

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      setIsMuted(video.muted);
    }
  }, []);

  const handleVolumeChange = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setIsMuted(video.muted);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (onEnded) {
      onEnded();
    }
  }, [onEnded]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = initialMuted;
      setIsMuted(initialMuted);
    }
  }, [initialMuted]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-lg bg-black text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${className}`}
      tabIndex={0}
      role="region"
      aria-label={`${title} video player. Use Space to play or pause, arrow keys to seek, M to mute, and F for fullscreen.`}
      onKeyDown={handleKeyDown}
      data-testid="video-player-container"
    >
      <video
        ref={videoRef}
        className="block w-full rounded-lg"
        src={src}
        poster={poster}
        controls
        preload="metadata"
        autoPlay={autoPlay}
        muted={initialMuted}
        aria-label={title}
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onVolumeChange={handleVolumeChange}
        onEnded={handleEnded}
        data-testid="video-player-element"
      >
        <track kind="captions" />
        Your browser does not support the video tag.
      </video>

      <div
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-900/80 px-3 py-2 text-xs text-gray-200"
        aria-label="Keyboard shortcuts"
        data-testid="video-player-shortcuts"
      >
        <span className="font-semibold text-white">Keyboard shortcuts:</span>
        <span>
          <kbd className="rounded border border-gray-500 bg-gray-800 px-1.5 py-0.5 font-mono">
            Space
          </kbd>{' '}
          Play/Pause
        </span>
        <span>
          <kbd className="rounded border border-gray-500 bg-gray-800 px-1.5 py-0.5 font-mono">
            ←
          </kbd>{' '}
          <kbd className="rounded border border-gray-500 bg-gray-800 px-1.5 py-0.5 font-mono">
            →
          </kbd>{' '}
          Seek ±5s
        </span>
        <span>
          <kbd className="rounded border border-gray-500 bg-gray-800 px-1.5 py-0.5 font-mono">
            M
          </kbd>{' '}
          Mute
        </span>
        <span>
          <kbd className="rounded border border-gray-500 bg-gray-800 px-1.5 py-0.5 font-mono">
            F
          </kbd>{' '}
          Fullscreen
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between px-1 text-xs text-gray-300">
        <span aria-hidden="true">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <span aria-hidden="true">
          {isPlaying ? 'Playing' : 'Paused'} · {isMuted ? 'Muted' : 'Sound on'}
        </span>
      </div>

      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="video-player-announcement"
      >
        {announcement}
      </div>
    </div>
  );
}