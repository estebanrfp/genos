import { finalizeEvent, SimplePool } from "nostr-tools";
import { NostrProfileSchema } from "./config-schema.js";
export function profileToContent(profile) {
  const validated = NostrProfileSchema.parse(profile);
  const content = {};
  if (validated.name !== undefined) {
    content.name = validated.name;
  }
  if (validated.displayName !== undefined) {
    content.display_name = validated.displayName;
  }
  if (validated.about !== undefined) {
    content.about = validated.about;
  }
  if (validated.picture !== undefined) {
    content.picture = validated.picture;
  }
  if (validated.banner !== undefined) {
    content.banner = validated.banner;
  }
  if (validated.website !== undefined) {
    content.website = validated.website;
  }
  if (validated.nip05 !== undefined) {
    content.nip05 = validated.nip05;
  }
  if (validated.lud16 !== undefined) {
    content.lud16 = validated.lud16;
  }
  return content;
}
export function contentToProfile(content) {
  const profile = {};
  if (content.name !== undefined) {
    profile.name = content.name;
  }
  if (content.display_name !== undefined) {
    profile.displayName = content.display_name;
  }
  if (content.about !== undefined) {
    profile.about = content.about;
  }
  if (content.picture !== undefined) {
    profile.picture = content.picture;
  }
  if (content.banner !== undefined) {
    profile.banner = content.banner;
  }
  if (content.website !== undefined) {
    profile.website = content.website;
  }
  if (content.nip05 !== undefined) {
    profile.nip05 = content.nip05;
  }
  if (content.lud16 !== undefined) {
    profile.lud16 = content.lud16;
  }
  return profile;
}
export function createProfileEvent(sk, profile, lastPublishedAt) {
  const content = profileToContent(profile);
  const contentJson = JSON.stringify(content);
  const now = Math.floor(Date.now() / 1000);
  const createdAt = lastPublishedAt !== undefined ? Math.max(now, lastPublishedAt + 1) : now;
  const event = finalizeEvent(
    {
      kind: 0,
      content: contentJson,
      tags: [],
      created_at: createdAt,
    },
    sk,
  );
  return event;
}
const RELAY_PUBLISH_TIMEOUT_MS = 5000;
export async function publishProfileEvent(pool, relays, event) {
  const successes = [];
  const failures = [];
  const publishPromises = relays.map(async (relay) => {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), RELAY_PUBLISH_TIMEOUT_MS);
      });
      await Promise.race([pool.publish([relay], event), timeoutPromise]);
      successes.push(relay);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      failures.push({ relay, error: errorMessage });
    }
  });
  await Promise.all(publishPromises);
  return {
    eventId: event.id,
    successes,
    failures,
    createdAt: event.created_at,
  };
}
export async function publishProfile(pool, sk, relays, profile, lastPublishedAt) {
  const event = createProfileEvent(sk, profile, lastPublishedAt);
  return publishProfileEvent(pool, relays, event);
}
export function validateProfile(profile) {
  const result = NostrProfileSchema.safeParse(profile);
  if (result.success) {
    return { valid: true, profile: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}
export function sanitizeProfileForDisplay(profile) {
  const escapeHtml = (str) => {
    if (str === undefined) {
      return;
    }
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };
  return {
    name: escapeHtml(profile.name),
    displayName: escapeHtml(profile.displayName),
    about: escapeHtml(profile.about),
    picture: profile.picture,
    banner: profile.banner,
    website: profile.website,
    nip05: escapeHtml(profile.nip05),
    lud16: escapeHtml(profile.lud16),
  };
}
