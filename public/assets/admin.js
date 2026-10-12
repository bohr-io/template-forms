// The admin: the list of forms (#/), the builder (#/new, #/forms/<id>/edit) and the results
// (#/forms/<id>/results). The address hash is the page's state, so the back button works.
import { $, adminGate, api, busy, errorText, formatDateTime, formatNumber, h, lang, t, toast } from './ui.js';

const LIMITS = { fields: 50, label: 200, options: 30, option: 100 };

const state = {
  key: null, // the form on screen: its id, 'new' or null (the list)
  form: null, // the saved form (null while creating one)
  draft: null, // what the builder edits: { title, description, is_open, fields }
  dirty: false,
  page: 1,
  pages: 1,
};
let lastHash = location.hash;

const publicUrl = (slug) => `${location.origin}/f/${slug}`;
const hasAnswer = (answers, id) => Object.hasOwn(answers, id);

async function copyLink(slug) {
  try {
    await navigator.clipboard.writeText(publicUrl(slug));
    toast(t('forms.copied'));
  } catch {
    toast(t('forms.copyFailed'), 'error');
  }
}

function statusBadge(isOpen) {
  return h('span', { class: `badge ${isOpen ? 'success' : ''}` }, t(isOpen ? 'status.open' : 'status.closed'));
}

function showView(name) {
  $('#view-list').hidden = name !== 'list';
  $('#view-form').hidden = name !== 'form';
}

// ——— The list of forms ———

async function deleteForm(form, button) {
  if (!confirm(t('forms.deleteConfirm', { title: form.title, count: formatNumber(form.responses ?? 0) }))) return false;
  const done = await busy(button, async () => {
    await api(`/api/admin/forms/${form.id}`, { method: 'DELETE' });
    toast(t('forms.deleted'));
    return true;
  });
  return done === true;
}

function formRow(form) {
  return h(
    'tr',
    {},
    h('td', { class: 'wrap' }, h('a', { class: 'form-link', href: `#/forms/${form.id}/edit` }, form.title)),
    h('td', { class: 'num' }, h('a', { href: `#/forms/${form.id}/results` }, formatNumber(form.responses))),
    h('td', {}, statusBadge(form.is_open)),
    h(
      'td',
      {},
      h(
        'div',
        { class: 'link-cell' },
        h('a', { class: 'mono', href: publicUrl(form.slug), target: '_blank', rel: 'noopener' }, `/f/${form.slug}`),
        h('button', {
          class: 'btn small',
          type: 'button',
          text: t('forms.copy'),
          'aria-label': t('forms.copyLabel', { title: form.title }),
          onclick: () => copyLink(form.slug),
        }),
      ),
    ),
    h('td', { class: 'nowrap' }, formatDateTime(form.created_at)),
    h(
      'td',
      {},
      h(
        'div',
        { class: 'row-actions' },
        h('a', { class: 'btn small', href: `#/forms/${form.id}/results` }, t('tab.results')),
        h('button', {
          class: 'btn small danger',
          type: 'button',
          text: t('common.delete'),
          'aria-label': t('forms.deleteLabel', { title: form.title }),
          onclick: async (event) => {
            if (await deleteForm(form, event.currentTarget)) await busy(null, showList);
          },
        }),
      ),
    ),
  );
}

async function showList() {
  const data = await api('/api/admin/forms');
  $('#form-rows').replaceChildren(...data.items.map(formRow));
  $('#list-wrap').hidden = data.items.length === 0;
  $('#list-empty').hidden = data.items.length > 0;
  state.key = null;
  state.form = null;
  document.title = t('admin.brand');
  showView('list');
}

// ——— The builder ———

function setDirty(dirty) {
  state.dirty = dirty;
  $('#dirty').textContent = dirty ? t('builder.unsavedNote') : '';
}

/** A new question of `type`, with an id that no other question of the draft has. */
function newField(type) {
  let id;
  do id = `q${Math.random().toString(36).slice(2, 8)}`;
  while (state.draft?.fields.some((field) => field.id === id));
  const field = { id, type, label: '', required: false };
  if (type === 'text') field.long = false;
  if (type === 'choice') {
    field.multiple = false;
    field.options = [t('builder.option', { n: 1 }), t('builder.option', { n: 2 })];
  }
  return field;
}

