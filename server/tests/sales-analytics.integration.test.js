import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.ALLOW_DEMO_AUTH = "true";
process.env.JWT_SECRET = "test-only-session-secret-that-is-long-enough";
process.env.ADMIN_EMAIL = "owner@example.test";
delete process.env.MONGODB_URI;

const [{ default: app }, { memoryStore, resetMemoryStore }] = await Promise.all([
  import("../app.js"),
  import("../lib/memory-store.js"),
]);

beforeEach(() => resetMemoryStore());

const signedIn = async (role) => {
  const agent = request.agent(app);
  await agent.post("/api/auth/demo").send({ role }).expect(200);
  return agent;
};

const seedOrder = ({
  id,
  buyerId,
  buyerName,
  buyerEmail,
  createdAt,
  status = "placed",
  paymentStatus = "pending",
  paymentMethod = "manual_confirmation",
  paymentQuote,
  total,
  subtotal = total,
  shippingFee = 0,
  discount = 0,
  productId,
  productSlug = productId,
  productName,
  category = "Keepsakes",
  unitPrice,
  quantity = 1,
  customization = "",
  shippingAddress = {
    recipientName: buyerName,
    phone: "+919876543210",
    line1: "12 Studio Lane",
    line2: "Near the garden",
    city: "Jaipur",
    state: "Rajasthan",
    postalCode: "001234",
    country: "India",
  },
  couponCode = "",
  neededBy = null,
  contactPreference = "WhatsApp",
  note = "",
}) => memoryStore.create("orders", {
  orderNumber: `GNW-${id}`,
  buyerId,
  buyerName,
  buyerEmail,
  createdAt,
  updatedAt: createdAt,
  status,
  paymentStatus,
  total,
  subtotal,
  shippingFee,
  discount,
  shippingAddress,
  couponCode,
  neededBy,
  contactPreference,
  note,
  paymentMethod,
  ...(paymentQuote ? { paymentQuote } : {}),
  items: [{
    productId,
    slug: productSlug,
    name: productName,
    category,
    unitPrice,
    quantity,
    customization,
  }],
}, id);

const exportParser = (incoming, callback) => {
  const chunks = [];
  incoming.on("data", (chunk) => chunks.push(chunk));
  incoming.on("end", () => callback(null, Buffer.concat(chunks)));
};

const sheetRecords = (sheet) => {
  const headers = sheet.getRow(4).values.slice(1).map(String);
  return [...Array(Math.max(0, sheet.rowCount - 4))].map((_unused, index) => {
    const values = sheet.getRow(index + 5).values.slice(1);
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? null]));
  });
};

