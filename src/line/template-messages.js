import { datetimePickerAction, messageAction, postbackAction, uriAction } from "./actions.js";

export { datetimePickerAction, messageAction, postbackAction, uriAction };
export function createConfirmTemplate(text, confirmAction, cancelAction, altText) {
  const template = {
    type: "confirm",
    text: text.slice(0, 240),
    actions: [confirmAction, cancelAction],
  };
  return {
    type: "template",
    altText: altText?.slice(0, 400) ?? text.slice(0, 400),
    template,
  };
}
export function createButtonTemplate(title, text, actions, options) {
  const hasThumbnail = Boolean(options?.thumbnailImageUrl?.trim());
  const textLimit = hasThumbnail ? 160 : 60;
  const template = {
    type: "buttons",
    title: title.slice(0, 40),
    text: text.slice(0, textLimit),
    actions: actions.slice(0, 4),
    thumbnailImageUrl: options?.thumbnailImageUrl,
    imageAspectRatio: options?.imageAspectRatio ?? "rectangle",
    imageSize: options?.imageSize ?? "cover",
    imageBackgroundColor: options?.imageBackgroundColor,
    defaultAction: options?.defaultAction,
  };
  return {
    type: "template",
    altText: options?.altText?.slice(0, 400) ?? `${title}: ${text}`.slice(0, 400),
    template,
  };
}
export function createTemplateCarousel(columns, options) {
  const template = {
    type: "carousel",
    columns: columns.slice(0, 10),
    imageAspectRatio: options?.imageAspectRatio ?? "rectangle",
    imageSize: options?.imageSize ?? "cover",
  };
  return {
    type: "template",
    altText: options?.altText?.slice(0, 400) ?? "View carousel",
    template,
  };
}
export function createCarouselColumn(params) {
  return {
    title: params.title?.slice(0, 40),
    text: params.text.slice(0, 120),
    actions: params.actions.slice(0, 3),
    thumbnailImageUrl: params.thumbnailImageUrl,
    imageBackgroundColor: params.imageBackgroundColor,
    defaultAction: params.defaultAction,
  };
}
export function createImageCarousel(columns, altText) {
  const template = {
    type: "image_carousel",
    columns: columns.slice(0, 10),
  };
  return {
    type: "template",
    altText: altText?.slice(0, 400) ?? "View images",
    template,
  };
}
export function createImageCarouselColumn(imageUrl, action) {
  return {
    imageUrl,
    action,
  };
}
export function createYesNoConfirm(question, options) {
  const yesAction = options?.yesData
    ? postbackAction(options.yesText ?? "Yes", options.yesData, options.yesText ?? "Yes")
    : messageAction(options?.yesText ?? "Yes");
  const noAction = options?.noData
    ? postbackAction(options.noText ?? "No", options.noData, options.noText ?? "No")
    : messageAction(options?.noText ?? "No");
  return createConfirmTemplate(question, yesAction, noAction, options?.altText);
}
export function createButtonMenu(title, text, buttons, options) {
  const actions = buttons.slice(0, 4).map((btn) => messageAction(btn.label, btn.text));
  return createButtonTemplate(title, text, actions, {
    thumbnailImageUrl: options?.thumbnailImageUrl,
    altText: options?.altText,
  });
}
export function createLinkMenu(title, text, links, options) {
  const actions = links.slice(0, 4).map((link) => uriAction(link.label, link.url));
  return createButtonTemplate(title, text, actions, {
    thumbnailImageUrl: options?.thumbnailImageUrl,
    altText: options?.altText,
  });
}
export function createProductCarousel(products, altText) {
  const columns = products.slice(0, 10).map((product) => {
    const actions = [];
    if (product.actionUrl) {
      actions.push(uriAction(product.actionLabel ?? "View", product.actionUrl));
    } else if (product.actionData) {
      actions.push(postbackAction(product.actionLabel ?? "Select", product.actionData));
    } else {
      actions.push(messageAction(product.actionLabel ?? "Select", product.title));
    }
    return createCarouselColumn({
      title: product.title,
      text: product.price
        ? `${product.description}\n${product.price}`.slice(0, 120)
        : product.description,
      thumbnailImageUrl: product.imageUrl,
      actions,
    });
  });
  return createTemplateCarousel(columns, { altText });
}
export function buildTemplateMessageFromPayload(payload) {
  switch (payload.type) {
    case "confirm": {
      const confirmAction = payload.confirmData.startsWith("http")
        ? uriAction(payload.confirmLabel, payload.confirmData)
        : payload.confirmData.includes("=")
          ? postbackAction(payload.confirmLabel, payload.confirmData, payload.confirmLabel)
          : messageAction(payload.confirmLabel, payload.confirmData);
      const cancelAction = payload.cancelData.startsWith("http")
        ? uriAction(payload.cancelLabel, payload.cancelData)
        : payload.cancelData.includes("=")
          ? postbackAction(payload.cancelLabel, payload.cancelData, payload.cancelLabel)
          : messageAction(payload.cancelLabel, payload.cancelData);
      return createConfirmTemplate(payload.text, confirmAction, cancelAction, payload.altText);
    }
    case "buttons": {
      const actions = payload.actions.slice(0, 4).map((action) => {
        if (action.type === "uri" && action.uri) {
          return uriAction(action.label, action.uri);
        }
        if (action.type === "postback" && action.data) {
          return postbackAction(action.label, action.data, action.label);
        }
        return messageAction(action.label, action.data ?? action.label);
      });
      return createButtonTemplate(payload.title, payload.text, actions, {
        thumbnailImageUrl: payload.thumbnailImageUrl,
        altText: payload.altText,
      });
    }
    case "carousel": {
      const columns = payload.columns.slice(0, 10).map((col) => {
        const colActions = col.actions.slice(0, 3).map((action) => {
          if (action.type === "uri" && action.uri) {
            return uriAction(action.label, action.uri);
          }
          if (action.type === "postback" && action.data) {
            return postbackAction(action.label, action.data, action.label);
          }
          return messageAction(action.label, action.data ?? action.label);
        });
        return createCarouselColumn({
          title: col.title,
          text: col.text,
          thumbnailImageUrl: col.thumbnailImageUrl,
          actions: colActions,
        });
      });
      return createTemplateCarousel(columns, { altText: payload.altText });
    }
    default:
      return null;
  }
}
