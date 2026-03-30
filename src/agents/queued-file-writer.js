import fs from "node:fs/promises";
import path from "node:path";
export function getQueuedFileWriter(writers, filePath) {
  const existing = writers.get(filePath);
  if (existing) {
    return existing;
  }
  const dir = path.dirname(filePath);
  const ready = fs.mkdir(dir, { recursive: true }).catch(() => {
    return;
  });
  let queue = Promise.resolve();
  const writer = {
    filePath,
    write: (line) => {
      queue = queue
        .then(() => ready)
        .then(() => fs.appendFile(filePath, line, "utf8"))
        .catch(() => {
          return;
        });
    },
  };
  writers.set(filePath, writer);
  return writer;
}