const seedReportFixture = () => {
  seedOrder({
    id: "a-history",
    buyerId: "customer-a",
    buyerName: "Asha",
    buyerEmail: "asha@example.test",
    createdAt: "2026-07-01T06:30:00.000Z",
    total: 300,
    productId: "history",
    productName: "Historical piece",
    unitPrice: 300,
  });
  seedOrder({
    id: "a-previous",
    buyerId: "customer-a",
    buyerName: "Asha",
    buyerEmail: "asha@example.test",
    createdAt: "2026-07-30T06:30:00.000Z",
    total: 500,
    productId: "previous",
    productName: "Previous piece",
    unitPrice: 500,
  });
  seedOrder({
    id: "boundary-before",
    buyerId: "outside-before",
    buyerName: "Before",
    buyerEmail: "before@example.test",
    createdAt: "2026-07-31T18:29:59.999Z",
    total: 999,
    productId: "outside",
    productName: "Outside before",
    unitPrice: 999,
  });
  seedOrder({
    id: "current-a",
    buyerId: "customer-a",
    buyerName: "Asha",
    buyerEmail: "asha@example.test",
    createdAt: "2026-07-31T18:30:00.000Z",
    total: 1_200,
    subtotal: 1_000,
    shippingFee: 250,
    discount: 50,
    productId: "product-internal-1",
    productSlug: "personalized-ring-platter",
    productName: "  =HYPERLINK(\"https://bad.example\")",
    category: "Wedding keepsakes",
    unitPrice: 500,
    quantity: 2,
    customization: JSON.stringify({
      name: "Asha & Dev",
      date: "2026-12-10",
      message: "=FORMULATEXT(A1)",
      media: {
        name: "reference.jpg",
        url: "https://res.cloudinary.com/demo/image/upload/reference.jpg",
        publicId: "secret-order-public-id",
        expiresAt: "2099-01-01T00:00:00.000Z",
        pending: false,
      },
    }),
    shippingAddress: {
      recipientName: "Asha Sharma",
      phone: "+919812345678",
      line1: "44 Rose Avenue",
      line2: "Apartment 7B",
      city: "Jaipur",
      state: "Rajasthan",
      postalCode: "001234",
      country: "India",
    },
    neededBy: "2026-12-10T00:00:00.000Z",
    contactPreference: "WhatsApp",
    note: "+please call before delivery",
  });
  seedOrder({
    id: "current-b",
    buyerId: "customer-b",
    buyerName: "Bhavna",
    buyerEmail: "bhavna@example.test",
    createdAt: "2026-08-02T06:30:00.000Z",
    paymentStatus: "paid",
    total: 800,
    productId: "p-2",
    productName: "Rose frame",
    unitPrice: 800,
  });
  seedOrder({
    id: "cancelled",
    buyerId: "customer-b",
    buyerName: "Bhavna",
    buyerEmail: "bhavna@example.test",
    createdAt: "2026-08-02T07:30:00.000Z",
    status: "cancelled",
    total: 600,
    productId: "p-1",
    productName: "Cancelled piece",
    unitPrice: 600,
  });
  seedOrder({
    id: "refunded",
    buyerId: "customer-c",
    buyerName: "Chitra",
    buyerEmail: "chitra@example.test",
    createdAt: "2026-08-03T06:30:00.000Z",
    paymentStatus: "refunded",
    total: 700,
    productId: "p-3",
    productName: "Refunded piece",
    unitPrice: 700,
  });
  seedOrder({
    id: "failed",
    buyerId: "customer-d",
    buyerName: "Diya",
    buyerEmail: "diya@example.test",
    createdAt: "2026-08-03T07:30:00.000Z",
    paymentStatus: "failed",
    total: 900,
    productId: "p-4",
    productName: "Failed-payment piece",
    unitPrice: 900,
  });
  seedOrder({
    id: "boundary-after",
    buyerId: "outside-after",
    buyerName: "After",
    buyerEmail: "after@example.test",
    createdAt: "2026-08-03T18:30:00.000Z",
    total: 1_111,
    productId: "outside",
    productName: "Outside after",
    unitPrice: 1_111,
  });
  memoryStore.create("customInquiries", {
    userId: "custom-user-internal",
    name: "@Riya",
    email: "riya@example.test",
    phone: "+919700001234",
    productId: "product-internal-custom",
    category: "Name plaque",
    occasion: "Wedding",
    palette: "Ivory and burgundy",
    idea: "A floral plaque for our new home",
    customization: "Names Riya & Aman; wedding date 12 December",
    budget: "₹3,000 – ₹6,000",
    neededBy: "2026-12-01T00:00:00.000Z",
    contactPreference: "Email",
    referenceUrl: "https://example.test/inspiration",
    referenceImages: [
      "https://res.cloudinary.com/demo/image/upload/custom-reference.jpg",
      "javascript:alert(1)",
    ],
    status: "quoted",
    adminNote: "secret studio margin note",
    createdAt: "2026-08-01T06:30:00.000Z",
    updatedAt: "2026-08-02T06:30:00.000Z",
  }, "custom-request-internal-id");
  memoryStore.create("customInquiries", {
    name: "Outside custom range",
    email: "outside-custom@example.test",
    phone: "+919700009999",
    category: "Clock",
    idea: "This request is outside the selected export range",
    status: "new",
    createdAt: "2026-08-03T18:30:00.000Z",
  }, "custom-request-outside-id");
};

