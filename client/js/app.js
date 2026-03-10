/**
 * MedTranslate Client Application
 * Slidable mic: left = EN->target, right = target->EN
 * Timer only runs during active recording
 */

var CONFIG = {
  API_URL: 'https://med-translate-production.up.railway.app',
  WS_URL: 'wss://med-translate-production.up.railway.app/ws',
  RECONNECT_DELAY: 2000,
  RECONNECT_MAX_DELAY: 30000,
  HEARTBEAT_INTERVAL: 25000
};

var LANGUAGES = {
  es: { name: 'Spanish', speechCode: 'es-ES' },
  ht: { name: 'Haitian Creole', speechCode: 'ht' },
  fr: { name: 'French', speechCode: 'fr-FR' },
  pt: { name: 'Portuguese', speechCode: 'pt-BR' },
  ru: { name: 'Russian', speechCode: 'ru-RU' },
  zh: { name: 'Mandarin', speechCode: 'zh-CN' },
  ar: { name: 'Arabic', speechCode: 'ar-SA' },
  vi: { name: 'Vietnamese', speechCode: 'vi-VN' },
  tl: { name: 'Tagalog', speechCode: 'tl-PH' },
  en: { name: 'English', speechCode: 'en-US' }
};

var state = {
  screen: 'session',
  specialty: 'anesthesia',
  selectedLang: 'es',
  targetLocale: 'es-US',
  direction: { from: 'en', to: 'es' },
  session: { id: null, active: false },
  recognition: null,
  isRecording: false,
  ws: { socket: null, reconnectAttempts: 0, connected: false, heartbeatTimer: null },
  // Recording timer
  recStartTime: null,
  recStopTime: 0,
  recElapsed: 0,
  recTimerInterval: null,
  // Slider
  sliderSide: 'left',  // 'left' = EN->target, 'right' = target->EN
  isDragging: false,
  dragStartX: 0,
  // Interview Flow
  interview: { active: false, stepIndex: 0, answers: [] },
  // Settings
  settings: { ttsEnabled: true, speechRate: 1.0 }
};

var audioUnlocked = false;

// Initialize a persistent HTML5 audio tag for iOS streaming.
window.currentAudioSource = null;

var INTERVIEW_FLOWS = {
  preop: [
    "Are you having any pain right now?",
    "When was the last time you had anything to eat or drink?",
    "Do you have any allergies to medications?",
    "Do you have any problems with your heart or lungs?",
    "Have you or anyone in your family had problems with anesthesia?"
  ],
  induction: [
    "I'm going to place this oxygen mask on your face.",
    "Please take deep, slow breaths of the oxygen.",
    "You will feel a little burn in your IV as the medicine goes in.",
    "Think of a happy place as you fall asleep."
  ],
  postop: [
    "The surgery is all done and everything went well.",
    "You are in the recovery room. Are you having any pain?",
    "Take deep breaths and try to open your eyes.",
    "Do you feel sick to your stomach or nauseous?"
  ],
  pain: [
    "Are you currently experiencing any pain?",
    "Can you point to exactly where it hurts?",
    "On a scale of 0 to 10, with 10 being the worst pain, what is your pain level?",
    "Is the pain sharp, dull, throbbing, or aching?"
  ]
};
var INTERVIEW_QUESTIONS = INTERVIEW_FLOWS.preop;

var sessionScreen, langCards, specialtyCards;
var connectionDot, sessionTimer, activeFrom, activeTo;
var waveformStatus, statusText;
var originalText, translatedText, micToggle, toastEl;
var sliderTrack, sliderHint, sliderLabelLeft, sliderLabelRight;
var interviewControls, startInterviewBtn, interviewNextBtn, interviewSkipBtn;
var summaryScreen, summaryContent, closeSummaryBtn;

// Context Drawer UI
var contextPillBtn, contextDrawer, contextDrawerOverlay, contextCloseBtn;
var pillFlagImg, pillLangName, pillSpecialtyIcon, pillSpecialtyName;

function cacheDom() {
  sessionScreen = document.querySelector('#session-screen');
  specialtyCards = document.querySelectorAll('.specialty-card');
  langCards = document.querySelectorAll('.lang-flag-card');
  connectionDot = document.querySelector('#connection-dot');
  sessionTimer = document.querySelector('#session-timer');
  waveformStatus = document.querySelector('#waveform-status');
  statusText = document.querySelector('#status-text');
  originalText = document.querySelector('#original-text');
  translatedText = document.querySelector('#translated-text');
  micToggle = document.querySelector('#mic-toggle');
  toastEl = document.querySelector('#toast');
  sliderTrack = document.querySelector('#slider-track');
  sliderHint = document.querySelector('#slider-hint');
  sliderLabelLeft = document.querySelector('#slider-label-left');
  sliderLabelRight = document.querySelector('#slider-label-right');

  interviewControls = document.querySelector('#interview-controls');
  startInterviewBtn = document.querySelector('#start-interview-btn');
  interviewNextBtn = document.querySelector('#interview-next-btn');
  interviewSkipBtn = document.querySelector('#interview-skip-btn');

  summaryScreen = document.querySelector('#summary-screen');
  summaryContent = document.querySelector('#summary-content');
  closeSummaryBtn = document.querySelector('#close-summary-btn');

  // Context UI
  contextPillBtn = document.querySelector('#context-pill-btn');
  contextDrawer = document.querySelector('#context-drawer');
  contextDrawerOverlay = document.querySelector('#context-drawer-overlay');
  contextCloseBtn = document.querySelector('#context-close-btn');
  pillFlagImg = document.querySelector('#pill-flag-img');
  pillLangName = document.querySelector('#pill-lang-name');
  pillSpecialtyIcon = document.querySelector('#pill-specialty-icon');
  pillSpecialtyName = document.querySelector('#pill-specialty-name');
}

function showScreen(name) {
  state.screen = name;
  if (sessionScreen) sessionScreen.classList.toggle('hidden', name !== 'session');

  // Push natively into the device history stack to intercept back swipes
  if (window.history.state?.screen !== name) {
    window.history.pushState({ screen: name }, '', '#' + name);
  }
}

// Intercept native device back-swipe to route backward instead of quitting
window.addEventListener('popstate', function (e) {
  if (e.state && e.state.screen) {
    showScreen(e.state.screen);
  } else {
    // Default fallback if unknown state
    showScreen('session');
  }
});

function showToast(message, type) {
  // Toast notifications disabled per user request to improve UX
  console.log("Toast (disabled):", message);
}

// Global Web Audio Context for native iOS WKWebView bridging
window.audioCtx = null;

