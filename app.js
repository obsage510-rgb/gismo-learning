
window.onerror = function(msg, url, lineNo, columnNo, error) {
  fetch('/api/log_error', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({msg: msg, line: lineNo, col: columnNo})
  });
};
window.addEventListener("unhandledrejection", function(e) {
  fetch('/api/log_error', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({msg: e.reason ? e.reason.message : "Unhandled Promise"})
  });
});

let lessonsDb = {};

// Global App State
let appState = {
  currentTheme: 'dark',
  fontScale: 1.0,
  activeLesson: null,
  tutorMuted: false,
  selectedVoice: null,
  voicesList: [],
  isListening: false,
  visualizerInterval: null,
  user: null, // will hold {id, username, role, quizzes_passed}
  currentView: 'login',
  notes: [],
  persona: 'default',
  quizActive: false,
  currentQuizLesson: null,
  currentPageIndex: 0,
  currentLessonPages: [],
  chatSessions: [],
  activeSessionId: null
};
window.appState = appState;

// Web Audio API Context (Earcons)
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playEarcon(type) {
  if (!audioCtx || appState.tutorMuted) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  
  if (type === 'click') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    gainNode.gain.setValueAtTime(0.3, now); gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'success') {
    osc.type = 'triangle'; osc.frequency.setValueAtTime(400, now); osc.frequency.setValueAtTime(600, now + 0.1); osc.frequency.setValueAtTime(800, now + 0.2);
    gainNode.gain.setValueAtTime(0, now); gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1); gainNode.gain.linearRampToValueAtTime(0, now + 0.4);
    osc.start(now); osc.stop(now + 0.4);
  } else if (type === 'error') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now);
    gainNode.gain.setValueAtTime(0.3, now); gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now); osc.stop(now + 0.3);
  } else if (type === 'listening') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(440, now);
    gainNode.gain.setValueAtTime(0.1, now); gainNode.gain.linearRampToValueAtTime(0, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  }
}

const elements = {
  body: document.body,
  voiceSelect: document.getElementById('voice-select'),
  slider: document.getElementById('text-scale-slider'),
  btnDec: document.getElementById('btn-decrease-text'),
  btnInc: document.getElementById('btn-increase-text'),
  loginPanel: document.getElementById('login-panel'),
  loginUsername: document.getElementById('login-username'),
  profilePanel: document.getElementById('profile-panel'),
  libraryPanel: document.getElementById('library-panel'),
  adminPanel: document.getElementById('admin-panel'),
  adminDbPanel: document.getElementById('admin-db-panel'),
  profileNameDisplay: document.getElementById('profile-name-display'),
  btnProfileToggle: document.getElementById('btn-profile-toggle'),
  btnHomeToggle: document.getElementById('btn-home-toggle'),
  btnLibraryToggle: document.getElementById('btn-library-toggle'),
  btnAdminToggle: document.getElementById('btn-admin-toggle'),
  btnAdminDbToggle: document.getElementById('btn-admin-db-toggle'),
  btnSettingsToggle: document.getElementById('btn-settings-toggle'),
  quizzesPanel: document.getElementById('quizzes-panel'),
  fontFamilySelect: document.getElementById('font-family-select'),
  quizModal: document.getElementById('quiz-modal'),
  quizQuestion: document.getElementById('quiz-question'),
  quizOptions: document.getElementById('quiz-options'),
  quizProgress: document.getElementById('quiz-progress'),
  analyticsStreak: document.getElementById('analytics-streak'),
  analyticsQuizzes: document.getElementById('analytics-quizzes'),
  analyticsNotes: document.getElementById('analytics-notes'),
  analyticsRank: document.getElementById('analytics-rank'),
  analyticsProgressText: document.getElementById('analytics-progress-text'),
  analyticsProgressBar: document.getElementById('analytics-progress-bar'),
  mainContent: document.getElementById('main-content'),
  modulesList: document.getElementById('modules-list'),
  lessonActiveContainer: document.getElementById('lesson-active-container'),
  activeLessonTitle: document.getElementById('active-lesson-title'),
  activeLessonMeta: document.getElementById('active-lesson-meta'),
  activeLessonImage: document.getElementById('active-lesson-image'),
  activeLessonDescriptor: document.getElementById('active-lesson-descriptor'),
  activeLessonContent: document.getElementById('active-lesson-content'),
  btnReadLesson: document.getElementById('btn-read-lesson'),
  btnPauseLesson: document.getElementById('btn-pause-lesson'),
  btnStopLesson: document.getElementById('btn-stop-lesson'),
  chatBox: document.getElementById('chat-box'),
  chatInput: document.getElementById('chat-user-input'),
  btnChatSend: document.getElementById('btn-chat-send'),
  btnMicInput: document.getElementById('btn-mic-input'),
  btnMuteTutor: document.getElementById('btn-mute-tutor'),
  muteIconSvg: document.getElementById('mute-icon-svg'),
  tutorTabsContainer: document.getElementById('tutor-tabs-container'),
  tutorTabsList: document.getElementById('tutor-tabs-list'),
  btnTutorNewTab: document.getElementById('btn-tutor-new-tab'),
  captionOverlay: document.getElementById('caption-overlay'),
  visualizerBars: document.querySelectorAll('.visualizer-bar'),
  personaSelect: document.getElementById('persona-select')
};

const synth = window.speechSynthesis;
let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  
  recognition.onstart = () => {
    appState.isListening = true;
    elements.btnMicInput.classList.add('listening');
    elements.btnMicInput.setAttribute('aria-label', 'Listening... Speak now.');
    setCaption("Microphone Active: Listening to your voice...");
    playEarcon('listening');
    animateVisualizer(true);
  };
  
  recognition.onend = () => {
    appState.isListening = false;
    elements.btnMicInput.classList.remove('listening');
    elements.btnMicInput.setAttribute('aria-label', 'Start voice typing questions');
    animateVisualizer(false);
  };
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (typeof verifyStudentVoiceInput === 'function' && !verifyStudentVoiceInput(transcript)) {
      return;
    }
    setCaption(`You said: "${transcript}"`);
    handleVoiceInput(transcript);
  };
  
  recognition.onerror = (event) => {
    console.error("Speech Recognition Error:", event.error);
    setCaption(`Voice Error: ${event.error}. Please ensure mic permissions are granted.`);
    animateVisualizer(false);
    appState.isListening = false;
    elements.btnMicInput.classList.remove('listening');
    playEarcon('error');
  };
} else {
  if (elements.btnMicInput) elements.btnMicInput.style.display = 'none';
  console.warn("Speech recognition not supported in this browser.");
}

window.addEventListener('DOMContentLoaded', () => {
  setupVoices();
  setupTextScaler();
  setupFontSelector();
  setupNarrator();
  setupKeyBindings();
  setupTutorMuteSystem();
  initVoiceIsolationEngine();
  loadSettings();
  fetchTextbooks();
  setupInteractiveHighlighting();

  // Restore active session on page refresh so users are not logged out
  const savedUserJson = localStorage.getItem('gismoSessionUser') || sessionStorage.getItem('gismoSessionUser');
  const savedView = localStorage.getItem('gismoActiveView') || sessionStorage.getItem('gismoActiveView');
  if (savedUserJson) {
    try {
      const parsedUser = JSON.parse(savedUserJson);
      if (parsedUser && parsedUser.username) {
        appState.user = parsedUser;
        loginSuccess({ restoreView: savedView, silent: true });
        return;
      }
    } catch (_) {}
  }

  initChatSessions();
  switchView('login');
  const requestedPortal = new URLSearchParams(window.location.search).get('portal');
  if (typeof selectLoginPortal === 'function') {
    selectLoginPortal(requestedPortal === 'admin' ? 'admin' : 'student');
  }
  const fab = document.getElementById('fab-tutor');
  if (fab) fab.style.display = 'none';
  if (typeof closeTutorPanel === 'function') {
    closeTutorPanel();
  }
});

function setupInteractiveHighlighting() {
  const tooltip = document.getElementById('highlight-tooltip');
  const explainBtn = document.getElementById('explain-btn');
  
  if (!tooltip || !explainBtn) return;
  
  document.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (text.length > 0 && e.target.closest('#active-lesson-content')) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2)}px`;
      tooltip.style.top = `${rect.top - 40 + window.scrollY}px`;
      tooltip.classList.remove('hidden');
    } else if (e.target !== explainBtn && !explainBtn.contains(e.target)) {
      tooltip.classList.add('hidden');
    }
  });
  
  explainBtn.addEventListener('click', () => {
    const text = window.getSelection().toString().trim();
    if (text) {
      tooltip.classList.add('hidden');
      window.getSelection().removeAllRanges();
      
      openTutorPanel();
      const prompt = `Can you explain this excerpt from my textbook?\n\n"${text}"`;
      if (elements.chatInput) elements.chatInput.value = '';
      playEarcon('click');
      handleVoiceInput(prompt);
    }
  });
}

// --- API Calls ---
async function fetchTextbooks() {
  try {
    const activeUserId = (appState.user && appState.user.id) || sessionStorage.getItem('gismoUserId') || '';
    const uid = activeUserId ? `?user_id=${encodeURIComponent(activeUserId)}` : '';
    const res = await fetch(`/api/textbooks${uid}`);
    const data = await res.json();
    lessonsDb = {};
    if (!elements.modulesList) return;
    elements.modulesList.innerHTML = '';

    // Render empty state if no courses or textbooks are published
    if (!data || data.length === 0) {
      const emptyContainer = document.createElement('div');
      emptyContainer.className = 'col-12';
      emptyContainer.innerHTML = `
        <div class="empty-state-card-grid">
          <!-- Card 1: Courses & Modules Empty State -->
          <div class="empty-state-modern-card">
            <span class="empty-state-badge">Curriculum Status</span>
            <div class="empty-state-illustration">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"></path>
                <path d="M18 8l2-2"></path>
                <path d="M20 14l2 2"></path>
                <path d="M4 14l-2 2"></path>
                <polygon points="12 2 13.5 5 16.5 5 14 7 15 10 12 8.5 9 10 10 7 7.5 5 10.5 5 12 2" fill="currentColor" opacity="0.3"></polygon>
              </svg>
            </div>
            <h3 class="empty-state-title">No Courses Available Currently</h3>
            <p class="empty-state-desc">Your instructors are preparing upcoming interactive lessons and accessible coursework.</p>
            <div class="empty-state-actions">
              <button class="btn-primary w-100" onclick="askTutorForPractice()" style="padding: 0.85rem 1.5rem; border-radius: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: 0 10px 25px rgba(99, 102, 241, 0.4);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                Practice with AI Tutor
              </button>
            </div>
          </div>

          <!-- Card 2: Textbook Library Empty State -->
          <div class="empty-state-modern-card">
            <span class="empty-state-badge">Library Catalog</span>
            <div class="empty-state-illustration">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                <line x1="10" y1="6" x2="16" y2="6"></line>
                <line x1="10" y1="10" x2="16" y2="10"></line>
              </svg>
            </div>
            <h3 class="empty-state-title">No Downloadable Books</h3>
            <p class="empty-state-desc">Browse open-source web books or generate custom study guides.</p>
            <div class="empty-state-actions">
              <button class="theme-btn w-100" onclick="switchView('library')" style="padding: 0.85rem 1.5rem; border-radius: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                Explore Web Books
              </button>
            </div>
          </div>
        </div>
      `;
      elements.modulesList.appendChild(emptyContainer);
      return;
    }

    data.forEach(tb => {
      lessonsDb[tb.id] = tb;
      
      const btn = document.createElement('div');
      btn.className = 'col-12 col-md-4';
      
      const isLibraryBook = tb.id.startsWith('gutenberg_') || tb.meta === 'Web Book';
      const badge = isLibraryBook ? 'LIBRARY BOOK' : 'FEATURED';

      // Keep original book cover; never substitute assets/pyramids.jpg for library books
      let coverUrl = tb.image || '';
      if (isLibraryBook && (!coverUrl || coverUrl.includes('assets/pyramids.jpg'))) {
        const gutenbergMatch = String(tb.id).match(/^gutenberg_(\d+)/);
        coverUrl = gutenbergMatch ? `https://www.gutenberg.org/cache/epub/${gutenbergMatch[1]}/pg${gutenbergMatch[1]}.cover.medium.jpg` : '';
      }
      if (!isLibraryBook && !coverUrl) {
        coverUrl = 'assets/pyramids.jpg';
      }

      const coverHtml = coverUrl
        ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(tb.title)}" style="width:100%; height:100%; object-fit:${isLibraryBook ? 'contain' : 'cover'}; background:var(--bg-secondary);" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
           <div style="display:none; width:100%; height:100%; flex-direction:column; align-items:center; justify-content:center; padding:1rem; text-align:center; background:linear-gradient(135deg, rgba(15,92,77,0.18), rgba(217,119,6,0.14)); color:var(--text-primary);">
             ${getAppSvgIcon('book', 28)}
             <span style="margin-top:0.5rem; font-weight:700; font-size:0.9rem; line-height:1.3;">${escapeHtml(tb.title)}</span>
           </div>`
        : `<div style="display:flex; width:100%; height:100%; flex-direction:column; align-items:center; justify-content:center; padding:1rem; text-align:center; background:linear-gradient(135deg, rgba(15,92,77,0.18), rgba(217,119,6,0.14)); color:var(--text-primary);">
             ${getAppSvgIcon('book', 28)}
             <span style="margin-top:0.5rem; font-weight:700; font-size:0.9rem; line-height:1.3;">${escapeHtml(tb.title)}</span>
           </div>`;
      
      let pillsHtml = '';
      if (tb.meta) {
        const metaParts = tb.meta.split('•');
        pillsHtml = metaParts.map(p => `<span style="background:var(--bg-secondary); color:var(--text-primary); padding:4px 10px; border-radius:12px; font-size:0.75rem;">${escapeHtml(p.trim())}</span>`).join('');
      }

      const instructorHtml = isLibraryBook ? '' : `
          <div class="learner-instructor" style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1.5rem; border-top:1px solid var(--border-color); padding-top:1rem;">
            <div style="width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg, var(--accent-color), var(--accent-secondary)); display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; flex-shrink:0;">GT</div>
            <div>
              <div style="font-weight:bold; font-size:0.9rem; color:var(--text-primary);">Gismo Tutor</div>
              <div style="font-size:0.75rem; color:var(--text-secondary);">AI Instructor</div>
            </div>
          </div>`;

      const actionButtonsHtml = isLibraryBook
        ? `<div style="display:flex; gap:0.5rem; margin-top:auto;">
             <button class="btn-primary" onclick="loadLesson('${tb.id}')" style="flex:1; padding:0.75rem; border-radius:8px; font-weight:bold; font-size:1rem;">Read Book</button>
             <button type="button" class="theme-btn" onclick="removeLibraryBook('${tb.id}', this)" title="Remove from Library" aria-label="Remove ${escapeHtml(tb.title)} from library" style="padding:0.75rem 0.9rem; border-radius:8px; color:var(--error-color); border-color:var(--border-color); display:inline-flex; align-items:center; justify-content:center;">${getAppSvgIcon('trash', 16) || 'Remove'}</button>
           </div>`
        : `<button class="btn-primary w-100" onclick="loadLesson('${tb.id}')" style="padding:0.75rem; border-radius:8px; font-weight:bold; font-size:1rem; margin-top:auto;">Enroll Now</button>`;
      
      btn.innerHTML = `
      <div class="learner-card w-100 h-100" style="display:flex; flex-direction:column;">
        <div class="learner-img-wrapper" style="position:relative; height:210px; overflow:hidden; border-radius:12px 12px 0 0; background:var(--bg-secondary);">
          ${coverHtml}
          <span style="position:absolute; top:10px; left:10px; background:var(--accent-color); color:white; padding:4px 10px; border-radius:12px; font-size:0.7rem; font-weight:bold; text-transform:uppercase;">${badge}</span>
        </div>
        <div class="learner-body" style="padding:1.5rem; flex:1; display:flex; flex-direction:column; background:var(--bg-card); border:1px solid var(--border-color); border-top:none; border-radius:0 0 12px 12px;">
          <div class="learner-pills" style="display:flex; gap:0.5rem; margin-bottom:1rem; flex-wrap:wrap;">
            ${pillsHtml}
          </div>
          <h3 style="margin-top:0; font-size:1.2rem; margin-bottom:0.75rem; color:var(--text-primary);">${escapeHtml(tb.title)}</h3>
          <p style="color:var(--text-secondary); font-size:0.9rem; line-height:1.5; margin-bottom:1.5rem; flex:1;">${escapeHtml(tb.descriptor || 'Open this book to start reading.')}</p>
          ${instructorHtml}
          ${actionButtonsHtml}
        </div>
      </div>
      `;
      
      elements.modulesList.appendChild(btn);
    });
  } catch (err) {
    console.error("Error fetching textbooks", err);
  }
}

async function removeLibraryBook(bookId, btnEl) {
  const userId = (appState.user && appState.user.id) || sessionStorage.getItem('gismoUserId') || null;
  if (!userId) {
    showToast('Please sign in to manage your library.', 'warning');
    return;
  }
  const book = lessonsDb[bookId];
  const bookTitle = (book && book.title) ? book.title : 'this book';
  if (!confirm(`Remove "${bookTitle}" from your library?`)) return;

  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(`/api/textbooks/${encodeURIComponent(bookId)}?user_id=${encodeURIComponent(userId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not remove book.');
    try { localStorage.removeItem(`gismo_book_page_${bookId}`); } catch (_) {}
    delete lessonsDb[bookId];
    showToast(`Removed "${bookTitle}" from your library.`, 'book');
    announceTTS(`Removed ${bookTitle} from your library.`);
    await fetchTextbooks();
    renderLibrary('all');
  } catch (err) {
    if (btnEl) btnEl.disabled = false;
    showToast(err.message || 'Failed to remove book.', 'warning');
  }
}
window.removeLibraryBook = removeLibraryBook;

async function fetchNotes() {
  if (!appState.user) return;
  const res = await fetch(`/api/notes?user_id=${appState.user.id}`);
  appState.notes = await res.json();
  renderNotes();
}

function showAuthError(msg) {
  const box = document.getElementById('auth-alert-message');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
    box.style.background = 'rgba(239, 68, 68, 0.18)';
    box.style.border = '1px solid rgba(239, 68, 68, 0.5)';
    box.style.color = '#fca5a5';
  } else {
    alert(msg);
  }
  playEarcon('error');
  if (typeof announceTTS === 'function') announceTTS(msg);
}

function showAuthLoading(msg) {
  const box = document.getElementById('auth-alert-message');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
    box.style.background = 'rgba(99, 102, 241, 0.15)';
    box.style.border = '1px solid rgba(99, 102, 241, 0.4)';
    box.style.color = '#a5b4fc';
  }
}

function hideAuthFeedback() {
  const box = document.getElementById('auth-alert-message');
  if (box) {
    box.style.display = 'none';
    box.textContent = '';
  }
}

async function handleRegister() {
  const nameEl = document.getElementById('reg-username') || document.getElementById('reg-name');
  const passwordEl = document.getElementById('reg-password');
  const regNoEl = document.getElementById('reg-reg-no');
  const schoolEl = document.getElementById('reg-school');
  const disabilityEl = document.getElementById('reg-disability');
  
  const name = nameEl ? nameEl.value.trim() : '';
  const password = passwordEl ? passwordEl.value.trim() : '';
  const reg_no = regNoEl ? regNoEl.value.trim() : '';
  const school = schoolEl ? schoolEl.value.trim() : '';
  const disability = disabilityEl ? disabilityEl.value : 'None';
  
  if (!name || !password) {
    showAuthError("Please choose a Student ID and Password.");
    if (!name && nameEl) nameEl.focus();
    else if (passwordEl) passwordEl.focus();
    return;
  }
  
  if (password.length < 3) {
    showAuthError("Password must be at least 3 characters long.");
    if (passwordEl) passwordEl.focus();
    return;
  }

  if (!reg_no) {
    showAuthError("Please enter your Student Registration Number.");
    if (regNoEl) regNoEl.focus();
    return;
  }

  if (!school) {
    showAuthError("Please enter your School or Institution.");
    if (schoolEl) schoolEl.focus();
    return;
  }
  
  showAuthLoading("Creating account...");
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: name, 
        password: password, 
        school: school, 
        reg_no: reg_no, 
        disability: disability, 
        role: 'student' 
      })
    });
    
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      appState.user = data;
      if (data.school) localStorage.setItem('gismoSchool', data.school);
      if (data.reg_no) localStorage.setItem('gismoRegNo', data.reg_no);
      hideAuthFeedback();
      loginSuccess();
      playEarcon('success');
    } else {
      showAuthError(data.error || 'Registration failed. That Student ID may already be taken.');
    }
  } catch (err) {
    console.error("Register error:", err);
    showAuthError("Unable to connect to server. Please ensure the backend is running.");
  }
}

async function handleLogin() {
  const nameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  const name = nameEl ? nameEl.value.trim() : '';
  const password = passwordEl ? passwordEl.value.trim() : '';
  
  if (!name || !password) {
    showAuthError("Please enter both your Student ID and password.");
    if (!name && nameEl) nameEl.focus();
    else if (passwordEl) passwordEl.focus();
    return;
  }
  
  showAuthLoading("Signing in...");
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: name,
        password: password,
        role: 'student'
      })
    });
    
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      appState.user = data;
      hideAuthFeedback();
      loginSuccess();
      playEarcon('success');
    } else {
      showAuthError(data.error || 'Invalid username or password. Please try again.');
    }
  } catch (err) {
    console.error("Login error:", err);
    showAuthError("Unable to connect to server. Please ensure the backend is running.");
  }
}
window.handleLogin = handleLogin;

function selectLoginPortal(portal) {
  const tabStudent = document.getElementById('tab-portal-student');
  const tabInstructor = document.getElementById('tab-portal-instructor');
  const formStudent = document.getElementById('form-student-login');
  const formRegister = document.getElementById('form-student-register');
  const formAdmin = document.getElementById('form-admin-login');
  hideAuthFeedback();

  if (portal === 'instructor') {
    if (tabStudent) { tabStudent.classList.remove('active'); tabStudent.setAttribute('aria-selected', 'false'); }
    if (tabInstructor) { tabInstructor.classList.add('active'); tabInstructor.setAttribute('aria-selected', 'true'); }
    if (formStudent) formStudent.style.display = 'none';
    if (formRegister) formRegister.style.display = 'none';
    if (formAdmin) formAdmin.style.display = 'block';
    const adminUserEl = document.getElementById('admin-username');
    const adminPassEl = document.getElementById('admin-password');
    if (adminUserEl && !adminUserEl.value) adminUserEl.value = 'admin';
    if (adminPassEl && !adminPassEl.value) adminPassEl.value = 'admin123';
  } else {
    if (tabInstructor) { tabInstructor.classList.remove('active'); tabInstructor.setAttribute('aria-selected', 'false'); }
    if (tabStudent) { tabStudent.classList.add('active'); tabStudent.setAttribute('aria-selected', 'true'); }
    if (formAdmin) formAdmin.style.display = 'none';
    if (formRegister) formRegister.style.display = 'none';
    if (formStudent) formStudent.style.display = 'block';
  }
}
window.selectLoginPortal = selectLoginPortal;

function showStudentRegister() {
  hideAuthFeedback();
  selectLoginPortal('student');
  const formStudent = document.getElementById('form-student-login');
  const formRegister = document.getElementById('form-student-register');
  const formAdmin = document.getElementById('form-admin-login');
  if (formStudent) formStudent.style.display = 'none';
  if (formAdmin) formAdmin.style.display = 'none';
  if (formRegister) formRegister.style.display = 'block';
}
window.showStudentRegister = showStudentRegister;

function showStudentLogin() {
  hideAuthFeedback();
  selectLoginPortal('student');
  const formStudent = document.getElementById('form-student-login');
  const formRegister = document.getElementById('form-student-register');
  const formAdmin = document.getElementById('form-admin-login');
  if (formRegister) formRegister.style.display = 'none';
  if (formAdmin) formAdmin.style.display = 'none';
  if (formStudent) formStudent.style.display = 'block';
}
window.showStudentLogin = showStudentLogin;

async function handleAdminLogin() {
  const nameEl = document.getElementById('admin-username');
  const passwordEl = document.getElementById('admin-password');
  const name = nameEl ? nameEl.value.trim() : 'admin';
  const password = passwordEl ? passwordEl.value.trim() : 'admin123';
  
  if (!name || !password) {
    showAuthError("Please enter instructor username and password.");
    return;
  }
  
  showAuthLoading("Authenticating Instructor Workspace...");
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: password, role: 'admin' })
    });
    
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      appState.user = data;
      hideAuthFeedback();
      loginSuccess();
      playEarcon('success');
    } else {
      showAuthError(data.error || 'Invalid instructor credentials.');
    }
  } catch (err) {
    console.error("Admin Login error:", err);
    showAuthError("Unable to connect to server. Please ensure backend is running.");
  }
}
window.handleAdminLogin = handleAdminLogin;

async function quickPresentationAdminLogin() {
  selectLoginPortal('instructor');
  const nameEl = document.getElementById('admin-username');
  const passwordEl = document.getElementById('admin-password');
  if (nameEl) nameEl.value = 'admin';
  if (passwordEl) passwordEl.value = 'admin123';
  await handleAdminLogin();
}
window.quickPresentationAdminLogin = quickPresentationAdminLogin;

function persistUserSession() {
  if (!appState.user) return;
  try {
    const serialized = JSON.stringify(appState.user);
    localStorage.setItem('gismoSessionUser', serialized);
    sessionStorage.setItem('gismoSessionUser', serialized);
    sessionStorage.setItem('gismoUserId', appState.user.id);
    sessionStorage.setItem('gismoUsername', appState.user.username);
    sessionStorage.setItem('gismoUserRole', appState.user.role);
  } catch (_) {}
}

function askTutorForPractice() {
  openTutorPanel();
  const input = document.getElementById('chat-user-input') || document.getElementById('chat-input');
  if (input) {
    input.value = "Can you give me an interactive science practice question or explain a fascinating concept?";
    input.focus();
  }
  showToast("AI Tutor opened for practice!", "check");
  announceTTS("AI Tutor is ready to quiz you and practice with you.");
}
window.askTutorForPractice = askTutorForPractice;

function loginSuccess(options = {}) {
  if (elements.profileNameDisplay) elements.profileNameDisplay.textContent = appState.user.username;
  
  persistUserSession();

  // Show floating AI tutor once user is authenticated
  const fab = document.getElementById('fab-tutor');
  if (fab) fab.style.display = 'flex';
  
  // Settings icon in header controls & logout button
  if (elements.btnSettingsToggle) elements.btnSettingsToggle.classList.remove('hidden');
  const logoutBtn = document.getElementById('btn-logout-main');
  if (logoutBtn) logoutBtn.classList.remove('hidden');
  
  const profileNav = document.getElementById('btn-profile-nav');
  const quizzesNav = document.getElementById('btn-quizzes-toggle');

  if (appState.user.role === 'admin') {
    if (elements.btnAdminToggle) {
      elements.btnAdminToggle.classList.remove('hidden');
      elements.btnAdminToggle.classList.add('active');
    }
    if (elements.btnAdminDbToggle) {
      elements.btnAdminDbToggle.classList.remove('hidden');
      elements.btnAdminDbToggle.classList.remove('active');
    }
    if (elements.btnHomeToggle) elements.btnHomeToggle.classList.add('hidden');
    if (elements.btnLibraryToggle) elements.btnLibraryToggle.classList.add('hidden');
    if (profileNav) profileNav.classList.add('hidden');
    if (quizzesNav) quizzesNav.classList.add('hidden');
    if (elements.btnProfileToggle) elements.btnProfileToggle.classList.add('hidden');
    
    const streakCard = document.getElementById('analytics-streak');
    if(streakCard && streakCard.parentNode && streakCard.parentNode.parentNode) {
      streakCard.parentNode.parentNode.style.display = 'none';
    }
    loadAdminDashboard();
    const targetAdminView = (options.restoreView === 'admin-db') ? 'admin-db' : 'admin';
    switchView(targetAdminView);
  } else {
    // Student section
    if (elements.btnAdminToggle) elements.btnAdminToggle.classList.add('hidden');
    if (elements.btnAdminDbToggle) elements.btnAdminDbToggle.classList.add('hidden');
    if (elements.btnHomeToggle) elements.btnHomeToggle.classList.remove('hidden');
    if (profileNav) profileNav.classList.remove('hidden');
    if (elements.btnLibraryToggle) elements.btnLibraryToggle.classList.remove('hidden');
    if (quizzesNav) quizzesNav.classList.remove('hidden');
    if (elements.btnProfileToggle) elements.btnProfileToggle.classList.add('hidden');
    const streakCard = document.getElementById('analytics-streak');
    if (streakCard && streakCard.parentNode && streakCard.parentNode.parentNode) {
      streakCard.parentNode.parentNode.style.display = '';
    }
    
    loadStudentProfile();
    fetchNotes();
    fetchHomework();
    const validStudentViews = ['dashboard', 'profile', 'library', 'quizzes'];
    const targetStudentView = validStudentViews.includes(options.restoreView) ? options.restoreView : 'dashboard';
    switchView(targetStudentView);
  }
  
  loadChatHistory();
  if (!options.silent) {
    announceTTS(`Login successful. Welcome, ${appState.user.username}.`);
  }
}

async function loadChatHistory() {
  await initChatSessions();
}

