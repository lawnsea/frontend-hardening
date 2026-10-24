import type { FromFrame, ToFrame } from "./frame.ts";

// A form control whose plaintext lives only in a sandbox frame. Its value is
// ciphertext.
export class SandboxInput extends HTMLElement {
  static formAssociated = true;

  #internals = this.attachInternals();
  #value = "";
  #port: MessagePort | null = null;

  constructor() {
    super();
    const iframe = document.createElement("iframe");
    iframe.src = "/sandbox/input";
    iframe.addEventListener("load", () => this.#connect(iframe), { once: true });

    const style = document.createElement("style");
    style.textContent = `
      :host { display: inline-block; height: 1.5em; }
      iframe { border: 0; width: 100%; height: 100%; }
    `;
    this.attachShadow({ mode: "closed" }).append(style, iframe);
  }

  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    this.#update(value);
    this.#send({ type: "set", value });
  }

  #connect(iframe: HTMLIFrameElement): void {
    const { port1, port2 } = new MessageChannel();
    // The frame has an opaque origin, so no target origin can name it.
    iframe.contentWindow!.postMessage(null, "*", [port2]);
    port1.onmessage = ({ data }: MessageEvent<FromFrame>) => {
      if (data.type === "change") {
        this.#update(data.value);
        this.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    this.#port = port1;
    this.#send({ type: "set", value: this.#value });
  }

  #update(value: string): void {
    this.#value = value;
    this.#internals.setFormValue(value);
  }

  #send(message: ToFrame): void {
    this.#port?.postMessage(message);
  }
}
