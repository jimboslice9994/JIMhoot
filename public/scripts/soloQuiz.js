import { getStats, saveStats } from './storage.js';

export function renderSoloQuiz(root, deck) {
  if (!deck || !deck.items.length) {
    root.innerHTML = '<div class="card">No MCQ deck available.</div>';
    return;
  }

  let idx = 0;
  let score = 0;
  const missed = [];
  let timerId = null;

  function record(correct) {
    const stats = getStats();
    stats[deck.id] = stats[deck.id] || { attempts: 0, correct: 0 };
    stats[deck.id].attempts += 1;
    if (correct) stats[deck.id].correct += 1;
    saveStats(stats);
  }

  function next() {
    idx += 1;
    if (idx >= deck.items.length && missed.length) {
      deck = { ...deck, items: [...missed] };
      idx = 0;
      missed.length = 0;
    }
    renderQuestion();
  }

  function renderQuestion() {
    clearInterval(timerId);
    const q = deck.items[idx];
    if (!q) {
      root.innerHTML = `<div class="card"><h3>Quiz Complete</h3><p>Score: ${score}</p></div>`;
      return;
    }

    let remaining = Number(q.timeLimitSec) || 20;
    root.innerHTML = `<div class="card">
      <h3>${deck.title}</h3>
      <p><strong>Q ${idx + 1}/${deck.items.length}</strong> • Timer: <span id="timer">${remaining}</span>s</p>
      <p>${q.question}</p>
      <div class="choices">
        <button data-choice="A">A) ${q.choices.A}</button>
        <button data-choice="B">B) ${q.choices.B}</button>
        <button data-choice="C">C) ${q.choices.C}</button>
        <button data-choice="D">D) ${q.choices.D}</button>
      </div>
      <p id="explain" class="muted"></p>
      <button id="nextBtn" class="hidden">Next</button>
    </div>`;

    function lock(choice = null) {
      document.querySelectorAll('[data-choice]').forEach((btn) => { btn.disabled = true; });
      const ok = choice === q.correct;
      if (ok) score += 1; else missed.push(q);
      record(ok);
      document.getElementById('explain').textContent = `Correct: ${q.correct}. ${q.explanation || ''}`;
      document.getElementById('nextBtn').classList.remove('hidden');
      clearInterval(timerId);
    }

    document.querySelectorAll('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => lock(btn.dataset.choice));
    });

    document.getElementById('nextBtn')?.addEventListener('click', next);
    timerId = setInterval(() => {
      remaining -= 1;
      const t = document.getElementById('timer');
      if (t) t.textContent = String(remaining);
      if (remaining <= 0) lock(null);
    }, 1000);
  }

  renderQuestion();
}
