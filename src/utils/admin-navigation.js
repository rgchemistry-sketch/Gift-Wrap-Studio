export const adminSectionHref = (section) => section === 'dashboard'
  ? '/admin'
  : `/admin?section=${encodeURIComponent(section)}`;

export const resolveAdminSection = (requestedSection, allowedSections) => (
  requestedSection && allowedSections.has(requestedSection)
    ? requestedSection
    : 'dashboard'
);