test("sales analytics are admin-only, no-store and use exact IST sales semantics", async () => {
  seedReportFixture();
  const query = { range: "day", from: "2026-08-01", to: "2026-08-03" };

  await request(app).get("/api/admin/analytics").query(query).expect(401);
  const buyer = await signedIn("buyer");
  await buyer.get("/api/admin/analytics").query(query).expect(403);

  const admin = await signedIn("admin");
  const response = await admin.get("/api/admin/analytics").query(query).expect(200);
  assert.match(response.headers["cache-control"], /no-store/);

  const analytics = response.body.data;
  assert.deepEqual(analytics.filter, {
    range: "day",
    from: "2026-08-01",
    to: "2026-08-03",
    timezone: "Asia/Kolkata",
    previousFrom: "2026-07-29",
    previousTo: "2026-07-31",
  });
  assert.equal(analytics.kpis.bookedSales, 2_000);
  assert.equal(analytics.kpis.paidSales, 800);
  assert.equal(analytics.kpis.pendingPaymentSales, 1_200);
  assert.equal(analytics.kpis.otherPaymentSales, 0);
  assert.equal(analytics.kpis.totalOrders, 5);
  assert.equal(analytics.kpis.orders, 2);
  assert.equal(analytics.kpis.units, 3);
  assert.equal(analytics.kpis.averageOrderValue, 1_000);
  assert.equal(analytics.kpis.cancelledOrders, 1);
  assert.equal(analytics.kpis.cancelledValue, 600);
  assert.equal(analytics.kpis.refundedOrders, 1);
  assert.equal(analytics.kpis.refundedValue, 700);
  assert.equal(analytics.kpis.failedPaymentOrders, 1);
  assert.equal(analytics.kpis.failedPaymentValue, 900);
  assert.equal(analytics.kpis.customers, 2);
  assert.equal(analytics.kpis.newCustomers, 1);
  assert.equal(analytics.kpis.returningCustomers, 1);
  assert.equal(analytics.kpis.returningCustomerRate, 50);
  assert.equal(analytics.kpis.repeatCustomers, 1);
  assert.equal(analytics.kpis.repeatCustomerRate, 50);
  assert.equal(analytics.comparison.previous.bookedSales, 1_499);

  assert.equal(analytics.series.length, 3);
  assert.equal(analytics.series[0].bookedSales, 1_200);
  assert.equal(analytics.series[1].bookedSales, 800);
  assert.equal(analytics.series[1].cancelledOrders, 1);
  assert.equal(analytics.series[2].refundedOrders, 1);
  assert.equal(analytics.series[2].failedPaymentOrders, 1);

  assert.deepEqual(
    analytics.products.map((product) => ({
      id: product.productId,
      sales: product.bookedSales,
      units: product.units,
      share: product.share,
    })),
    [
      { id: "product-internal-1", sales: 1_000, units: 2, share: 55.6 },
      { id: "p-2", sales: 800, units: 1, share: 44.4 },
    ],
  );
  assert.equal(analytics.customers.top[0].customerId, "customer-a");
  assert.equal(analytics.customers.top[0].customerType, "returning");
  assert.equal(
    analytics.orderStatuses.reduce((total, status) => total + status.count, 0),
    analytics.kpis.totalOrders,
  );
  assert.match(analytics.metricDefinitions.bookedSales, /not cash collected/i);
});

test("week analysis starts on Monday IST and comparisons never emit infinity", async () => {
  seedOrder({
    id: "sunday",
    buyerId: "week-a",
    buyerName: "Sunday buyer",
    buyerEmail: "sun@example.test",
    createdAt: "2026-08-02T06:30:00.000Z",
    total: 100,
    productId: "weekly",
    productName: "Weekly piece",
    unitPrice: 100,
  });
  seedOrder({
    id: "monday",
    buyerId: "week-b",
    buyerName: "Monday buyer",
    buyerEmail: "mon@example.test",
    createdAt: "2026-08-02T18:30:00.000Z",
    total: 200,
    productId: "weekly",
    productName: "Weekly piece renamed",
    unitPrice: 200,
  });
  const admin = await signedIn("admin");
  const response = await admin
    .get("/api/admin/analytics")
    .query({ range: "week", from: "2026-08-02", to: "2026-08-04" })
    .expect(200);
  assert.deepEqual(
    response.body.data.series.map(({ period, bookedSales }) => ({ period, bookedSales })),
    [
      { period: "2026-07-27", bookedSales: 100 },
      { period: "2026-08-03", bookedSales: 200 },
    ],
  );
  assert.equal(response.body.data.comparison.bookedSales, null);
  assert.equal(response.body.data.products[0].name, "Weekly piece renamed");
});

