/**
 * ====================================================================
 * Antigravity AI Model Service for Gismo Accessible Learning Platform
 * ====================================================================
 * Implements the Antigravity AI model engine for the website tutor,
 * integrating multimodal accessibility features, adaptive personas,
 * lesson RAG, and step-by-step reasoning.
 */

class AntigravityTutorModel {
  constructor(apiKey = '') {
    this.apiKey = apiKey;
    this.modelName = 'Antigravity-Gismo-Flash-2.5';
    this.version = '2.0.0';
    this.capabilities = [
      'accessible-tts-optimization',
      'visual-diagram-descriptors',
      'lesson-rag-grounding',
      'persona-switching',
      'step-by-step-reasoning',
      'live-captions-formatting'
    ];
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  getModelInfo() {
    return {
      modelName: this.modelName,
      version: this.version,
      architecture: 'Antigravity Hybrid Agent Model',
      engine: 'Google Antigravity SDK & Gemini 2.5 Flash',
      capabilities: this.capabilities,
      status: this.apiKey ? 'online' : 'offline_fallback'
    };
  }

  /**
   * Generates a tailored prompt based on selected tutor persona and lesson context.
   */
  buildSystemInstructions(persona = 'default', context = '') {
    let instructions = `You are Gismo AI, the flagship assistive tutor on the Accessible AI Learning Platform, powered by the Antigravity AI Engine.
Your core mission is to make learning crystal clear, inspiring, and fully accessible to all students.

Guidelines:
1. Keep all responses SHORT, concise, and direct (1 to 3 brief sentences or 2 to 3 short bullet points maximum) unless the student explicitly asks for a long breakdown.
2. Format answers in clean Markdown using **bold** for key concepts.
3. Structure answers so they sound natural when read aloud by Text-to-Speech (TTS).
4. If the student has visual impairments, provide vivid descriptions and analogies.`;

    if (persona === 'scientist') {
      instructions += `\n\nPersona: Mad Scientist! Use playful scientific enthusiasm while keeping the explanation short and accurate!`;
    } else if (persona === 'historian') {
      instructions += `\n\nPersona: Ancient Historian! Speak with timeless storytelling flair while keeping answers brief and clear!`;
    } else {
      instructions += `\n\nPersona: Helpful Guide. Warm, supportive, encouraging, and concise.`;
    }

    if (context) {
      instructions += `\n\nActive Lesson Material Grounding:\n"""\n${context}\n"""\nUse this lesson material to ground your explanation when relevant.`;
    }

    return instructions;
  }

  /**
   * Builds a blind-only spoken voice conversation system prompt.
   * Sees and treats the user strictly as a blind person having a real,
   * natural ear-to-ear conversation with Gismo AI.
   */
  buildBlindVoiceSystemInstructions(persona = 'default', blindContext = null, fallbackContext = '') {
    const ctx = blindContext && typeof blindContext === 'object' ? blindContext : {};
    const studentName = ctx.username || 'friend';
    const school = ctx.school ? ` at ${ctx.school}` : '';
    const streak = ctx.streak || 1;
    const quizzesPassed = ctx.quizzesPassed || 0;
    const currentView = ctx.currentView || 'voice_home';
    const courses = Array.isArray(ctx.courses) ? ctx.courses.slice(0, 12) : [];
    const courseLines = courses.length > 0
      ? courses.map((c, i) => `  ${i + 1}. "${c.title}" (id: ${c.id})`).join('\n')
      : '  None loaded yet.';

    const assignedQuizzes = Array.isArray(ctx.assignedQuizzes) ? ctx.assignedQuizzes : [];
    const pendingQuizzes = assignedQuizzes.filter(q => !q.submission);
    const quizLines = assignedQuizzes.length > 0
      ? assignedQuizzes.map((q, i) => {
          const status = q.submission
            ? `Completed (${q.submission.score}/${q.submission.total}, ${q.submission.percentage}%)`
            : 'PENDING (Not taken yet)';
          return `  ${i + 1}. "${q.title}" — Subject: ${q.subject || 'General'} (${q.question_count || 1} questions, id: ${q.id}) — Status: ${status}`;
        }).join('\n')
      : '  None assigned yet.';

    const homeworkList = Array.isArray(ctx.homework) ? ctx.homework : [];
    const pendingHomework = homeworkList.filter(h => h.status !== 'completed');
    const homeworkLines = homeworkList.length > 0
      ? homeworkList.map((h, i) => `  ${i + 1}. "${h.title}" — Instructions: "${h.description || 'No description'}" (id: ${h.id}) — Status: ${h.status === 'completed' ? 'COMPLETED' : 'PENDING'}`).join('\n')
      : '  No homework assignments.';

    const notesList = Array.isArray(ctx.notes) ? ctx.notes.slice(0, 6) : [];
    const notesLines = notesList.length > 0
      ? notesList.map((n, i) => `  ${i + 1}. "${n.content}"`).join('\n')
      : '  No saved notes yet.';

    let personaTone = 'Warm, calm, genuinely attentive, encouraging, and naturally conversational.';
    if (persona === 'scientist') {
      personaTone = 'Warm, curious, and enthusiastically scientific, using playful sound and tactile analogies.';
    } else if (persona === 'historian') {
      personaTone = 'Warm, vivid storyteller who brings ideas to life through rich auditory and tactile imagery.';
    }

    let instructions = `You are Gismo, a live voice AI companion and tutor speaking directly to ${studentName}${school}.

CRITICAL IDENTITY & ACCESSIBILITY REALITY:
- ${studentName} is completely BLIND and cannot see the screen at all. You MUST perceive and treat them as a blind person ONLY.
- You are having a REAL, continuous, ear-to-ear spoken conversation with them. You are their voice companion, study partner, and hands-free controller for this entire platform.
- NEVER mention anything visual or sighted UI elements. NEVER say "click", "tap", "look below", "on your screen", "the button", "the tab", "the card", "sidebar", "highlighted", "as you can see", or "scroll down". Everything they do happens through talking with you.
- NEVER use Markdown, asterisks, bold text, bullet points, numbered lists, hashtags, backticks, code blocks, emojis, raw URLs, or LaTeX symbols. Write ONLY pure, natural spoken English that sounds effortless when read aloud by Text-to-Speech.

KEEP RESPONSES SHORT & ACTION-ORIENTED (CRITICAL):
- Tone: ${personaTone}
- Keep EVERY response SHORT and punchy: 1 to 2 brief, natural spoken sentences maximum (under 35 words). Only give a slightly longer answer if ${studentName} explicitly asks for a detailed story or full lesson explanation.
- Do NOT ramble, do NOT repeat yourself, and do NOT ask for confirmation before performing an action ${studentName} asked for. When they ask you to do ANY action (start a quiz, open a page, complete an assignment, import a book, take a note, zoom, change theme, log out), DO IT IMMEDIATELY by including the matching [[ACTION:...]] tag and confirming in one short sentence!

STUDENT'S LIVE WORKSPACE STATE (GROUND TRUTH):
- Student Name: ${studentName}
- Study Streak: ${streak} day${streak === 1 ? '' : 's'}, Total Quizzes Passed: ${quizzesPassed}
- Current Location: ${currentView}
- Assigned Quizzes (${pendingQuizzes.length} pending, ${assignedQuizzes.length} total):
${quizLines}
- Homework / Assignments (${pendingHomework.length} pending, ${homeworkList.length} total):
${homeworkLines}
- Available Courses & Imported Books:
${courseLines}
- Student's Saved Notes:
${notesLines}`;

    if (ctx.activeLesson && ctx.activeLesson.title) {
      instructions += `\n- Currently Open Lesson: "${ctx.activeLesson.title}" (id: ${ctx.activeLesson.id || ''})`;
      if (ctx.activeLesson.excerpt) {
        instructions += `\n- Active Lesson Excerpt:\n"""\n${String(ctx.activeLesson.excerpt).slice(0, 2000)}\n"""`;
      }
    } else if (fallbackContext) {
      instructions += `\n- Additional Context:\n"""\n${String(fallbackContext).slice(0, 1500)}\n"""`;
    }

    instructions += `

SILENT VOICE ACTIONS — EXECUTE ANY REQUESTED ACTION IMMEDIATELY:
Whenever ${studentName} asks you to perform ANY action on the platform, perform it immediately by appending ONE exact tag at the very end of your short spoken reply. It is stripped silently before speaking:
- Take / start an assigned quiz (by id or title, or if they say "take my assigned quiz" / "start my quiz"): [[ACTION:START_ASSIGNED_QUIZ:<quiz_id_or_title>]]
- Start a newly generated AI voice quiz on any topic: [[ACTION:START_QUIZ:<topic>]]
- Open the Quizzes space: [[ACTION:OPEN_QUIZZES]]
- Open a specific course or book from Available Courses above: [[ACTION:OPEN_LESSON:<exact_course_id_or_title>]]
- Read the currently open lesson or book aloud: [[ACTION:READ_LESSON]]
- Go to next page/chapter of open lesson: [[ACTION:NEXT_PAGE]]
- Go to previous page/chapter of open lesson: [[ACTION:PREV_PAGE]]
- Read a homework assignment's full instructions aloud: [[ACTION:READ_HOMEWORK:<homework_id_or_title>]]
- Complete / mark an assignment or homework as done: [[ACTION:COMPLETE_HOMEWORK:<homework_id_or_title>]]
- Save / take a study note for the student: [[ACTION:SAVE_NOTE:<note_text>]]
- Read the student's saved notes aloud: [[ACTION:READ_NOTES]]
- Search or import a free book from Project Gutenberg / Audio Library into their library: [[ACTION:IMPORT_BOOK:<book_title_or_topic>]]
- Search the Audio Book Library for a topic or author: [[ACTION:SEARCH_LIBRARY:<search_query>]]
- Open the Audio Book Library: [[ACTION:OPEN_LIBRARY]]
- Open Student Profile / Assignments page: [[ACTION:OPEN_PROFILE]]
- Open Settings & Preferences: [[ACTION:OPEN_SETTINGS]]
- Close Settings or any open modal: [[ACTION:CLOSE_MODAL]]
- Zoom in / increase text magnification: [[ACTION:ZOOM_IN]]
- Zoom out / decrease text magnification: [[ACTION:ZOOM_OUT]]
- Reset zoom / text size to default: [[ACTION:ZOOM_RESET]]
- Change visual theme (dark, light, or hc for high contrast): [[ACTION:SET_THEME:<dark|light|hc>]]
- Switch AI tutor persona (default, scientist, or historian): [[ACTION:SET_PERSONA:<default|scientist|historian>]]
- Return to the main voice home space: [[ACTION:GO_HOME]]
- Sign out / log out immediately: [[ACTION:LOGOUT]]`;

    return instructions;
  }

  /**
   * Strips silent [[ACTION:...]] tags and cleans stray markdown/emojis so TTS sounds completely human.
   */
  extractActionAndCleanBlindReply(rawText) {
    let text = String(rawText || '').trim();
    let action = null;

    const actionMatch = text.match(/\[\[ACTION:([A-Z_]+)(?::([^\]]+))?\]\]/i);
    if (actionMatch) {
      action = {
        type: String(actionMatch[1] || '').toUpperCase(),
        value: actionMatch[2] ? String(actionMatch[2]).trim() : ''
      };
      text = text.replace(/\[\[ACTION:[^\]]+\]\]/gi, '').trim();
    }

