import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSparks } from '../../context/SparksContext';
import { ImageWithFallback } from '../../components/Common/ImageWithFallback';
import { fetchSparks } from '../../services/sparksService';
import { recordContentActivity } from '../../services/activityService';
import { useAccessControl } from '../../context/AccessControlContext';
import './Sparks.css';

export const Sparks = ({ onBack, onNavigateToSpark }) => {
  const { user, isAuthenticated } = useAuth();
  const { sparks, toggleSaveContent, isContentSaved } = useSparks();
  const { requireAccess } = useAccessControl();

  const [allSparks, setAllSparks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSparkCardClick = (spark) => {
    requireAccess(spark, () => {
      if (onNavigateToSpark && (spark.slug || spark.id)) {
        onNavigateToSpark(spark.slug || spark.id);
      } else if (spark.slug || spark.id) {
        window.location.hash = `#/spark/${spark.slug || spark.id}`;
      }

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

  const handleSaveSpark = (e, spark) => {
    e.stopPropagation();
    if (spark.db_id || spark.id) {
      toggleSaveContent('spark', spark.db_id || spark.id);
    }
  };

  const isSparkSaved = (spark) => {
    if (!spark) return false;
    return isContentSaved
      ? isContentSaved('spark', spark.db_id || spark.id)
      : Boolean(spark.saved);
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchSparks();
        if (mounted) {
          setAllSparks(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('[SparksPage] Error loading sparks:', err);
        if (mounted) {
          setAllSparks([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [sparks]);

  const categories = ['All', 'Mindfulness', 'Focus', 'Confidence', 'Leadership', 'Reflection'];

  const filteredSparks = allSparks.filter((spark) => {
    const matchesCat =
      selectedCategory === 'All' ||
      (spark.category || '').toLowerCase() === selectedCategory.toLowerCase() ||
      (spark.categoryLabel || '').toLowerCase() === selectedCategory.toLowerCase();

    if (!matchesCat) return false;

    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const titleMatch = (spark.title || '').toLowerCase().includes(query);
    const descMatch = (spark.short_description || spark.subtitle || spark.quote || '').toLowerCase().includes(query);
    return titleMatch || descMatch;
  });

  const featuredSpark = filteredSparks[0] || allSparks[0] || null;

  return (
    <div className="sparks-screen animate-fade-in" id="sparks-page">
      {/* Top Page Header */}
      <section className="sparks-header-section">
        <div className="sparks-header-row">
          {onBack && (
            <button
              type="button"
              className="sparks-back-btn btn-pressable"
              onClick={onBack}
              aria-label="Go back"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                arrow_back
              </span>
            </button>
          )}
          <div className="sparks-header-text">
            <h1 className="sparks-title font-headline-md">Sparks</h1>
            <p className="sparks-subtitle font-body-sm">
              Daily contemplative reflections, principles, and micro-practices
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="sparks-search-bar">
          <span className="material-symbols-outlined sparks-search-icon">search</span>
          <input
            type="text"
            className="sparks-search-input"
            placeholder="Search reflections, quotes, topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search sparks"
          />
          {searchQuery && (
            <button
              type="button"
              className="sparks-search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            </button>
          )}
        </div>

        {/* Category Filter Pills */}
        <div className="sparks-filter-row" role="tablist" aria-label="Spark categories">
          {categories.map((cat) => (
            <button
              key={cat}
              role="tab"
              aria-selected={selectedCategory === cat}
              className={`sparks-filter-pill ${selectedCategory === cat ? 'active' : ''} btn-pressable`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Main Content Area */}
      {loading ? (
        <div className="sparks-loading-skeletons">
          <div className="spark-featured-skeleton skeleton-shimmer" />
          <div className="sparks-grid-skeletons">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="spark-card-skeleton">
                <div className="spark-thumb-skeleton skeleton-shimmer" />
                <div className="spark-text-skeleton-title skeleton-shimmer" />
                <div className="spark-text-skeleton-sub skeleton-shimmer" />
              </div>
            ))}
          </div>
        </div>
      ) : filteredSparks.length === 0 ? (
        <div className="sparks-empty-state">
          <div className="sparks-empty-icon">
            <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
              auto_awesome
            </span>
          </div>
          <h2 className="sparks-empty-title">No sparks found</h2>
          <p className="sparks-empty-desc">
            {searchQuery
              ? `No reflections matched "${searchQuery}". Try selecting another category or clear your search.`
              : 'New daily reflections will appear here soon.'}
          </p>
        </div>
      ) : (
        <div className="sparks-content-container">
          {/* Featured Spark Card */}
          {featuredSpark && !searchQuery && (
            <section className="featured-spark-section" aria-label="Featured Reflection">
              <span className="sparks-section-kicker">FEATURED SPARK</span>
              <article
                className="featured-spark-card"
                onClick={() => handleSparkCardClick(featuredSpark)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSparkCardClick(featuredSpark)}
              >
                <div className="featured-spark-media-wrap">
                  <ImageWithFallback
                    src={featuredSpark.thumbnail_url || featuredSpark.image}
                    type="spark"
                    alt={featuredSpark.title}
                    className="featured-spark-img"
                  />
                  <div className="featured-spark-overlay" />
                  <span className="featured-spark-cat-badge">
                    {featuredSpark.categoryLabel || featuredSpark.category || 'MINDFULNESS'}
                  </span>
                  {(featuredSpark.is_vip || featuredSpark.isVip) && (
                    <span className="card-vip-badge font-label-sm" style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 2 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>workspace_premium</span>
                      VIP
                    </span>
                  )}
                  <span className="featured-spark-dur-pill">
                    {featuredSpark.duration || '3 min'}
                  </span>
                </div>

                <div className="featured-spark-body">
                  <h2 className="featured-spark-title font-title-lg">
                    {(featuredSpark.is_vip || featuredSpark.isVip)
                      ? `[VIP] ${featuredSpark.title}`
                      : featuredSpark.title}
                  </h2>
                  <p className="featured-spark-quote">
                    &ldquo;{featuredSpark.short_description || featuredSpark.subtitle || featuredSpark.quote}&rdquo;
                  </p>
                  <div className="featured-spark-footer">
                    <button
                      type="button"
                      className="featured-spark-read-btn btn-pressable"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSparkCardClick(featuredSpark);
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                        auto_awesome
                      </span>
                      <span>Read Reflection</span>
                    </button>

                    <button
                      type="button"
                      className={`featured-spark-save-btn ${isSparkSaved(featuredSpark) ? 'saved' : ''} btn-pressable`}
                      onClick={(e) => handleSaveSpark(e, featuredSpark)}
                      aria-label="Save reflection"
                      title={isSparkSaved(featuredSpark) ? 'Saved' : 'Save'}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: '20px',
                          fontVariationSettings: isSparkSaved(featuredSpark) ? "'FILL' 1" : "'FILL' 0"
                        }}
                      >
                        {isSparkSaved(featuredSpark) ? 'bookmark' : 'bookmark_border'}
                      </span>
                    </button>
                  </div>
                </div>
              </article>
            </section>
          )}

          {/* Sparks Library Grid */}
          <section className="sparks-library-section" aria-label="Sparks Library">
            <div className="sparks-library-header">
              <span className="sparks-section-kicker">SPARKS LIBRARY</span>
              <span className="sparks-library-count">{filteredSparks.length} Available</span>
            </div>

            <div className="sparks-library-grid">
              {filteredSparks.map((spark) => {
                const saved = isSparkSaved(spark);
                const isVip = Boolean(spark.is_vip || spark.isVip);

                return (
                  <article
                    key={spark.id || spark.db_id}
                    className="spark-library-card"
                    onClick={() => handleSparkCardClick(spark)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSparkCardClick(spark)}
                    aria-label={`View details for ${spark.title}`}
                  >
                    <div className="spark-library-thumb-wrap">
                      <ImageWithFallback
                        src={spark.thumbnail_url || spark.image}
                        type="spark"
                        alt={spark.title}
                        className="spark-library-thumb-img"
                      />
                      <div className="spark-library-thumb-overlay" />
                      <span className="spark-library-cat-badge">
                        {(spark.categoryLabel || spark.category || 'MINDFULNESS').toUpperCase()}
                      </span>
                      {isVip && (
                        <span className="card-vip-badge font-label-sm" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>workspace_premium</span>
                          VIP
                        </span>
                      )}
                      <span className="spark-library-dur-pill">{spark.duration || '3 min'}</span>
                    </div>

                    <div className="spark-library-card-body">
                      <h3 className="spark-library-title">
                        {isVip ? `[VIP] ${spark.title}` : spark.title}
                      </h3>
                      <p className="spark-library-snippet">
                        {spark.short_description || spark.subtitle || spark.quote || spark.shortPreview}
                      </p>

                      <div className="spark-library-actions-row">
                        <span className="spark-library-read-label">
                          <span>Read</span>
                          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>arrow_forward</span>
                        </span>

                        <button
                          type="button"
                          className={`spark-library-save-btn ${saved ? 'saved' : ''} btn-pressable`}
                          onClick={(e) => handleSaveSpark(e, spark)}
                          aria-label="Save reflection"
                          title={saved ? 'Saved' : 'Save'}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: '18px',
                              fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0"
                            }}
                          >
                            {saved ? 'bookmark' : 'bookmark_border'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