test("unpaid Razorpay quotes are not booked and paid quotes use the frozen payable amount", async () => {
  seedOrder({
    id: "razorpay-awaiting",
    buyerId: "buyer-awaiting",
    buyerName: "Awaiting buyer",
    buyerEmail: "awaiting@example.test",
    createdAt: "2026-08-05T06:30:00.000Z",
    paymentMethod: "razorpay",
    paymentStatus: "pending",
    total: 1_000,
    paymentQuote: { amountPaise: 125_000, currency: "INR" },
    productId: "rzp-awaiting",
    productName: "Awaiting payment piece",
    unitPrice: 1_000,
  });
  seedOrder({
    id: "razorpay-paid",
    buyerId: "buyer-paid",
    buyerName: "Paid buyer",
    buyerEmail: "paid@example.test",
    createdAt: "2026-08-05T07:30:00.000Z",
    paymentMethod: "razorpay",
    paymentStatus: "paid",
    total: 2_000,
    paymentQuote: { amountPaise: 230_000, currency: "INR" },
    productId: "rzp-paid",
    productName: "Paid piece",
    unitPrice: 2_000,
  });

  const admin = await signedIn("admin");
  const response = await admin
    .get("/api/admin/analytics")
    .query({ range: "day", from: "2026-08-05", to: "2026-08-05" })
    .expect(200);

  assert.equal(response.body.data.kpis.totalOrders, 2);
  assert.equal(response.body.data.kpis.orders, 1);
  assert.equal(response.body.data.kpis.bookedSales, 2_300);
  assert.equal(response.body.data.kpis.paidSales, 2_300);
  const pendingRow = response.body.data.paymentStatuses.find(({ status }) => status === "pending");
  assert.equal(pendingRow.orderValue, 1_250);
  assert.equal(pendingRow.bookedSales, 0);
});

test("month analysis zero-fills every intersecting calendar month", async () => {
  const admin = await signedIn("admin");
  const response = await admin
    .get("/api/admin/analytics")
    .query({ range: "month", from: "2026-06-15", to: "2026-08-14" })
    .expect(200);
  assert.deepEqual(
    response.body.data.series.map(({ period, bookedSales }) => ({ period, bookedSales })),
    [
      { period: "2026-06", bookedSales: 0 },
      { period: "2026-07", bookedSales: 0 },
      { period: "2026-08", bookedSales: 0 },
    ],
  );
});

test("sales analytics zero-fill empty periods and reject unsafe ranges", async () => {
  const admin = await signedIn("admin");
  const empty = await admin
    .get("/api/admin/analytics")
    .query({ range: "day", from: "2026-08-10", to: "2026-08-12" })
    .expect(200);
  assert.equal(empty.body.data.series.length, 3);
  assert.equal(empty.body.data.series.every((row) => row.bookedSales === 0), true);
  assert.equal(empty.body.data.kpis.bookedSales, 0);

  await admin.get("/api/admin/analytics").query({ from: "2026-08-01" }).expect(422);
  await admin
    .get("/api/admin/analytics")
    .query({ range: "day", from: "2026-08-03", to: "2026-08-01" })
    .expect(400);
  await admin
    .get("/api/admin/analytics")
    .query({ range: "month", from: "2026-02-30", to: "2026-03-01" })
    .expect(400);
  await admin
    .get("/api/admin/analytics")
    .query({ range: "year", from: "2020-01-01", to: "2026-08-01" })
    .expect(400);
  await admin
    .get("/api/admin/analytics")
    .query({ range: "day", from: "2099-01-01", to: "2099-01-01" })
    .expect(400);
});

