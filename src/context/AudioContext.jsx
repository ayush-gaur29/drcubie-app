import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { ALL_AUDIOS } from '../data/audios';
import { useAuth } from './AuthContext';
import { recordContentActivity } from '../services/activityService';
import { evaluateContentAccess, getAuthorizedMediaUrl } from '../services/accessControlService';
import { getUserPreferences, saveUserPreferences } from '../services/userPreferencesService';
import { getOfflineMediaBlob } from '../services/offlineStorageService';

const AudioContext = createContext();

/**
 * Safely unloads and resets an HTMLAudioElement without triggering resource load errors
 * or browser baseURI resolution.
 */
const resetAudioElement = (audio) => {
  if (!audio) return;
  try {
    audio.pause();
  } catch (e) {
    // Ignore pause errors
  }
  // Safely remove the src attribute rather than setting src = ''
  audio.removeAttribute('src');
  try {
    audio.load();
  } catch (e) {
    // Ignore load reset errors
  }
};

/**
 * Validates whether a media URL is a genuine audio URL rather than empty, undefined,
 * or the base document URI.
 */
const isValidAudioUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === '' || (typeof window !== 'undefined' && trimmed === window.location.href)) {
    return false;
  }
  return true;
};

export const AudioProvider = ({ children }) => {
  const { user, profile, isAuthenticated, isVip } = useAuth();

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(180);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => {
    const prefs = getUserPreferences(null);
    const parsed = parseFloat(prefs?.audioSpeed || '1.0');
    return !isNaN(parsed) && parsed > 0 ? parsed : 1;
  });
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [audioErrorMsg, setAudioErrorMsg] = useState(null);

  const audioRef = useRef(null);
  const lastRecordedProgressRef = useRef(0);
  const activeBlobUrlRef = useRef(null);

  // Sync mutable refs so listeners and callbacks always access fresh state without effect re-runs
  const userRef = useRef(user);
  const profileRef = useRef(profile);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const isVipRef = useRef(isVip);
  const currentTrackRef = useRef(currentTrack);
  const playbackSpeedRef = useRef(playbackSpeed);

  useEffect(() => {
    userRef.current = user;
    profileRef.current = profile;
    isAuthenticatedRef.current = isAuthenticated;
    isVipRef.current = isVip;
  }, [user, profile, isAuthenticated, isVip]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // Single persistent HTMLAudioElement lifecycle - initialized once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentTime(cur);

      // Periodically record progress every ~10% increment
      const activeTrack = currentTrackRef.current;
      const isAuth = isAuthenticatedRef.current;
      const currentUser = userRef.current;
      if (audio.duration > 0 && isAuth && currentUser?.id && activeTrack) {
        const pct = Math.round((cur / audio.duration) * 100);
        if (Math.abs(pct - lastRecordedProgressRef.current) >= 10) {
          lastRecordedProgressRef.current = pct;
          const contentId = activeTrack.db_id || activeTrack.id;
          recordContentActivity({
            userId: currentUser.id,
            contentType: 'audio',
            contentId,
            progress: pct,
            completed: pct >= 95
          });
        }
      }
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setAudioUnavailable(false);
      setAudioErrorMsg(null);
    };

    const handlePause = () => {
      setIsPlaying(false);
      const activeTrack = currentTrackRef.current;
      const isAuth = isAuthenticatedRef.current;
      const currentUser = userRef.current;
      if (audio.duration > 0 && isAuth && currentUser?.id && activeTrack) {
        const pct = Math.min(100, Math.max(0, Math.round((audio.currentTime / audio.duration) * 100)));
        const contentId = activeTrack.db_id || activeTrack.id;
        recordContentActivity({
          userId: currentUser.id,
          contentType: 'audio',
          contentId,
          progress: pct,
          completed: pct >= 95
        });
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
      const activeTrack = currentTrackRef.current;
      const isAuth = isAuthenticatedRef.current;
      const currentUser = userRef.current;
      if (isAuth && currentUser?.id && activeTrack) {
        const contentId = activeTrack.db_id || activeTrack.id;
        recordContentActivity({
          userId: currentUser.id,
          contentType: 'audio',
          contentId,
          progress: 100,
          completed: true
        });
      }
    };

    const handleError = (e) => {
      const currentSrc = audio.currentSrc || audio.src || '';

      // Ignore benign events when audio element was reset, unloaded, or has no valid source
      if (!isValidAudioUrl(currentSrc)) {
        return;
      }

      // Check the native MediaError object
      const mediaErr = audio.error;
      // Code 1 is MEDIA_ERR_ABORTED: standard interruption caused by new load or pause
      if (mediaErr && mediaErr.code === 1) {
        return;
      }

      // If audio is paused and not meant to play, ignore non-fatal events
      if (audio.paused && !isPlaying) {
        return;
      }

      console.warn('[AudioContext] Playback error encountered:', {
        code: mediaErr?.code,
        message: mediaErr?.message,
        src: currentSrc
      });
      setIsPlaying(false);
      setAudioUnavailable(true);
      setAudioErrorMsg('Audio file is currently unavailable');
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      resetAudioElement(audio);
      audioRef.current = null;
    };
  }, []); // Run ONCE on mount

  // Immediately stop playback if the user logs out
  useEffect(() => {
    if (!isAuthenticated && audioRef.current) {
      resetAudioElement(audioRef.current);
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [isAuthenticated]);

  // Load playback speed from user preference on auth change
  useEffect(() => {
    const prefs = getUserPreferences(user?.id);
    if (prefs?.audioSpeed) {
      const parsed = parseFloat(prefs.audioSpeed);
      if (!isNaN(parsed) && parsed > 0) {
        setPlaybackSpeed(parsed);
        playbackSpeedRef.current = parsed;
        if (audioRef.current) {
          audioRef.current.playbackRate = parsed;
        }
      }
    }
  }, [user?.id]);

  // Synchronize with preference changes across components
  useEffect(() => {
    const handlePrefChange = (e) => {
      const speedStr = e.detail?.preferences?.audioSpeed;
      if (speedStr) {
        const parsed = parseFloat(speedStr);
        if (!isNaN(parsed) && parsed > 0) {
          setPlaybackSpeed(parsed);
          playbackSpeedRef.current = parsed;
          if (audioRef.current) {
            audioRef.current.playbackRate = parsed;
          }
        }
      }
    };
    window.addEventListener('drcubie_preferences_updated', handlePrefChange);
    return () => window.removeEventListener('drcubie_preferences_updated', handlePrefChange);
  }, []);

  const playTrack = useCallback(async (sparkOrTrack) => {
    if (!sparkOrTrack) return;

    const contentId = String(sparkOrTrack.id || sparkOrTrack.db_id || '');

    // 1. Check local offline storage (IndexedDB) for downloaded media
    // If user has downloaded this track, play directly from local Blob (works 100% offline!)
    let offlineBlob = null;
    if (userRef.current?.id && contentId) {
      try {
        offlineBlob = await getOfflineMediaBlob(userRef.current.id, contentId);
      } catch (offlineErr) {
        console.warn('[AudioContext] Offline media lookup note:', offlineErr);
      }
    }

    const isDownloadedOffline = Boolean(offlineBlob);

    // Content access authorization check (bypass network checks if legitimately stored locally)
    const access = (isDownloadedOffline || sparkOrTrack.isOffline)
      ? { allowed: true, status: 'ALLOWED' }
      : evaluateContentAccess({
          user: userRef.current,
          profile: profileRef.current,
          isVip: isVipRef.current,
          content: sparkOrTrack
        });

    if (!access.allowed) {
      console.warn('[AudioContext] Playback prevented by access control:', access.status, sparkOrTrack.title);
      if (audioRef.current) {
        resetAudioElement(audioRef.current);
      }
      setIsPlaying(false);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    let trackUrl = sparkOrTrack.audioUrl || sparkOrTrack.audio_url;

    if (offlineBlob) {
      if (activeBlobUrlRef.current) {
        try { URL.revokeObjectURL(activeBlobUrlRef.current); } catch {}
      }
      const blobUrl = URL.createObjectURL(offlineBlob);
      activeBlobUrlRef.current = blobUrl;
      trackUrl = blobUrl;
    }

    // Fallback if track doesn't have an explicit audioUrl but matches a published/static audio
    if (!trackUrl && sparkOrTrack.id) {
      const matched = ALL_AUDIOS.find(
        (a) => a.sparkId === sparkOrTrack.id || a.id === sparkOrTrack.id || a.title === sparkOrTrack.title
      );
      if (matched?.audioUrl) {
        trackUrl = matched.audioUrl;
      }
    }

    if (!isValidAudioUrl(trackUrl)) {
      console.warn('[AudioContext] No audioUrl available for track:', sparkOrTrack.title);
      setAudioUnavailable(true);
      setAudioErrorMsg(`Audio for "${sparkOrTrack.title || 'this track'}" is currently unavailable.`);
      setIsPlaying(false);
      return;
    }

    // Resolve secure signed URL only if this is a remote asset (not a local offline Blob)
    if (!trackUrl.startsWith('blob:') && !trackUrl.startsWith('data:') && !trackUrl.startsWith('/')) {
      try {
        const authorizedUrl = await getAuthorizedMediaUrl({
          mediaUrl: trackUrl,
          user: userRef.current,
          profile: profileRef.current,
          isVip: isVipRef.current,
          content: sparkOrTrack
        });
        if (authorizedUrl) {
          trackUrl = authorizedUrl;
        }
      } catch (err) {
        console.warn('[AudioContext] Error obtaining signed URL:', err);
      }
    }

    const trackId = sparkOrTrack.id || sparkOrTrack.db_id;
    const currentId = currentTrackRef.current?.id || currentTrackRef.current?.db_id;

    const currentSrcBase = (audio.src || '').split('?')[0];
    const targetSrcBase = trackUrl.split('?')[0];

    // If same track and audio src matches
    if (currentId === trackId && audio.src && currentSrcBase === targetSrcBase) {
      if (audio.paused) {
        const p = audio.play();
        if (p !== undefined) {
          p.catch((err) => {
            if (err.name === 'AbortError') return;
            console.warn('[AudioContext] Play prevented:', err);
            setIsPlaying(false);
          });
        }
      } else {
        audio.pause();
      }
      return;
    }

    // Starting new track
    setCurrentTrack(sparkOrTrack);
    setAudioUnavailable(false);
    setAudioErrorMsg(null);
    setCurrentTime(0);
    lastRecordedProgressRef.current = 0;

    const trackDuration = sparkOrTrack.durationTotal || sparkOrTrack.audioDuration || 180;
    setDuration(trackDuration);

    audio.src = trackUrl;
    audio.playbackRate = playbackSpeedRef.current;
    audio.currentTime = 0;

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        if (err.name === 'AbortError') return;
        console.warn('[AudioContext] Play prevented:', err);
        setIsPlaying(false);
      });
    }

    if (isAuthenticatedRef.current && userRef.current?.id) {
      const contentId = sparkOrTrack.db_id || sparkOrTrack.id;
      recordContentActivity({
        userId: userRef.current.id,
        contentType: 'audio',
        contentId,
        progress: 5,
        completed: false
      });
    }
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    const track = currentTrackRef.current;
    if (!track) return;

    const access = evaluateContentAccess({
      user: userRef.current,
      profile: profileRef.current,
      isVip: isVipRef.current,
      content: track
    });

    if (!access.allowed) {
      console.warn('[AudioContext] Toggle play prevented by access control:', access.status);
      resetAudioElement(audio);
      setIsPlaying(false);
      return;
    }

    if (audio.paused) {
      let trackUrl = track.audioUrl || track.audio_url;

      if (!trackUrl && track.id) {
        const matched = ALL_AUDIOS.find(
          (a) => a.sparkId === track.id || a.id === track.id || a.title === track.title
        );
        if (matched?.audioUrl) {
          trackUrl = matched.audioUrl;
        }
      }

      const currentSrcBase = (audio.src || '').split('?')[0];
      const targetSrcBase = (trackUrl || '').split('?')[0];

      if (trackUrl && (!audio.src || currentSrcBase !== targetSrcBase || !isValidAudioUrl(audio.src))) {
        try {
          const authorizedUrl = await getAuthorizedMediaUrl({
            mediaUrl: trackUrl,
            user: userRef.current,
            profile: profileRef.current,
            isVip: isVipRef.current,
            content: track
          });
          if (authorizedUrl) {
            trackUrl = authorizedUrl;
          }
        } catch (err) {
          console.warn('[AudioContext] Error obtaining signed URL in togglePlay:', err);
        }

        audio.src = trackUrl;
        audio.playbackRate = playbackSpeedRef.current;
      }

      if (isValidAudioUrl(audio.src)) {
        setAudioUnavailable(false);
        setAudioErrorMsg(null);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            if (err.name === 'AbortError') return;
            console.warn('[AudioContext] Play prevented:', err);
            setIsPlaying(false);
          });
        }
      } else {
        setAudioUnavailable(true);
        setAudioErrorMsg(`Audio for "${track.title || 'this track'}" is currently unavailable`);
      }
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((timeInSeconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(timeInSeconds, duration));
    try {
      audio.currentTime = clamped;
      setCurrentTime(clamped);
    } catch (e) {
      // In case metadata is not yet ready
    }
  }, [duration]);

  const skip = useCallback((deltaSeconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.max(0, Math.min(audio.currentTime + deltaSeconds, duration));
    try {
      audio.currentTime = next;
      setCurrentTime(next);
    } catch (e) {
      // In case metadata is not yet ready
    }
  }, [duration]);

  const changeSpeed = useCallback((newSpeed) => {
    const valid = Number(newSpeed) || 1;
    setPlaybackSpeed(valid);
    playbackSpeedRef.current = valid;
    if (audioRef.current) {
      audioRef.current.playbackRate = valid;
    }
    saveUserPreferences(userRef.current?.id, { audioSpeed: `${valid}x` });
  }, []);

  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.25, 1.5];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    changeSpeed(nextSpeed);
  }, [playbackSpeed, changeSpeed]);

  const formatTime = (secs) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const formatTimeRemaining = (cur, tot) => {
    const rem = Math.max(0, (tot || duration) - (cur || currentTime));
    return `-${formatTime(rem)}`;
  };

  return (
    <AudioContext.Provider
      value={{
        currentTrack,
        isPlaying,
        currentTime,
        duration,
        playbackSpeed,
        playTrack,
        togglePlay,
        seek,
        skip,
        cycleSpeed,
        changeSpeed,
        formatTime,
        formatTimeRemaining,
        audioUnavailable,
        audioErrorMsg,
        clearAudioUnavailable: () => {
          setAudioUnavailable(false);
          setAudioErrorMsg(null);
        }
      }}
    >
      {children}
    </AudioContext.Provider>
  );
};

export const useAudio = () => useContext(AudioContext);