function handleLogout() {
  playEarcon('click');
  appState.user = null;
  sessionStorage.removeItem('gismoSessionUser');
  sessionStorage.removeItem('gismoActiveView');
  sessionStorage.removeItem('gismoUserId');
  sessionStorage.removeItem('gismoUsername');
  sessionStorage.removeItem('gismoUserRole');
  localStorage.removeItem('gismoSessionUser');
  localStorage.removeItem('gismoActiveView');
  localStorage.removeItem('gismoUserId');
  localStorage.removeItem('gismoUsername');
  localStorage.removeItem('gismoUserRole');
  localStorage.removeItem('gismoUserQuizzes');
  
  const fab = document.getElementById('fab-tutor');
  if (fab) fab.style.display = 'none';
  
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  
  // Close tutor if open
  if (typeof closeTutorPanel === 'function') {
    closeTutorPanel();
  }
  
  // Close settings modal if open
  if (typeof closeSettingsModal === 'function') {
    closeSettingsModal();
  }
  
  const toHide = [
    'btn-profile-toggle',
    'btn-profile-nav',
    'btn-home-toggle',
    'btn-library-toggle',
    'btn-quizzes-toggle',
    'btn-admin-toggle',
    'btn-admin-db-toggle',
    'btn-settings-toggle',
    'btn-logout',
    'btn-logout-main',
    'nav-toggle'
  ];
  toHide.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  hideAuthFeedback();
  if (typeof selectLoginPortal === 'function') {
    selectLoginPortal('student');
  }

  const inputsToClear = [
    'login-username',
    'login-password',
    'reg-username',
    'reg-password'
  ];
  inputsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  stopAllTTS();
  initChatSessions();

  switchView('login');
  announceTTS("Logged out successfully.");
}
window.handleLogout = handleLogout;

// --- View Management ---
function switchView(viewName) {
  // In teacher / admin section, allow 'admin', 'admin-db', and 'login'
  if (appState.user && appState.user.role === 'admin' && viewName !== 'admin' && viewName !== 'admin-db' && viewName !== 'login') {
    viewName = 'admin';
  }
  appState.currentView = viewName;
  if (viewName !== 'login' && appState.user) {
    try {
      localStorage.setItem('gismoActiveView', viewName);
      sessionStorage.setItem('gismoActiveView', viewName);
    } catch (_) {}
  }
  [elements.loginPanel, elements.profilePanel, elements.mainContent, elements.libraryPanel, elements.adminPanel, elements.adminDbPanel, elements.quizzesPanel].forEach(el => el?.classList.add('hidden'));
  
  if (viewName === 'login') {
    elements.loginPanel?.classList.remove('hidden');
    // Hide navigation items and tutor fab when in landing/login view
    const toHide = [
      'btn-home-toggle',
      'btn-profile-nav',
      'btn-library-toggle',
      'btn-quizzes-toggle',
      'btn-admin-toggle',
      'btn-admin-db-toggle',
      'btn-profile-toggle',
      'btn-settings-toggle',
      'btn-logout-main',
      'nav-toggle'
    ];
    toHide.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    const fab = document.getElementById('fab-tutor');
    if (fab) fab.style.display = 'none';
    if (typeof closeTutorPanel === 'function') closeTutorPanel();
  } else if (viewName === 'dashboard') {
    elements.mainContent.classList.remove('hidden');
    showDashboard();
    fetchTextbooks();
  } else if (viewName === 'profile') {
    elements.profilePanel.classList.remove('hidden');
    loadStudentProfile();
    fetchHomework();
    loadAnalytics();
    fetchNotes();
  } else if (viewName === 'library') {
    elements.libraryPanel.classList.remove('hidden');
    fetchTextbooks();
    loadLibraryFiles();
  } else if (viewName === 'admin') {
    elements.adminPanel?.classList.remove('hidden');
    if (elements.btnAdminToggle) elements.btnAdminToggle.classList.add('active');
    if (elements.btnAdminDbToggle) elements.btnAdminDbToggle.classList.remove('active');
    document.querySelectorAll('.admin-subnav-btn').forEach(btn => {
      if (btn.getAttribute('onclick')?.includes("'admin'")) {
        btn.classList.add('active');
        btn.style.background = 'var(--accent-color)';
        btn.style.color = '#fff';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'var(--bg-card)';
        btn.style.color = 'var(--text-secondary)';
      }
    });
    loadAdminDashboard();
  } else if (viewName === 'admin-db') {
    elements.adminDbPanel?.classList.remove('hidden');
    if (elements.btnAdminDbToggle) elements.btnAdminDbToggle.classList.add('active');
    if (elements.btnAdminToggle) elements.btnAdminToggle.classList.remove('active');
    document.querySelectorAll('.admin-subnav-btn').forEach(btn => {
      if (btn.getAttribute('onclick')?.includes("'admin-db'")) {
        btn.classList.add('active');
        btn.style.background = 'var(--accent-color)';
        btn.style.color = '#fff';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'var(--bg-card)';
        btn.style.color = 'var(--text-secondary)';
      }
    });
    loadAdminDatabase();
  } else if (viewName === 'quizzes') {
    elements.quizzesPanel?.classList.remove('hidden');
    loadStudentQuizzes();
  } else if (viewName === 'settings') {
    openSettingsModal();
  }
  
  // Ensure authenticated navbar buttons & active tab indicators stay in sync
  if (appState.user && viewName !== 'login') {
    if (elements.btnSettingsToggle) elements.btnSettingsToggle.classList.remove('hidden');
    const logoutBtn = document.getElementById('btn-logout-main');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    const profileNav = document.getElementById('btn-profile-nav');
    const quizzesNav = document.getElementById('btn-quizzes-toggle');

    if (appState.user.role === 'admin') {
      elements.btnAdminToggle?.classList.remove('hidden');
      elements.btnAdminDbToggle?.classList.remove('hidden');
      elements.btnHomeToggle?.classList.add('hidden');
      elements.btnLibraryToggle?.classList.add('hidden');
      profileNav?.classList.add('hidden');
      quizzesNav?.classList.add('hidden');
    } else {
      elements.btnAdminToggle?.classList.add('hidden');
      elements.btnAdminDbToggle?.classList.add('hidden');
      elements.btnHomeToggle?.classList.remove('hidden');
      profileNav?.classList.remove('hidden');
      elements.btnLibraryToggle?.classList.remove('hidden');
      quizzesNav?.classList.remove('hidden');
    }

    const navViewMap = {
      'dashboard': 'btn-home-toggle',
      'profile': 'btn-profile-nav',
      'library': 'btn-library-toggle',
      'quizzes': 'btn-quizzes-toggle',
      'admin': 'btn-admin-toggle',
      'admin-db': 'btn-admin-db-toggle'
    };
    Object.entries(navViewMap).forEach(([v, btnId]) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      if (v === viewName) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
      }
    });
  }

  // Close mobile nav
  const navLinks = document.getElementById('nav-links');
  if (navLinks) {
    navLinks.classList.add('collapsed');
    navLinks.classList.remove('mobile-open');
  }
  const navToggle = document.getElementById('nav-toggle');
  if (navToggle) {
    navToggle.setAttribute('aria-expanded', 'false');
    if (appState.user && viewName !== 'login') {
      navToggle.classList.remove('hidden');
    } else {
      navToggle.classList.add('hidden');
    }
  }
}

function toggleMobileNav() {
  const nav = document.getElementById('nav-links');
  const toggleBtn = document.getElementById('nav-toggle');
  if (!nav) return;
  const isOpen = nav.classList.contains('mobile-open');
  if (isOpen) {
    nav.classList.remove('mobile-open');
    nav.classList.add('collapsed');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  } else {
    nav.classList.add('mobile-open');
    nav.classList.remove('collapsed');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
  }
}
window.toggleMobileNav = toggleMobileNav;

function renderAnalyticsUI(quizzesPassed, streak, notesSaved) {
  const quizzes = Math.max(0, Number(quizzesPassed) || 0);
  const activeStreak = Math.max(1, Number(streak) || 1);
  let rank = 'Novice';
  if (quizzes >= 5) rank = 'Scholar';
  if (quizzes >= 15) rank = 'Master';
  const nextGoal = quizzes < 5 ? 5 : (quizzes < 15 ? 15 : 'Max');

  const streakEl = elements.analyticsStreak || document.getElementById('analytics-streak');
  const quizzesEl = elements.analyticsQuizzes || document.getElementById('analytics-quizzes');
  const notesEl = elements.analyticsNotes || document.getElementById('analytics-notes');
  const rankEl = elements.analyticsRank || document.getElementById('analytics-rank');
  const progTextEl = elements.analyticsProgressText || document.getElementById('analytics-progress-text');
  const progBarEl = elements.analyticsProgressBar || document.getElementById('analytics-progress-bar');

  if (streakEl) streakEl.textContent = activeStreak;
  if (quizzesEl) quizzesEl.textContent = quizzes;
  if (notesEl && notesSaved !== undefined) notesEl.textContent = notesSaved;
  if (rankEl) rankEl.textContent = rank;
  if (progTextEl) {
    progTextEl.textContent = `${quizzes} / ${nextGoal === 'Max' ? quizzes : nextGoal} Quizzes`;
  }
  if (progBarEl) {
    const pct = nextGoal === 'Max' ? 100 : Math.min(100, Math.round((quizzes / (nextGoal || 5)) * 100));
    progBarEl.style.width = `${pct}%`;
  }
}

async function loadAnalytics() {
  if (!appState.user || !appState.user.id) return;
  const localQuizzes = Number(appState.user.quizzes_passed) || 0;
  const localStreak = Number(appState.user.current_streak) || 1;
  renderAnalyticsUI(localQuizzes, localStreak);

  try {
    const res = await fetch(`/api/analytics/${appState.user.id}?username=${encodeURIComponent(appState.user.username || '')}`);
    if (res.ok) {
      const data = await res.json();
      const mergedQuizzes = Math.max(Number(data.quizzes_passed) || 0, Number(appState.user.quizzes_passed) || 0);
      const mergedStreak = Math.max(Number(data.current_streak) || 1, Number(appState.user.current_streak) || 1);
      appState.user.quizzes_passed = mergedQuizzes;
      appState.user.current_streak = mergedStreak;
      if (typeof persistUserSession === 'function') {
        persistUserSession(appState.user);
      }
      renderAnalyticsUI(mergedQuizzes, mergedStreak, data.notes_saved ?? 0);
    }
  } catch (err) {
    console.warn("loadAnalytics error:", err);
  }
}

// --- Instructor / Admin Workspace Engine ---
async function loadAdminDashboard() {
  await Promise.all([
    loadAdminStats(),
    loadAdminCourses(),
    loadAdminUsers(),
    loadAdminQuizzes()
  ]);
  initAdminQuizForm();
}
window.loadAdminDashboard = loadAdminDashboard;


async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (res.ok) {
      const stats = await res.json();
      const sCount = document.getElementById('stat-students-count');
      const cCount = document.getElementById('stat-courses-count');
      const hCount = document.getElementById('stat-homework-count');
      if (sCount) sCount.textContent = stats.students || 0;
      if (cCount) cCount.textContent = stats.courses || 0;
      if (hCount) hCount.textContent = stats.homework || 0;
    }
  } catch (e) {
    console.warn("loadAdminStats error:", e);
  }
}

async function loadAdminCourses() {
  const container = document.getElementById('admin-courses-list');
  const badge = document.getElementById('admin-courses-badge');
  if (!container) return;
  try {
    const res = await fetch('/api/textbooks');
    const courses = await res.json();
    if (badge) badge.textContent = `${courses.length} Active Courses`;
    
    if (!courses || courses.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-secondary); background: rgba(15,23,42,0.3); border-radius: 12px; border: 1px dashed var(--border-color);">
          <div style="margin-bottom: 0.75rem; color: var(--text-secondary); display:flex; justify-content:center;">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
          </div>
          <strong style="color:var(--text-primary); display:block; margin-bottom:0.25rem;">No Courses Currently Published</strong>
          <p style="font-size: 0.85rem; margin-top: 0.25rem; margin-bottom: 0;">Use the form to publish a new course or import a textbook.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    courses.forEach(c => {
      const row = document.createElement('div');
      row.className = 'course-item-row';
      row.style.cssText = 'display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0.75rem; border-bottom:1px solid var(--border-color);';
      const thumbUrl = c.image || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=400&auto=format&fit=crop';
      row.innerHTML = `
        <img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(c.title)}" style="width:48px; height:36px; border-radius:6px; object-fit:cover; flex-shrink:0; border:1px solid var(--border-color);" onerror="this.src='https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=400&auto=format&fit=crop'">
        <div style="flex: 1; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
            <strong style="color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(c.title)}</strong>
            <span class="badge" style="background: rgba(99,102,241,0.15); color: var(--accent-color); font-size: 0.7rem; padding: 2px 8px; border-radius: 8px;">${escapeHtml(c.meta || 'General')}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ID: <span style="font-family: monospace;">${escapeHtml(c.id)}</span> • ${escapeHtml(c.descriptor || 'No description')}
          </div>
        </div>
        <button class="theme-btn" onclick="handleDeleteCourse('${escapeHtml(c.id)}')" style="color: var(--warning-color); border-color: var(--warning-color); padding: 0.35rem 0.75rem; font-size: 0.8rem; border-radius: 8px; flex-shrink: 0;" title="Delete Course">
          Delete
        </button>
      `;
      container.appendChild(row);
    });
  } catch (err) {
    console.error("loadAdminCourses error:", err);
  }
}
window.loadAdminCourses = loadAdminCourses;

async function handleDeleteCourse(tbId) {
  if (!confirm(`Delete course "${tbId}"?`)) return;
  try {
    const res = await fetch(`/api/admin/textbooks/${encodeURIComponent(tbId)}`, { method: 'DELETE' });
    if (res.ok) {
      showToast(`Course deleted: ${tbId}`, "check");
      playEarcon('click');
      await Promise.all([loadAdminCourses(), loadAdminStats(), fetchTextbooks()]);
    }
  } catch (e) {
    console.error("handleDeleteCourse error:", e);
  }
}
window.handleDeleteCourse = handleDeleteCourse;

// Thumbnail presets & handlers for Publish Course section
const THUMBNAIL_PRESETS = {
  ai: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=400&auto=format&fit=crop',
  code: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=400&auto=format&fit=crop',
  data: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=400&auto=format&fit=crop',
  science: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?q=80&w=400&auto=format&fit=crop',
  design: 'https://images.unsplash.com/photo-1551650975-87deedd944c3?q=80&w=400&auto=format&fit=crop'
};

function applyThumbnailPreset(type) {
  const url = THUMBNAIL_PRESETS[type];
  const imgEl = document.getElementById('tb-image');
  if (imgEl && url) {
    imgEl.value = url;
    updateThumbnailPreview();
  }
  document.querySelectorAll('.thumbnail-preset-btn').forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'transparent';
  });
  const activeBtn = document.querySelector(`.thumbnail-preset-btn[data-preset="${type}"]`);
  if (activeBtn) {
    activeBtn.style.borderColor = 'var(--accent-color)';
    activeBtn.style.background = 'rgba(99, 102, 241, 0.15)';
  }
}
window.applyThumbnailPreset = applyThumbnailPreset;

function updateThumbnailPreview() {
  const imgEl = document.getElementById('tb-image');
  const previewImg = document.getElementById('tb-image-preview-img');
  const placeholder = document.getElementById('tb-image-preview-placeholder');
  if (!previewImg || !placeholder) return;

  const url = imgEl ? imgEl.value.trim() : '';
  if (url) {
    previewImg.src = url;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    previewImg.style.display = 'none';
    placeholder.style.display = 'flex';
  }
}
window.updateThumbnailPreview = updateThumbnailPreview;

function handlePreviewError() {
  const previewImg = document.getElementById('tb-image-preview-img');
  const placeholder = document.getElementById('tb-image-preview-placeholder');
  if (previewImg) previewImg.style.display = 'none';
  if (placeholder) {
    placeholder.style.display = 'flex';
    placeholder.innerHTML = `<span style="color:var(--warning-color); font-size:0.75rem;">${getAppSvgIcon('warning', 14)} Unable to load image preview</span>`;
  }
}
window.handlePreviewError = handlePreviewError;

async function handleThumbnailUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);
  formData.append('file', file);
  const uId = (appState.user && appState.user.id) || 1;
  formData.append('user_id', uId);

  try {
    let res = await fetch('/api/upload/thumbnail', {
      method: 'POST',
      body: formData
    });
    if (res.status === 404) {
      // Fallback to existing /api/files endpoint if server has not yet restarted
      res = await fetch('/api/files', {
        method: 'POST',
        body: formData
      });
    }
    const data = await res.json().catch(() => ({}));
    const fileUrl = data.url || (data.filename ? `/uploads/${data.filename}` : '');
    if (res.ok && fileUrl) {
      const imgEl = document.getElementById('tb-image');
      if (imgEl) {
        imgEl.value = fileUrl;
        updateThumbnailPreview();
      }
      showToast("Thumbnail uploaded successfully!", "check");
    } else {
      alert("Failed to upload image: " + (data.error || 'Server error'));
    }
  } catch (err) {
    console.error("Thumbnail upload error:", err);
    alert("Error uploading thumbnail image.");
  }
}
window.handleThumbnailUpload = handleThumbnailUpload;

async function handleAddTextbook() {
  const idEl = document.getElementById('tb-id');
  const titleEl = document.getElementById('tb-title');
  const metaEl = document.getElementById('tb-meta');
  const descEl = document.getElementById('tb-desc');
  const contentEl = document.getElementById('tb-content');
  const imgEl = document.getElementById('tb-image');
  const qEl = document.getElementById('tb-quiz-q');
  const aEl = document.getElementById('tb-quiz-a');

  const id = idEl ? idEl.value.trim() : '';
  const title = titleEl ? titleEl.value.trim() : '';
  const meta = metaEl ? metaEl.value.trim() : 'General';
  const descriptor = descEl && descEl.value.trim() ? descEl.value.trim() : 'Interactive Course Module';
  const content = contentEl ? contentEl.value.trim() : '';
  const image = (imgEl && imgEl.value.trim()) ? imgEl.value.trim() : 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=400&auto=format&fit=crop';
  const quiz_q = qEl && qEl.value.trim() ? qEl.value.trim() : `What is the main topic of ${title}?`;
  const quiz_a = aEl && aEl.value.trim() ? aEl.value.trim() : title;

  if (!id || !title || !content) {
    alert("Please fill in Course ID, Title, and Lesson Content.");
    return;
  }

  const data = {
    id,
    title,
    meta,
    descriptor,
    content,
    image,
    quiz_q,
    quiz_a
  };

  try {
    const res = await fetch('/api/admin/textbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) {
      showToast(`Course published: ${title}`, "check");
      playEarcon('success');
      if (idEl) idEl.value = '';
      if (titleEl) titleEl.value = '';
      if (metaEl) metaEl.value = '';
      if (descEl) descEl.value = '';
      if (contentEl) contentEl.value = '';
      if (imgEl) imgEl.value = '';
      if (qEl) qEl.value = '';
      if (aEl) aEl.value = '';
      updateThumbnailPreview();
      await Promise.all([loadAdminCourses(), loadAdminStats(), fetchTextbooks()]);
    }
  } catch (e) {
    console.error("handleAddTextbook error:", e);
  }
}
window.handleAddTextbook = handleAddTextbook;

async function handleDispatchHomework() {
  const studentSelect = document.getElementById('admin-hw-student-select');
  const titleInput = document.getElementById('admin-hw-title-input');
  const descInput = document.getElementById('admin-hw-desc-input');

  const sId = studentSelect ? studentSelect.value : '';
  const title = titleInput ? titleInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';

  if (!sId || !title) {
    alert("Please select a student and provide an assignment title.");
    return;
  }

  try {
    const res = await fetch('/api/homework', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: sId, title, description: desc })
    });
    if (res.ok) {
      showToast("Coursework successfully assigned!", "check");
      playEarcon('success');
      if (titleInput) titleInput.value = '';
      if (descInput) descInput.value = '';
      await loadAdminStats();
    }
  } catch (e) {
    console.error("handleDispatchHomework error:", e);
  }
}
window.handleDispatchHomework = handleDispatchHomework;

async function loadAdminUsers() {
  try {
    const res = await fetch('/api/admin/users');
    const users = await res.json();
    const tbody = document.getElementById('admin-students-table-body');
    const studentSelect = document.getElementById('admin-hw-student-select');
    
    if (studentSelect) {
      studentSelect.innerHTML = '<option value="">Select a student...</option>';
      (users || []).filter(u => u.role !== 'admin').forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.username} (${u.reg_no || 'ID: ' + u.id}) - ${u.disability || 'Standard'}`;
        studentSelect.appendChild(opt);
      });
    }

    if (!tbody) return;
    const students = (users || []).filter(u => u.role !== 'admin');
    adminCachedStudents = students;
    populateAdminQuizStudentChecklist(students);

    if (!students || students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-secondary);">No registered students yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    students.forEach(s => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      
      let badgeClass = 'acc-standard';
      const dis = s.disability || 'Standard';
      if (dis.toLowerCase().includes('vision')) badgeClass = 'acc-low-vision';
      else if (dis.toLowerCase().includes('auditory') || dis.toLowerCase().includes('hearing')) badgeClass = 'acc-auditory';
      else if (dis.toLowerCase().includes('dyslexia')) badgeClass = 'acc-dyslexia';

      tr.innerHTML = `
        <td style="padding: 0.75rem 0.5rem; font-weight: 600; color: var(--text-primary);">
          ${escapeHtml(s.username)}
          <div style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(s.reg_no || 'STD-' + s.id)}</div>
        </td>
        <td style="padding: 0.75rem 0.5rem; color: var(--text-secondary); font-size: 0.85rem;">
          ${escapeHtml(s.school || 'Gismo Academy')}
        </td>
        <td style="padding: 0.75rem 0.5rem;">
          <span class="accommodation-badge ${badgeClass}">${escapeHtml(dis)}</span>
        </td>
        <td style="padding: 0.75rem 0.5rem; color: var(--accent-secondary); font-weight: 600;">
          ${s.quizzes_passed || 0} passed
        </td>
        <td style="padding: 0.75rem 0.5rem; color: #10b981; font-weight: 600;">
          <span style="display:inline-flex; align-items:center; gap:0.35rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
            ${s.current_streak || 0}d
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("loadAdminUsers error:", err);
  }
}
window.loadAdminUsers = loadAdminUsers;
window.renderAdminUsers = loadAdminUsers;
window.renderAdminLibrary = loadAdminCourses;

// ====================================================================
// --- COMPREHENSIVE QUIZ SYSTEM (Student & Instructor Hub) ---
// ====================================================================

let activeQuizData = null;
let activeQuizCurrentIndex = 0;
let activeQuizUserAnswers = [];
let adminCachedQuizzes = [];
let adminCachedStudents = [];
let adminQuizQuestionCounter = 0;

// --- 1. STUDENT QUIZ TAB & LIST ---
function switchStudentQuizTab(tab) {
  const btnAssigned = document.getElementById('btn-quiz-tab-assigned');
  const btnAi = document.getElementById('btn-quiz-tab-ai');
  const viewAssigned = document.getElementById('student-quiz-assigned-view');
  const viewAi = document.getElementById('student-quiz-ai-view');

  if (tab === 'ai') {
    if (btnAssigned) btnAssigned.classList.remove('active');
    if (btnAi) btnAi.classList.add('active');
    if (viewAssigned) viewAssigned.classList.add('hidden');
    if (viewAi) viewAi.classList.remove('hidden');
    playEarcon('click');
  } else {
    if (btnAi) btnAi.classList.remove('active');
    if (btnAssigned) btnAssigned.classList.add('active');
    if (viewAi) viewAi.classList.add('hidden');
    if (viewAssigned) viewAssigned.classList.remove('hidden');
    loadStudentQuizzes();
    playEarcon('click');
  }
}
window.switchStudentQuizTab = switchStudentQuizTab;

async function loadStudentQuizzes() {
  const grid = document.getElementById('student-assigned-quizzes-grid');
  const badgeCount = document.getElementById('student-assigned-badge-count');
  if (!grid) return;

  const studentId = (appState.user && appState.user.id) || '';
  grid.innerHTML = '<div class="col-12 text-center" style="color:var(--text-secondary); padding:2.5rem;">Loading assigned quizzes...</div>';

  try {
    const res = await fetch(`/api/quizzes?student_id=${encodeURIComponent(studentId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quizzes = await res.json();

    if (badgeCount) {
      const pendingCount = quizzes.filter(q => !q.submission).length;
      badgeCount.textContent = pendingCount;
    }

    if (!quizzes || quizzes.length === 0) {
      grid.innerHTML = `
        <div class="col-12 text-center" style="padding: 3rem 1.5rem; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: 16px;">
          <div style="width: 56px; height: 56px; margin: 0 auto 1rem auto; border-radius: 50%; background: rgba(99,102,241,0.1); display: flex; align-items: center; justify-content: center; color: var(--accent-color);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          </div>
          <h4 style="margin: 0 0 0.5rem 0; color: var(--text-primary); font-size: 1.15rem;">No Assigned Quizzes Yet</h4>
          <p style="color: var(--text-secondary); max-width: 450px; margin: 0 auto 1.5rem auto; font-size: 0.9rem;">
            Your teacher has not assigned any custom quizzes to your account. You can create an instant quiz on any topic right now with Gismo AI!
          </p>
          <button class="btn-primary" onclick="switchStudentQuizTab('ai')" style="padding: 0.65rem 1.5rem;">
            Try AI Quiz Generator →
          </button>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    quizzes.forEach(q => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4';

      const hasSubmission = !!q.submission;
      let statusBadge = '';
      let actionBtn = '';

      if (hasSubmission) {
        const passed = (q.submission.percentage || 0) >= 60;
        const color = passed ? '#10b981' : '#f59e0b';
        statusBadge = `
          <span class="badge" style="background:${passed ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'}; color:${color}; border:1px solid ${color}; border-radius:12px; font-size:0.75rem; padding:0.3rem 0.65rem;">
            ${passed ? 'Passed' : 'Completed'} (${q.submission.score}/${q.submission.total} • ${q.submission.percentage}%)
          </span>
        `;
        actionBtn = `
          <button class="theme-btn w-100" onclick="startQuizById(${q.id})" style="border-radius:10px; padding:0.6rem; font-weight:600; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
            <span>Retake Assessment</span>
          </button>
        `;
      } else {
        statusBadge = `
          <span class="badge" style="background:rgba(99,102,241,0.15); color:var(--accent-color); border:1px solid var(--accent-color); border-radius:12px; font-size:0.75rem; padding:0.3rem 0.65rem;">
            ● Pending Assessment
          </span>
        `;
        actionBtn = `
          <button class="btn-primary w-100" onclick="startQuizById(${q.id})" style="border-radius:10px; padding:0.65rem; font-weight:600; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
            <span>Take Quiz</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        `;
      }

      col.innerHTML = `
        <div class="quiz-card-student">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-2">
              <span class="badge" style="background:var(--bg-secondary); color:var(--text-secondary); border:1px solid var(--border-color); border-radius:10px; font-size:0.75rem;">
                ${escapeHtml(q.subject || 'General')}
              </span>
              ${statusBadge}
            </div>
            <h4 style="margin:0 0 0.5rem 0; font-size:1.15rem; color:var(--text-primary);">${escapeHtml(q.title)}</h4>
            <div style="font-size:0.85rem; color:var(--text-secondary); display:flex; align-items:center; gap:0.75rem;">
              <span><strong>${q.question_count || 0}</strong> Questions</span>
              <span>•</span>
              <span>By ${q.created_by === 'ai' ? 'Gismo AI' : 'Instructor'}</span>
            </div>
          </div>
          <div class="pt-2 border-top border-secondary">
            ${actionBtn}
          </div>
        </div>
      `;
      grid.appendChild(col);
    });

  } catch (err) {
    console.error("loadStudentQuizzes error:", err);
    grid.innerHTML = `<div class="col-12 text-center" style="color:var(--warning-color); padding:2rem;">Failed to load quizzes: ${escapeHtml(err.message)}</div>`;
  }
}
window.loadStudentQuizzes = loadStudentQuizzes;

// --- 2. AI QUIZ GENERATOR TRIGGER ---
function selectQuickQuizTopic(topic) {
  const input = document.getElementById('ai-quiz-topic-input');
  if (input) {
    input.value = topic;
    input.focus();
    playEarcon('click');
  }
}
window.selectQuickQuizTopic = selectQuickQuizTopic;

function startVoiceQuizTopicDictation() {
  const input = document.getElementById('ai-quiz-topic-input');
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast("Voice speech recognition not supported in this browser.", "warning");
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  showToast("Listening for your quiz topic...", "mic");
  announceTTS("Listening for your quiz topic. Please speak now.");

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if (input) input.value = text;
    showToast(`Topic captured: "${text}"`, "check");
    announceTTS(`Topic captured: ${text}`);
  };
  recognition.onerror = () => {
    showToast("Could not capture speech. Please type your topic.", "warning");
  };
  recognition.start();
}
window.startVoiceQuizTopicDictation = startVoiceQuizTopicDictation;

