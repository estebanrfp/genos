import { afterAll, beforeAll } from "vitest";
import { startServerWithClient } from "./test-helpers.js";
import { connectOk } from "./test-helpers.js";
export async function withServer(run) {
  const { server, ws, envSnapshot } = await startServerWithClient("secret");
  try {
    return await run(ws);
  } finally {
    ws.close();
    await server.close();
    envSnapshot.restore();
  }
}
export function installConnectedControlUiServerSuite(onReady) {
  let started = null;
  beforeAll(async () => {
    started = await startServerWithClient(undefined, { controlUiEnabled: true });
    onReady({
      server: started.server,
      ws: started.ws,
      port: started.port,
    });
    await connectOk(started.ws);
  });
  afterAll(async () => {
    started?.ws.close();
    if (started?.server) {
      await started.server.close();
    }
  });
}
