export const initialBuyerOrdersState = (ownerId = '') => ({
  ownerId,
  orders: [],
  loading: Boolean(ownerId),
  refreshing: false,
  error: '',
});

export function createBuyerOrdersLoader({ ownerId, fetchOrders, onChange }) {
  let requestNumber = 0;
  let disposed = false;
  let loaded = false;
  let state = initialBuyerOrdersState(ownerId);

  const publish = (changes) => {
    state = { ...state, ...changes };
    onChange(state);
  };

  return {
    async load() {
      if (disposed || !ownerId) return;
      const request = ++requestNumber;
      publish({ loading: !loaded, refreshing: loaded, error: '' });
      try {
        const orders = await fetchOrders(ownerId);
        if (disposed || request !== requestNumber) return;
        loaded = true;
        publish({ orders: Array.isArray(orders) ? orders : [], loading: false, refreshing: false });
      } catch (error) {
        if (disposed || request !== requestNumber) return;
        publish({ loading: false, refreshing: false, error: error?.message || 'Your requests could not be loaded. Please try again.' });
      }
    },
    dispose() {
      disposed = true;
      requestNumber += 1;
    },
  };
}
