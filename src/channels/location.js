let resolveLocation = function (location) {
    const source =
      location.source ??
      (location.isLive ? "live" : location.name || location.address ? "place" : "pin");
    const isLive = Boolean(location.isLive ?? source === "live");
    return { ...location, source, isLive };
  },
  formatAccuracy = function (accuracy) {
    if (!Number.isFinite(accuracy)) {
      return "";
    }
    return ` \xB1${Math.round(accuracy ?? 0)}m`;
  },
  formatCoords = function (latitude, longitude) {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  };
export function formatLocationText(location) {
  const resolved = resolveLocation(location);
  const coords = formatCoords(resolved.latitude, resolved.longitude);
  const accuracy = formatAccuracy(resolved.accuracy);
  const caption = resolved.caption?.trim();
  let header = "";
  if (resolved.source === "live" || resolved.isLive) {
    header = `\uD83D\uDEF0 Live location: ${coords}${accuracy}`;
  } else if (resolved.name || resolved.address) {
    const label = [resolved.name, resolved.address].filter(Boolean).join(" \u2014 ");
    header = `\uD83D\uDCCD ${label} (${coords}${accuracy})`;
  } else {
    header = `\uD83D\uDCCD ${coords}${accuracy}`;
  }
  return caption ? `${header}\n${caption}` : header;
}
export function toLocationContext(location) {
  const resolved = resolveLocation(location);
  return {
    LocationLat: resolved.latitude,
    LocationLon: resolved.longitude,
    LocationAccuracy: resolved.accuracy,
    LocationName: resolved.name,
    LocationAddress: resolved.address,
    LocationSource: resolved.source,
    LocationIsLive: resolved.isLive,
  };
}