function unlockAudio() {
  if (audioUnlocked || !('speechSynthesis' in window)) return;

  try {
    // 1. Initialize the global AudioContext if it doesn't exist
    if (!window.audioCtx) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      window.audioCtx = new AudioContext();
    }

    // 2. Resume the context in case it started suspended
    if (window.audioCtx.state === 'suspended') {
      window.audioCtx.resume();
    }

    // 3. Create and play an empty, silent 1-frame buffer to authorize the context
    var buffer = window.audioCtx.createBuffer(1, 1, 22050);
    var source = window.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(window.audioCtx.destination);

    // Modern iOS requires start(0) inside a user interaction to unlock
    if (source.start) {
      source.start(0);
    } else if (source.play) {
      source.play(0); // Fallback for extremely old webkit
    }

    // Check if the context successfully transitioned to running
    if (window.audioCtx.state === 'running') {
      audioUnlocked = true;
      console.log('Web Audio Context formally unlocked and running');
    }

    // We no longer try to use speechSynthesis or data URIs to hack the unlock.
    // The Web Audio context correctly authorizes the entire domain for background iOS media.
  } catch (e) {
    console.warn('Failed to unlock Web Audio context:', e);
  }
}

// Proactive Global Unlocker: Unlock on the very first touch anywhere in the app
document.body.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
document.body.addEventListener('click', unlockAudio, { once: true, passive: true });

