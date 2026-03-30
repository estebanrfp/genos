import { attachFooterText } from "./common.js";
export function createInfoCard(title, body, footer) {
  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "box",
              layout: "vertical",
              contents: [],
              width: "4px",
              backgroundColor: "#06C755",
              cornerRadius: "2px",
            },
            {
              type: "text",
              text: title,
              weight: "bold",
              size: "xl",
              color: "#111111",
              wrap: true,
              flex: 1,
              margin: "lg",
            },
          ],
        },
        {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: body,
              size: "md",
              color: "#444444",
              wrap: true,
              lineSpacing: "6px",
            },
          ],
          margin: "xl",
          paddingAll: "lg",
          backgroundColor: "#F8F9FA",
          cornerRadius: "lg",
        },
      ],
      paddingAll: "xl",
      backgroundColor: "#FFFFFF",
    },
  };
  if (footer) {
    attachFooterText(bubble, footer);
  }
  return bubble;
}
export function createListCard(title, items) {
  const itemContents = items.slice(0, 8).map((item, index) => {
    const itemContents = [
      {
        type: "text",
        text: item.title,
        size: "md",
        weight: "bold",
        color: "#1a1a1a",
        wrap: true,
      },
    ];
    if (item.subtitle) {
      itemContents.push({
        type: "text",
        text: item.subtitle,
        size: "sm",
        color: "#888888",
        wrap: true,
        margin: "xs",
      });
    }
    const itemBox = {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "box",
              layout: "vertical",
              contents: [],
              width: "8px",
              height: "8px",
              backgroundColor: index === 0 ? "#06C755" : "#DDDDDD",
              cornerRadius: "4px",
            },
          ],
          width: "20px",
          alignItems: "center",
          paddingTop: "sm",
        },
        {
          type: "box",
          layout: "vertical",
          contents: itemContents,
          flex: 1,
        },
      ],
      margin: index > 0 ? "lg" : undefined,
    };
    if (item.action) {
      itemBox.action = item.action;
    }
    return itemBox;
  });
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: title,
          weight: "bold",
          size: "xl",
          color: "#111111",
          wrap: true,
        },
        {
          type: "separator",
          margin: "lg",
          color: "#EEEEEE",
        },
        {
          type: "box",
          layout: "vertical",
          contents: itemContents,
          margin: "lg",
        },
      ],
      paddingAll: "xl",
      backgroundColor: "#FFFFFF",
    },
  };
}
export function createImageCard(imageUrl, title, body, options) {
  const bubble = {
    type: "bubble",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: options?.aspectRatio ?? "20:13",
      aspectMode: options?.aspectMode ?? "cover",
      action: options?.action,
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: title,
          weight: "bold",
          size: "xl",
          wrap: true,
        },
      ],
      paddingAll: "lg",
    },
  };
  if (body && bubble.body) {
    bubble.body.contents.push({
      type: "text",
      text: body,
      size: "md",
      wrap: true,
      margin: "md",
      color: "#666666",
    });
  }
  return bubble;
}
export function createActionCard(title, body, actions, options) {
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: title,
          weight: "bold",
          size: "xl",
          wrap: true,
        },
        {
          type: "text",
          text: body,
          size: "md",
          wrap: true,
          margin: "md",
          color: "#666666",
        },
      ],
      paddingAll: "lg",
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: actions.slice(0, 4).map((action, index) => ({
        type: "button",
        action: action.action,
        style: index === 0 ? "primary" : "secondary",
        margin: index > 0 ? "sm" : undefined,
      })),
      paddingAll: "md",
    },
  };
  if (options?.imageUrl) {
    bubble.hero = {
      type: "image",
      url: options.imageUrl,
      size: "full",
      aspectRatio: options.aspectRatio ?? "20:13",
      aspectMode: "cover",
    };
  }
  return bubble;
}
export function createCarousel(bubbles) {
  return {
    type: "carousel",
    contents: bubbles.slice(0, 12),
  };
}
export function createNotificationBubble(text, options) {
  const colors = {
    info: { accent: "#3B82F6", bg: "#EFF6FF" },
    success: { accent: "#06C755", bg: "#F0FDF4" },
    warning: { accent: "#F59E0B", bg: "#FFFBEB" },
    error: { accent: "#EF4444", bg: "#FEF2F2" },
  };
  const typeColors = colors[options?.type ?? "info"];
  const contents = [];
  contents.push({
    type: "box",
    layout: "vertical",
    contents: [],
    width: "4px",
    backgroundColor: typeColors.accent,
    cornerRadius: "2px",
  });
  const textContents = [];
  if (options?.title) {
    textContents.push({
      type: "text",
      text: options.title,
      size: "md",
      weight: "bold",
      color: "#111111",
      wrap: true,
    });
  }
  textContents.push({
    type: "text",
    text,
    size: options?.title ? "sm" : "md",
    color: options?.title ? "#666666" : "#333333",
    wrap: true,
    margin: options?.title ? "sm" : undefined,
  });
  contents.push({
    type: "box",
    layout: "vertical",
    contents: textContents,
    flex: 1,
    paddingStart: "lg",
  });
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "horizontal",
      contents,
      paddingAll: "xl",
      backgroundColor: typeColors.bg,
    },
  };
}
