/**
 * @typedef {object} SetupStepBase
 * @property {string} id - Unique step identifier
 * @property {"qr-scan"|"token-input"|"pairing-input"|"prereq"|"info"} type
 * @property {string} title
 * @property {string} description
 * @property {object} [showIf] - Condition: { stepId, eq } or { stateKey, eq }
 * @property {object} [skipIf] - Condition: { stateKey, eq }
 * @property {boolean} [required]
 */

/**
 * @typedef {object} ChannelSetupDescriptor
 * @property {string} channel
 * @property {string} title
 * @property {SetupStepBase[]} steps
 */

/**
 * @typedef {object} ChannelSetupModule
 * @property {ChannelSetupDescriptor} descriptor
 * @property {(cfg: object, accountId?: string) => Promise<object>} resolveState
 * @property {(cfg: object, answers: Record<string, string>, state: object) => object} apply
 */

/** @type {Record<string, () => Promise<ChannelSetupModule>>} */
const CHANNEL_SETUP_REGISTRY = {
  whatsapp: () => import("./whatsapp.js"),
  telegram: () => import("./telegram.js"),
};

/**
 * Load setup module for a channel.
 * @param {string} channel
 * @returns {Promise<ChannelSetupModule | null>}
 */
export const loadChannelSetup = async (channel) => {
  const loader = CHANNEL_SETUP_REGISTRY[channel?.toLowerCase()];
  if (!loader) {
    return null;
  }
  return await loader();
};

/**
 * List channels that have setup descriptors available.
 * @returns {string[]}
 */
export const listSetupChannels = () => Object.keys(CHANNEL_SETUP_REGISTRY);
