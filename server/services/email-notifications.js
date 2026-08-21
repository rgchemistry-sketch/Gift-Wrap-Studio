import { env } from "../config/env.js";
import { normalizeGoogleReviewUrl } from "../../shared/google-review-url.js";
import { escapeEmailHtml, renderBrandedEmail, sendEmailSafely } from "./email.js";
import { getStudioSettings } from "./store.js";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const statusLabels = {
  placed: "Request received",
  confirmed: "Confirmed",
  in_progress: "In progress",
  ready: "Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const notificationStatuses = new Set(["confirmed", "shipped", "delivered", "cancelled"]);

const settingsForEmail = async () => {
  try {
    return await getStudioSettings();
  } catch (error) {
    console.warn("[email] Studio settings could not be loaded for the email footer", {
      code: error?.code || error?.name || "SETTINGS_UNAVAILABLE",
    });
    return { contact: {}, leadTimes: {} };
  }
};

const linesHtml = (rows) =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;border-collapse:collapse">${rows
    .filter(([, value]) => value !== "" && value != null)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:7px 10px 7px 0;color:#6d706a;vertical-align:top;width:34%">${escapeEmailHtml(label)}</td><td style="padding:7px 0;color:#173f35;vertical-align:top"><strong>${escapeEmailHtml(value)}</strong></td></tr>`,
    )
    .join("")}</table>`;

const linesText = (rows) =>
  rows
    .filter(([, value]) => value !== "" && value != null)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

const paragraph = (value) => `<p style="margin:0 0 16px">${escapeEmailHtml(value)}</p>`;

const noteBlock = (title, value) =>
  value
    ? `<div style="margin:18px 0;padding:16px 18px;border-left:4px solid #6d1f35;background:#f7f1e8"><strong style="display:block;margin-bottom:5px;color:#6d1f35">${escapeEmailHtml(title)}</strong>${escapeEmailHtml(value).replaceAll("\n", "<br>")}</div>`
    : "";

const cta = (label, url) =>
  url
    ? `<p style="margin:24px 0 6px"><a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#6d1f35;color:#fff;text-decoration:none;font-weight:700">${escapeEmailHtml(label)}</a></p>`
    : "";

const orderItemRows = (order) =>
  (order.items || []).map((item) => [
    `${item.name || "Studio piece"} × ${Number(item.quantity || 1)}`,
    `${money.format(Number(item.unitPrice || 0))}${item.customization ? ` · ${item.customization}` : ""}`,
  ]);

const orderAddress = (order) => {
  const address = order.shippingAddress || {};
  return [
    address.recipientName,
    address.phone,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(", "),
    address.country,
  ]
    .filter(Boolean)
    .join("\n");
};

const pricingRows = (order) => [
  ["Subtotal", money.format(Number(order.subtotal || 0))],
  ["Delivery", Number(order.shippingFee || 0) === 0 ? "Complimentary" : money.format(Number(order.shippingFee || 0))],
  ["Offer", Number(order.discount || 0) > 0 ? `−${money.format(Number(order.discount))}` : "—"],
  ["Request total", money.format(Number(order.total || 0))],
];

const orderContactRows = (order) => [
  ["Needed by", order.neededBy ? new Date(order.neededBy).toLocaleDateString("en-IN") : ""],
  ["Preferred contact", order.contactPreference || ""],
];

const appLink = (path) => {
  const base = String(env.appUrl || env.clientOrigins?.[0] || "").replace(/\/$/, "");
  return base ? `${base}${path}` : "";
};

const safeGoogleReviewUrl = (settings = {}) =>
  normalizeGoogleReviewUrl(settings.contact?.googleReviewUrl) || "";

const sendPrepared = (message, context) => sendEmailSafely(message, context);