/* ── Context Drawer & Setup ── */
function initContextDrawer() {
  // Pre-select initial visual states for language and specialty
  var esCard = Array.from(langCards).find(c => c.dataset.lang === 'es');
  if (esCard) esCard.classList.add('selected');

  var anesCard = Array.from(specialtyCards).find(c => c.dataset.specialty === 'anesthesia');
  if (anesCard) anesCard.classList.add('selected');

  if (contextPillBtn && contextDrawer && contextDrawerOverlay) {
    contextPillBtn.addEventListener('click', function () {
      // global document listener now handles unlocking
      contextDrawer.classList.remove('hidden');
      contextDrawerOverlay.classList.remove('hidden');
    });

    function closeDrawer() {
      contextDrawer.classList.add('hidden');
      contextDrawerOverlay.classList.add('hidden');
    }

    if (contextCloseBtn) contextCloseBtn.addEventListener('click', closeDrawer);
    contextDrawerOverlay.addEventListener('click', closeDrawer);
  }

  // Specialty Selection
  specialtyCards.forEach(function (card) {
    card.addEventListener('click', function () {
      // global document listener now handles unlocking
      specialtyCards.forEach(function (c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      state.specialty = card.dataset.specialty;

      var specialtyName = card.querySelector('span').textContent;
      var svgHtml = card.querySelector('svg').outerHTML;

      if (pillSpecialtyName) pillSpecialtyName.textContent = specialtyName;
      if (pillSpecialtyIcon) pillSpecialtyIcon.outerHTML = svgHtml.replace('<svg', '<svg id="pill-specialty-icon" width="14" height="14"');
      pillSpecialtyIcon = document.querySelector('#pill-specialty-icon'); // Re-cache the newly swapped SVG

      updateDynamicUI();
      // Auto-close drawer slightly after clicking to let user see selection
      setTimeout(function () {
        contextDrawer.classList.add('hidden');
        contextDrawerOverlay.classList.add('hidden');
      }, 350);
    });
  });

  // Language Selection
  langCards.forEach(function (card) {
    card.addEventListener('click', function () {
      // global document listener now handles unlocking
      langCards.forEach(function (c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      state.selectedLang = card.dataset.lang;
      state.targetLocale = card.dataset.locale || card.dataset.lang;
      state.direction.to = card.dataset.lang;

      var langName = card.querySelector('.lang-name').textContent;
      var flagSrc = card.querySelector('img').src;

      if (pillLangName) pillLangName.textContent = langName;
      if (pillFlagImg) pillFlagImg.src = flagSrc;

      updateDirectionFromSlider();
      updateDirectionDisplay();
      updateSliderLabels();

      // Ensure the websocket protocol knows about the language change, but doing it natively seamlessly
      showToast('Switched language to ' + langName, 'success');

      // Auto-close drawer slightly after clicking
      setTimeout(function () {
        contextDrawer.classList.add('hidden');
        contextDrawerOverlay.classList.add('hidden');
      }, 350);
    });
  });
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function startSession() {
  try {
    state.session.id = generateUUID();
    state.session.active = true;
    // Set initial direction based on slider
    updateDirectionFromSlider();
    updateDirectionDisplay();
    // Update slider labels for the selected language
    updateSliderLabels();
    await connectWebSocket();
    showScreen('session');
    setStatus('ready');
    snapSlider('left');
    updateDynamicUI();
    updateInterviewButtonLabels();
    sessionTimer.textContent = '0:00';
    showToast('Connected! Hold to talk (slide to change language)', 'success');
  } catch (err) {
    showToast('Failed to connect: ' + err.message);
    state.session.active = false;
  }
}

function endSession() {
  state.session.active = false;
  stopRecording();
  stopRecTimer();
  if (state.ws.socket && state.ws.socket.readyState === WebSocket.OPEN) {
    state.ws.socket.send(JSON.stringify({ type: 'end_session', session_id: state.session.id }));
    state.ws.socket.close(1000);
  }
  state.ws = { socket: null, reconnectAttempts: 0, connected: false };
  showToast('Session ended', 'success');

  // If the user wants to truly end and restart, just reset the session internally since setup screens are gone
  startSession();
}

/* ── Recording Timer ── */
function startRecTimer() {
  state.recStartTime = Date.now();
  sessionTimer.classList.add('active');
  state.recTimerInterval = setInterval(function () {
    var ms = Date.now() - state.recStartTime + state.recElapsed;
    var secs = Math.floor(ms / 1000);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    sessionTimer.textContent = m + ':' + String(s).padStart(2, '0');
  }, 250);
}

function stopRecTimer() {
  if (state.recTimerInterval) {
    clearInterval(state.recTimerInterval);
    state.recTimerInterval = null;
  }
  if (state.recStartTime) {
    state.recElapsed += Date.now() - state.recStartTime;
    state.recStartTime = null;
  }
  sessionTimer.classList.remove('active');
}

/* ── Slider Logic ── */
function updateSliderLabels() {
  var target = (state.selectedLang || 'es').toUpperCase();
  // Left label (visible when snapped RIGHT): TARGET -> EN
  sliderLabelLeft.innerHTML =
    '<span class="slider-lang">' + target + '</span>' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
    '<span class="slider-lang">EN</span>';
  // Right label (visible when snapped LEFT): EN -> TARGET
  sliderLabelRight.innerHTML =
    '<span class="slider-lang">EN</span>' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
    '<span class="slider-lang">' + target + '</span>';
  highlightActiveLabel();
}

function highlightActiveLabel() {
  sliderLabelLeft.classList.toggle('active-side', state.sliderSide === 'left');
  sliderLabelRight.classList.toggle('active-side', state.sliderSide === 'right');
}

function updateDirectionFromSlider() {
  if (state.sliderSide === 'left') {
    state.direction.from = 'en';
    state.direction.to = state.selectedLang || 'es';
  } else {
    state.direction.from = state.selectedLang || 'es';
    state.direction.to = 'en';
  }
}

function updateDirectionDisplay() {
  // EN>ES badge removed from UI — direction tracked in state.direction only
}

function snapSlider(side) {
  state.sliderSide = side;
  micToggle.classList.remove('snapped-left', 'snapped-right');
  micToggle.classList.add('snapped-' + side);
  micToggle.style.left = '';
  micToggle.style.right = '';
  micToggle.style.transform = '';
  updateDirectionFromSlider();
  updateDirectionDisplay();
  highlightActiveLabel();

  var target = (state.selectedLang || 'es').toUpperCase();
  if (side === 'left') {
    sliderHint.textContent = 'EN \u2192 ' + target + '  \u00b7  Hold to speak';
  } else {
    sliderHint.textContent = target + ' \u2192 EN  \u00b7  Hold to speak';
  }
  updateDynamicUI();
}

const INSTRUCTIONS = {
  en: "Hold mic to speak",
  es: "Deslice el micrófono y mantenga para hablar",
  ht: "Glise mikwo a ak kenbe pou pale",
  pt: "Deslize o microfone e segure para falar",
  ru: "Сдвиньте микрофон и удерживайте, чтобы говорить",
  zh: "滑动麦克风并按住以讲话",
  ar: "حرك الميكروفون مع الاستمرار للتحدث",
  vi: "Trượt micrô và giữ để nói",
  tl: "I-slide ang mic at diinan para magsalita"
};

const PRESET_TRANSLATIONS = {
  "Allergies?": {
    en: "Do you have any allergies to medications?",
    es: "¿Tiene alguna alergia a medicamentos?",
    ht: "Èske ou gen nenpòt alèji ak medikaman?",
  },
  "Last Meal?": {
    en: "When was the last time you had anything to eat or drink?",
    es: "¿Cuándo fue la última vez que comió o bebió algo?",
    ht: "Kilè se dènye fwa ou te manje oswa bwè anyen?",
  },
  "Chest Pain?": {
    en: "Are you currently experiencing any chest pain or shortness of breath?",
    es: "¿Está experimentando actualmente algún dolor de pecho o falta de aire?",
    ht: "Èske w ap fè eksperyans nenpòt doulè nan pwatrin oswa souf kout kounye a?",
  },
  "Medical History?": {
    en: "Do you have any chronic medical problems like high blood pressure, diabetes, asthma, seizures, or stroke?",
    es: "¿Tiene problemas médicos crónicos como presión alta, diabetes, asma, convulsiones o derrames cerebrales?",
    ht: "Èske ou gen pwoblèm medikal tankou tansyon wo, dyabèt, opresyon, kriz, oswa konjesyon?",
  },
  "Anesthesia Issues?": {
    en: "Have you or anyone in your family ever had problems with anesthesia?",
    es: "¿Alguien en su familia o usted ha tenido problemas con la anestesia alguna vez?",
    ht: "Èske ou oswa nenpòt moun nan fanmi ou te gen pwoblèm ak anestezi?",
  },
  "Blood Thinners?": {
    en: "Are you currently taking any blood thinners?",
    es: "¿Está tomando actualmente anticoagulantes (diluyentes de la sangre)?",
    ht: "Èske w ap pran okenn medikaman pou fè san an pi klè kounye a?",
  },
  "Implants/Dentures?": {
    en: "Do you have any loose teeth, dentures, or metal implants?",
    es: "¿Tiene dientes flojos, dentaduras postizas o implantes metálicos?",
    ht: "Èske w gen dan k ap jwe, dan atifisyèl, oswa nenpòt metal nan kò w?",
  },
  "Smoke/Drink?": {
    en: "Do you smoke, drink alcohol, or use any recreational drugs?",
    es: "¿Fuma, bebe alcohol o usa drogas recreativas?",
    ht: "Èske w fimen, bwè alkòl, oswa sèvi ak dwòg tanzantan?",
  },
  "Pain?": {
    en: "Are you experiencing any pain right now? Can you point to where it hurts?",
    es: "¿Está experimentando algún dolor en este momento? ¿Puede señalar dónde le duele?",
    ht: "Èske w gen nenpòt doulè kounye a? Èske w ka montre kote l fè w mal la?",
  }
};

function updateDynamicUI() {
  if (!state.session.active) return;
  const srcLang = state.direction.from || 'en';

  // 1. Update the placeholder instructions
  if (!state.isRecording && originalText.textContent.includes('Slide') || originalText.textContent.includes('speak') || Object.values(INSTRUCTIONS).includes(originalText.textContent)) {
    originalText.textContent = INSTRUCTIONS[srcLang] || INSTRUCTIONS['en'];
    translatedText.textContent = '\u2014';
  }

  // 2. Loop through preset items and automatically cast text into correct source language
  const presetItems = document.querySelectorAll('.preset-item');
  presetItems.forEach(item => {
    // Only target the Quick Phrases, ignore Interview flow preset
    if (item.id === 'start-interview-btn') return;

    const rawHTML = item.innerHTML.trim();
    const key = rawHTML.replace(/<[^>]*>?/gm, '').trim();


    const localMatrix = PRESET_TRANSLATIONS[key];
    if (localMatrix) {
      const translated = localMatrix[srcLang] || localMatrix['en'];
      item.setAttribute('data-text', translated);
    }
  });
}

function initSlider() {
  var SNAP_THRESHOLD = 0.3; // 30% from edge to snap
  var holdTimer = null;
  var hasDragged = false;

  function getTrackBounds() {
    return sliderTrack.getBoundingClientRect();
  }

  function getClientX(e) {
    if (e.touches && e.touches.length > 0) return e.touches[0].clientX;
    return e.clientX;
  }

  function onPointerDown(e) {
    if (state.isRecording) return;

    // Unlock iOS audio synchronously with the touch gesture
    unlockAudio();

    e.preventDefault();
    state.isDragging = true;
    hasDragged = false;
    state.dragStartX = getClientX(e);

    // Start a hold timer - if user holds without dragging, start recording
    holdTimer = setTimeout(function () {
      if (!hasDragged) {
        state.isDragging = false;
        startRecording();
      }
    }, 300);
  }

  function onPointerMove(e) {
    if (!state.isDragging) return;
    e.preventDefault();
    var cx = getClientX(e);
    var delta = Math.abs(cx - state.dragStartX);
    if (delta > 10) hasDragged = true;
    if (!hasDragged) return;

    // Cancel hold timer if dragging
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }

    var bounds = getTrackBounds();
    var thumbW = 56;
    var trackInner = bounds.width - thumbW - 8; // 4px padding each side
    var relX = cx - bounds.left - thumbW / 2 - 4;
    relX = Math.max(0, Math.min(relX, trackInner));
    var pct = relX / trackInner;

    micToggle.classList.remove('snapped-left', 'snapped-right');
    micToggle.style.left = (4 + relX) + 'px';
    micToggle.style.right = 'auto';
    micToggle.style.transform = 'translateX(0)';
  }

  function onPointerUp(e) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }

    if (state.isRecording) {
      // User released while recording
      stopRecording();
      return;
    }

    if (!state.isDragging) return;
    state.isDragging = false;

    if (!hasDragged && !state.isRecording) {
      // Pure tap, no drag — enforce 'Hold to Talk' instead of getting stuck
      showToast('Hold to speak', 'warning');
      return;
    }

    // Determine snap side from current position
    var bounds = getTrackBounds();
    var thumbW = 56;
    var currentLeft = micToggle.getBoundingClientRect().left - bounds.left;
    var pct = currentLeft / (bounds.width - thumbW);

    if (pct < SNAP_THRESHOLD) {
      snapSlider('left');
    } else if (pct > (1 - SNAP_THRESHOLD)) {
      snapSlider('right');
    } else {
      // Snap back to current side
      snapSlider(state.sliderSide);
    }
  }

  // Touch events
  micToggle.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('touchend', onPointerUp, { passive: false });
  document.addEventListener('touchcancel', onPointerUp, { passive: false });

  // Mouse events
  micToggle.addEventListener('mousedown', onPointerDown);
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseup', onPointerUp);
}

/* ── Session Controls ── */
function initSessionControls() {
  initSlider();
}

function startRecording() {
  if (!state.session.active || state.isRecording) return;

  // CRITICAL iOS FIX: Stop any playing Web Audio source before 
  // engaging the microphone. Otherwise, iOS WebKit's AVAudioSession transition from 
  // 'Playback' to 'PlayAndRecord' will permanently brick the audio engine (-66748).
  if (window.currentAudioSource) {
    try { window.currentAudioSource.stop(); } catch (e) { }
    window.currentAudioSource = null;
  }

  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) { showToast('Speech recognition not supported'); return; }

  state.isRecording = true;
  micToggle.classList.add('recording');
  setStatus('listening');
  startRecTimer();
  originalText.textContent = 'Listening...';
  translatedText.textContent = '\u2014';

  var origBubble = document.querySelector('#original-transcript');
  var transBubble = document.querySelector('#translated-transcript');
  if (origBubble) origBubble.classList.remove('active');
  if (transBubble) transBubble.classList.remove('active');

  var rec = new SpeechRec();
  rec.continuous = false;
  rec.interimResults = true;
  var langInfo = LANGUAGES[state.direction.from];
  rec.lang = langInfo ? langInfo.speechCode : 'en-US';
  rec.maxAlternatives = 1;

  var latestTranscript = '';

  rec.onresult = function (event) {
    var lastIdx = event.results.length - 1;
    var result = event.results[lastIdx];
    var transcript = result[0].transcript;
    originalText.textContent = transcript;
    latestTranscript = transcript.trim();
    console.log('Speech:', transcript, 'isFinal:', result.isFinal);
  };

  rec.onerror = function (event) {
    console.warn('Speech error:', event.error);
    if (event.error === 'not-allowed') {
      showToast('Microphone permission denied');
      finishRecording();
    } else if (event.error === 'no-speech') {
      console.log('No speech yet...');
    } else if (event.error === 'network') {
      showToast('Network needed for speech recognition');
      finishRecording();
    }
  };

  rec.onend = function () {
    console.log('Recognition ended. isRecording:', state.isRecording, 'transcript:', latestTranscript);
    if (state.isRecording && (!latestTranscript || latestTranscript.length < 2)) {
      console.log('No speech yet, restarting');
      try { rec.start(); return; } catch (e) { console.warn('Restart failed:', e); }
    }
    if (state.isRecording) state.isRecording = false;

    if (latestTranscript && latestTranscript.length > 1) {
      originalText.textContent = latestTranscript;
      sendForTranslation(latestTranscript);
    } else {
      originalText.textContent = 'No speech detected - try again';
      setStatus('ready');
    }
    finishRecording();
  };

  try {
    rec.start();
    state.recognition = rec;
    console.log('Recording started, lang:', rec.lang, 'direction:', state.direction.from, '->', state.direction.to);
  } catch (e) {
    console.error('Failed to start:', e);
    showToast('Could not start speech recognition');
    finishRecording();
  }
}

function stopRecording() {
  if (!state.isRecording) return;
  console.log('Stop recording');
  state.isRecording = false;
  state.recStopTime = Date.now();
  stopRecTimer();
  if (state.recognition) {
    try { state.recognition.stop(); } catch (e) { }
  }
}

function finishRecording() {
  state.isRecording = false;
  state.recStopTime = Date.now();
  stopRecTimer();
  micToggle.classList.remove('recording');
  state.recognition = null;
}

function sendForTranslation(text) {
  setStatus('translating');
  console.log('Translating:', text, state.direction.from, '->', state.direction.to);
  if (state.ws.connected && state.ws.socket && state.ws.socket.readyState === WebSocket.OPEN) {
    state.ws.socket.send(JSON.stringify({
      type: 'translate',
      text: text,
      from: state.direction.from,
      to: state.direction.to,
      session_id: state.session.id
    }));
  } else {
    showToast('Not connected to server');
    setStatus('ready');
  }
}

function startHeartbeat(ws) {
  stopHeartbeat();
  state.ws.heartbeatTimer = setInterval(function () {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, CONFIG.HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (state.ws.heartbeatTimer) {
    clearInterval(state.ws.heartbeatTimer);
    state.ws.heartbeatTimer = null;
  }
}

function connectWebSocket() {
  return new Promise(function (resolve, reject) {
    try {
      var ws = new WebSocket(CONFIG.WS_URL);
      var timeout = setTimeout(function () { ws.close(); reject(new Error('Connection timeout')); }, 8000);

      ws.onopen = function () {
        clearTimeout(timeout);
        state.ws.socket = ws;
        state.ws.connected = true;
        state.ws.reconnectAttempts = 0;
        connectionDot.classList.remove('disconnected');
        startHeartbeat(ws);
        ws.send(JSON.stringify({
          type: 'start_session',
          session_id: state.session.id,
          from: state.direction.from,
          to: state.direction.to
        }));
        resolve();
      };

      ws.onmessage = function (event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.type === 'pong') return; // ignore heartbeat replies
          console.log('WS:', msg);
          if (msg.type === 'translation') {
            var origText = originalText.textContent;
            translatedText.textContent = msg.text;
            var origB = document.querySelector('#original-transcript');
            var transB = document.querySelector('#translated-transcript');
            if (origB) origB.classList.add('active');
            if (transB) {
              transB.dataset.originalText = origText;
              transB.classList.add('active');
            }

            // Append to history log
            appendHistory(origText, msg.text, state.direction);

            // Capture Patient Answer in Interview Flow
            if (state.interview && state.interview.active && state.sliderSide === 'right' && state.direction.to === 'en') {
              state.interview.answers[state.interview.stepIndex] = msg.text;
              setStatus('ready');
            } else {
              setStatus('speaking');
              if (state.settings.ttsEnabled) {
                speakTranslation(msg.text, state.direction.to);
              } else {
                setTimeout(handlePostSpeech, 800);
              }
            }
          } else if (msg.type === 'error') {
            showToast(msg.message);
            setStatus('ready');
          }
        } catch (e) { console.warn('WS parse error:', e); }
      };

      ws.onclose = function () {
        state.ws.connected = false;
        stopHeartbeat();
        connectionDot.classList.add('disconnected');
        if (state.session.active) {
          state.ws.reconnectAttempts++;
          var delay = Math.min(
            CONFIG.RECONNECT_DELAY * Math.pow(1.5, state.ws.reconnectAttempts),
            CONFIG.RECONNECT_MAX_DELAY
          );
          setTimeout(function () {
            connectWebSocket().catch(function (e) { console.warn('Reconnect fail:', e); });
          }, delay);
        }
      };

      ws.onerror = function () {
        clearTimeout(timeout);
        if (state.ws.reconnectAttempts === 0) reject(new Error('Cannot connect'));
      };
    } catch (err) { reject(err); }
  });
}

function speakTranslation(text, lang) {
  // Ultra-low latency streaming TTS (ElevenLabs Turbo v2.5) via HTTP streaming.
  // We use this as primary to get empathetic, high-fidelity human voices 
  // without the 2-second block delay of standard cloud APIs.
  playStreamingAudio(text, lang);
}

function handlePostSpeech() {
  setStatus('ready');
  var srcLang = state.direction.from || 'en';
  originalText.textContent = INSTRUCTIONS[srcLang] || INSTRUCTIONS['en'];

  // Auto-listen for patient response in Interview Flow
  if (state.interview && state.interview.active && state.sliderSide === 'left') {
    setTimeout(function () {
      snapSlider('right'); // Switch target -> EN
      startRecording();    // Auto activate mic
    }, 500);
  }

  setTimeout(function () {
    var origB = document.querySelector('#original-transcript');
    var transB = document.querySelector('#translated-transcript');
    if (origB) origB.classList.remove('active');
    if (transB) transB.classList.remove('active');
  }, 2000);
}

function playBrowserVoice(text, lang) {
  if (!('speechSynthesis' in window)) { setStatus('ready'); return; }

  // Flush the queue. This is required on iOS to prevent the engine from freezing.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
  }

  var utterance = new SpeechSynthesisUtterance(text);
  var langInfo = LANGUAGES[lang];
  var targetCode = langInfo ? langInfo.speechCode : lang;
  utterance.lang = targetCode;

  // Attempt to select a high-quality voice
  var voices = speechSynthesis.getVoices();
  if (voices.length > 0) {
    // Filter voices matching our target language abbreviation (e.g. "en" or "es")
    var matchingVoices = voices.filter(function (v) {
      return v.lang.toLowerCase().startsWith(targetCode.split('-')[0].toLowerCase());
    });

    // Specifically target Apple's high-fidelity voices
    var bestVoice = matchingVoices.find(function (v) { return v.name.includes('Premium') || v.name.includes('Enhanced'); })
      || matchingVoices.find(function (v) { return v.name.includes('Siri'); })
      || matchingVoices[0];

    if (bestVoice) {
      utterance.voice = bestVoice;
    }
  }

  utterance.rate = state.settings.speechRate || 0.9;
  utterance.pitch = 1.0;
  utterance.onend = handlePostSpeech;
  utterance.onerror = function () { setStatus('ready'); };
  speechSynthesis.speak(utterance);
}

