import { fail } from './lib/http';
import { boolean, email, integer, oneOf, text } from './lib/validate';

// A form is a list of fields (questions), stored as JSON in forms.fields. A response stores its answers as
// JSON keyed by field id: text and email answers are strings, a single choice is the chosen option, a
// multiple choice is an array of options and a rating is an integer from 1 to 5. Unanswered optional
// questions are left out.

export const FIELD_TYPES = ['text', 'email', 'choice', 'rating'] as const;

type Base = { id: string; label: string; required: boolean };
export type Field =
  | (Base & { type: 'text'; long: boolean })
  | (Base & { type: 'email' })
  | (Base & { type: 'choice'; multiple: boolean; options: string[] })
  | (Base & { type: 'rating' });

export type Answer = string | string[] | number;
export type Answers = Record<string, Answer>;

export const LIMITS = { fields: 50, label: 200, options: 30, option: 100, answer: 5000 } as const;

/** Field ids are chosen by the admin page (for example `q4k2x9`) and never change, so answers keep their question. */
const FIELD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** The public address of a form: /f/<slug>. New forms get 10 random letters and digits. */
export const SLUG = /^[A-Za-z0-9]{3,32}$/;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomSlug(length = 10): string {
  let slug = '';
  while (slug.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      // 248 = 4 × 62: dropping bytes above it keeps every character equally likely
      if (byte < 248 && slug.length < length) slug += BASE62[byte % 62];
    }
  }
  return slug;
}

function flag(value: unknown, field: string): boolean {
  return value === undefined ? false : boolean(value, field);
}

function parseOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > LIMITS.options) fail(400, 'invalid_field_options');
  const options = value.map((option) => text(option, 'field_options', { max: LIMITS.option }));
  if (new Set(options).size !== options.length) fail(400, 'invalid_field_options');
  return options;
}

/** Validates the whole list of fields sent by the builder (400 `invalid_fields`, `invalid_field_label`, ...). */
export function parseFields(value: unknown): Field[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.fields) fail(400, 'invalid_fields');
  const seen = new Set<string>();
  return value.map((raw): Field => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(400, 'invalid_fields');
    const input = raw as Record<string, unknown>;
    if (typeof input.id !== 'string' || !FIELD_ID.test(input.id) || seen.has(input.id)) fail(400, 'invalid_fields');
    seen.add(input.id);
    const type = oneOf(input.type, 'fields', FIELD_TYPES);
    const base: Base = {
      id: input.id,
      label: text(input.label, 'field_label', { max: LIMITS.label }),
      required: flag(input.required, 'fields'),
    };
    switch (type) {
      case 'text':
        return { ...base, type, long: flag(input.long, 'fields') };
      case 'choice':
        return { ...base, type, multiple: flag(input.multiple, 'fields'), options: parseOptions(input.options) };
      case 'email':
        return { ...base, type };
      case 'rating':
        return { ...base, type };
    }
  });
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

function parseAnswer(field: Field, value: unknown): Answer {
  switch (field.type) {
    case 'text':
      return text(value, 'answer', { max: LIMITS.answer, multiline: field.long });
    case 'email':
      return email(value, 'email');
    case 'rating':
      return integer(value, 'answer', 1, 5);
    case 'choice': {
      if (!field.multiple) {
        if (typeof value !== 'string' || !field.options.includes(value)) fail(400, 'invalid_answer');
        return value;
      }
      if (!Array.isArray(value) || value.some((option) => typeof option !== 'string' || !field.options.includes(option))) {
        fail(400, 'invalid_answer');
      }
      // Each option once, in the form's order
      return field.options.filter((option) => value.includes(option));
    }
  }
}

/**
 * Checks a visitor's answers against the form's fields: required questions, email format, options that
 * exist, ratings from 1 to 5 and text up to 5000 characters. Keys that are not a field are dropped.
 */
export function parseAnswers(fields: Field[], value: unknown): Answers {
  const input = value ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_answers');
  const entries: [string, Answer][] = [];
  for (const field of fields) {
    const raw = Object.hasOwn(input, field.id) ? (input as Record<string, unknown>)[field.id] : undefined;
    if (isEmpty(raw)) {
      if (field.required) fail(400, 'answer_required');
      continue;
    }
    entries.push([field.id, parseAnswer(field, raw)]);
  }
  if (entries.length === 0) fail(400, 'empty_response');
  // fromEntries defines own properties, so an id like "constructor" is just a key
  return Object.fromEntries(entries);
}

/** One answer as plain text (CSV and lists): multiple choices joined with "; ". */
export function answerText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(String).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
