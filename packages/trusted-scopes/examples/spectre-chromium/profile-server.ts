// The untrusted profile server. It renders the profile page's head and body
// content, which the router wraps in a document, with the user's name encrypted
// for the page's session. It shows the name in a frame of the trusted "pii" scope,
// which decrypts it.
import { options, request, serve } from "./ipc.ts";
import { html, render, template } from "./templates.ts";

export interface ProfileOptions {
  // Extra markup for the page's head and the end of its body.
  head?: string;
  body?: string;
  // Extra files to serve, by path.
  files?: Record<string, { type: string; body: string }>;
}

const { head = "", body = "", files = {} } = options<ProfileOptions>();

const HEAD = template("profile-head.html");
const BODY = template("profile-body.html");

serve(async ({ url, session }) => {
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/profile") {
    const name = await request("pii", `/trusted-scopes/pii/ciphertext?session=${session}`);
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ head: render(HEAD, { head }), body: render(BODY, { body, ciphertext: html(name.body) }) }),
    };
  }
  const file = Object.hasOwn(files, pathname) ? files[pathname] : undefined;
  if (file) return { status: 200, headers: { "Content-Type": file.type }, body: file.body };
  return { status: 404, headers: {} as Record<string, string>, body: "" };
});