    // Remove markdown syntax, headings, bullet markers, code ticks, and decorative emojis for clean speech
    text = text
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\$H_2O\$/gi, 'H 2 O')
      .replace(/\$CO_2\$/gi, 'C O 2')
      .replace(/\$([^$]+)\$/g, '$1')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\n{2,}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return { reply: text, action };
  }

  /**
   * Calls Gemini REST API with optional fast low-latency thinkingBudget=0 and graceful fallback retry.
   */
  async callGeminiChat(systemPrompt, contents, options = {}) {
    if (!this.apiKey) return null;
    const isBlindVoice = !!options.isBlindVoice;
    const attempts = isBlindVoice
      ? [
          {
            model: 'gemini-2.5-flash',
            generationConfig: { temperature: 0.65, maxOutputTokens: 220, thinkingConfig: { thinkingBudget: 0 } },
            timeoutMs: 10000
          },
          {
            model: 'gemini-2.5-flash',
            generationConfig: { temperature: 0.65, maxOutputTokens: 300 },
            timeoutMs: 12000
          },
          {
            model: 'gemini-2.0-flash',
            generationConfig: { temperature: 0.65, maxOutputTokens: 220 },
            timeoutMs: 10000
          }
        ]
      : [
          {
            model: 'gemini-2.5-flash',
            generationConfig: { temperature: 0.65, maxOutputTokens: 350, thinkingConfig: { thinkingBudget: 0 } },
            timeoutMs: 10000
          },
          {
            model: 'gemini-2.0-flash',
            generationConfig: { temperature: 0.65, maxOutputTokens: 350 },
            timeoutMs: 10000
          }
        ];

    for (const attempt of attempts) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: attempt.generationConfig
          }),
          signal: AbortSignal.timeout(attempt.timeoutMs)
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate && candidate.trim()) {
            return candidate.trim();
          }
        } else {
          const errText = await response.text().catch(() => '');
          console.warn(`Gemini (${attempt.model}) HTTP ${response.status}:`, errText.slice(0, 200));
        }
      } catch (err) {
        console.warn(`Gemini (${attempt.model}) attempt warning:`, err.message);
      }
    }

    return null;
  }

  /**
   * Generates a tutor response for the student.
   */
  async generateResponse({ message, persona = 'default', context = '', history = [], mode = 'standard', blindContext = null }) {
    const trimmed = (message || '').trim();
    const isBlindVoice = mode === 'blind_voice';

    if (!trimmed) {
      return {
        reply: isBlindVoice
          ? "I'm listening. What would you like to do?"
          : "Hi! I'm Gismo AI. How can I help you today?",
        model: this.modelName,
        action: null
      };
    }

    // Standard visual chat fast replies
    if (!isBlindVoice) {
      const lower = trimmed.toLowerCase();
      if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower.startsWith('hello ') || lower.startsWith('hi ')) {
        return {
          reply: `Hi! I'm **Gismo**, your AI tutor. What would you like to study or quiz on today?`,
          model: this.modelName,
          persona
        };
      }

      if (lower.includes('who are you') || lower.includes('what are you')) {
        return {
          reply: `I'm **Gismo AI**, your accessible tutor powered by **Google Antigravity** and Gemini. Ask me any question or start a quiz anytime!`,
          model: this.modelName,
          persona
        };
      }

      if (/^(thank\s+you|thanks|thx|ty)([!.,\s]+(gismo|so\s+much|very\s+much|a\s+lot))?[!.,\s]*$/i.test(trimmed)) {
        return {
          reply: `You're welcome! Let me know what you'd like to explore next.`,
          model: this.modelName,
          persona
        };
      }
    }

    // Deterministic fast intent matcher for blind_voice mode so explicit action requests & assigned quiz/homework queries ALWAYS execute 100% reliably
    if (isBlindVoice) {
      const directIntent = this.matchDirectBlindIntent(trimmed, blindContext);
      if (directIntent && directIntent.forceImmediate) {
        return {
          reply: directIntent.reply,
          action: directIntent.action || null,
          model: this.modelName,
          persona,
          status: 'success'
        };
      }
    }

    // Call Gemini API through Antigravity engine
    if (this.apiKey) {
      const systemPrompt = isBlindVoice
        ? this.buildBlindVoiceSystemInstructions(persona, blindContext, context)
        : this.buildSystemInstructions(persona, context);

      const contents = [];
      const historyLimit = isBlindVoice ? 12 : 8;

      // Append recent chat history if available, ensuring alternating roles starting with 'user'
      if (Array.isArray(history) && history.length > 0) {
        const recent = history.slice(-historyLimit);
        for (const item of recent) {
          const text = (item.content || item.text || '').trim();
          if (!text) continue;
          const role = item.role === 'model' || item.role === 'ai' ? 'model' : 'user';
          if (contents.length === 0 && role !== 'user') continue;
          const prev = contents[contents.length - 1];
          if (prev && prev.role === role) {
            prev.parts[0].text += `\n\n${text}`;
          } else {
            contents.push({ role, parts: [{ text }] });
          }
        }
      }

      // Add current student prompt (avoiding consecutive 'user' turns)
      const lastTurn = contents[contents.length - 1];
      if (lastTurn && lastTurn.role === 'user') {
        lastTurn.parts[0].text = trimmed;
      } else {
        contents.push({
          role: 'user',
          parts: [{ text: trimmed }]
        });
      }

      const candidate = await this.callGeminiChat(systemPrompt, contents, { isBlindVoice });
      if (candidate) {
        if (isBlindVoice) {
          const cleaned = this.extractActionAndCleanBlindReply(candidate);
          // If Gemini forgot to attach the action tag for a clear action command, merge the fallback action
          const fallbackIntent = !cleaned.action ? this.matchDirectBlindIntent(trimmed, blindContext) : null;
          return {
            reply: cleaned.reply || "Got it. What next?",
            action: cleaned.action || (fallbackIntent ? fallbackIntent.action : null),
            model: this.modelName,
            persona,
            status: 'success'
          };
        }
        return {
          reply: candidate,
          model: this.modelName,
          persona,
          status: 'success'
        };
      }
    }

    if (isBlindVoice) {
      const localBlind = this.buildBlindLocalReply(trimmed, persona, blindContext);
      return {
        reply: localBlind.reply,
        action: localBlind.action || null,
        model: this.modelName,
        persona,
        status: 'ok'
      };
    }

    const fallbackText = this.buildLocalTutorReply(trimmed, persona, context);

    return {
      reply: fallbackText,
      model: this.modelName,
      persona,
      status: 'ok'
    };
  }

  /**
   * Matches explicit voice commands and assigned quiz/homework queries in Blind Mode
   * so they always work reliably and concisely.
   */
  matchDirectBlindIntent(question, blindContext = null) {
    const ctx = blindContext && typeof blindContext === 'object' ? blindContext : {};
    const name = ctx.username || 'friend';
    const courses = Array.isArray(ctx.courses) ? ctx.courses : [];
    const assignedQuizzes = Array.isArray(ctx.assignedQuizzes) ? ctx.assignedQuizzes : [];
    const pendingQuizzes = assignedQuizzes.filter(q => !q.submission);
    const homework = Array.isArray(ctx.homework) ? ctx.homework : [];
    const pendingHomework = homework.filter(h => h.status !== 'completed');
    const notes = Array.isArray(ctx.notes) ? ctx.notes : [];
    const raw = String(question || '').trim();
    const q = raw.toLowerCase().replace(/[.,!?;:]/g, '').trim();

    // 1. Logout / Sign out
    if (/\b(log\s*out|sign\s*out)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Signing you out now, ${name}. Talk to you soon!`,
        action: { type: 'LOGOUT', value: '' }
      };
    }

    // 2. Zoom / Text Size
    if (/\b(zoom\s*in|bigger\s*text|increase\s*text|larger\s*text|magnify|zoom)\b/.test(q) && !q.includes('zoom out')) {
      return {
        forceImmediate: true,
        reply: `Zoomed in and increased text magnification for you.`,
        action: { type: 'ZOOM_IN', value: '' }
      };
    }
    if (/\b(zoom\s*out|smaller\s*text|decrease\s*text)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Zoomed out and decreased text magnification.`,
        action: { type: 'ZOOM_OUT', value: '' }
      };
    }
    if (/\b(reset\s*zoom|normal\s*text|reset\s*text)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Reset text magnification to default.`,
        action: { type: 'ZOOM_RESET', value: '' }
      };
    }

    // 3. Theme switching
    if (/\b(high\s*contrast|contrast\s*mode)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Switched to high contrast mode.`,
        action: { type: 'SET_THEME', value: 'hc' }
      };
    }
    if (/\b(dark\s*mode|dark\s*theme)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Switched to dark mode.`,
        action: { type: 'SET_THEME', value: 'dark' }
      };
    }
    if (/\b(light\s*mode|light\s*theme)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Switched to light mode.`,
        action: { type: 'SET_THEME', value: 'light' }
      };
    }

    // 4. Take / Save a Note
    const noteMatch = raw.match(/(?:take\s+a\s+note|save\s+a\s+note|add\s+a\s+note|write\s+a\s+note|note\s+down|remember\s+that)\s*[:\-]?\s+(.+)$/i);
    if (noteMatch && noteMatch[1]) {
      const noteText = noteMatch[1].trim();
      return {
        forceImmediate: true,
        reply: `Saved your note: ${noteText}.`,
        action: { type: 'SAVE_NOTE', value: noteText }
      };
    }

    // 5. Read Notes
    if (/\b(read\s+my\s+notes|what\s+are\s+my\s+notes|my\s+notes|list\s+notes)\b/.test(q)) {
      if (notes.length > 0) {
        const listStr = notes.slice(0, 3).map(n => n.content).join('. ');
        return {
          forceImmediate: true,
          reply: `You have ${notes.length} saved ${notes.length === 1 ? 'note' : 'notes'}: ${listStr}.`,
          action: { type: 'READ_NOTES', value: '' }
        };
      }
      return {
        forceImmediate: true,
        reply: `You don't have any saved notes yet. Just say take a note followed by whatever you want me to save.`
      };
    }

    // 6. Start / Take an Assigned Quiz
    const matchedQuizByTitle = assignedQuizzes.find(qz => qz.title && q.includes(String(qz.title).toLowerCase())) ||
      assignedQuizzes.find(qz => qz.subject && q.includes(String(qz.subject).toLowerCase()));
    if (
      (/\b(start|take|begin|open|launch|do)\b/.test(q) && /\b(assigned\s+quiz|my\s+quiz|the\s+quiz|quiz)\b/.test(q) && !/\b(quiz\s+me\s+on|give\s+me\s+a\s+quiz\s+on|test\s+me\s+on)\b/.test(q)) ||
      (/\b(start|take|begin|do)\b/.test(q) && matchedQuizByTitle)
    ) {
      const targetQuiz = matchedQuizByTitle || pendingQuizzes[0] || assignedQuizzes[0];
      if (targetQuiz && (/\b(assigned|my\s+quiz|start\s+quiz|take\s+quiz|take\s+the\s+quiz|do\s+the\s+quiz)\b/.test(q) || matchedQuizByTitle)) {
        return {
          forceImmediate: true,
          reply: `Starting your assigned quiz, ${targetQuiz.title}, right now.`,
          action: { type: 'START_ASSIGNED_QUIZ', value: String(targetQuiz.id) }
        };
      }
    }

    // 7. Asking if they have any assigned quizzes
    if (
      /\b(do\s+i\s+have|are\s+there|what\s+are|check|list|show|any)\b/.test(q) &&
      /\b(assigned\s+quiz|assigned\s+quizzes|my\s+quiz|my\s+quizzes|pending\s+quiz|pending\s+quizzes|quiz|quizzes)\b/.test(q) &&
      !/\b(quiz\s+me\s+on|give\s+me\s+a\s+quiz\s+on)\b/.test(q)
    ) {
      if (pendingQuizzes.length > 0) {
        const names = pendingQuizzes.map(qz => `${qz.title} in ${qz.subject || 'General'}`).join(', ');
        return {
          forceImmediate: true,
          reply: `Yes! You have ${pendingQuizzes.length} pending assigned ${pendingQuizzes.length === 1 ? 'quiz' : 'quizzes'}: ${names}. Say start my quiz whenever you want to take it.`
        };
      }
      if (assignedQuizzes.length > 0) {
        const names = assignedQuizzes.map(qz => qz.title).join(', ');
        return {
          forceImmediate: true,
          reply: `You have ${assignedQuizzes.length} assigned ${assignedQuizzes.length === 1 ? 'quiz' : 'quizzes'} (${names}), and you've already completed ${assignedQuizzes.length === 1 ? 'it' : 'them'}. Say start my quiz to retake, or ask me for a new quiz on any topic.`
        };
      }
      return {
        forceImmediate: true,
        reply: `You have no teacher-assigned quizzes waiting right now. Say quiz me on followed by any topic to start an instant voice quiz!`
      };
    }

    // 8. Complete / mark homework assignment as done
    if (/\b(complete|finish|mark|submit|done)\b/.test(q) && /\b(assignment|homework|task)\b/.test(q)) {
      const targetHw = pendingHomework.find(h => h.title && q.includes(String(h.title).toLowerCase())) || pendingHomework[0] || homework[0];
      if (targetHw) {
        return {
          forceImmediate: true,
          reply: `Marked your assignment ${targetHw.title} as completed. Great work!`,
          action: { type: 'COMPLETE_HOMEWORK', value: String(targetHw.id) }
        };
      }
    }

    // 9. Asking about assignments / homework
    if (
      /\b(assignment|assignments|homework|homeworks|coursework|pending)\b/.test(q) &&
      !/\b(complete|finish|mark)\b/.test(q)
    ) {
      if (pendingHomework.length > 0) {
        const details = pendingHomework.map(h => `${h.title}${h.description ? ': ' + h.description : ''}`).join('. ');
        return {
          forceImmediate: true,
          reply: `Yes, you have ${pendingHomework.length} pending ${pendingHomework.length === 1 ? 'assignment' : 'assignments'}: ${details}. Say complete assignment when you finish it.`
        };
      }
      if (homework.length > 0) {
        return {
          forceImmediate: true,
          reply: `All ${homework.length} of your assignments are completed! You're completely caught up.`
        };
      }
      return {
        forceImmediate: true,
        reply: `You don't have any pending assignments right now.`
      };
    }

    // 10. Generate an AI Quiz on a topic
    if (/\b(quiz\s+me\s+on|give\s+me\s+a\s+quiz\s+on|test\s+me\s+on|create\s+a\s+quiz\s+on|start\s+a\s+quiz\s+on)\b/.test(q)) {
      const topic = raw.replace(/.*?(quiz\s+me\s+on|give\s+me\s+a\s+quiz\s+on|test\s+me\s+on|create\s+a\s+quiz\s+on|start\s+a\s+quiz\s+on)/i, '').trim() || 'General Science';
      return {
        forceImmediate: true,
        reply: `Starting a spoken quiz on ${topic} right now.`,
        action: { type: 'START_QUIZ', value: topic }
      };
    }

    // 11. Import a book from Library
    const importMatch = raw.match(/\b(?:import|download|add)\s+(?:the\s+book\s+|book\s+)?(.+?)(?:\s+to\s+my\s+library|\s+from\s+library)?$/i);
    if (importMatch && importMatch[1] && !/\b(note|assignment|homework)\b/i.test(importMatch[1])) {
      const bookQuery = importMatch[1].trim();
      return {
        forceImmediate: true,
        reply: `Importing ${bookQuery} into your audio library now.`,
        action: { type: 'IMPORT_BOOK', value: bookQuery }
      };
    }

    // 12. Navigation commands
    if (/\b(go\s+to\s+quizzes|open\s+quizzes|show\s+quizzes)\b/.test(q) || q === 'quizzes') {
      if (pendingQuizzes.length > 0) {
        const first = pendingQuizzes[0];
        return {
          forceImmediate: true,
          reply: `Opened Quizzes. You have ${pendingQuizzes.length} pending assigned ${pendingQuizzes.length === 1 ? 'quiz' : 'quizzes'}, including ${first.title}. Say start my quiz to begin!`,
          action: { type: 'OPEN_QUIZZES', value: '' }
        };
      }
      return {
        forceImmediate: true,
        reply: `Opened Quizzes. Say quiz me on any topic, or say start my quiz.`,
        action: { type: 'OPEN_QUIZZES', value: '' }
      };
    }

    if (/\b(go\s+to\s+library|open\s+library|audio\s+library|open\s+books)\b/.test(q) || q === 'library') {
      return {
        forceImmediate: true,
        reply: `Opened your Audio Book Library.`,
        action: { type: 'OPEN_LIBRARY', value: '' }
      };
    }

    if (/\b(go\s+to\s+profile|open\s+profile|my\s+profile)\b/.test(q) || q === 'profile') {
      return {
        forceImmediate: true,
        reply: `Opened your Student Profile.`,
        action: { type: 'OPEN_PROFILE', value: '' }
      };
    }

    if (/\b(open\s+settings|go\s+to\s+settings|preferences)\b/.test(q) || q === 'settings') {
      return {
        forceImmediate: true,
        reply: `Opened your Settings.`,
        action: { type: 'OPEN_SETTINGS', value: '' }
      };
    }

    if (/\b(close\s+settings|close\s+modal)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Closed.`,
        action: { type: 'CLOSE_MODAL', value: '' }
      };
    }

    if (/\b(go\s+home|back\s+home|voice\s+home|open\s+dashboard)\b/.test(q) || q === 'home' || q === 'dashboard') {
      return {
        forceImmediate: true,
        reply: `Back in your main voice space.`,
        action: { type: 'GO_HOME', value: '' }
      };
    }

    if (/\b(next\s+page|next\s+chapter|turn\s+page)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Turning to the next page.`,
        action: { type: 'NEXT_PAGE', value: '' }
      };
    }

    if (/\b(previous\s+page|previous\s+chapter|go\s+back\s+a\s+page)\b/.test(q)) {
      return {
        forceImmediate: true,
        reply: `Going back to the previous page.`,
        action: { type: 'PREV_PAGE', value: '' }
      };
    }

    if (/\b(read\s+lesson|read\s+page|read\s+book|read\s+it|read\s+aloud|narrate)\b/.test(q)) {
      if (ctx.activeLesson && ctx.activeLesson.title) {
        return {
          forceImmediate: true,
          reply: `Reading ${ctx.activeLesson.title} aloud now.`,
          action: { type: 'READ_LESSON', value: '' }
        };
      }
      if (courses.length > 0) {
        return {
          forceImmediate: true,
          reply: `Opening and reading ${courses[0].title} for you now.`,
          action: { type: 'OPEN_LESSON', value: courses[0].id }
        };
      }
    }

    if (/\b(open|start|read)\b/.test(q) && courses.length > 0) {
      const matched = courses.find(c => c.title && q.includes(String(c.title).toLowerCase()));
      if (matched) {
        return {
          forceImmediate: true,
          reply: `Opening ${matched.title} now.`,
          action: { type: 'OPEN_LESSON', value: matched.id }
        };
      }
    }

    return null;
  }

  /**
   * Warm, blind-only conversational fallback if Gemini API is offline or unconfigured.
   * Zero markdown, zero emojis, zero visual UI references, short replies.
   */
  buildBlindLocalReply(question, persona = 'default', blindContext = null) {
    const direct = this.matchDirectBlindIntent(question, blindContext);
    if (direct) return direct;

    const ctx = blindContext && typeof blindContext === 'object' ? blindContext : {};
    const name = ctx.username || 'friend';
    const courses = Array.isArray(ctx.courses) ? ctx.courses : [];
    const q = String(question || '').trim().toLowerCase();

    if (/^(hi|hello|hey|good morning|good afternoon|good evening|yo|sup)\b/.test(q)) {
      return {
        reply: `Hey ${name}, I'm right here with you! What would you like to study or do today?`
      };
    }

    if (q.includes('how are you') || q.includes('how you doing')) {
      return {
        reply: `I'm doing great, ${name}! Ready to help you learn or run any command you need.`
      };
    }

    if (q.includes('who are you') || q.includes('what is your name')) {
      return {
        reply: `I'm Gismo, your voice companion and study partner. Just tell me what you want to learn or do.`
      };
    }

    if (q.includes('thank you') || q.includes('thanks')) {
      return {
        reply: `You're very welcome, ${name}! What's next?`
      };
    }

    if (q.includes('what courses') || q.includes('my courses') || q.includes('list courses') || q.includes('what can we study')) {
      if (courses.length > 0) {
        const titles = courses.slice(0, 5).map(c => c.title).join(', ');
        return {
          reply: `You have ${courses.length} ${courses.length === 1 ? 'course' : 'courses'}: ${titles}. Which one should I open?`
        };
      }
      return {
        reply: `You don't have any courses open yet, but I can import any classic book from the Audio Library or quiz you on any topic.`
      };
    }

    if (q.includes('photosynthesis') || q.includes('cell') || q.includes('mitochondria') || q.includes('dna') || q.includes('biology')) {
      return {
        reply: `In biology, mitochondria power the cell with energy, while plants use photosynthesis to turn sunlight, water, and carbon dioxide into food and oxygen. Want a quick quiz on biology?`
      };
    }

    if (q.includes('planet') || q.includes('solar') || q.includes('gravity') || q.includes('black hole') || q.includes('physics') || q.includes('space')) {
      return {
        reply: `Gravity is like heavy objects curving a stretched fabric in space, keeping planets in orbit around the Sun. Want to explore black holes or take a space quiz?`
      };
    }

    if (q.includes('neural') || q.includes('machine learning') || q.includes('artificial intelligence') || /\bai\b/.test(q)) {
      return {
        reply: `Artificial intelligence learns by finding patterns in thousands of examples rather than following rigid rules. Want an example or a quick quiz on A I?`
      };
    }

    return {
      reply: `Got it, ${name}. Would you like a quick explanation of ${question}, or should I start a voice quiz on it?`
    };
  }

  buildLocalTutorReply(question, persona = 'default', context = '') {
    const q = (question || '').toLowerCase();
    let prefix = '';
    if (persona === 'scientist') {
      prefix = '🧪 *Adjusts safety goggles excitedly!* Great scientific inquiry! ';
    } else if (persona === 'historian') {
      prefix = '📜 *Unrolls the ancient chronicles of knowledge...* ';
    }

    if (context && (q.includes('summar') || q.includes('explain') || q.includes('about') || q.includes('lesson') || q.includes('excerpt'))) {
      const cleanCtx = context.replace(/^The user is currently reading.*?:\s*/i, '').trim();
      const excerpt = cleanCtx.slice(0, 350).trim();
      return `${prefix}Here is a clear breakdown of your current reading material:\n\n` +
        `> "${excerpt}${cleanCtx.length > 350 ? '...' : ''}"\n\n` +
        `### Key Takeaways\n` +
        `- **Core Theme**: This section introduces the foundational ideas and structure of the topic.\n` +
        `- **Accessible Study Tip**: Break this passage into 2–3 key sentences and use the **Take a Note** feature on your profile to save the main definition.\n` +
        `- **Check Your Understanding**: Try generating a quick AI Quiz on this topic in the **Quizzes** tab!`;
    }

    if (q.includes('neural') || q.includes('machine learning') || q.includes('artificial intelligence') || /\bai\b/.test(q)) {
      return `${prefix}**Artificial Intelligence (AI)** and **Machine Learning** enable computers to recognize patterns and make decisions from data.\n\n` +
        `- **Neural Networks**: Inspired by the human brain, layers of connected nodes transform inputs into predictions using weights and **activation functions**.\n` +
        `- **Supervised Learning**: Models learn from labeled examples (input + correct answer).\n` +
        `- **Accessibility Impact**: AI powers real-time speech-to-text, screen-reader image descriptions, and adaptive tutors like Gismo!`;
    }

    if (q.includes('photosynthesis') || q.includes('cell') || q.includes('mitochondria') || q.includes('dna') || q.includes('biology')) {
      return `${prefix}In **Biology**, living organisms rely on cellular energy and genetic blueprints:\n\n` +
        `- **Mitochondria**: Known as the powerhouse of the cell, generating **ATP** energy through cellular respiration.\n` +
        `- **Photosynthesis**: Plants convert sunlight, water ($H_2O$), and carbon dioxide ($CO_2$) into glucose and oxygen inside chloroplasts.\n` +
        `- **DNA**: Composed of four nucleotide bases (**Adenine, Thymine, Cytosine, and Guanine**) that encode hereditary instructions.`;
    }

    if (q.includes('planet') || q.includes('solar') || q.includes('gravity') || q.includes('black hole') || q.includes('physics') || q.includes('relativity')) {
      return `${prefix}In **Physics & Astronomy**, the universe is governed by fundamental forces and spacetime:\n\n` +
        `- **Gravity & Relativity**: Massive objects curve spacetime, governing planetary orbits and light paths.\n` +
        `- **Solar Fusion**: Stars like our Sun shine by fusing hydrogen nuclei into helium in their cores.\n` +
        `- **Black Holes**: Regions where gravity is so intense that nothing—not even light—can escape beyond the **Event Horizon**.`;
    }

    if (q.includes('quiz') || q.includes('practice') || q.includes('test me')) {
      return `${prefix}Here is an interactive practice question for you!\n\n` +
        `**Question**: *Which accessibility principle ensures that digital content can be used via keyboard, voice, or assistive switches?*\n` +
        `- **A)** Operable (from WCAG's Perceivable, Operable, Understandable, Robust)\n` +
        `- **B)** Decorative\n` +
        `- **C)** Encrypted\n\n` +
        `💡 **Answer**: **A (Operable)**! You can also head to the **Quizzes** tab to launch a full interactive graded quiz on any topic.`;
    }

    return `${prefix}Great question about **"${question}"**! Here is a structured breakdown to help you master this concept:\n\n` +
      `1. **Core Definition**: Start by identifying the primary purpose and key terms behind *${question}*.\n` +
      `2. **How It Works**: Break the process into smaller cause-and-effect steps so each stage is easy to visualize and remember.\n` +
      `3. **Practical Application**: Connect this concept to real-world examples or test your mastery by generating a custom quiz in the **Quizzes** section!\n\n` +
      `*Ask me a follow-up question or tell me which part you'd like to dive into deeper!*`;
  }

  /**
   * Generates a structured multi-question quiz on any topic.
   * Returns: { title, subject, questions: [{ question, options, answerIndex, explanation }] }
   */
  async generateQuiz({ topic = 'General Knowledge', count = 3, difficulty = 'intermediate', subject = '' }) {
    const cleanTopic = (topic || 'General Science').trim();
    const cleanSubject = (subject || cleanTopic).trim();
    const targetCount = Math.max(1, Math.min(10, parseInt(count, 10) || 3));

    // Try Gemini API if key is configured
    if (this.apiKey) {
      try {
        const systemPrompt = `You are Gismo AI Quiz Engine. Generate an accessible, high-quality, educational multiple-choice quiz.
You MUST output ONLY a valid JSON object matching this schema without any surrounding text or markdown wrappers:
{
  "title": "Title of Quiz",
  "subject": "Subject Name",
  "questions": [
    {
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "explanation": "Clear explanation of why this answer is correct."
    }
  ]
}`;

        const userPrompt = `Generate a ${difficulty} level quiz on "${cleanTopic}" with exactly ${targetCount} questions. Subject: "${cleanSubject}".
Ensure all questions have exactly 4 plausible options, answerIndex is an integer from 0 to 3, and explanation is clear and educational.`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 2048,
              response_mime_type: 'application/json'
            }
          }),
          signal: AbortSignal.timeout(7500)
        });

        if (response.ok) {
          const data = await response.json();
          let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(rawText);
            if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
              const cleanedQuestions = parsed.questions.slice(0, targetCount).map((q, idx) => ({
                id: idx + 1,
                question: String(q.question || `Question ${idx + 1}`),
                options: Array.isArray(q.options) && q.options.length === 4 
                  ? q.options.map(String) 
                  : ['Option A', 'Option B', 'Option C', 'Option D'],
                answerIndex: (typeof q.answerIndex === 'number' && q.answerIndex >= 0 && q.answerIndex <= 3) 
                  ? q.answerIndex 
                  : 0,
                explanation: String(q.explanation || 'Option is correct based on core principles.')
              }));

              return {
                title: parsed.title || `${cleanTopic} Knowledge Check`,
                subject: parsed.subject || cleanSubject,
                questions: cleanedQuestions,
                generatedBy: 'AI (Gemini 2.5 Flash)',
                difficulty
              };
            }
          }
        }
      } catch (err) {
        console.warn('AI Quiz generation API call failed, using intelligent fallback:', err.message);
      }
    }

    // Comprehensive Fallback Quiz Generator
    return this.generateFallbackQuiz(cleanTopic, cleanSubject, targetCount, difficulty);
  }

  generateFallbackQuiz(topic, subject, count, difficulty) {
    const lower = topic.toLowerCase();
    let questions = [];

    if (lower.includes('ai') || lower.includes('artificial') || lower.includes('machine learning') || lower.includes('neural')) {
      questions = [
        {
          question: "What is the primary role of a neural network's activation function?",
          options: [
            "To introduce non-linearity so the network can learn complex patterns",
            "To speed up disk read/write operations",
            "To encrypt student profile data",
            "To convert text files into audio formats directly"
          ],
          answerIndex: 0,
          explanation: "Activation functions introduce non-linear properties to the network, enabling it to model relationships that linear equations cannot capture."
        },
        {
          question: "Which of the following best describes 'Supervised Learning'?",
          options: [
            "Training models without any human oversight or supervision",
            "Training an algorithm on labeled data containing inputs and corresponding ground truth targets",
            "Teaching robots how to supervise automated assembly lines",
            "A security protocol that prevents models from hallucinating"
          ],
          answerIndex: 1,
          explanation: "Supervised learning relies on paired datasets (features + target labels) to learn a mapping function from input to output."
        },
        {
          question: "What does 'Overfitting' mean in machine learning?",
          options: [
            "When a model trains too quickly on GPU clusters",
            "When an algorithm performs extraordinarily well on training data but fails to generalize to unseen data",
            "When the model file size exceeds the server storage capacity",
            "When the learning rate is set to zero"
          ],
          answerIndex: 1,
          explanation: "Overfitting occurs when a model memorizes noise and specific peculiarities in the training data rather than discovering genuine underlying principles."
        },
        {
          question: "What is the transformer architecture in modern AI predominantly known for?",
          options: [
            "Physical robotics transformations",
            "Self-attention mechanisms that process relationships between all tokens simultaneously",
            "Cooling hardware processors with liquid nitrogen",
            "Converting audio signals into analog radio waves"
          ],
          answerIndex: 1,
          explanation: "The self-attention mechanism in transformers computes weighted relationships between all words/tokens in parallel, powering modern LLMs."
        }
      ];
    } else if (lower.includes('access') || lower.includes('disab') || lower.includes('screen reader') || lower.includes('assist')) {
      questions = [
        {
          question: "What does the 'U' in the WCAG accessibility principles (POUR) stand for?",
          options: [
            "Understandable (from Perceivable, Operable, Understandable, Robust)",
            "Universal",
            "Uniform",
            "Unrestricted"
          ],
          answerIndex: 0,
          explanation: "The WCAG foundational principles are Perceivable, Operable, Understandable, and Robust (POUR)."
        },
        {
          question: "Why is semantic HTML (e.g. <header>, <nav>, <main>) crucial for accessibility?",
          options: [
            "It automatically colors all text in neon themes",
            "Screen readers and assistive technologies use landmark roles to enable structured keyboard navigation",
            "It decreases internet bandwidth by 90%",
            "It prevents browser cookies from expiring"
          ],
          answerIndex: 1,
          explanation: "Semantic tags expose structured accessibility trees so screen reader users can jump directly between sections, landmarks, and headings."
        },
        {
          question: "What is an Earcon in assistive user interface design?",
          options: [
            "A brief, distinctive audio icon or sound cue that conveys system status or feedback",
            "A physical microphone headset for recording lectures",
            "A software earplugs plugin to mute all sounds",
            "An ergonomic headphone cushion"
          ],
          answerIndex: 0,
          explanation: "Earcons are structured auditory icons used to provide immediate sound feedback for actions like login success, error alerts, and transitions."
        }
      ];
    } else if (lower.includes('data') || lower.includes('stat') || lower.includes('analyt')) {
      questions = [
        {
          question: "What is the difference between Mean and Median in statistics?",
          options: [
            "The mean is the arithmetic average, while the median is the middle value in a sorted distribution",
            "Mean is for text data, while median is for numeric data",
            "Median is always greater than the mean in every dataset",
            "There is no difference between them"
          ],
          answerIndex: 0,
          explanation: "The arithmetic mean sums all values and divides by count, whereas median is resistant to extreme outliers because it takes the central rank."
        },
        {
          question: "Why is data cleaning usually the most time-consuming phase in data science?",
          options: [
            "Real-world data frequently contains missing values, formatting discrepancies, duplicate records, and noise",
            "Computers cannot read CSV files without compiling them to machine code",
            "Databases automatically delete unclean rows",
            "Data scientists must translate numbers into Latin"
          ],
          answerIndex: 0,
          explanation: "Real-world data is inherently messy; normalizing values, imputing missing data, and handling outliers is essential before modeling."
        },
        {
          question: "What does correlation measure between two variables?",
          options: [
            "Direct causation and proof of physical effect",
            "The statistical strength and direction of a linear relationship between them",
            "The exact difference between their standard deviations",
            "The time it takes to compute their matrix multiplication"
          ],
          answerIndex: 1,
          explanation: "Correlation quantifies how two variables move relative to one another, but does not inherently prove that one causes the other."
        }
      ];
    } else if (lower.includes('bio') || lower.includes('cell') || lower.includes('gene') || lower.includes('photo')) {
      questions = [
        {
          question: "What is the primary organelle responsible for cellular respiration and ATP energy production in eukaryotic cells?",
          options: [
            "Mitochondria",
            "Ribosome",
            "Endoplasmic reticulum",
            "Golgi apparatus"
          ],
          answerIndex: 0,
          explanation: "Mitochondria are often referred to as the cellular powerhouse because they synthesize the majority of the cell's ATP via oxidative phosphorylation."
        },
        {
          question: "During photosynthesis, what molecule is split by light energy in the chloroplast thylakoids to release oxygen?",
          options: [
            "Water (H₂O)",
            "Carbon dioxide (CO₂)",
            "Glucose (C₆H₁₂O₆)",
            "Nitrogen gas (N₂)"
          ],
          answerIndex: 0,
          explanation: "In the light-dependent reactions (photolysis), water molecules (H₂O) are split into electrons, protons, and oxygen gas (O₂)."
        },
        {
          question: "What are the four nucleotide nitrogenous bases found in DNA?",
          options: [
            "Adenine, Thymine, Cytosine, and Guanine",
            "Adenine, Uracil, Cytosine, and Guanine",
            "Alanine, Threonine, Cysteine, and Glutamine",
            "Alpha, Beta, Gamma, and Delta"
          ],
          answerIndex: 0,
          explanation: "DNA contains Adenine (A), Thymine (T), Cytosine (C), and Guanine (G), with A pairing with T and C pairing with G."
        }
      ];
    } else if (lower.includes('space') || lower.includes('astro') || lower.includes('planet') || lower.includes('solar')) {
      questions = [
        {
          question: "Which planet in our solar system has the most extensive and visible ring system?",
          options: [
            "Saturn",
            "Mars",
            "Venus",
            "Neptune"
          ],
          answerIndex: 0,
          explanation: "Saturn is famed for its majestic ring system composed predominantly of billions of chunks of water ice and rock dust."
        },
        {
          question: "What constitutes the boundary around a black hole beyond which nothing, not even light, can escape?",
          options: [
            "Event Horizon",
            "Accretion Disc",
            "Oort Cloud",
            "Kuiper Belt"
          ],
          answerIndex: 0,
          explanation: "The event horizon marks the threshold where gravitational escape velocity equals or exceeds the speed of light."
        },
        {
          question: "What process powers the intense heat and light generated inside the core of our Sun?",
          options: [
            "Nuclear Fusion (fusing Hydrogen into Helium)",
            "Nuclear Fission (splitting heavy Uranium atoms)",
            "Chemical combustion of coal and fossil gases",
            "Geothermal friction"
          ],
          answerIndex: 0,
          explanation: "The core of the Sun undergoes proton-proton nuclear fusion, converting approximately 600 million tons of hydrogen into helium every second."
        }
      ];
    } else {
      // Dynamic topic questions constructed systematically
      questions = [
        {
          question: `Which fundamental principle is central to understanding "${topic}"?`,
          options: [
            `Analyzing the foundational structures, core definitions, and mechanisms that define ${topic}`,
            `Ignoring historical context and practical applications completely`,
            `Assuming that all observations never change over time`,
            `Relying solely on speculative guesses without empirical evaluation`
          ],
          answerIndex: 0,
          explanation: `In ${topic}, mastering foundational definitions and systematic mechanisms allows students to evaluate complex challenges with confidence.`
        },
        {
          question: `When applying concepts in ${topic}, what is widely recognized as the most effective methodology?`,
          options: [
            `Adopting an iterative, evidence-based approach with clear testing and structured feedback`,
            `Executing all procedures in a single unverified attempt`,
            `Dismissing peer review and benchmark comparisons`,
            `Restricting research strictly to outdated materials`
          ],
          answerIndex: 0,
          explanation: `Iterative validation, evidence gathering, and structured feedback ensure robust and reliable conclusions in ${topic}.`
        },
        {
          question: `What is a common pitfall or misconception learners face when studying ${topic}?`,
          options: [
            `Over-simplifying multifaceted interactions or confusing correlation with direct causation`,
            `Documenting their experiments too thoroughly`,
            `Asking too many insightful clarification questions`,
            `Utilizing multimodal accessibility tools for study`
          ],
          answerIndex: 0,
          explanation: `In ${topic}, over-simplification can mask subtle interdependencies, making critical thinking and thorough analysis essential.`
        }
      ];
    }

    const selected = questions.slice(0, count).map((q, idx) => ({
      id: idx + 1,
      ...q
    }));

    return {
      title: `${topic} Master Quiz`,
      subject: subject || topic,
      questions: selected,
      generatedBy: 'Antigravity AI Tutor Engine',
      difficulty
    };
  }
}

module.exports = AntigravityTutorModel;

