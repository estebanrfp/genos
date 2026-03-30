import { RefreshingAuthProvider, StaticAuthProvider } from "@twurple/auth";
import { ChatClient, LogLevel } from "@twurple/chat";
import { resolveTwitchToken } from "./token.js";
import { normalizeToken } from "./utils/twitch.js";

export class TwitchClientManager {
  logger;
  clients = new Map();
  messageHandlers = new Map();
  constructor(logger) {
    this.logger = logger;
  }
  async createAuthProvider(account, normalizedToken) {
    if (!account.clientId) {
      throw new Error("Missing Twitch client ID");
    }
    if (account.clientSecret) {
      const authProvider = new RefreshingAuthProvider({
        clientId: account.clientId,
        clientSecret: account.clientSecret,
      });
      await authProvider
        .addUserForToken({
          accessToken: normalizedToken,
          refreshToken: account.refreshToken ?? null,
          expiresIn: account.expiresIn ?? null,
          obtainmentTimestamp: account.obtainmentTimestamp ?? Date.now(),
        })
        .then((userId) => {
          this.logger.info(
            `Added user ${userId} to RefreshingAuthProvider for ${account.username}`,
          );
        })
        .catch((err) => {
          this.logger.error(
            `Failed to add user to RefreshingAuthProvider: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      authProvider.onRefresh((userId, token) => {
        this.logger.info(
          `Access token refreshed for user ${userId} (expires in ${token.expiresIn ? `${token.expiresIn}s` : "unknown"})`,
        );
      });
      authProvider.onRefreshFailure((userId, error) => {
        this.logger.error(`Failed to refresh access token for user ${userId}: ${error.message}`);
      });
      const refreshStatus = account.refreshToken
        ? "automatic token refresh enabled"
        : "token refresh disabled (no refresh token)";
      this.logger.info(`Using RefreshingAuthProvider for ${account.username} (${refreshStatus})`);
      return authProvider;
    }
    this.logger.info(`Using StaticAuthProvider for ${account.username} (no clientSecret provided)`);
    return new StaticAuthProvider(account.clientId, normalizedToken);
  }
  async getClient(account, cfg, accountId) {
    const key = this.getAccountKey(account);
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }
    const tokenResolution = resolveTwitchToken(cfg, {
      accountId,
    });
    if (!tokenResolution.token) {
      this.logger.error(
        `Missing Twitch token for account ${account.username} (set channels.twitch.accounts.${account.username}.token or GENOS_TWITCH_ACCESS_TOKEN for default)`,
      );
      throw new Error("Missing Twitch token");
    }
    this.logger.debug?.(`Using ${tokenResolution.source} token source for ${account.username}`);
    if (!account.clientId) {
      this.logger.error(`Missing Twitch client ID for account ${account.username}`);
      throw new Error("Missing Twitch client ID");
    }
    const normalizedToken = normalizeToken(tokenResolution.token);
    const authProvider = await this.createAuthProvider(account, normalizedToken);
    const client = new ChatClient({
      authProvider,
      channels: [account.channel],
      rejoinChannelsOnReconnect: true,
      requestMembershipEvents: true,
      logger: {
        minLevel: LogLevel.WARNING,
        custom: {
          log: (level, message) => {
            switch (level) {
              case LogLevel.CRITICAL:
                this.logger.error(message);
                break;
              case LogLevel.ERROR:
                this.logger.error(message);
                break;
              case LogLevel.WARNING:
                this.logger.warn(message);
                break;
              case LogLevel.INFO:
                this.logger.info(message);
                break;
              case LogLevel.DEBUG:
                this.logger.debug?.(message);
                break;
              case LogLevel.TRACE:
                this.logger.debug?.(message);
                break;
            }
          },
        },
      },
    });
    this.setupClientHandlers(client, account);
    client.connect();
    this.clients.set(key, client);
    this.logger.info(`Connected to Twitch as ${account.username}`);
    return client;
  }
  setupClientHandlers(client, account) {
    const key = this.getAccountKey(account);
    client.onMessage((channelName, _user, messageText, msg) => {
      const handler = this.messageHandlers.get(key);
      if (handler) {
        const normalizedChannel = channelName.startsWith("#") ? channelName.slice(1) : channelName;
        const from = `twitch:${msg.userInfo.userName}`;
        const preview = messageText.slice(0, 100).replace(/\n/g, "\\n");
        this.logger.debug?.(
          `twitch inbound: channel=${normalizedChannel} from=${from} len=${messageText.length} preview="${preview}"`,
        );
        handler({
          username: msg.userInfo.userName,
          displayName: msg.userInfo.displayName,
          userId: msg.userInfo.userId,
          message: messageText,
          channel: normalizedChannel,
          id: msg.id,
          timestamp: new Date(),
          isMod: msg.userInfo.isMod,
          isOwner: msg.userInfo.isBroadcaster,
          isVip: msg.userInfo.isVip,
          isSub: msg.userInfo.isSubscriber,
          chatType: "group",
        });
      }
    });
    this.logger.info(`Set up handlers for ${key}`);
  }
  onMessage(account, handler) {
    const key = this.getAccountKey(account);
    this.messageHandlers.set(key, handler);
    return () => {
      this.messageHandlers.delete(key);
    };
  }
  async disconnect(account) {
    const key = this.getAccountKey(account);
    const client = this.clients.get(key);
    if (client) {
      client.quit();
      this.clients.delete(key);
      this.messageHandlers.delete(key);
      this.logger.info(`Disconnected ${key}`);
    }
  }
  async disconnectAll() {
    this.clients.forEach((client) => client.quit());
    this.clients.clear();
    this.messageHandlers.clear();
    this.logger.info(" Disconnected all clients");
  }
  async sendMessage(account, channel, message, cfg, accountId) {
    try {
      const client = await this.getClient(account, cfg, accountId);
      const messageId = crypto.randomUUID();
      await client.say(channel, message);
      return { ok: true, messageId };
    } catch (error) {
      this.logger.error(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  getAccountKey(account) {
    return `${account.username}:${account.channel}`;
  }
  _clearForTest() {
    this.clients.clear();
    this.messageHandlers.clear();
  }
}
