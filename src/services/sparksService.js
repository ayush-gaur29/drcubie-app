import { supabase } from '../lib/supabase.js';

/**
 * Normalizes a database row from 'sparks' (with optional joined videos & audios)
 * into the shape expected across the UI (cards, detail reader, audio player).
 * Maps directly to Supabase columns without inventing mock values.
 */
export const normalizeSpark = (dbSpark, fallback = null) => {
  if (!dbSpark) return fallback;

  const video = dbSpark.videos || null;
  const audio = dbSpark.audios || null;

  // Split practice string into actionable bullet steps if not already an array
  let practiceSteps = [];
  if (dbSpark.practice) {
    practiceSteps = dbSpark.practice
      .split(/(?:\r\n|\r|\n|\. )+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
  }

  const slug = dbSpark.slug || dbSpark.id;

  return {
    id: slug,
    db_id: dbSpark.id,
    slug: dbSpark.slug || '',
    title: dbSpark.title || '',
    subtitle: dbSpark.short_description || dbSpark.reflection || '',
    short_description: dbSpark.short_description || '',
    category: (dbSpark.category || '').toLowerCase(),
    categoryLabel: dbSpark.category || '',
    duration: dbSpark.duration || '',
    audioDuration: audio?.duration_seconds || 0,
    date: dbSpark.created_at
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
          new Date(dbSpark.created_at)
        )
      : '',
    saved: false, // populated dynamically per authenticated user
    type: video ? 'video' : 'audio',
    isVideo: Boolean(video),
    icon: video ? 'play_circle' : 'auto_awesome',
    quote: dbSpark.reflection || '',
    quoteAttribution: '— Dr. Cubie',
    narrator: audio?.speaker || '',
    audioTitle: audio?.title || '',
    audioSubtitle: audio?.description || '',
    audioUrl: audio?.audio_url || '',
    shortPreview: dbSpark.short_description || '',
    image: dbSpark.thumbnail_url || '',
    thumbnail_url: dbSpark.thumbnail_url || '',
    fallbackImage: '',
    detailImage: dbSpark.thumbnail_url || '',
    videoUrl: video?.video_url || '',
    videoDuration: video?.duration || '',
    videoPoster: video?.thumbnail_url || dbSpark.thumbnail_url || '',
    video_id: dbSpark.video_id || video?.id || null,
    audio_id: dbSpark.audio_id || audio?.id || null,
    video: video
      ? {
          id: video.id,
          title: video.title || dbSpark.title || '',
          description: video.description || dbSpark.short_description || '',
          videoUrl: video.video_url || '',
          video_url: video.video_url || '',
          posterUrl: video.thumbnail_url || dbSpark.thumbnail_url || '',
          thumbnail_url: video.thumbnail_url || dbSpark.thumbnail_url || '',
          duration: video.duration || '',
          durationSeconds: video.duration_seconds || 0,
          category: video.category || dbSpark.category || ''
        }
      : null,
    audio: audio
      ? {
          id: audio.id,
          title: audio.title || dbSpark.title || '',
          description: audio.description || '',
          audioUrl: audio.audio_url || '',
          audio_url: audio.audio_url || '',
          thumbnailUrl: audio.thumbnail_url || dbSpark.thumbnail_url || '',
          duration: audio.duration || '',
          durationSeconds: audio.duration_seconds || 0,
          category: audio.category || dbSpark.category || '',
          speaker: audio.speaker || ''
        }
      : null,
    videos: video,
    audios: audio,
    insight: dbSpark.insight || '',
    practice: dbSpark.practice || '',
    introParagraph: dbSpark.short_description || '',
    principleHeading: 'The Principle',
    principleText: dbSpark.reflection || '',
    introspectivePrompt: '',
    practiceHeading: "Today's Practice",
    practiceSteps,
    is_vip: Boolean(dbSpark.is_vip),
    isVip: Boolean(dbSpark.is_vip),
    status: dbSpark.status || 'published',
    created_at: dbSpark.created_at
  };
};

/**
 * Fetch all published sparks from Supabase sparks table.
 * Returns joined video and audio relations.
 * Strictly returns database records only; no mock or fallback data.
 */
export const fetchSparks = async () => {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('sparks')
      .select(`
        id,
        slug,
        title,
        short_description,
        category,
        duration,
        thumbnail_url,
        reflection,
        insight,
        practice,
        status,
        is_vip,
        created_at,
        videos (
          id,
          title,
          video_url,
          thumbnail_url,
          duration,
          duration_seconds,
          category,
          is_vip
        ),
        audios (
          id,
          title,
          description,
          audio_url,
          duration,
          duration_seconds,
          speaker,
          is_vip
        )
      `)
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[SparksService] fetchSparks database warning:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    return data.map((item) => normalizeSpark(item));
  } catch (err) {
    console.error('[SparksService] fetchSparks exception:', err);
    return [];
  }
};

/**
 * Fetch single spark by slug or UUID strictly from Supabase sparks table.
 */
export const fetchSparkById = async (slugOrId) => {
  if (!slugOrId || !supabase) return null;

  try {
    // Check if parameter is a valid UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slugOrId);
    let query = supabase
      .from('sparks')
      .select(`
        id,
        slug,
        title,
        short_description,
        category,
        duration,
        thumbnail_url,
        reflection,
        insight,
        practice,
        status,
        is_vip,
        created_at,
        videos (*),
        audios (*)
      `)
      .eq('status', 'published');

    if (isUuid) {
      query = query.or(`id.eq.${slugOrId},slug.eq.${slugOrId}`);
    } else {
      query = query.eq('slug', slugOrId);
    }

    const { data, error } = await query.maybeSingle();

    if (!error && data) {
      return normalizeSpark(data);
    }
  } catch (err) {
    console.warn('[SparksService] fetchSparkById exception:', err);
  }

  return null;
};

