import { SandboxInput } from "./sandbox-input.ts";

// Without a controlling worker, /api/profile returns plaintext.
async function controlled(): Promise<void> {
  await navigator.serviceWorker.register("/sw.js", { type: "module", scope: "/" });
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve) =>
    navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
  );
}

// The element loads its frame on creation, and only the worker serves frames.
await controlled();
customElements.define("sandbox-input", SandboxInput);

const form = document.querySelector("form")!;
const name = form.elements.namedItem("name") as HTMLInputElement;
const ssn = form.querySelector<SandboxInput>("sandbox-input")!;
const seen = document.querySelector("output")!;

const profile = await (await fetch("/api/profile")).json();
name.value = profile.name;
ssn.value = profile.ssn;
seen.value = ssn.value;
ssn.addEventListener("input", () => (seen.value = ssn.value));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  form.dataset.saved = "";
});
