export const GOOGLE_REVIEW_URL_MESSAGE =
  "Use an HTTPS Google review or Google Maps link";

const isGoogleReviewHost = (hostname) => {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return host === "g.page"
    || host.endsWith(".g.page")
    || host === "goo.gl"
    || host.endsWith(".goo.gl")
    || host === "google.com"
    || host.endsWith(".google.com")
    || host === "google.co.in"
    || host.endsWith(".google.co.in");
};

export const normalizeGoogleReviewUrl = (input) => {
  const value = String(input || "").trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || !isGoogleReviewHost(url.hostname)
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
};
