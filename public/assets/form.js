// The public form page, served at /f/<slug>: loads the form, renders its questions, checks the answers and
// sends them. The server checks everything again (src/forms.ts).
import { $, api, errorText, h, ready, t } from './ui.js';

const EMAIL = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]{2,}$/;
const MAX_TEXT = 5000;

const slug = /^\/f\/([A-Za-z0-9]{3,32})$/.exec(location.pathname)?.[1] ?? '';
const form = $('#form');
let fields = [];

/** Shows one of the page's sections (loading, message, form, done). */
function show(id) {
  for (const section of ['loading', 'message', 'form', 'done']) document.getElementById(section).hidden = section !== id;
}

function showMessage(title, text) {
  $('#message-title').textContent = title;
  $('#message-text').textContent = text;
  show('message');
}

/** The visible label of a question: its text and a "*" when it is required. */
function labelContent(field) {
  return [field.label, field.required ? [' ', h('span', { class: 'req', 'aria-hidden': 'true' }, '*')] : null];
}

function renderQuestion(field, index) {
  const base = `q${index}`;
  const errorId = `${base}-error`;
  const error = h('p', { id: errorId, class: 'field-error', hidden: true });

  if (field.type === 'text' || field.type === 'email') {
    const props = {
      id: base,
      name: field.id,
      required: field.required,
      'aria-describedby': errorId,
    };
    const control =
      field.type === 'text' && field.long
        ? h('textarea', { ...props, rows: 4, maxlength: MAX_TEXT })
        : h('input', {
            ...props,
            type: field.type === 'email' ? 'email' : 'text',
            maxlength: field.type === 'email' ? 254 : MAX_TEXT,
            autocomplete: field.type === 'email' ? 'email' : 'off',
          });
    return h('div', { class: 'question', dataset: { index } }, h('label', { class: 'q-label', for: base }, labelContent(field)), control, error);
  }

  // Choice and rating questions are groups of radio buttons (or checkboxes) inside a fieldset
  const legend = h(
    'legend',
    { class: 'q-label' },
    labelContent(field),
    field.required ? h('span', { class: 'sr-only' }, ` (${t('form.required')})`) : null,
  );
  if (field.type === 'rating') {
    const stars = [1, 2, 3, 4, 5].map((value) =>
      h(
        'label',
        { class: 'star' },
        h('input', { type: 'radio', class: 'sr-only', name: field.id, value, required: field.required }),
        h('span', { 'aria-hidden': 'true' }, '★'),
        h('span', { class: 'sr-only' }, t('form.stars', { n: value })),
      ),
    );
    return h(
      'fieldset',
      { class: 'question', dataset: { index }, 'aria-describedby': errorId },
      legend,
      h('div', { class: 'stars' }, stars),
      error,
    );
  }
  const type = field.multiple ? 'checkbox' : 'radio';
  return h(
    'fieldset',
    { class: 'question', dataset: { index }, 'aria-describedby': errorId },
    legend,
    field.multiple ? h('p', { class: 'hint muted small' }, t('form.chooseMany')) : null,
    h(
      'div',
      { class: 'options' },
      field.options.map((option) =>
        h(
          'label',
          { class: 'option' },
          h('input', { type, name: field.id, value: option, required: field.required && !field.multiple }),
          h('span', {}, option),
        ),
      ),
    ),
    error,
  );
}

/** The answer to `field` as the server expects it ('' or [] when unanswered). */
function answerOf(field) {
  const inputs = [...form.querySelectorAll('input, textarea')].filter((input) => input.name === field.id);
  if (field.type === 'text' || field.type === 'email') return inputs[0]?.value.trim() ?? '';
  const checked = inputs.filter((input) => input.checked).map((input) => input.value);
  if (field.type === 'rating') return checked.length ? Number(checked[0]) : '';
  return field.multiple ? checked : (checked[0] ?? '');
}

/** The problem with an answer (a dictionary key), or null. */
function problemOf(field, value) {
  const empty = value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) return field.required ? 'form.errorRequired' : null;
  if (field.type === 'email' && !EMAIL.test(value)) return 'form.errorEmail';
  if (field.type === 'text' && value.length > MAX_TEXT) return 'form.errorTooLong';
  return null;
}

/** Checks every question, marks the wrong ones and returns the answers (or null when something is wrong). */
function collect() {
  const answers = {};
  let first = null;
  fields.forEach((field, index) => {
    const question = form.querySelector(`.question[data-index="${index}"]`);
    const value = answerOf(field);
    const problem = problemOf(field, value);
    const error = question.querySelector('.field-error');
    error.textContent = problem ? t(problem) : '';
    error.hidden = !problem;
    question.classList.toggle('invalid', Boolean(problem));
    for (const input of question.querySelectorAll('input, textarea')) {
      if (problem) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (problem && !first) first = question;
    if (!problem && !(value === '' || (Array.isArray(value) && value.length === 0))) answers[field.id] = value;
  });
  if (first) {
    first.querySelector('input, textarea')?.focus();
    return null;
  }
  return answers;
}

async function load() {
  ready();
  if (!slug) return showMessage(t('form.missingTitle'), t('form.missingText'));
  let data;
  try {
    data = await api(`/api/forms/${slug}`);
  } catch (error) {
    if (error.code === 'not_found') return showMessage(t('form.missingTitle'), t('form.missingText'));
    return showMessage(t('form.loadError'), errorText(error));
  }
  document.title = data.title;
  if (!data.is_open) return showMessage(data.title, t('form.closedText'));
  fields = data.fields;
  $('#title').textContent = data.title;
  $('#description').textContent = data.description;
  $('#description').hidden = !data.description;
  $('#required-note').hidden = !fields.some((field) => field.required);
  $('#questions').replaceChildren(...fields.map(renderQuestion));
  show('form');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#error');
  error.hidden = true;
  const answers = collect();
  if (!answers) {
    error.textContent = t('form.fixErrors');
    error.hidden = false;
    return;
  }
  if (Object.keys(answers).length === 0) {
    error.textContent = t('error.empty_response');
    error.hidden = false;
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/forms/${slug}/responses`, { method: 'POST', body: { answers, website: form.elements.website.value } });
    show('done');
    $('#done').focus();
    window.scrollTo({ top: 0 });
  } catch (failure) {
    if (failure.code === 'form_closed') return showMessage($('#title').textContent, t('form.closedText'));
    error.textContent = errorText(failure);
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// Fixing an answer clears its message
form.addEventListener('change', (event) => {
  const question = event.target.closest('.question');
  if (!question?.classList.contains('invalid')) return;
  question.classList.remove('invalid');
  question.querySelector('.field-error').hidden = true;
  for (const input of question.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
});

$('#again').addEventListener('click', () => {
  form.reset();
  $('#error').hidden = true;
  show('form');
  window.scrollTo({ top: 0 });
  form.querySelector('input:not([tabindex="-1"]), textarea')?.focus();
});

load();
