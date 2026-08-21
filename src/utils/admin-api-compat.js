const messageText = (error) => String(error?.message || '').trim();

export const isMissingApiRoute = (error) => (
  error?.code === 'ROUTE_NOT_FOUND'
  || /no api route matches/i.test(messageText(error))
);

export const requestAdminOrderWithFallback = async (requester, orderId) => {
  const encodedOrderId = encodeURIComponent(String(orderId || '').trim());
  const readOptions = { cache: 'no-store' };
  try {
    return await requester(`/admin/orders/${encodedOrderId}`, readOptions);
  } catch (error) {
    if (!isMissingApiRoute(error)) throw error;
    // Older deployments already allow administrators to read this protected
    // buyer-order route. It keeps the full record available during a rollout.
    return requester(`/orders/${encodedOrderId}`, readOptions);
  }
};

export const adminOrderErrorMessage = (
  error,
  fallback = 'The complete order could not be loaded.',
) => {
  if (isMissingApiRoute(error)) {
    return 'The secure order service is being updated. The verified summary remains available; please try again shortly.';
  }
  return messageText(error) || fallback;
};
