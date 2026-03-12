"use client";

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, Play, RefreshCw, UploadCloud, HeartPulse, CheckCircle2, ChevronRight, ChevronLeft, Activity, Info, ShieldCheck, Gift, Download, GraduationCap, Copy, Check, LayoutDashboard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import phrasesData from '@/data/phrases.json';

// --- Types ---
type Phase = 'landing' | 'registration' | 'instructions' | 'dashboard' | 'recording' | 'reviewing' | 'finished';
type Confidence = 'low' | 'medium' | 'high' | null;

// --- Helper func to generate unique session ID ---
const getSessionId = () => {
  if (typeof window !== 'undefined') {
    let sid = localStorage.getItem('ht_session_id');
    if (!sid) {
      sid = 'ses_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('ht_session_id', sid);
    }
    return sid;
  }
  return 'ses_mock';
};


export default function VoicePortal() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitSuccess, setIsSubmitSuccess] = useState(false);
  const [confidence, setConfidence] = useState<Confidence>(null);

  // Contributor Info
  const [contributorName, setContributorName] = useState('');
  const [contributorEmail, setContributorEmail] = useState('');
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [legalConsent, setLegalConsent] = useState(false);

  // New: Dashboard & Progress Tracking
  const [completedPhrases, setCompletedPhrases] = useState<Set<number>>(new Set());
  const [isReRecording, setIsReRecording] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Audio Recording Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Load state
  useEffect(() => {
    // 1. Load completed phrases
    const savedCompleted = localStorage.getItem('ht_completed_phrases');
    let loadedCompleted = new Set<number>();
    if (savedCompleted) {
      loadedCompleted = new Set(JSON.parse(savedCompleted));
    }

    // 2. Load legacy index to migrate if needed
    const savedIdx = localStorage.getItem('ht_current_idx');
    if (savedIdx) {
      const legacyIdx = parseInt(savedIdx, 10);
      setCurrentIdx(legacyIdx);

      // MIGRATION: If no completed phrases exist, but legacy index is > 0, backfill
      if (legacyIdx > 0 && loadedCompleted.size === 0) {
        for (let i = 0; i < legacyIdx; i++) {
          loadedCompleted.add(i);
        }
        localStorage.setItem('ht_completed_phrases', JSON.stringify(Array.from(loadedCompleted)));
      }
    }
    setCompletedPhrases(loadedCompleted);

    // 3. Load contributor details
    const savedName = localStorage.getItem('ht_contributor_name');
    if (savedName) setContributorName(savedName);
    const savedEmail = localStorage.getItem('ht_contributor_email');
    if (savedEmail) setContributorEmail(savedEmail);
    const savedOptIn = localStorage.getItem('ht_email_opt_in');
    if (savedOptIn !== null) {
      setEmailOptIn(savedOptIn === 'true');
    }
    const savedConsent = localStorage.getItem('ht_legal_consent');
    if (savedConsent === 'true') {
      setLegalConsent(true);
    }
  }, []);

  const currentPhrase = phrasesData[currentIdx];

  // --- Handlers ---
  const handleStart = () => {
    // If they already finished all phrases previously, let them start over
    if (currentIdx >= phrasesData.length && completedPhrases.size === phrasesData.length) {
      setCompletedPhrases(new Set());
      localStorage.removeItem('ht_completed_phrases');
      setCurrentIdx(0);
      localStorage.setItem('ht_current_idx', '0');
    }

    if (contributorName && contributorEmail && legalConsent) {
      if (completedPhrases.size > 0) {
        setPhase('dashboard');
      } else {
        setPhase('instructions');
      }
    } else {
      setPhase('registration');
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributorName.trim() || !contributorEmail.trim()) return;
    localStorage.setItem('ht_contributor_name', contributorName);
    localStorage.setItem('ht_contributor_email', contributorEmail);
    localStorage.setItem('ht_email_opt_in', emailOptIn.toString());
    localStorage.setItem('ht_legal_consent', 'true');

    if (completedPhrases.size > 0) {
      setPhase('dashboard');
    } else {
      setPhase('instructions');
    }
  };

  const handleBeginRecording = () => {
    setIsReRecording(false);
    // Find the NEXT uncompleted phrase index
    let nextIdx = 0;
    while (nextIdx < phrasesData.length && completedPhrases.has(nextIdx)) {
      nextIdx++;
    }

    if (nextIdx >= phrasesData.length) {
      setPhase('finished');
    } else {
      setCurrentIdx(nextIdx);
      localStorage.setItem('ht_current_idx', nextIdx.toString());
      setPhase('recording');
    }
  };

  const handleSurgicalReRecord = (phraseIndex: number) => {
    setCurrentIdx(phraseIndex);
    setIsReRecording(true);
    setPhase('recording');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setPhase('reviewing');
        // Stop all tracks to release mic
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing mic:", err);
      alert("Please allow microphone access to record.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleRetake = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setConfidence(null);
    setPhase('recording');
  };

  const handleSkip = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setConfidence(null);

    let nextIdx = currentIdx + 1;

    // If not surgically re-recording, skip already completed phrases
    if (!isReRecording) {
      while (nextIdx < phrasesData.length && completedPhrases.has(nextIdx)) {
        nextIdx++;
      }
    }

    setCurrentIdx(nextIdx);
    localStorage.setItem('ht_current_idx', nextIdx.toString());

    if (nextIdx >= phrasesData.length) {
      setPhase('finished');
    } else {
      setPhase('recording');
    }
  };

  const handlePreviousPhrase = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setConfidence(null);

    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      localStorage.setItem('ht_current_idx', (currentIdx - 1).toString());
      setPhase('recording');
    }
  };

  const handleReturnToDashboard = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setConfidence(null);

    if (completedPhrases.size > 0) setPhase('dashboard');
    else setPhase('instructions');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText('AI4DocsHT');
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code: ', err);
    }
  };

  const handleSubmit = async () => {
    if (!audioBlob || !currentPhrase || !confidence) {
      alert("Please select a confidence score before submitting.");
      return;
    }
    setIsUploading(true);

    try {
      // Create FormData
      const formData = new FormData();
      formData.append('audio', audioBlob, `phrase_${currentPhrase.id}.webm`);
      formData.append('phrase_id', currentPhrase.id.toString());
      formData.append('phrase_kreyol', currentPhrase.kreyol);
      formData.append('session_id', getSessionId());
      formData.append('confidence', confidence);

      // Upload audio to Supabase Storage
      const fileName = `${getSessionId()}_phrase_${currentPhrase.id}_${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from('ht_training_audio')
        .upload(fileName, audioBlob, { contentType: 'audio/webm' });

      if (uploadError) throw uploadError;

      // Save metadata to Supabase DB
      const { error: dbError } = await supabase
        .from('ht_phrase_recordings')
        .insert({
          session_id: getSessionId(),
          phrase_index: currentPhrase.id,
          phrase_kreyol: currentPhrase.kreyol,
          audio_url: fileName,
          confidence_score: confidence,
          contributor_name: contributorName,
          contributor_email: contributorEmail,
          email_opt_in: emailOptIn
        });

      if (dbError) throw dbError;

      // Mark this index as completed locally
      const newCompleted = new Set(completedPhrases);
      newCompleted.add(currentIdx);
      setCompletedPhrases(newCompleted);
      localStorage.setItem('ht_completed_phrases', JSON.stringify(Array.from(newCompleted)));

      setIsSubmitSuccess(true);
      setTimeout(() => {
        setIsSubmitSuccess(false);
        setAudioBlob(null);
        setAudioUrl(null);
        setConfidence(null);

        if (isReRecording) {
          setPhase('dashboard');
          return;
        }

        // Find next uncompleted phrase (sequential flow)
        let nextIdx = currentIdx + 1;
        while (nextIdx < phrasesData.length && newCompleted.has(nextIdx)) {
          nextIdx++;
        }

        setCurrentIdx(nextIdx);
        localStorage.setItem('ht_current_idx', nextIdx.toString());

        if (nextIdx >= phrasesData.length) {
          setPhase('finished');
        } else {
          setPhase('recording');
        }
      }, 1000);
    } catch (err) {
      console.error(err);
      alert("Failed to upload. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const playAudio = () => {
    if (audioPlayerRef.current && audioUrl) {
      audioPlayerRef.current.play();
    }
  };

  // --- Render Components ---
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden bg-gradient-to-br from-sab-50 to-sab-100">

      {/* Decorative Background Elements - Subtle Haitian Colors */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#00209F]/15 rounded-full filter blur-[100px] animate-pulse-slow"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#D21034]/10 rounded-full filter blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.5s' }}></div>

      <div className="z-10 w-full max-w-2xl mx-auto">
        <AnimatePresence mode="wait">

          {/* LANDING PHASE */}
          {phase === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card rounded-3xl p-10 text-center flex flex-col items-center"
            >
              {/* Premium minimal Haitian Flag Badge */}
              <div className="flex items-center gap-2 mb-8 px-4 py-1.5 bg-white/70 backdrop-blur-md rounded-full border border-slate-200/50 shadow-sm transition-all hover:bg-white hover:scale-105 cursor-default group">
                <div className="w-5 h-5 rounded-full overflow-hidden flex flex-col shadow-inner border border-slate-200">
                  <div className="h-1/2 bg-[#00209F] transition-all group-hover:bg-blue-600"></div>
                  <div className="h-1/2 bg-[#D21034] transition-all group-hover:bg-red-600"></div>
                </div>
                <span className="text-[11px] font-bold tracking-widest uppercase text-slate-500 group-hover:text-slate-700 transition-colors">Haitian Creole Dataset</span>
              </div>

              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-xl shadow-[#00209F]/20 relative overflow-hidden border border-white/40">
                {/* Subtle Dual Tone Background inside Icon */}
                <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[#00209F] to-[#1e3a8a]"></div>
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#D21034] to-[#ea580c]"></div>
                {/* Subtle center blur block representing the coat of arms */}
                <div className="absolute inset-0 m-auto w-10 h-8 bg-white/20 backdrop-blur-sm rounded max-w-[50%]"></div>

                {/* Main Icon */}
                <HeartPulse className="w-10 h-10 text-white relative z-10 drop-shadow-md" />
              </div>

              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4 tracking-tight">
                Give Kreyòl a Voice<br /><span className="text-lanme-500">in AI Healthcare.</span>
              </h1>
              <div className="text-left space-y-4 text-slate-600 mb-10 max-w-lg leading-relaxed">
                <p>
                  <strong className="text-lanme-900">The Problem:</strong> When a Haitian patient walks into a hospital, AI translation tools fail them. Standard AI models are trained heavily on French text but drastically lack authentic, spoken Haitian Creole data.
                </p>
                <p>
                  <strong className="text-lanme-900">The Mission:</strong> We are building a high-fidelity, open-source Voice AI specifically tuned for clinical Haitian Creole. To do this, we need *real* voices reading standard and phonetic phrases.
                </p>
                <p>
                  By donating your voice today, you ensure that future medical AI tools can speak perfectly with nuance, empathy, and accuracy, breaking critical language barriers in healthcare.
                </p>
              </div>

              <button
                onClick={handleStart}
                className="group relative flex items-center justify-center gap-3 w-full sm:w-auto px-10 py-4 bg-flanm-500 hover:bg-flanm-600 text-white rounded-full font-semibold text-lg transition-all shadow-lg shadow-flanm-500/30 hover:shadow-xl hover:shadow-flanm-500/40 hover:-translate-y-0.5"
              >
                <span>Join the Mission</span>
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>

              <p className="mt-8 text-sm text-slate-400 font-medium">
                No patient data involved. This is strictly open-source AI training.
              </p>
            </motion.div>
          )}

          {/* REGISTRATION PHASE */}
          {phase === 'registration' && (
            <motion.div
              key="registration"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass-card rounded-3xl p-8 md:p-10"
            >
              <button
                onClick={() => setPhase('landing')}
                className="flex items-center text-slate-500 hover:text-slate-800 font-medium mb-6 text-sm transition-colors"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Back to Home
              </button>
              <div className="flex items-center gap-3 mb-6">
                <Activity className="w-8 h-8 text-lanme-500" />
                <h2 className="text-3xl font-bold text-lanme-950">Who is contributing?</h2>
              </div>
              <p className="text-slate-600 mb-8 max-w-md">
                We need your name and email so we can properly credit your contribution to this open-source model and track the source of our highest-quality data.
              </p>

              <form onSubmit={handleRegister} className="space-y-5">
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-lanme-900 mb-2">Full Name or Handle</label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={contributorName}
                    onChange={(e) => setContributorName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-lanme-500 focus:ring-2 focus:ring-lanme-500/20 bg-white/50 backdrop-blur-sm transition-all outline-none text-slate-800"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-lanme-900 mb-2">Email Address</label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={contributorEmail}
                    onChange={(e) => setContributorEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-lanme-500 focus:ring-2 focus:ring-lanme-500/20 bg-white/50 backdrop-blur-sm transition-all outline-none text-slate-800"
                    placeholder="jane@example.com"
                  />
                </div>

                <label className="relative flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-white/50 cursor-pointer hover:border-lanme-300 transition-all text-sm text-slate-700">
                  <div className="flex tracking-tight h-5 items-center">
                    <input
                      type="checkbox"
                      checked={emailOptIn}
                      onChange={(e) => setEmailOptIn(e.target.checked)}
                      className="w-5 h-5 rounded border-slate-300 text-lanme-600 focus:ring-lanme-500 focus:ring-offset-0 cursor-pointer"
                    />
                  </div>
                  <div>
                    <span className="font-semibold text-lanme-900 block mb-0.5">Keep me updated</span>
                    <span className="text-slate-500">I would like to receive an occasional email updating me on the progress of the open source model.</span>
                  </div>
                </label>

                <div className="pt-2 border-t border-slate-200">
                  <label className="relative flex items-start gap-3 p-4 rounded-xl border border-flanm-200 bg-flanm-50/50 cursor-pointer hover:border-flanm-300 transition-all text-sm text-slate-700">
                    <div className="flex tracking-tight h-5 items-center">
                      <input
                        type="checkbox"
                        required
                        checked={legalConsent}
                        onChange={(e) => setLegalConsent(e.target.checked)}
                        className="w-5 h-5 rounded border-flanm-300 text-flanm-500 focus:ring-flanm-500 focus:ring-offset-0 cursor-pointer"
                      />
                    </div>
                    <div>
                      <span className="font-bold text-flanm-900 block mb-0.5">Digital Consent & Release *</span>
                      <span className="text-slate-600 text-xs">
                        I understand that I am donating my voice recordings to an open-source clinical AI dataset.
                        I grant a perpetual, irrevocable, worldwide, royalty-free license to use, reproduce, and distribute these recordings for the purpose of training MedTranslate AI models.
                        No patient data or protected health information (PHI) will be recorded.
                      </span>
                    </div>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={!legalConsent}
                  className="w-full py-4 bg-lanme-950 hover:bg-lanme-900 text-white rounded-xl font-semibold text-lg transition-all shadow-md mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </form>
            </motion.div>
          )}

          {/* DASHBOARD PHASE */}
          {phase === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card rounded-3xl p-6 md:p-8 flex flex-col h-[85vh] max-h-[800px] w-full max-w-3xl border border-lanme-100"
            >
              {/* Header */}
              <div className="flex-shrink-0 mb-6 border-b border-lanme-100 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setContributorName('');
                        setContributorEmail('');
                        localStorage.removeItem('ht_contributor_name');
                        localStorage.removeItem('ht_contributor_email');
                        localStorage.removeItem('ht_email_opt_in');
                        setPhase('landing');
                      }}
                      className="p-1 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
                      title="Sign Out"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex flex-col shadow-inner border border-slate-200">
                          <div className="h-1/2 bg-[#00209F]"></div>
                          <div className="h-1/2 bg-[#D21034]"></div>
                        </div>
                        <span className="text-[9px] font-bold tracking-widest uppercase text-slate-400">MedTranslate: Haitian Creole</span>
                      </div>
                      <h2 className="text-2xl font-bold text-slate-900 leading-none mt-1">Your Dashboard</h2>
                    </div>
                  </div>
                  <div className="px-4 py-1.5 bg-lanme-100 text-lanme-800 rounded-full font-bold text-sm">
                    {completedPhrases.size} / {phrasesData.length} Done
                  </div>
                </div>
                <p className="text-slate-500 text-sm">
                  Welcome back, {contributorName}! You can re-record past phrases or continue exactly where you left off.
                </p>
              </div>

              {/* Scrollable List */}
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar mb-6">
                {phrasesData.map((phrase, idx) => {
                  const isDone = completedPhrases.has(idx);
                  return (
                    <div
                      key={phrase.id}
                      className={`p-4 rounded-2xl flex items-center justify-between gap-4 border transition-all ${isDone ? 'bg-white/60 border-lanme-200' : 'bg-slate-50/50 border-slate-100'
                        }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-slate-400">#{phrase.id}</span>
                          {isDone ? (
                            <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-sm tracking-wider">
                              <CheckCircle2 className="w-3 h-3" /> Submitted
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-sm tracking-wider">
                              Pending
                            </span>
                          )}
                        </div>
                        <p className={`text-md truncate font-medium ${isDone ? 'text-lanme-950' : 'text-slate-500'}`}>
                          {phrase.kreyol}
                        </p>
                      </div>

                      <button
                        onClick={() => handleSurgicalReRecord(idx)}
                        className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${isDone
                          ? 'bg-lanme-100 hover:bg-lanme-200 text-lanme-700'
                          : 'bg-flanm-500 hover:bg-flanm-600 text-white shadow-md'
                          }`}
                      >
                        {isDone ? 'Re-record' : 'Record'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Action */}
              <div className="flex-shrink-0 pt-4 border-t border-lanme-100 flex items-center justify-between">
                <button
                  onClick={() => setPhase('instructions')}
                  className="text-slate-500 hover:text-slate-800 text-sm font-medium transition-colors"
                >
                  Review Instructions
                </button>
                <button
                  onClick={handleBeginRecording}
                  className="flex items-center gap-2 px-8 py-4 bg-lanme-950 hover:bg-lanme-900 text-white rounded-xl font-bold shadow-lg shadow-lanme-900/20 transition-all hover:-translate-y-0.5"
                >
                  {completedPhrases.size < phrasesData.length ? 'Continue Recording' : 'You are all done!'}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}

          {/* INSTRUCTIONS PHASE */}
          {phase === 'instructions' && (
            <motion.div
              key="instructions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass-card rounded-3xl p-8 md:p-10"
            >
              <button
                onClick={() => completedPhrases.size > 0 ? setPhase('dashboard') : setPhase('registration')}
                className="flex items-center text-slate-500 hover:text-slate-800 font-medium mb-6 text-sm transition-colors"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </button>

              <div className="flex items-center gap-3 mb-6">
                <ShieldCheck className="w-8 h-8 text-lanme-500" />
                <h2 className="text-2xl font-bold text-lanme-950">Recording Best Practices</h2>
              </div>

              <div className="space-y-6 text-slate-700 mb-8">
                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-xl border border-white shadow-sm">🤫</div>
                  <div>
                    <h3 className="font-semibold text-lanme-900 mb-1">Quiet Environment</h3>
                    <p className="text-sm">Find a completely silent space. Turn off fans, AC, and televisions. Background noise heavily degrades the AI model&apos;s quality.</p>
                  </div>
                </div>

                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-xl border border-white shadow-sm">🗣️</div>
                  <div>
                    <h3 className="font-semibold text-lanme-900 mb-1">Clinical & Natural Tone</h3>
                    <p className="text-sm">Speak authoritative yet empathetic. Use a normal speaking volume—do not whisper and do not yell.</p>
                  </div>
                </div>

                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-xl border border-white shadow-sm">🎵</div>
                  <div>
                    <h3 className="font-semibold text-lanme-900 mb-1">Pacing & Prosody</h3>
                    <p className="text-sm">Please pause naturally at commas and periods. Read exactly what is written to help the AI learn proper Caribbean inflections.</p>
                  </div>
                </div>

                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-xl border border-white shadow-sm">🔬</div>
                  <div>
                    <h3 className="font-semibold text-lanme-900 mb-1">Weird Phrases?</h3>
                    <p className="text-sm">You will see random non-medical phrases. This is intentional to teach the AI every possible phonetic sound in Kreyòl.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleBeginRecording}
                className="w-full py-4 bg-lanme-950 hover:bg-lanme-900 text-white rounded-xl font-semibold text-lg transition-all shadow-md"
              >
                I Understand, Let&apos;s Go
              </button>
            </motion.div>
          )}

          {/* RECORDING & REVIEWING PHASE */}
          {(phase === 'recording' || phase === 'reviewing') && currentPhrase && (
            <motion.div
              key="studio"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="w-full flex flex-col items-center relative pt-8"
            >
              {/* Dashboard Return Button */}
              <button
                onClick={handleReturnToDashboard}
                className="flex items-center text-slate-500 hover:text-slate-800 font-medium text-sm transition-colors absolute top-0 left-0"
              >
                <LayoutDashboard className="w-4 h-4 mr-1.5" /> Dashboard
              </button>

              {/* Progress Tracker with Explicit Navigation */}
              <div className="w-full flex justify-between items-center mb-6 px-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-lanme-500" />
                  <span className="font-semibold text-lanme-950">MedTranslate Studio</span>
                </div>
                <div className="flex items-center bg-white/60 backdrop-blur-md rounded-full p-1 shadow-sm border border-white">
                  <button
                    onClick={handlePreviousPhrase}
                    disabled={currentIdx === 0}
                    className="p-1.5 rounded-full hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    title="Previous Phrase"
                  >
                    <ChevronLeft className="w-4 h-4 text-lanme-900" />
                  </button>
                  <span className="text-sm font-semibold text-lanme-900 px-3 min-w-[70px] text-center">
                    {currentIdx + 1} / {phrasesData.length}
                  </span>
                  <button
                    onClick={handleSkip}
                    disabled={currentIdx >= phrasesData.length - 1}
                    className="p-1.5 rounded-full hover:bg-slate-200 disabled:opacity-30 transition-colors"
                    title="Next Phrase"
                  >
                    <ChevronRight className="w-4 h-4 text-lanme-900" />
                  </button>
                </div>
              </div>

              {/* The Phrase Card */}
              <div className="glass-card w-full rounded-3xl p-8 md:p-12 text-center mb-8 relative overflow-hidden min-h-[250px] md:min-h-[280px] flex flex-col justify-center">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-lanme-500 to-flanm-500"></div>
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Read Aloud</p>
                <h2 className="text-3xl md:text-4xl font-bold text-lanme-950 mb-3 leading-tight font-[family-name:var(--font-outfit)]">
                  {currentPhrase.kreyol}
                </h2>
                <p className="text-lg text-slate-500 italic mt-6">
                  &quot;{currentPhrase.english}&quot;
                </p>
              </div>

              {/* The Action Zone */}
              <div className="w-full flex flex-col items-center justify-center">
                {phase === 'recording' ? (
                  <div className="w-full flex flex-col items-center justify-center gap-6 mt-4 pb-8">
                    <button
                      onClick={toggleRecording}
                      className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isRecording ? 'bg-flanm-500 scale-110 shadow-[0_0_40px_rgba(249,115,22,0.4)]' : 'bg-lanme-950 hover:bg-lanme-900 shadow-xl'}`}
                    >
                      {isRecording ? (
                        <Square className="w-8 h-8 text-white animate-pulse" fill="currentColor" />
                      ) : (
                        <Mic className="w-10 h-10 text-white" />
                      )}
                      {/* Pulse rings when recording */}
                      {isRecording && (
                        <>
                          <span className="absolute w-full h-full rounded-full border-2 border-flanm-500 animate-ping opacity-75"></span>
                          <span className="absolute w-[150%] h-[150%] rounded-full border border-flanm-500 animate-pulse-slow opacity-20"></span>
                        </>
                      )}
                    </button>
                    <div className="flex flex-col items-center gap-2">
                      <p className={`text-sm font-medium ${isRecording ? 'text-flanm-500' : 'text-slate-400'}`}>
                        {isRecording ? 'Recording! Tap to stop.' : 'Tap to record'}
                      </p>
                      {!isRecording && (
                        <button onClick={handleSkip} className="text-xs text-slate-400 font-medium hover:text-slate-600 underline underline-offset-2 mt-2">
                          Skip this phrase
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full flex flex-col items-center gap-6 pb-6">
                    {/* Confidence Rating */}
                    <div className="w-full bg-white/50 border border-white p-4 rounded-2xl flex flex-col items-center gap-3">
                      <p className="text-sm font-semibold text-lanme-900 flex items-center gap-2">
                        <Info className="w-4 h-4" /> How confident are you in this pronunciation?
                      </p>
                      <div className="flex gap-2 w-full max-w-sm">
                        {(['low', 'medium', 'high'] as Confidence[]).map((level) => (
                          <button
                            key={level as string}
                            onClick={() => setConfidence(level)}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg capitalize border transition-all ${confidence === level
                              ? 'bg-lanme-950 text-white border-lanme-950 shadow-md'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-lanme-500 hover:bg-lanme-50'
                              }`}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="w-full flex items-center justify-center gap-4">
                      {audioUrl && <audio ref={audioPlayerRef} src={audioUrl} className="hidden" onEnded={() => { }} />}

                      <button
                        onClick={handleRetake}
                        className="w-14 h-14 rounded-full bg-white text-slate-500 shadow-sm border border-slate-100 flex items-center justify-center hover:bg-slate-50 hover:scale-105 transition-all"
                        title="Retake"
                      >
                        <RefreshCw className="w-5 h-5" />
                      </button>

                      <button
                        onClick={playAudio}
                        className="flex items-center justify-center gap-2 px-6 h-14 bg-white text-lanme-950 rounded-full font-bold shadow-md border border-lanme-100 hover:bg-slate-50 hover:scale-105 transition-all"
                        title="Listen to your recording"
                      >
                        <Play className="w-5 h-5" fill="currentColor" />
                        <span>Listen Back</span>
                      </button>

                      <button
                        onClick={handleSubmit}
                        disabled={isUploading || isSubmitSuccess || !confidence}
                        className={`flex items-center justify-center gap-2 px-8 h-16 rounded-full font-semibold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isSubmitSuccess
                          ? 'bg-emerald-500 text-white'
                          : 'bg-lanme-950 text-white hover:bg-lanme-900 hover:shadow-xl hover:-translate-y-1 disabled:hover:translate-y-0'
                          }`}
                      >
                        {isUploading ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : isSubmitSuccess ? (
                          <>
                            <Check className="w-5 h-5" />
                            <span>Submitted!</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud className="w-5 h-5" />
                            <span>Submit</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </motion.div>
          )}

          {/* FINISHED PHASE */}
          {phase === 'finished' && (
            <motion.div
              key="finished"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-3xl p-10 text-center flex flex-col items-center"
            >
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-3xl font-bold text-lanme-950 mb-4">
                Thank you{contributorName ? `, ${contributorName.split(' ')[0]}` : ''}!
              </h2>
              <p className="text-lg text-slate-600 mb-8 max-w-md">
                You have completed all {phrasesData.length} phrases. Your recordings will be permanently encoded into an open-source medical AI to help thousands of Haitian patients. Mèsi anpil!
              </p>

              {/* Enhanced Reward Section */}
              <div className="w-full max-w-2xl bg-slate-50 border border-slate-200 rounded-3xl p-8 mb-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                  <Gift className="w-32 h-32" />
                </div>

                <div className="relative z-10">
                  <h3 className="text-xl font-bold text-slate-900 mb-2 flex items-center gap-2">
                    <Gift className="w-5 h-5 text-lanme-500" /> A Gift For Your Time
                  </h3>
                  <p className="text-sm text-slate-600 mb-6 max-w-md">
                    Because you contributed to an open-source AI project, I want to give you access to two of my premium AI resources.
                  </p>

                  <div className="flex flex-col md:flex-row gap-4">
                    {/* Murmur Gift */}
                    <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-5 text-left flex flex-col hover:border-lanme-300 transition-colors shadow-sm">
                      <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mb-4">
                        <Mic className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-900 mb-1">Murmur AI Dictation</h4>
                      <p className="text-xs text-slate-500 mb-4 flex-grow">
                        My new privacy-first local dictation application. Yours free.
                      </p>
                      <a
                        href="https://murmur.theaidoc.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold transition-colors"
                      >
                        <Download className="w-4 h-4" /> Download Beta
                      </a>
                    </div>

                    {/* AI Doc Course Gift */}
                    <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-5 text-left flex flex-col hover:border-lanme-300 transition-colors shadow-sm">
                      <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4">
                        <GraduationCap className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-900 mb-1">The AI Doc Course</h4>
                      <p className="text-xs text-slate-500 mb-4 flex-grow">
                        Learn how to build medical AI tools exactly like this one.
                      </p>
                      <div className="space-y-2 relative">
                        <button
                          onClick={handleCopy}
                          className="w-full flex items-center justify-between px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg group hover:border-emerald-300 transition-all cursor-pointer"
                          title="Copy Promo Code"
                        >
                          <span className="font-mono text-xs font-bold text-slate-700">
                            {isCopied ? 'COPIED TO CLIPBOARD!' : 'CODE: AI4DocsHT'}
                          </span>
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-500" />
                          )}
                        </button>
                        <a
                          href="https://course.theaidoc.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
                        >
                          Claim Discount
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => { setCurrentIdx(0); setPhase('recording'); localStorage.setItem('ht_current_idx', '0'); }}
                className="text-slate-400 text-sm font-medium hover:text-lanme-600 transition-colors"
              >
                Restart Recording Queue
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </main>
  );
}