function playStreamingAudio(text, lang) {
  setStatus('speaking');

  var fallbackTriggered = false;
  function triggerFallback(err, source) {
    if (fallbackTriggered) return;
    fallbackTriggered = true;
    console.warn('Streaming Audio ' + source + ' failed:', err, 'falling back to browser voice');
    playBrowserVoice(text, lang);
  }

  // We abandon <audio> tags entirely on iOS because they fatally collide with SpeechRecognition
  // for the hardware AVAudioSession. Instead, we use the pre-unlocked AudioContext.

  if (window.currentAudioSource) {
    try { window.currentAudioSource.stop(); } catch (e) { }
    window.currentAudioSource = null;
  }

  if (!window.audioCtx || window.audioCtx.state === 'closed') {
    console.warn("AudioContext closed, falling back to browser voice");
    return triggerFallback(new Error("Context locked"), 'webaudio');
  }

  var url = CONFIG.API_URL + '/api/tts?text=' + encodeURIComponent(text) + '&lang=' + encodeURIComponent(lang);

  // CRITICAL iOS FIX: AVAudioSession hardware collision.
  // ElevenLabs is so fast that the audio payload arrives before the iPad's 
  // hardware microphone session has fully yielded back to Playback mode.
  // We must guarantee at least 600ms has passed since the microphone closed.
  var timeSinceMicClosed = Date.now() - (state.recStopTime || 0);
  var safetyDelay = Math.max(0, 600 - timeSinceMicClosed);

  setTimeout(function () {
    // Explicitly check and attempt to resume the context inside the timeout
    // because iOS might have suspended it when tearing down the microphone.
    if (window.audioCtx && window.audioCtx.state === 'suspended') {
      try { window.audioCtx.resume(); } catch (e) { }
    }

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.arrayBuffer();
      })
      .then(function (arrayBuffer) {
        return window.audioCtx.decodeAudioData(arrayBuffer);
      })
      .then(function (audioBuffer) {
        var source = window.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(window.audioCtx.destination);

        // Match playback rate setting
        source.playbackRate.value = state.settings.speechRate || 1.0;

        source.onended = function () {
          handlePostSpeech();
          window.currentAudioSource = null;
        };

        source.start(0);
        window.currentAudioSource = source;
      })
      .catch(function (err) {
        triggerFallback(err, 'fetch_decode');
      });
  }, safetyDelay);
}