function draftOf(form) {
  return {
    title: form.title,
    description: form.description,
    is_open: form.is_open,
    fields: structuredClone(form.fields),
  };
}

/** The options typed in the textarea, one per line. */
const parseOptions = (value) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function checkbox(label, checked, onchange) {
  return h(
    'label',
    { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (event) => onchange(event.target.checked) }),
    h('span', {}, label),
  );
}

function iconButton(symbol, label, action, disabled, onclick, extra = '') {
  return h(
    'button',
    { class: `btn small icon ${extra}`, type: 'button', 'aria-label': label, title: label, disabled, dataset: { action }, onclick },
    h('span', { 'aria-hidden': 'true' }, symbol),
  );
}

function questionCard(field, index, count) {
  const n = index + 1;
  const change = (update) => {
    update();
    setDirty(true);
  };
  const extras = [];
  if (field.type === 'text') {
    extras.push(checkbox(t('builder.long'), field.long, (value) => change(() => (field.long = value))));
  }
  if (field.type === 'choice') {
    extras.push(
      h(
        'label',
        { class: 'field' },
        h('span', {}, t('builder.options')),
        h('textarea', {
          rows: Math.min(8, Math.max(3, field.options.length + 1)),
          dataset: { role: 'options' },
          value: field.options.join('\n'),
          oninput: (event) => change(() => (field.options = parseOptions(event.target.value))),
        }),
        h('span', { class: 'hint' }, t('builder.optionsHint', { max: LIMITS.options })),
      ),
      checkbox(t('builder.multiple'), field.multiple, (value) => change(() => (field.multiple = value))),
    );
  }
  if (field.type === 'rating') extras.push(h('p', { class: 'muted small stars-preview' }, '★★★★★ ', t('builder.ratingHint')));

  return h(
    'li',
    { class: 'card q-card' },
    h(
      'div',
      { class: 'q-head' },
      h('span', { class: 'q-num' }, t('builder.question', { n })),
      h('span', { class: 'badge' }, t(`type.${field.type}`)),
      h(
        'div',
        { class: 'q-actions' },
        iconButton('↑', t('builder.moveUp', { n }), 'up', index === 0, () => moveField(index, -1)),
        iconButton('↓', t('builder.moveDown', { n }), 'down', index === count - 1, () => moveField(index, 1)),
        iconButton('✕', t('builder.remove', { n }), 'remove', false, () => removeField(index), 'danger'),
      ),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, t('builder.label')),
      h('input', {
        value: field.label,
        maxlength: LIMITS.label,
        required: true,
        dataset: { role: 'label' },
        placeholder: t('builder.labelPlaceholder'),
        oninput: (event) => change(() => (field.label = event.target.value)),
      }),
    ),
    extras,
    checkbox(t('builder.required'), field.required, (value) => change(() => (field.required = value))),
  );
}

function renderQuestions() {
  const fields = state.draft.fields;
  $('#questions').replaceChildren(...fields.map((field, index) => questionCard(field, index, fields.length)));
  $('#no-questions').hidden = fields.length > 0;
  for (const button of document.querySelectorAll('[data-add]')) button.disabled = fields.length >= LIMITS.fields;
}

/** The card of question `index` (0-based). */
const card = (index) => $('#questions').children[index];

function moveField(index, step) {
  const fields = state.draft.fields;
  const target = index + step;
  [fields[index], fields[target]] = [fields[target], fields[index]];
  setDirty(true);
  renderQuestions();
  // Keep the keyboard focus on the moved question (on the other arrow when this one is now disabled)
  const moved = card(target);
  const button = moved.querySelector(`[data-action="${step < 0 ? 'up' : 'down'}"]`);
  (button.disabled ? moved.querySelector(`[data-action="${step < 0 ? 'down' : 'up'}"]`) : button)?.focus();
}