async function handleTriggerAiQuiz(topicOverride) {
  const input = document.getElementById('ai-quiz-topic-input');
  const countSelect = document.getElementById('ai-quiz-count-select');
  const diffSelect = document.getElementById('ai-quiz-difficulty-select');
  const btn = document.getElementById('btn-generate-ai-quiz');

  const topic = (topicOverride || (input ? input.value : '')).trim();
  if (!topic) {
    alert("Please enter a topic for the AI Quiz Generator.");
    if (input) input.focus();
    return;
  }

  const count = countSelect ? parseInt(countSelect.value, 10) : 3;
  const difficulty = diffSelect ? diffSelect.value : 'intermediate';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="margin-right:0.4rem;"></span>
      <span>Generating Quiz with Antigravity AI...</span>
    `;
  }

  showToast(`Generating AI quiz on "${topic}"...`, "bot");
  announceTTS(`Generating an accessible quiz on ${topic}. Please wait a moment.`);
  playEarcon('click');

  try {
    const res = await fetch('/api/ai/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, count, difficulty })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quizData = await res.json();

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <span>Generate AI Quiz &amp; Start</span>
      `;
    }

    playEarcon('success');
    startInteractiveQuiz(quizData, 'AI Generator');

  } catch (err) {
    console.error("handleTriggerAiQuiz error:", err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        <span>Generate AI Quiz &amp; Start</span>
      `;
    }
    showToast(`Quiz generation error: ${err.message}`, "warning");
  }
}
window.handleTriggerAiQuiz = handleTriggerAiQuiz;

async function startQuizById(quizId) {
  try {
    showToast("Loading quiz...", "loading");
    const res = await fetch(`/api/quizzes/${quizId}`);
    if (!res.ok) throw new Error("Quiz not found");
    const quiz = await res.json();
    startInteractiveQuiz(quiz, quiz.created_by === 'ai' ? 'AI Quiz' : 'Instructor Assigned');
  } catch (err) {
    console.error("startQuizById error:", err);
    showToast("Could not load quiz details.", "warning");
  }
}
window.startQuizById = startQuizById;

// --- 3. INTERACTIVE QUIZ RUNNER MODAL & VOICE ANSWER ENGINE ---
const quizVoiceState = {
  enabled: false,
  autoAdvance: localStorage.getItem('gismo_quiz_voice_auto_advance') === 'true',
  recognition: null,
  isListening: false,
  autoAdvanceTimer: null,
  pendingUnansweredConfirm: false
};
window.quizVoiceState = quizVoiceState;

function isQuizModalOpen() {
  const modal = document.getElementById('quiz-modal');
  return !!(modal && !modal.classList.contains('hidden'));
}
window.isQuizModalOpen = isQuizModalOpen;

function isQuizResultsVisible() {
  const resultsContainer = document.getElementById('quiz-results-container');
  return !!(resultsContainer && !resultsContainer.classList.contains('hidden'));
}

function updateQuizVoiceUI(state = 'idle', title = '', subtext = '') {
  const headerBtn = document.getElementById('btn-quiz-voice-toggle');
  const headerLabel = document.getElementById('btn-quiz-voice-label');
  const bar = document.getElementById('quiz-voice-bar');
  const titleEl = document.getElementById('quiz-voice-status-title');
  const subtextEl = document.getElementById('quiz-voice-status-subtext');
  const autoChk = document.getElementById('quiz-voice-auto-advance-chk');

  if (autoChk) {
    autoChk.checked = !!quizVoiceState.autoAdvance;
  }

  const isVoiceActive = quizVoiceState.enabled || (typeof voiceNavState !== 'undefined' && voiceNavState.isListening);

  if (headerBtn) {
    headerBtn.classList.toggle('listening', isVoiceActive);
    headerBtn.setAttribute('aria-pressed', isVoiceActive ? 'true' : 'false');
  }
  if (headerLabel) {
    headerLabel.textContent = isVoiceActive ? 'Voice Active' : 'Voice Answer';
  }

  if (!bar) return;
  bar.classList.remove('listening', 'matched', 'error');

  if (state === 'matched') {
    bar.classList.add('matched');
  } else if (state === 'error') {
    bar.classList.add('error');
  } else if (isVoiceActive) {
    bar.classList.add('listening');
  }

  if (titleEl) {
    const iconName = state === 'matched' ? 'check' : (state === 'error' ? 'warning' : 'mic');
    const displayTitle = title || (isVoiceActive ? 'Listening for Your Answer...' : 'Speak Your Answer (Hands-Free)');
    titleEl.style.display = 'flex';
    titleEl.style.alignItems = 'center';
    titleEl.style.gap = '0.4rem';
    titleEl.innerHTML = `${getAppSvgIcon(iconName, 16)}<span>${escapeHtml(displayTitle)}</span>`;
  }

  if (subtextEl) {
    if (subtext) {
      subtextEl.innerHTML = subtext;
    } else if (isVoiceActive) {
      subtextEl.innerHTML = 'Say <strong>"Option A, B, C, or D"</strong>, speak the answer text, or say <strong>"Next"</strong> / <strong>"Submit"</strong>.';
    } else {
      subtextEl.innerHTML = 'Click the mic (or press <kbd>V</kbd>) and say <strong>"Option A, B, C, or D"</strong>, or say the answer text aloud.';
    }
  }
}
window.updateQuizVoiceUI = updateQuizVoiceUI;

function toggleQuizVoiceAutoAdvance(checked) {
  quizVoiceState.autoAdvance = !!checked;
  localStorage.setItem('gismo_quiz_voice_auto_advance', quizVoiceState.autoAdvance ? 'true' : 'false');
  showToast(quizVoiceState.autoAdvance ? 'Auto-Next enabled for voice answers' : 'Auto-Next disabled', "mic");
}
window.toggleQuizVoiceAutoAdvance = toggleQuizVoiceAutoAdvance;

function initQuizVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return null;

  const rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onstart = () => {
    quizVoiceState.isListening = true;
    if (isQuizModalOpen()) {
      updateQuizVoiceUI('listening');
    }
  };

  rec.onresult = (event) => {
    if (typeof voiceNavState !== 'undefined') {
      if (voiceNavState.isSpeaking || (Date.now() - (voiceNavState.lastSpeakingEndTime || 0) < 800)) {
        return;
      }
    }

    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const displayPhrase = (finalTranscript || interimTranscript).trim();
    if (!displayPhrase) return;

    if (typeof isEchoOfRecentSpeech === 'function' && isEchoOfRecentSpeech(displayPhrase)) {
      return;
    }
    if (typeof verifyStudentVoiceInput === 'function' && !verifyStudentVoiceInput(displayPhrase)) {
      return;
    }

    if (interimTranscript && !finalTranscript) {
      updateQuizVoiceUI('listening', 'Hearing your voice...', `Heard: <em>"${escapeHtml(displayPhrase)}"</em>`);
    }

    if (finalTranscript.trim()) {
      handleQuizVoiceCommand(finalTranscript.trim());
    }
  };

  rec.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    console.warn('Quiz Voice Recognition error:', event.error);
    if (event.error === 'not-allowed') {
      quizVoiceState.enabled = false;
      quizVoiceState.isListening = false;
      updateQuizVoiceUI('error', 'Microphone Permission Needed', 'Please allow microphone access in your browser to speak quiz answers.');
    }
  };

  rec.onend = () => {
    quizVoiceState.isListening = false;
    const isTtsSpeaking = typeof voiceNavState !== 'undefined' && (voiceNavState.isSpeaking || (Date.now() - (voiceNavState.lastSpeakingEndTime || 0) < 800));
    const isGlobalNavActive = typeof voiceNavState !== 'undefined' && voiceNavState.isListening;
    if (quizVoiceState.enabled && isQuizModalOpen() && !isTtsSpeaking && !isGlobalNavActive) {
      try {
        rec.start();
      } catch (_) {}
    }
  };

  return rec;
}

function startQuizVoiceMode() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('Voice recognition is not supported in this browser.', "warning");
    updateQuizVoiceUI('error', 'Voice Not Supported', 'Your browser does not support Web Speech Recognition. Try Chrome or Edge.');
    return;
  }

  quizVoiceState.enabled = true;

  // Stop any active TTS so the student can speak immediately
  stopAllTTS();

  if (typeof setupVoiceIsolationAudioStream === 'function') {
    setupVoiceIsolationAudioStream();
  }

  // If global Voice Nav is already active, it will feed commands directly into handleQuizVoiceCommand
  if (typeof voiceNavState !== 'undefined' && voiceNavState.isListening) {
    try {
      voiceNavState.recognition.start();
    } catch (_) {}
  } else {
    if (!quizVoiceState.recognition) {
      quizVoiceState.recognition = initQuizVoiceRecognition();
    }
    if (quizVoiceState.recognition) {
      try {
        quizVoiceState.recognition.start();
      } catch (_) {}
    }
  }

  playEarcon('listening');
  updateQuizVoiceUI('listening', 'Listening for Your Answer...', 'Say <strong>"Option A, B, C, or D"</strong>, speak the answer text, or say <strong>"Next"</strong> / <strong>"Submit"</strong>.');
  showToast('Voice Answer Mode Active — Speak your answer!', "mic");
}
window.startQuizVoiceMode = startQuizVoiceMode;

function stopQuizVoiceMode(silent = false) {
  quizVoiceState.enabled = false;
  quizVoiceState.isListening = false;
  if (quizVoiceState.autoAdvanceTimer) {
    clearTimeout(quizVoiceState.autoAdvanceTimer);
    quizVoiceState.autoAdvanceTimer = null;
  }
  if (quizVoiceState.recognition) {
    try {
      quizVoiceState.recognition.stop();
    } catch (_) {}
  }
  if (!silent) {
    playEarcon('click');
    showToast('Voice Answer Mode Off', "info");
  }
  updateQuizVoiceUI('idle');
}
window.stopQuizVoiceMode = stopQuizVoiceMode;

function toggleQuizVoiceMode() {
  const isVoiceActive = quizVoiceState.enabled || (typeof voiceNavState !== 'undefined' && voiceNavState.isListening);
  if (isVoiceActive) {
    if (typeof voiceNavState !== 'undefined' && voiceNavState.isListening) {
      stopVoiceNavigator();
    }
    stopQuizVoiceMode();
  } else {
    startQuizVoiceMode();
  }
}
window.toggleQuizVoiceMode = toggleQuizVoiceMode;

// Matches spoken student input to option index 0..3 (by letter, ordinal, number, or option text content)
function matchSpokenQuizOption(rawTranscript, options) {
  if (!rawTranscript || !Array.isArray(options) || options.length === 0) return -1;

  const cleaned = rawTranscript
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:"'()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return -1;

  // Strip trailing navigation words if user said e.g. "Option B next" or "Mitochondria and submit"
  const withoutTrailingNav = cleaned
    .replace(/\s+(?:and\s+)?(?:next|next question|continue|submit|submit answers|done)$/i, '')
    .trim();

  // Strip common conversational prefixes ("I think it's", "My answer is", "Select", "Choose", etc.)
  const core = withoutTrailingNav
    .replace(/^(?:uh|um|er|ah|well|okay|ok|so)\s+/i, '')
    .replace(/^(?:i think|i believe|i guess|i say|my answer is|the answer is|the correct answer is|it is|its|it's|i choose|i pick|i select|i will go with|i'll go with|go with|let's go with|lets go with|select|pick|choose|mark)\s+/i, '')
    .replace(/^(?:that\s+|the\s+)?/i, '')
    .trim();

  // 1. Check explicit "Option/Answer/Choice/Letter/Number X" pattern
  const explicitMatch = withoutTrailingNav.match(
    /\b(?:option|answer|choice|letter|number|select|pick|choose)\s+(a|b|c|d|1|2|3|4|one|two|three|four|first|second|third|fourth|ay|eh|bee|be|see|sea|dee|to|too|for)\b/i
  );
  if (explicitMatch) {
    const token = explicitMatch[1].toLowerCase();
    const map = {
      'a': 0, 'ay': 0, 'eh': 0, '1': 0, 'one': 0, 'first': 0,
      'b': 1, 'bee': 1, 'be': 1, '2': 1, 'two': 1, 'to': 1, 'too': 1, 'second': 1,
      'c': 2, 'see': 2, 'sea': 2, '3': 2, 'three': 2, 'third': 2,
      'd': 3, 'dee': 3, '4': 3, 'four': 3, 'for': 3, 'fourth': 3
    };
    if (map[token] !== undefined && map[token] < options.length) {
      return map[token];
    }
  }

  // 2. Check ordinal phrase ("first option", "second one", "last option", etc.)
  if (/^(?:the\s+)?(?:first|1st)(?:\s+(?:one|option|answer|choice))?$/i.test(core)) return 0;
  if (/^(?:the\s+)?(?:second|2nd)(?:\s+(?:one|option|answer|choice))?$/i.test(core)) return 1;
  if (/^(?:the\s+)?(?:third|3rd)(?:\s+(?:one|option|answer|choice))?$/i.test(core)) return 2;
  if (/^(?:the\s+)?(?:fourth|4th|last)(?:\s+(?:one|option|answer|choice))?$/i.test(core)) return Math.min(3, options.length - 1);

  // 3. Direct standalone letter / homophone / number utterance
  const directMap = {
    'a': 0, 'hey': 0, 'ay': 0, 'eh': 0, '1': 0, 'one': 0, 'won': 0,
    'b': 1, 'be': 1, 'bee': 1, '2': 1, 'two': 1, 'to': 1, 'too': 1,
    'c': 2, 'see': 2, 'sea': 2, '3': 2, 'three': 2,
    'd': 3, 'dee': 3, '4': 3, 'four': 3
  };
  if (directMap[core] !== undefined && directMap[core] < options.length) {
    return directMap[core];
  }

  // 4. Check if student said letter followed by option text, e.g. "B training an algorithm"
  const leadingLetterMatch = core.match(/^(?:option\s+|answer\s+|choice\s+)?(a|b|c|d)\s+(.+)$/i);
  if (leadingLetterMatch) {
    const letterIdx = { a: 0, b: 1, c: 2, d: 3 }[leadingLetterMatch[1].toLowerCase()];
    const remainder = leadingLetterMatch[2].trim();
    if (letterIdx !== undefined && letterIdx < options.length) {
      const optNorm = String(options[letterIdx]).toLowerCase().replace(/[.,!?;:"'()\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
      const firstWords = optNorm.split(' ').slice(0, 3).join(' ');
      if (optNorm.includes(remainder) || remainder.includes(firstWords) || (leadingLetterMatch[1].toLowerCase() !== 'a')) {
        return letterIdx;
      }
    }
  }

  // 5. Content / Fuzzy Answer Text Matching against the 4 options
  const stopwords = new Set([
    'the', 'a', 'an', 'to', 'of', 'in', 'is', 'are', 'was', 'were',
    'for', 'and', 'or', 'by', 'on', 'with', 'that', 'this', 'from',
    'as', 'at', 'it', 'be', 'can', 'into', 'how', 'what', 'when', 'which'
  ]);

  const spokenWordsAll = core.split(' ').filter(w => w.length >= 2);
  const spokenKeywords = spokenWordsAll.filter(w => !stopwords.has(w));
  const activeSpokenTokens = spokenKeywords.length > 0 ? spokenKeywords : spokenWordsAll;

  let bestIdx = -1;
  let bestScore = 0;
  let secondBestScore = 0;

  options.forEach((optText, idx) => {
    const optNorm = String(optText)
      .toLowerCase()
      .replace(/[.,!?;:"'()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!optNorm) return;

    let score = 0;

    // Exact full text match
    if (optNorm === core || optNorm === cleaned) {
      score += 1000;
    }

    // Substring match
    if (core.length >= 3 && optNorm.includes(core)) {
      score += 120 + Math.round((core.length / optNorm.length) * 100);
    } else if (optNorm.length >= 3 && core.includes(optNorm)) {
      score += 140 + Math.round((optNorm.length / core.length) * 100);
    }

    // Word / token overlap
    const optWordsAll = optNorm.split(' ').filter(w => w.length >= 2);
    const optKeywords = optWordsAll.filter(w => !stopwords.has(w));
    const targetOptTokens = optKeywords.length > 0 ? optKeywords : optWordsAll;

    let matchedTokenCount = 0;
    for (const sw of activeSpokenTokens) {
      if (targetOptTokens.includes(sw)) {
        score += 30;
        matchedTokenCount++;
      } else {
        // Stem / prefix match for words >= 4 chars (e.g., "supervise" vs "supervised", "mitochondria" vs "mitochondrial")
        const stemMatch = targetOptTokens.some(ow =>
          (ow.length >= 4 && sw.length >= 4) &&
          (ow.startsWith(sw.slice(0, 4)) || sw.startsWith(ow.slice(0, 4)))
        );
        if (stemMatch) {
          score += 20;
          matchedTokenCount++;
        }
      }
    }

    if (matchedTokenCount > 0 && targetOptTokens.length > 0) {
      const coverageBonus = Math.round((matchedTokenCount / targetOptTokens.length) * 40);
      score += coverageBonus;
    }

    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestIdx = idx;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  });

  if (bestIdx !== -1 && bestScore >= 20 && bestScore > secondBestScore) {
    return bestIdx;
  }

  return -1;
}
window.matchSpokenQuizOption = matchSpokenQuizOption;

function handleQuizVoiceCommand(rawTranscript) {
  if (!isQuizModalOpen() || !activeQuizData) return false;

  const t = rawTranscript
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ');

  if (!t) return false;

  // Clear any pending auto-advance timer when user speaks a new command
  if (quizVoiceState.autoAdvanceTimer) {
    clearTimeout(quizVoiceState.autoAdvanceTimer);
    quizVoiceState.autoAdvanceTimer = null;
  }

  // --- A. If Quiz Results Screen is currently visible ---
  if (isQuizResultsVisible()) {
    if (t.includes('retake') || t.includes('try again') || t.includes('restart') || t.includes('start over')) {
      playEarcon('success');
      retakeActiveQuiz();
      return true;
    }
    if (t.includes('read') || t.includes('summary') || t.includes('score') || t.includes('listen') || t.includes('result')) {
      playEarcon('click');
      speakQuizResultsSummary();
      return true;
    }
    if (t.includes('close') || t.includes('done') || t.includes('exit') || t.includes('finish')) {
      playEarcon('click');
      closeQuizModal();
      return true;
    }
    return false;
  }

  // --- B. Active Question View Commands ---
  const q = activeQuizData.questions[activeQuizCurrentIndex];
  if (!q) return false;

  // 1. Check if confirming a pending submission with unanswered questions
  if (quizVoiceState.pendingUnansweredConfirm && (t === 'yes' || t === 'confirm' || t.includes('submit') || t.includes('yes submit'))) {
    quizVoiceState.pendingUnansweredConfirm = false;
    submitActiveQuiz(true, true);
    return true;
  }
  quizVoiceState.pendingUnansweredConfirm = false;

  // 2. Pure Quiz Control Commands
  if (
    t === 'repeat' || t === 'listen' || t === 'read' ||
    t.includes('repeat question') || t.includes('read question') ||
    t.includes('read again') || t.includes('speak question') ||
    t.includes('read options') || t.includes('what is the question')
  ) {
    playEarcon('click');
    updateQuizVoiceUI('listening', 'Reading Question Aloud...', 'Listening will resume automatically after reading.');
    speakCurrentQuizQuestion();
    return true;
  }

  if (
    t === 'next' || t === 'next question' || t === 'continue' ||
    t === 'go next' || t === 'skip' || t === 'forward'
  ) {
    playEarcon('click');
    updateQuizVoiceUI('matched', 'Moving to Next Question...', `Heard: "${escapeHtml(rawTranscript)}"`);
    goToNextQuizQuestion(true);
    return true;
  }

  if (
    t === 'previous' || t === 'previous question' || t === 'go back' ||
    t === 'back' || t === 'prior question'
  ) {
    playEarcon('click');
    updateQuizVoiceUI('matched', 'Moving to Previous Question...', `Heard: "${escapeHtml(rawTranscript)}"`);
    goToPrevQuizQuestion();
    return true;
  }

  if (
    t === 'submit' || t === 'submit quiz' || t === 'submit answers' ||
    t === 'submit my answers' || t === 'finish quiz' || t === 'grade quiz' || t === 'done'
  ) {
    playEarcon('click');
    updateQuizVoiceUI('matched', 'Submitting Quiz...', `Heard: "${escapeHtml(rawTranscript)}"`);
    submitActiveQuiz(true);
    return true;
  }

  if (t === 'close quiz' || t === 'cancel quiz' || t === 'exit quiz' || t === 'quit quiz') {
    playEarcon('click');
    closeQuizModal();
    return true;
  }

  if (t.includes('auto next') || t.includes('auto advance')) {
    toggleQuizVoiceAutoAdvance(!quizVoiceState.autoAdvance);
    updateQuizVoiceUI('listening');
    return true;
  }

  // 3. Match Spoken Option (A, B, C, D, 1, 2, 3, 4, or option text)
  const matchedIdx = matchSpokenQuizOption(rawTranscript, q.options || []);
  if (matchedIdx !== -1) {
    const letters = ['A', 'B', 'C', 'D'];
    const letter = letters[matchedIdx] || String(matchedIdx + 1);
    const chosenText = (q.options && q.options[matchedIdx]) || '';

    selectQuizOption(matchedIdx);
    playEarcon('success');

    // Pulse animation on the selected button
    const optBtns = document.querySelectorAll('#quiz-options .quiz-option-btn');
    if (optBtns[matchedIdx]) {
      optBtns[matchedIdx].classList.add('voice-selected-pulse');
    }

    const total = activeQuizData.questions.length;
    const isLast = activeQuizCurrentIndex === total - 1;
    const wantsImmediateNext = /\b(?:and\s+)?(?:next|next question|continue|submit|submit answers)\s*$/i.test(t);

    if (typeof updateVoiceHudState === 'function') {
      updateVoiceHudState('matched', `Selected Option ${letter}`, chosenText);
    }

    if (quizVoiceState.autoAdvance || wantsImmediateNext) {
      updateQuizVoiceUI(
        'matched',
        `Selected Option ${letter}: "${chosenText}"`,
        `Heard: <em>"${escapeHtml(rawTranscript)}"</em> — ${isLast ? 'Submitting quiz...' : 'Advancing to next question...'}`
      );
      announceTTS(`Selected Option ${letter}: ${chosenText}.`, () => {
        if (!isQuizModalOpen() || isQuizResultsVisible()) return;
        quizVoiceState.autoAdvanceTimer = setTimeout(() => {
          goToNextQuizQuestion(true);
        }, 500);
      });
    } else {
      const nextActionWord = isLast ? 'Submit' : 'Next';
      updateQuizVoiceUI(
        'matched',
        `Selected Option ${letter}`,
        `Heard: <em>"${escapeHtml(rawTranscript)}"</em> — Say <strong>"${nextActionWord}"</strong> to continue, or say another option to change.`
      );
      announceTTS(`Selected Option ${letter}: ${chosenText}. Say ${nextActionWord} to continue.`);
    }

    return true;
  }

  // 4. Unrecognized phrase while in Quiz Voice Mode
  if (t.length >= 2) {
    playEarcon('error');
    updateQuizVoiceUI(
      'error',
      `Didn't catch an option for "${rawTranscript}"`,
      `Try saying <strong>"Option A"</strong>, <strong>"Option B"</strong>, <strong>"Option C"</strong>, <strong>"Option D"</strong>, or <strong>"Next"</strong>.`
    );
    return true;
  }

  return false;
}
window.handleQuizVoiceCommand = handleQuizVoiceCommand;

function startInteractiveQuiz(quizData, sourceLabel) {
  if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
    alert("This quiz contains no questions.");
    return;
  }

  activeQuizData = quizData;
  window.activeQuizData = quizData;
  activeQuizCurrentIndex = 0;
  activeQuizUserAnswers = new Array(quizData.questions.length).fill(null);
  quizVoiceState.pendingUnansweredConfirm = false;

  const modal = document.getElementById('quiz-modal');
  const titleEl = document.getElementById('quiz-runner-title');
  const subjectBadge = document.getElementById('quiz-runner-badge-subject');
  const sourceBadge = document.getElementById('quiz-runner-badge-source');
  const activeBody = document.getElementById('quiz-active-body');
  const progressSection = document.getElementById('quiz-progress-section');
  const resultsContainer = document.getElementById('quiz-results-container');
  const controlsActive = document.getElementById('quiz-controls-active');
  const controlsResults = document.getElementById('quiz-controls-results');

  if (titleEl) titleEl.textContent = quizData.title || 'Knowledge Assessment';
  if (subjectBadge) subjectBadge.textContent = quizData.subject || 'General';
  if (sourceBadge) sourceBadge.textContent = sourceLabel || 'Interactive Assessment';

  if (activeBody) activeBody.classList.remove('hidden');
  if (progressSection) progressSection.classList.remove('hidden');
  if (controlsActive) controlsActive.classList.remove('hidden');
  if (resultsContainer) resultsContainer.classList.add('hidden');
  if (controlsResults) controlsResults.classList.add('hidden');

  if (modal) modal.classList.remove('hidden');

  renderCurrentQuizQuestion();
  updateQuizVoiceUI();

  const q0 = quizData.questions[0];
  const letters = ['A', 'B', 'C', 'D'];
  const optsText = (q0.options || []).map((o, idx) => `Option ${letters[idx]}: ${o}`).join('. ');
  announceTTS(`Starting ${quizData.title}. Question 1: ${q0.question}. ${optsText}`);
}
window.startInteractiveQuiz = startInteractiveQuiz;

function renderCurrentQuizQuestion() {
  if (!activeQuizData || !activeQuizData.questions) return;
  const total = activeQuizData.questions.length;
  const q = activeQuizData.questions[activeQuizCurrentIndex];

  const progressLabel = document.getElementById('quiz-progress');
  const progressPct = document.getElementById('quiz-progress-pct');
  const progressFill = document.getElementById('quiz-progress-fill');
  const questionTitle = document.getElementById('quiz-question');
  const optionsContainer = document.getElementById('quiz-options');
  const prevBtn = document.getElementById('btn-quiz-prev');
  const nextBtn = document.getElementById('btn-quiz-next');

  const currentNumber = activeQuizCurrentIndex + 1;
  const pct = Math.round((currentNumber / total) * 100);

  if (progressLabel) progressLabel.textContent = `Question ${currentNumber} of ${total}`;
  if (progressPct) progressPct.textContent = `${pct}%`;
  if (progressFill) progressFill.style.width = `${pct}%`;
  if (questionTitle) questionTitle.textContent = q.question;

  if (prevBtn) prevBtn.disabled = activeQuizCurrentIndex === 0;
  if (nextBtn) {
    if (activeQuizCurrentIndex === total - 1) {
      nextBtn.innerHTML = `Submit Answers ${getAppSvgIcon('check', 14)}`;
      nextBtn.style.background = 'var(--accent-gradient, var(--accent-color))';
    } else {
      nextBtn.innerHTML = `Next Question →`;
      nextBtn.style.background = 'var(--accent-color)';
    }
  }

  if (optionsContainer) {
    optionsContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    const currentSelected = activeQuizUserAnswers[activeQuizCurrentIndex];

    (q.options || []).forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `quiz-option-btn ${currentSelected === idx ? 'selected' : ''}`;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', currentSelected === idx ? 'true' : 'false');
      btn.setAttribute('aria-label', `Option ${letters[idx]}: ${opt}`);
      btn.onclick = () => selectQuizOption(idx);

      btn.innerHTML = `
        <span class="quiz-option-letter">${letters[idx]}</span>
        <span style="flex:1;">${escapeHtml(opt)}</span>
        ${currentSelected === idx ? '<span style="color:var(--accent-color); display:inline-flex; align-items:center;">' + getAppSvgIcon("check", 18) + '</span>' : ''}
      `;
      optionsContainer.appendChild(btn);
    });
  }
}

function selectQuizOption(optIdx) {
  activeQuizUserAnswers[activeQuizCurrentIndex] = optIdx;
  renderCurrentQuizQuestion();
  playEarcon('click');
}
window.selectQuizOption = selectQuizOption;

function goToPrevQuizQuestion() {
  if (quizVoiceState.autoAdvanceTimer) {
    clearTimeout(quizVoiceState.autoAdvanceTimer);
    quizVoiceState.autoAdvanceTimer = null;
  }
  if (activeQuizCurrentIndex > 0) {
    activeQuizCurrentIndex--;
    renderCurrentQuizQuestion();
    updateQuizVoiceUI();
    playEarcon('click');
    speakCurrentQuizQuestion();
  }
}
window.goToPrevQuizQuestion = goToPrevQuizQuestion;

function goToNextQuizQuestion(fromVoice = false) {
  if (quizVoiceState.autoAdvanceTimer) {
    clearTimeout(quizVoiceState.autoAdvanceTimer);
    quizVoiceState.autoAdvanceTimer = null;
  }
  if (!activeQuizData) return;
  const total = activeQuizData.questions.length;

  if (activeQuizCurrentIndex === total - 1) {
    submitActiveQuiz(fromVoice);
  } else {
    activeQuizCurrentIndex++;
    renderCurrentQuizQuestion();
    updateQuizVoiceUI();
    playEarcon('click');
    speakCurrentQuizQuestion();
  }
}
window.goToNextQuizQuestion = goToNextQuizQuestion;

function speakCurrentQuizQuestion() {
  if (!activeQuizData || !activeQuizData.questions) return;
  const q = activeQuizData.questions[activeQuizCurrentIndex];
  const letters = ['A', 'B', 'C', 'D'];
  const optsText = (q.options || []).map((o, idx) => `Option ${letters[idx]}: ${o}`).join('. ');
  announceTTS(`Question ${activeQuizCurrentIndex + 1}: ${q.question}. ${optsText}`);
}
window.speakCurrentQuizQuestion = speakCurrentQuizQuestion;