/* ── Interview Flow ── */
function initInterviewFlow() {
  var presetBtns = document.querySelectorAll('.preset-workflow-btn');
  if (presetBtns) {
    presetBtns.forEach(btn => {
      btn.addEventListener('click', function (e) {
        // global document listener now handles unlocking
        startInterviewFlow(e);
      });
    });
  }

  if (interviewNextBtn) interviewNextBtn.addEventListener('click', advanceInterview);
  if (interviewSkipBtn) interviewSkipBtn.addEventListener('click', endInterview);
  if (closeSummaryBtn) {
    closeSummaryBtn.addEventListener('click', function () {
      summaryScreen.classList.add('hidden');
    });
  }
}

function startInterviewFlow(e) {
  const flowKey = e ? (e.currentTarget.getAttribute('data-flow') || 'preop') : 'preop';
  INTERVIEW_QUESTIONS = INTERVIEW_FLOWS[flowKey] || INTERVIEW_FLOWS.preop;

  state.interview.active = true;
  state.interview.stepIndex = -1;
  state.interview.answers = [];

  document.getElementById('presets-menu').classList.add('hidden');
  document.getElementById('presets-toggle-btn').classList.remove('active');
  interviewControls.classList.remove('hidden');
  interviewControls.style.display = 'flex';
  updateInterviewButtonLabels();

  advanceInterview();
}

