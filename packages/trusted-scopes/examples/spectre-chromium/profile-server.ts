// The untrusted profile server. It renders the profile page with the user's name
// encrypted for the page's session, and shows it in a frame of the trusted "pii"
// scope, which decrypts it.
import { options, request, serve } from "./ipc.ts";

export interface ProfileOptions {
  // Extra markup for the page's head and the end of its body.
  head?: string;
  body?: string;
  // Extra files to serve, by path.
  files?: Record<string, { type: string; body: string }>;
}

const { head = "", body = "", files = {} } = options<ProfileOptions>();

const page = (name: string) => `<!doctype html>
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
      <dd id="name" data-ciphertext="${name}"></dd>
    </dl>
    <script>
      window.trustedScopes?.createScope("pii").then((pii) => {
        const name = document.getElementById("name");
        name.append(pii.createFrame("/" + name.dataset.ciphertext));
      });
    </script>
    ${body}
  </body>
</html>
`;

serve(async ({ url, session }) => {
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/profile") {
    const name = await request("pii", `/trusted-scopes/pii/ciphertext?session=${session}`);
    return { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: page(name.body) };
  }
  const file = Object.hasOwn(files, pathname) ? files[pathname] : undefined;
  if (file) return { status: 200, headers: { "Content-Type": file.type }, body: file.body };
  return { status: 404, headers: {} as Record<string, string>, body: "" };
});
