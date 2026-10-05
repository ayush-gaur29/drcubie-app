import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSparks } from '../../context/SparksContext';
import { AudioPlayer } from '../../components/AudioPlayer/AudioPlayer';
import { VideoPlayer } from '../../components/VideoPlayer/VideoPlayer';
import { ImageWithFallback } from '../../components/Common/ImageWithFallback';
import { fetchSparkById } from '../../services/sparksService';
import { recordContentActivity } from '../../services/activityService';
import './SparkDetail.css';

export const SparkDetail = ({ sparkId, onBack }) => {
  const { user, isAuthenticated } = useAuth();
  const {
    sparks,
    toggleSaveContent,
    isContentSaved,
    openShare,
    journalNotes,
    saveJournalNote,
    showToast
  } = useSparks();

  // Find spark in loaded sparks context or fall back
  const contextSpark = sparks.find(
    (s) => s.id === sparkId || s.db_id === sparkId || s.slug === sparkId
  );

  const [spark, setSpark] = useState(contextSpark || null);
  const [loading, setLoading] = useState(!contextSpark);

  // If specific spark wasn't in cache, fetch directly from Supabase
  useEffect(() => {
    let mounted = true;

    if (contextSpark) {
      setSpark(contextSpark);
      setLoading(false);
    } else if (sparkId) {
      setLoading(true);
      fetchSparkById(sparkId).then((fetched) => {
        if (mounted) {
          setSpark(fetched);
          setLoading(false);
        }
      });
    } else {
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [sparkId, contextSpark]);

  // Record user activity in public.content_activity
  useEffect(() => {
    if (isAuthenticated && user?.id && spark) {
      recordContentActivity({
        userId: user.id,
        contentType: 'spark',
        contentId: spark.db_id || spark.id,
        progress: 25,
        completed: false
      });
    }
  }, [isAuthenticated, user?.id, spark?.id]);

  const isSaved = isContentSaved('spark', spark?.db_id || spark?.id);

  const [noteText, setNoteText] = useState(journalNotes[spark?.id] || '');
  const [hasResonated, setHasResonated] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);

  useEffect(() => {
    if (spark?.id) {
      setNoteText(journalNotes[spark.id] || '');
    }
  }, [spark?.id, journalNotes]);

  const handleSaveNote = (e) => {
    e.preventDefault();
    if (spark) {
      saveJournalNote(spark.id, noteText);
    }
  };

  const handleToggleResonate = () => {
    setHasResonated((prev) => !prev);
    showToast(!hasResonated ? 'Thank you for reflecting with us' : 'Resonance removed');
  };

  if (loading) {
    return (
      <div className="spark-detail-screen animate-fade-in" style={{ padding: '60px 16px', textAlign: 'center' }}>
        <p className="font-body-md text-secondary">Loading wisdom spark...</p>
      </div>
    );
  }

  if (!spark) {
    return (
      <div className="spark-detail-screen animate-fade-in" style={{ padding: '60px 16px', textAlign: 'center' }}>
        <h2 className="font-title-lg" style={{ marginBottom: '8px' }}>Spark not found</h2>
        <p className="font-body-md text-secondary">This reflection is no longer available.</p>
        {onBack && (
          <button type="button" className="btn-pressable" onClick={onBack} style={{ marginTop: '16px', padding: '8px 16px', borderRadius: '8px' }}>
            Go Back
          </button>
        )}
      </div>
    );
  }

  return (
    <article className="spark-detail-screen animate-fade-in">
      {/* 1. Top Utility Context Bar */}
      <div className="spark-detail-context-bar">
        <div className="spark-detail-type-pill font-label-sm">
          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
            auto_awesome
          </span>
          <span>DAILY SPARK • {spark.duration?.toUpperCase() || '4 MIN'} LISTEN</span>
        </div>

        <div className="spark-detail-context-actions">
          <button
            className={`spark-detail-icon-btn ${isSaved ? 'saved' : ''} btn-pressable`}
            onClick={() => toggleSaveContent('spark', spark.db_id || spark.id)}
            aria-label={isSaved ? 'Remove from saved' : 'Save spark'}
            title={isSaved ? 'Saved' : 'Save'}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: '20px',
                fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0"
              }}
            >
              bookmark
            </span>
          </button>

          <button
            className="spark-detail-icon-btn btn-pressable"
            onClick={() => openShare(spark)}
            aria-label="Share this spark"
            title="Share"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              share
            </span>
          </button>
        </div>
      </div>

      {/* 2. Spark Title & Category/Duration Header */}
      <header className="spark-detail-header">
        <h1 className="spark-detail-title font-headline-xl-mobile">
          {spark.title}
        </h1>

        <div className="spark-detail-meta-row font-label-sm">
          {(spark.is_vip || spark.isVip) && (
            <span className="card-vip-badge" style={{ position: 'static' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>workspace_premium</span>
              VIP
            </span>
          )}
          <span className="spark-detail-category-badge">
            {spark.categoryLabel || spark.category}
          </span>
          <span className="spark-detail-meta-dot">•</span>
          <span className="spark-detail-duration-text">
            {spark.duration || '4 min'} listen
          </span>
          {spark.videoDuration && (
            <>
              <span className="spark-detail-meta-dot">•</span>
              <span className="spark-detail-video-text">
                <span className="material-symbols-outlined" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '2px' }}>
                  videocam
                </span>
                {spark.videoDuration} video
              </span>
            </>
          )}
        </div>

        <p className="spark-detail-subtitle font-body-lg">
          {spark.subtitle}
        </p>
      </header>

      {/* 3. Primary Video Player Experience */}
      <div className="spark-detail-video-wrap">
        <VideoPlayer
          content={spark}
          src={spark.videoUrl || ''}
          poster={spark.detailImage || spark.image}
          title={spark.title}
          durationLabel={spark.videoDuration || '0:30'}
          variant="hero"
          onProgressUpdate={({ progress }) => {
            if (isAuthenticated && user?.id && (spark.db_id || spark.id)) {
              recordContentActivity({
                userId: user.id,
                contentType: 'spark',
                contentId: spark.db_id || spark.id,
                progress,
                completed: progress >= 95
              });
            }
          }}
        />
      </div>

      {/* 4. Dedicated Audio Contemplation Player Module */}
      <section className="spark-detail-audio-section" aria-label="Audio Contemplation">
        <AudioPlayer
          spark={spark}
          title={spark.audioTitle || 'Guided Contemplation'}
          subtitle={spark.audioSubtitle || '432Hz Calm Resonance'}
          narrator={spark.narrator || 'Voice of Dr. Cubie'}
          duration={spark.audioDuration || 255}
        />
      </section>

      {/* 5. Serene Reader Essay Body */}
      <div className="spark-detail-body">
        {/* Editorial Introduction */}
        <p className="spark-detail-paragraph font-body-lg intro-lead">
          {spark.introParagraph || spark.subtitle}
        </p>

        {/* Insight Callout Card */}
        {spark.insight && (
          <aside className="spark-detail-insight-card" aria-label="Key Insight">
            <div className="insight-card-inner">
              <span className="material-symbols-outlined insight-icon">
                lightbulb
              </span>
              <div className="insight-text-wrap">
                <span className="insight-eyebrow font-label-sm">CORE INSIGHT</span>
                <p className="insight-content font-body-md">
                  {spark.insight}
                </p>
              </div>
            </div>
          </aside>
        )}

        {/* Core Architectural Principle Section */}
        <section className="spark-detail-principle-section">
          <h2 className="spark-detail-section-heading font-headline-sm">
            {spark.principleHeading || 'The Principle'}
          </h2>
          <p className="spark-detail-paragraph font-body-md">
            {spark.principleText || spark.reflection}
          </p>
        </section>

        {/* Pull Quote Callout Box */}
        {spark.quote && (
          <figure className="spark-detail-pullquote-figure">
            <blockquote className="spark-detail-pullquote font-headline-sm">
              &ldquo;{spark.quote}&rdquo;
            </blockquote>
            <figcaption className="spark-detail-pullquote-cite font-label-md">
              {spark.quoteAttribution || '— Dr. Cubie'}
            </figcaption>
          </figure>
        )}

        {/* Actionable Micro-Practice Card */}
        <section className="spark-detail-practice-card" aria-label="Daily Practice">
          <div className="practice-card-header">
            <span className="material-symbols-outlined practice-icon">
              psychology
            </span>
            <h3 className="practice-card-heading font-title-md">
              {spark.practiceHeading || "Today's 1-Minute Practice"}
            </h3>
          </div>

          <p className="practice-main-instruction font-body-md">
            {spark.practice}
          </p>

          {spark.practiceSteps && spark.practiceSteps.length > 0 && (
            <ol className="practice-steps-list">
              {spark.practiceSteps.map((step, idx) => (
                <li key={idx} className="practice-step-item">
                  <span className="practice-step-number">{idx + 1}</span>
                  <span className="practice-step-text font-body-md">{step}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Personal Journaling / Reflection Note */}
        <section className="spark-detail-journal-section" aria-label="Reflection Journal">
          <div className="journal-section-header">
            <h3 className="journal-heading font-title-md">
              Personal Reflection Note
            </h3>
            <button
              className="journal-toggle-btn font-label-sm btn-pressable"
              onClick={() => setShowNoteForm((prev) => !prev)}
            >
              {showNoteForm ? 'Hide Note' : noteText ? 'Edit Note' : 'Write Note'}
            </button>
          </div>

          {showNoteForm ? (
            <form onSubmit={handleSaveNote} className="journal-note-form animate-fade-in">
              <textarea
                className="journal-textarea font-body-md"
                placeholder="How does this reflection apply to your immediate decisions today?"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={4}
              />
              <div className="journal-form-actions">
                <button
                  type="submit"
                  className="journal-save-btn font-label-md btn-pressable"
                >
                  Save Reflection Note
                </button>
              </div>
            </form>
          ) : noteText ? (
            <div className="journal-note-preview font-body-md">
              <p>{noteText}</p>
            </div>
          ) : null}
        </section>

        {/* Resonance & Engagement Footer */}
        <footer className="spark-detail-footer">
          <button
            className={`spark-resonate-btn font-label-md btn-pressable ${hasResonated ? 'resonated' : ''}`}
            onClick={handleToggleResonate}
            aria-pressed={hasResonated}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: hasResonated ? "'FILL' 1" : "'FILL' 0" }}
            >
              favorite
            </span>
            <span>{hasResonated ? 'Resonated' : 'Resonate With This'}</span>
          </button>

          <button
            className="spark-share-footer-btn font-label-md btn-pressable"
            onClick={() => openShare(spark)}
          >
            <span className="material-symbols-outlined">
              ios_share
            </span>
            <span>Share Wisdom</span>
          </button>
        </footer>
      </div>
    </article>
  );
};