export const sendOrderCreatedEmails = async (order) => {
  const settings = await settingsForEmail();
  const itemRows = orderItemRows(order);
  const totals = pricingRows(order);
  const contactRows = orderContactRows(order);
  const contactRowsHtml = contactRows.some(([, value]) => value) ? linesHtml(contactRows) : "";
  const contactRowsText = linesText(contactRows);
  const address = orderAddress(order);
  const studioReplyTo = settings.contact?.email || env.authEmailReplyTo;
  const customerTitle = `We've received your request — ${order.orderNumber}`;
  const leadTime = settings.leadTimes?.custom || settings.leadTimes?.ready || "shared after studio review";
  const customerBodyText = [
    `Hello ${order.buyerName || order.shippingAddress?.recipientName || "there"},`,
    "Your handmade order request is safely with the studio.",
    linesText(itemRows),
    linesText(totals),
    contactRowsText,
    `Delivery address:\n${address}`,
    order.note ? `Your note:\n${order.note}` : "",
    `Typical lead time: ${leadTime}`,
    "No payment has been taken. The studio will confirm the design, final total and payment steps before work begins.",
  ].filter(Boolean).join("\n\n");
  const customerTemplate = renderBrandedEmail(
    {
      eyebrow: "Order request received",
      title: customerTitle,
      preheader: `Request ${order.orderNumber} is safely with the studio.`,
      bodyHtml: [
        paragraph(`Hello ${order.buyerName || order.shippingAddress?.recipientName || "there"}, your handmade order request is safely with the studio.`),
        linesHtml(itemRows),
        linesHtml(totals),
        contactRowsHtml,
        noteBlock("Delivery address", address),
        noteBlock("Your note", order.note),
        paragraph(`Typical lead time: ${leadTime}.`),
        noteBlock("What happens next", "No payment has been taken. The studio will confirm the design, final total and payment steps before work begins."),
        cta("View orders & requests", appLink("/account")),
      ].join(""),
      bodyText: customerBodyText,
    },
    settings,
  );

  const jobs = [
    sendPrepared(
      {
        to: order.buyerEmail,
        subject: customerTitle,
        replyTo: studioReplyTo,
        ...customerTemplate,
      },
      `order confirmation ${order.orderNumber}`,
    ),
  ];

  if (env.adminEmail) {
    const ownerTitle = `New order ${order.orderNumber} — ${money.format(Number(order.total || 0))} from ${order.buyerName || "customer"}`;
    const ownerTemplate = renderBrandedEmail(
      {
        eyebrow: "Studio order alert",
        title: ownerTitle,
        bodyHtml: [
          linesHtml([
            ["Buyer", order.buyerName],
            ["Email", order.buyerEmail],
            ["Phone", order.shippingAddress?.phone],
            ["Order", order.orderNumber],
          ]),
          linesHtml(itemRows),
          linesHtml(totals),
          contactRowsHtml,
          noteBlock("Delivery address", address),
          noteBlock("Customer note", order.note),
          cta("Open admin orders", appLink("/admin?section=orders")),
        ].join(""),
        bodyText: [
          linesText([["Buyer", order.buyerName], ["Email", order.buyerEmail], ["Phone", order.shippingAddress?.phone], ["Order", order.orderNumber]]),
          linesText(itemRows),
          linesText(totals),
          contactRowsText,
          `Delivery address:\n${address}`,
          order.note ? `Customer note:\n${order.note}` : "",
          appLink("/admin?section=orders"),
        ].filter(Boolean).join("\n\n"),
      },
      settings,
    );
    jobs.push(
      sendPrepared(
        { to: env.adminEmail, subject: ownerTitle, replyTo: order.buyerEmail, ...ownerTemplate },
        `studio order alert ${order.orderNumber}`,
      ),
    );
  }
  return Promise.all(jobs);
};