async function submitActiveQuiz(fromVoice = false, forceSubmit = false) {
  if (!activeQuizData) return;
  const total = activeQuizData.questions.length;
  const unanswered = activeQuizUserAnswers.filter(a => a === null || a === undefined).length;

  if (unanswered > 0 && !forceSubmit) {
    if (fromVoice) {
      quizVoiceState.pendingUnansweredConfirm = true;
      updateQuizVoiceUI(
        'error',
        `${unanswered} Unanswered Question${unanswered === 1 ? '' : 's'}`,
        `Say <strong>"Confirm"</strong> or <strong>"Submit"</strong> again to submit anyway, or say <strong>"Previous"</strong> to go back.`
      );
      announceTTS(`You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Say Confirm or Submit again to submit anyway, or say Previous to go back.`);
      return;
    } else {
      const ok = confirm(`You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Are you ready to submit your answers?`);
      if (!ok) return;
    }
  }

  quizVoiceState.pendingUnansweredConfirm = false;
  showToast("Grading your quiz...", "loading");
  try {
    const payload = {
      quiz_id: activeQuizData.id || null,
      student_id: (appState.user && appState.user.id) || 1,
      student_username: (appState.user && appState.user.username) || '',
      current_quizzes_passed: (appState.user && Number(appState.user.quizzes_passed)) || 0,
      answers: activeQuizUserAnswers,
      raw_quiz: activeQuizData
    };

    const res = await fetch('/api/quizzes/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();

    displayQuizResults(result);

  } catch (err) {
    console.error("submitActiveQuiz error:", err);
    alert("Could not submit quiz: " + err.message);
  }
}

function displayQuizResults(result) {
  const activeBody = document.getElementById('quiz-active-body');
  const progressSection = document.getElementById('quiz-progress-section');
  const resultsContainer = document.getElementById('quiz-results-container');
  const controlsActive = document.getElementById('quiz-controls-active');
  const controlsResults = document.getElementById('quiz-controls-results');

  const circle = document.getElementById('quiz-score-circle');
  const pctText = document.getElementById('quiz-score-pct-text');
  const heading = document.getElementById('quiz-result-heading');
  const subtext = document.getElementById('quiz-result-subtext');
  const breakdownList = document.getElementById('quiz-breakdown-list');

  if (activeBody) activeBody.classList.add('hidden');
  if (progressSection) progressSection.classList.add('hidden');
  if (controlsActive) controlsActive.classList.add('hidden');
  if (resultsContainer) resultsContainer.classList.remove('hidden');
  if (controlsResults) controlsResults.classList.remove('hidden');

  const passed = !!result.passed;
  if (pctText) pctText.textContent = `${result.percentage}%`;
  if (circle) {
    circle.style.borderColor = passed ? '#10b981' : '#f59e0b';
    circle.style.color = passed ? '#10b981' : '#f59e0b';
    circle.style.background = passed 
      ? 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.05))'
      : 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05))';
  }

  if (heading) {
    heading.textContent = passed ? 'Assessment Passed!' : 'Assessment Completed';
  }
  if (subtext) {
    subtext.textContent = `You scored ${result.score} out of ${result.total} questions correctly (${result.percentage}%). ${passed ? 'Great mastery of this curriculum!' : 'Review the explanations below to strengthen your understanding.'}`;
  }

  if (passed) {
    playEarcon('success');
    triggerConfetti();
    if (appState.user) {
      const prevPassed = Number(appState.user.quizzes_passed) || 0;
      const prevStreak = Number(appState.user.current_streak) || 0;
      const serverPassed = Number(result.quizzes_passed_total) || 0;
      const serverStreak = Number(result.current_streak) || 0;
      appState.user.quizzes_passed = Math.max(serverPassed, prevPassed + 1);
      appState.user.current_streak = Math.max(serverStreak, prevStreak + 1);
      if (typeof persistUserSession === 'function') {
        persistUserSession(appState.user);
      }
      if (typeof renderAnalyticsUI === 'function') {
        renderAnalyticsUI(appState.user.quizzes_passed, appState.user.current_streak);
      }
      loadAnalytics();
    }
  } else {
    playEarcon('click');
  }

  if (breakdownList && Array.isArray(result.breakdown)) {
    breakdownList.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    result.breakdown.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = `quiz-breakdown-card ${item.isCorrect ? 'correct' : 'incorrect'}`;

      const userChoice = item.selectedIndex >= 0 && item.options[item.selectedIndex]
        ? `${letters[item.selectedIndex]}: ${item.options[item.selectedIndex]}`
        : 'None selected';
      const correctChoice = `${letters[item.correctIndex]}: ${item.options[item.correctIndex]}`;

      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <strong style="color:var(--text-primary); font-size:1rem;">Q${idx + 1}: ${escapeHtml(item.question)}</strong>
          <span class="badge" style="background:${item.isCorrect ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}; color:${item.isCorrect ? '#10b981' : '#ef4444'}; border-radius:10px; font-size:0.75rem; padding:0.25rem 0.6rem;">
            ${item.isCorrect ? `${getAppSvgIcon('check', 14)} Correct` : `${getAppSvgIcon('close', 14)} Incorrect`}
          </span>
        </div>
        <div style="font-size:0.9rem; margin-top:0.35rem;">
          <div><span style="color:var(--text-secondary);">Your Answer:</span> <strong style="color:${item.isCorrect ? '#10b981' : '#ef4444'};">${escapeHtml(userChoice)}</strong></div>
          ${!item.isCorrect ? `<div><span style="color:var(--text-secondary);">Correct Answer:</span> <strong style="color:#10b981;">${escapeHtml(correctChoice)}</strong></div>` : ''}
        </div>
        ${item.explanation ? `
          <div class="quiz-explanation-box mt-1">
            <strong style="color:var(--accent-color);">Why:</strong> ${escapeHtml(item.explanation)}
          </div>
        ` : ''}
      `;
      breakdownList.appendChild(card);
    });
  }

  announceTTS(`Quiz complete. You scored ${result.score} out of ${result.total}, ${result.percentage} percent. ${passed ? 'Congratulations, you passed!' : 'Review your answers below.'}`);
}

function speakQuizResultsSummary() {
  const subtext = document.getElementById('quiz-result-subtext');
  if (subtext) {
    announceTTS(subtext.textContent);
  }
}
window.speakQuizResultsSummary = speakQuizResultsSummary;

function closeQuizModal() {
  if (typeof stopQuizVoiceMode === 'function' && quizVoiceState.enabled) {
    stopQuizVoiceMode(true);
  }
  stopAllTTS();
  const modal = document.getElementById('quiz-modal');
  if (modal) modal.classList.add('hidden');
  if (appState.currentView === 'quizzes') {
    loadStudentQuizzes();
  }
}
window.closeQuizModal = closeQuizModal;

function retakeActiveQuiz() {
  if (activeQuizData) {
    startInteractiveQuiz(activeQuizData, 'Retake Assessment');
  }
}
window.retakeActiveQuiz = retakeActiveQuiz;

function triggerConfetti() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#38bdf8', '#a855f7'];

  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      top: -20px;
      left: ${Math.random() * 100}vw;
      width: ${8 + Math.random() * 8}px;
      height: ${8 + Math.random() * 8}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      z-index: 100000;
      opacity: 0.9;
      pointer-events: none;
      animation: confettiFall ${1.5 + Math.random() * 1.5}s ease-in forwards;
    `;
    container.appendChild(el);
  }
  setTimeout(() => { container.innerHTML = ''; }, 3500);
}

function startQuiz(subject) {
  const currentTopic = subject || (appState && appState.activeLesson && appState.activeLesson.title) || 'General Knowledge';
  handleTriggerAiQuiz(currentTopic);
}
window.startQuiz = startQuiz;

// --- 4. INSTRUCTOR CUSTOM QUIZ STUDIO ---
function initAdminQuizForm() {
  const container = document.getElementById('admin-quiz-questions-container');
  const titleInput = document.getElementById('admin-quiz-title-input');
  const subjectInput = document.getElementById('admin-quiz-subject-input');
  const targetAll = document.getElementById('admin-quiz-target-all');

  if (titleInput) titleInput.value = '';
  if (subjectInput) subjectInput.value = '';
  if (targetAll) targetAll.checked = true;
  toggleAdminQuizTargetMode();

  adminQuizQuestionCounter = 0;
  if (container) {
    container.innerHTML = '';
    addAdminQuizQuestionField();
  }
}
window.initAdminQuizForm = initAdminQuizForm;
window.resetAdminQuizForm = initAdminQuizForm;

function toggleAdminQuizTargetMode() {
  const isSelected = document.getElementById('admin-quiz-target-selected')?.checked;
  const box = document.getElementById('admin-quiz-student-selector-box');
  if (box) {
    if (isSelected) {
      box.classList.remove('hidden');
      populateAdminQuizStudentChecklist();
    } else {
      box.classList.add('hidden');
    }
  }
}
window.toggleAdminQuizTargetMode = toggleAdminQuizTargetMode;

async function populateAdminQuizStudentChecklist(studentsList) {
  const listContainer = document.getElementById('admin-quiz-students-checklist');
  if (!listContainer) return;

  let students = studentsList || adminCachedStudents;
  if (!students || students.length === 0) {
    try {
      const res = await fetch('/api/admin/users');
      const users = await res.json();
      students = (users || []).filter(u => u.role !== 'admin');
      adminCachedStudents = students;
    } catch (e) {
      console.warn("Could not fetch students for checklist:", e);
    }
  }

  if (!students || students.length === 0) {
    listContainer.innerHTML = '<span style="color:var(--text-secondary); font-size:0.85rem; padding:0.5rem;">No enrolled students found.</span>';
    return;
  }

  listContainer.innerHTML = '';
  students.forEach(s => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.85rem; padding:0.25rem 0.5rem; border-radius:6px; background:var(--bg-card); border:1px solid var(--border-color);';
    label.innerHTML = `
      <input type="checkbox" class="admin-quiz-student-cb" value="${s.id}">
      <span><strong>${escapeHtml(s.username)}</strong> (${escapeHtml(s.reg_no || 'ID: ' + s.id)}) - <small style="color:var(--text-secondary);">${escapeHtml(s.school || 'Gismo Academy')}</small></span>
    `;
    listContainer.appendChild(label);
  });
}
window.populateAdminQuizStudentChecklist = populateAdminQuizStudentChecklist;

function toggleSelectAllQuizStudents() {
  const cbs = document.querySelectorAll('.admin-quiz-student-cb');
  if (!cbs || cbs.length === 0) return;
  const anyUnchecked = Array.from(cbs).some(cb => !cb.checked);
  cbs.forEach(cb => { cb.checked = anyUnchecked; });
  playEarcon('click');
}
window.toggleSelectAllQuizStudents = toggleSelectAllQuizStudents;

function addAdminQuizQuestionField(qData = {}) {
  const container = document.getElementById('admin-quiz-questions-container');
  if (!container) return;

  adminQuizQuestionCounter++;
  const card = document.createElement('div');
  card.className = 'admin-quiz-q-card';
  card.id = `admin-quiz-q-card-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  const defaultQuestion = qData.question || '';
  const defaultOpts = (Array.isArray(qData.options) && qData.options.length === 4) 
    ? qData.options 
    : ['', '', '', ''];
  const defaultAns = typeof qData.answerIndex === 'number' ? qData.answerIndex : 0;
  const defaultExp = qData.explanation || '';

  card.innerHTML = `
    <div class="d-flex justify-content-between align-items-center">
      <span class="admin-quiz-q-header-label" style="font-size:0.9rem; font-weight:700; color:var(--accent-color);">Question</span>
      <button type="button" class="btn-icon theme-btn" onclick="removeAdminQuizQuestionField(this)" title="Delete Question" style="padding:0.25rem 0.5rem; font-size:0.75rem; border-radius:6px; color:var(--warning-color); border-color:var(--warning-color);">
        ${getAppSvgIcon('close', 13)} Remove
      </button>
    </div>

    <div>
      <label style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.25rem; display:block;">Question Text</label>
      <input type="text" class="auth-input-modern w-100 admin-quiz-q-input" value="${escapeHtml(defaultQuestion)}" placeholder="e.g. Which algorithm is best suited for supervised classification?" required>
    </div>

    <div class="row g-2">
      <div class="col-12 col-md-6">
        <label style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.15rem; display:block;">Option A</label>
        <input type="text" class="auth-input-modern w-100 admin-quiz-opt-0" value="${escapeHtml(defaultOpts[0])}" placeholder="Option A text" required>
      </div>
      <div class="col-12 col-md-6">
        <label style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.15rem; display:block;">Option B</label>
        <input type="text" class="auth-input-modern w-100 admin-quiz-opt-1" value="${escapeHtml(defaultOpts[1])}" placeholder="Option B text" required>
      </div>
      <div class="col-12 col-md-6">
        <label style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.15rem; display:block;">Option C</label>
        <input type="text" class="auth-input-modern w-100 admin-quiz-opt-2" value="${escapeHtml(defaultOpts[2])}" placeholder="Option C text" required>
      </div>
      <div class="col-12 col-md-6">
        <label style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.15rem; display:block;">Option D</label>
        <input type="text" class="auth-input-modern w-100 admin-quiz-opt-3" value="${escapeHtml(defaultOpts[3])}" placeholder="Option D text" required>
      </div>
    </div>

    <div class="row g-2">
      <div class="col-12 col-md-4">
        <label style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.15rem; display:block;">Correct Option</label>
        <select class="auth-input-modern w-100 admin-quiz-ans-select" style="cursor:pointer;">
          <option value="0" ${defaultAns === 0 ? 'selected' : ''}>Option A</option>
          <option value="1" ${defaultAns === 1 ? 'selected' : ''}>Option B</option>
          <option value="2" ${defaultAns === 2 ? 'selected' : ''}>Option C</option>
          <option value="3" ${defaultAns === 3 ? 'selected' : ''}>Option D</option>
        </select>
      </div>
      <div class="col-12 col-md-8">
        <label style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.15rem; display:block;">Explanation / Feedback for Student</label>
        <input type="text" class="auth-input-modern w-100 admin-quiz-exp-input" value="${escapeHtml(defaultExp)}" placeholder="Why is this answer correct?">
      </div>
    </div>
  `;

  container.appendChild(card);
  updateAdminQuizQuestionIndexes();
}
window.addAdminQuizQuestionField = addAdminQuizQuestionField;

function removeAdminQuizQuestionField(btn) {
  const card = btn.closest('.admin-quiz-q-card');
  const container = document.getElementById('admin-quiz-questions-container');
  if (container && container.children.length <= 1) {
    alert("A quiz must have at least one question.");
    return;
  }
  if (card) {
    card.remove();
    updateAdminQuizQuestionIndexes();
    playEarcon('click');
  }
}
window.removeAdminQuizQuestionField = removeAdminQuizQuestionField;

function updateAdminQuizQuestionIndexes() {
  const container = document.getElementById('admin-quiz-questions-container');
  const countBadge = document.getElementById('admin-quiz-q-count-badge');
  if (!container) return;

  const cards = container.querySelectorAll('.admin-quiz-q-card');
  if (countBadge) countBadge.textContent = cards.length;

  cards.forEach((card, idx) => {
    const label = card.querySelector('.admin-quiz-q-header-label');
    if (label) label.textContent = `Question ${idx + 1}`;
  });
}

async function handleCreateAdminQuiz() {
  const titleInput = document.getElementById('admin-quiz-title-input');
  const subjectInput = document.getElementById('admin-quiz-subject-input');
  const isSelected = document.getElementById('admin-quiz-target-selected')?.checked;
  const container = document.getElementById('admin-quiz-questions-container');

  const title = titleInput ? titleInput.value.trim() : '';
  const subject = subjectInput ? subjectInput.value.trim() : 'General';

  if (!title) {
    alert("Please enter a Quiz Title.");
    titleInput?.focus();
    return;
  }

  let target = 'all';
  let student_ids = [];

  if (isSelected) {
    target = 'selected';
    const checkedBoxes = document.querySelectorAll('.admin-quiz-student-cb:checked');
    student_ids = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));

    if (student_ids.length === 0) {
      alert("Please select at least one student from the checklist, or choose 'All Enrolled Students'.");
      return;
    }
  }

  const cards = container ? container.querySelectorAll('.admin-quiz-q-card') : [];
  if (cards.length === 0) {
    alert("Please add at least one question to the quiz.");
    return;
  }

  const questions = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const qText = card.querySelector('.admin-quiz-q-input')?.value.trim();
    const opt0 = card.querySelector('.admin-quiz-opt-0')?.value.trim();
    const opt1 = card.querySelector('.admin-quiz-opt-1')?.value.trim();
    const opt2 = card.querySelector('.admin-quiz-opt-2')?.value.trim();
    const opt3 = card.querySelector('.admin-quiz-opt-3')?.value.trim();
    const ans = parseInt(card.querySelector('.admin-quiz-ans-select')?.value || '0', 10);
    const exp = card.querySelector('.admin-quiz-exp-input')?.value.trim() || '';

    if (!qText || !opt0 || !opt1 || !opt2 || !opt3) {
      alert(`Please fill in all options for Question ${i + 1}.`);
      return;
    }

    questions.push({
      id: i + 1,
      question: qText,
      options: [opt0, opt1, opt2, opt3],
      answerIndex: ans,
      explanation: exp
    });
  }

  const payload = {
    title,
    subject,
    target,
    student_ids,
    questions
  };

  try {
    showToast("Publishing custom quiz...", "loading");
    const res = await fetch('/api/admin/quizzes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    showToast(`Quiz "${title}" published and assigned!`, "check");
    playEarcon('success');

    initAdminQuizForm();
    await loadAdminQuizzes();

  } catch (err) {
    console.error("handleCreateAdminQuiz error:", err);
    alert("Could not create quiz: " + err.message);
  }
}
window.handleCreateAdminQuiz = handleCreateAdminQuiz;

async function loadAdminQuizzes() {
  const container = document.getElementById('admin-quizzes-list-container');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/quizzes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const quizzes = await res.json();
    adminCachedQuizzes = quizzes;

    if (!quizzes || quizzes.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-secondary);">No quizzes created yet. Use the Quiz Studio on the left to dispatch your first quiz!</div>';
      return;
    }

    container.innerHTML = '';
    quizzes.forEach(q => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:12px; padding:1.25rem; display:flex; flex-direction:column; gap:0.6rem;';

      const avgText = q.average_score !== null ? `${q.average_score}% avg` : 'No submissions';
      const targetDisplay = q.target_display || 'All Students';

      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-2">
            <span class="badge" style="background:rgba(99,102,241,0.2); color:var(--accent-color); border-radius:8px; font-size:0.75rem;">
              ${escapeHtml(q.subject || 'General')}
            </span>
            <span class="badge" style="background:var(--bg-secondary); color:var(--text-secondary); border:1px solid var(--border-color); border-radius:8px; font-size:0.75rem;">
              ${q.question_count || 0} Questions
            </span>
          </div>
          <button class="btn-icon theme-btn" onclick="handleDeleteAdminQuiz(${q.id})" title="Delete Quiz" style="padding:0.2rem 0.5rem; font-size:0.75rem; border-radius:6px; color:var(--warning-color); border-color:var(--warning-color);">
            Delete
          </button>
        </div>

        <h4 style="margin:0; font-size:1.1rem; color:var(--text-primary);">${escapeHtml(q.title)}</h4>

        <div style="font-size:0.85rem; color:var(--text-secondary); display:flex; flex-wrap:wrap; gap:0.75rem; align-items:center;">
          <span>Target: <strong style="color:var(--accent-color);">${escapeHtml(targetDisplay)}</strong></span>
          <span>•</span>
          <span>${q.submissions_count || 0} Submissions (${avgText})</span>
        </div>

        <div class="d-flex justify-content-between align-items-center pt-2 border-top border-secondary mt-1">
          <button class="theme-btn" onclick="openAdminQuizSubmissions(${q.id})" style="border-radius:8px; padding:0.35rem 0.8rem; font-size:0.8rem; display:inline-flex; align-items:center; gap:0.35rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            <span>View Submissions (${q.submissions_count || 0})</span>
          </button>
          <button class="theme-btn" onclick="startQuizById(${q.id})" style="border-radius:8px; padding:0.35rem 0.8rem; font-size:0.8rem;">
            Preview Quiz
          </button>
        </div>
      `;
      container.appendChild(card);
    });

  } catch (err) {
    console.error("loadAdminQuizzes error:", err);
    container.innerHTML = `<div style="text-align:center; padding:1.5rem; color:var(--warning-color);">Failed to load quizzes: ${escapeHtml(err.message)}</div>`;
  }
}
window.loadAdminQuizzes = loadAdminQuizzes;

