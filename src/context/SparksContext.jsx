import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchSparks } from '../services/sparksService';
import { fetchUserSavedContent, toggleUserSavedContent } from '../services/savedContentService';
import { useAuth } from './AuthContext';

const SparksContext = createContext();

const SCHEMA_VERSION = 'v4.0-sparks-supabase-only';

export const SparksProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();

  const [sparks, setSparks] = useState(() => {
    try {
      const storedVersion = localStorage.getItem('daily_spark_schema_version');
      if (storedVersion !== SCHEMA_VERSION) {
        localStorage.removeItem('daily_spark_items');
        return [];
      }
      const stored = localStorage.getItem('daily_spark_items');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [shareModalSpark, setShareModalSpark] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const [journalNotes, setJournalNotes] = useState(() => {
    try {
      const stored = localStorage.getItem('daily_spark_notes');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  /**
   * Load sparks strictly from Supabase and synchronize with user saved bookmarks
   */
  const loadSparks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch published sparks from Supabase
      const dbSparks = await fetchSparks();
      const validSparks = Array.isArray(dbSparks) ? dbSparks : [];

      // 2. If authenticated, fetch user saved items from public.saved_content
      let userSavedSet = new Set();
      const newSavedMap = new Map();
      if (isAuthenticated && user?.id) {
        const savedRecords = await fetchUserSavedContent(user.id);
        savedRecords.forEach((rec) => {
          if (rec.content_id) {
            userSavedSet.add(rec.content_id);
            newSavedMap.set(`${rec.content_type}:${rec.content_id}`, true);
          }
        });
      }
      setSavedItemsMap(newSavedMap);

      // 3. Merge saved state per user
      const mergedSparks = validSparks.map((spark) => {
        const isUserSaved =
          userSavedSet.has(spark.db_id) ||
          userSavedSet.has(spark.id) ||
          userSavedSet.has(spark.slug) ||
          newSavedMap.has(`spark:${spark.db_id}`) ||
          newSavedMap.has(`spark:${spark.id}`);

        return {
          ...spark,
          saved: isAuthenticated ? isUserSaved : false
        };
      });

      setSparks(mergedSparks);
      localStorage.setItem('daily_spark_items', JSON.stringify(mergedSparks));
      localStorage.setItem('daily_spark_schema_version', SCHEMA_VERSION);
    } catch (err) {
      console.warn('[SparksContext] loadSparks note:', err);
      setError(err.message);
      setSparks([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  // Initial load and reload when auth changes
  useEffect(() => {
    loadSparks();
  }, [loadSparks]);

  // Cache journal notes
  useEffect(() => {
    try {
      localStorage.setItem('daily_spark_notes', JSON.stringify(journalNotes));
    } catch (e) {
      console.warn('LocalStorage notes save failed', e);
    }
  }, [journalNotes]);

  const [savedItemsMap, setSavedItemsMap] = useState(new Map());

  const isContentSaved = useCallback(
    (contentType, contentId) => {
      if (!contentId) return false;
      const key = `${contentType}:${contentId}`;
      if (savedItemsMap.has(key)) return true;
      if (contentType === 'spark') {
        const spark = sparks.find((s) => s.id === contentId || s.db_id === contentId);
        return Boolean(spark?.saved);
      }
      return false;
    },
    [savedItemsMap, sparks]
  );

  /**
   * Universal toggle save bookmark for any content type (spark, video, audio)
   */
  const toggleSaveContent = async (contentType = 'spark', contentId) => {
    if (!contentId) return;

    let targetSpark = null;
    let finalId = contentId;

    if (contentType === 'spark') {
      targetSpark = sparks.find((s) => s.id === contentId || s.db_id === contentId);
      if (targetSpark?.db_id) {
        finalId = targetSpark.db_id;
      }
    }

    const key = `${contentType}:${finalId}`;
    const currentlySaved = isContentSaved(contentType, finalId) || (targetSpark ? targetSpark.saved : false);
    const nextSaved = !currentlySaved;

    // Optimistically update map
    setSavedItemsMap((prev) => {
      const next = new Map(prev);
      if (nextSaved) {
        next.set(key, true);
        if (targetSpark?.id) next.set(`${contentType}:${targetSpark.id}`, true);
      } else {
        next.delete(key);
        if (targetSpark?.id) next.delete(`${contentType}:${targetSpark.id}`);
      }
      return next;
    });

    // If spark, also update sparks array
    if (contentType === 'spark') {
      setSparks((prev) =>
        prev.map((s) => {
          if (s.id === contentId || s.db_id === contentId || (targetSpark && s.id === targetSpark.id)) {
            return { ...s, saved: nextSaved };
          }
          return s;
        })
      );
    }

    showToast(nextSaved ? 'Saved to Personal Archive' : 'Removed from Saved Items');

    // Persist to Supabase if authenticated
    if (isAuthenticated && user?.id) {
      try {
        await toggleUserSavedContent(user.id, contentType, finalId, currentlySaved);
      } catch (err) {
        console.warn('[SparksContext] toggleSaveContent remote error:', err);
      }
    }
  };

  /**
   * Backward-compatible toggle save bookmark for a spark
   */
  const toggleSaveSpark = async (id) => {
    const targetSpark = sparks.find((s) => s.id === id || s.db_id === id);
    const contentId = targetSpark?.db_id || id;
    await toggleSaveContent('spark', contentId);
  };

  const saveJournalNote = (sparkId, note) => {
    setJournalNotes((prev) => ({
      ...prev,
      [sparkId]: note
    }));
    showToast('Reflection note saved');
  };

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((cur) => (cur === message ? null : cur));
    }, 2800);
  };

  const openShare = (spark) => {
    setShareModalSpark(spark);
  };

  const closeShare = () => {
    setShareModalSpark(null);
  };

  const resetData = () => {
    loadSparks();
    setJournalNotes({});
    setSearchQuery('');
    setActiveCategory('all');
    localStorage.removeItem('daily_spark_notes');
    showToast('Archive refreshed from Supabase');
  };

  const savedSparksCount = sparks.filter((s) => s.saved).length;

  return (
    <SparksContext.Provider
      value={{
        sparks,
        loading,
        error,
        refreshSparks: loadSparks,
        savedSparksCount,
        toggleSaveSpark,
        toggleSaveContent,
        isContentSaved,
        activeCategory,
        setActiveCategory,
        searchQuery,
        setSearchQuery,
        shareModalSpark,
        openShare,
        closeShare,
        journalNotes,
        saveJournalNote,
        toastMessage,
        showToast,
        resetData
      }}
    >
      {children}
    </SparksContext.Provider>
  );
};

export const useSparks = () => useContext(SparksContext);
