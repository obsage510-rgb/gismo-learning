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
Your core mission is to make learning crystal clear, inspiring, and fully accessible to all students, including those with visual impairments, hearing impairments, or learning differences.

Guidelines:
1. Format all answers in clean, readable Markdown using **bold** for key concepts and bullet points for complex topics.
2. Structure your answers so they sound natural when read aloud by Text-to-Speech (TTS).
3. If the student has visual impairments, provide vivid descriptions and analogies.
4. Keep answers focused, engaging, and encourage active curiosity.`;

    if (persona === 'scientist') {
      instructions += `\n\nPersona: Mad Scientist! Use eccentric laboratory metaphors, enthusiasm, sparks of curiosity, and quirky scientific references while keeping the explanation accurate!`;
    } else if (persona === 'historian') {
      instructions += `\n\nPersona: Ancient Historian! Speak as if consulting ancient scrolls and chronicling timeless wisdom through the ages, while remaining clear and helpful!`;
    } else {
      instructions += `\n\nPersona: Helpful Guide. Warm, supportive, encouraging, and clear.`;
    }

    if (context) {
      instructions += `\n\nActive Lesson Material Grounding:\n"""\n${context}\n"""\nUse this lesson material to ground your explanation when relevant.`;
    }

    return instructions;
  }

  /**
   * Generates a tutor response for the student.
   */
  async generateResponse({ message, persona = 'default', context = '', history = [] }) {
    const trimmed = (message || '').trim();
    if (!trimmed) {
      return {
        reply: "Hello! I am your Gismo AI Tutor. Ask me any question about your lessons!",
        model: this.modelName
      };
    }

    // Fast conversational replies
    const lower = trimmed.toLowerCase();
    if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower.startsWith('hello ') || lower.startsWith('hi ')) {
      return {
        reply: `Hello! I am **Gismo**, your accessible AI tutor powered by **Antigravity**. I'm here to help you explore your lessons, prepare for quizzes, or answer questions. What would you like to learn about today?`,
        model: this.modelName,
        persona
      };
    }

    if (lower.includes('who are you') || lower.includes('what are you')) {
      return {
        reply: `I am **Gismo AI**, an accessible learning assistant powered by the **Google Antigravity SDK** and Gemini. I adapt to your preferred learning mode—providing spoken explanations, simplified summaries, and visual descriptions!`,
        model: this.modelName,
        persona
      };
    }

    if (lower.includes('thank you') || lower.includes('thanks')) {
      return {
        reply: `You're very welcome! Keep up the fantastic curiosity. Let me know if there's anything else you'd like to explore!`,
        model: this.modelName,
        persona
      };
    }

    // Call Gemini API through Antigravity engine
    if (this.apiKey) {
      try {
        const systemPrompt = this.buildSystemInstructions(persona, context);
        const contents = [];

        // Append recent chat history if available
        if (Array.isArray(history) && history.length > 0) {
          const recent = history.slice(-8);
          for (const item of recent) {
            contents.push({
              role: item.role === 'model' || item.role === 'ai' ? 'model' : 'user',
              parts: [{ text: item.content || item.text || '' }]
            });
          }
        }

        // Add current student prompt
        contents.push({
          role: 'user',
          parts: [{ text: trimmed }]
        });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024
            }
          }),
          signal: AbortSignal.timeout(16000)
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) {
            return {
              reply: candidate.trim(),
              model: this.modelName,
              persona,
              status: 'success'
            };
          }
        }
      } catch (err) {
        console.warn('Antigravity API generation warning:', err.message);
      }
    }

    // Intelligent fallback reply if API is unreachable
    let fallbackText = `I am operating with local Antigravity intelligence! In response to **"${trimmed}"**:\n\n` +
      `- **Key Concept**: Learning is best achieved by breaking ideas into structured steps.\n` +
      `- **Next Step**: Select any module on your dashboard (like *Introduction to AI* or *Data Science 101*) to read along with me!`;

    if (context) {
      fallbackText = `Based on your current lesson material:\n\n> *${context.slice(0, 160)}...*\n\n` +
        `This topic highlights the fundamentals. Try asking a specific question about what you'd like to explore next!`;
    }

    return {
      reply: fallbackText,
      model: `${this.modelName} (Local Guard)`,
      persona,
      status: 'fallback'
    };
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
          signal: AbortSignal.timeout(16000)
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
          question: "What does the 'A' in the WCAG accessibility principles (POUR) stand for?",
          options: [
            "Understandable (from Perceivable, Operable, Understandable, Robust)",
            "Automated",
            "Augmented",
            "Accessible"
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

