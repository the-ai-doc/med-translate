-- ==========================================
-- HT VOICE PORTAL: SUPABASE PROVISIONING
-- ==========================================

-- 1. Create the database table for clinical phrase recordings
CREATE TABLE IF NOT EXISTS public.ht_phrase_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT NOT NULL,
    phrase_index INTEGER NOT NULL,
    phrase_kreyol TEXT NOT NULL,
    audio_url TEXT NOT NULL,
    confidence_score TEXT,
    contributor_name TEXT,
    contributor_email TEXT
);

-- Note: If you already ran the previous script, you need to manually add the columns via the SQL Editor:
-- ALTER TABLE public.ht_phrase_recordings ADD COLUMN IF NOT EXISTS confidence_score TEXT;
-- ALTER TABLE public.ht_phrase_recordings ADD COLUMN IF NOT EXISTS contributor_name TEXT;
-- ALTER TABLE public.ht_phrase_recordings ADD COLUMN IF NOT EXISTS contributor_email TEXT;

-- Enable RLS (Row Level Security) for public anon access (insert only)
ALTER TABLE public.ht_phrase_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert to ht_phrase_recordings"
ON public.ht_phrase_recordings
FOR INSERT
TO public
WITH CHECK (true);

-- 2. Create the Storage Bucket for the .webm audio files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('ht_training_audio', 'ht_training_audio', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS for the storage bucket (Allow public uploads)
CREATE POLICY "Allow public uploads to ht_training_audio"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'ht_training_audio');
