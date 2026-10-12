-- Forms: the forms (questions as JSON), their responses (answers as JSON keyed by question id) and the
-- request limiter. See src/forms.ts for the shape of both JSON columns.

CREATE TABLE forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The public address is /f/<slug>: random and hard to guess, so only people with the link find the form
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  answers TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX responses_form ON responses (form_id, id);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- An example survey, open at /f/exemplo, with a few answers so the results have something to show
INSERT INTO forms (id, slug, title, description, fields, is_open, created_at, updated_at) VALUES (
  1,
  'exemplo',
  'Pesquisa de satisfação',
  'Leva menos de um minuto. Suas respostas ajudam a melhorar o nosso atendimento.',
  '[{"id":"nota","type":"rating","label":"Como você avalia o nosso atendimento?","required":true},{"id":"canal","type":"choice","label":"Como você conheceu a gente?","required":true,"multiple":false,"options":["Indicação de amigos","Redes sociais","Busca no Google","Outro"]},{"id":"melhorar","type":"choice","label":"O que podemos melhorar?","required":false,"multiple":true,"options":["Preço","Prazo de entrega","Atendimento","Variedade de produtos"]},{"id":"comentario","type":"text","label":"Quer deixar um comentário?","required":false,"long":true},{"id":"email","type":"email","label":"Seu e-mail, se quiser uma resposta","required":false}]',
  1,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-9 days'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-9 days')
);

INSERT INTO responses (form_id, answers, created_at) VALUES
  (1, '{"nota":5,"canal":"Indicação de amigos","melhorar":["Prazo de entrega"],"comentario":"Atendimento excelente, voltarei com certeza!"}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-8 days', '-3 hours')),
  (1, '{"nota":4,"canal":"Redes sociais","melhorar":["Preço","Variedade de produtos"]}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days', '-5 hours')),
  (1, '{"nota":5,"canal":"Busca no Google","comentario":"Encontrei tudo o que precisava e chegou rápido.","email":"marina@example.com"}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-6 days', '-1 hours')),
  (1, '{"nota":3,"canal":"Redes sociais","melhorar":["Prazo de entrega","Atendimento"],"comentario":"A entrega atrasou dois dias, mas o suporte resolveu."}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days', '-7 hours')),
  (1, '{"nota":4,"canal":"Indicação de amigos","melhorar":["Preço"]}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 days', '-2 hours')),
  (1, '{"nota":5,"canal":"Indicação de amigos","comentario":"Muito bom!","email":"joao@example.com"}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days', '-6 hours')),
  (1, '{"nota":2,"canal":"Outro","melhorar":["Atendimento","Prazo de entrega"],"comentario":"Demorei para conseguir falar com alguém pelo telefone."}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days', '-4 hours')),
  (1, '{"nota":5,"canal":"Busca no Google","melhorar":["Variedade de produtos"]}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 days', '-3 hours')),
  (1, '{"nota":4,"canal":"Redes sociais","comentario":"Gostei bastante da embalagem."}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 hours'));
