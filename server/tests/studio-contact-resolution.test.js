import assert from "node:assert/strict";
import test from "node:test";
import { resolveStudioContact } from "../../src/utils/studio-contact.js";

test("storefront contact defaults are used only before settings load", () => {
  const loadingContact = resolveStudioContact(null);
  assert.equal(loadingContact.email, "info@giftnwrapstudio.com");
  assert.equal(loadingContact.instagramUrl, "https://www.instagram.com/giftnwrapstudio/");

  const clearedContact = resolveStudioContact({
    contact: { email: "", phone: "", instagram: "", facebook: "" },
  });
  assert.deepEqual(clearedContact, {
    email: "",
    phone: "",
    phoneHref: "",
    phoneLabel: "",
    instagramUrl: "",
    instagramLabel: "",
    facebookUrl: "",
    facebookLabel: "",
  });
});

test("storefront contact resolves legacy and raw social fields to canonical profiles", () => {
  const contact = resolveStudioContact({
    contactEmail: "legacy@example.test",
    contactPhone: "+91 98765 43210",
    contact: {
      instagram: "https://m.instagram.com/GiftNWrapStudio/?ref=share",
      facebook: "@GiftNWrapStudio",
    },
  });

  assert.equal(contact.email, "legacy@example.test");
  assert.equal(contact.phoneHref, "tel:+919876543210");
  assert.equal(contact.phoneLabel, "+91 98765 43210");
  assert.equal(contact.instagramUrl, "https://www.instagram.com/giftnwrapstudio/");
  assert.equal(contact.facebookUrl, "https://www.facebook.com/giftnwrapstudio/");
});