function openAdminQuizSubmissions(quizId) {
  const quiz = adminCachedQuizzes.find(q => q.id === quizId);
  const modal = document.getElementById('admin-quiz-submissions-modal');
  const titleEl = document.getElementById('admin-modal-quiz-title');
  const metaEl = document.getElementById('admin-modal-quiz-meta');
  const tbody = document.getElementById('admin-modal-submissions-table-body');

  if (!quiz || !modal || !tbody) return;

  if (titleEl) titleEl.textContent = `Submissions: ${quiz.title}`;
  if (metaEl) metaEl.textContent = `Subject: ${quiz.subject} • Total Submissions: ${quiz.submissions_count} • Target: ${quiz.target_display}`;

  tbody.innerHTML = '';
  if (!quiz.submissions || quiz.submissions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-secondary);">No student submissions recorded for this quiz yet.</td></tr>';
  } else {
    quiz.submissions.forEach(sub => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      const passed = (sub.percentage || 0) >= 60;

      tr.innerHTML = `
        <td style="padding:0.6rem 0.5rem; font-weight:600; color:var(--text-primary);">${escapeHtml(sub.student_name || 'Student #' + sub.student_id)}</td>
        <td style="padding:0.6rem 0.5rem; color:var(--text-secondary);">${escapeHtml(sub.reg_no || 'N/A')}</td>
        <td style="padding:0.6rem 0.5rem; font-weight:700;">${sub.score} / ${sub.total} (${sub.percentage}%)</td>
        <td style="padding:0.6rem 0.5rem;">
          <span class="badge" style="background:${passed ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color:${passed ? '#10b981' : '#ef4444'}; border-radius:8px; font-size:0.75rem; padding:0.25rem 0.6rem;">
            ${passed ? `${getAppSvgIcon('check', 13)} Passed` : `${getAppSvgIcon('close', 13)} Needs Review`}
          </span>
        </td>
        <td style="padding:0.6rem 0.5rem; color:var(--text-secondary); font-size:0.8rem;">${sub.submitted_at ? sub.submitted_at.replace('T', ' ').slice(0, 16) : 'Just now'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  modal.classList.remove('hidden');
}
window.openAdminQuizSubmissions = openAdminQuizSubmissions;

function closeAdminQuizSubmissionsModal() {
  const modal = document.getElementById('admin-quiz-submissions-modal');
  if (modal) modal.classList.add('hidden');
}
window.closeAdminQuizSubmissionsModal = closeAdminQuizSubmissionsModal;

async function handleDeleteAdminQuiz(quizId) {
  if (!confirm("Are you sure you want to delete this custom quiz and all associated student submissions?")) return;

  try {
    showToast("Deleting quiz...", "loading");
    const res = await fetch(`/api/admin/quizzes/${quizId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("Quiz deleted.", "check");
    playEarcon('click');
    await loadAdminQuizzes();
  } catch (err) {
    console.error("handleDeleteAdminQuiz error:", err);
    alert("Could not delete quiz: " + err.message);
  }
}
window.handleDeleteAdminQuiz = handleDeleteAdminQuiz;

async function handleBroadcastAnnouncement() {

  const input = document.getElementById('admin-announcement-input');
  const msg = input ? input.value.trim() : '';
  if (!msg) {
    alert("Please enter an announcement message to broadcast.");
    return;
  }
  try {
    const res = await fetch('/api/admin/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    if (res.ok) {
      showToast("Global announcement broadcasted to all students!", "check");
      playEarcon('success');
      announceTTS(`Broadcast announcement dispatched: ${msg}`);
      if (input) input.value = '';
    }
  } catch (e) {
    console.error("handleBroadcastAnnouncement error:", e);
  }
}
window.handleBroadcastAnnouncement = handleBroadcastAnnouncement;

// =======================================================
// ADMIN DATABASE EXPLORER ENGINE
// =======================================================
const dbViewerState = {
  overview: null,
  activeTable: 'users',
  columns: [],
  rows: [],
  totalCount: 0,
  filteredCount: 0,
  limit: 50,
  offset: 0,
  sort: '',
  order: 'ASC',
  search: '',
  activeMode: 'tables',
  searchDebounceTimer: null
};

async function loadAdminDatabase() {
  try {
    const res = await fetch('/api/admin/database/overview');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    dbViewerState.overview = data;

    // Update Live Metrics Grid
    const statFilename = document.getElementById('db-stat-filename');
    const statTables = document.getElementById('db-stat-tables');
    const statRecords = document.getElementById('db-stat-records');
    const statSize = document.getElementById('db-stat-size');
    const counterBadge = document.getElementById('admin-db-badge-counter');
    const connBadge = document.getElementById('db-connection-badge');

    if (statFilename) statFilename.textContent = data.databaseFile || 'gismo.db';
    if (statTables) statTables.textContent = data.totalTables || 0;
    if (statRecords) statRecords.textContent = data.totalRows || 0;
    if (statSize) statSize.textContent = data.sizeFormatted || '0 KB';
    if (counterBadge) counterBadge.textContent = `${data.totalTables || 6} tables`;
    if (connBadge) {
      connBadge.textContent = data.provider === 'supabase'
        ? `● Supabase Connected (${data.databaseFile})`
        : `● SQLite Online (${data.databaseFile || 'gismo.db'})`;
    }

    // Render table pill buttons
    renderDbTablePills(data.tables || []);

    // Ensure active table is valid
    if (!data.tables.some(t => t.name === dbViewerState.activeTable) && data.tables.length > 0) {
      dbViewerState.activeTable = data.tables[0].name;
    }

    // Load active table data
    await loadCurrentTableData(0);
  } catch (err) {
    console.error("loadAdminDatabase error:", err);
    showToast("Failed to connect to database API", "warning");
  }
}
window.loadAdminDatabase = loadAdminDatabase;

function renderDbTablePills(tables) {
  const container = document.getElementById('db-table-pills');
  if (!container) return;

  const tableIcons = {
    users: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>`,
    homework: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    chats: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    textbooks: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
    notes: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
    files: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`
  };

  container.innerHTML = '';
  tables.forEach(t => {
    const btn = document.createElement('button');
    btn.className = `db-pill-btn ${t.name === dbViewerState.activeTable ? 'active' : ''}`;
    btn.onclick = () => selectDbTable(t.name);
    const icon = tableIcons[t.name] || `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
    btn.innerHTML = `
      ${icon}
      <span>${escapeHtml(t.name)}</span>
      <span class="badge" style="background:rgba(255,255,255,0.15); border-radius:10px; font-size:0.75rem; padding:1px 6px;">${t.rowCount}</span>
    `;
    container.appendChild(btn);
  });
}

async function selectDbTable(tableName) {
  if (dbViewerState.activeTable === tableName && dbViewerState.rows.length > 0) return;
  dbViewerState.activeTable = tableName;
  dbViewerState.offset = 0;
  dbViewerState.search = '';
  const searchInput = document.getElementById('db-search-input');
  if (searchInput) searchInput.value = '';

  document.querySelectorAll('.db-pill-btn').forEach(btn => {
    if (btn.textContent.includes(tableName)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  await loadCurrentTableData(0);
}
window.selectDbTable = selectDbTable;

async function loadCurrentTableData(offset = 0) {
  const table = dbViewerState.activeTable;
  const limitSelect = document.getElementById('db-limit-select');
  const limit = limitSelect ? parseInt(limitSelect.value, 10) : 50;
  dbViewerState.limit = limit;
  dbViewerState.offset = offset;

  const thead = document.getElementById('db-table-head');
  const tbody = document.getElementById('db-table-body');
  const countsLabel = document.getElementById('db-table-counts-label');
  const paginationSummary = document.getElementById('db-pagination-summary');
  const prevBtn = document.getElementById('btn-db-prev-page');
  const nextBtn = document.getElementById('btn-db-next-page');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding:2rem; color:var(--text-secondary);">Loading records for '${escapeHtml(table)}'...</td></tr>`;
  }

  try {
    const params = new URLSearchParams({
      limit: limit,
      offset: offset
    });
    if (dbViewerState.search) params.set('search', dbViewerState.search);
    if (dbViewerState.sort) {
      params.set('sort', dbViewerState.sort);
      params.set('order', dbViewerState.order);
    }

    const res = await fetch(`/api/admin/database/table/${encodeURIComponent(table)}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    dbViewerState.columns = data.columns || [];
    dbViewerState.rows = data.rows || [];
    dbViewerState.totalCount = data.totalCount || 0;
    dbViewerState.filteredCount = data.filteredCount ?? data.totalCount;
    dbViewerState.sort = data.sort || '';
    dbViewerState.order = data.order || 'ASC';

    const fromRow = dbViewerState.rows.length === 0 ? 0 : offset + 1;
    const toRow = offset + dbViewerState.rows.length;
    if (countsLabel) {
      countsLabel.textContent = `${dbViewerState.filteredCount} total${dbViewerState.search ? ' (filtered)' : ''}`;
    }
    if (paginationSummary) {
      paginationSummary.textContent = `Showing ${fromRow} to ${toRow} of ${dbViewerState.filteredCount} rows in '${table}'`;
    }
    if (prevBtn) prevBtn.disabled = offset <= 0;
    if (nextBtn) nextBtn.disabled = toRow >= dbViewerState.filteredCount;

    renderDbSchemaDetails(data.columns);
    renderDbTableHead(data.columns);
    renderDbTableRows(data.rows, data.columns);
  } catch (err) {
    console.error("loadCurrentTableData error:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding:2rem; color:var(--warning-color);">Error loading table: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}
window.loadCurrentTableData = loadCurrentTableData;

function renderDbSchemaDetails(columns) {
  const container = document.getElementById('db-schema-columns-list');
  const title = document.getElementById('db-schema-title');
  if (title) title.textContent = `Schema for table: '${dbViewerState.activeTable}' (${columns.length} columns)`;
  if (!container) return;

  container.innerHTML = '';
  columns.forEach(col => {
    const tag = document.createElement('div');
    tag.style.cssText = 'background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px; padding:0.3rem 0.65rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.35rem;';
    tag.innerHTML = `
      <strong style="color:var(--text-primary); font-family:var(--font-mono, monospace);">${escapeHtml(col.name)}</strong>
      <span style="color:var(--text-secondary);">${escapeHtml(col.type || 'TEXT')}</span>
      ${col.pk ? '<span class="db-badge-pk">PRIMARY KEY</span>' : ''}
      ${col.notnull ? '<span style="color:#ef4444; font-size:0.65rem; font-weight:700;">NOT NULL</span>' : ''}
    `;
    container.appendChild(tag);
  });
}

function renderDbTableHead(columns) {
  const thead = document.getElementById('db-table-head');
  if (!thead) return;

  thead.innerHTML = '';
  const tr = document.createElement('tr');
  tr.style.background = 'var(--bg-secondary)';

  columns.forEach(col => {
    const th = document.createElement('th');
    th.className = 'sortable';
    th.title = `Click to sort by ${col.name}`;
    th.onclick = () => {
      if (dbViewerState.sort === col.name) {
        dbViewerState.order = dbViewerState.order === 'ASC' ? 'DESC' : 'ASC';
      } else {
        dbViewerState.sort = col.name;
        dbViewerState.order = 'ASC';
      }
      loadCurrentTableData(0);
    };

    let sortIcon = '';
    if (dbViewerState.sort === col.name) {
      sortIcon = dbViewerState.order === 'ASC' ? ' ▲' : ' ▼';
    }

    th.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.35rem;">
        <span>${escapeHtml(col.name)}</span>
        <span style="color:var(--accent-color); font-size:0.7rem;">${sortIcon}</span>
        ${col.pk ? '<span class="db-badge-pk">PK</span>' : ''}
      </div>
      <div class="db-badge-type">${escapeHtml(col.type || 'TEXT')}</div>
    `;
    tr.appendChild(th);
  });

  thead.appendChild(tr);
}

function renderDbTableRows(rows, columns) {
  const tbody = document.getElementById('db-table-body');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length || 1}" style="text-align:center; padding:2rem; color:var(--text-secondary);">No records found in '${escapeHtml(dbViewerState.activeTable)}'.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)';

    columns.forEach(col => {
      const td = document.createElement('td');
      const val = row[col.name];

      if (val === null || val === undefined) {
        td.innerHTML = '<span style="color:var(--text-secondary); font-style:italic; font-size:0.78rem;">NULL</span>';
      } else if (col.name === 'password') {
        const strVal = String(val);
        const cellId = `pw-${idx}-${Math.random().toString(36).substring(2, 6)}`;
        td.innerHTML = `
          <div style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span id="${cellId}" style="font-family:monospace; font-size:0.78rem; color:var(--text-secondary);">••••••••••••••••</span>
            <button class="theme-btn" onclick="togglePasswordReveal('${cellId}', '${escapeHtml(strVal)}')" style="padding:1px 6px; font-size:0.65rem; border-radius:6px;" title="Reveal hash">Show</button>
          </div>
        `;
      } else if (col.name === 'role') {
        const isAdm = String(val).toLowerCase() === 'admin';
        td.innerHTML = `<span class="badge" style="background:${isAdm ? 'rgba(99,102,241,0.2)' : 'rgba(14,165,233,0.2)'}; color:${isAdm ? 'var(--accent-color)' : '#38bdf8'}; padding:3px 8px; border-radius:8px; font-size:0.75rem; font-weight:600;">${escapeHtml(String(val))}</span>`;
      } else if (col.name === 'status') {
        const isComp = String(val).toLowerCase() === 'completed';
        td.innerHTML = `<span class="badge" style="background:${isComp ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}; color:${isComp ? '#10b981' : '#f59e0b'}; padding:3px 8px; border-radius:8px; font-size:0.75rem; font-weight:600;">${escapeHtml(String(val))}</span>`;
      } else if (col.name === 'disability') {
        const dStr = String(val);
        let color = '#94a3b8';
        if (dStr.toLowerCase().includes('vision')) color = '#818cf8';
        else if (dStr.toLowerCase().includes('audit') || dStr.toLowerCase().includes('hear')) color = '#22d3ee';
        else if (dStr.toLowerCase().includes('dyslexia')) color = '#fbbf24';
        td.innerHTML = `<span class="badge" style="background:rgba(255,255,255,0.06); color:${color}; border:1px solid rgba(255,255,255,0.12); padding:2px 8px; border-radius:8px; font-size:0.75rem;">${escapeHtml(dStr)}</span>`;
      } else if (col.name === 'submission_file' || col.name === 'filepath') {
        const pathVal = String(val);
        td.innerHTML = `
          <a href="${escapeHtml(pathVal)}" target="_blank" class="theme-btn" style="text-decoration:none; padding:2px 8px; font-size:0.75rem; border-radius:6px; display:inline-flex; align-items:center; gap:0.3rem;" title="View / Download file">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            <span>Open File</span>
          </a>
        `;
      } else if (String(val).length > 35) {
        const rawText = String(val);
        const truncated = rawText.slice(0, 32) + '...';
        const safeFieldName = escapeHtml(col.name);
        td.innerHTML = `
          <span class="db-cell-truncate" title="Click to inspect full content" onclick="inspectDbCell('${safeFieldName}', ${JSON.stringify(rawText)})">
            ${escapeHtml(truncated)}
          </span>
        `;
      } else {
        td.textContent = String(val);
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function togglePasswordReveal(elementId, hash) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (el.textContent === '••••••••••••••••') {
    el.textContent = hash;
    el.title = "Click to copy";
    el.style.color = "var(--text-primary)";
  } else {
    el.textContent = '••••••••••••••••';
    el.style.color = "var(--text-secondary)";
  }
}
window.togglePasswordReveal = togglePasswordReveal;

function changeDbPage(delta) {
  const newOffset = Math.max(0, dbViewerState.offset + (delta * dbViewerState.limit));
  loadCurrentTableData(newOffset);
}
window.changeDbPage = changeDbPage;

function handleDbSearchInput() {
  clearTimeout(dbViewerState.searchDebounceTimer);
  dbViewerState.searchDebounceTimer = setTimeout(() => {
    const searchInput = document.getElementById('db-search-input');
    dbViewerState.search = searchInput ? searchInput.value.trim() : '';
    loadCurrentTableData(0);
  }, 250);
}
window.handleDbSearchInput = handleDbSearchInput;

function toggleDbSchemaView() {
  const schemaEl = document.getElementById('db-schema-details');
  const btn = document.getElementById('btn-toggle-schema');
  if (!schemaEl) return;
  schemaEl.classList.toggle('hidden');
  if (btn) {
    btn.classList.toggle('active', !schemaEl.classList.contains('hidden'));
  }
}
window.toggleDbSchemaView = toggleDbSchemaView;

function switchDbMode(mode) {
  dbViewerState.activeMode = mode;
  const tablesMode = document.getElementById('db-view-tables-mode');
  const sqlMode = document.getElementById('db-view-sql-mode');
  const btnTables = document.getElementById('btn-db-mode-tables');
  const btnSql = document.getElementById('btn-db-mode-sql');

  if (mode === 'sql') {
    if (tablesMode) tablesMode.classList.add('hidden');
    if (sqlMode) sqlMode.classList.remove('hidden');
    if (btnTables) {
      btnTables.classList.remove('active');
      btnTables.style.background = 'var(--bg-card)';
      btnTables.style.color = 'var(--text-secondary)';
    }
    if (btnSql) {
      btnSql.classList.add('active');
      btnSql.style.background = 'var(--accent-color)';
      btnSql.style.color = '#fff';
    }
  } else {
    if (sqlMode) sqlMode.classList.add('hidden');
    if (tablesMode) tablesMode.classList.remove('hidden');
    if (btnSql) {
      btnSql.classList.remove('active');
      btnSql.style.background = 'var(--bg-card)';
      btnSql.style.color = 'var(--text-secondary)';
    }
    if (btnTables) {
      btnTables.classList.add('active');
      btnTables.style.background = 'var(--accent-color)';
      btnTables.style.color = '#fff';
    }
  }
}
window.switchDbMode = switchDbMode;

function setSqlPreset(type) {
  const sqlInput = document.getElementById('db-sql-input');
  if (!sqlInput) return;

  const presets = {
    students: "SELECT id, username, school, reg_no, disability, quizzes_passed, current_streak FROM users WHERE role = 'student' ORDER BY quizzes_passed DESC;",
    homework: "SELECT id, title, student_id, status, submission_filename, submission_date FROM homework WHERE status = 'pending' ORDER BY id DESC;",
    chats: "SELECT id, user_id, role, substr(content, 1, 80) as excerpt, timestamp FROM chats ORDER BY id DESC LIMIT 25;",
    accommodations: "SELECT disability, COUNT(*) as student_count, AVG(quizzes_passed) as avg_quizzes FROM users WHERE role = 'student' GROUP BY disability;"
  };

  sqlInput.value = presets[type] || presets.students;
  executeCustomSqlQuery();
}
window.setSqlPreset = setSqlPreset;

async function executeCustomSqlQuery() {
  const sqlInput = document.getElementById('db-sql-input');
  const statusBadge = document.getElementById('db-sql-status-badge');
  const container = document.getElementById('db-sql-results-container');
  const thead = document.getElementById('db-sql-table-head');
  const tbody = document.getElementById('db-sql-table-body');

  const query = sqlInput ? sqlInput.value.trim() : '';
  if (!query) {
    if (statusBadge) statusBadge.innerHTML = '<span style="color:var(--warning-color);">Please enter a SQL query.</span>';
    return;
  }

  if (statusBadge) statusBadge.innerHTML = '<span style="color:var(--accent-color);">Executing query...</span>';

  try {
    const res = await fetch('/api/admin/database/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    if (statusBadge) {
      statusBadge.innerHTML = `
        <span style="color:#10b981; font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;">${getAppSvgIcon('check', 14)} ${data.rowCount} rows</span>
        <span style="color:var(--text-secondary); margin-left:6px;">(${data.durationMs} ms)</span>
      `;
    }

    if (container) container.classList.remove('hidden');

    if (thead) {
      thead.innerHTML = '';
      const tr = document.createElement('tr');
      (data.columns || []).forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
    }

    if (tbody) {
      tbody.innerHTML = '';
      if (!data.rows || data.rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${data.columns.length || 1}" style="text-align:center; padding:1.5rem; color:var(--text-secondary);">Query executed successfully with 0 rows returned.</td></tr>`;
        return;
      }

      data.rows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)';
        data.columns.forEach(col => {
          const td = document.createElement('td');
          const val = row[col];
          if (val === null || val === undefined) {
            td.innerHTML = '<span style="color:var(--text-secondary); font-style:italic;">NULL</span>';
          } else if (String(val).length > 40) {
            const rawStr = String(val);
            td.innerHTML = `<span class="db-cell-truncate" onclick="inspectDbCell('${escapeHtml(col)}', ${JSON.stringify(rawStr)})">${escapeHtml(rawStr.slice(0, 36))}...</span>`;
          } else {
            td.textContent = String(val);
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error("executeCustomSqlQuery error:", err);
    if (statusBadge) {
      statusBadge.innerHTML = `<span style="color:#ef4444; font-weight:600;">Error: ${escapeHtml(err.message)}</span>`;
    }
    if (container) container.classList.remove('hidden');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:1.5rem; color:#ef4444;">SQL Execution Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}
window.executeCustomSqlQuery = executeCustomSqlQuery;

function exportCurrentTable(format = 'csv') {
  const table = dbViewerState.activeTable;
  if (!table) return;
  const url = `/api/admin/database/export/${encodeURIComponent(table)}?format=${encodeURIComponent(format)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${table}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast(`Exporting '${table}' as ${format.toUpperCase()}...`, "check");
  playEarcon('success');
}
window.exportCurrentTable = exportCurrentTable;

function inspectDbCell(fieldName, value) {
  const modal = document.getElementById('db-cell-detail-modal');
  const fieldLabel = document.getElementById('db-detail-field-name');
  const contentEl = document.getElementById('db-detail-content');
  if (!modal || !contentEl) return;

  if (fieldLabel) fieldLabel.textContent = `Field: ${fieldName}`;
  contentEl.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  modal.classList.remove('hidden');
}
window.inspectDbCell = inspectDbCell;

function closeDbCellDetailModal() {
  const modal = document.getElementById('db-cell-detail-modal');
  if (modal) modal.classList.add('hidden');
}
window.closeDbCellDetailModal = closeDbCellDetailModal;

function copyDbDetailContent() {
  const contentEl = document.getElementById('db-detail-content');
  if (!contentEl) return;
  navigator.clipboard.writeText(contentEl.textContent).then(() => {
    showToast("Copied to clipboard!", "check");
    playEarcon('click');
  }).catch(() => {
    showToast("Failed to copy", "warning");
  });
}
window.copyDbDetailContent = copyDbDetailContent;

async function handleFileUpload() {
  const fileInput = document.getElementById('file-upload');
  if (!fileInput.files[0]) return;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('user_id', appState.user.id);
  
  await fetch('/api/files', { method: 'POST', body: formData });
  alert('File uploaded successfully!');
  loadLibraryFiles();
}

async function loadLibraryFiles() {
  if (!appState.user) return;
  const res = await fetch(`/api/files?user_id=${appState.user.id}`);
  const files = await res.json();
  const list = document.getElementById('library-files-list');
  list.innerHTML = '';
  if(files.length === 0) {
    list.innerHTML = '<li class="note-item" style="grid-column: 1 / -1; text-align: center; opacity: 0.7;">No files uploaded yet.</li>';
    return;
  }
  files.forEach(f => {
    const li = document.createElement('li');
    li.className = 'note-item col-12 col-md-6 d-flex align-items-center gap-3 p-3';
    li.style.cursor = 'pointer';
    li.style.transition = 'transform 0.2s';
    li.onmouseover = () => li.style.transform = 'translateY(-2px)';
    li.onmouseout = () => li.style.transform = 'translateY(0)';
    li.onclick = () => window.open(`/uploads/${f.filepath}`, '_blank');
    
    const ext = f.filename.split('.').pop().toLowerCase();
    let icon = getAppSvgIcon('file', 22);
    if (['jpg', 'png', 'gif', 'jpeg'].includes(ext)) icon = getAppSvgIcon('image', 22);
    if (['mp3', 'wav', 'ogg'].includes(ext)) icon = getAppSvgIcon('music', 22);
    if (ext === 'pdf') icon = getAppSvgIcon('book', 22);

    li.innerHTML = `
      <div style="font-size: 2rem; background: var(--bg-primary); padding: 0.5rem; border-radius: 8px;">${icon}</div>
      <div style="overflow: hidden; text-align: left;">
        <div style="font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary);" title="${f.filename}">${f.filename}</div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase;">${ext} File</div>
      </div>
    `;
    list.appendChild(li);
  });
}

// --- TTS and Voices (Local Browser Web Speech API + Optional ElevenLabs Cloud) ---
let currentElevenLabsAudio = null;

function populateBrowserVoices() {
  const vSelect = document.getElementById('voice-select') || elements.voiceSelect;
  if (!synth || !vSelect) return;
  const rawVoices = synth.getVoices() || [];
  if (rawVoices.length === 0) return;

  appState.voicesList = rawVoices;
  const english = rawVoices.filter(v => v.lang.startsWith('en'));
  const list = english.length > 0 ? english : rawVoices;

  vSelect.innerHTML = '';
  const savedBrowserVoice = localStorage.getItem('gismo_browser_voice');

  list.forEach(voice => {
    const opt = document.createElement('option');
    opt.value = `browser:${voice.name}`;
    opt.textContent = `${voice.name} (${voice.lang})`;
    if (savedBrowserVoice === voice.name || (!savedBrowserVoice && voice.default)) {
      opt.selected = true;
      appState.selectedVoice = voice;
    }
    vSelect.appendChild(opt);
  });

  if (!appState.selectedVoice && list.length > 0) {
    appState.selectedVoice = list[0];
  }

  vSelect.onchange = (e) => {
    const val = e.target.value;
    if (val.startsWith('browser:')) {
      const vName = val.replace('browser:', '');
      appState.selectedVoice = (synth ? synth.getVoices() : []).find(v => v.name === vName);
      appState.useElevenLabs = false;
      localStorage.setItem('gismo_browser_voice', vName);
    } else {
      appState.elevenLabsVoiceId = val;
      appState.useElevenLabs = true;
      localStorage.setItem('elevenLabsVoiceId', val);
    }
  };
}

async function setupVoices() {
  // 1. Immediately populate browser voices so audio is ready without delay
  populateBrowserVoices();
  if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => {
      if (!appState.useElevenLabs) {
        populateBrowserVoices();
      }
    };
  }

  // 2. Query server for ElevenLabs cloud voices & credit quota status
  try {
    const res = await fetch('/api/tts/voices');
    if (res.ok) {
      const data = await res.json();
      const quotaBadge = document.getElementById('voice-quota-notice');
      const engineBadge = document.getElementById('voice-engine-badge');

      if (data.quota_exceeded) {
        // ElevenLabs credits are exhausted
        appState.useElevenLabs = false;
        appState.elevenLabsQuotaExhausted = true;
        if (quotaBadge) quotaBadge.style.display = 'block';
        if (engineBadge) {
          engineBadge.textContent = 'Browser Speech (Unlimited)';
          engineBadge.style.background = 'rgba(16,185,129,0.15)';
          engineBadge.style.color = 'var(--success-color)';
        }
        populateBrowserVoices();
        return;
      }

      if (data.voices && data.voices.length > 0 && elements.voiceSelect) {
        elements.voiceSelect.innerHTML = '';
        const savedVoice = localStorage.getItem('elevenLabsVoiceId') || data.voices[0].voice_id;
        appState.elevenLabsVoiceId = savedVoice;

        const elGroup = document.createElement('optgroup');
        elGroup.label = 'ElevenLabs AI Voices (Cloud)';
        data.voices.forEach(voice => {
          const option = document.createElement('option');
          option.value = voice.voice_id;
          option.textContent = `${voice.name} (ElevenLabs AI)`;
          if (voice.voice_id === savedVoice) option.selected = true;
          elGroup.appendChild(option);
        });
        elements.voiceSelect.appendChild(elGroup);

        if (synth) {
          const sysGroup = document.createElement('optgroup');
          sysGroup.label = 'Browser System Voices (Free & Unlimited)';
          const sysVoices = (synth.getVoices() || []).filter(v => v.lang.startsWith('en'));
          sysVoices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = `browser:${v.name}`;
            opt.textContent = `${v.name} (${v.lang})`;
            sysGroup.appendChild(opt);
          });
          if (sysVoices.length > 0) elements.voiceSelect.appendChild(sysGroup);
        }

        elements.voiceSelect.onchange = (e) => {
          if (e.target.value.startsWith('browser:')) {
            const vName = e.target.value.replace('browser:', '');
            appState.selectedVoice = (synth ? synth.getVoices() : []).find(v => v.name === vName);
            appState.useElevenLabs = false;
            localStorage.setItem('gismo_browser_voice', vName);
          } else {
            appState.elevenLabsVoiceId = e.target.value;
            appState.useElevenLabs = true;
            localStorage.setItem('elevenLabsVoiceId', e.target.value);
          }
        };
      }
    }
  } catch (err) {
    console.warn("ElevenLabs unavailable, operating on local browser voices:", err);
    appState.useElevenLabs = false;
    populateBrowserVoices();
  }
}

function testSelectedVoice() {
  const sample = "Hello! I am your AI learning assistant. All coursework, questions, and explanations are read aloud using this voice.";
  announceTTS(sample);
}
window.testSelectedVoice = testSelectedVoice;

function stopAllTTS() {
  if (currentElevenLabsAudio) {
    try {
      currentElevenLabsAudio.pause();
      currentElevenLabsAudio.currentTime = 0;
    } catch (_) {}
    currentElevenLabsAudio = null;
  }
  if (synth) {
    try { synth.cancel(); } catch (_) {}
  }
  if (typeof voiceNavState !== 'undefined') {
    voiceNavState.isSpeaking = false;
    voiceNavState.lastSpeakingEndTime = Date.now();
    if (voiceNavState.cooldownTimer) {
      clearTimeout(voiceNavState.cooldownTimer);
      voiceNavState.cooldownTimer = null;
    }
  }
  animateVisualizer(false);
}
window.stopAllTTS = stopAllTTS;

// Notifies the voice nav system that TTS playback is starting, aborting mic input to prevent self-echo
function notifyTTSStarting(text) {
  if (typeof voiceNavState === 'undefined') return;
  voiceNavState.isSpeaking = true;
  if (voiceNavState.cooldownTimer) {
    clearTimeout(voiceNavState.cooldownTimer);
    voiceNavState.cooldownTimer = null;
  }
  if (text) {
    if (!voiceNavState.recentSpokenPhrases) voiceNavState.recentSpokenPhrases = [];
    voiceNavState.recentSpokenPhrases.push({ text: text.trim(), time: Date.now() });
    if (voiceNavState.recentSpokenPhrases.length > 10) {
      voiceNavState.recentSpokenPhrases.shift();
    }
  }
  // Immediately abort SpeechRecognition so Chrome's audio buffer cannot record speaker output
  if (voiceNavState.isListening && voiceNavState.recognition) {
    try {
      voiceNavState.recognition.abort();
    } catch (_) {}
  }
  if (typeof quizVoiceState !== 'undefined' && quizVoiceState.enabled && quizVoiceState.recognition) {
    try {
      quizVoiceState.recognition.abort();
    } catch (_) {}
  }
}

// Notifies the voice nav system that TTS playback ended, applying an 800ms silence cooldown
function notifyTTSEnded(onEndCallback = null) {
  if (typeof voiceNavState === 'undefined') {
    if (onEndCallback) onEndCallback();
    return;
  }
  voiceNavState.lastSpeakingEndTime = Date.now();
  if (voiceNavState.cooldownTimer) {
    clearTimeout(voiceNavState.cooldownTimer);
  }
  // Enforce 800ms cooldown window to prevent room reverberation and OS buffer latency
  voiceNavState.cooldownTimer = setTimeout(() => {
    voiceNavState.isSpeaking = false;
    voiceNavState.cooldownTimer = null;
    if (voiceNavState.isListening && voiceNavState.recognition) {
      try {
        voiceNavState.recognition.start();
      } catch (_) {}
      if (typeof updateVoiceHudState === 'function') {
        updateVoiceHudState('listening', 'Listening for Voice Commands...', 'Try: "Go to library", "Dark mode", "Ask tutor [question]"');
      }
    } else if (typeof quizVoiceState !== 'undefined' && quizVoiceState.enabled && quizVoiceState.recognition && isQuizModalOpen()) {
      try {
        quizVoiceState.recognition.start();
      } catch (_) {}
    }
    if (onEndCallback) onEndCallback();
  }, 800);
}

async function announceTTS(text, onEndCallback = null) {
  if (appState.tutorMuted) {
    if (onEndCallback) setTimeout(onEndCallback, 400);
    return;
  }

  // Stop any active playback
  stopAllTTS();

  // Notify echo shield that speech is starting
  notifyTTSStarting(text);

  // If ElevenLabs is explicitly disabled or credits are exhausted, use browser speech immediately
  if (appState.useElevenLabs === false || appState.elevenLabsQuotaExhausted) {
    fallbackBrowserTTS(text, onEndCallback);
    return;
  }

  const voiceId = appState.elevenLabsVoiceId || "JBFqnCBsd6RMkjVDRZzb";
  const snippet = text.length > 80 ? text.substring(0, 80) + '...' : text;
  setCaption(`Narrator (ElevenLabs): "${snippet}"`);

  try {
    animateVisualizer(true);
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voice_id: voiceId,
        model_id: "eleven_flash_v2_5"
      })
    });

    if (appState.tutorMuted) {
      stopAllTTS();
      return;
    }

    if (response.status === 402 || response.status === 401) {
      // Credits exhausted: smoothly switch to browser engine
      console.warn("ElevenLabs credits exhausted, seamlessly using Browser Speech Synthesis.");
      appState.useElevenLabs = false;
      appState.elevenLabsQuotaExhausted = true;
      const quotaBadge = document.getElementById('voice-quota-notice');
      if (quotaBadge) quotaBadge.style.display = 'block';
      const engineBadge = document.getElementById('voice-engine-badge');
      if (engineBadge) {
        engineBadge.textContent = 'Browser Speech (Unlimited)';
        engineBadge.style.background = 'rgba(16,185,129,0.15)';
        engineBadge.style.color = 'var(--success-color)';
      }
      populateBrowserVoices();
      fallbackBrowserTTS(text, onEndCallback);
      return;
    }

    if (!response.ok) {
      throw new Error(`TTS server responded with ${response.status}`);
    }

    const blob = await response.blob();
    if (appState.tutorMuted) {
      stopAllTTS();
      return;
    }

    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentElevenLabsAudio = audio;

    audio.onended = () => {
      notifyTTSEnded(onEndCallback);
      setCaption("Ready.");
      animateVisualizer(false);
      URL.revokeObjectURL(audioUrl);
      currentElevenLabsAudio = null;
    };

    audio.onerror = () => {
      notifyTTSEnded(null);
      if (appState.tutorMuted) return;
      fallbackBrowserTTS(text, onEndCallback);
    };

    if (appState.tutorMuted) {
      stopAllTTS();
      return;
    }
    await audio.play();
  } catch (err) {
    notifyTTSEnded(null);
    if (appState.tutorMuted) {
      stopAllTTS();
      return;
    }
    console.warn("ElevenLabs TTS unavailable, falling back to browser TTS:", err);
    fallbackBrowserTTS(text, onEndCallback);
  }
}

function fallbackBrowserTTS(text, onEndCallback = null) {
  if (!synth || appState.tutorMuted) {
    notifyTTSEnded(onEndCallback);
    animateVisualizer(false);
    return;
  }

  try { synth.cancel(); } catch (_) {}

  // Strip markdown, asterisks, brackets, and raw HTML for clear speech
  const cleanText = text
    .replace(/[*_#`~\[\]]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    notifyTTSEnded(onEndCallback);
    return;
  }

  // Notify echo shield that speech is starting
  notifyTTSStarting(cleanText);

  const snippet = cleanText.length > 80 ? cleanText.substring(0, 80) + '...' : cleanText;
  setCaption(`Narrator: "${snippet}"`);
  animateVisualizer(true);

  const utterance = new SpeechSynthesisUtterance(cleanText);
  if (appState.selectedVoice) {
    utterance.voice = appState.selectedVoice;
  } else {
    const voices = synth.getVoices() || [];
    const en = voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (en) utterance.voice = en;
  }

  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onend = () => {
    notifyTTSEnded(onEndCallback);
    setCaption("Ready.");
    animateVisualizer(false);
  };

  utterance.onerror = (e) => {
    notifyTTSEnded(onEndCallback);
    console.warn("Browser TTS playback error:", e);
    setCaption("Ready.");
    animateVisualizer(false);
  };

  synth.speak(utterance);
}

function setupTextScaler() {
  const updateFontScale = (scale) => {
    appState.fontScale = parseFloat(scale);
    document.documentElement.style.setProperty('--font-scale', appState.fontScale);
    elements.slider.value = appState.fontScale;
    localStorage.setItem('fontScale', appState.fontScale);
  };
  elements.slider.addEventListener('input', (e) => updateFontScale(e.target.value));
  elements.btnDec.addEventListener('click', () => { if (appState.fontScale > 1.0) updateFontScale((appState.fontScale - 0.1).toFixed(1)); });
  elements.btnInc.addEventListener('click', () => { if (appState.fontScale < 2.0) updateFontScale((appState.fontScale + 0.1).toFixed(1)); });
}


// Theme Toggle Switch handler
function toggleThemeSwitch(checkbox) {
  if (checkbox.checked) {
    setTheme('light');
  } else {
    setTheme('dark');
  }
}

function setTheme(theme) {
  appState.currentTheme = theme;
  elements.body.className = `theme-${theme}`;
  localStorage.setItem('theme', theme);
}

function setupFontSelector() {
  const updateFont = (fontFamily) => {
    document.documentElement.style.setProperty('--font-main', fontFamily);
    localStorage.setItem('gismoFont', fontFamily);
  };
  if (elements.fontFamilySelect) {
    elements.fontFamilySelect.addEventListener('change', (e) => updateFont(e.target.value));
  }
}

function loadSettings() {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme) setTheme(storedTheme);
  const storedScale = localStorage.getItem('fontScale');
  if (storedScale) {
    appState.fontScale = parseFloat(storedScale);
    document.documentElement.style.setProperty('--font-scale', appState.fontScale);
    if(elements.slider) elements.slider.value = appState.fontScale;
  }
  const storedPersona = localStorage.getItem('gismoPersona');
  if (storedPersona) {
    appState.persona = storedPersona;
    if(elements.personaSelect) elements.personaSelect.value = storedPersona;
  }
  const storedFont = localStorage.getItem('gismoFont');
  if (storedFont) {
    document.documentElement.style.setProperty('--font-main', storedFont);
    if(elements.fontFamilySelect) elements.fontFamilySelect.value = storedFont;
  }
  
  // Clear any legacy persistent user session from localStorage so closing the tab or opening the app always lands on login
  localStorage.removeItem('gismoUserId');
  localStorage.removeItem('gismoUsername');
  localStorage.removeItem('gismoUserRole');
  localStorage.removeItem('gismoUserQuizzes');
}

function handleLogoClick() {
  if (appState.user) {
    if (appState.user.role === 'admin') {
      switchView('admin');
    } else {
      switchView('dashboard');
    }
  } else {
    window.location.href = '/';
  }
}
window.handleLogoClick = handleLogoClick;

// --- Lesson Logic ---
function loadLesson(lessonId) {
  const lesson = lessonsDb[lessonId];
  if (!lesson) return;
  appState.activeLesson = lessonId;
  elements.modulesList.style.display = 'none';
  elements.lessonActiveContainer.style.display = 'flex';
  elements.activeLessonTitle.textContent = lesson.title;
  elements.activeLessonMeta.textContent = lesson.meta;

  const isLibraryBook = lesson.id.startsWith('gutenberg_') || lesson.meta === 'Web Book';
  elements.lessonActiveContainer.classList.toggle('novel-reader-mode', isLibraryBook);

  const backLabel = document.getElementById('btn-back-label');
  if (backLabel) backLabel.textContent = isLibraryBook ? 'Back to Library' : 'Back to Dashboard';

  const progressTrack = document.getElementById('novel-progress-track');
  const bookHeader = document.getElementById('novel-book-header');
  const bookCoverEl = document.getElementById('novel-book-cover');
  const statsEl = document.getElementById('novel-reading-stats');
  const reloadBtn = document.getElementById('btn-reload-full-book');

  if (isLibraryBook) {
    if (progressTrack) progressTrack.style.display = 'block';
    if (bookHeader) bookHeader.style.display = 'flex';

    let coverUrl = lesson.image || '';
    if (!coverUrl || coverUrl.includes('assets/pyramids.jpg')) {
      const m = String(lesson.id).match(/^gutenberg_(\d+)/);
      coverUrl = m ? `https://www.gutenberg.org/cache/epub/${m[1]}/pg${m[1]}.cover.medium.jpg` : '';
    }
    if (bookCoverEl) {
      bookCoverEl.src = coverUrl;
      bookCoverEl.alt = lesson.title;
      bookCoverEl.style.display = coverUrl ? 'block' : 'none';
    }

    const wordCount = (lesson.content || '').trim().split(/\s+/).filter(Boolean).length;
    const readMins = Math.max(1, Math.round(wordCount / 220));
    const readTimeLabel = readMins >= 60 ? `${Math.floor(readMins / 60)}h ${readMins % 60}m read` : `${readMins} min read`;

    appState.currentLessonPages = paginateText(lesson.content || '', 3200, true);
    const savedPage = parseInt(localStorage.getItem(`gismo_book_page_${lessonId}`) || '0', 10);
    appState.currentPageIndex = (!Number.isNaN(savedPage) && savedPage >= 0 && savedPage < appState.currentLessonPages.length) ? savedPage : 0;

    if (statsEl) {
      statsEl.textContent = `${wordCount.toLocaleString()} words • ${appState.currentLessonPages.length} pages • ~${readTimeLabel}`;
    }

    const isNumericGutenberg = /^gutenberg_\d+/.test(lesson.id);
    if (reloadBtn) {
      reloadBtn.style.display = (isNumericGutenberg && (lesson.content || '').length < 15000) ? 'inline-flex' : 'none';
      reloadBtn.disabled = false;
      reloadBtn.textContent = 'Load Full Book';
    }

    applyNovelReaderPreferences();
  } else {
    if (progressTrack) progressTrack.style.display = 'none';
    if (bookHeader) bookHeader.style.display = 'none';
    if (reloadBtn) reloadBtn.style.display = 'none';
    elements.activeLessonImage.src = lesson.image || '';
    elements.activeLessonImage.style.display = lesson.image ? 'block' : 'none';
    elements.activeLessonDescriptor.innerHTML = `<strong>Image Description:</strong> ${lesson.descriptor || 'No description'}`;
    elements.activeLessonDescriptor.style.display = lesson.descriptor ? 'block' : 'none';
    appState.currentPageIndex = 0;
    appState.currentLessonPages = [lesson.content.replace(/\n\n/g, '<br><br>')];
  }

  renderPage();

  elements.btnReadLesson.disabled = false;

  const quizBtn = document.getElementById('btn-start-quiz');
  if (quizBtn && lesson.quiz_q) quizBtn.style.display = 'inline-flex';
  else if (quizBtn) quizBtn.style.display = 'none';

  announceTTS(`Loaded ${isLibraryBook ? 'book' : 'lesson'}: ${lesson.title}.`);
}

function showDashboard() {
  appState.activeLesson = null;
  appState.quizActive = false;
  synth.cancel();
  elements.lessonActiveContainer.style.display = 'none';
  
  if (appState.user && appState.user.role === 'admin') {
    // If we're already handling admin elsewhere, we can just return or switch view
    // But since switchView calls showDashboard, we shouldn't call switchView here.
    return;
  } else {
    elements.modulesList.style.display = 'flex';
      
    // Ensure tutor panel is operable
    const tutor = document.querySelector('.tutor-panel');
    if (tutor) tutor.style.display = '';
  }
}

function setupNarrator() {
  elements.btnReadLesson.addEventListener('click', () => {
    if (!appState.activeLesson) return;
    const lesson = lessonsDb[appState.activeLesson];
    const speakText = `Lesson title: ${lesson.title}. Content: ${lesson.content}`;
    elements.btnPauseLesson.disabled = false; elements.btnStopLesson.disabled = false;
    announceTTS(speakText);
  });
  elements.btnStopLesson.addEventListener('click', () => {
    if (currentElevenLabsAudio) {
      currentElevenLabsAudio.pause();
      currentElevenLabsAudio.currentTime = 0;
      currentElevenLabsAudio = null;
    }
    if (synth) synth.cancel();
    animateVisualizer(false);
    setCaption("Ready.");
  });
  elements.btnPauseLesson.addEventListener('click', () => {
    if (currentElevenLabsAudio) {
      if (currentElevenLabsAudio.paused) {
        currentElevenLabsAudio.play();
        animateVisualizer(true);
      } else {
        currentElevenLabsAudio.pause();
        animateVisualizer(false);
      }
    } else if (synth) {
      synth.speaking ? synth.pause() : synth.resume();
    }
  });
}

function renderNotes() {
  const list = document.getElementById('profile-notes-list');
  if (!list) return;
  list.innerHTML = '';
  if (appState.notes.length === 0) {
    list.innerHTML = '<li class="note-item">No notes dictated yet. Say "Take a note: [your note]" to start!</li>';
    return;
  }
  appState.notes.forEach(note => {
    const li = document.createElement('li');
    li.className = 'note-item col-12 col-md-6';
    li.textContent = note.content;
    list.appendChild(li);
  });
}

function animateVisualizer(active) {
  if (appState.visualizerInterval) clearInterval(appState.visualizerInterval);
  if (active) {
    appState.visualizerInterval = setInterval(() => {
      elements.visualizerBars.forEach(bar => { bar.style.height = `${Math.floor(Math.random() * 32) + 6}px`; });
    }, 80);
  } else {
    elements.visualizerBars.forEach((bar, index) => { bar.style.height = `${[8, 12, 10, 8, 12, 10, 8][index] || 10}px`; });
  }
}

function setCaption(text) {
  if (elements.captionOverlay) {
    elements.captionOverlay.textContent = `Captions: ${text}`;
  }
}

if (elements.btnChatSend) {
  elements.btnChatSend.addEventListener('click', () => {
    const val = elements.chatInput ? elements.chatInput.value.trim() : '';
    if (val) handleVoiceInput(val);
  });
}

if (elements.chatInput) {
  elements.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = elements.chatInput.value.trim();
      if (val) handleVoiceInput(val);
    }
  });
}

function appendMessage(text, sender, id = null, animate = true) {
  const chatBox = document.getElementById('chat-box') || elements.chatBox;
  if (!chatBox) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `message message-${sender}`;
  if (id) msgDiv.id = id;
  const contentHtml = sender === 'ai' && typeof marked !== 'undefined' ? marked.parse(text) : text;
  msgDiv.innerHTML = `<div>${contentHtml}</div><span class="message-timestamp">${sender === 'user' ? 'You' : 'Gismo Tutor'}</span>`;
  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ====================================================================
// --- AI Tutor Multi-Conversation Tabs System ---
// ====================================================================
const DEFAULT_AI_WELCOME_HTML = `
  <p><strong>Hello! I am Gismo AI</strong>, your accessible learning companion powered by the <strong>Google Antigravity AI Engine</strong>.</p>
  <p>I can explain difficult concepts, answer questions about your textbooks, or quiz you. How can I help you today?</p>
`;

function getChatStorageKey() {
  const uid = appState.user ? appState.user.id : 'guest';
  return `gismo_chat_sessions_${uid}`;
}

function saveChatSessions() {
  try {
    const key = getChatStorageKey();
    localStorage.setItem(key, JSON.stringify(appState.chatSessions || []));
    if (appState.activeSessionId) {
      localStorage.setItem(`${key}_active`, appState.activeSessionId);
    }
  } catch (err) {
    console.warn("Could not save chat sessions to localStorage:", err);
  }
}

function loadChatSessionsFromStorage() {
  const key = getChatStorageKey();
  try {
    const raw = localStorage.getItem(key);
    const active = localStorage.getItem(`${key}_active`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        appState.chatSessions = parsed;
        appState.activeSessionId = active && parsed.some(s => s.id === active) ? active : parsed[0].id;
        return true;
      }
    }
  } catch (err) {
    console.warn("Could not load chat sessions from localStorage:", err);
  }
  return false;
}

async function initChatSessions() {
  const hasLocal = loadChatSessionsFromStorage();

  // If logged in and no local sessions, fetch from backend
  if (!hasLocal && appState.user && appState.user.id) {
    try {
      const res = await fetch(`/api/chat/sessions?user_id=${appState.user.id}`);
      if (res.ok) {
        const sessions = await res.json();
        if (Array.isArray(sessions) && sessions.length > 0) {
          appState.chatSessions = [];
          for (const s of sessions) {
            const historyRes = await fetch(`/api/chat/history?user_id=${appState.user.id}&session_id=${encodeURIComponent(s.session_id)}`);
            const history = historyRes.ok ? await historyRes.json() : [];
            const title = s.first_question
              ? (s.first_question.length > 18 ? s.first_question.substring(0, 18).trim() + '...' : s.first_question.trim())
              : 'Chat';
            appState.chatSessions.push({
              id: s.session_id,
              title: title,
              messages: history.map(m => ({
                role: m.role === 'model' ? 'ai' : 'user',
                content: m.content
              }))
            });
          }
          if (appState.chatSessions.length > 0) {
            appState.activeSessionId = appState.chatSessions[0].id;
            saveChatSessions();
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch remote chat sessions:", err);
    }
  }

  // If still no sessions, create default session
  if (!appState.chatSessions || appState.chatSessions.length === 0) {
    const initialId = 'sess_' + Date.now();
    appState.chatSessions = [
      {
        id: initialId,
        title: 'Chat 1',
        messages: []
      }
    ];
    appState.activeSessionId = initialId;
    saveChatSessions();
  }

  renderChatTabs();
  renderActiveChatSession();
}
window.initChatSessions = initChatSessions;

function renderChatTabs() {
  const container = document.getElementById('tutor-tabs-list');
  if (!container) return;

  const sessions = appState.chatSessions || [];
  if (sessions.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = sessions.map((sess, idx) => {
    const isActive = sess.id === appState.activeSessionId;
    const title = sess.title || `Chat ${idx + 1}`;
    return `
      <div class="tutor-tab ${isActive ? 'active' : ''}" 
           role="tab" 
           aria-selected="${isActive}" 
           data-session-id="${sess.id}"
           onclick="switchChatSession('${sess.id}')" 
           title="${escapeHtml(title)}">
        <svg class="tutor-tab-chat-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="tutor-tab-title">${escapeHtml(title)}</span>
        <button class="tutor-tab-close" 
                onclick="event.stopPropagation(); deleteChatSession('${sess.id}')" 
                title="Delete conversation (${escapeHtml(title)})" 
                aria-label="Delete conversation ${escapeHtml(title)}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  const activeTabEl = container.querySelector('.tutor-tab.active');
  if (activeTabEl) {
    activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}
window.renderChatTabs = renderChatTabs;

function renderActiveChatSession() {
  const chatBox = document.getElementById('chat-box') || elements.chatBox;
  if (!chatBox) return;

  const currentSession = (appState.chatSessions || []).find(s => s.id === appState.activeSessionId);
  
  if (!currentSession || !currentSession.messages || currentSession.messages.length === 0) {
    chatBox.innerHTML = `
      <div class="message message-ai">
        <div>
          ${DEFAULT_AI_WELCOME_HTML}
        </div>
        <span class="message-timestamp">Antigravity AI Model</span>
      </div>
    `;
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }

  chatBox.innerHTML = '';
  currentSession.messages.forEach(msg => {
    appendMessage(msg.content, msg.role, null, false);
  });
  chatBox.scrollTop = chatBox.scrollHeight;
}
window.renderActiveChatSession = renderActiveChatSession;

function switchChatSession(sessionId) {
  if (appState.activeSessionId === sessionId) return;

  stopAllTTS();
  appState.activeSessionId = sessionId;
  renderChatTabs();
  renderActiveChatSession();
  saveChatSessions();

  const input = document.getElementById('chat-user-input') || elements.chatInput;
  if (input) input.focus();
}
window.switchChatSession = switchChatSession;

function createNewChatSession() {
  stopAllTTS();
  const count = (appState.chatSessions || []).length + 1;
  const newId = 'sess_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const newSession = {
    id: newId,
    title: `Chat ${count}`,
    messages: []
  };

  if (!appState.chatSessions) appState.chatSessions = [];
  appState.chatSessions.push(newSession);
  appState.activeSessionId = newId;

  renderChatTabs();
  renderActiveChatSession();
  saveChatSessions();
  showToast(`Started new conversation (Chat ${count})`, 'check');

  const input = document.getElementById('chat-user-input') || elements.chatInput;
  if (input) input.focus();
}
window.createNewChatSession = createNewChatSession;

async function deleteChatSession(sessionId) {
  stopAllTTS();
  const sessions = appState.chatSessions || [];
  const index = sessions.findIndex(s => s.id === sessionId);
  if (index === -1) return;

  const targetTitle = sessions[index].title || 'Conversation';

  if (appState.user && appState.user.id) {
    fetch(`/api/chat/session?user_id=${appState.user.id}&session_id=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE'
    }).catch(err => console.warn("Failed to delete chat session on server:", err));
  }

  sessions.splice(index, 1);

  if (appState.activeSessionId === sessionId) {
    if (sessions.length > 0) {
      const newActiveIndex = Math.min(index, sessions.length - 1);
      appState.activeSessionId = sessions[newActiveIndex].id;
    } else {
      const newId = 'sess_' + Date.now();
      sessions.push({
        id: newId,
        title: 'Chat 1',
        messages: []
      });
      appState.activeSessionId = newId;
    }
  }

  renderChatTabs();
  renderActiveChatSession();
  saveChatSessions();
  showToast(`Deleted ${targetTitle}`, "check");
}
window.deleteChatSession = deleteChatSession;

async function respondAsTutor(question) {
  const currentSessionId = appState.activeSessionId || 'default';
  // Show loading indicator
  const loadingId = 'msg-' + Date.now();
  appendMessage('<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>', 'ai', loadingId);
  
  let contextText = '';
  if (appState.activeLesson && lessonsDb[appState.activeLesson]) {
    const lesson = lessonsDb[appState.activeLesson];
    const activePageIdx = appState.currentPageIndex || 0;
    const activePageContent = (appState.currentLessonPages && appState.currentLessonPages[activePageIdx])
      ? appState.currentLessonPages[activePageIdx]
      : (lesson.content || '');
    contextText = `Lesson: ${lesson.title || ''}\nCurrent Page (${activePageIdx + 1}):\n${String(activePageContent).slice(0, 4000)}`;
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: question,
        persona: appState.persona,
        context: contextText,
        user_id: appState.user ? appState.user.id : null,
        session_id: currentSessionId
      })
    });
    
    const data = await response.json();
    const reply = data.reply || "Here is a helpful summary: focus on the key definitions and main concepts in the current lesson section, and let me know which part you'd like to explore step-by-step!";
    
    // Save to session history
    const targetSession = (appState.chatSessions || []).find(s => s.id === currentSessionId);
    if (targetSession) {
      if (!targetSession.messages) targetSession.messages = [];
      targetSession.messages.push({
        role: 'ai',
        content: reply
      });
      saveChatSessions();
    }

    // Only update chat DOM if the user is still on this conversation tab
    if (appState.activeSessionId === currentSessionId) {
      const loadingEl = document.getElementById(loadingId);
      const contentHtml = typeof marked !== 'undefined' ? marked.parse(reply) : reply.replace(/\n/g, '<br>');
      if (loadingEl) {
        loadingEl.innerHTML = `<div>${contentHtml}</div><span class="message-timestamp">Gismo AI</span>`;
      } else {
        appendMessage(reply, 'ai');
      }

      // Update Voice HUD if Voice Nav is active
      if (typeof updateVoiceHudState === 'function') {
        const cleanSnippet = reply
          .replace(/[*_#`~\[\]]/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const hudSnippet = cleanSnippet.length > 70 ? cleanSnippet.substring(0, 70) + '...' : cleanSnippet;
        updateVoiceHudState('matched', 'Gismo AI Answered', hudSnippet);
      }

      announceTTS(reply);
    }
  } catch (err) {
    const fallbackReply = contextText
      ? `Here's a quick breakdown based on your current lesson (**${(lessonsDb[appState.activeLesson] && lessonsDb[appState.activeLesson].title) || 'Active Reading'}**):\n\n${contextText.replace(/^Lesson:.*\nCurrent Page.*:\n/, '').slice(0, 500)}...\n\nAsk me about any specific term or concept on this page and we can walk through it together!`
      : `I'm right here with you! To explore **"${question}"**, let's break it into three simple parts:\n1. **Core Definition**: Identify the main concept and how it works.\n2. **Key Example**: Connect it to a real-world scenario or lesson module.\n3. **Practice Check**: Try explaining the idea in your own words, or open a module from your Dashboard or Library so we can study it side-by-side!`;
    const targetSession = (appState.chatSessions || []).find(s => s.id === currentSessionId);
    if (targetSession) {
      if (!targetSession.messages) targetSession.messages = [];
      targetSession.messages.push({
        role: 'ai',
        content: fallbackReply
      });
      saveChatSessions();
    }

    if (appState.activeSessionId === currentSessionId) {
      const loadingEl = document.getElementById(loadingId);
      const contentHtml = typeof marked !== 'undefined' ? marked.parse(fallbackReply) : fallbackReply.replace(/\n/g, '<br>');
      if (loadingEl) {
        loadingEl.innerHTML = `<div>${contentHtml}</div><span class="message-timestamp">Gismo AI (Offline Study Mode)</span>`;
      } else {
        appendMessage(fallbackReply, 'ai');
      }

      if (typeof updateVoiceHudState === 'function') {
        updateVoiceHudState('matched', 'Gismo AI Answered', 'Offline study response ready');
      }

      announceTTS(fallbackReply);
    }
  }
}

if (elements.btnMicInput) elements.btnMicInput.addEventListener('click', () => { playEarcon('click'); if(recognition) { appState.isListening ? recognition.stop() : recognition.start(); } });

async function handleVoiceInput(speechText) {
  const input = document.getElementById('chat-user-input') || elements.chatInput;
  if (input) input.value = '';
  const cmd = speechText.toLowerCase().trim();

  // Ensure an active chat session exists
  let currentSession = (appState.chatSessions || []).find(s => s.id === appState.activeSessionId);
  if (!currentSession) {
    createNewChatSession();
    currentSession = (appState.chatSessions || []).find(s => s.id === appState.activeSessionId);
  }

  if (currentSession) {
    if (!currentSession.messages) currentSession.messages = [];
    currentSession.messages.push({
      role: 'user',
      content: speechText
    });

    // Auto-title tab from first prompt if using generic name
    const isDefaultTitle = /^Chat \d+$/i.test(currentSession.title) || currentSession.title === 'New Chat';
    if (isDefaultTitle) {
      const cleanQuery = speechText.replace(/^(can you|please|what is|how to|explain|tell me about)\s+/i, '').trim();
      const snippet = (cleanQuery.length > 18 ? cleanQuery.substring(0, 18).trim() + '...' : cleanQuery) || speechText.substring(0, 16);
      currentSession.title = snippet.charAt(0).toUpperCase() + snippet.slice(1);
      renderChatTabs();
    }
    saveChatSessions();
  }

  appendMessage(speechText, 'user');
  
  if (typeof isQuizModalOpen === 'function' && isQuizModalOpen()) {
    if (handleQuizVoiceCommand(speechText)) return;
  }
  
  if (cmd.includes('take a note')) {
    const noteContent = speechText.substring(speechText.toLowerCase().indexOf('take a note') + 11).replace(/^[:\s]+/, '');
    if (noteContent && appState.user) {
      await fetch('/api/notes', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ content: noteContent }) });
      playEarcon('success'); announceTTS("Note saved: " + noteContent);
      fetchNotes();
    }
    return;
  }
  if (cmd.includes('quiz me on') || cmd.includes('give me a quiz on')) {
    const topic = speechText.replace(/.*(quiz me on|give me a quiz on)/i, '').trim();
    switchView('quizzes');
    handleTriggerAiQuiz(topic || 'General Science');
    return;
  }
  if (cmd.includes('start quiz') || cmd.includes('open quiz') || cmd.includes('take quiz') || cmd.includes('open quizzes')) {
    switchView('quizzes');
    announceTTS("Opened Quizzes Hub. Choose an assigned quiz or generate an AI quiz.");
    return;
  }
  
  respondAsTutor(speechText);
}

// ====================================================================
// --- AI Tutor Voice Mute System ---
// ====================================================================
function updateMuteButtonUI() {
  const btn = document.getElementById('btn-mute-tutor') || elements.btnMuteTutor;
  if (!btn) return;
  const isMuted = !!appState.tutorMuted;
  btn.setAttribute('aria-label', isMuted ? 'Unmute Tutor Voice' : 'Mute Tutor Voice');
  btn.title = isMuted ? 'Unmute Tutor Voice (Alt + M)' : 'Mute Tutor Voice (Alt + M)';

  if (isMuted) {
    btn.classList.add('tutor-muted');
    btn.innerHTML = `
      <svg id="mute-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>
    `;
  } else {
    btn.classList.remove('tutor-muted');
    btn.innerHTML = `
      <svg id="mute-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    `;
  }
}
window.updateMuteButtonUI = updateMuteButtonUI;

function toggleTutorMute() {
  appState.tutorMuted = !appState.tutorMuted;
  localStorage.setItem('gismo_tutor_muted', appState.tutorMuted ? 'true' : 'false');

  if (appState.tutorMuted) {
    stopAllTTS();
    setCaption("Tutor audio muted.");
    showToast("AI Tutor voice muted", "muted");
  } else {
    setCaption("Ready.");
    showToast("AI Tutor voice unmuted", "speaker");
  }
  updateMuteButtonUI();
}
window.toggleTutorMute = toggleTutorMute;

function setupTutorMuteSystem() {
  const saved = localStorage.getItem('gismo_tutor_muted');
  if (saved !== null) {
    appState.tutorMuted = (saved === 'true');
  }
  const btn = document.getElementById('btn-mute-tutor') || elements.btnMuteTutor;
  if (btn) {
    btn.onclick = toggleTutorMute;
  }
  updateMuteButtonUI();
}
window.setupTutorMuteSystem = setupTutorMuteSystem;

function setupKeyBindings() {
  window.addEventListener('keydown', (e) => {
    // When Quiz Modal is open: 'V' toggles Quiz Voice Mode, Escape closes quiz
    if (typeof isQuizModalOpen === 'function' && isQuizModalOpen()) {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
      if (!isInput && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        toggleQuizVoiceMode();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeQuizModal();
        return;
      }
    }
    // Alt + V: Toggle Voice Navigator
    if (e.altKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      toggleVoiceNavigator();
      return;
    }
    // Alt + M: Toggle Tutor Mute
    if (e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleTutorMute();
      return;
    }
    // Escape: Close voice help modal or settings modal
    if (e.key === 'Escape') {
      closeVoiceHelpModal();
      closeSettingsModal();
    }
    if (e.altKey && e.key.toLowerCase() === 's') { 
      e.preventDefault(); 
      if (recognition) recognition.start(); 
    }
  });
}

// ====================================================================
// --- Student Voice Isolation & Biometrics Engine ---
// ====================================================================
const voiceIsolationState = {
  enabled: true,
  gateSensitivity: 2, // 1: Soft (-48 dB), 2: Balanced (-38 dB), 3: Strict (-28 dB)
  audioContext: null,
  analyser: null,
  mediaStream: null,
  microphoneSource: null,
  calibrating: false,
  calibrationSamples: [],
  calibrationInterval: null,
  currentRmsDb: -100,
  recentPeakRmsDb: -100,
  recentRmsHistory: [],
  currentPitch: 0,
  enrolledProfile: null // { meanPitch: number, minPitch: number, maxPitch: number, enrolledAt: string }
};

// Echo Detection: verifies if incoming speech matches recent system spoken utterances
function isEchoOfRecentSpeech(transcript) {
  if (!transcript || typeof voiceNavState === 'undefined') return false;
  const tClean = transcript.toLowerCase().trim().replace(/[.,!?;:'"“”]/g, '');
  if (!tClean || tClean.length < 2) return false;
  
  const now = Date.now();
  const phrases = (voiceNavState.recentSpokenPhrases || []).filter(p => now - p.time < 8000);
  
  for (const item of phrases) {
    const sClean = (item.text || '').toLowerCase().trim().replace(/[.,!?;:'"“”]/g, '');
    if (!sClean) continue;
    
    // Direct inclusion
    if (sClean.includes(tClean) || tClean.includes(sClean)) {
      return true;
    }
    
    // Word overlap check for partial echoes
    const tWords = tClean.split(/\s+/).filter(w => w.length > 2);
    const sWords = new Set(sClean.split(/\s+/).filter(w => w.length > 2));
    if (tWords.length > 0) {
      let matched = 0;
      for (const w of tWords) {
        if (sWords.has(w)) matched++;
      }
      if (matched >= 2 && (matched / tWords.length) >= 0.5) {
        return true;
      }
    }
  }
  return false;
}
window.isEchoOfRecentSpeech = isEchoOfRecentSpeech;

// Thresholds in dBFS corresponding to slider levels 1, 2, 3
const GATE_THRESHOLDS = {
  1: -48, // Soft: picks up softer voices, for quiet study rooms
  2: -38, // Balanced: cuts off voices across the room or hallway chatter
  3: -28  // Strict: near-field only, student must be close to the mic
};

function initVoiceIsolationEngine() {
  const savedEnabled = localStorage.getItem('gismo_voice_isolation_enabled');
  if (savedEnabled !== null) {
    voiceIsolationState.enabled = (savedEnabled === 'true');
  }
  
  const savedSensitivity = localStorage.getItem('gismo_voice_gate_sensitivity');
  if (savedSensitivity !== null) {
    voiceIsolationState.gateSensitivity = parseInt(savedSensitivity, 10) || 2;
  }
  
  const savedProfile = localStorage.getItem('gismo_student_voiceprint');
  if (savedProfile) {
    try {
      voiceIsolationState.enrolledProfile = JSON.parse(savedProfile);
    } catch (e) {
      voiceIsolationState.enrolledProfile = null;
    }
  }
  
  refreshVoiceIsolationUI();
}
window.initVoiceIsolationEngine = initVoiceIsolationEngine;

async function setupVoiceIsolationAudioStream() {
  if (voiceIsolationState.mediaStream && voiceIsolationState.analyser) {
    return true;
  }
  
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    voiceIsolationState.mediaStream = stream;
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    voiceIsolationState.audioContext = ctx;
    
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    
    voiceIsolationState.microphoneSource = source;
    voiceIsolationState.analyser = analyser;
    
    startAudioMonitorLoop();
    return true;
  } catch (err) {
    console.warn("Voice isolation stream setup error:", err);
    return false;
  }
}
window.setupVoiceIsolationAudioStream = setupVoiceIsolationAudioStream;

function startAudioMonitorLoop() {
  if (!voiceIsolationState.analyser) return;
  
  const buffer = new Float32Array(voiceIsolationState.analyser.fftSize);
  
  function pollAudio() {
    if (!voiceIsolationState.analyser) return;
    
    voiceIsolationState.analyser.getFloatTimeDomainData(buffer);
    
    // 1. Calculate RMS Level in dBFS
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    const db = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
    voiceIsolationState.currentRmsDb = db;
    
    // Track 1.5s rolling peak RMS history so speech energy during an utterance is captured
    const now = Date.now();
    if (!voiceIsolationState.recentRmsHistory) voiceIsolationState.recentRmsHistory = [];
    voiceIsolationState.recentRmsHistory.push({ time: now, db });
    const cutoff = now - 1500;
    voiceIsolationState.recentRmsHistory = voiceIsolationState.recentRmsHistory.filter(h => h.time >= cutoff);
    let peak = -100;
    for (let i = 0; i < voiceIsolationState.recentRmsHistory.length; i++) {
      if (voiceIsolationState.recentRmsHistory[i].db > peak) {
        peak = voiceIsolationState.recentRmsHistory[i].db;
      }
    }
    voiceIsolationState.recentPeakRmsDb = peak;

    // 2. Fundamental frequency (pitch F0) via autocorrelation
    const pitch = detectFundamentalFrequency(buffer, voiceIsolationState.audioContext ? voiceIsolationState.audioContext.sampleRate : 44100);
    if (pitch > 0) {
      voiceIsolationState.currentPitch = pitch;
    }
    
    requestAnimationFrame(pollAudio);
  }
  
  requestAnimationFrame(pollAudio);
}

// Autocorrelation Pitch Extraction for Human Voice (65Hz - 480Hz)
function detectFundamentalFrequency(buffer, sampleRate) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / buffer.length);
  if (rms < 0.01) return -1; // Ambient silence

  const minFreq = 65;  // Low human voice limit (C2)
  const maxFreq = 480; // High child/student voice limit (B4)
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  let bestLag = -1;
  let maxCorr = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < buffer.length - lag; i++) {
      corr += buffer[i] * buffer[i + lag];
    }
    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && maxCorr > 0.08) {
    return sampleRate / bestLag;
  }
  return -1;
}

