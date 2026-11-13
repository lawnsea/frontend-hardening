// Runs a server module as a subprocess of the router, which forwards it requests
// over IPC. A server can send requests to other servers the same way.

export interface Request {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  // The server that sent the request; undefined for the browser.
  from?: string;
  // The session the router verified or created for the request.
  session?: string;
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const pending = new Map<number, (response: Response) => void>();
let nextId = 0;

export function serve(handle: (request: Request) => Promise<Response>): void {
  process.on("message", async (message: { id: number; request?: Request; reply?: Response }) => {
    if (message.request) {
      process.send!({ id: message.id, response: await handle(message.request) });
    } else if (message.reply) {
      pending.get(message.id)!(message.reply);
      pending.delete(message.id);
    }
  });
  process.on("disconnect", () => process.exit());
}

// Sends a GET request for url to the named server, through the router.
export function request(server: string, url: string): Promise<Response> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    process.send!({ id, fetch: { server, url } });
  });
}

// Records an event in the router's log.
export function log(event: string): void {
  process.send!({ log: event });
}

// The options the router passed this server.
export function options<T>(): T {
  return JSON.parse(process.argv[2] ?? "{}");
}
