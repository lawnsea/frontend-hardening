// The untrusted profile server. It renders the profile page, which shows the user's
// name in a frame of the trusted "pii" scope.
import { options, serve } from "./ipc.ts";

export interface ProfileOptions {
  // Extra markup for the page's head and the end of its body.
  head?: string;
  body?: string;
  // Extra files to serve, by path.
  files?: Record<string, { type: string; body: string }>;
}

const { head = "", body = "", files = {} } = options<ProfileOptions>();

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Profile</title>
    ${head}
  </head>
  <body>
    <h1>Profile</h1>
    <dl>
      <dt>Name:</dt>
      <dd id="name"></dd>
    </dl>
    <script>
      window.trustedScopes?.createScope("pii").then((pii) => document.getElementById("name").append(pii.createFrame("/name")));
    </script>
    ${body}
  </body>
</html>
`;

serve(async ({ url }) => {
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/profile") {
    return { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: page };
  }
  const file = Object.hasOwn(files, pathname) ? files[pathname] : undefined;
  if (file) return { status: 200, headers: { "Content-Type": file.type }, body: file.body };
  return { status: 404, headers: {} as Record<string, string>, body: "" };
});