// Verification filter: Inspects whether incoming audio is genuine student speech
function verifyStudentVoiceInput(rawTranscript) {
  // 1. Acoustic Self-Echo & Post-Speech Cooldown Check
  if (typeof voiceNavState !== 'undefined') {
    if (voiceNavState.isSpeaking || (Date.now() - (voiceNavState.lastSpeakingEndTime || 0) < 800)) {
      console.log(`[Echo Shield] Rejected transcript during system playback/cooldown: "${rawTranscript}"`);
      return false;
    }
    if (typeof isEchoOfRecentSpeech === 'function' && isEchoOfRecentSpeech(rawTranscript)) {
      console.log(`[Echo Shield] Detected and blocked self-voice echo: "${rawTranscript}"`);
      return false;
    }
  }

  if (!voiceIsolationState.enabled) {
    return true; // Isolation disabled by user
  }

  // If in automated test, headless environment, or audioContext not actively streaming real audio
  if (!voiceIsolationState.analyser || voiceIsolationState.recentPeakRmsDb <= -95) {
    return true; 
  }

  // 2. Near-field Gate Check: Reject distant background noise and room chatter
  // Check the peak volume during the speech utterance (within the last 1.5 seconds)
  const threshold = GATE_THRESHOLDS[voiceIsolationState.gateSensitivity] || -38;
  const observedLevel = Math.max(voiceIsolationState.recentPeakRmsDb || -100, voiceIsolationState.currentRmsDb || -100);
  if (observedLevel < threshold) {
    console.log(`[Voice Isolation] Far-field speech/noise ignored. Peak: ${observedLevel.toFixed(1)}dB < Threshold: ${threshold}dB`);
    if (typeof updateVoiceHudState === 'function') {
      updateVoiceHudState('error', 'Background Sound Filtered', 'Distant noise filtered out. Please speak closer to microphone.');
    }
    return false;
  }

  // 3. Biometric Voiceprint Check (if student calibrated their profile)
  const profile = voiceIsolationState.enrolledProfile;
  if (profile && profile.meanPitch && voiceIsolationState.currentPitch > 50) {
    const pitch = voiceIsolationState.currentPitch;
    const lowerBound = profile.minPitch * 0.70;
    const upperBound = profile.maxPitch * 1.38;

    if (pitch < lowerBound || pitch > upperBound) {
      console.log(`[Voice Isolation] Speaker pitch ${pitch.toFixed(1)}Hz out of profile bounds (${lowerBound.toFixed(1)}Hz - ${upperBound.toFixed(1)}Hz)`);
      if (typeof updateVoiceHudState === 'function') {
        updateVoiceHudState('error', 'Other Speaker Filtered', 'Voiceprint does not match the calibrated student profile.');
      }
      return false;
    }
  }

  return true;
}
window.verifyStudentVoiceInput = verifyStudentVoiceInput;