function advanceInterview() {
  state.interview.stepIndex++;

  if (state.interview.stepIndex >= INTERVIEW_QUESTIONS.length) {
    endInterview();
    return;
  }

  const question = INTERVIEW_QUESTIONS[state.interview.stepIndex];
  originalText.textContent = question;

  // Doctor -> Patient (Force left side)
  snapSlider('left');
  sendForTranslation(question);
}

/* Bilingual interview button labels */
var INTERVIEW_LABELS = {
  next: {
    en: 'Next Question', es: 'Siguiente Pregunta', ht: 'Kestyon Swivan',
    fr: 'Question Suivante', pt: 'Próxima Pergunta', ru: 'Следующий Вопрос',
    zh: '下一个问题', ar: 'السؤال التالي', vi: 'Câu Hỏi Tiếp', tl: 'Susunod na Tanong'
  },
  end: {
    en: 'End Flow', es: 'Terminar', ht: 'Fini',
    fr: 'Terminer', pt: 'Encerrar', ru: 'Завершить',
    zh: '结束', ar: 'إنهاء', vi: 'Kết Thúc', tl: 'Tapusin'
  }
};

function updateInterviewButtonLabels() {
  var lang = state.selectedLang || 'es';
  var nextEN = INTERVIEW_LABELS.next.en;
  var nextLocal = INTERVIEW_LABELS.next[lang] || nextEN;
  var endEN = INTERVIEW_LABELS.end.en;
  var endLocal = INTERVIEW_LABELS.end[lang] || endEN;

  if (interviewNextBtn) {
    interviewNextBtn.innerHTML = nextEN === nextLocal ? nextEN : nextEN + ' / ' + nextLocal;
  }
  if (interviewSkipBtn) {
    interviewSkipBtn.innerHTML = endEN === endLocal ? endEN : endEN + ' / ' + endLocal;
  }
}

function endInterview() {
  state.interview.active = false;
  interviewControls.classList.add('hidden');
  stopRecording();
  renderSummary();
}

function renderSummary() {
  summaryContent.innerHTML = '';

  if (state.interview.answers.length === 0) {
    summaryContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No answers recorded.</p>';
  } else {
    state.interview.answers.forEach((ans, i) => {
      summaryContent.innerHTML += `
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px;">
          <div style="font-size: 0.8rem; color: var(--accent); margin-bottom: 0.4rem;">Q: ${INTERVIEW_QUESTIONS[i] || 'Question'}</div>
          <div style="color: var(--text-primary);">A: ${ans}</div>
        </div>
      `;
    });
  }

  summaryScreen.classList.remove('hidden');
}


function setStatus(s) {
  waveformStatus.className = 'waveform-status ' + s;
  var labels = {
    ready: 'Ready',
    listening: 'Recording...',
    translating: 'Translating...',
    speaking: 'Speaking...'
  };
  statusText.textContent = labels[s] || 'Ready';
}

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { }
  }
}

function initManualInput() {
  const manualInput = document.getElementById('manual-text-input');
  const manualSendBtn = document.getElementById('manual-text-send-btn');

  if (manualInput && manualSendBtn) {
    function sendManual() {
      const text = manualInput.value.trim();
      if (text && state.session.active) {
        // Assume user speaks in matching source language (doctor typing english)
        snapSlider('left');
        originalText.textContent = text;
        sendForTranslation(text);
        manualInput.value = '';
        manualInput.blur();
      }
    }
    manualSendBtn.addEventListener('click', sendManual);
    manualInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') sendManual();
    });
  }
}

function initReplay() {
  var transBubble = document.getElementById('translated-transcript');
  if (transBubble) {
    transBubble.addEventListener('click', function () {
      if (!state.settings || state.settings.tts === false) return; // Respect TTS mute
      var tText = document.getElementById('translated-text').textContent;
      // Do not replay if empty or placeholder dash
      if (tText && tText.trim() !== '' && !tText.includes('—')) {
        var oText = transBubble.dataset.originalText;
        var origNode = document.getElementById('original-text');
        if (oText && origNode) origNode.textContent = oText;
        speakTranslation(tText, state.direction.to);
      }
    });
  }
}

function init() {
  cacheDom();
  initContextDrawer();
  initSessionControls();
  initPresetsMenu();
  initInterviewFlow();
  initManualInput();
  initSettings();
  initReplay();
  registerSW();

  // Pre-load voices on init to eliminate first-playback audio latency
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); };
    }
  }

  // Immediately start session instead of a login screen
  startSession();
}

/* ── History Log ── */
function appendHistory(original, translated, direction) {
  var log = document.getElementById('history-log');
  if (!log || !original || original === 'Hold mic to speak') return;
  var entry = document.createElement('div');
  entry.className = 'history-entry';
  entry.title = "Click to replay audio";
  var fromLabel = (direction.from || 'en').toUpperCase();
  var toLabel = (direction.to || 'es').toUpperCase();
  entry.innerHTML = `
    <div class="hist-original">${fromLabel}: ${original}</div>
    <div class="hist-translated">${toLabel}: ${translated}</div>
    <div class="hist-meta">
      ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      <span style="float:right; color:var(--accent); display:flex; align-items:center; gap:0.25rem;">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" /></svg>
        <span>Replay</span>
      </span>
    </div>
  `;

  entry.addEventListener('click', function () {
    if (!state.settings || state.settings.tts === false) return;

    // Animate the background slightly to show it was clicked
    entry.style.background = 'rgba(255, 255, 255, 0.08)';
    setTimeout(function () { entry.style.background = 'rgba(255, 255, 255, 0.02)'; }, 200);

    // Also restore the text to the main view when replaying history
    var origNode = document.getElementById('original-text');
    var transNode = document.getElementById('translated-text');
    if (origNode) origNode.textContent = original;
    if (transNode) transNode.textContent = translated;

    speakTranslation(translated, direction.to || 'es');
  });

  log.prepend(entry);
  // Keep only last 20 entries
  while (log.children.length > 20) log.removeChild(log.lastChild);
  // Scroll to top of transcript area to see the newest entry
  var ta = document.querySelector('.transcript-area');
  if (ta) ta.scrollTop = 0;
}

