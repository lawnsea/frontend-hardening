import { decrypt, encrypt, importKey } from "./crypto.ts";

export type ToFrame = { type: "set"; value: string };
export type FromFrame = { type: "change"; value: string };

// Runs inside the sandbox frame. The worker inlines it with
// Function.prototype.toString, so it may reference only its parameters and
// the functions in crypto.ts.
export function frameMain(rawKey: string): void {
  const field = document.querySelector("input")!;
  const key = importKey(rawKey);

  addEventListener("message", (event) => {
    const port = event.ports[0];
    if (event.source !== parent || !port) return;

    port.onmessage = async ({ data }: MessageEvent<ToFrame>) => {
      if (data.type === "set") {
        field.value = data.value === "" ? "" : await decrypt(await key, data.value);
      }
    };

    // Encrypt in input order, so the last message carries the latest value.
    let sent = Promise.resolve();
    field.addEventListener("input", () => {
      const plaintext = field.value;
      sent = sent.then(async () => {
        const message: FromFrame = { type: "change", value: await encrypt(await key, plaintext) };
        port.postMessage(message);
      });
    });
  }, { once: true });
}