export const sendOrderStatusEmail = async (order) => {
  if (!notificationStatuses.has(order.status) || !order.buyerEmail) return [];
  const settings = await settingsForEmail();
  const label = statusLabels[order.status] || order.status;
  const latest = [...(order.statusHistory || [])].reverse().find((entry) => entry.status === order.status);
  const delivered = order.status === "delivered";
  const reviewUrl = delivered ? safeGoogleReviewUrl(settings) : "";
  const subject = delivered
    ? `Your Gift N Wrap piece has arrived — ${order.orderNumber}`
    : `${label} — ${order.orderNumber}`;
  const greeting = delivered
    ? `Hello ${order.buyerName || "there"}, we hope your Gift N Wrap piece reached you safely and feels even more special in person.`
    : `Hello ${order.buyerName || "there"}, your studio request is now ${label.toLowerCase()}.`;
  const reviewInvitation = delivered
    ? "If you have a moment, an honest Google review would mean a great deal. Your feedback helps our small studio improve and helps future customers choose handmade pieces with confidence."
    : "";
  const template = renderBrandedEmail(
    {
      eyebrow: delivered ? "Made for you · Delivered" : "Order update",
      title: subject,
      preheader: delivered
        ? "Thank you for choosing handmade. We would love to hear how your piece feels in its new home."
        : `Your request ${order.orderNumber} is now ${label.toLowerCase()}.`,
      bodyHtml: [
        paragraph(greeting),
        linesHtml([["Order", order.orderNumber], ["Status", label], ["Total", money.format(Number(order.total || 0))]]),
        noteBlock("A note from the studio", latest?.note),
        delivered ? noteBlock("Thank you for trusting our studio", reviewInvitation) : "",
        delivered && reviewUrl ? cta("Share an honest Google review", reviewUrl) : "",
        delivered
          ? paragraph("Your experience matters to us. If anything about your order needs attention, simply reply to this email and the studio will help.")
          : "",
        cta(delivered ? "View your order details" : "View your order", appLink("/account")),
      ].join(""),
      bodyText: [
        greeting,
        linesText([["Order", order.orderNumber], ["Status", label], ["Total", money.format(Number(order.total || 0))]]),
        latest?.note ? `A note from the studio:\n${latest.note}` : "",
        reviewInvitation,
        reviewUrl ? `Share an honest Google review: ${reviewUrl}` : "",
        delivered
          ? "Your experience matters to us. If anything about your order needs attention, simply reply to this email and the studio will help."
          : "",
        appLink("/account"),
      ].filter(Boolean).join("\n\n"),
    },
    settings,
  );
  return [
    await sendPrepared(
      { to: order.buyerEmail, subject, replyTo: settings.contact?.email, ...template },
      `order status update ${order.orderNumber}`,
    ),
  ];
};

const inquiryRows = (inquiry) => [
  ["Piece", inquiry.category || inquiry.productType || "Custom piece"],
  ["Occasion", inquiry.occasion],
  ["Budget", inquiry.budget],
  ["Needed by", inquiry.neededBy ? new Date(inquiry.neededBy).toLocaleDateString("en-IN") : "To discuss"],
  ["Preferred contact", inquiry.contactPreference],
  ["Phone", inquiry.phone],
];

export const sendInquiryCreatedEmails = async (inquiry) => {
  const settings = await settingsForEmail();
  const title = "We've received your custom request";
  const details = inquiryRows(inquiry);
  const template = renderBrandedEmail(
    {
      eyebrow: "Custom request received",
      title,
      bodyHtml: [
        paragraph(`Hello ${inquiry.name}, thank you for sharing your idea. The studio will review the details and continue through your preferred contact channel.`),
        linesHtml(details),
        noteBlock("Your idea", inquiry.idea || inquiry.description),
        noteBlock("Personalization", inquiry.customization),
        noteBlock("Palette", inquiry.palette),
        paragraph(`Typical custom lead time: ${settings.leadTimes?.custom || "confirmed after review"}.`),
      ].join(""),
      bodyText: [
        `Hello ${inquiry.name}, thank you for sharing your idea.`,
        linesText(details),
        `Your idea:\n${inquiry.idea || inquiry.description || ""}`,
        inquiry.customization ? `Personalization:\n${inquiry.customization}` : "",
        inquiry.palette ? `Palette:\n${inquiry.palette}` : "",
        `Typical custom lead time: ${settings.leadTimes?.custom || "confirmed after review"}.`,
      ].filter(Boolean).join("\n\n"),
    },
    settings,
  );
  const jobs = [
    sendPrepared(
      { to: inquiry.email, subject: title, replyTo: settings.contact?.email, ...template },
      `custom request acknowledgement ${inquiry.id}`,
    ),
  ];
  if (env.adminEmail) {
    const ownerTitle = `New custom request — ${inquiry.name}`;
    const ownerTemplate = renderBrandedEmail(
      {
        eyebrow: "Studio request alert",
        title: ownerTitle,
        bodyHtml: [linesHtml([["Customer", inquiry.name], ["Email", inquiry.email], ...details]), noteBlock("Brief", inquiry.idea || inquiry.description), noteBlock("Personalization", inquiry.customization), cta("Open custom requests", appLink("/admin?section=requests"))].join(""),
        bodyText: [linesText([["Customer", inquiry.name], ["Email", inquiry.email], ...details]), `Brief:\n${inquiry.idea || inquiry.description || ""}`, inquiry.customization ? `Personalization:\n${inquiry.customization}` : "", appLink("/admin?section=requests")].filter(Boolean).join("\n\n"),
      },
      settings,
    );
    jobs.push(sendPrepared({ to: env.adminEmail, subject: ownerTitle, replyTo: inquiry.email, ...ownerTemplate }, `studio custom request alert ${inquiry.id}`));
  }
  return Promise.all(jobs);
};

