const STORAGE_KEY = 'tasknest.tasks';

const taskForm = document.getElementById('task-form');
const taskInput = document.getElementById('task-input');
const taskList = document.getElementById('task-list');
const taskTemplate = document.getElementById('task-template');
const taskCount = document.getElementById('task-count');
const clearCompletedBtn = document.getElementById('clear-completed');

let tasks = loadTasks();

function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function addTask(text) {
  tasks.unshift({
    id: crypto.randomUUID(),
    text,
    completed: false,
  });
  saveTasks();
  render();
}

function toggleTask(id, completed) {
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, completed } : task,
  );
  saveTasks();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  saveTasks();
  render();
}

function clearCompleted() {
  tasks = tasks.filter((task) => !task.completed);
  saveTasks();
  render();
}

function render() {
  taskList.innerHTML = '';

  tasks.forEach((task) => {
    const clone = taskTemplate.content.cloneNode(true);
    const item = clone.querySelector('.task-item');
    const checkbox = clone.querySelector('.task-check');
    const text = clone.querySelector('.task-text');
    const deleteBtn = clone.querySelector('.delete-btn');

    item.dataset.taskId = task.id;
    checkbox.checked = task.completed;
    text.textContent = task.text;

    if (task.completed) {
      item.classList.add('completed');
    }

    checkbox.addEventListener('change', (event) => {
      toggleTask(task.id, event.target.checked);
    });

    deleteBtn.addEventListener('click', () => {
      deleteTask(task.id);
    });

    taskList.appendChild(clone);
  });

  const remaining = tasks.filter((task) => !task.completed).length;
  taskCount.textContent = `${remaining} task${remaining === 1 ? '' : 's'} left`;
}

taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (!text) return;
  addTask(text);
  taskInput.value = '';
  taskInput.focus();
});

clearCompletedBtn.addEventListener('click', clearCompleted);

render();
