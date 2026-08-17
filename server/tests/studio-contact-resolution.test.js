import assert from "node:assert/strict";
import test from "node:test";
import { resolveStudioContact } from "../../src/utils/studio-contact.js";

test("storefront contact links stay hidden until settings load", () => {
  const loadingContact = resolveStudioContact(null);
  assert.equal(loadingContact.email, "");
  assert.equal(loadingContact.instagramUrl, "");

  const clearedContact = resolveStudioContact({
    contact: { email: "", phone: "", instagram: "" },
  });
  assert.deepEqual(clearedContact, {
    email: "",
    phone: "",
    phoneHref: "",
    phoneLabel: "",
    instagramUrl: "",
    instagramLabel: "",
  });
});

test("storefront contact resolves legacy and raw social fields to canonical profiles", () => {
  const contact = resolveStudioContact({
    contactEmail: "legacy@example.test",
    contactPhone: "+91 98765 43210",
    contact: {
      instagram: "https://m.instagram.com/GiftNWrapStudio/?ref=share",
    },
  });

  assert.equal(contact.email, "legacy@example.test");
  assert.equal(contact.phoneHref, "tel:+919876543210");
  assert.equal(contact.phoneLabel, "+91 98765 43210");
  assert.equal(contact.instagramUrl, "https://www.instagram.com/giftnwrapstudio/");
});