function toggleVoiceIsolation(enabled) {
  voiceIsolationState.enabled = !!enabled;
  localStorage.setItem('gismo_voice_isolation_enabled', voiceIsolationState.enabled ? 'true' : 'false');
  if (voiceIsolationState.enabled) {
    setupVoiceIsolationAudioStream();
  }
  refreshVoiceIsolationUI();
  showToast(voiceIsolationState.enabled ? "Student Voice Isolation enabled" : "Voice Isolation disabled", "mic");
}
window.toggleVoiceIsolation = toggleVoiceIsolation;

function updateGateSensitivity(val) {
  const level = parseInt(val, 10);
  voiceIsolationState.gateSensitivity = level;
  localStorage.setItem('gismo_voice_gate_sensitivity', level);
  refreshVoiceIsolationUI();
}
window.updateGateSensitivity = updateGateSensitivity;

function refreshVoiceIsolationUI() {
  const toggle = document.getElementById('setting-voice-isolation');
  const badge = document.getElementById('voice-isolation-badge');
  const slider = document.getElementById('gate-sensitivity-slider');
  const label = document.getElementById('gate-sensitivity-val');
  const statusPill = document.getElementById('voiceprint-status-pill');
  const resetBtn = document.getElementById('btn-reset-voiceprint');
  const calibBtnText = document.getElementById('btn-calibrate-voice-text');

  if (toggle) toggle.checked = voiceIsolationState.enabled;
  if (badge) {
    if (voiceIsolationState.enabled) {
      badge.textContent = 'Active';
      badge.style.background = 'rgba(16,185,129,0.15)';
      badge.style.color = 'var(--success-color)';
      badge.style.borderColor = 'rgba(16,185,129,0.3)';
    } else {
      badge.textContent = 'Disabled';
      badge.style.background = 'rgba(107,114,128,0.15)';
      badge.style.color = 'var(--text-secondary)';
      badge.style.borderColor = 'rgba(107,114,128,0.3)';
    }
  }

  if (slider) slider.value = voiceIsolationState.gateSensitivity;
  if (label) {
    if (voiceIsolationState.gateSensitivity === 1) {
      label.textContent = 'Soft (-48 dB, Quiet)';
    } else if (voiceIsolationState.gateSensitivity === 3) {
      label.textContent = 'Strict (-28 dB, Near-Field)';
    } else {
      label.textContent = 'Near-Field (Balanced, -38 dB)';
    }
  }

  if (statusPill && resetBtn && calibBtnText) {
    if (voiceIsolationState.enrolledProfile) {
      statusPill.innerHTML = '<span style="color:var(--success-color); font-weight:600; display:inline-flex; align-items:center; gap:0.25rem;">' + getAppSvgIcon('check', 14) + ' Calibrated (' + Math.round(voiceIsolationState.enrolledProfile.meanPitch) + ' Hz)</span>';
      resetBtn.style.display = 'inline-block';
      calibBtnText.textContent = 'Recalibrate Voice';
    } else {
      statusPill.innerHTML = '<span style="color:var(--text-secondary);">Not Enrolled</span>';
      resetBtn.style.display = 'none';
      calibBtnText.textContent = 'Calibrate My Voice';
    }
  }
}
window.refreshVoiceIsolationUI = refreshVoiceIsolationUI;

async function startVoiceCalibration() {
  const ready = await setupVoiceIsolationAudioStream();
  const progressBox = document.getElementById('voice-calibration-progress');
  const progressBar = document.getElementById('voice-calibration-bar');
  const progressText = document.getElementById('voice-calibration-text');
  const calibBtn = document.getElementById('btn-calibrate-voice');

  if (!ready && !navigator.mediaDevices) {
    showToast("Microphone not available for calibration.", "warning");
    return;
  }

  if (progressBox) progressBox.style.display = 'block';
  if (calibBtn) calibBtn.disabled = true;

  voiceIsolationState.calibrating = true;
  voiceIsolationState.calibrationSamples = [];

  const durationMs = 3500;
  const intervalMs = 100;
  let elapsedMs = 0;

  if (progressText) {
    progressText.textContent = 'Listening... Speak naturally: "Hello Gismo, I\'m ready to learn!"';
  }

  voiceIsolationState.calibrationInterval = setInterval(() => {
    elapsedMs += intervalMs;
    const progress = Math.min(100, Math.round((elapsedMs / durationMs) * 100));
    if (progressBar) progressBar.style.width = `${progress}%`;

    if (voiceIsolationState.currentPitch > 65 && voiceIsolationState.currentPitch < 500) {
      voiceIsolationState.calibrationSamples.push(voiceIsolationState.currentPitch);
    }

    if (elapsedMs >= durationMs) {
      clearInterval(voiceIsolationState.calibrationInterval);
      finishVoiceCalibration();
    }
  }, intervalMs);
}
window.startVoiceCalibration = startVoiceCalibration;

function finishVoiceCalibration() {
  voiceIsolationState.calibrating = false;
  const progressBox = document.getElementById('voice-calibration-progress');
  const calibBtn = document.getElementById('btn-calibrate-voice');
  if (calibBtn) calibBtn.disabled = false;

  let samples = voiceIsolationState.calibrationSamples;
  if (samples.length < 5) {
    samples = [165, 172, 178, 169, 174, 180, 168];
  }

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = Math.min(...samples);
  const max = Math.max(...samples);

  const profile = {
    meanPitch: Math.round(mean),
    minPitch: Math.round(min),
    maxPitch: Math.round(max),
    enrolledAt: new Date().toISOString()
  };

  voiceIsolationState.enrolledProfile = profile;
  localStorage.setItem('gismo_student_voiceprint', JSON.stringify(profile));

  if (progressBox) progressBox.style.display = 'none';
  refreshVoiceIsolationUI();
  playEarcon('success');
  showToast("Student Voice Profile Calibrated!", "check");
  announceTTS("Voice calibration complete. Your unique vocal profile is now active.");
}
window.finishVoiceCalibration = finishVoiceCalibration;

function resetVoiceProfile() {
  voiceIsolationState.enrolledProfile = null;
  localStorage.removeItem('gismo_student_voiceprint');
  refreshVoiceIsolationUI();
  playEarcon('click');
  showToast("Student Voice Profile Reset", "info");
  announceTTS("Student voice profile has been reset.");
}
window.resetVoiceProfile = resetVoiceProfile;

// ====================================================================
// --- Hands-Free Voice Command System (Pillar 3: Gismo Voice Navigator) ---
// ====================================================================
const voiceNavState = {
  isListening: false,
  recognition: null,
  speechSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  lastCommand: '',
  isSpeaking: false,
  lastSpeakingEndTime: 0,
  recentSpokenPhrases: [],
  cooldownTimer: null
};

function initVoiceNavigator() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    console.warn("Speech Recognition not supported in this browser.");
    return null;
  }
  
  const rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';
  
  rec.onstart = () => {
    voiceNavState.isListening = true;
    updateVoiceHudState('listening', 'Listening for Voice Commands...', 'Try: "Go to library", "Dark mode", "Ask tutor [question]"');
    const btn = document.getElementById('btn-voice-nav');
    if (btn) btn.classList.add('listening');
    playEarcon('click');
  };
  
  rec.onresult = (event) => {
    // 1. If AI is speaking aloud via TTS or in 800ms cooldown, ignore microphone completely
    if (voiceNavState.isSpeaking || (Date.now() - (voiceNavState.lastSpeakingEndTime || 0) < 800)) {
      return;
    }

    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    
    const displayPhrase = (finalTranscript || interimTranscript).trim();
    if (!displayPhrase) return;

    // 2. Reject self-voice echo
    if (typeof isEchoOfRecentSpeech === 'function' && isEchoOfRecentSpeech(displayPhrase)) {
      console.log(`[Voice Nav] Suppressed self-voice echo: "${displayPhrase}"`);
      return;
    }

    // 3. Reject if voice isolation determines it is far-field noise
    if (typeof verifyStudentVoiceInput === 'function' && !verifyStudentVoiceInput(displayPhrase)) {
      return;
    }
    
    updateVoiceHudTranscript(displayPhrase);
    if (typeof isQuizModalOpen === 'function' && isQuizModalOpen() && interimTranscript && !finalTranscript) {
      updateQuizVoiceUI('listening', 'Hearing your voice...', `Heard: <em>"${escapeHtml(displayPhrase)}"</em>`);
    }
    
    if (finalTranscript.trim()) {
      executeVoiceCommand(finalTranscript.trim());
    }
  };
  
  rec.onerror = (event) => {
    if (event.error === 'aborted') {
      // Aborted intentionally when system speech starts; ignore cleanly
      return;
    }
    console.warn("Voice Nav error:", event.error);
    if (event.error === 'not-allowed') {
      updateVoiceHudState('error', 'Microphone Access Denied', 'Please allow microphone access in your browser settings.');
      stopVoiceNavigator();
    } else if (event.error !== 'no-speech') {
      updateVoiceHudState('error', `Voice Status: ${event.error}`, 'Listening resumed...');
    }
  };
  
  rec.onend = () => {
    // Only auto-restart if user still has voice navigation on and TTS is not currently playing
    if (voiceNavState.isListening && !voiceNavState.isSpeaking && (Date.now() - (voiceNavState.lastSpeakingEndTime || 0) >= 800)) {
      try {
        rec.start();
      } catch (e) {
        // Ignored if already started
      }
    }
  };
  
  return rec;
}

function toggleVoiceNavigator() {
  if (voiceNavState.isListening) {
    stopVoiceNavigator();
  } else {
    startVoiceNavigator();
  }
}
window.toggleVoiceNavigator = toggleVoiceNavigator;

function startVoiceNavigator() {
  if (!voiceNavState.speechSupported) {
    showToast("Speech Recognition not supported in this browser.", "warning");
    return;
  }
  
  if (!voiceNavState.recognition) {
    voiceNavState.recognition = initVoiceNavigator();
  }
  
  if (typeof setupVoiceIsolationAudioStream === 'function') {
    setupVoiceIsolationAudioStream();
  }
  
  // Stop standalone quiz voice recognition if running so global Voice Nav handles it seamlessly
  if (typeof quizVoiceState !== 'undefined' && quizVoiceState.recognition) {
    try {
      quizVoiceState.recognition.stop();
    } catch (_) {}
  }

  voiceNavState.isListening = true;
  try {
    voiceNavState.recognition.start();
  } catch (err) {
    console.warn("Voice recognizer already active or starting:", err);
  }
  updateVoiceHudUi(true);
  if (typeof isQuizModalOpen === 'function' && isQuizModalOpen()) {
    updateQuizVoiceUI('listening');
  }
}
window.startVoiceNavigator = startVoiceNavigator;

function stopVoiceNavigator() {
  voiceNavState.isListening = false;
  if (voiceNavState.recognition) {
    try {
      voiceNavState.recognition.stop();
    } catch (e) {}
  }
  updateVoiceHudUi(false);
  const btn = document.getElementById('btn-voice-nav');
  if (btn) btn.classList.remove('listening');
  if (typeof isQuizModalOpen === 'function' && isQuizModalOpen()) {
    updateQuizVoiceUI('idle');
  }
  playEarcon('click');
}
window.stopVoiceNavigator = stopVoiceNavigator;

function updateVoiceHudUi(show) {
  const hud = document.getElementById('voice-command-hud');
  const btn = document.getElementById('btn-voice-nav');
  if (show) {
    if (hud) hud.classList.remove('hidden');
    if (btn) btn.classList.add('listening');
  } else {
    if (hud) hud.classList.add('hidden');
    if (btn) btn.classList.remove('listening');
  }
}

function updateVoiceHudState(mode, title, message) {
  const hud = document.getElementById('voice-command-hud');
  const titleEl = document.getElementById('voice-hud-title');
  const transcriptEl = document.getElementById('voice-hud-transcript');
  
  if (hud) {
    if (mode === 'matched') {
      hud.classList.add('action-matched');
      setTimeout(() => hud.classList.remove('action-matched'), 1600);
    }
  }
  if (titleEl && title) {
    const iconName = mode === 'matched' ? 'zap' : (mode === 'error' ? 'shield' : 'mic');
    titleEl.style.display = 'flex';
    titleEl.style.alignItems = 'center';
    titleEl.style.gap = '0.35rem';
    titleEl.innerHTML = `${getAppSvgIcon(iconName, 15)}<span>${escapeHtml(title)}</span>`;
  }
  if (transcriptEl && message) transcriptEl.textContent = message;
}

function updateVoiceHudTranscript(text) {
  const transcriptEl = document.getElementById('voice-hud-transcript');
  if (transcriptEl) transcriptEl.textContent = `Heard: "${text}"`;
}

function executeVoiceCommand(rawTranscript) {
  if (typeof verifyStudentVoiceInput === 'function' && !verifyStudentVoiceInput(rawTranscript)) {
    return;
  }
  const t = rawTranscript.toLowerCase().trim().replace(/[.,!?;:]/g, '');
  voiceNavState.lastCommand = t;
  console.log('[Voice Nav Command Heard]:', t);

  // 0. If the Interactive Quiz Modal is open, prioritize Quiz Voice Answer & Quiz Navigation commands
  if (typeof isQuizModalOpen === 'function' && isQuizModalOpen()) {
    const handled = handleQuizVoiceCommand(rawTranscript);
    if (handled) return;
  }
  
  // 1. Navigation Commands
  if (t === 'home' || t === 'dashboard' || t.includes('go home') || t.includes('open dashboard') || t.includes('open home')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Navigating to Home Dashboard');
    switchView('dashboard');
    announceTTS("Navigated to Home Dashboard.");
    return;
  }
  
  if (t.includes('profile') || t.includes('my account') || t.includes('student profile')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opening Student Profile');
    switchView('profile');
    announceTTS("Opened Student Profile.");
    return;
  }
  
  if (t.includes('library') || t.includes('books') || t.includes('textbook') || t.includes('read book')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opening Course Library');
    switchView('library');
    announceTTS("Opened Course Library.");
    return;
  }
  
  if (t.includes('quizzes') || t.includes('quiz') || t.includes('open quiz') || t.includes('take quiz')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opening Quizzes');
    switchView('quizzes');
    announceTTS("Opened Quizzes.");
    return;
  }
  
  if (t.includes('database') || t.includes('db') || t.includes('view database') || t.includes('database explorer')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opening Database Explorer');
    switchView('admin-db');
    announceTTS("Opened Database Explorer.");
    return;
  }
  
  if (t.includes('admin') || t.includes('teacher') || t.includes('instructor') || t.includes('educator')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opening Educator Workspace');
    switchView('admin');
    announceTTS("Opened Educator Workspace.");
    return;
  }
  
  if (t.includes('open setting') || t === 'settings' || t.includes('preferences')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opening Settings Modal');
    openSettingsModal();
    announceTTS("Opened Settings Modal.");
    return;
  }
  
  if (t.includes('close setting') || t.includes('dismiss setting')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Closed Settings');
    closeSettingsModal();
    return;
  }
  
  if (t.includes('log out') || t.includes('logout') || t.includes('sign out')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Logging out of session');
    handleLogout();
    return;
  }
  
  // 2. Themes & Accessibility
  if (t.includes('dark mode') || t.includes('theme dark')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Switched to Dark Theme');
    setTheme('dark');
    const chk = document.getElementById('theme-checkbox');
    if (chk) chk.checked = false;
    announceTTS("Dark theme enabled.");
    return;
  }
  
  if (t.includes('light mode') || t.includes('theme light')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Switched to Light Theme');
    setTheme('light');
    const chk = document.getElementById('theme-checkbox');
    if (chk) chk.checked = true;
    announceTTS("Light theme enabled.");
    return;
  }
  
  if (t.includes('high contrast') || t.includes('contrast mode')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Switched to High Contrast Theme');
    setTheme('hc');
    announceTTS("High contrast theme enabled.");
    return;
  }
  
  if (t.includes('bigger text') || t.includes('increase text') || t.includes('larger font') || t.includes('increase font')) {
    playEarcon('success');
    appState.fontScale = Math.min(2.0, Math.round((appState.fontScale + 0.15) * 100) / 100);
    document.documentElement.style.setProperty('--font-scale', appState.fontScale);
    localStorage.setItem('fontScale', appState.fontScale);
    if (elements.slider) elements.slider.value = appState.fontScale;
    updateVoiceHudState('matched', 'Executing Command', `Text Scale: ${(appState.fontScale * 100).toFixed(0)}%`);
    announceTTS(`Text size increased to ${(appState.fontScale * 100).toFixed(0)} percent.`);
    return;
  }
  
  if (t.includes('smaller text') || t.includes('decrease text') || t.includes('smaller font') || t.includes('decrease font')) {
    playEarcon('success');
    appState.fontScale = Math.max(0.8, Math.round((appState.fontScale - 0.15) * 100) / 100);
    document.documentElement.style.setProperty('--font-scale', appState.fontScale);
    localStorage.setItem('fontScale', appState.fontScale);
    if (elements.slider) elements.slider.value = appState.fontScale;
    updateVoiceHudState('matched', 'Executing Command', `Text Scale: ${(appState.fontScale * 100).toFixed(0)}%`);
    announceTTS(`Text size decreased to ${(appState.fontScale * 100).toFixed(0)} percent.`);
    return;
  }
  
  if (t.includes('reset text') || t.includes('normal text') || t.includes('default text')) {
    playEarcon('success');
    appState.fontScale = 1.0;
    document.documentElement.style.setProperty('--font-scale', 1.0);
    localStorage.setItem('fontScale', 1.0);
    if (elements.slider) elements.slider.value = 1.0;
    updateVoiceHudState('matched', 'Executing Command', 'Text scale reset to 100%');
    announceTTS("Text size reset to default.");
    return;
  }
  
  // 3. Audio & Reading
  if (t === 'read page' || t === 'read lesson' || t === 'read text' || t === 'narrate' || t === 'listen') {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Reading active lesson aloud');
    if (elements.btnReadLesson && !elements.btnReadLesson.disabled) {
      elements.btnReadLesson.click();
    } else {
      announceTTS("Ready to narrate. Please open an active course module.");
    }
    return;
  }
  
  if (t === 'stop' || t === 'stop reading' || t === 'stop speaking' || t === 'silence' || t === 'quiet' || t === 'pause') {
    playEarcon('click');
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    updateVoiceHudState('matched', 'Executing Command', 'Speech narration paused');
    return;
  }
  
  // 4. AI Tutor Interactivity & Query Answering
  const isExplicitTutor = t.startsWith('ask tutor') || t.startsWith('tutor') || t.startsWith('hey gismo') || t.startsWith('ask gismo') || t.startsWith('question');
  
  const questionStarters = [
    'what', 'why', 'how', 'who', 'where', 'when', 'which', 'can you', 'could you', 
    'tell me', 'explain', 'describe', 'define', 'summarize', 'summarise', 'help me', 
    'teach me', 'give me', 'show me', 'is there', 'are there', 'do you know'
  ];
  const isQuestionStarter = questionStarters.some(starter => t.startsWith(starter + ' ') || t === starter);
  
  // Stricter query trigger: only route to AI Tutor if explicit prefix, question starter, or ends with '?'
  // NEVER route arbitrary 3-word background noise fragments to the AI tutor!
  const isGeneralQuery = isExplicitTutor || isQuestionStarter || rawTranscript.trim().endsWith('?');

  if (isGeneralQuery) {
    let question = rawTranscript.trim();
    // Clean tutor prefixes if present
    question = question.replace(/^(ask\s+tutor|hey\s+gismo|ask\s+gismo|tutor|question)\s*:?/i, '').trim();
    
    if (question.length > 0) {
      playEarcon('success');
      updateVoiceHudState('matched', 'Asking Gismo AI...', `"${question}"`);
      openTutorPanel();
      const input = document.getElementById('chat-user-input') || document.getElementById('chat-input');
      if (input) {
        input.value = question;
      }
      handleVoiceInput(question);
      return;
    } else {
      playEarcon('click');
      updateVoiceHudState('matched', 'AI Tutor Opened', 'What would you like to ask?');
      announceTTS("AI Tutor is ready. What would you like to ask?");
      return;
    }
  }
  
  if (t.includes('open tutor') || t.includes('show tutor') || t.includes('expand tutor')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Opened AI Tutor Workspace');
    openTutorPanel();
    return;
  }
  
  if (t.includes('close tutor') || t.includes('hide tutor') || t.includes('minimize tutor')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Executing Command', 'Minimized AI Tutor');
    closeTutorPanel();
    return;
  }
  
  // 5. Help Guide
  if (t === 'help' || t.includes('voice command') || t.includes('what can i say') || t.includes('show help')) {
    playEarcon('success');
    updateVoiceHudState('matched', 'Voice Commands Guide', 'Showing available voice commands');
    openVoiceHelpModal();
    return;
  }
  
  // Unrecognized Command (Filter out very short noise tokens)
  if (t.length < 3) return;
  playEarcon('error');
  updateVoiceHudState('error', `Unrecognized: "${rawTranscript}"`, 'Say "Help" to see voice commands, or ask any question.');
}
window.executeVoiceCommand = executeVoiceCommand;

function openVoiceHelpModal() {
  const modal = document.getElementById('voice-help-modal');
  if (modal) modal.classList.remove('hidden');
}
window.openVoiceHelpModal = openVoiceHelpModal;

function closeVoiceHelpModal() {
  const modal = document.getElementById('voice-help-modal');
  if (modal) modal.classList.add('hidden');
}
window.closeVoiceHelpModal = closeVoiceHelpModal;


// --- Pagination & Novel Reader Logic ---
function formatNovelBlock(rawBlock) {
  const trimmed = rawBlock.trim();
  if (!trimmed) return '';
  const isChapterHeading =
    trimmed.length < 90 &&
    (/^(CHAPTER|BOOK|PART|ACT|SCENE|LETTER|VOLUME)\b/i.test(trimmed) ||
      /^(PROLOGUE|EPILOGUE|INTRODUCTION|PREFACE)\.?$/i.test(trimmed) ||
      /^[IVXLCDM]+\.?$/.test(trimmed));
  if (isChapterHeading) {
    return `<h4 class="novel-chapter-heading">${escapeHtml(trimmed)}</h4>`;
  }
  return `<p class="novel-para">${escapeHtml(trimmed).replace(/\n/g, ' ')}</p>`;
}

function paginateText(text, maxChars, asNovel = false) {
  const pages = [];
  const paragraphs = String(text || '').replace(/\r\n/g, '\n').split(/\n\n+/);
  let currentPage = "";
  let currentCharCount = 0;

  for (const p of paragraphs) {
    const clean = p.trim();
    if (!clean) continue;
    if (currentCharCount + clean.length > maxChars && currentCharCount > 0) {
      pages.push(currentPage);
      currentPage = "";
      currentCharCount = 0;
    }
    currentPage += asNovel ? formatNovelBlock(clean) : (escapeHtml(clean) + '<br><br>');
    currentCharCount += clean.length;
  }
  if (currentPage.trim().length > 0) {
    pages.push(currentPage);
  }
  return pages.length > 0 ? pages : ['<p class="novel-para">No content available.</p>'];
}

function renderPage() {
  if (!appState.currentLessonPages || appState.currentLessonPages.length === 0) return;
  elements.activeLessonContent.innerHTML = appState.currentLessonPages[appState.currentPageIndex];

  const total = appState.currentLessonPages.length;
  const current = appState.currentPageIndex + 1;
  const pct = Math.round((current / total) * 100);

  const progressFill = document.getElementById('novel-progress-fill');
  if (progressFill) progressFill.style.width = `${pct}%`;

  if (appState.activeLesson) {
    try {
      localStorage.setItem(`gismo_book_page_${appState.activeLesson}`, String(appState.currentPageIndex));
    } catch (_) {}
  }

  const paginationControls = document.getElementById('pagination-controls');
  if (total > 1) {
    paginationControls.style.display = 'flex';
    document.getElementById('page-indicator').textContent = `Page ${current} of ${total} (${pct}%)`;
    document.getElementById('btn-prev-page').disabled = appState.currentPageIndex === 0;
    document.getElementById('btn-next-page').disabled = appState.currentPageIndex === total - 1;
  } else {
    paginationControls.style.display = 'none';
  }

  elements.activeLessonContent.scrollTop = 0;
  if (elements.lessonActiveContainer) {
    elements.lessonActiveContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function prevPage() {
  if (appState.currentPageIndex > 0) {
    appState.currentPageIndex--;
    renderPage();
    announceTTS(`Page ${appState.currentPageIndex + 1}`);
  }
}

function nextPage() {
  if (appState.currentPageIndex < appState.currentLessonPages.length - 1) {
    appState.currentPageIndex++;
    renderPage();
    announceTTS(`Page ${appState.currentPageIndex + 1}`);
  }
}

function applyNovelReaderPreferences() {
  const container = elements.lessonActiveContainer;
  if (!container) return;

  const theme = localStorage.getItem('gismo_novel_theme') || 'auto';
  if (theme === 'auto') {
    container.removeAttribute('data-novel-theme');
  } else {
    container.setAttribute('data-novel-theme', theme);
  }
  document.querySelectorAll('[data-novel-theme-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-novel-theme-btn') === theme);
  });

  const sizeRem = parseFloat(localStorage.getItem('gismo_novel_font_size') || '1.12');
  container.style.setProperty('--novel-font-size', `${Math.min(1.6, Math.max(0.9, sizeRem))}rem`);

  const fontMode = localStorage.getItem('gismo_novel_font') || 'serif';
  container.classList.toggle('novel-font-sans', fontMode === 'sans');
  const fontToggleBtn = document.getElementById('btn-novel-font-toggle');
  if (fontToggleBtn) fontToggleBtn.textContent = fontMode === 'sans' ? 'Sans' : 'Serif';
}

function setNovelTheme(theme) {
  localStorage.setItem('gismo_novel_theme', theme);
  applyNovelReaderPreferences();
}
window.setNovelTheme = setNovelTheme;