export const sendContactCreatedEmails = async (message) => {
  const settings = await settingsForEmail();
  const title = "We've received your message";
  const template = renderBrandedEmail(
    {
      eyebrow: "Message received",
      title,
      bodyHtml: [paragraph(`Hello ${message.name}, your note has reached the studio. We’ll reply as soon as we can.`), linesHtml([["Subject", message.subject], ["Phone", message.phone]]), noteBlock("Your message", message.message)].join(""),
      bodyText: [`Hello ${message.name}, your note has reached the studio. We’ll reply as soon as we can.`, linesText([["Subject", message.subject], ["Phone", message.phone]]), `Your message:\n${message.message}`].filter(Boolean).join("\n\n"),
    },
    settings,
  );
  const jobs = [sendPrepared({ to: message.email, subject: title, replyTo: settings.contact?.email, ...template }, `contact acknowledgement ${message.id}`)];
  if (env.adminEmail) {
    const ownerTitle = `New message — ${message.subject}`;
    const ownerTemplate = renderBrandedEmail(
      {
        eyebrow: "Studio inbox alert",
        title: ownerTitle,
        bodyHtml: [linesHtml([["From", message.name], ["Email", message.email], ["Phone", message.phone], ["Subject", message.subject]]), noteBlock("Message", message.message), cta("Open studio messages", appLink("/admin?section=messages"))].join(""),
        bodyText: [linesText([["From", message.name], ["Email", message.email], ["Phone", message.phone], ["Subject", message.subject]]), `Message:\n${message.message}`, appLink("/admin?section=messages")].filter(Boolean).join("\n\n"),
      },
      settings,
    );
    jobs.push(sendPrepared({ to: env.adminEmail, subject: ownerTitle, replyTo: message.email, ...ownerTemplate }, `studio contact alert ${message.id}`));
  }
  return Promise.all(jobs);
};

export const sendInquiryReplyEmail = async (inquiry) => {
  if (!inquiry.email || !inquiry.adminNote || !["contacted", "quoted"].includes(inquiry.status)) return [];
  const settings = await settingsForEmail();
  const subject = `${inquiry.status === "quoted" ? "Your studio quote" : "A reply from the studio"} — Gift N Wrap`;
  const template = renderBrandedEmail(
    {
      eyebrow: inquiry.status === "quoted" ? "Your custom quote" : "Studio reply",
      title: subject,
      bodyHtml: [paragraph(`Hello ${inquiry.name},`), noteBlock("From the studio", inquiry.adminNote), noteBlock("Your original brief", inquiry.idea || inquiry.description), linesHtml(inquiryRows(inquiry))].join(""),
      bodyText: [`Hello ${inquiry.name},`, `From the studio:\n${inquiry.adminNote}`, `Your original brief:\n${inquiry.idea || inquiry.description || ""}`, linesText(inquiryRows(inquiry))].join("\n\n"),
    },
    settings,
  );
  return [await sendPrepared({ to: inquiry.email, subject, replyTo: settings.contact?.email || env.authEmailReplyTo, ...template }, `custom request reply ${inquiry.id}`)];
};

export const sendContactReplyEmail = async (message) => {
  if (!message.email || !message.adminNote || message.status !== "replied") return [];
  const settings = await settingsForEmail();
  const subject = `Re: ${message.subject}`;
  const template = renderBrandedEmail(
    {
      eyebrow: "Studio reply",
      title: subject,
      bodyHtml: [paragraph(`Hello ${message.name},`), noteBlock("From the studio", message.adminNote), noteBlock("Your original message", message.message)].join(""),
      bodyText: [`Hello ${message.name},`, `From the studio:\n${message.adminNote}`, `Your original message:\n${message.message}`].join("\n\n"),
    },
    settings,
  );
  return [await sendPrepared({ to: message.email, subject, replyTo: settings.contact?.email || env.authEmailReplyTo, ...template }, `contact reply ${message.id}`)];
};
