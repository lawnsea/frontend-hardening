// Runs a server module as a subprocess of the router, which forwards it requests
// over IPC.

export interface Request {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  // "router" for the router's own requests; undefined for the browser's.
  from?: "router";
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function serve(handle: (request: Request) => Promise<Response>): void {
  process.on("message", async (message: { id: number; request: Request }) => {
    process.send!({ id: message.id, response: await handle(message.request) });
  });
  process.on("disconnect", () => process.exit());
}

// Records an event in the router's log.
export function log(event: string): void {
  process.send!({ log: event });
}

// The options the router passed this server.
export function options<T>(): T {
  return JSON.parse(process.argv[2] ?? "{}");
}