// In-flight promise cache to prevent duplicate simultaneous daily_content queries
let inFlightTodayPromise = null;

/**
 * Fetch Today's scheduled Spark from 'daily_content'.
 */
export const fetchTodayContent = async () => {
  if (!supabase) {
    return {
      dailyContentId: null,
      contentDate: new Intl.DateTimeFormat('en-CA').format(new Date()),
      todaySpark: null,
      scheduledVideo: null,
      scheduledAudio: null,
      quote: null,
      quoteAuthor: 'Dr. Cubie'
    };
  }

  if (inFlightTodayPromise) {
    return inFlightTodayPromise;
  }

  inFlightTodayPromise = (async () => {
    try {
      const todayStr = new Intl.DateTimeFormat('en-CA').format(new Date()); // YYYY-MM-DD

      // 1. Try exact today date
      let { data, error } = await supabase
        .from('daily_content')
        .select(`
          id,
          content_date,
          status,
          sparks (
            id,
            slug,
            title,
            short_description,
            category,
            duration,
            thumbnail_url,
            reflection,
            insight,
            practice,
            status,
            is_vip,
            created_at,
            videos (*),
            audios (*)
          )
        `)
        .eq('content_date', todayStr)
        .eq('status', 'published')
        .maybeSingle();

      if (error) {
        console.error('[SparksService] fetchTodayContent query error:', error);
      }

      // 2. If no record for today's exact date, fetch the most recent published daily content
      if (!data && !error) {
        const { data: latestData, error: latestError } = await supabase
          .from('daily_content')
          .select(`
            id,
            content_date,
            status,
            sparks (
              id,
              slug,
              title,
              short_description,
              category,
              duration,
              thumbnail_url,
              reflection,
              insight,
              practice,
              status,
              is_vip,
              created_at,
              videos (*),
              audios (*)
            )
          `)
          .eq('status', 'published')
          .order('content_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestError) {
          console.error('[SparksService] fetchTodayContent latest query error:', latestError);
        } else {
          data = latestData;
        }
      }

      if (data?.sparks) {
        const sparkRaw = data.sparks;

        // If join didn't populate videos/audios, resolve them individually if IDs exist
        if (sparkRaw.video_id && !sparkRaw.videos) {
          const { data: vRow } = await supabase.from('videos').select('*').eq('id', sparkRaw.video_id).maybeSingle();
          if (vRow) sparkRaw.videos = vRow;
        }
        if (sparkRaw.audio_id && !sparkRaw.audios) {
          const { data: aRow } = await supabase.from('audios').select('*').eq('id', sparkRaw.audio_id).maybeSingle();
          if (aRow) sparkRaw.audios = aRow;
        }

        const normalizedSpark = normalizeSpark(sparkRaw, null);

        const v = sparkRaw.videos;
        const scheduledVideo = v ? {
          id: v.id,
          title: v.title || sparkRaw.title || '',
          description: v.description || sparkRaw.short_description || '',
          videoUrl: v.video_url || '',
          video_url: v.video_url || '',
          posterUrl: v.thumbnail_url || sparkRaw.thumbnail_url || '',
          thumbnail_url: v.thumbnail_url || sparkRaw.thumbnail_url || '',
          duration: v.duration || '',
          durationSeconds: v.duration_seconds || 0,
          category: v.category || sparkRaw.category || '',
          sparkId: sparkRaw.slug || sparkRaw.id,
          sparkDbId: sparkRaw.id
        } : null;

        const a = sparkRaw.audios;
        const scheduledAudio = a ? {
          id: a.id,
          title: a.title || sparkRaw.title || '',
          description: a.description || '',
          audioUrl: a.audio_url || '',
          audio_url: a.audio_url || '',
          thumbnailUrl: a.thumbnail_url || sparkRaw.thumbnail_url || '',
          duration: a.duration || '',
          durationSeconds: a.duration_seconds || 0,
          category: a.category || sparkRaw.category || '',
          speaker: a.speaker || '',
          sparkId: sparkRaw.slug || sparkRaw.id,
          sparkDbId: sparkRaw.id
        } : null;

        return {
          dailyContentId: data.id,
          contentDate: data.content_date,
          todaySpark: normalizedSpark,
          scheduledVideo,
          scheduledAudio,
          quote: sparkRaw.reflection || null,
          quoteAuthor: 'Dr. Cubie'
        };
      }
    } catch (err) {
      console.error('[SparksService] fetchTodayContent exception:', err);
    } finally {
      // Clear in-flight cache shortly after completion to allow fresh queries on subsequent navigations
      setTimeout(() => {
        inFlightTodayPromise = null;
      }, 500);
    }

    return {
      dailyContentId: null,
      contentDate: new Intl.DateTimeFormat('en-CA').format(new Date()),
      todaySpark: null,
      scheduledVideo: null,
      scheduledAudio: null,
      quote: null,
      quoteAuthor: 'Dr. Cubie'
    };
  })();

  return inFlightTodayPromise;
};
