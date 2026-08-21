const corporateDefaults = {
  productType: 'Corporate gifts',
  contactPreference: 'Email',
};

export const applyCorporateBriefPreset = (
  form = {},
  { preserveAnswers = true } = {},
) => ({
  ...form,
  productType: preserveAnswers && String(form.productType || '').trim()
    ? form.productType
    : corporateDefaults.productType,
  contactPreference: preserveAnswers && String(form.contactPreference || '').trim()
    ? form.contactPreference
    : corporateDefaults.contactPreference,
  // These fields describe the route context, rather than optional answers. They
  // must win over a personal draft whenever ?brief=corporate is active.
  requestKind: 'corporate',
  occasion: 'Corporate event',
});
