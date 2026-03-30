import { registerQrCli } from "./qr-cli.js";
export function registerClawbotCli(program) {
  const clawbot = program.command("clawbot").description("Legacy clawbot command aliases");
  registerQrCli(clawbot);
}
