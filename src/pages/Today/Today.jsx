import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSparks } from '../../context/SparksContext';
import { useAudio } from '../../context/AudioContext';
import { VideoPlayer } from '../../components/VideoPlayer/VideoPlayer';
import { ImageWithFallback } from '../../components/Common/ImageWithFallback';
import { fetchTodayContent, fetchSparks, normalizeSpark } from '../../services/sparksService';
import { fetchVideos, fetchVideoById, normalizeVideo } from '../../services/videosService';
import { fetchAudios } from '../../services/audiosService';
import { fetchRecommendations } from '../../services/recommendationsService';
import { fetchUserActivity, recordContentActivity } from '../../services/activityService';
import { useAccessControl } from '../../context/AccessControlContext';
import { getUserPreferences, isSparkDeliveredForUser } from '../../services/userPreferencesService';
import { supabase } from '../../lib/supabase';
import './Today.css';

export const Today = ({
  onNavigateToSpark,
  onNavigateToSparks,
  onNavigateToVideos,
  onNavigateToAudios,
  onNavigateToRecommendations,
  onNavigateToVideo,
  onNavigateToAudio
}) => {
  const { user, profile, isAuthenticated } = useAuth();
  const {
    sparks,
    toggleSaveContent,
    isContentSaved,
    openShare,
    showToast,
    loading: sparksLoading
  } = useSparks();
  const {
    currentTrack,
    isPlaying,
    playTrack,
    currentTime,
    duration: audioDuration,
    playbackSpeed,
    cycleSpeed,
    formatTime,
    audioUnavailable,
    audioErrorMsg,
    clearAudioUnavailable
  } = useAudio();

  const { requireAccess, isVipContent } = useAccessControl();

  // Dynamic Supabase content states
  const [todayData, setTodayData] = useState({
    spark: null,
    scheduledVideo: null,
    scheduledAudio: null,
    quote: null,
    quoteAuthor: 'Dr. Cubie'
  });
  const [todaySparks, setTodaySparks] = useState([]);
  const [videos, setVideos] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [courseProgress, setCourseProgress] = useState(0);
  const [contentLoading, setContentLoading] = useState(true);

  // Video playback states
  const [playingVideoId, setPlayingVideoId] = useState(null);
  const [isPlayingContinueVideo, setIsPlayingContinueVideo] = useState(false);
  const [activeVideoModal, setActiveVideoModal] = useState(null);

  const lastRecordedVideoProgress = useRef(0);

  // Dynamic user preferences for delivery time
  const [userPreferences, setUserPreferences] = useState(() => getUserPreferences(user?.id));

  useEffect(() => {
    setUserPreferences(getUserPreferences(user?.id));
  }, [user?.id]);

  useEffect(() => {
    const handlePrefUpdated = (e) => {
      if (e.detail?.preferences) {
        setUserPreferences(e.detail.preferences);
      }
    };
    window.addEventListener('drcubie_preferences_updated', handlePrefUpdated);
    return () => window.removeEventListener('drcubie_preferences_updated', handlePrefUpdated);
  }, []);

  // Synchronize sparks dynamically with Supabase realtime updates
  useEffect(() => {
    if (!supabase) return;
    const sparksSub = supabase
      .channel('today-sparks-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sparks' },
        async () => {
          try {
            const freshSparks = await fetchSparks();
            if (Array.isArray(freshSparks)) {
              setTodaySparks(freshSparks);
            }
          } catch (e) {
            console.warn('[Today] Error refreshing sparks on realtime update:', e);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sparksSub);
    };
  }, []);

  // 1. Load Today global dynamic content from Supabase and user progress
  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        setContentLoading(true);

        const [todayRes, sparksRes, videosRes, audiosRes, recsRes] = await Promise.all([
          fetchTodayContent(),
          fetchSparks(),
          fetchVideos(),
          fetchAudios(),
          fetchRecommendations()
        ]);

        if (!mounted) return;

        const scheduledSpark = todayRes?.todaySpark || null;
        const scheduledVideo = todayRes?.scheduledVideo || scheduledSpark?.video || null;
        const scheduledAudio = todayRes?.scheduledAudio || scheduledSpark?.audio || null;

        setTodayData({
          spark: scheduledSpark,
          scheduledVideo,
          scheduledAudio,
          quote: todayRes?.quote || scheduledSpark?.reflection || null,
          quoteAuthor: todayRes?.quoteAuthor || 'Dr. Cubie'
        });

        const publishedSparks = Array.isArray(sparksRes) ? sparksRes : [];
        setTodaySparks(publishedSparks);

        const publishedVideos = Array.isArray(videosRes) ? videosRes : [];
        setVideos(publishedVideos);

        const publishedAudios = Array.isArray(audiosRes) ? audiosRes : [];
        setAudioTracks(publishedAudios);

        const publishedRecs = Array.isArray(recsRes) ? recsRes : [];
        setRecommendations(publishedRecs);

        // Resolve user's actual progress for the CURRENTLY SCHEDULED content from content_activity
        let initialProgress = 0;
        const heroContentId = scheduledVideo?.id || scheduledSpark?.db_id || scheduledSpark?.id;

        if (isAuthenticated && user?.id && heroContentId) {
          try {
            const activities = await fetchUserActivity(user.id);
            const matchedActivity = activities.find(
              (a) =>
                a.content_id === heroContentId ||
                (scheduledSpark && (a.content_id === scheduledSpark.db_id || a.content_id === scheduledSpark.id)) ||
                (scheduledVideo && a.content_id === scheduledVideo.id)
            );

            if (matchedActivity) {
              initialProgress = matchedActivity.completed
                ? 100
                : Math.min(100, Math.max(0, Math.round(Number(matchedActivity.progress) || 0)));
            }
          } catch (err) {
            console.warn('[Today] Error fetching user content activity for scheduled lesson:', err);
          }
        }

        if (mounted) {
          setCourseProgress(initialProgress);
          lastRecordedVideoProgress.current = initialProgress;
        }
      } catch (err) {
        console.error('[Today] Error fetching dynamic Supabase content:', err);
      } finally {
        if (mounted) {
          setContentLoading(false);
        }
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, user?.id]);

  // Scheduled content resolved from todayData (from public.daily_content)
  const scheduledSpark = todayData.spark;
  const scheduledVideo = todayData.scheduledVideo || scheduledSpark?.video || null;
  const scheduledAudio = todayData.scheduledAudio || scheduledSpark?.audio || null;

  const heroTitle = scheduledSpark?.title || scheduledVideo?.title || 'Daily Wisdom';
  const heroCategory = (scheduledVideo?.category || scheduledSpark?.categoryLabel || scheduledSpark?.category || 'MINDFULNESS').toUpperCase();
  const heroDuration = scheduledVideo?.duration || scheduledSpark?.duration || '0:30';
  const heroDurationSeconds = scheduledVideo?.durationSeconds || 30;
  const heroPoster = scheduledVideo?.posterUrl || scheduledVideo?.thumbnail_url || scheduledSpark?.thumbnail_url || scheduledSpark?.image || '/assets/images/hero-quiet-clarity.jpg';
  const heroVideoUrl = scheduledVideo?.videoUrl || scheduledVideo?.video_url || scheduledSpark?.videoUrl || '';
  const heroContentId = scheduledVideo?.id || scheduledSpark?.db_id || scheduledSpark?.id;
  const heroInitialTime = (courseProgress / 100) * heroDurationSeconds;
  const isHeroSaved = isContentSaved('spark', scheduledSpark?.db_id || scheduledSpark?.id);

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(new Date());

  // Dynamic user greeting
  const greetingName =
    profile?.full_name?.split(' ')[0] ||
    user?.user_metadata?.full_name?.split(' ')[0] ||
    (isAuthenticated ? 'Friend' : 'Seeker');

  const handleSparkClick = (sparkId) => {
    if (onNavigateToSpark && sparkId) {
      onNavigateToSpark(sparkId);
    }
  };

  const handleResumeLesson = (e) => {
    if (e) e.stopPropagation();
    const heroContent = scheduledVideo || scheduledSpark || {
      id: heroContentId,
      title: heroTitle,
      is_vip: Boolean(scheduledSpark?.is_vip || scheduledVideo?.is_vip)
    };
    requireAccess(heroContent, () => {
      if (scheduledSpark?.slug || scheduledSpark?.id) {
        handleSparkClick(scheduledSpark.slug || scheduledSpark.id);
      } else if (heroVideoUrl) {
        handlePlayContinueVideo();
      }
    });
  };

  const handlePlayContinueVideo = (e) => {
    if (e) e.stopPropagation();
    const heroContent = scheduledVideo || scheduledSpark || {
      id: heroContentId,
      title: heroTitle,
      is_vip: Boolean(scheduledSpark?.is_vip || scheduledVideo?.is_vip)
    };
    requireAccess(heroContent, () => {
      if (heroVideoUrl) {
        setPlayingVideoId(null);
        setIsPlayingContinueVideo(true);

        if (isAuthenticated && user?.id && heroContentId) {
          recordContentActivity({
            userId: user.id,
            contentType: scheduledVideo ? 'video' : 'spark',
            contentId: heroContentId,
            progress: courseProgress,
            completed: courseProgress >= 95
          });
        }
      } else if (scheduledSpark?.slug || scheduledSpark?.id) {
        handleSparkClick(scheduledSpark.slug || scheduledSpark.id);
      }
    });
  };

  const handleStopContinueVideo = (e) => {
    if (e) e.stopPropagation();
    setIsPlayingContinueVideo(false);
  };

  // Video progress reporting callback from VideoPlayer for the scheduled hero lesson
  const handleContinueVideoProgress = useCallback(
    ({ currentTime, duration, progressPercent }) => {
      const rounded = Math.min(100, Math.max(0, Math.round(progressPercent)));
      setCourseProgress(rounded);

      // Periodically record progress to Supabase content_activity every 10%
      if (
        isAuthenticated &&
        user?.id &&
        heroContentId &&
        Math.abs(rounded - lastRecordedVideoProgress.current) >= 10
      ) {
        lastRecordedVideoProgress.current = rounded;
        recordContentActivity({
          userId: user.id,
          contentType: scheduledVideo ? 'video' : 'spark',
          contentId: heroContentId,
          progress: rounded,
          completed: rounded >= 95
        });
      }
    },
    [isAuthenticated, user?.id, heroContentId, scheduledVideo]
  );

  // When continue video pauses
  const handleContinueVideoPause = useCallback(
    ({ currentTime, duration, progressPercent }) => {
      const rounded = Math.min(100, Math.max(0, Math.round(progressPercent)));
      setCourseProgress(rounded);

      if (isAuthenticated && user?.id && heroContentId) {
        lastRecordedVideoProgress.current = rounded;
        recordContentActivity({
          userId: user.id,
          contentType: scheduledVideo ? 'video' : 'spark',
          contentId: heroContentId,
          progress: rounded,
          completed: rounded >= 95
        });
      }
    },
    [isAuthenticated, user?.id, heroContentId, scheduledVideo]
  );

  // When continue video finishes
  const handleContinueVideoEnded = useCallback(() => {
    setIsPlayingContinueVideo(false);
    setCourseProgress(100);
    lastRecordedVideoProgress.current = 100;

    if (isAuthenticated && user?.id && heroContentId) {
      recordContentActivity({
        userId: user.id,
        contentType: scheduledVideo ? 'video' : 'spark',
        contentId: heroContentId,
        progress: 100,
        completed: true
      });
    }
  }, [isAuthenticated, user?.id, heroContentId, scheduledVideo]);

  const handlePlayVideoCard = (e, video) => {
    if (e) e.stopPropagation();
    requireAccess(video, () => {
      setIsPlayingContinueVideo(false);
      setPlayingVideoId(video.id);

      if (isAuthenticated && user?.id && video.id) {
        recordContentActivity({
          userId: user.id,
          contentType: 'video',
          contentId: video.id,
          progress: 15,
          completed: false
        });
      }
    });
  };

  const handleStopVideoCard = (e) => {
    if (e) e.stopPropagation();
    setPlayingVideoId(null);
  };

  const handleOpenVideoModal = (video) => {
    requireAccess(video, () => {
      setActiveVideoModal(video);

      if (isAuthenticated && user?.id && video.id) {
        recordContentActivity({
          userId: user.id,
          contentType: 'video',
          contentId: video.id,
          progress: 15,
          completed: false
        });
      }
    });
  };

  const handleAudioCardPlay = (e, audioTrack) => {
    if (e) e.stopPropagation();

    requireAccess(audioTrack, () => {
      // Directly play the actual audioTrack with its uploaded Supabase storage URL
      playTrack(audioTrack);

      if (isAuthenticated && user?.id && audioTrack.id) {
        recordContentActivity({
          userId: user.id,
          contentType: 'audio',
          contentId: audioTrack.id,
          progress: 10,
          completed: false
        });
      }
    });
  };

  const handleVideoCardClick = (video) => {
    if (onNavigateToVideo && video?.id) {
      onNavigateToVideo(video.id);
    } else if (video?.id) {
      window.location.hash = `#/videos/${video.id}`;
    }
  };

  const handleAudioCardClick = (track) => {
    if (onNavigateToAudio && track?.id) {
      onNavigateToAudio(track.id);
    } else if (track?.id) {
      window.location.hash = `#/audios/${track.id}`;
    }
  };

  const handleRecommendationClick = (rec) => {
    const type = (rec.contentType || 'spark').toLowerCase();

    if (type === 'video') {
      const vidId = rec.contentId || rec.id;
      if (onNavigateToVideo) {
        onNavigateToVideo(vidId);
      } else {
        window.location.hash = `#/videos/${vidId}`;
      }
      return;
    }

    if (type === 'audio') {
      const audId = rec.contentId || rec.id;
      if (onNavigateToAudio) {
        onNavigateToAudio(audId);
      } else {
        window.location.hash = `#/audios/${audId}`;
      }
      return;
    }

    // Default: spark
    if (rec.sparkId || rec.contentId || rec.id) {
      handleSparkClick(rec.sparkId || rec.contentId || rec.id);
    }
  };

  const handleSparkCardClick = (spark) => {
    requireAccess(spark, () => {
      handleSparkClick(spark.slug || spark.id);

      if (isAuthenticated && user?.id && (spark.db_id || spark.id)) {
        recordContentActivity({
          userId: user.id,
          contentType: 'spark',
          contentId: spark.db_id || spark.id,
          progress: 25,
          completed: false
        });
      }
    });
  };

  const handleToggleSaveSpark = (e, spark) => {
    if (e) e.stopPropagation();
    toggleSaveContent('spark', spark.db_id || spark.id);
  };

  const displaySparks = todaySparks;

  const closeVideoModal = () => {
    setActiveVideoModal(null);
  };

  return (
    <div className="today-screen animate-fade-in">
      {/* 1. DATE / WELCOME SECTION */}
      <section className="today-welcome-section" aria-label="Welcome">
        <div className="today-date-row">
          <span className="today-date-text">{formattedDate}</span>
        </div>

        <div className="today-greeting-row">
          <h1 className="today-greeting-title">
            Good morning, {greetingName}
          </h1>
        </div>

        <p className="today-welcome-subtitle">
          Ready to continue your mastery journey today?
        </p>
      </section>

      {/* 2. CONTINUE LEARNING (PRIMARY LEARNING CARD) */}
      <section className="today-continue-learning-section" aria-label="Continue Learning">
        <div className="today-section-header">
          <div className="today-section-title-wrap">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>play_circle</span>
            <h3 className="today-section-title">CONTINUE LEARNING</h3>
          </div>
          <span className="today-done-pill">{courseProgress}% Done</span>
        </div>

        {contentLoading ? (
          <article className="today-continue-card">
            <div className="today-continue-media skeleton-shimmer" style={{ minHeight: '200px' }} />
            <div className="today-continue-body">
              <div className="skeleton-line-sub skeleton-shimmer" style={{ width: '40%', height: '14px', marginBottom: '8px' }} />
              <div className="skeleton-line-title skeleton-shimmer" style={{ width: '80%', height: '22px', marginBottom: '16px' }} />
              <div className="today-progress-bar-track skeleton-shimmer" style={{ height: '6px', marginBottom: '16px' }} />
              <div className="skeleton-shimmer" style={{ height: '44px', borderRadius: '8px' }} />
            </div>
          </article>
        ) : !isSparkDeliveredForUser(userPreferences?.dailyDeliveryTime) ? (
          <article className="today-continue-card">
            <div className="today-empty-notice" style={{ padding: '36px 20px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '36px', color: 'var(--color-primary, #00288e)', marginBottom: '8px' }}>
                alarm
              </span>
              <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary, #1b1b1f)', marginBottom: '4px' }}>
                Daily Spark Arrives at {userPreferences?.dailyDeliveryTime || '07:00 AM'}
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary, #444653)', margin: '0 auto', maxWidth: '300px' }}>
                Your quiet reflection window is scheduled for {userPreferences?.dailyDeliveryTime || '07:00 AM'}. Take a serene breath while today's spark is prepared.
              </p>
            </div>
          </article>
        ) : !scheduledSpark && !scheduledVideo ? (
          <article className="today-continue-card">
            <div className="today-empty-notice" style={{ padding: '36px 20px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '36px', color: 'var(--color-primary-400)', marginBottom: '8px' }}>
                calendar_today
              </span>
              <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
                Today's content is being prepared
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
                The daily wisdom lesson and practice will be published shortly.
              </p>
            </div>
          </article>
        ) : (
          <article className="today-continue-card">
            {/* Media Header */}
            <div
              className={`today-continue-media ${isPlayingContinueVideo ? 'is-playing' : ''}`}
              onClick={!isPlayingContinueVideo ? handlePlayContinueVideo : undefined}
              role="region"
              aria-label={`Lesson video: ${heroTitle}`}
            >
              {isPlayingContinueVideo ? (
                <>
                  <VideoPlayer
                    src={heroVideoUrl}
                    poster={heroPoster}
                    title={heroTitle}
                    durationLabel={heroDuration}
                    autoPlay={true}
                    initialTime={heroInitialTime}
                    onProgressUpdate={handleContinueVideoProgress}
                    onPause={handleContinueVideoPause}
                    variant="hero"
                    onEnded={handleContinueVideoEnded}
                  />
                  <button
                    className="today-video-inline-close-btn"
                    onClick={handleStopContinueVideo}
                    aria-label="Close video player"
                    title="Close video"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </>
              ) : (
                <>
                  <ImageWithFallback
                    src={heroPoster}
                    fallbackSrc="/assets/images/hero-quiet-clarity.jpg"
                    type="spark"
                    alt={heroTitle}
                    className="today-continue-img"
                  />
                  <div className="today-continue-media-overlay" />

                  <div className="today-continue-media-top">
                    <span className="today-glass-pill">
                      {heroCategory} • TODAY
                    </span>
                    {(scheduledSpark?.is_vip || scheduledVideo?.is_vip) && (
                      <span className="card-vip-badge font-label-sm">
                        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>workspace_premium</span>
                        VIP
                      </span>
                    )}
                    <span className="today-glass-badge">HD</span>
                  </div>

                  <div
                    className="today-continue-play-circle"
                    title="Play Lesson Video"
                    onClick={handlePlayContinueVideo}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: '26px', fontVariationSettings: "'FILL' 1" }}
                    >
                      play_arrow
                    </span>
                  </div>

                  <div className="today-continue-media-bottom">
                    <span className="today-media-stat">
                      <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>schedule</span>
                      {heroDuration}
                    </span>
                    <span className="today-media-stat">Daily Featured</span>
                  </div>
                </>
              )}
            </div>

            {/* Lesson Metadata & Progress */}
            <div className="today-continue-body">
              <span className="today-continue-course-tag">
                DAILY SPARK • {heroCategory}
              </span>

              <h4
                className="today-continue-lesson-title"
                onClick={handleResumeLesson}
                title="Open lesson details"
              >
                {heroTitle}
              </h4>

              <div className="today-continue-progress-block">
                <div className="today-continue-progress-labels">
                  <span className="text-secondary font-medium">Daily Progress</span>
                  <span className="text-primary font-bold">
                    {courseProgress >= 100 ? '100% Completed' : `${courseProgress}% Completed`}
                  </span>
                </div>
                <div className="today-progress-bar-track">
                  <div className="today-progress-bar-fill" style={{ width: `${courseProgress}%` }} />
                </div>
              </div>

              <div className="today-continue-actions-row">
                <button
                  className="today-resume-btn"
                  onClick={handleResumeLesson}
                  aria-label="Resume Lesson"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}>
                    play_arrow
                  </span>
                  <span>Resume Lesson</span>
                </button>

                <button
                  className={`today-bookmark-square-btn ${isHeroSaved ? 'saved' : ''}`}
                  onClick={() => toggleSaveContent('spark', scheduledSpark?.db_id || scheduledSpark?.id)}
                  aria-label={isHeroSaved ? 'Remove from saved' : 'Save lesson'}
                  title={isHeroSaved ? 'Saved' : 'Save'}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: '22px',
                      fontVariationSettings: isHeroSaved ? "'FILL' 1" : "'FILL' 0"
                    }}
                  >
                    {isHeroSaved ? 'bookmark' : 'bookmark_border'}
                  </span>
                </button>
              </div>
            </div>
          </article>
        )}
      </section>

      {/* 3. VIDEOS SECTION (Connected to public.videos) */}
      <section className="today-videos-section" aria-label="Video Lessons">
        <div className="today-section-header">
          <div className="today-section-title-wrap">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>smart_display</span>
            <h3 className="today-section-title">VIDEOS</h3>
          </div>
          <button
            className="today-view-all-btn"
            onClick={() => (onNavigateToVideos ? onNavigateToVideos() : null)}
            aria-label="View all videos"
          >
            <span>View All ({videos.length})</span>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
          </button>
        </div>

        {videos.length === 0 && !contentLoading ? (
          <div className="today-empty-notice">
            <span className="material-symbols-outlined">smart_display</span>
            <p>No video lessons available</p>
          </div>
        ) : (
          <div className="today-horizontal-scroll no-scrollbar" role="region" aria-label="Videos Carousel">
            {videos.map((video) => {
              const isPlayingThis = playingVideoId === video.id;

              return (
                <article
                  key={video.id}
                  className={`today-video-card ${isPlayingThis ? 'is-playing' : ''}`}
                >
                  <div className="today-video-thumb-wrap">
                    {isPlayingThis ? (
                      <>
                        <VideoPlayer
                          content={video}
                          src={video.videoUrl}
                          poster={video.posterUrl}
                          title={video.title}
                          durationLabel={video.duration}
                          autoPlay={true}
                          variant="compact"
                          onEnded={() => setPlayingVideoId(null)}
                        />
                        <button
                          className="today-video-inline-close-btn"
                          onClick={handleStopVideoCard}
                          aria-label="Close video player"
                          title="Close video"
                        >
                          <span className="material-symbols-outlined">close</span>
                        </button>
                      </>
                    ) : (
                      <div
                        className="today-video-thumb-clickable"
                        onClick={() => handleVideoCardClick(video)}
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${video.title} details`}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleVideoCardClick(video)}
                      >
                        <ImageWithFallback
                          src={video.posterUrl}
                          fallbackSrc="/assets/images/hero-quiet-clarity.jpg"
                          type="video"
                          alt={video.title}
                          className="today-video-thumb-img"
                        />
                        <div className="today-video-thumb-overlay" />
                        <span className="today-video-badge">{video.categoryBadge}</span>
                        {(video.is_vip || video.isVip) && (
                          <span className="card-vip-badge font-label-sm" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>workspace_premium</span>
                            VIP
                          </span>
                        )}

                        <button
                          type="button"
                          className="today-video-play-btn"
                          onClick={(e) => handlePlayVideoCard(e, video)}
                          title={`Watch ${video.title}`}
                          aria-label={`Watch ${video.title}`}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}
                          >
                            play_arrow
                          </span>
                        </button>

                        <span className="today-video-duration-pill">{video.duration}</span>
                      </div>
                    )}
                  </div>

                  <div
                    className="today-video-card-body"
                    onClick={() => handleVideoCardClick(video)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleVideoCardClick(video)}
                  >
                    <h4 className="today-video-title">
                      {(video.is_vip || video.isVip) ? `[VIP] ${video.title}` : video.title}
                    </h4>
                    <p className="today-video-meta">{video.metadata}</p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. AUDIO SECTION (Connected to public.audios) */}
      <section className="today-audio-section" aria-label="Audio Sessions">
        <div className="today-section-header">
          <div className="today-section-title-wrap">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>headphones</span>
            <h3 className="today-section-title">AUDIO</h3>
          </div>
          <button
            className="today-view-all-btn"
            onClick={() => (onNavigateToAudios ? onNavigateToAudios() : null)}
            aria-label="View all audio sessions"
          >
            <span>View All ({audioTracks.length})</span>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
          </button>
        </div>

        {audioTracks.length === 0 && !contentLoading ? (
          <div className="today-empty-notice">
            <span className="material-symbols-outlined">headphones</span>
            <p>No audio sessions available</p>
          </div>
        ) : (
          <div className="today-horizontal-scroll no-scrollbar" role="region" aria-label="Audio Carousel">
            {audioTracks.map((track) => {
              const isThisTrackPlaying = isPlaying && (currentTrack?.id === track.id || currentTrack?.db_id === track.id);
              const displayTime = isThisTrackPlaying
                ? `${formatTime(currentTime)} / ${formatTime(audioDuration || track.durationTotal)}`
                : `00:00 / ${track.durationText}`;

              return (
                <article
                  key={track.id}
                  className={`today-audio-card ${isThisTrackPlaying ? 'is-playing' : ''}`}
                  onClick={() => handleAudioCardClick(track)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleAudioCardClick(track)}
                >
                  <div className="today-audio-top-row">
                    <span className="today-audio-category-tag">{track.categoryTag}</span>
                    {(track.is_vip || track.isVip) && (
                      <span className="card-vip-badge font-label-sm">
                        <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>workspace_premium</span>
                        VIP
                      </span>
                    )}
                    <button
                      type="button"
                      className="today-audio-speed-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (cycleSpeed) cycleSpeed();
                      }}
                      title="Cycle Playback Speed"
                    >
                      {playbackSpeed ? `${playbackSpeed.toFixed(1)}x` : '1.0x'}
                    </button>
                  </div>

                  <h4 className="today-audio-title">
                    {(track.is_vip || track.isVip) ? `[VIP] ${track.title}` : track.title}
                  </h4>
                  <p className="today-audio-author">{track.author}</p>

                  {/* Animated Waveform Visualization */}
                  <div
                    className="today-audio-waveform-container"
                    title="Audio Waveform"
                  >
                    {(track.waveformPattern || [8, 14, 20, 12, 16, 22, 10, 18, 14, 8]).map((height, barIdx) => {
                      const isActiveBar = isThisTrackPlaying
                        ? barIdx < Math.floor((currentTime / (track.durationTotal || 180)) * 10)
                        : false;

                      return (
                        <span
                          key={barIdx}
                          className={`today-waveform-bar ${isActiveBar ? 'active' : ''} ${isThisTrackPlaying ? 'animating' : ''}`}
                          style={{
                            height: `${height}px`,
                            animationDelay: `${(barIdx % 5) * 0.15}s`
                          }}
                        />
                      );
                    })}
                  </div>

                  <div className="today-audio-bottom-row">
                    <span className="today-audio-time">{displayTime}</span>
                    <button
                      type="button"
                      className="today-audio-play-round-btn"
                      onClick={(e) => handleAudioCardPlay(e, track)}
                      aria-label={isThisTrackPlaying ? 'Pause Audio' : 'Play Audio'}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: '20px', fontVariationSettings: "'FILL' 1" }}
                      >
                        {isThisTrackPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. SPARKS SECTION (Connected to public.sparks) */}
      <section className="today-sparks-section" aria-label="Sparks Wisdom">
        <div className="today-section-header">
          <div className="today-section-title-wrap">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>auto_awesome</span>
            <h3 className="today-section-title">SPARKS</h3>
          </div>
          <button
            className="today-view-all-btn"
            onClick={() => (onNavigateToSparks ? onNavigateToSparks() : null)}
            aria-label="View all sparks"
          >
            <span>View All ({displaySparks.length})</span>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
          </button>
        </div>

        {displaySparks.length === 0 && !contentLoading ? (
          <div className="today-empty-notice">
            <span className="material-symbols-outlined">auto_awesome</span>
            <p>No sparks available</p>
          </div>
        ) : (
          <div className="today-horizontal-scroll no-scrollbar" role="region" aria-label="Sparks Carousel">
            {displaySparks.map((spark) => {
              const isSaved = isContentSaved ? isContentSaved('spark', spark.db_id || spark.id) : spark.saved;
              const sparkImage = spark.thumbnail_url || spark.image || '';
              const categoryText = spark.categoryLabel || spark.category || '';
              const durationText = spark.duration ? (spark.duration.includes('min') ? spark.duration : `${spark.duration} min`) : '';
              const isVip = Boolean(spark.is_vip || spark.isVip);
              const snippetText = spark.short_description || spark.reflection || '';

              return (
                <article
                  key={spark.id || spark.db_id}
                  className="today-spark-card"
                  onClick={() => handleSparkCardClick(spark)}
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${spark.title || 'Spark'} reflection`}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSparkCardClick(spark)}
                >
                  <div className="today-spark-thumb-wrap">
                    <ImageWithFallback
                      src={sparkImage}
                      type="spark"
                      alt={spark.title || 'Spark reflection'}
                      className="today-spark-thumb-img"
                    />
                    <div className="today-spark-thumb-overlay" />
                    {categoryText && <span className="today-spark-badge">{categoryText}</span>}
                    {isVip && (
                      <span className="card-vip-badge font-label-sm" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>workspace_premium</span>
                        VIP
                      </span>
                    )}

                    <div className="today-spark-read-indicator" title={spark.title ? `Read ${spark.title}` : 'Read Spark'}>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: '18px' }}
                      >
                        auto_awesome
                      </span>
                    </div>

                    {durationText && <span className="today-spark-duration-pill">{durationText}</span>}
                  </div>

                  <div className="today-spark-card-body">
                    <h4 className="today-spark-title" title={spark.title || ''}>
                      {isVip ? `[VIP] ${spark.title || ''}` : (spark.title || '')}
                    </h4>
                    {snippetText && (
                      <p className="today-spark-snippet" title={snippetText}>
                        {snippetText}
                      </p>
                    )}
                    <div className="today-spark-bottom-row">
                      <span className="today-spark-action-label">
                        <span>Read Spark</span>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>arrow_forward</span>
                      </span>
                      <button
                        type="button"
                        className={`today-spark-save-btn ${isSaved ? 'saved' : ''}`}
                        onClick={(e) => handleToggleSaveSpark(e, spark)}
                        aria-label={isSaved ? `Remove ${spark.title || 'Spark'} from saved` : `Save ${spark.title || 'Spark'}`}
                        title={isSaved ? 'Saved' : 'Save'}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: '18px',
                            fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0"
                          }}
                        >
                          {isSaved ? 'bookmark' : 'bookmark_border'}
                        </span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 6. DAILY REFLECTION (Connected to Supabase Spark Reflection) */}
      <section className="today-daily-reflection-section" aria-label="Daily Reflection">
        <div className="today-section-header">
          <h3 className="today-section-title">DAILY REFLECTION</h3>
          <span className="today-daily-word-label">Daily Word</span>
        </div>

        <article className="today-reflection-card">
          <span className="today-reflection-quote-mark">&ldquo;</span>

          <blockquote className="today-reflection-quote">
            &ldquo;{todayData.quote || scheduledSpark?.quote || scheduledSpark?.reflection || 'Create Space Before You Respond'}&rdquo;
          </blockquote>

          <div className="today-reflection-bottom-row">
            <cite className="today-reflection-author">&mdash; {todayData.quoteAuthor?.toUpperCase() || 'DR. CUBIE'}</cite>

            <div className="today-reflection-actions">
              <button
                className={`today-save-journal-btn ${isHeroSaved ? 'saved' : ''}`}
                onClick={() => scheduledSpark && toggleSaveContent('spark', scheduledSpark.db_id || scheduledSpark.id)}
                aria-label={isHeroSaved ? 'Saved to Journal' : 'Save to Journal'}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '16px',
                    fontVariationSettings: isHeroSaved ? "'FILL' 1" : "'FILL' 0"
                  }}
                >
                  {isHeroSaved ? 'bookmark' : 'bookmark_border'}
                </span>
                <span>{isHeroSaved ? 'Saved to Archive' : 'Save to Archive'}</span>
              </button>

              <button
                className="today-reflection-share-btn"
                onClick={() => scheduledSpark && openShare(scheduledSpark)}
                aria-label="Share Quote"
                title="Share"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  ios_share
                </span>
              </button>
            </div>
          </div>
        </article>
      </section>

      {/* 6. RECOMMENDED FOR YOU (Connected to public.recommendations — exactly top 3) */}
      <section className="today-courses-section" aria-label="Recommended For You">
        <div className="today-section-header">
          <div className="today-section-title-wrap">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>auto_awesome</span>
            <h3 className="today-section-title">RECOMMENDED FOR YOU</h3>
          </div>
          <button
            className="today-view-all-btn"
            onClick={() => (onNavigateToRecommendations ? onNavigateToRecommendations() : null)}
            aria-label="View all recommendations"
          >
            <span>View All ({recommendations.length})</span>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
          </button>
        </div>

        {recommendations.length === 0 && !contentLoading ? (
          <div className="today-empty-notice">
            <span className="material-symbols-outlined">auto_awesome</span>
            <p>No recommendations available</p>
          </div>
        ) : (
          <div className="today-horizontal-scroll no-scrollbar" role="region" aria-label="Recommendations Carousel">
            {recommendations.slice(0, 3).map((rec) => {
              const contentTypeLabel =
                rec.contentType === 'video'
                  ? 'Video'
                  : rec.contentType === 'audio'
                    ? 'Audio'
                    : 'Spark';
              const contentTypeIcon =
                rec.contentType === 'video'
                  ? 'smart_display'
                  : rec.contentType === 'audio'
                    ? 'headphones'
                    : 'menu_book';
              const actionLabel =
                rec.contentType === 'video'
                  ? 'Watch'
                  : rec.contentType === 'audio'
                    ? 'Listen'
                    : 'Explore';

              return (
                <article
                  key={rec.id}
                  className="today-rec-card btn-pressable"
                  onClick={() => handleRecommendationClick(rec)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleRecommendationClick(rec)}
                  aria-label={`${actionLabel} ${rec.title}`}
                >
                  <div className="today-rec-thumb-wrap">
                    <ImageWithFallback
                      src={rec.posterUrl || rec.coverUrl}
                      fallbackSrc="/assets/images/hero-quiet-clarity.jpg"
                      type="spark"
                      alt={rec.title}
                      className="today-rec-thumb-img"
                    />
                    <div className="today-rec-thumb-overlay" />

                    <div className="today-rec-badges-row">
                      <span className="today-rec-category-badge">
                        {(rec.category || 'Mindfulness').toUpperCase()}
                      </span>
                      {(rec.is_vip || rec.isVip) && (
                        <span className="card-vip-badge font-label-sm" style={{ padding: '0.12rem 0.4rem', fontSize: '8.5px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '10px' }}>workspace_premium</span>
                          VIP
                        </span>
                      )}
                      <span className={`today-rec-type-badge ${rec.contentType || 'spark'}`}>
                        <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>
                          {contentTypeIcon}
                        </span>
                        <span>{contentTypeLabel}</span>
                      </span>
                    </div>

                    <span className="today-rec-duration-pill">
                      {rec.duration || (rec.contentType === 'video' ? '0:30' : '3 min')}
                    </span>
                  </div>

                  <div className="today-rec-card-body">
                    <h4 className="today-rec-title" title={rec.title}>
                      {(rec.is_vip || rec.isVip) ? `[VIP] ${rec.title}` : rec.title}
                    </h4>

                    <div className="today-rec-footer-row">
                      <span className="today-rec-meta">
                        {rec.category || 'Wisdom'} • {rec.duration || '3 min'}
                      </span>

                      <span className="today-rec-action-link">
                        <span>{actionLabel}</span>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                          arrow_forward
                        </span>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Video Modal Player */}
      {activeVideoModal && (
        <div className="video-modal-backdrop animate-fade-in" onClick={closeVideoModal}>
          <div
            className="video-modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={activeVideoModal.title}
          >
            <div className="video-modal-header">
              <div className="video-modal-badge font-label-sm">
                {(activeVideoModal.category || 'Mindfulness').toUpperCase()}
              </div>
              <button
                className="video-modal-close-btn btn-pressable"
                onClick={closeVideoModal}
                aria-label="Close video"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="video-modal-player-wrap">
              <VideoPlayer
                src={activeVideoModal.videoUrl}
                poster={activeVideoModal.posterUrl || activeVideoModal.poster}
                title={activeVideoModal.title}
                durationLabel={activeVideoModal.duration || activeVideoModal.durationLabel}
                autoPlay={true}
                variant="default"
                onEnded={() => {
                  if (isAuthenticated && user?.id && activeVideoModal.id) {
                    recordContentActivity({
                      userId: user.id,
                      contentType: 'video',
                      contentId: activeVideoModal.id,
                      progress: 100,
                      completed: true
                    });
                  }
                }}
              />
            </div>
            <div className="video-modal-footer">
              <h3 className="video-modal-title font-title-lg">{activeVideoModal.title}</h3>
              {activeVideoModal.sparkId && (
                <button
                  className="video-modal-detail-btn font-label-md btn-pressable"
                  onClick={() => {
                    closeVideoModal();
                    handleSparkClick(activeVideoModal.sparkId);
                  }}
                >
                  <span>Read Full Lesson</span>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                    arrow_forward
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
