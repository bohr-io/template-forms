import { Hono } from 'hono';
import type { AppEnv } from './env';
import { type Field, answerText, parseAnswers, parseFields, randomSlug, SLUG } from './forms';
import { auth, requireAdmin } from './lib/auth';
import { apiGuard, csvResponse, fail, onError, rateLimit, readJson, serveAssets } from './lib/http';
import { boolean, id, integer, text } from './lib/validate';

type FormRow = {
  id: number;
  slug: string;
  title: string;
  description: string;
  fields: string;
  is_open: number;
  created_at: string;
  updated_at: string;
};
type ResponseRow = { id: number; answers: string; created_at: string };

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

function formOut(row: FormRow) {
  return { ...row, fields: JSON.parse(row.fields) as Field[], is_open: row.is_open === 1 };
}

async function findForm(db: D1Database, formId: number) {
  const row = await db.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first<FormRow>();
  if (row === null) fail(404, 'not_found');
  return formOut(row);
}

async function findOpenForm(db: D1Database, slug: string) {
  if (!SLUG.test(slug)) fail(404, 'not_found');
  const row = await db.prepare('SELECT * FROM forms WHERE slug = ?').bind(slug).first<FormRow>();
  if (row === null) fail(404, 'not_found');
  return formOut(row);
}

/** The builder's body: title, description, open/closed and the validated fields. */
function readForm(body: Record<string, unknown>) {
  return {
    title: text(body.title, 'title', { max: 120 }),
    description: text(body.description, 'description', { max: 1000, optional: true, multiline: true }),
    is_open: boolean(body.is_open, 'is_open'),
    fields: parseFields(body.fields),
  };
}

/** The JSON path of a field's answer, e.g. $."q4k2x9" (always bound as a parameter, never interpolated). */
const answerPath = (field: Field) => `$."${field.id}"`;

function parseAnswersJson(row: ResponseRow) {
  let answers: Record<string, unknown> = {};
  try {
    answers = JSON.parse(row.answers) as Record<string, unknown>;
  } catch {
    // a broken row shows as empty
  }
  return { id: row.id, created_at: row.created_at, answers };
}

const app = new Hono<AppEnv>();
app.onError(onError);
app.use('/api/*', apiGuard);
app.route('/api/auth', auth);
app.use('/api/admin/*', requireAdmin);

// Public: an open form's questions. A closed form answers only its title, so the page can say it is closed.
app.get('/api/forms/:slug', async (c) => {
  const form = await findOpenForm(c.env.DB, c.req.param('slug'));
  if (!form.is_open) return c.json({ slug: form.slug, title: form.title, is_open: false });
  return c.json({ slug: form.slug, title: form.title, description: form.description, fields: form.fields, is_open: true });
});

// Public: send a response. Every answer is checked against the form's fields; unknown keys are dropped.
app.post('/api/forms/:slug/responses', async (c) => {
  const body = await readJson(c, 300_000);
  // Bots fill the hidden "website" field: they get a success and nothing is stored
  if (typeof body.website === 'string' && body.website !== '') return c.json({ ok: true }, 201);
  await rateLimit(c, 'response', 30, 10 * 60);
  const form = await findOpenForm(c.env.DB, c.req.param('slug'));
  if (!form.is_open) fail(403, 'form_closed');
  const answers = parseAnswers(form.fields, body.answers);
  await c.env.DB.prepare('INSERT INTO responses (form_id, answers) VALUES (?, ?)').bind(form.id, JSON.stringify(answers)).run();
  return c.json({ ok: true }, 201);
});

