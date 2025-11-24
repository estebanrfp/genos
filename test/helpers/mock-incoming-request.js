import { EventEmitter } from "node:events";
export function createMockIncomingRequest(chunks) {
  const req = new EventEmitter();
  req.destroyed = false;
  req.headers = {};
  req.destroy = () => {
    req.destroyed = true;
    return req;
  };
  Promise.resolve().then(() => {
    for (const chunk of chunks) {
      req.emit("data", Buffer.from(chunk, "utf-8"));
      if (req.destroyed) {
        return;
      }
    }
    req.emit("end");
  });
  return req;
}
