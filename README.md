# Forms

A small form and survey builder, like a tiny Google Forms. In the admin you create forms with text, email,
multiple choice and star rating questions, open or close them and share their public link (`/f/<slug>`, a
random address only people with the link find). Visitors answer on a clean, accessible page; the admin shows
the results as charts (counts and percentages per option, average and distribution per rating, the latest
text answers), lists every response, deletes them and exports everything as CSV.

Runs as one Cloudflare Worker (Hono API + static files in `public/`) with a D1 database. The pages speak
Brazilian Portuguese, English and Spanish, following the visitor's browser. An example survey comes ready at
`/f/exemplo`.

## Admin password

The admin (`/admin`) uses the `ADMIN_PASSWORD` variable. bohr sets it when it creates the project; to change it,
edit the site variable in bohr or run `npx wrangler secret put ADMIN_PASSWORD`. Without it the admin stays
closed and explains how to set it.

## Routes

| Route | What |
| --- | --- |
| `/` | Home: says the site hosts forms, links to the admin (forms are not listed) |
| `/f/:slug` | The public form page (try `/f/exemplo`) |
| `/admin` | Admin: forms, builder, results, CSV |
| `GET /api/forms/:slug` | An open form's title, description and questions (a closed one answers `{ title, is_open: false }`) |
| `POST /api/forms/:slug/responses` | Answer: `{ answers: { <questionId>: value } }` (403 `form_closed`) |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` | Admin session |
| `GET/POST /api/admin/forms` | Forms with their response counts / create a form |
| `GET/PUT/DELETE /api/admin/forms/:id` | One form (deleting it deletes its responses) |
| `GET /api/admin/forms/:id/results` | Totals and per-question summary |
| `GET /api/admin/forms/:id/responses?page=` | Responses, newest first |
| `GET /api/admin/forms/:id/responses.csv` | CSV export, one column per question |
| `DELETE /api/admin/responses/:id` | Delete a response |

Questions are stored as JSON in `forms.fields` and answers as JSON in `responses.answers`; `src/forms.ts`
describes both and validates them.

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # sets ADMIN_PASSWORD for local development
npx wrangler d1 migrations apply DB --local && npx wrangler dev
```

Schema changes go in a new file in `migrations/` (for example `0002_add_closes_at.sql`); deploys apply them.

## Ideas to ask the agent

- Email me (with Resend or another email API) every time someone answers a form.
- Conditional questions: show a question only when a previous answer matches.
- A file upload question that stores the files in R2.
- Close a form automatically after a date or after a number of responses.
- An embed code to put a form inside another website.
- Send each new response to a webhook (Slack, Google Sheets, Zapier).