test("sales export is admin-only and produces analysis-ready normal-order, item and custom-request tables", async () => {
  seedReportFixture();
  const query = { range: "day", from: "2026-08-01", to: "2026-08-03" };
  await request(app).get("/api/admin/analytics/export.xlsx").query(query).expect(401);
  const buyer = await signedIn("buyer");
  await buyer.get("/api/admin/analytics/export.xlsx").query(query).expect(403);

  const admin = await signedIn("admin");
  const response = await admin
    .get("/api/admin/analytics/export.xlsx")
    .query(query)
    .buffer(true)
    .parse(exportParser)
    .expect(200);

  assert.match(response.headers["cache-control"], /no-store/);
  assert.equal(
    response.headers["content-type"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.match(
    response.headers["content-disposition"],
    /attachment; filename="gift-n-wrap-sales-2026-08-01-to-2026-08-03\.xlsx"/,
  );
  assert.equal(Buffer.isBuffer(response.body), true);
  assert.equal(response.body.subarray(0, 2).toString(), "PK");

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    [
      "Executive Summary",
      "Normal Orders",
      "Order Items",
      "Custom Requests",
      "Sales Trend",
      "Product Analysis",
      "Customer Analysis",
      "Financial Reconciliation",
    ],
  );

  const summary = workbook.getWorksheet("Executive Summary");
  assert.equal(summary.getCell("A6").value, 2_000);
  assert.match(summary.getCell("A6").numFmt, /^₹/);
  assert.match(String(summary.getCell("A2").value), /admin use only/i);
  assert.equal(summary.getColumn(1).width, summary.getColumn(2).width);

  const normalOrders = workbook.getWorksheet("Normal Orders");
  const normalHeaders = normalOrders.getRow(4).values.slice(1).map(String);
  assert.equal(normalHeaders.includes("Design brief"), false);
  assert.equal(normalHeaders.includes("Internal ID"), false);
  assert.equal(normalHeaders.includes("Customer ID"), false);
  const order = sheetRecords(normalOrders).find((row) => row["Order number"] === "GNW-current-a");
  assert.ok(order);
  assert.equal(order["Customer name"], "Asha");
  assert.equal(order["Customer email"], "asha@example.test");
  assert.equal(String(order["Contact / delivery phone"]).replace(/^'/, ""), "+919812345678");
  assert.equal(order["Recipient name"], "Asha Sharma");
  assert.equal(order["Address line 1"], "44 Rose Avenue");
  assert.equal(order.City, "Jaipur");
  assert.equal(order["Postal code"], "001234");
  assert.equal(order["Order total"], 1_200);
  assert.equal(order.Discount, 50);
  assert.equal(order.Delivery, 250);
  assert.equal(order["Booked sales"], 1_200);
  assert.equal(order["Refunded order value"], null);
  assert.equal(order["Financial bucket"], "Booked · Pending");
  assert.ok(order["Order date"] instanceof Date);
  assert.equal(order["Order date"].toISOString(), "2026-08-01T00:00:00.000Z");
  assert.match(String(order["Items ordered"]), /^'/);
  assert.match(String(order["Customer customization"]), /Asha & Dev/);
  assert.match(String(order["Customer customization"]), /reference\.jpg/);
  assert.doesNotMatch(String(order["Customer customization"]), /secret-order-public-id/);
  assert.match(String(order["Order note"]), /^'/);
  assert.equal(normalOrders.views[0].state, "frozen");
  assert.ok(normalOrders.getTable("NormalOrdersTable"));
  assert.ok(normalOrders.getRow(5).height > 20);

  const orderItems = workbook.getWorksheet("Order Items");
  const itemHeaders = orderItems.getRow(4).values.slice(1).map(String);
  assert.equal(itemHeaders.includes("Order total"), false);
  const item = sheetRecords(orderItems).find((row) => row["Order number"] === "GNW-current-a");
  assert.equal(item.Quantity, 2);
  assert.equal(item["Unit price"], 500);
  assert.equal(item["Line value"], 1_000);
  assert.match(String(item["Customer customization"]), /Message: '=FORMULATEXT\(A1\)/);

  const customRequests = workbook.getWorksheet("Custom Requests");
  const customHeaders = customRequests.getRow(4).values.slice(1).map(String);
  assert.equal(customHeaders.includes("Order total"), false);
  assert.equal(customHeaders.includes("Admin note"), false);
  assert.equal(customHeaders.includes("Product ID"), false);
  assert.equal(customHeaders.includes("User ID"), false);
  const customRows = sheetRecords(customRequests);
  assert.equal(customRows.length, 1);
  const custom = customRows[0];
  assert.equal(custom["Customer name"], "'@Riya");
  assert.equal(custom.Email, "riya@example.test");
  assert.equal(String(custom["Contact number"]).replace(/^'/, ""), "+919700001234");
  assert.equal(custom["Piece type"], "Name plaque");
  assert.equal(custom.Stage, "Quoted");
  assert.match(String(custom["Design brief"]), /floral plaque/i);
  assert.match(String(custom["Customer customization"]), /Riya & Aman/);
  assert.equal(custom["Reference count"], 1);
  assert.equal(
    custom["Uploaded reference links"],
    "https://res.cloudinary.com/demo/image/upload/custom-reference.jpg",
  );
  assert.doesNotMatch(String(custom["Uploaded reference links"]), /javascript:/i);

  assert.equal(workbook.getWorksheet("Sales Trend").rowCount, 7);
  assert.match(String(workbook.getWorksheet("Product Analysis").getCell("B5").value), /^'/);
  const maskedEmail = String(workbook.getWorksheet("Customer Analysis").getCell("C5").value);
  assert.match(maskedEmail, /^a\*+@example\.test$/);
  assert.notEqual(maskedEmail, "asha@example.test");

  const financial = workbook.getWorksheet("Financial Reconciliation");
  assert.equal(financial.getCell("B5").value.result, 4_200);
  assert.match(financial.getCell("B5").value.formula, /^SUM\(/);
  assert.equal(financial.getCell("B6").value.result, 2_000);
  assert.equal(financial.getCell("B10").value.result, 600);
  assert.equal(financial.getCell("B11").value.result, 700);
  assert.equal(financial.getCell("B12").value.result, 900);
  // Visible checks are server-computed snapshot values so Excel, LibreOffice,
  // web previews and mobile viewers all show the same result without relying
  // on formula-engine recalculation support.
  assert.equal(financial.getCell("B17").value, 0);
  assert.equal(financial.getCell("B18").value, 0);
  assert.equal(financial.getCell("C17").value, "PASS");
  assert.equal(financial.getCell("C18").value, "PASS");
  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(response.body);
  const workbookXml = await archive.file("xl/workbook.xml").async("string");
  assert.match(workbookXml, /<calcPr[^>]*fullCalcOnLoad="1"/);

  const workbookText = workbook.worksheets.flatMap((sheet) => {
    const values = [];
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === "string") values.push(cell.value);
    }));
    return values;
  }).join("\n");
  [
    "customer-a",
    "product-internal-1",
    "custom-user-internal",
    "product-internal-custom",
    "custom-request-internal-id",
    "secret studio margin note",
    "secret-order-public-id",
  ].forEach((secret) => assert.doesNotMatch(workbookText, new RegExp(secret)));
});

test("sales export keeps missing legacy money blank and remains valid for empty tables", async () => {
  seedOrder({
    id: "legacy-missing-values",
    buyerId: "legacy-buyer",
    buyerName: "Legacy customer",
    buyerEmail: "legacy@example.test",
    createdAt: "2026-08-04T06:30:00.000Z",
    total: null,
    subtotal: null,
    shippingFee: null,
    discount: null,
    productId: "legacy-product-id",
    productSlug: "legacy-piece",
    productName: "Legacy piece",
    unitPrice: null,
  });
  const admin = await signedIn("admin");
  const legacyResponse = await admin
    .get("/api/admin/analytics/export.xlsx")
    .query({ range: "day", from: "2026-08-04", to: "2026-08-04" })
    .buffer(true)
    .parse(exportParser)
    .expect(200);
  const { default: ExcelJS } = await import("exceljs");
  const legacyWorkbook = new ExcelJS.Workbook();
  await legacyWorkbook.xlsx.load(legacyResponse.body);
  const legacyOrder = sheetRecords(legacyWorkbook.getWorksheet("Normal Orders"))[0];
  assert.equal(legacyOrder.Subtotal, null);
  assert.equal(legacyOrder.Discount, null);
  assert.equal(legacyOrder.Delivery, null);
  assert.equal(legacyOrder["Order total"], null);
  assert.equal(legacyOrder["Booked sales"], null);
  const legacyItem = sheetRecords(legacyWorkbook.getWorksheet("Order Items"))[0];
  assert.equal(legacyItem["Unit price"], null);
  assert.equal(legacyItem["Line value"], null);

  const emptyResponse = await admin
    .get("/api/admin/analytics/export.xlsx")
    .query({ range: "day", from: "2026-08-10", to: "2026-08-10" })
    .buffer(true)
    .parse(exportParser)
    .expect(200);
  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.load(emptyResponse.body);
  ["Normal Orders", "Order Items", "Custom Requests"].forEach((sheetName) => {
    assert.equal(emptyWorkbook.getWorksheet(sheetName).rowCount, 4);
  });
  assert.match(
    emptyWorkbook.getWorksheet("Financial Reconciliation").getCell("B5").value.formula,
    /^SUM\(/,
  );
});

test("spreadsheet text protection covers whitespace, formula triggers and export indexes", async () => {
  const [{ spreadsheetTextForTests }, { Order }, { CustomInquiry }] = await Promise.all([
    import("../services/sales-analytics.js"),
    import("../models/Order.js"),
    import("../models/CustomInquiry.js"),
  ]);
  ["=1+1", "+2", "-3", "@SUM(A1)", "  =HYPERLINK(\"x\")", "\t+cmd", "\r-1"].forEach(
    (value) => assert.match(spreadsheetTextForTests(value), /^'/),
  );
  assert.equal(spreadsheetTextForTests("Studio piece"), "Studio piece");
  assert.equal(
    Order.schema.indexes().some(([fields, options]) => fields.createdAt === 1 && options.name === "orders_created_at"),
    true,
  );
  assert.equal(
    CustomInquiry.schema.indexes().some(
      ([fields, options]) => fields.createdAt === 1 && options.name === "custom_inquiries_created_at",
    ),
    true,
  );
});
