// Reads and renders the HTML templates in templates/.
import { readFileSync } from "node:fs";

export function template(name: string): string {
  return readFileSync(new URL(`./templates/${name}`, import.meta.url), "utf8");
}

// Replaces each {{key}} in source with values[key]. Callers escape each value for
// where it goes.
export function render(source: string, values: Record<string, string>): string {
  return source.replace(/{{(\w+)}}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`The template needs a value for {{${key}}}.`);
    return values[key];
  });
}

// Escapes a string for an HTML attribute value or text.
export function html(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// A service worker's source: its templates as a TEMPLATES constant, then any
// other definitions, then the worker file. Workers can't read files themselves.
export function workerSource(file: string, templates: string[], definitions = ""): string {
  const loaded = Object.fromEntries(templates.map((name) => [name, template(name)]));
  return `const TEMPLATES = ${JSON.stringify(loaded)};\n${definitions}${readFileSync(new URL(`./${file}`, import.meta.url), "utf8")}`;
}
