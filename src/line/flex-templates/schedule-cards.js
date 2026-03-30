let buildTitleSubtitleHeader = function (params) {
    const { title, subtitle } = params;
    const headerContents = [
      {
        type: "text",
        text: title,
        weight: "bold",
        size: "xl",
        color: "#111111",
        wrap: true,
      },
    ];
    if (subtitle) {
      headerContents.push({
        type: "text",
        text: subtitle,
        size: "sm",
        color: "#888888",
        margin: "sm",
        wrap: true,
      });
    }
    return headerContents;
  },
  buildCardHeaderSections = function (headerContents) {
    return [
      {
        type: "box",
        layout: "vertical",
        contents: headerContents,
        paddingBottom: "lg",
      },
      {
        type: "separator",
        color: "#EEEEEE",
      },
    ];
  },
  createMegaBubbleWithFooter = function (params) {
    const bubble = {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        contents: params.bodyContents,
        paddingAll: "xl",
        backgroundColor: "#FFFFFF",
      },
    };
    if (params.footer) {
      attachFooterText(bubble, params.footer);
    }
    return bubble;
  };
import { attachFooterText } from "./common.js";
export function createReceiptCard(params) {
  const { title, subtitle, items, total, footer } = params;
  const itemRows = items.slice(0, 12).map((item, index) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: item.name,
        size: "sm",
        color: item.highlight ? "#111111" : "#666666",
        weight: item.highlight ? "bold" : "regular",
        flex: 3,
        wrap: true,
      },
      {
        type: "text",
        text: item.value,
        size: "sm",
        color: item.highlight ? "#06C755" : "#333333",
        weight: item.highlight ? "bold" : "regular",
        flex: 2,
        align: "end",
        wrap: true,
      },
    ],
    paddingAll: "md",
    backgroundColor: index % 2 === 0 ? "#FFFFFF" : "#FAFAFA",
  }));
  const headerContents = buildTitleSubtitleHeader({ title, subtitle });
  const bodyContents = [
    ...buildCardHeaderSections(headerContents),
    {
      type: "box",
      layout: "vertical",
      contents: itemRows,
      margin: "md",
      cornerRadius: "md",
      borderWidth: "light",
      borderColor: "#EEEEEE",
    },
  ];
  if (total) {
    bodyContents.push({
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "text",
          text: total.label,
          size: "lg",
          weight: "bold",
          color: "#111111",
          flex: 2,
        },
        {
          type: "text",
          text: total.value,
          size: "xl",
          weight: "bold",
          color: "#06C755",
          flex: 2,
          align: "end",
        },
      ],
      margin: "xl",
      paddingAll: "lg",
      backgroundColor: "#F0FDF4",
      cornerRadius: "lg",
    });
  }
  return createMegaBubbleWithFooter({ bodyContents, footer });
}
export function createEventCard(params) {
  const { title, date, time, location, description, calendar, isAllDay, action } = params;
  const dateBlock = {
    type: "box",
    layout: "vertical",
    contents: [
      {
        type: "text",
        text: date.toUpperCase(),
        size: "sm",
        weight: "bold",
        color: "#06C755",
        wrap: true,
      },
      {
        type: "text",
        text: isAllDay ? "ALL DAY" : (time ?? ""),
        size: "xxl",
        weight: "bold",
        color: "#111111",
        wrap: true,
        margin: "xs",
      },
    ],
    paddingBottom: "lg",
    borderWidth: "none",
  };
  if (!time && !isAllDay) {
    dateBlock.contents = [
      {
        type: "text",
        text: date,
        size: "xl",
        weight: "bold",
        color: "#111111",
        wrap: true,
      },
    ];
  }
  const titleBlock = {
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
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: title,
            size: "lg",
            weight: "bold",
            color: "#1a1a1a",
            wrap: true,
          },
          ...(calendar
            ? [
                {
                  type: "text",
                  text: calendar,
                  size: "xs",
                  color: "#888888",
                  margin: "sm",
                  wrap: true,
                },
              ]
            : []),
        ],
        flex: 1,
        paddingStart: "lg",
      },
    ],
    paddingTop: "lg",
    paddingBottom: "lg",
    borderWidth: "light",
    borderColor: "#EEEEEE",
  };
  const bodyContents = [dateBlock, titleBlock];
  const hasDetails = location || description;
  if (hasDetails) {
    const detailItems = [];
    if (location) {
      detailItems.push({
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: "\uD83D\uDCCD",
            size: "sm",
            flex: 0,
          },
          {
            type: "text",
            text: location,
            size: "sm",
            color: "#444444",
            margin: "md",
            flex: 1,
            wrap: true,
          },
        ],
        alignItems: "flex-start",
      });
    }
    if (description) {
      detailItems.push({
        type: "text",
        text: description,
        size: "sm",
        color: "#666666",
        wrap: true,
        margin: location ? "lg" : "none",
      });
    }
    bodyContents.push({
      type: "box",
      layout: "vertical",
      contents: detailItems,
      margin: "lg",
      paddingAll: "lg",
      backgroundColor: "#F8F9FA",
      cornerRadius: "lg",
    });
  }
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      contents: bodyContents,
      paddingAll: "xl",
      backgroundColor: "#FFFFFF",
      action,
    },
  };
}
export function createAgendaCard(params) {
  const { title, subtitle, events, footer } = params;
  const headerContents = buildTitleSubtitleHeader({ title, subtitle });
  const eventItems = events.slice(0, 6).map((event, index) => {
    const isActive = event.isNow || index === 0;
    const accentColor = isActive ? "#06C755" : "#E5E5E5";
    const timeColumn = {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: event.time ?? "\u2014",
          size: "sm",
          weight: isActive ? "bold" : "regular",
          color: isActive ? "#06C755" : "#666666",
          align: "end",
          wrap: true,
        },
      ],
      width: "65px",
      justifyContent: "flex-start",
    };
    const dotColumn = {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [],
          width: "10px",
          height: "10px",
          backgroundColor: accentColor,
          cornerRadius: "5px",
        },
      ],
      width: "24px",
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: "xs",
    };
    const detailContents = [
      {
        type: "text",
        text: event.title,
        size: "md",
        weight: "bold",
        color: "#1a1a1a",
        wrap: true,
      },
    ];
    const secondaryParts = [];
    if (event.location) {
      secondaryParts.push(event.location);
    }
    if (event.calendar) {
      secondaryParts.push(event.calendar);
    }
    if (secondaryParts.length > 0) {
      detailContents.push({
        type: "text",
        text: secondaryParts.join(" \xB7 "),
        size: "xs",
        color: "#888888",
        wrap: true,
        margin: "xs",
      });
    }
    const detailColumn = {
      type: "box",
      layout: "vertical",
      contents: detailContents,
      flex: 1,
    };
    return {
      type: "box",
      layout: "horizontal",
      contents: [timeColumn, dotColumn, detailColumn],
      margin: index > 0 ? "xl" : undefined,
      alignItems: "flex-start",
    };
  });
  const bodyContents = [
    ...buildCardHeaderSections(headerContents),
    {
      type: "box",
      layout: "vertical",
      contents: eventItems,
      paddingTop: "xl",
    },
  ];
  return createMegaBubbleWithFooter({ bodyContents, footer });
}