/* ── Settings Panel ── */
function initSettings() {
  // Create settings slide-up panel dynamically
  var panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.style.cssText = `
    position: fixed; bottom: 0; left: 0; width: 100vw;
    background: rgba(10, 14, 26, 0.97);
    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border-top: 1px solid rgba(82,153,224,0.3);
    border-radius: 24px 24px 0 0;
    padding: 1.5rem 1.5rem calc(env(safe-area-inset-bottom, 1rem) + 1rem);
    z-index: 10000;
    transform: translateY(100%); opacity: 0; pointer-events: none;
    transition: all 0.4s cubic-bezier(0.16,1,0.3,1);
  `;
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
      <div style="font-weight:700; font-size:1rem; color:var(--text-primary);">Settings</div>
      <button id="settings-close-btn" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.4rem;">&#x2715;</button>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <span style="color:var(--text-secondary); font-size:0.95rem;">Voice Playback (TTS)</span>
      <label style="position:relative;display:inline-block;width:48px;height:26px;cursor:pointer;">
        <input type="checkbox" id="tts-toggle" checked style="opacity:0;width:0;height:0;">
        <span id="tts-slider-vis" style="position:absolute;inset:0;border-radius:13px;background:rgba(255, 255, 255, 0.1);transition:0.3s;">
          <span style="position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:0.3s;" id="tts-knob"></span>
        </span>
      </label>
    </div>
    <div style="padding:0.75rem 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
        <span style="color:var(--text-secondary);font-size:0.95rem;">Speech Rate</span>
        <span id="speech-rate-display" style="color:var(--accent);font-size:0.9rem;font-weight:600;">1.0×</span>
      </div>
      <input type="range" id="speech-rate-slider" min="0.6" max="1.4" step="0.1" value="1.0"
        style="width:100%;accent-color:var(--accent);cursor:pointer;">
    </div>
  `;
  document.getElementById('app').appendChild(panel);

  var toggleBtn = document.getElementById('settings-toggle-btn');
  var closeBtn;
  var ttsCheck;
  var rateSlider;
  var rateDisplay;

  function openSettings() {
    panel.style.transform = 'translateY(0)';
    panel.style.opacity = '1';
    panel.style.pointerEvents = 'auto';
    if (toggleBtn) toggleBtn.style.color = 'var(--accent)';
  }

  function closeSettings() {
    panel.style.transform = 'translateY(100%)';
    panel.style.opacity = '0';
    panel.style.pointerEvents = 'none';
    if (toggleBtn) toggleBtn.style.color = 'var(--text-muted)';
  }

  if (toggleBtn) toggleBtn.addEventListener('click', openSettings);

  // Wait for panel to be in DOM
  setTimeout(function () {
    closeBtn = document.getElementById('settings-close-btn');
    ttsCheck = document.getElementById('tts-toggle');
    rateSlider = document.getElementById('speech-rate-slider');
    rateDisplay = document.getElementById('speech-rate-display');
    var knob = document.getElementById('tts-knob');
    var visSlider = document.getElementById('tts-slider-vis');

    if (closeBtn) closeBtn.addEventListener('click', closeSettings);

    if (ttsCheck) {
      ttsCheck.addEventListener('change', function () {
        state.settings.tts = this.checked;
        saveSettings();
        var visSlider = document.getElementById('tts-slider-vis');
        if (visSlider) visSlider.style.background = this.checked ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)';
        var knob = document.getElementById('tts-knob');
        if (knob) knob.style.transform = this.checked ? 'translateX(22px)' : 'translateX(0)';
      });
    }

    if (rateSlider) {
      rateSlider.addEventListener('input', function () {
        state.settings.speechRate = parseFloat(this.value);
        if (rateDisplay) rateDisplay.textContent = parseFloat(this.value).toFixed(1) + '×';
      });
    }
  }, 100);
}

function initPresetsMenu() {
  const toggleBtn = document.getElementById('presets-toggle-btn');
  const presetsMenu = document.getElementById('presets-menu');

  if (toggleBtn && presetsMenu) {
    const closeBtn = document.getElementById('presets-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        presetsMenu.classList.add('hidden');
        toggleBtn.classList.remove('active');
      });
    }

    toggleBtn.addEventListener('click', function () {
      const isHidden = presetsMenu.classList.contains('hidden');
      if (isHidden) {
        presetsMenu.classList.remove('hidden');
        toggleBtn.classList.add('active');
      } else {
        presetsMenu.classList.add('hidden');
        toggleBtn.classList.remove('active');
      }
    });

    // Handle clicking a specific preset item — panel stays open for quick consecutive phrases
    const presetItems = document.querySelectorAll('.preset-item');
    presetItems.forEach(item => {
      item.addEventListener('click', function () {
        const textToTranslate = this.getAttribute('data-text');
        if (textToTranslate) {
          originalText.textContent = textToTranslate;
          sendForTranslation(textToTranslate);
          // Panel intentionally stays open so user can fire another phrase immediately
        }
      });
    });

    // Dismiss presets menu when tapping outside
    document.addEventListener('click', function (e) {
      if (!presetsMenu.classList.contains('hidden')) {
        var container = document.querySelector('.presets-container');
        if (container && !container.contains(e.target)) {
          presetsMenu.classList.add('hidden');
          toggleBtn.classList.remove('active');
        }
      }
    });
  }
}


document.addEventListener('DOMContentLoaded', init);

/* ── Voice Training Module ── */
var trainToggleBtn = document.getElementById('train-mode-toggle');
var trainScreen = document.getElementById('training-screen');
var exitTrainBtn = document.getElementById('exit-training-btn');
var trainPhraseText = document.getElementById('training-phrase-text');
var trainTargetLang = document.getElementById('training-target-lang');
var trainRecordBtn = document.getElementById('training-record-btn');
var trainStatusText = document.getElementById('training-status-text');

var trainingPhrases = [
  "I will perform a physical exam now.",
  "Your laboratory results are completely normal.",
  "Please take a deep breath and hold it.",
  "Are you currently experiencing any pain?",
  "We need to schedule a follow-up appointment in two weeks.",
  "Do you have any known allergies to medications?",
  "I am prescribing you an antibiotic for the infection.",
  "The procedure will take approximately thirty minutes."
];
var currentPhraseIndex = 0;
var trainMediaRecorder = null;
var trainAudioChunks = [];

if (trainToggleBtn) {
  trainToggleBtn.addEventListener('click', function () {
    if (!state.selectedLang) {
      showToast("Please select a target language first.", "error");
      return;
    }
    document.getElementById('setup-screen').classList.add('hidden');
    trainScreen.classList.remove('hidden');
    trainTargetLang.textContent = LANGUAGES[state.selectedLang.split('-')[0]].name;
    loadNextPhrase();
  });
}

if (exitTrainBtn) {
  exitTrainBtn.addEventListener('click', function () {
    trainScreen.classList.add('hidden');
    document.getElementById('setup-screen').classList.remove('hidden');
  });
}

function loadNextPhrase() {
  currentPhraseIndex = Math.floor(Math.random() * trainingPhrases.length);
  trainPhraseText.textContent = '"' + trainingPhrases[currentPhraseIndex] + '"';
}

if (trainRecordBtn) {
  trainRecordBtn.addEventListener('mousedown', startTrainingRecording);
  trainRecordBtn.addEventListener('mouseup', stopTrainingRecording);
  trainRecordBtn.addEventListener('mouseleave', function () {
    if (trainMediaRecorder && trainMediaRecorder.state === 'recording') {
      stopTrainingRecording();
    }
  });

  // Touch support for mobile
  trainRecordBtn.addEventListener('touchstart', function (e) { e.preventDefault(); startTrainingRecording(); });
  trainRecordBtn.addEventListener('touchend', function (e) { e.preventDefault(); stopTrainingRecording(); });
}

async function startTrainingRecording() {
  trainStatusText.textContent = "Recording...";
  trainStatusText.style.color = "#ff4444";
  trainRecordBtn.style.background = "#ff4444";
  trainRecordBtn.style.animation = "pulse-shadow 1.5s infinite";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    trainMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    trainAudioChunks = [];

    trainMediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) trainAudioChunks.push(e.data);
    };

    trainMediaRecorder.onstop = () => {
      const audioBlob = new Blob(trainAudioChunks, { type: 'audio/webm' });
      uploadTrainingAudio(audioBlob, trainingPhrases[currentPhraseIndex]);
      // Stop all tracks to release mic
      stream.getTracks().forEach(track => track.stop());
    };

    trainMediaRecorder.start();
  } catch (err) {
    showToast("Microphone access denied", "error");
    stopTrainingRecording(true);
  }
}

function stopTrainingRecording(failed = false) {
  if (trainMediaRecorder && trainMediaRecorder.state === 'recording') {
    trainMediaRecorder.stop();
  }
  trainStatusText.textContent = "Hold to record";
  trainStatusText.style.color = "#8da4c0";
  trainRecordBtn.style.background = "#2a354d";
  trainRecordBtn.style.animation = "none";
  if (!failed) {
    showToast("Audio saved! Loading next phrase...", "success");
    setTimeout(loadNextPhrase, 1000);
  }
}

function uploadTrainingAudio(blob, phrase) {
  // In a production app, this sends the Blob + Provider PIN + Phrase to the backend.
  var formData = new FormData();
  formData.append('audio', blob, 'recording.webm');
  formData.append('phrase', phrase);
  formData.append('lang', state.selectedLang);
  formData.append('pin', state.pin);

  fetch(CONFIG.API_URL + '/api/train', {
    method: 'POST',
    body: formData
  }).catch(err => console.error("Upload failed", err));
}



var validationScreen = document.querySelector('#validation-screen');
var validateToggleBtn = document.querySelector('#validate-mode-toggle');
var valPhrase = document.querySelector('#val-phrase');
var valAudio = document.querySelector('#val-audio');
var valApproveBtn = document.querySelector('#val-approve-btn');
var valRejectBtn = document.querySelector('#val-reject-btn');
var valStatus = document.querySelector('#val-status');
var validationQueue = [];
var currentValidationItem = null;

if (validateToggleBtn) {
  validateToggleBtn.addEventListener('click', function () {
    showScreen('validation');
    fetchValidationQueue();
  });
}
var logoutBtnVal = document.querySelector('#logout-btn-validation');
if (logoutBtnVal) {
  logoutBtnVal.addEventListener('click', function () {
    showScreen('login');
  });
}

async function fetchValidationQueue() {
  valStatus.textContent = "Fetching audio queue...";
  valApproveBtn.disabled = true; valRejectBtn.disabled = true;
  try {
    const res = await fetch(CONFIG.API_URL + '/api/train/queue');
    validationQueue = await res.json();
    if (validationQueue.length === 0) {
      valPhrase.textContent = "Queue is empty! Great job.";
      valStatus.textContent = "No pending clips.";
      valAudio.src = "";
    } else {
      nextValidationItem();
    }
  } catch (e) {
    valStatus.textContent = "Error fetching queue.";
  }
}

function nextValidationItem() {
  if (validationQueue.length === 0) { fetchValidationQueue(); return; }
  currentValidationItem = validationQueue.shift();

  // NOTE: In an ideal world we join with training_phrases to show the english text.
  // We'll show the ID for now, or just say 'Native Speaker Translation' since we simplified Phase 11.
  valPhrase.textContent = "Haitian Creole Audio ID: " + currentValidationItem.id.substring(0, 8);
  valAudio.src = currentValidationItem.audio_url;
  valStatus.textContent = validationQueue.length + " clips remaining in queue.";
  valApproveBtn.disabled = false;
  valRejectBtn.disabled = false;
}

async function submitReview(isApproved) {
  if (!currentValidationItem) return;
  valApproveBtn.disabled = true; valRejectBtn.disabled = true;
  valStatus.textContent = "Submitting review...";

  const fd = new FormData();
  fd.append('record_id', currentValidationItem.id);
  fd.append('is_approved', isApproved);
  fd.append('pin', state.pin);

  try {
    await fetch(CONFIG.API_URL + '/api/train/review', { method: 'POST', body: fd });
    nextValidationItem();
  } catch (e) {
    valStatus.textContent = "Error submitting. Try again.";
    valApproveBtn.disabled = false; valRejectBtn.disabled = false;
  }
}

if (valApproveBtn) {
  if (valApproveBtn) valApproveBtn.addEventListener('click', () => submitReview('true'));
  if (valRejectBtn) valRejectBtn.addEventListener('click', () => submitReview('false'));
}