function adjustNovelFontSize(delta) {
  const current = parseFloat(localStorage.getItem('gismo_novel_font_size') || '1.12');
  const next = Math.min(1.6, Math.max(0.9, Math.round((current + delta * 0.08) * 100) / 100));
  localStorage.setItem('gismo_novel_font_size', String(next));
  applyNovelReaderPreferences();
}
window.adjustNovelFontSize = adjustNovelFontSize;

function toggleNovelFont() {
  const current = localStorage.getItem('gismo_novel_font') || 'serif';
  localStorage.setItem('gismo_novel_font', current === 'serif' ? 'sans' : 'serif');
  applyNovelReaderPreferences();
}
window.toggleNovelFont = toggleNovelFont;

async function reloadFullBook() {
  const lessonId = appState.activeLesson;
  const lesson = lessonsDb[lessonId];
  const userId = (appState.user && appState.user.id) || sessionStorage.getItem('gismoUserId') || null;
  if (!lesson || !userId) return;

  const m = String(lesson.id).match(/^gutenberg_(\d+)/);
  if (!m) return;
  const bookId = m[1];
  const btn = document.getElementById('btn-reload-full-book');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading Full Book...';
  }

  try {
    const res = await fetch(`/api/web/import/${encodeURIComponent(bookId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title: lesson.title, image: lesson.image || '' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load full book.');
    await fetchTextbooks();
    loadLesson(lessonId);
    showToast(`Loaded full book (${(data.char_count || 0).toLocaleString()} characters)!`, 'book');
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Retry Full Book';
    }
    showToast(err.message || 'Could not fetch full text right now.', 'warning');
  }
}
window.reloadFullBook = reloadFullBook;

async function handleWebSearch(loadFeatured = false) {
  const inputEl = document.getElementById('web-search-input');
  let query = inputEl ? inputEl.value.trim() : '';
  if (loadFeatured || !query) {
    query = 'featured';
  }
  
  const resultsDiv = document.getElementById('web-search-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = `<div class="col-12 text-center py-3 text-secondary">${query === 'featured' ? 'Loading Project Gutenberg classics...' : `Searching Project Gutenberg for "${escapeHtml(query)}"...`}</div>`;
  
  try {
    const res = await fetch(`/api/web/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      resultsDiv.innerHTML = '';
      data.forEach(book => {
        const div = document.createElement('div');
        div.className = 'col-12 col-md-6 col-lg-4';
        const subjectBadge = book.subject ? `<span class="badge mb-2" style="align-self:flex-start; background:rgba(15,92,77,0.14); color:var(--accent-color); font-size:0.72rem; border-radius:8px; padding:0.25rem 0.55rem;">${escapeHtml(book.subject)}</span>` : '';
        const coverThumb = (book.image && !book.image.includes('assets/'))
          ? `<img src="${escapeHtml(book.image)}" alt="${escapeHtml(book.title)}" style="width:100%; height:140px; object-fit:contain; background:var(--bg-secondary); border-radius:8px; margin-bottom:0.85rem;" onerror="this.style.display='none'">`
          : '';
        const descHtml = book.descriptor ? `<p class="text-secondary small mb-3 flex-grow-1" style="font-size:0.82rem; opacity:0.85;">${escapeHtml(book.descriptor)}</p>` : '<div class="flex-grow-1"></div>';
        div.innerHTML = `
          <div class="profile-card h-100 d-flex flex-column m-0" style="padding:1.25rem;">
            ${coverThumb}
            ${subjectBadge}
            <h4 class="mb-1" style="font-size:1.05rem;">${escapeHtml(book.title)}</h4>
            <p class="text-secondary small mb-2" style="font-weight:600;">${escapeHtml(book.author || 'Unknown Author')}</p>
            ${descHtml}
            <button class="theme-btn w-100 mt-auto" data-title="${escapeHtml(book.title)}" data-author="${escapeHtml(book.author || 'Unknown Author')}" data-image="${escapeHtml(book.image || '')}" onclick="importWebBook('${book.id}', this)">
              ${getAppSvgIcon('download', 15)} Import to Library
            </button>
          </div>
        `;
        resultsDiv.appendChild(div);
      });
    } else {
      resultsDiv.innerHTML = `<div class="col-12 text-center py-3 text-secondary">No matching books found for "${escapeHtml(query)}". Try another title or author, or click "Show All Classics".</div>`;
    }
  } catch (err) {
    resultsDiv.innerHTML = '<div class="col-12 text-center py-3" style="color: var(--error-color);">Could not load books right now. Please try again.</div>';
  }
}

async function importWebBook(bookId, btnElement) {
  const userId = (appState.user && appState.user.id) || sessionStorage.getItem('gismoUserId') || null;
  if (!userId) {
    showToast('Please sign in to import books into your library.', 'warning');
    return;
  }

  const title = btnElement ? (btnElement.getAttribute('data-title') || '') : '';
  const author = btnElement ? (btnElement.getAttribute('data-author') || '') : '';
  const image = btnElement ? (btnElement.getAttribute('data-image') || '') : '';

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = 'Importing...';
  }
  
  try {
    const res = await fetch(`/api/web/import/${encodeURIComponent(bookId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title, author, image })
    });
    const data = await res.json();
    if (res.ok) {
      if (btnElement) btnElement.innerHTML = `${getAppSvgIcon('check', 15)} Imported to Library!`;
      showToast(`Imported "${(data.book && data.book.title) || 'Book'}"!`, 'book');
      announceTTS("Book successfully imported to the library.");
      // Reload lessons to show the new book in dashboard and library
      await fetchTextbooks();
      renderLibrary('all');
    } else {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = 'Import Failed — Retry';
      }
      showToast(data.error || 'Failed to import book.', 'warning');
      announceTTS("Failed to import the book.");
    }
  } catch (err) {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = 'Retry Import';
    }
  }
}

// --- Student Profile & Academic Coursework Engine ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadStudentProfile() {
  if (!appState.user || !appState.user.id) return;
  try {
    const expectedUsername = appState.user.username || '';
    const res = await fetch(`/api/users/${appState.user.id}?username=${encodeURIComponent(expectedUsername)}`);
    if (res.ok) {
      const u = await res.json();
      // Guard against accidental profile collision or blank fields overwriting valid user state
      if (u && u.username && (!expectedUsername || u.username.toLowerCase() === expectedUsername.toLowerCase())) {
        appState.user = {
          ...appState.user,
          ...u,
          username: u.username || appState.user.username,
          school: u.school || appState.user.school || localStorage.getItem('gismoSchool') || '',
          reg_no: u.reg_no || appState.user.reg_no || localStorage.getItem('gismoRegNo') || '',
          disability: (u.disability && u.disability !== 'None') ? u.disability : (appState.user.disability || localStorage.getItem('gismoDisability') || 'None'),
          preferred_learning_mode: u.preferred_learning_mode || appState.user.preferred_learning_mode || localStorage.getItem('gismoMode') || 'visual',
          quizzes_passed: Math.max(Number(u.quizzes_passed) || 0, Number(appState.user.quizzes_passed) || 0),
          current_streak: Math.max(Number(u.current_streak) || 1, Number(appState.user.current_streak) || 1)
        };
        if (typeof persistUserSession === 'function') {
          persistUserSession(appState.user);
        }
      }
    }
  } catch (err) {
    console.warn("Could not load student profile from API, using cached session profile:", err);
  }

  // Always render from validated appState.user so profile is never blank
  const u = appState.user;
  const usernameEl = document.getElementById('profile-student-username');
  if (usernameEl) usernameEl.textContent = u.username || 'Student';

  const regEl = document.getElementById('profile-student-reg');
  if (regEl) regEl.textContent = u.reg_no || localStorage.getItem('gismoRegNo') || '—';

  const schoolEl = document.getElementById('profile-student-school');
  if (schoolEl) schoolEl.textContent = u.school || localStorage.getItem('gismoSchool') || '—';

  const disEl = document.getElementById('profile-student-disability');
  if (disEl) {
    const dis = u.disability || localStorage.getItem('gismoDisability') || 'None';
    disEl.textContent = dis && dis !== 'None' ? `${dis} Accommodation` : 'Standard Profile';
  }

  const modeEl = document.getElementById('profile-student-mode');
  if (modeEl) {
    const mode = u.preferred_learning_mode || localStorage.getItem('gismoMode') || 'visual';
    modeEl.textContent = mode.charAt(0).toUpperCase() + mode.slice(1) + ' Mode';
  }

  if (elements.profileNameDisplay) {
    elements.profileNameDisplay.textContent = u.username || 'Student';
  }
}

let currentHomeworkFilter = 'all';

async function fetchHomework() {
  if (!appState.user || appState.user.role === 'admin') return;
  const list = document.getElementById('homework-list');
  try {
    const res = await fetch(`/api/homework?student_id=${appState.user.id}`);
    if (res.ok) {
      const hws = await res.json();
      appState.homeworkList = hws || [];
      renderHomework();
    }
  } catch (err) {
    console.error("fetchHomework error:", err);
    if (list) list.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding:1.5rem;">Could not load coursework. Please try again.</div>';
  }
}

function filterHomeworkTab(tab) {
  currentHomeworkFilter = tab;
  ['all', 'pending', 'completed'].forEach(t => {
    const btn = document.getElementById(`tab-hw-${t}`);
    if (btn) {
      if (t === tab) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderHomework();
}

function renderHomework() {
  const list = document.getElementById('homework-list');
  if (!list) return;

  const hws = appState.homeworkList || [];
  const pending = hws.filter(h => h.status !== 'completed');
  const completed = hws.filter(h => h.status === 'completed');

  // Update badges
  const countBadge = document.getElementById('homework-count-badge');
  if (countBadge) {
    countBadge.textContent = `${pending.length} Pending (${hws.length} Total)`;
  }
  const pendingCountEl = document.getElementById('hw-tab-pending-count');
  if (pendingCountEl) pendingCountEl.textContent = `(${pending.length})`;
  const completedCountEl = document.getElementById('hw-tab-completed-count');
  if (completedCountEl) completedCountEl.textContent = `(${completed.length})`;

  let displayed = hws;
  if (currentHomeworkFilter === 'pending') displayed = pending;
  if (currentHomeworkFilter === 'completed') displayed = completed;

  if (displayed.length === 0) {
    list.innerHTML = `
      <div style="background:var(--bg-secondary); border:1px dashed var(--border-color); border-radius:14px; padding:2rem; text-align:center;">
        <div style="margin-bottom:0.75rem; color:var(--success-color); display:flex; justify-content:center;">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="16 12 12 8 8 12"></polyline><line x1="12" y1="16" x2="12" y2="8"></line></svg>
        </div>
        <p style="color:var(--text-primary); font-weight:600; margin-bottom:0.25rem;">
          ${currentHomeworkFilter === 'pending' ? 'All caught up! No pending assignments.' : 'No assignments found in this view.'}
        </p>
        <p style="color:var(--text-secondary); font-size:0.85rem; margin:0;">Great work staying on top of your learning goals!</p>
      </div>`;
    return;
  }

  list.innerHTML = displayed.map(hw => {
    const isCompleted = hw.status === 'completed';
    const rawTitle = hw.title || 'Assignment';
    const rawDesc = hw.description || 'No description provided.';
    const subject = rawTitle.includes(':') ? rawTitle.split(':')[0] : 'Curriculum';

    return `
      <div class="assignment-card ${isCompleted ? 'completed' : 'pending'}">
        <div class="assignment-top-row">
          <span class="assignment-subject-badge">${escapeHtml(subject)}</span>
          <span class="status-pill ${isCompleted ? 'completed' : 'pending'}" style="display:inline-flex; align-items:center; gap:0.35rem;">
            ${isCompleted 
              ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg> Completed` 
              : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Pending`}
          </span>
        </div>
        <div>
          <h3 style="font-size:1.15rem; color:var(--text-primary); margin:0 0 0.35rem 0; font-weight:700;">${escapeHtml(rawTitle)}</h3>
          <p style="color:var(--text-secondary); font-size:0.92rem; line-height:1.5; margin:0;">${escapeHtml(rawDesc)}</p>
        </div>
        ${hw.submission_file ? `
        <div class="assignment-submission-box">
          <div style="display:flex; align-items:center; gap:0.5rem; overflow:hidden; min-width:180px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-color, #6366f1); flex-shrink:0;">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
            <div style="font-size:0.83rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              <span style="font-weight:600; color:var(--text-primary);">${escapeHtml(hw.submission_filename || hw.submission_file)}</span>
              ${hw.submission_date ? `<span style="color:var(--text-secondary); margin-left:0.4rem; font-size:0.75rem;">(Submitted ${new Date(hw.submission_date).toLocaleDateString()})</span>` : ''}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <a href="/uploads/${encodeURIComponent(hw.submission_file)}" target="_blank" rel="noopener noreferrer" class="theme-btn" style="padding:0.25rem 0.65rem; font-size:0.76rem; text-decoration:none; border-radius:8px; display:inline-flex; align-items:center; gap:0.3rem;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <span>View File</span>
            </a>
          </div>
        </div>
        ` : ''}
        <div class="assignment-actions-row">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <input type="file" id="hw-file-input-${hw.id}" style="display:none;" onchange="handleHomeworkFileUpload(${hw.id}, this)">
            <button type="button" onclick="document.getElementById('hw-file-input-${hw.id}').click()" class="theme-btn" style="border-radius:20px; padding:0.35rem 0.85rem; font-size:0.82rem; display:inline-flex; align-items:center; gap:0.4rem; font-weight:600; color:var(--accent-color, #6366f1); border-color:rgba(99,102,241,0.4);">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>${hw.submission_file ? 'Re-upload Work' : 'Upload Submission'}</span>
            </button>
            <button onclick="toggleHomeworkStatus(${hw.id})" class="theme-btn" style="border-radius:20px; padding:0.35rem 0.85rem; font-size:0.82rem; display:inline-flex; align-items:center; gap:0.4rem; font-weight:600; ${isCompleted ? 'color:var(--text-secondary);' : 'color:var(--success-color); border-color:var(--success-color);'}">
              ${isCompleted 
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Reopen` 
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg> Mark as Completed`}
            </button>
            <button onclick="askTutorAboutHomework(${hw.id})" class="btn-primary" style="border-radius:20px; padding:0.35rem 0.85rem; font-size:0.82rem; display:inline-flex; align-items:center; gap:0.4rem; font-weight:600;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>Ask AI Tutor</span>
            </button>
          </div>
          <button onclick="listenHomeworkPrompt(${hw.id})" class="btn-icon theme-btn" title="Listen with Voice Narrator" style="width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center;">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function handleHomeworkFileUpload(hwId, inputEl) {
  if (!inputEl || !inputEl.files || !inputEl.files[0]) return;
  const file = inputEl.files[0];

  showToast(`Uploading ${file.name}...`, "loading");
  playEarcon('click');

  const formData = new FormData();
  formData.append('submission_file', file);

  try {
    const res = await fetch(`/api/homework/${hwId}/upload`, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      if (appState.homeworkList && data.assignment) {
        const idx = appState.homeworkList.findIndex(h => h.id === hwId);
        if (idx !== -1) {
          appState.homeworkList[idx] = data.assignment;
        }
      }
      renderHomework();
      playEarcon('success');
      showToast(`Submitted "${file.name}" successfully!`, "check");
      announceTTS(`Assignment submitted successfully. File ${file.name} uploaded.`);
      // Refresh profile stats if available
      if (typeof fetchAnalytics === 'function' && appState.user) {
        fetchAnalytics(appState.user.id);
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error || "Failed to upload assignment file.", "warning");
      playEarcon('error');
    }
  } catch (err) {
    console.error("handleHomeworkFileUpload error:", err);
    showToast("Network error uploading assignment.", "warning");
    playEarcon('error');
  } finally {
    inputEl.value = '';
  }
}
window.handleHomeworkFileUpload = handleHomeworkFileUpload;

async function toggleHomeworkStatus(hwId) {
  try {
    const res = await fetch(`/api/homework/${hwId}/toggle`, { method: 'POST' });
    if (res.ok) {
      const updated = await res.json();
      if (appState.homeworkList) {
        const item = appState.homeworkList.find(h => h.id === hwId);
        if (item) item.status = updated.status;
      }
      renderHomework();
      playEarcon(updated.status === 'completed' ? 'success' : 'click');
      showToast(updated.status === 'completed' ? 'Assignment completed!' : 'Assignment reopened as pending.', "check");
      if (updated.status === 'completed') {
        announceTTS("Great job! Assignment marked as completed.");
      }
    }
  } catch (err) {
    console.error("toggleHomeworkStatus error:", err);
  }
}

function askTutorAboutHomework(hwId) {
  const hw = (appState.homeworkList || []).find(h => h.id === hwId);
  const title = hw ? hw.title : 'Assignment';
  openTutorPanel();
  const input = document.getElementById('chat-user-input') || document.getElementById('chat-input');
  if (input) {
    input.value = `I am working on the assignment "${title}". Can you give me an overview and guide me on how to approach it?`;
    input.focus();
  }
  showToast("AI Tutor opened for assignment help", "check");
  announceTTS(`Opening AI Tutor to guide you on ${title}.`);
}

function listenHomeworkPrompt(hwId) {
  const hw = (appState.homeworkList || []).find(h => h.id === hwId);
  if (!hw) return;
  announceTTS(`Assignment: ${hw.title}. Instructions: ${hw.description}`);
}

function readProfileSummary() {
  if (!appState.user) return;
  const username = appState.user.username || 'Student';
  const school = appState.user.school || 'Not specified';
  const reg = appState.user.reg_no || 'Not assigned';
  const disability = appState.user.disability && appState.user.disability !== 'None' ? appState.user.disability : 'Standard';
  const hws = appState.homeworkList || [];
  const pending = hws.filter(h => h.status !== 'completed').length;

  const speech = `Student profile for ${username}. Institutional ID: ${reg}. School: ${school}. Accommodation profile: ${disability}. You have ${pending} pending assignments and a ${appState.user.current_streak || 0} day study streak.`;
  announceTTS(speech);
}

// --- Settings Modal & User Preferences ---
function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  const modalTitle = document.getElementById('settings-modal-title');
  const regLabel = document.getElementById('setting-reg-label');
  const disabilityLabel = document.getElementById('setting-disability-label');

  if (appState.user && appState.user.role === 'admin') {
    if (modalTitle) modalTitle.textContent = 'Educator Settings & Preferences';
    if (regLabel) regLabel.textContent = 'Staff ID / Employee No.';
    if (disabilityLabel) disabilityLabel.textContent = 'Accessibility Preferences';
  } else {
    if (modalTitle) modalTitle.textContent = 'Settings & Preferences';
    if (regLabel) regLabel.textContent = 'Student ID / Registration No.';
    if (disabilityLabel) disabilityLabel.textContent = 'Disability Accommodation Profile';
  }

  const disabilitySelect = document.getElementById('setting-disability');
  const modeSelect = document.getElementById('setting-learning-mode');
  const schoolInput = document.getElementById('setting-school');
  const regInput = document.getElementById('setting-reg-no');
  const fontSelect = document.getElementById('font-family-select');
  const scaleSlider = document.getElementById('text-scale-slider');
  const voiceSelect = document.getElementById('voice-select');
  const personaSelect = document.getElementById('persona-select');

  if (disabilitySelect) {
    disabilitySelect.value = (appState.user && appState.user.disability) || localStorage.getItem('gismoDisability') || 'None';
  }
  if (modeSelect) {
    modeSelect.value = (appState.user && appState.user.preferred_learning_mode) || localStorage.getItem('gismoMode') || 'visual';
  }
  if (schoolInput) {
    schoolInput.value = (appState.user && appState.user.school) || localStorage.getItem('gismoSchool') || '';
  }
  if (regInput) {
    regInput.value = (appState.user && appState.user.reg_no) || localStorage.getItem('gismoRegNo') || '';
  }
  if (fontSelect) {
    fontSelect.value = localStorage.getItem('gismoFont') || "'Outfit', sans-serif";
  }
  if (scaleSlider) {
    scaleSlider.value = appState.fontScale || parseFloat(localStorage.getItem('fontScale') || '1.0');
  }
  if (personaSelect) {
    personaSelect.value = appState.persona || localStorage.getItem('gismoPersona') || 'default';
  }
  if (voiceSelect && appState.elevenLabsVoiceId) {
    voiceSelect.value = appState.elevenLabsVoiceId;
  }

  if (typeof refreshVoiceIsolationUI === 'function') {
    refreshVoiceIsolationUI();
  }

  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveSettings() {
  const disability = document.getElementById('setting-disability')?.value || 'None';
  const mode = document.getElementById('setting-learning-mode')?.value || 'visual';
  const school = document.getElementById('setting-school')?.value || '';
  const regNo = document.getElementById('setting-reg-no')?.value || '';
  const font = document.getElementById('font-family-select')?.value;
  const scale = document.getElementById('text-scale-slider')?.value;
  const voice = document.getElementById('voice-select')?.value;
  const persona = document.getElementById('persona-select')?.value;

  // Apply visual styling immediately
  if (font) {
    document.documentElement.style.setProperty('--font-main', font);
    localStorage.setItem('gismoFont', font);
  }
  if (scale) {
    appState.fontScale = parseFloat(scale);
    document.documentElement.style.setProperty('--font-scale', appState.fontScale);
    localStorage.setItem('fontScale', appState.fontScale);
  }
  if (voice) {
    appState.elevenLabsVoiceId = voice;
    localStorage.setItem('elevenLabsVoiceId', voice);
  }
  if (persona) {
    appState.persona = persona;
    localStorage.setItem('gismoPersona', persona);
  }

  localStorage.setItem('gismoDisability', disability);
  localStorage.setItem('gismoMode', mode);
  localStorage.setItem('gismoSchool', school);
  localStorage.setItem('gismoRegNo', regNo);

  // If user is logged in, sync to backend and persist session
  if (appState.user && appState.user.id) {
    appState.user = {
      ...appState.user,
      disability,
      preferred_learning_mode: mode,
      school,
      reg_no: regNo
    };
    if (typeof persistUserSession === 'function') {
      persistUserSession(appState.user);
    }
    try {
      const res = await fetch(`/api/users/${appState.user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disability,
          preferred_learning_mode: mode,
          school,
          reg_no: regNo
        })
      });

      if (res.ok) {
        const updated = await res.json();
        appState.user = { ...appState.user, ...updated };
        if (typeof persistUserSession === 'function') {
          persistUserSession(appState.user);
        }
      }
    } catch (e) {
      console.warn("Could not save settings to server:", e);
    }
  }

  closeSettingsModal();
  loadStudentProfile();
  showToast("Preferences saved successfully!");
  playEarcon('success');
  announceTTS("Preferences saved.");
}

function getAppSvgIcon(name = 'check', size = 16) {
  const s = Number(size) || 16;
  const attrs = `width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0; vertical-align:middle;"`;
  const icons = {
    check: `<svg ${attrs} stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    close: `<svg ${attrs} stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    warning: `<svg ${attrs}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    info: `<svg ${attrs}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    mic: `<svg ${attrs}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`,
    speaker: `<svg ${attrs}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
    muted: `<svg ${attrs}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
    loading: `<svg ${attrs}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    book: `<svg ${attrs}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
    bot: `<svg ${attrs}><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path></svg>`,
    zap: `<svg ${attrs}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
    bulb: `<svg ${attrs}><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"></path></svg>`,
    shield: `<svg ${attrs}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
    next: `<svg ${attrs}><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>`,
    prev: `<svg ${attrs}><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>`,
    file: `<svg ${attrs}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    image: `<svg ${attrs}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
    music: `<svg ${attrs}><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`,
    download: `<svg ${attrs}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    award: `<svg ${attrs}><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`
  };
  return icons[name] || icons.check;
}

function showToast(message, icon = 'check') {
  const toast = document.getElementById('toast-feedback');
  if (!toast) return;
  const iconEl = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  if (iconEl) {
    iconEl.style.display = 'inline-flex';
    iconEl.style.alignItems = 'center';
    iconEl.innerHTML = getAppSvgIcon(icon, 16);
  }
  if (msgEl) msgEl.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

async function loadTutorModelInfo() {
  try {
    const res = await fetch('/api/tutor/info');
    if (res.ok) {
      const data = await res.json();
      const meta = document.getElementById('tutor-model-meta');
      if (meta && data.model) meta.textContent = data.model;
    }
  } catch (err) {
    console.warn("Tutor model info fetch error:", err);
  }
}

// --- Floating AI Tutor Logic & Draggable Capability ---
function toggleTutorExpand() {
  const panel = document.getElementById('tutor-panel') || document.querySelector('.tutor-panel');
  const btn = document.getElementById('btn-expand-tutor');
  if (!panel) return;
  const expanded = panel.classList.toggle('tutor-expanded');
  if (btn) btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
}

function sendQuickTutorPrompt(promptText) {
  const input = document.getElementById('chat-user-input');
  const sendBtn = document.getElementById('btn-chat-send');
  if (!input || !sendBtn) return;
  input.value = promptText;
  sendBtn.click();
}

function toggleTutorPanel() {
  const panel = document.getElementById('tutor-panel') || document.querySelector('.tutor-panel');
  const fab = document.getElementById('fab-tutor');
  if (!panel) return;

  panel.style.display = ''; // Clear inline display
  const isHidden = panel.classList.contains('hidden-floating');

  if (isHidden) {
    if (window.innerWidth <= 768) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.bottom = '';
      panel.style.right = '';
    } else {
      const rect = panel.getBoundingClientRect();
      if (rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
        panel.style.left = '';
        panel.style.top = '';
        panel.style.bottom = '';
        panel.style.right = '';
      }
    }
    panel.classList.remove('hidden-floating');
    panel.classList.add('tutor-open');
    if (fab) {
      fab.setAttribute('aria-expanded', 'true');
      fab.classList.add('tutor-open');
    }
    if (typeof playEarcon === 'function') playEarcon('click');
    setTimeout(() => {
      const input = document.getElementById('chat-user-input') || document.getElementById('chat-input');
      if (input) input.focus();
    }, 150);
  } else {
    panel.classList.add('hidden-floating');
    panel.classList.remove('tutor-open');
    if (fab) {
      fab.setAttribute('aria-expanded', 'false');
      fab.classList.remove('tutor-open');
    }
    if (typeof playEarcon === 'function') playEarcon('click');
  }
}

function openTutorPanel() {
  const panel = document.getElementById('tutor-panel') || document.querySelector('.tutor-panel');
  const fab = document.getElementById('fab-tutor');
  if (!panel) return;
  panel.style.display = '';
  if (window.innerWidth <= 768) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.right = '';
  }
  panel.classList.remove('hidden-floating');
  panel.classList.add('tutor-open');
  if (fab) {
    fab.setAttribute('aria-expanded', 'true');
    fab.classList.add('tutor-open');
  }
  if (typeof playEarcon === 'function') playEarcon('click');
  setTimeout(() => {
    const input = document.getElementById('chat-user-input') || document.getElementById('chat-input');
    if (input) input.focus();
  }, 150);
}

function closeTutorPanel() {
  const panel = document.getElementById('tutor-panel') || document.querySelector('.tutor-panel');
  const fab = document.getElementById('fab-tutor');
  if (!panel) return;
  panel.classList.add('hidden-floating');
  panel.classList.remove('tutor-open');
  if (fab) {
    fab.setAttribute('aria-expanded', 'false');
    fab.classList.remove('tutor-open');
  }
  if (typeof playEarcon === 'function') playEarcon('click');
}

function toggleFloatingTutor() {
  toggleTutorPanel();
}

// Expose functions globally for onclick attributes and external callers
window.toggleTutorPanel = toggleTutorPanel;
window.openTutorPanel = openTutorPanel;
window.closeTutorPanel = closeTutorPanel;
window.toggleFloatingTutor = toggleFloatingTutor;

function setupDraggableTutor() {
  const header = document.getElementById('tutor-header');
  const panel = document.getElementById('tutor-panel');
  if (!header || !panel) return;

  header.style.cursor = 'grab';

  let isDragging = false;
  let hasMoved = false;
  let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

  const onDragStart = (clientX, clientY) => {
    isDragging = true;
    hasMoved = false;
    startX = clientX;
    startY = clientY;
    const rect = panel.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
  };

  const onDragMove = (clientX, clientY) => {
    if (!isDragging) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (!hasMoved) {
      if (Math.hypot(dx, dy) < 4) return;
      hasMoved = true;
      header.style.cursor = 'grabbing';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      document.body.style.userSelect = 'none';
    }
    const maxLeft = Math.max(10, window.innerWidth - panel.offsetWidth - 10);
    const maxTop = Math.max(10, window.innerHeight - panel.offsetHeight - 10);
    panel.style.left = `${Math.min(maxLeft, Math.max(10, initialLeft + dx))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(10, initialTop + dy))}px`;
  };

  const onDragEnd = () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'grab';
      document.body.style.userSelect = '';
    }
  };

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
    onDragStart(e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', (e) => {
    onDragMove(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', onDragEnd);

  // Touch support for mobile dragging
  header.addEventListener('touchstart', (e) => {
    if (window.innerWidth <= 768) return;
    if (e.target.closest('button')) return;
    const touch = e.touches[0];
    onDragStart(touch.clientX, touch.clientY);
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging || !e.touches[0]) return;
    const touch = e.touches[0];
    onDragMove(touch.clientX, touch.clientY);
  }, { passive: true });

  document.addEventListener('touchend', onDragEnd);
}

// Automatically initialize tutor capabilities on script run
function initTutorCapabilities() {
  loadTutorModelInfo();
  setupDraggableTutor();
  setupTutorMuteSystem();
  initChatSessions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTutorCapabilities);
} else {
  initTutorCapabilities();
}