function removeField(index) {
  state.draft.fields.splice(index, 1);
  setDirty(true);
  renderQuestions();
  const next = card(Math.min(index, state.draft.fields.length - 1));
  (next?.querySelector('[data-role="label"]') ?? document.querySelector('[data-add="text"]')).focus();
}

function addField(type) {
  state.draft.fields.push(newField(type));
  setDirty(true);
  renderQuestions();
  const input = card(state.draft.fields.length - 1).querySelector('[data-role="label"]');
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input.focus({ preventScroll: true });
}

function renderBuilder() {
  const form = $('#builder');
  form.elements.title.value = state.draft.title;
  form.elements.description.value = state.draft.description;
  form.elements.is_open.checked = state.draft.is_open;
  const responses = state.form?.responses ?? 0;
  $('#has-responses').hidden = responses === 0;
  $('#has-responses').textContent = t('builder.hasResponses', { count: formatNumber(responses) });
  $('#delete-form').hidden = !state.form;
  renderQuestions();
}

/** A problem the server would refuse, found before sending: { key, element } or null. */
function checkDraft() {
  const draft = state.draft;
  if (draft.title.trim() === '') return { key: 'error.invalid_title', element: $('#builder').elements.title };
  if (draft.fields.length === 0) return { key: 'error.invalid_fields', element: $('[data-add="text"]') };
  for (const [index, field] of draft.fields.entries()) {
    if (field.label.trim() === '') return { key: 'error.invalid_field_label', element: card(index).querySelector('[data-role="label"]') };
    if (
      field.type === 'choice' &&
      (field.options.length < 2 ||
        field.options.length > LIMITS.options ||
        new Set(field.options).size !== field.options.length ||
        field.options.some((option) => option.length > LIMITS.option))
    ) {
      return { key: 'error.invalid_field_options', element: card(index).querySelector('[data-role="options"]') };
    }
  }
  return null;
}

async function saveForm(button) {
  const problem = checkDraft();
  if (problem) {
    toast(t(problem.key), 'error');
    problem.element?.focus();
    return;
  }
  await busy(button, async () => {
    const body = state.draft;
    if (state.form) {
      const saved = await api(`/api/admin/forms/${state.form.id}`, { method: 'PUT', body });
      state.form = { ...saved, responses: state.form.responses };
      state.draft = draftOf(state.form);
      setDirty(false);
      renderHeader();
      toast(t('common.saved'));
    } else {
      const saved = await api('/api/admin/forms', { method: 'POST', body });
      setDirty(false);
      toast(t('builder.created'));
      location.hash = `#/forms/${saved.id}/edit`;
    }
  });
}

// ——— One form: header and tabs ———

function renderHeader() {
  const form = state.form;
  $('#form-name').textContent = form ? form.title : t('builder.newTitle');
  document.title = `${form ? form.title : t('builder.newTitle')} · ${t('admin.brand')}`;
  const meta = $('#form-meta');
  if (!form) {
    meta.replaceChildren(h('span', {}, t('builder.newHint')));
  } else {
    meta.replaceChildren(
      statusBadge(form.is_open),
      h('a', { class: 'mono', href: publicUrl(form.slug), target: '_blank', rel: 'noopener' }, publicUrl(form.slug)),
      h('button', { class: 'btn small', type: 'button', text: t('forms.copy'), onclick: () => copyLink(form.slug) }),
    );
  }
  $('#tab-results').disabled = !form;
}

