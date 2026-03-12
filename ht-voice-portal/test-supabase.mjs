import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envConfig = fs.readFileSync('.env.local', 'utf8');
const env = {};
envConfig.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        env[match[1]] = match[2];
    }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

async function testUploadAndInsert() {
    console.log("1. Testing Storage Upload...");
    const dummyAudio = new Uint8Array([1, 2, 3]);
    const blob = new Blob([dummyAudio], { type: 'audio/webm' });
    const fileName = `test_session_phrase_0_${Date.now()}.webm`;

    const { data: storageData, error: storageError } = await supabase.storage
        .from('ht_training_audio')
        .upload(fileName, blob, { contentType: 'audio/webm' });

    if (storageError) {
        console.error("Storage Error:", storageError);
    } else {
        console.log("Storage Success:", storageData);
    }

    console.log("2. Testing DB Insert...");
    const { data: dbData, error: dbError } = await supabase
        .from('ht_phrase_recordings')
        .insert({
            session_id: 'test_session_' + Date.now(),
            phrase_index: 0,
            phrase_kreyol: 'Test phrase',
            audio_url: fileName,
            confidence_score: 'high',
            contributor_name: 'Test',
            contributor_email: 'test@test.com',
            email_opt_in: true
        });

    if (dbError) {
        console.error("DB Error:", dbError);
    } else {
        console.log("DB Insert Success!");
    }
}

testUploadAndInsert();
