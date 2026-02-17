import { updateDeckStats } from './storage.js';
import { shuffleArray } from './utils.js';

export function renderSoloQuiz(root, deck, options = {}) {
  const source = deck?.modes?.quiz || [];
  if (!source.length) {
    root.innerHTML = '<div class="card">No quiz questions available for this deck.</div>';
    return;
  }

  const state = {
    questions: options.shuffle ? shuffleArray(source) : [...source],
    idx: 0,
    score: 0,
    missed: [],
    timerId: null,
    timeLeft: 10,
    defaultTimer: Math.max(5, Math.min(90, Number(options.timerSec) || 10)),
    locked: false,
  };

  function record(correct) {
    updateDeckStats(deck.id, (s) => {
      s.attempts += 1;
      if (correct) {
        s.correct += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
      } else {
        s.streak = 0;
      }
      return s;
    });
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function restart({ reviewMissed = false, shuffle = false } = {}) {
    stopTimer();
    const pool = reviewMissed && state.missed.length ? [...state.missed] : [...source];
    state.questions = shuffle ? shuffleArray(pool) : pool;
    state.idx = 0;
    state.score = 0;
    state.missed = [];
    state.locked = false;
    drawQuestion();
  }

  function showSummary() {
    stopTimer();
    const total = state.questions.length || 1;
    const accuracy = Math.round((state.score / total) * 100);
    root.innerHTML = `<div class="card">
      <h3>Quiz Complete</h3>
      <p>Score: ${state.score}/${state.questions.length}</p>
      <p>Accuracy: ${accuracy}%</p>
      <p>Missed questions: ${state.missed.length}</p>
      <div class="row">
        <button id="quiz-restart" type="button">Restart</button>
        <button id="quiz-review" type="button" ${state.missed.length ? '' : 'disabled'}>Review missed</button>
      </div>
      <button id="quiz-shuffle" type="button">Shuffle + restart</button>
    </div>`;

    document.getElementById('quiz-restart')?.addEventListener('click', () => restart({ shuffle: false }));
    document.getElementById('quiz-review')?.addEventListener('click', () => restart({ reviewMissed: true }));
    document.getElementById('quiz-shuffle')?.addEventListener('click', () => restart({ shuffle: true }));
  }

  function advance() {
    state.idx += 1;
    state.locked = false;
    drawQuestion();
  }

  function drawQuestion() {
    stopTimer();
    const q = state.questions[state.idx];
    if (!q) {
      showSummary();
      return;
    }

    state.timeLeft = Number(q.timeLimitSec) > 0 ? Number(q.timeLimitSec) : state.defaultTimer;

    root.innerHTML = `<div class="card">
      <h3>${deck.title} • Quiz</h3>
      <p><strong>Q ${state.idx + 1}/${state.questions.length}</strong> • Timer: <span id="timer">${state.timeLeft}</span>s</p>
      <p>${q.question}</p>
      <div class="choices">
        <button data-choice="A" type="button">A) ${q.choices.A}</button>
        <button data-choice="B" type="button">B) ${q.choices.B}</button>
        <button data-choice="C" type="button">C) ${q.choices.C}</button>
        <button data-choice="D" type="button">D) ${q.choices.D}</button>
      </div>
      <p id="quiz-feedback" class="muted"></p>
      <button id="quiz-next" class="hidden" type="button">Next</button>
    </div>`;

    const feedbackEl = document.getElementById('quiz-feedback');

    function lock(choice = null) {
      if (state.locked) return;
      state.locked = true;
      stopTimer();
      document.querySelectorAll('[data-choice]').forEach((btn) => { btn.disabled = true; });
      const correct = choice === q.correctChoice;
      if (correct) state.score += 1;
      if (!correct) state.missed.push(q);
      record(correct);
      feedbackEl.textContent = `${correct ? '✅ Correct' : '❌ Incorrect'} — Correct answer: ${q.correctChoice}. ${q.explanation || ''}`;
      document.getElementById('quiz-next').classList.remove('hidden');
    }

    document.querySelectorAll('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => lock(btn.dataset.choice));
    });

    document.getElementById('quiz-next')?.addEventListener('click', advance);

    state.timerId = setInterval(() => {
      state.timeLeft -= 1;
      const timerEl = document.getElementById('timer');
      if (timerEl) timerEl.textContent = String(state.timeLeft);
      if (state.timeLeft <= 0) lock(null);
    }, 1000);
  }

  drawQuestion();
}
