const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function test() {
  console.log("Testing DB Insert...");
  const { data, error } = await supabase
    .from('ht_phrase_recordings')
    .insert({
      session_id: 'test_session_' + Date.now(),
      phrase_index: 0,
      phrase_kreyol: 'Test phrase',
      audio_url: 'test.webm',
      confidence_score: 'high',
      contributor_name: 'Test',
      contributor_email: 'test@test.com',
      email_opt_in: true
    });
    
  if (error) console.error("DB Error:", error);
  else console.log("DB Insert Success:", data);
}

test();