// Admin: every form with its number of responses, newest first
app.get('/api/admin/forms', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.slug, f.title, f.is_open, f.created_at, f.updated_at,
       (SELECT COUNT(*) FROM responses r WHERE r.form_id = f.id) AS responses
     FROM forms f ORDER BY f.id DESC`,
  ).all<Omit<FormRow, 'fields' | 'description'> & { responses: number }>();
  return c.json({ items: results.map((row) => ({ ...row, is_open: row.is_open === 1 })) });
});

app.post('/api/admin/forms', async (c) => {
  const form = readForm(await readJson(c, 300_000));
  // A new random slug; on the (very unlikely) clash with an existing one, try another
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await c.env.DB.prepare(
      `INSERT INTO forms (slug, title, description, fields, is_open) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO NOTHING RETURNING *`,
    )
      .bind(randomSlug(), form.title, form.description, JSON.stringify(form.fields), form.is_open ? 1 : 0)
      .first<FormRow>();
    if (row !== null) return c.json(formOut(row), 201);
  }
  fail(500, 'server_error');
});

app.get('/api/admin/forms/:id', async (c) => {
  const form = await findForm(c.env.DB, id(c.req.param('id')));
  const responses = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM responses WHERE form_id = ?')
    .bind(form.id)
    .first<number>('total');
  return c.json({ ...form, responses: responses ?? 0 });
});

app.put('/api/admin/forms/:id', async (c) => {
  const formId = id(c.req.param('id'));
  const form = readForm(await readJson(c, 300_000));
  const row = await c.env.DB.prepare(
    `UPDATE forms SET title = ?, description = ?, fields = ?, is_open = ?, updated_at = ${NOW} WHERE id = ? RETURNING *`,
  )
    .bind(form.title, form.description, JSON.stringify(form.fields), form.is_open ? 1 : 0, formId)
    .first<FormRow>();
  if (row === null) fail(404, 'not_found');
  return c.json(formOut(row));
});

// Deleting a form deletes its responses too
app.delete('/api/admin/forms/:id', async (c) => {
  const formId = id(c.req.param('id'));
  const [, deleted] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM responses WHERE form_id = ?').bind(formId),
    c.env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId),
  ]);
  if (!deleted?.meta.changes) fail(404, 'not_found');
  return c.json({ ok: true });
});

// Admin: the summary of a form's answers, one entry per field (computed in D1, whatever the number of responses)
app.get('/api/admin/forms/:id/results', async (c) => {
  const db = c.env.DB;
  const form = await findForm(db, id(c.req.param('id')));
  const latestLimit = 10;
  // Per field: how many answered it, then the details (counts per option, per rating or the latest texts)
  const statements = form.fields.flatMap((field) => {
    const answered = db
      .prepare('SELECT COUNT(*) AS count FROM responses WHERE form_id = ?2 AND json_extract(answers, ?1) IS NOT NULL')
      .bind(answerPath(field), form.id);
    const details =
      field.type === 'choice'
        ? db.prepare(
            `SELECT j.value AS value, COUNT(*) AS count FROM responses r, json_each(r.answers, ?1) j
             WHERE r.form_id = ?2 GROUP BY j.value`,
          )
        : field.type === 'rating'
          ? db.prepare(
              `SELECT json_extract(answers, ?1) AS value, COUNT(*) AS count FROM responses
               WHERE form_id = ?2 AND json_extract(answers, ?1) IS NOT NULL GROUP BY 1`,
            )
          : db.prepare(
              `SELECT id, json_extract(answers, ?1) AS value, created_at FROM responses
               WHERE form_id = ?2 AND json_extract(answers, ?1) IS NOT NULL ORDER BY id DESC LIMIT ${latestLimit}`,
            );
    return [answered, details.bind(answerPath(field), form.id)];
  });
  const [summary, ...rows] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT COUNT(*) AS total, MAX(created_at) AS last FROM responses WHERE form_id = ?').bind(form.id),
    ...statements,
  ]);
  const fields = form.fields.map((field, index) => {
    const answered = Number(rows[index * 2]?.results[0]?.count ?? 0);
    const details = rows[index * 2 + 1]?.results ?? [];
    const base = { id: field.id, type: field.type, label: field.label, answered };
    if (field.type === 'choice') {
      const counts = new Map(details.map((row) => [String(row.value), Number(row.count)]));
      // Current options first; answers to options removed since then are listed after them
      const extra = [...counts.keys()].filter((value) => !field.options.includes(value));
      const options = [...field.options, ...extra].map((label) => ({ label, count: counts.get(label) ?? 0 }));
      return { ...base, multiple: field.multiple, options };
    }
    if (field.type === 'rating') {
      const distribution = [0, 0, 0, 0, 0];
      let sum = 0;
      let count = 0;
      for (const row of details) {
        const value = Number(row.value);
        if (!Number.isInteger(value) || value < 1 || value > 5) continue;
        distribution[value - 1] = Number(row.count);
        sum += value * Number(row.count);
        count += Number(row.count);
      }
      return { ...base, average: count === 0 ? null : Math.round((sum / count) * 100) / 100, distribution };
    }
    return {
      ...base,
      latest: details.map((row) => ({ id: row.id, value: answerText(row.value), created_at: row.created_at })),
    };
  });
  const totals = summary?.results[0] ?? {};
  return c.json({ form, total: Number(totals.total ?? 0), last: totals.last ?? null, fields });
});

// Admin: individual responses, newest first
app.get('/api/admin/forms/:id/responses', async (c) => {
  const formId = id(c.req.param('id'));
  const page = integer(c.req.query('page') ?? '1', 'page', 1, 100_000);
  const pageSize = 20;
  const [rows, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT id, answers, created_at FROM responses WHERE form_id = ? ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ).bind(formId),
    c.env.DB.prepare('SELECT COUNT(*) AS total FROM responses WHERE form_id = ?').bind(formId),
  ]);
  const items = ((rows?.results ?? []) as ResponseRow[]).map(parseAnswersJson);
  return c.json({ items, total: Number(total?.results[0]?.total ?? 0), page, pageSize });
});

// Admin: all responses as CSV, one column per question (by its label)
app.get('/api/admin/forms/:id/responses.csv', async (c) => {
  const form = await findForm(c.env.DB, id(c.req.param('id')));
  const { results } = await c.env.DB.prepare('SELECT id, answers, created_at FROM responses WHERE form_id = ? ORDER BY id')
    .bind(form.id)
    .all<ResponseRow>();
  return csvResponse(
    `responses-${form.slug}.csv`,
    ['id', 'submitted_at', ...form.fields.map((field) => field.label)],
    results.map(parseAnswersJson).map((row) => [
      row.id,
      row.created_at,
      ...form.fields.map((field) => answerText(Object.hasOwn(row.answers, field.id) ? row.answers[field.id] : undefined)),
    ]),
  );
});

app.delete('/api/admin/responses/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM responses WHERE id = ?').bind(id(c.req.param('id'))).run();
  if (result.meta.changes === 0) fail(404, 'not_found');
  return c.json({ ok: true });
});

app.all('/api/*', () => fail(404, 'not_found'));

// Public form page: /f/<slug> serves public/form.html (requested by its pretty path, /form), which reads the
// slug from the address. Anything else under /f/ is a normal static request (and its 404 page).
app.get('/f/:slug', (c) => {
  if (!SLUG.test(c.req.param('slug'))) return c.env.ASSETS.fetch(c.req.raw);
  return c.env.ASSETS.fetch(new Request(new URL('/form', c.req.url), { method: c.req.method, headers: c.req.raw.headers }));
});

app.all('*', serveAssets);

export default app;