function selectTab(name) {
  for (const tab of document.querySelectorAll('#form-tabs [role="tab"]')) {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute('aria-selected', String(selected));
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

async function showForm(formId, tab) {
  const key = formId ?? 'new';
  // Coming back to the form being edited keeps unsaved changes; anything else loads it again
  if (state.key !== key || !state.dirty) {
    if (formId === null) {
      state.form = null;
      state.draft = { title: '', description: '', is_open: true, fields: [] };
      state.draft.fields.push(newField('text'));
    } else {
      state.form = await api(`/api/admin/forms/${formId}`);
      state.draft = draftOf(state.form);
    }
    if (state.key !== key) state.page = 1;
    state.key = key;
    setDirty(false);
    renderBuilder();
  }
  renderHeader();
  selectTab(tab === 'results' ? 'results' : 'questions');
  showView('form');
  if (tab === 'results') await loadResults();
}

// ——— Results ———

const decimal = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Horizontal bars: the share of `base` people that gave each answer. */
function bars(items, base) {
  return h(
    'ul',
    { class: 'bars' },
    items.map((item) => {
      const percent = base > 0 ? Math.round((item.count / base) * 100) : 0;
      const fill = h('span', { class: 'bar-fill' });
      fill.style.width = `${percent}%`;
      return h(
        'li',
        { class: 'bar-row' },
        h('span', { class: 'bar-label' }, item.label),
        h('span', { class: 'bar-value' }, `${formatNumber(item.count)} · ${percent}%`),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill),
      );
    }),
  );
}

const starsText = (value) => '★'.repeat(value) + '☆'.repeat(5 - value);

function summaryCard(field, total) {
  const parts = [
    h(
      'div',
      { class: 'summary-head' },
      h('h3', {}, field.label),
      h('span', { class: 'badge' }, t(`type.${field.type}`)),
      h('span', { class: 'muted small' }, t('results.answered', { count: formatNumber(field.answered), total: formatNumber(total) })),
    ),
  ];
  if (field.answered === 0) {
    parts.push(h('p', { class: 'muted small' }, t('results.noAnswers')));
  } else if (field.type === 'choice') {
    parts.push(bars(field.options, field.answered));
    if (field.multiple) parts.push(h('p', { class: 'muted small' }, t('results.multipleHint')));
  } else if (field.type === 'rating') {
    const rounded = Math.round(field.average ?? 0);
    parts.push(
      h(
        'div',
        { class: 'rating-summary' },
        h(
          'div',
          { class: 'average' },
          h('strong', {}, decimal.format(field.average ?? 0)),
          h('span', { class: 'avg-stars', 'aria-hidden': 'true' }, starsText(rounded)),
          h('span', { class: 'muted small' }, t('results.average')),
        ),
        bars(
          [5, 4, 3, 2, 1].map((n) => ({ label: t('results.stars', { n }), count: field.distribution[n - 1] })),
          field.answered,
        ),
      ),
    );
  } else {
    parts.push(
      h(
        'ul',
        { class: 'answers' },
        field.latest.map((answer) =>
          h('li', {}, h('p', { class: 'answer-text' }, answer.value), h('span', { class: 'muted small' }, formatDateTime(answer.created_at))),
        ),
      ),
    );
    if (field.answered > field.latest.length) {
      parts.push(h('p', { class: 'muted small' }, t('results.latest', { shown: field.latest.length, count: formatNumber(field.answered) })));
    }
  }
  return h('article', { class: 'card stack summary-card' }, parts);
}

function answerValue(field, value) {
  if (field.type === 'rating' && typeof value === 'number') {
    return [h('span', { class: 'avg-stars', 'aria-hidden': 'true' }, starsText(value)), ' ', t('results.ratingValue', { n: value })];
  }
  if (Array.isArray(value)) return value.join(', ');
  if (field.type === 'email') return h('a', { href: `mailto:${value}` }, String(value));
  return String(value);
}

function responseCard(response, fields) {
  const answered = fields.filter((field) => hasAnswer(response.answers, field.id));
  return h(
    'li',
    { class: 'card response' },
    h(
      'div',
      { class: 'row spread' },
      h('span', { class: 'small' }, h('strong', {}, t('results.response', { id: response.id })), ' · ', h('span', { class: 'muted' }, formatDateTime(response.created_at))),
      h('button', {
        class: 'btn small danger',
        type: 'button',
        text: t('common.delete'),
        'aria-label': t('results.deleteLabel', { id: response.id }),
        onclick: (event) => deleteResponse(response, event.currentTarget),
      }),
    ),
    h(
      'dl',
      { class: 'answer-list' },
      answered.map((field) => [h('dt', {}, field.label), h('dd', {}, answerValue(field, response.answers[field.id]))]),
    ),
  );
}

async function deleteResponse(response, button) {
  if (!confirm(t('results.deleteConfirm', { id: response.id }))) return;
  await busy(button, async () => {
    await api(`/api/admin/responses/${response.id}`, { method: 'DELETE' });
    toast(t('results.deleted'));
    await loadResults();
  });
}

async function loadResponses(fields) {
  const data = await api(`/api/admin/forms/${state.form.id}/responses?page=${state.page}`);
  state.pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (state.page > state.pages) {
    state.page = state.pages;
    return loadResponses(fields);
  }
  $('#responses').replaceChildren(...data.items.map((response) => responseCard(response, fields)));
  $('#responses-empty').hidden = data.total > 0;
  $('#responses-pager').hidden = state.pages <= 1;
  $('#page-info').textContent = t('pager.info', { page: state.page, pages: state.pages });
  $('#prev').disabled = state.page <= 1;
  $('#next').disabled = state.page >= state.pages;
}

async function loadResults() {
  const data = await api(`/api/admin/forms/${state.form.id}/results`);
  state.form.responses = data.total;
  $('#stat-total').textContent = formatNumber(data.total);
  $('#stat-last').textContent = data.last ? formatDateTime(data.last) : '–';
  $('#stat-status').textContent = t(data.form.is_open ? 'status.open' : 'status.closed');
  $('#export').href = `/api/admin/forms/${state.form.id}/responses.csv`;
  $('#summary').replaceChildren(...data.fields.map((field) => summaryCard(field, data.total)));
  await loadResponses(data.form.fields);
}

// ——— Navigation ———

function parseRoute(hash) {
  if (hash === '#/new') return { view: 'form', id: null, tab: 'edit' };
  const match = /^#\/forms\/(\d{1,12})\/(edit|results)$/.exec(hash);
  if (match) return { view: 'form', id: Number(match[1]), tab: match[2] };
  return { view: 'list' };
}

async function route() {
  const next = parseRoute(location.hash);
  try {
    if (next.view === 'list') await showList();
    else await showForm(next.id, next.tab);
  } catch (error) {
    if (error?.code === 'unauthorized') return location.reload();
    toast(errorText(error), 'error');
    if (next.view === 'form' && error?.code === 'not_found') location.hash = '#/';
  }
}

async function start() {
  window.addEventListener('hashchange', () => {
    const next = parseRoute(location.hash);
    const leaving = state.dirty && (next.view !== 'form' || (next.id ?? 'new') !== state.key);
    if (leaving && !confirm(t('builder.unsaved'))) {
      history.replaceState(null, '', lastHash);
      return;
    }
    if (leaving) setDirty(false);
    lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) event.preventDefault();
  });

  const builder = $('#builder');
  builder.elements.title.addEventListener('input', (event) => {
    state.draft.title = event.target.value;
    setDirty(true);
  });
  builder.elements.description.addEventListener('input', (event) => {
    state.draft.description = event.target.value;
    setDirty(true);
  });
  builder.elements.is_open.addEventListener('change', (event) => {
    state.draft.is_open = event.target.checked;
    setDirty(true);
  });
  for (const button of document.querySelectorAll('[data-add]')) {
    button.addEventListener('click', () => addField(button.dataset.add));
  }
  builder.addEventListener('submit', (event) => {
    event.preventDefault();
    saveForm(event.submitter);
  });
  $('#delete-form').addEventListener('click', async (event) => {
    if (!state.form) return;
    if (await deleteForm(state.form, event.currentTarget)) {
      setDirty(false);
      location.hash = '#/';
    }
  });

  $('#tab-questions').addEventListener('click', () => {
    location.hash = state.form ? `#/forms/${state.form.id}/edit` : '#/new';
  });
  $('#tab-results').addEventListener('click', () => {
    if (state.form) location.hash = `#/forms/${state.form.id}/results`;
  });
  $('#prev').addEventListener('click', () => {
    state.page -= 1;
    busy(null, () => loadResponses(state.form.fields));
  });
  $('#next').addEventListener('click', () => {
    state.page += 1;
    busy(null, () => loadResponses(state.form.fields));
  });

  await route();
}

adminGate(start);
