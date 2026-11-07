// Records what the trusted worker's code passes to Uint8Array.fromBase64, which
// includes its key, and the fetch handlers it registers.
self.stolen = [];
self.fetchHandlers = [];

const { addEventListener } = self;
self.addEventListener = function (type, handler) {
  if (type === "fetch") self.fetchHandlers.push(handler);
  return addEventListener.call(this, type, handler);
};

const { fromBase64 } = Uint8Array;
Uint8Array.fromBase64 = function (string, options) {
  self.stolen.push(string);
  return fromBase64.call(this, string, options);
};
